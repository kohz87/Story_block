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
async function replies(t, count, { edit = true } = {}) {
    const link = hostModule();
    const native = nativeModule();
    const host = await createHost({ modules: [link.def, director(), rulesModule(), native.def], core: false });
    t.after(() => host.close());
    link.link(host.store);
    for (let n = 1; n <= count; n++) {
        await host.send(`Turn ${n}.`, `Reply ${n}.`);
        assert.equal((await host.bus.command('sd.setting', {}, { cause: 'system' })).ok, true);
        if (edit) { const message = host.ctx.chat.at(-1); message.mes += '\n\n<Blocks>\n</Blocks>'; message.swipes[message.swipe_id ?? 0] = message.mes; }
        const head = await host.sdk.timeline.head();
        const made = await native.native.handle.nativeMutation({ participant: NATIVE, source: head.source, expectedHead: head.headHash, prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = n;
            const after = native.native.keep(next);
            native.native.prepared[`pr_${n}`] = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: `pr_${n}` };
        } });
        assert.equal(made.ok, true);
    }
    return { host, native: native.native };
}

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

test('a mapping is not carried when the text of an earlier reply changed: the selection stays exact', async t => {
    const { host, native } = await replies(t, 5);
    const message = host.ctx.chat[2];
    message.mes = `${message.mes.replace('Reply 1.', 'Reply 1, edited.')}`;
    message.swipes[message.swipe_id ?? 0] = message.mes;
    await host.swipe('Reply 5 again.');
    await host.timeline.host.recover();
    assert.equal(native.store.dossiers.tavi.trust, 3, 'no mapping stands on the edited text, so none is carried: the first known state (as before)');
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

test('carryBoundaries: a mapping follows stamps that moved and nothing else; a changed step or text is not followed', async t => {
    const { host } = await replies(t, 3);
    const mapped = () => host.timeline.archive.prefixes(NATIVE).map(mapping => `${mapping.key}`).sort();
    const rewrite = change => {
        // (a new record object, as a reconcile writes one: the store's per-record caches are keyed by the object)
        const record = structuredClone(host.ctx.chat[2].extra.storySuite);
        change(record);
        host.ctx.chat[2].extra.storySuite = record;
    };
    const stamped = record => record.spans.find(span => span.boundaries);
    const before = mapped();
    let finish = host.timeline.carryBoundaries();
    rewrite(record => { stamped(record).boundaries[0].prefixHash = 'f'.repeat(64); stamped(record).boundaries[0].payloadHash = 'e'.repeat(64); });
    assert.equal(finish(), 2, 'the mappings of the two replies after the re-stamped one are carried');
    assert.notDeepEqual(mapped(), before, 'under their new prefix hash');
    const carried = mapped();
    for (const mapping of host.timeline.archive.prefixes(NATIVE)) {
        const witness = host.store.prefixWitness(mapping.boundary.cursor);
        assert.equal(witness.prefixHash, mapping.boundary.prefixHash, 'each mapping names what the chat gives now');
    }
    finish = host.timeline.carryBoundaries();
    rewrite(record => { record.ops.find(op => op.path !== '/meta/rev').value = 'something else'; });
    assert.equal(finish(), 0, 'a changed step is a different prefix');
    assert.deepEqual(mapped(), carried);
    finish = host.timeline.carryBoundaries();
    const message = host.ctx.chat[2];
    message.mes = message.mes.replace('Reply 1.', 'Reply 1, edited.');
    assert.equal(finish(), 0);
});
