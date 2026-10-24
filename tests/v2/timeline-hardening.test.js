// Round two of the timeline (docs/v2/TIMELINE.md): the commit is in the chat file before anything is switched, commits that cannot
// race, a host domain and participant identities no module can forge, participants that fail closed, the proof pins bound to
// the bytes, a complete manifest, the rule-settings overlay, the sealed batch result, and the epoch gate on legacy guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { crash, gateProblem } from '../../src/v2/timeline/index.js';
import { hashJson } from '../../src/v2/replay.js';
import { BATCH, DEATH, NATIVE, NPC, batchFor, clone, nativeModule, reload, resultFor, rulesModule, seal, slice, track } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const cmd = async (host, type, payload = {}) => assert.equal((await host.sdk.command(type, payload)).ok, true, type);

// A story with a save, a dead timeline on top of it (xp 140, the dossier changed, the batch sealed) and a restore prepared.
async function world(t, { modules = [], native = nativeModule(), prepare = true } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const hook = { at: async phase => { await hook.on?.(phase); } };
    const host = await createHost({ modules: [rulesModule(), native.def, ...modules], timelineFaults: hook });
    t.after(() => host.close());
    await host.send('Go.', reply('A.', ['+ coin 10']));
    await cmd(host, 'tl.xp', { amount: 40 });
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Save' })).snapshot;
    const disk = track(host);
    await cmd(host, 'tl.xp', { amount: 100 });
    native.native.edit(state => { state.dossiers.tavi.trust = 99; });
    await seal(host);
    const head = await host.sdk.timeline.head();
    const prepared = prepare ? await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash }) : null;
    if (prepare) assert.equal(prepared.ok, true, prepared.message);
    const activate = () => host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    return { host, native, hook, saved, disk, head, prepared, activate, modules: () => [rulesModule(), native.def, ...modules] };
}
const hasReceipt = (image, type) => JSON.stringify(image.chat).includes(`"type":"${type}"`);

// ---- 1. the commit is durable before anything is switched --------------------------------------------------

test('a restore whose commit could not be saved switches no participant; the retry saves the commit first', async t => {
    const { host, native, disk, saved, prepared, activate } = await world(t);
    host.st.failSaves = 1;
    const failed = await activate();
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'FAILED');
    assert.match(failed.message, /could not be saved/);
    assert.equal(native.native.calls.some(call => call.name === 'activate'), false, 'no participant was asked to switch');
    assert.equal(hasReceipt(disk.image, 'savepoint.restore'), false, 'the file does not have the commit');
    assert.equal(host.registry.restore().state, 'pending', 'the barrier stays up');
    assert.deepEqual(native.native.store.dossiers.tavi, { trust: 99 });
    // The retry saves the commit, and only then asks the participant.
    const done = await activate();
    assert.deepEqual(done, { ok: true, return: prepared.return, status: 'complete' });
    assert.equal(hasReceipt(disk.image, 'savepoint.restore'), true);
    assert.equal(hasReceipt(disk.image, 'savepoint.complete'), true);
    assert.equal(native.native.store.dossiers.tavi.trust, 3);
    void saved;
});

test('a crash after the participant switched cannot leave the story without the return: the commit was saved before the switch', async t => {
    const { host, native, hook, disk, modules, activate, prepared } = await world(t);
    host.st.failSaves = 1;
    assert.equal((await activate()).ok, false);
    hook.on = phase => { if (phase === 'activate.participant:tl-native:acked') throw crash(); };
    await assert.rejects(activate(), error => error.message.includes('simulated crash'));
    assert.equal(native.native.store.dossiers.tavi.trust, 3, 'the participant switched');
    const image = clone(disk.image);
    assert.equal(hasReceipt(image, 'savepoint.restore'), true, 'and the file has the restore it switched for');
    const again = await reload(createHost, image, modules());
    t.after(() => again.close());
    assert.equal(again.head().domains.progress.xp, 40, 'not xp 140 with a restored participant');
    assert.equal(again.head().domains.savepoints.returns[prepared.return].status, 'complete');
    assert.equal((await again.sdk.timeline.status()).state, 'idle');
    assert.equal(again.registry.restore().state, 'idle');
});

