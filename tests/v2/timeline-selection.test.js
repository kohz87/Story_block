import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { nativeModule, rulesModule, restore, clone, reload, NATIVE } from './helpers/timeline.js';
import { hashJson } from '../../src/v2/replay.js';
import { createParticipants } from '../../src/v2/timeline/participants.js';
import { sourceOf } from '../helpers/split-source.js';
import { director, hostModule } from './helpers/evidence.js';

async function setup(t) {
    const native = nativeModule();
    const modules = [rulesModule(), native.def];
    const host = await createHost({ modules });
    t.after(() => host.close());
    await host.send('Begin.', 'Start.');
    const point = (await host.sdk.timeline.make({ kind: 'manual' })).snapshot;
    await host.send('Next.', 'Before death.');
    const head = await host.sdk.timeline.head();
    await native.native.handle.nativeMutation({ participant: NATIVE, source: head.source, expectedHead: head.headHash, prepare: async () => {
        const before = native.native.checkpoint();
        const next = clone(native.native.store);
        next.dossiers.tavi.trust = 9;
        const after = native.native.keep(next);
        native.native.prepared.pr_mutation = { checkpoint: after.checkpoint };
        return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_mutation' };
    } });
    await host.send('Die.', 'Death.');
    assert.equal((await restore(host, point.id)).activated.status, 'complete');
    assert.equal(native.native.store.dossiers.tavi.trust, 3);
    return { host, native: native.native, modules, point };
}

for (const action of ['swipe', 'delete', 'reread', 'delete-earlier']) test(`selection barrier: ${action} restores matching native prefix before scans, including reload`, async t => {
    const { host, native, modules } = await setup(t);
    if (action === 'swipe') await host.swipe('Another ending.');
    if (action === 'delete') await host.st.deleteMessage(host.ctx.chat.length - 1);
    if (action === 'reread') {
        await host.st.editMessage(4, 'Changed.\n<Changes>\n+ coin 8\n</Changes>');
        await host.sdk.reread(4);
    }
    if (action === 'delete-earlier') await host.st.deleteMessage(4);
    assert.equal((await host.timeline.host.recover()).state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, action === 'reread' || action === 'delete-earlier' ? 3 : 9);
    const status = await host.sdk.timeline.status();
    assert.equal(status.participants[0].hash, hashJson(native.store));
    const state = clone(host.head());
    host.store.rebuild();
    assert.deepEqual(clone(host.head()), state);
    const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules);
    t.after(() => fresh.close());
    assert.equal(fresh.registry.restore().state, 'idle');
    assert.equal((await fresh.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
});

test('a head change is barred synchronously; failure holds scans and generation until retry confirms', async t => {
    const { host, native } = await setup(t);
    native.fail.add('activate');
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal((await host.sdk.timeline.head()).code, 'RESTORE_PENDING');
    assert.equal(host.sdk.modules().every(x => x.status === 'restore-pending'), true);
    assert.equal((await host.sdk.command('tl.xp', { amount: 1 })).code, 'RESTORE_PENDING');
    native.fail.delete('activate');
    assert.equal((await host.timeline.host.recover()).state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, 9);
});

test('participant callbacks time out and late calls cannot race a new selection', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { def } = nativeModule();
    let release;
    const participants = createParticipants({ timeoutMs: 25 });
    participants.register({ ...def.participant, module: NATIVE, checkpoint: () => new Promise(resolve => { release = resolve; }) });
    const call = participants.call(NATIVE, 'checkpoint', {});
    await Promise.resolve();
    await Promise.resolve();
    t.mock.timers.tick(25);
    // (a timeout is "retry shortly", STALE, and says the late call is still running; the call that meets it is STALE too)
    const timedOut = await call;
    assert.equal(timedOut.code, 'STALE');
    assert.match(timedOut.message, /still running/);
    assert.equal((await participants.call(NATIVE, 'status', {})).code, 'STALE');
    release({ ok: true, checkpoint: 'ck_00000001', hash: 'a'.repeat(64), schema: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await participants.call(NATIVE, 'status', {})).code, 'NOT_FOUND');
});

test('swipe back, Continue and checkpoint rebuild keep the selected native checkpoint', async t => {
    const { host, native } = await setup(t);
    const index = host.ctx.chat.length - 1;
    await host.swipe('Other ending.');
    assert.equal(native.store.dossiers.tavi.trust, 9);
    await host.st.swipeTo(index, 0);
    assert.equal(native.store.dossiers.tavi.trust, 3);
    await host.cont(' The waking scene.');
    // Continue edits evidence: a restore whose pure prefix depended on it retracts safely.
    await host.timeline.host.recover();
    assert.equal((await host.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
    host.store.rebuild();
    await host.timeline.host.recover();
    assert.equal((await host.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
});

test('selection rules and durability have one implementation site', async () => {
    const { readFile } = await import('node:fs/promises');
    const coordinator = sourceOf('src/v2/timeline/coordinator.js');
    const participants = await readFile(new URL('../../src/v2/timeline/participants.js', import.meta.url), 'utf8');
    assert.equal((coordinator.match(/function selectionPlan\(/g) ?? []).length, 1);
    assert.equal((coordinator.match(/await store\.flush\(/g) ?? []).length, 1);
    assert.equal((participants.match(/timer = setTimeout\(/g) ?? []).length, 1);
    assert.equal(coordinator.includes('archive.prefixes(module).at(-1)'), false);
});

// A reply's text changes after its guarded steps were stamped (another extension adds a panel), a native change is recorded on it, and a
// swipe's reconcile stamps the steps again: the native state of the reply before the swiped one comes back, not the first reply's.
async function replies(t, count, { edit = true, older = '', kept = '', plain = false } = {}) {
    const link = hostModule();
    const native = nativeModule();
    if (older) { const real = native.def.participant.activate; native.def.participant.activate = async input => ({ ...(await real(input)), older }); }
    if (kept) { const real = native.def.participant.activate; native.def.participant.activate = async input => ({ ...(await real(input)), kept }); }
    // (`plain`: the host's own core module and no guarded steps, as a chat where save points are made)
    const modules = plain ? [rulesModule(), native.def] : [link.def, director(), rulesModule(), native.def];
    const host = await createHost({ modules, ...(plain ? {} : { core: false }) });
    t.after(() => host.close());
    if (!plain) link.link(host.store);
    // (each reply makes one dossier of its own, `p<n>`, and moves Tavi's trust to n: the run's shape, a person met per reply)
    const step = async (n, on = host) => {
        await on.send(`Turn ${n}.`, `Reply ${n}.`);
        if (!plain) assert.equal((await on.bus.command('sd.setting', {}, { cause: 'system' })).ok, true);
        if (edit) { const message = on.ctx.chat.at(-1); message.mes += '\n\n<Blocks>\n</Blocks>'; message.swipes[message.swipe_id ?? 0] = message.mes; }
        const head = await on.sdk.timeline.head();
        const made = await native.native.handle.nativeMutation({ participant: NATIVE, source: head.source, expectedHead: head.headHash, prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = n;
            next.dossiers[`p${n}`] = { met: n };
            const after = native.native.keep(next);
            native.native.prepared[`pr_${n}`] = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: `pr_${n}` };
        } });
        assert.equal(made.ok, true);
    };
    for (let n = 1; n <= count; n++) await step(n);
    return { host, native: native.native, modules, step };
}
const people = native => Object.keys(native.store.dossiers).filter(key => key !== 'tavi').map(key => Number(key.slice(1))).sort((a, b) => a - b);

test('swipe of the latest reply: the state of the reply before it comes back although a reconcile stamped the earlier steps anew', async t => {
    const { host, native } = await replies(t, 5);
    const stamps = () => host.ctx.chat.map(message => JSON.stringify(message.extra?.storySuite?.spans?.filter(span => span.id)?.map(span => span.boundaries)));
    const before = stamps();
    await host.swipe('Reply 5 again.');
    assert.equal(stamps().some((stamp, at) => stamp !== before[at]), true, 'the reconcile did stamp earlier steps anew (else this checks nothing)');
    await host.timeline.host.recover();
    assert.equal(native.store.dossiers.tavi.trust, 4);
    assert.deepEqual(host.store.boundaryProblems().filter(problem => problem.index < host.ctx.chat.length - 1), []);
    // The carried mappings stand: a second swipe of the latest reply gives the same parent, and a reload agrees.
    await host.swipe('Reply 5 once more.');
    await host.timeline.host.recover();
    assert.equal(native.store.dossiers.tavi.trust, 4);
});

test('a participant that installed an older state than expected says so: the answer\'s `older` line is a Problem, quiet, with its own code', async t => {
    const { host } = await replies(t, 3, { older: 'Restored an older dossier state than expected: 9 messages back.' });
    await host.swipe('Reply 3 again.');
    await host.timeline.host.recover();
    const found = host.turn.problems().filter(problem => problem.code === 'SELECTION_OLDER');
    assert.equal(found.length > 0, true);
    assert.equal(found[0].message, 'Restored an older dossier state than expected: 9 messages back.');
});

test('an earlier reply whose text changed does not take the native state back: the swipe of the latest still gives its parent', async t => {
    const { host, native } = await replies(t, 5);
    const message = host.ctx.chat[2];
    message.mes = `${message.mes.replace('Reply 1.', 'Reply 1, edited.')}`;
    message.swipes[message.swipe_id ?? 0] = message.mes;
    await host.swipe('Reply 5 again.');
    await host.timeline.host.recover();
    assert.equal(native.store.dossiers.tavi.trust, 4, 'the mappings of the replies still there are carried over the changed text: the parent, not the first known state');
    assert.deepEqual(people(native), [1, 2, 3, 4]);
});

// Run 4 (12 Nov): a delete of a middle reply and two Re-reads of a middle reply installed the checkpoint of the last reply before it (the mappings of
// every later reply named the old prefix), and eight dossiers fell to three. The mappings of the replies still there now follow the change.
for (const action of ['delete', 'reread', 'edit']) test(`run 4: ${action} of a middle reply keeps the dossiers of the eight replies; the swipe of the latest after it gives its parent, also after a reload`, async t => {
    const { host, native, modules } = await replies(t, 8);
    const middle = 2 * 4;
    if (action === 'delete') await host.st.deleteMessage(middle);
    if (action === 'reread') assert.equal((await host.sdk.reread(middle)).ok, true);
    if (action === 'edit') await host.st.editMessage(middle, host.ctx.chat[middle].mes.replace('Reply 4.', 'Reply 4, edited.'));
    assert.equal((await host.timeline.host.recover()).state, 'idle');
    assert.deepEqual(people(native), [1, 2, 3, 4, 5, 6, 7, 8], 'no dossier a reply still in the story made is dropped');
    assert.equal(native.store.dossiers.tavi.trust, 8);
    assert.equal((await host.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
    // A Re-read of another middle reply after it changes nothing either.
    assert.equal((await host.sdk.reread(2 * 6 - (action === 'delete' ? 1 : 0))).ok, true);
    await host.timeline.host.recover();
    assert.deepEqual(people(native), [1, 2, 3, 4, 5, 6, 7, 8]);
    // A reload between: the carried mappings are in the chat's metadata, and the swipe of the latest reply gives reply 7's state.
    const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules, { core: false });
    t.after(() => fresh.close());
    assert.equal((await fresh.timeline.host.recover()).state, 'idle');
    assert.equal((await fresh.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
    await host.swipe('Reply 8 again.');
    await host.timeline.host.recover();
    assert.equal(native.store.dossiers.tavi.trust, 7);
    assert.deepEqual(people(native), [1, 2, 3, 4, 5, 6, 7], 'the swiped reply\'s own dossier goes, the others stay');
});

test('the delete of the latest reply still takes back what it alone made; several deletes of middle replies keep the rest', async t => {
    const { host, native } = await replies(t, 8);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.timeline.host.recover();
    assert.deepEqual([native.store.dossiers.tavi.trust, people(native)], [7, [1, 2, 3, 4, 5, 6, 7]]);
    await host.st.deleteMessage(4);
    await host.st.deleteMessage(8);
    await host.timeline.host.recover();
    assert.deepEqual([native.store.dossiers.tavi.trust, people(native)], [7, [1, 2, 3, 4, 5, 6, 7]]);
    assert.equal((await host.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
});

test('a save point made after a middle delete and a Re-read restores the dossiers it was made on', async t => {
    const { host, native, step } = await replies(t, 8, { plain: true });
    await host.st.deleteMessage(2 * 3);
    assert.equal((await host.sdk.reread(2 * 5 - 1)).ok, true);
    await host.timeline.host.recover();
    const point = (await host.sdk.timeline.make({ kind: 'manual' })).snapshot;
    assert.ok(point?.id);
    await step(9);
    assert.deepEqual(people(native), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal((await restore(host, point.id)).activated.status, 'complete');
    assert.deepEqual([native.store.dossiers.tavi.trust, people(native)], [8, [1, 2, 3, 4, 5, 6, 7, 8]]);
});

test('a participant that kept its state says so: the answer\'s `kept` line is a Problem, quiet, with its own code', async t => {
    const { host } = await replies(t, 3, { kept: 'Dossiers were kept as they are.' });
    await host.swipe('Reply 3 again.');
    await host.timeline.host.recover();
    const found = host.turn.problems().filter(problem => problem.code === 'SELECTION_KEPT');
    assert.equal(found.length > 0, true);
    assert.equal(found[0].message, 'Dossiers were kept as they are.');
});

test('prefix witness: `bare` ignores the stored boundary stamps and follows records and text (run data, when present)', async t => {
    const { readFile } = await import('node:fs/promises');
    let lines;
    const dir = process.env.SWIPECHK_FILES;
    if (!dir) { t.skip('SWIPECHK_FILES (the run data folder) is not set'); return; }
    try { lines = (await readFile(`${dir}/chat.jsonl`, 'utf8')).trim().split('\n').map(line => JSON.parse(line)); } catch { t.skip('the run data is not here'); return; }
    const open = async mutate => {
        const chat = clone(lines.slice(1));
        mutate(chat);
        const host = await createHost({ modules: [], st: { chat, chatMetadata: clone(lines[0].chat_metadata) } });
        t.after(() => host.close());
        return host;
    };
    const cursors = Object.values(lines[0].chat_metadata.storySuite.timeline.prefix['npc-state-delta']).map(mapping => mapping.boundary.cursor);
    const plain = await open(() => {});
    const restamped = await open(chat => { for (const message of chat) for (const span of message.extra?.storySuite?.spans ?? []) for (const boundary of span.boundaries ?? []) { boundary.prefixHash = 'f'.repeat(64); boundary.payloadHash = 'e'.repeat(64); } });
    const edited = await open(chat => { chat[2].mes = chat[2].mes.replace('stallkeeper', 'stall-keeper'); });
    let compared = 0;
    for (const cursor of cursors) {
        const a = plain.store.prefixWitness(cursor);
        const b = restamped.store.prefixWitness(cursor);
        const c = edited.store.prefixWitness(cursor);
        if (!a || !b || !c || a.index <= 2) continue;
        compared += 1;
        assert.equal(b.bare, a.bare, 'new stamps change no records and no text');
        assert.notEqual(b.prefixHash, a.prefixHash, 'but they do change the prefix hash the mapping was made on');
        assert.notEqual(c.bare, a.bare, 'an edited earlier reply is a different prefix');
    }
    assert.ok(compared >= 4);
});

test('carryBoundaries: a mapping follows new stamps, a changed step and a changed text of an earlier reply; one whose reply is gone stays as it is', async t => {
    const { host } = await replies(t, 3);
    const mapped = () => host.timeline.archive.prefixes(NATIVE).map(mapping => `${mapping.key}`).sort();
    const rewrite = change => {
        // (a new record object, as a reconcile writes one: the store's per-record caches are keyed by the object)
        const record = structuredClone(host.ctx.chat[2].extra.storySuite);
        change(record);
        host.ctx.chat[2].extra.storySuite = record;
    };
    const stamped = record => record.spans.find(span => span.boundaries);
    const standing = () => {
        for (const mapping of host.timeline.archive.prefixes(NATIVE)) {
            const witness = host.store.prefixWitness(mapping.boundary.cursor);
            if (witness) assert.equal(witness.prefixHash, mapping.boundary.prefixHash, 'each mapping whose reply is there names what the chat gives now');
        }
    };
    const count = mapped().length;
    const before = mapped();
    let finish = host.timeline.carryBoundaries();
    rewrite(record => { stamped(record).boundaries[0].prefixHash = 'f'.repeat(64); stamped(record).boundaries[0].payloadHash = 'e'.repeat(64); });
    assert.equal(finish(), 2, 'the mappings of the two replies after the re-stamped one are carried');
    assert.notDeepEqual(mapped(), before, 'under their new prefix hash');
    standing();
    finish = host.timeline.carryBoundaries();
    rewrite(record => { record.ops.find(op => op.path !== '/meta/rev').value = 'something else'; });
    assert.equal(finish() >= 2, true, 'a changed step of an earlier reply: the later replies\' mappings follow it');
    standing();
    finish = host.timeline.carryBoundaries();
    const message = host.ctx.chat[2];
    message.mes = message.mes.replace('Reply 1.', 'Reply 1, edited.');
    assert.equal(finish() >= 2, true, 'so does an edited text');
    standing();
    assert.equal(finish(), 0, 'nothing moved, nothing carried');
    assert.equal(mapped().length, count, 'no mapping is lost or doubled');
    // The latest reply deleted: its mapping has no reply to follow and is left as it is.
    const last = host.timeline.archive.prefixes(NATIVE).at(-1).key;
    finish = host.timeline.carryBoundaries();
    host.ctx.chat.splice(host.ctx.chat.length - 2, 2);
    finish();
    assert.equal(mapped().includes(last), true);
});