test('a restore is told complete only when the final save worked; a failed one is the caller\'s failure and a retry answers once it is saved', async t => {
    const { host, hook, disk, activate, prepared } = await world(t);
    hook.on = phase => { if (phase === 'activate.acked') host.st.failSaves = 1; };
    const failed = await activate();
    assert.equal(failed.ok, false, 'not told complete');
    assert.equal(hasReceipt(disk.image, 'savepoint.complete'), false);
    hook.on = null;
    assert.deepEqual(await activate(), { ok: true, return: prepared.return, status: 'complete' });
    assert.equal(hasReceipt(disk.image, 'savepoint.complete'), true, 'told complete after the file has it');
});

test('a save point and a forget are told made only when the chat is saved', async t => {
    const { host, hook } = await world(t, { prepare: false });
    // The bytes cannot be saved: nothing is stored.
    host.st.failSaves = 1;
    const early = await host.sdk.timeline.make({ kind: 'manual', name: 'Early' });
    assert.equal(early.code, 'FAILED');
    assert.equal(Object.values(host.head().domains.savepoints.points).some(point => point.name === 'Early'), false);
    // The descriptor is in the story but the file could not take it: the caller is told, and the store saves it when it can.
    hook.on = phase => { if (phase === 'make.committed') host.st.failSaves = 1; };
    const failed = await host.sdk.timeline.make({ kind: 'manual', name: 'Unsaved' });
    hook.on = null;
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'FAILED');
    assert.match(failed.message, /could not be saved yet/);
    const id = Object.values(host.head().domains.savepoints.points).find(point => point.name === 'Unsaved').id;
    host.st.failSaves = 1;
    const forgotten = await host.sdk.timeline.forget({ snapshot: id });
    assert.equal(forgotten.ok, false);
    assert.equal((await host.sdk.timeline.forget({ snapshot: id })).code, 'NOT_FOUND', 'it is forgotten in the story');
});

// ---- 2. commits that cannot race -----------------------------------------------------------------------------

test('an activate whose head moves while it waits is STALE, not restored', async t => {
    const { host, native, hook, activate, prepared } = await world(t);
    hook.on = async phase => { if (phase === 'activate.checked') await host.sdk.command('tl.xp', { amount: 1 }); };
    const result = await activate();
    assert.equal(result.code, 'STALE');
    assert.equal(host.head().domains.progress.xp, 141);
    assert.equal(host.head().domains.savepoints.returns && Object.keys(host.head().domains.savepoints.returns).length, 0);
    assert.equal(native.native.calls.some(call => call.name === 'activate'), false);
    assert.equal(host.timeline.host.journal().find(entry => entry.id === prepared.prepared).phase, 'aborted');
    assert.equal(host.registry.restore().state, 'idle');
});

test('an activate for a chat that was swapped while it waited is STALE and writes nothing to the other chat', async t => {
    const { host, native, hook, activate } = await world(t);
    const original = host.ctx.chatMetadata;
    hook.on = phase => { if (phase === 'activate.checked') host.ctx.chatMetadata = { storySuite: {} }; };
    const result = await activate();
    host.ctx.chatMetadata = original;
    assert.equal(result.code, 'STALE');
    assert.equal(host.head().domains.progress.xp, 140);
    assert.equal(native.native.calls.some(call => call.name === 'activate'), false);
    assert.deepEqual(host.ctx.chatMetadata.storySuite.timeline.journal[Object.keys(host.ctx.chatMetadata.storySuite.timeline.journal).find(id => id.startsWith('pp_'))].phase, 'prepared');
});

test('two activates of one token at once: one restore, the second answers the first', async t => {
    const { native, activate, prepared } = await world(t);
    const [a, b] = await Promise.all([activate(), activate()]);
    assert.deepEqual(a, { ok: true, return: prepared.return, status: 'complete' });
    assert.deepEqual(b, a);
    assert.equal(native.native.calls.filter(call => call.name === 'activate').length, 1);
});

test('a native event whose head moves while the participant makes its checkpoint is STALE and is not delivered', async t => {
    const native = nativeModule();
    let moves = false;
    const inner = native.def.participant.checkpoint;
    native.def.participant.checkpoint = async input => {
        if (moves) await host.sdk.command('tl.xp', { amount: 1 });
        return inner(input);
    };
    const { host } = await world(t, { native, prepare: false });
    moves = true;
    const head = await host.sdk.timeline.head();
    const result = await host.timeline.host.nativeEvent({ event: 'ev_race0001', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash });
    assert.equal(result.code, 'STALE');
    assert.equal(native.native.calls.some(call => call.name === 'applyEvent'), false);
    assert.equal(host.timeline.host.journal().some(entry => entry.kind === 'native-event'), false);
    assert.equal(host.registry.restore().state, 'idle');
});

// ---- 3. forgeable host state and participant identity ------------------------------------------------------

test('no module can declare the host\'s savepoints domain', async t => {
    const { host } = await world(t, { prepare: false });
    const evil = { id: 'evil', name: 'Evil', version: '1.0.0', domains: { savepoints: { initial: () => ({ epoch: 'ep_aaaaaaaa', points: {} }) } } };
    await assert.rejects(host.sdk.registerModule(evil), /savepoints.*host's own/);
    await assert.rejects(createHost({ modules: [evil] }), /savepoints.*host's own/);
    assert.equal(host.registry.has('evil'), false);
});

test('only the host\'s own blocks write the savepoints: not a command\'s changes, not a block of another module, live or on replay', async t => {
    const { host } = await world(t, { prepare: false });
    const rev = host.head().meta.rev + 1;
    const receipt = { id: 'rc_forged001', type: 'x.forge', module: 'rival', cause: 'system', seed: 1, summary: 'x', narrate: false, data: {}, rev };
    const ops = [{ op: 'add', path: '/domains/savepoints/returns/rt_forged01', value: { id: 'rt_forged01' } }, { op: 'replace', path: '/meta/rev', value: rev }];
    assert.throws(() => host.store.append({ ops, receipt }), /host's own/);
    const block = { module: 'rival', source: host.store.sourceAt(host.store.headIndex()), guard: null, operation: { type: 'savepoint.make', payload: {} }, recorded: null, result: {} };
    assert.throws(() => host.store.append({ ops, receipt, block }), /host's own/);
    assert.equal(host.head().domains.savepoints.returns.rt_forged01, undefined);
    // A hand-edited chat: the host's make block made out to be another module's, or a block with no metadata at all.
    const record = host.ctx.chat.at(-1).extra.storySuite;
    const span = record.spans.find(each => each.operation?.type === 'savepoint.make');
    const saved = clone(span);
    span.module = 'rival';
    host.store.rebuild();
    assert.equal(host.head().domains.savepoints, undefined, 'the block is off');
    assert.equal(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE' && /host's savepoints/.test(problem.why)), true);
    Object.assign(span, saved);
    host.store.rebuild();
    assert.equal(Object.keys(host.head().domains.savepoints.points).length, 1);
    const index = record.spans.indexOf(span);
    record.spans[index] = { n: span.n, story: false };
    for (const each of record.receipts) delete each.guarded;
    host.store.rebuild();
    assert.equal(host.head().domains.savepoints, undefined, 'a block with no metadata cannot write them');
    assert.equal(host.store.problems().some(problem => /host's savepoints/.test(problem.why)), true);
});

test('a participant\'s identity is the registering module\'s: a declaration naming another module is refused and fails closed', async t => {
    const { host, native, saved } = await world(t, { prepare: false });
    const other = nativeModule({ id: 'tl-other' });
    other.def.domains = {};
    other.def.participant.module = NATIVE;      // names the module that is registered already
    await host.sdk.registerModule(other.def);
    assert.deepEqual(host.timeline.host.participants(), [NATIVE], 'the real participant is untouched');
    const made = await host.sdk.timeline.make({ kind: 'manual', name: 'Not now' });
    assert.equal(made.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(made.message, /tl-other.*names another module/);
    assert.equal((await restoreFrom(host, saved)).code, 'SNAPSHOT_UNAVAILABLE');
    void native;
});
const restoreFrom = async (host, saved) => {
    await seal(host);
    const head = await host.sdk.timeline.head();
    return host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
};

test('a field of a declaration cannot override the module: module is stamped from the definition', async t => {
    const { host } = await world(t, { prepare: false });
    const mine = nativeModule({ id: 'tl-mine' });
    mine.def.domains = {};
    await host.sdk.registerModule(mine.def);
    assert.equal(host.timeline.host.participants().includes('tl-mine'), true);
    assert.equal(host.timeline.host.participants().includes('someone-else'), false);
});

test('a death is taken only by the participant that owns npc.identity', async t => {
    const { host } = await world(t, { prepare: false });
    const other = nativeModule({ id: 'tl-other' });
    other.def.domains = {};
    await host.sdk.registerModule(other.def);
    const head = await host.sdk.timeline.head();
    const result = await host.timeline.host.nativeEvent({ event: 'ev_owner001', participant: 'tl-other', kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash });
    assert.equal(result.code, 'REFUSED');
    assert.match(result.message, /does not own npc\.identity/);
    assert.equal(other.native.calls.some(call => call.name === 'applyEvent'), false);
    const mine = await host.timeline.host.nativeEvent({ event: 'ev_owner002', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash });
    assert.equal(mine.ok, true, mine.message);
});

// ---- 4. participants fail closed -------------------------------------------------------------------------------

test('a module whose participant could not be registered holds saving and restoring; the others still read', async t => {
    const { host, saved } = await world(t, { prepare: false });
    await host.sdk.registerModule({ id: 'tl-broken', name: 'Broken', version: '1.0.0', participant: { schema: 1, checkpoint() {} } });
    for (const result of [await host.sdk.timeline.make({ kind: 'manual' }), await host.sdk.command('savepoint.make', {}), await restoreFrom(host, saved)]) {
        assert.equal(result.ok, false);
        assert.equal(result.code, 'SNAPSHOT_UNAVAILABLE');
        assert.match(result.message, /tl-broken.*could not be registered/);
    }
    assert.equal((await host.sdk.timeline.list()).ok, true);
    assert.equal((await host.sdk.timeline.head()).ok, true);
    assert.equal(host.head().domains.progress.xp, 140, 'nothing was restored');
});

test('activation must return the saved checkpoint id as well as its hash: another id with the same bytes is not the save', async t => {
    const native = nativeModule();
    const real = native.def.participant.activate;
    native.def.participant.activate = input => {
        const answer = real(input);
        return native.alias && answer.ok ? { ...answer, checkpoint: native.alias } : answer;
    };
    const { host, activate, saved, prepared } = await world(t, { native });
    native.native.checkpoints.ck_alias0001 = clone(native.native.checkpoints[saved.participants[0].checkpoint]);
    native.alias = 'ck_alias0001';
    const result = await activate();
    assert.equal(result.status, 'participants-pending');
    assert.equal(host.timeline.host.journal().find(entry => entry.id === prepared.prepared).participants[NATIVE].ack, null);
    assert.match(host.timeline.host.journal().find(entry => entry.id === prepared.prepared).why, /another checkpoint/);
    assert.equal(host.registry.restore().state, 'pending');
    native.alias = null;
    assert.equal((await activate()).status, 'complete');
});

test('a participant that saves another schema than it registered holds the save point', async t => {
    const native = nativeModule();
    native.def.participant.checkpoint = () => ({ ok: true, checkpoint: 'ck_odd00001', hash: 'a'.repeat(64), schema: 5 });
    const fresh = await createHost({ modules: [rulesModule(), native.def] });
    t.after(() => fresh.close());
    await fresh.send('Go.', reply('A.'));
    const made = await fresh.sdk.timeline.make({ kind: 'manual' });
    assert.equal(made.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(made.message, /schema 5/);
});

// ---- 5. the proof pins are bound to the bytes ---------------------------------------------------------------

test('the payload hash covers the proof pins: lost or changed pins are SNAPSHOT_UNAVAILABLE, not an empty set', async t => {
    const { host, saved, head } = await world(t, { prepare: false });
    const archive = host.ctx.chatMetadata.storySuite.timeline;
    const entry = archive.payloads[saved.payloadHash];
    assert.equal(saved.payloadHash, hashJson({ payload: entry.payload, proofs: entry.proofs }));
    const input = { snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash };
    const proofs = entry.proofs;
    delete entry.proofs;
    assert.equal((await host.timeline.host.prepare(input)).code, 'SNAPSHOT_UNAVAILABLE');
    entry.proofs = { pf_forged001: 'f'.repeat(64) };
    assert.equal((await host.timeline.host.prepare(input)).code, 'SNAPSHOT_UNAVAILABLE');
    entry.proofs = proofs;
    assert.equal((await host.timeline.host.prepare(input)).ok, true, 'the bytes as they were are fine');
});

// ---- 6. the manifest is complete -------------------------------------------------------------------------------

test('a registered domain that is in neither the state nor the save is not skipped: it needs absent() like any other', async t => {
    const dormant = absent => ({
        id: 'tl-dormant', name: 'Dormant', version: '1.0.0', requires: { peers: { 'tl-nobody': '^1' } },
        domains: { dorm: { initial: () => ({ n: 0 }), ...(absent ? { absent: () => ({ n: -1 }) } : {}) } },
    });
    const { host, saved } = await world(t, { modules: [dormant(false)], prepare: false });
    assert.equal(host.head().domains.dorm, undefined, 'it is dormant: its domain is not in the story');
    const refused = await restoreFrom(host, saved);
    assert.equal(refused.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(refused.message, /dorm.*absent\(\)/);
});

test('a registered domain that is in neither the state nor the save is brought to its absent() default and the manifest says so', async t => {
    const dormant = {
        id: 'tl-dormant', name: 'Dormant', version: '1.0.0', requires: { peers: { 'tl-nobody': '^1' } },
        domains: { dorm: { initial: () => ({ n: 0 }), absent: () => ({ n: -1 }) } },
    };
    const { host, saved } = await world(t, { modules: [dormant], prepare: false });
    const done = await restoreFrom(host, saved);
    assert.equal(done.ok, true, done.message);
    assert.equal(host.timeline.host.journal().findLast(entry => entry.kind === 'restore').manifest.domains.dorm.source, 'default');
});

test('restoring a day start brings back its index entry and the previous day: the same day cannot be saved again', async t => {
    const { host } = await world(t, { prepare: false });
    const d2 = (await host.timeline.host.make({ kind: 'day-start', day: 2 })).snapshot;
    await cmd(host, 'tl.xp', { amount: 1 });
    const d3 = (await host.timeline.host.make({ kind: 'day-start', day: 3 })).snapshot;
    await cmd(host, 'tl.xp', { amount: 1 });
    const d4 = (await host.timeline.host.make({ kind: 'day-start', day: 4 })).snapshot;
    assert.deepEqual(host.head().domains.savepoints.dayStarts, { 2: d2.id, 3: d3.id, 4: d4.id });
    assert.equal(host.head().domains.savepoints.previousDay, d3.id);
    await seal(host);
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: d3.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.equal((await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash })).status, 'complete');
    const domain = host.head().domains.savepoints;
    assert.deepEqual(domain.dayStarts, { 2: d2.id, 3: d3.id }, 'day 4 is faded, day 3 is back');
    assert.equal(domain.previousDay, d2.id);
    assert.equal((await host.timeline.host.make({ kind: 'day-start', day: 3 })).code, 'CONFLICT', 'day 3 is not saved twice');
    assert.equal((await host.timeline.host.make({ kind: 'day-start', day: 4 })).ok, true, 'day 4 can be saved anew');
});

// ---- 7. rule settings and the sealed batch result -------------------------------------------------------------

const settingsModule = () => ({
    id: 'tl-settings', name: 'Settings', version: '1.0.0',
    settings: { defaults: { difficulty: 'normal', theme: 'dark' }, rules: ['difficulty'] },
    domains: { ts: { initial: () => ({ reads: [] }) } },
    commands: { 'ts.read'(ctx) { ctx.draft('ts').reads.push(ctx.settings().difficulty); return { summary: 'read', narrate: false }; } },
});

test('a restore sets the saved rule settings as the chat\'s own: modules read them in preference to the global ones, and a swipe takes them back', async t => {
    const { host, saved } = await world(t, { modules: [settingsModule()], prepare: false });
    host.settings.stored('tl-settings').difficulty = 'hard';
    const made = (await host.sdk.timeline.make({ kind: 'manual', name: 'Hard' })).snapshot;
    assert.deepEqual(host.ctx.chatMetadata.storySuite.timeline.payloads[made.payloadHash].payload.effectiveSettings, { 'tl-settings': { difficulty: 'hard' } });
    host.settings.stored('tl-settings').difficulty = 'easy';
    host.settings.stored('tl-settings').theme = 'light';
    await cmd(host, 'ts.read');
    assert.deepEqual(host.head().domains.ts.reads, ['easy']);
    assert.equal(host.head().domains.savepoints.ruleSettings['tl-settings'], undefined, 'no restore yet: the global setting reads');
    await seal(host);
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: made.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.equal((await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash })).status, 'complete');
    assert.deepEqual(host.head().domains.savepoints.ruleSettings, { 'tl-settings': { difficulty: 'hard' } });
    assert.equal(host.sdk.settings('tl-settings').difficulty, 'hard', 'the saved rule');
    assert.equal(host.sdk.settings('tl-settings').theme, 'light', 'the reader\'s own preference is not restored');
    await cmd(host, 'ts.read');
    assert.deepEqual(host.head().domains.ts.reads, ['hard'], 'a command reads the chat\'s rule');
    assert.equal(host.settings.stored('tl-settings').difficulty, 'easy', 'the global setting is untouched');
    // The overlay is part of the line of history: the reply with the restore goes, the global setting reads again.
    await host.swipe(reply('Elsewhere.'));
    assert.equal(host.sdk.settings('tl-settings').difficulty, 'easy');
    void saved;
});

test('the sealed batch result is resolved by its owner, checked against its hash and pinned as bytes', async t => {
    const { host, saved } = await world(t, { prepare: false });
    const input = async patch => ({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: (await host.sdk.timeline.head()).headHash, ...patch });
    // No such sealed result.
    const unknown = batchFor('br_nothing1');
    assert.equal((await host.timeline.host.prepare(await input({ batchResult: unknown }))).code, 'NOT_FOUND');
    // The hash given is not the sealed result's.
    assert.equal((await host.timeline.host.prepare(await input({ batchResult: { id: BATCH.id, hash: 'd'.repeat(64) } }))).code, 'CONFLICT');
    // Resolved: the bytes are pinned.
    const prepared = await host.timeline.host.prepare(await input());
    assert.equal(prepared.ok, true, prepared.message);
    const pin = host.timeline.host.pin(BATCH.id);
    assert.deepEqual(pin.bytes, resultFor(BATCH.id));
    assert.equal(hashJson(pin.bytes), BATCH.hash);
    assert.equal(pin.resolvedBy, 'tl-rules');
    // After the restore the death domain holds none of it, and the pin still does.
    const head = await host.sdk.timeline.head();
    assert.equal((await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash })).status, 'complete');
    assert.deepEqual(host.head().domains.death.batches, {});
    assert.deepEqual(host.timeline.host.pin(BATCH.id).bytes, resultFor(BATCH.id));
});

test('a resolver that lies, answers twice or does not exist holds the restore', async t => {
    // A second owner of sealed results that claims the same id.
    const claimer = lie => ({
        id: 'tl-claimer', name: 'Claimer', version: '1.0.0',
        batchResults: { resolve: ({ id }) => (id === BATCH.id ? lie(id) : null) },
    });
    const run = async lie => {
        const { host, saved } = await world(t, { modules: [claimer(lie)], prepare: false });
        const head = await host.sdk.timeline.head();
        return host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    };
    // Two modules claim it.
    assert.equal((await run(id => ({ id, hash: BATCH.hash, bytes: resultFor(id) }))).code, 'CONFLICT');
    // The only owner's bytes do not hash to its hash: use a host whose only resolver lies.
    const liar = { id: 'tl-liar', name: 'Liar', version: '1.0.0', domains: { liar: { initial: () => ({}) } }, batchResults: { resolve: ({ id }) => ({ id, hash: BATCH.hash, bytes: { forged: true } }) } };
    const lone = await createHost({ modules: [liar] });
    t.after(() => lone.close());
    await lone.send('Go.', reply('A.'));
    const saved = (await lone.sdk.timeline.make({ kind: 'manual' })).snapshot;
    const head = await lone.sdk.timeline.head();
    const lied = await lone.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.equal(lied.code, 'CONFLICT');
    assert.match(lied.message, /does not hash/);
    // A resolver that answers with a promise is not an answer.
    const slow = { id: 'tl-slow', name: 'Slow', version: '1.0.0', domains: { slow: { initial: () => ({}) } }, batchResults: { resolve: async ({ id }) => ({ id, hash: BATCH.hash, bytes: {} }) } };
    const waiting = await createHost({ modules: [slow] });
    t.after(() => waiting.close());
    await waiting.send('Go.', reply('A.'));
    const point = (await waiting.sdk.timeline.make({ kind: 'manual' })).snapshot;
    const h = await waiting.sdk.timeline.head();
    assert.equal((await waiting.timeline.host.prepare({ snapshot: point.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: h.headHash })).code, 'NOT_FOUND');
    // No module resolves sealed results at all.
    const none = await createHost({ modules: [{ id: 'tl-plain', name: 'Plain', version: '1.0.0', domains: { plain: { initial: () => ({}) } } }] });
    t.after(() => none.close());
    await none.send('Go.', reply('A.'));
    const p = (await none.sdk.timeline.make({ kind: 'manual' })).snapshot;
    const hh = await none.sdk.timeline.head();
    const missing = await none.timeline.host.prepare({ snapshot: p.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: hh.headHash });
    assert.equal(missing.code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(none.timeline.host.journal().some(entry => entry.kind === 'restore'), false, 'nothing was prepared');
});

// ---- 8. the epoch gate and guards that omit a field -------------------------------------------------------------

test('the gate compares only what a guard names: a guard with no epoch or no rules hash meets the timeline', () => {
    const state = { domains: { savepoints: { epoch: 'ep_abcdefgh' }, rules: { rulesHash: 'a'.repeat(64) } } };
    assert.equal(gateProblem(state, { owner: 'x', version: 2, inputHash: 'b'.repeat(64), predicate: {} }), '');
    assert.equal(gateProblem(state, { epoch: undefined, rulesHash: undefined }), '');
    assert.equal(gateProblem(state, { epoch: null, rulesHash: null }), '');
    assert.equal(gateProblem(state, { epoch: 'ep_abcdefgh', rulesHash: 'a'.repeat(64) }), '');
    assert.match(gateProblem(state, { epoch: 'ep_zzzzzzzz' }), /epoch ep_zzzzzzzz/);
    assert.match(gateProblem(state, { rulesHash: 'c'.repeat(64) }), /other rules/);
    assert.equal(gateProblem({ domains: {} }, { epoch: 'ep_zzzzzzzz', rulesHash: 'c'.repeat(64) }), '', 'a story with neither has nothing to meet');
    assert.equal(gateProblem(state, null), '');
});

test('recover takes {} and the host\'s authority, like the other authenticated methods', async t => {
    const { host } = await world(t, { prepare: false });
    assert.equal((await host.sdk.timeline.recover({})).code, 'REFUSED');
    assert.equal((await host.sdk.timeline.recover({}, { capability: {} })).code, 'REFUSED');
    assert.equal((await host.sdk.timeline.recover({ surprise: 1 }, host.timeline.capability)).code, 'INVALID');
    assert.equal((await host.sdk.timeline.recover(undefined, host.timeline.capability)).code, 'INVALID');
    assert.deepEqual(await host.sdk.timeline.recover({}, host.timeline.capability), { ok: true, state: 'idle', return: null });
    assert.deepEqual(await host.timeline.host.recover(), { ok: true, state: 'idle', return: null });
    void slice;
});
