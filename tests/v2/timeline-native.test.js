// The participant registry, timeline.nativeMutation, timeline.nativeEvent and the participant prefix map (contract §8, B6;
// docs/v2/TIMELINE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { crash } from '../../src/v2/timeline/index.js';
import { BATCH, NATIVE, NPC, batchFor, clone, nativeModule, reload, rulesModule, seal, track } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

async function started(t, options = {}) {
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def], ...options });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.'));
    return { host, native };
}

// A mutation of the dossiers through the module's own handle, as NSD's wrapper would make it.
const mutate = async (host, native, edit, { source, expectedHead, prepare } = {}) => {
    const head = await host.sdk.timeline.head();
    return native.native.handle.nativeMutation({
        participant: NATIVE,
        source: source ?? host.store.sourceAt(host.store.headIndex()),
        expectedHead: expectedHead ?? head.headHash,
        prepare: prepare ?? (async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            edit(next);
            const after = native.native.keep(next);
            native.native.prepared.pr_manual001 = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_manual001' };
        }),
    });
};

test('a module\'s participant is registered by the host with the module, and the module gets its own handle', async t => {
    const { host, native } = await started(t);
    assert.deepEqual(host.timeline.host.participants(), [NATIVE]);
    assert.deepEqual(Object.keys(native.native.handle).sort(), ['head', 'nativeMutation']);
    assert.equal(Object.isFrozen(native.native.handle), true);
    assert.equal((await native.native.handle.head()).ok, true);
    // A module registered later is attached when it registers.
    const late = nativeModule({ id: 'tl-late' });
    late.def.domains = {};
    await host.sdk.registerModule(late.def);
    assert.deepEqual(host.timeline.host.participants(), ['tl-late', NATIVE]);
    assert.equal(late.native.handle !== null, true);
});

test('registerParticipant: the host\'s callback only; a duplicate is a CONFLICT, bad callbacks are INVALID', async t => {
    const { host, native } = await started(t);
    const spec = { module: 'tl-extra', schema: 1, ...Object.fromEntries(['checkpoint', 'prepare', 'activate', 'abort', 'status'].map(name => [name, () => ({ ok: true })])) };
    assert.equal((await host.sdk.timeline.registerParticipant(spec)).code, 'REFUSED', 'no module registers itself');
    assert.deepEqual(await host.timeline.host.registerParticipant(spec), { ok: true, module: 'tl-extra' });
    assert.equal((await host.timeline.host.registerParticipant(spec)).code, 'CONFLICT');
    assert.equal((await host.timeline.host.registerParticipant({ ...spec, module: NATIVE })).code, 'CONFLICT');
    for (const name of ['checkpoint', 'prepare', 'activate', 'abort', 'status']) {
        const bad = { ...spec, module: `tl-no-${name}`, [name]: 'nope' };
        assert.equal((await host.timeline.host.registerParticipant(bad)).code, 'INVALID', name);
    }
    assert.equal((await host.timeline.host.registerParticipant({ ...spec, module: 'tl-bad-schema', schema: -1 })).code, 'INVALID');
    assert.equal((await host.timeline.host.registerParticipant({ ...spec, module: 'tl-bad-event', applyEvent: 5 })).code, 'INVALID');
    assert.equal((await host.timeline.host.registerParticipant({ ...spec, module: 'Bad Id' })).code, 'INVALID');
    assert.equal((await host.timeline.host.registerParticipant(null)).code, 'INVALID');
    void native;
    // A module whose own participant is not whole is registered as a module and warned about; it takes no part.
    const warned = [];
    t.mock.method(console, 'warn', (...args) => warned.push(args.join(' ')));
    await host.sdk.registerModule({ id: 'tl-broken', name: 'Broken', version: '1.0.0', participant: { schema: 1, checkpoint() {} } });
    assert.equal(warned.some(line => /tl-broken's participant was not registered/.test(line)), true);
    assert.equal(host.timeline.host.participants().includes('tl-broken'), false);
    assert.equal(host.sdk.modules().some(module => module.id === 'tl-broken'), true);
});

test('a participant\'s answer is held to the contract: a callback that throws, answers nothing or the wrong shape is a failure, never a success', async t => {
    const answers = [undefined, null, 'ok', { ok: 'yes' }, { ok: true }, { ok: true, checkpoint: 'ck_1', hash: 'nothex', schema: 1 }, { ok: true, checkpoint: '', hash: 'a'.repeat(64), schema: 1 },
        { ok: true, checkpoint: 'ck_1', hash: 'a'.repeat(64), schema: -1 }, { ok: false }, { ok: false, code: 'MADE_UP', message: 'x' }];
    for (const answer of [...answers, () => { throw new Error('boom'); }, async () => { throw new Error('async boom'); }]) {
        const fresh = nativeModule();
        fresh.def.participant.checkpoint = typeof answer === 'function' ? answer : () => answer;
        const host = await createHost({ modules: [rulesModule(), fresh.def] });
        try {
            await host.send('Hello.', reply('x'));
            const made = await host.sdk.timeline.make({ kind: 'manual' });
            assert.equal(made.ok, false, String(answer));
            assert.equal(['SNAPSHOT_UNAVAILABLE', 'FAILED'].includes(made.code), true, `${String(answer)} -> ${made.code}`);
            assert.equal(host.head().domains.savepoints, undefined, 'nothing was saved');
        } finally {
            host.close();
        }
    }
    // An async callback that answers properly is as good as a sync one.
    const good = nativeModule();
    const inner = good.def.participant.checkpoint;
    good.def.participant.checkpoint = async input => inner(input);
    const host = await createHost({ modules: [rulesModule(), good.def] });
    t.after(() => host.close());
    await host.send('Hello.', reply('x'));
    assert.equal((await host.sdk.timeline.make({ kind: 'manual' })).ok, true);
});

test('nativeMutation: both checkpoints are made durable first, the journal chooses, the participant activates, then the prefix map is published', async t => {
    const { host, native } = await started(t);
    const head = await host.sdk.timeline.head();
    const done = await mutate(host, native, state => { state.dossiers.tavi.trust = 4; });
    assert.equal(done.ok, true, done.message);
    assert.match(done.checkpoint, /^ck_/);
    assert.equal(native.native.store.dossiers.tavi.trust, 4, 'the participant activated');
    const entry = host.timeline.host.journal().find(each => each.kind === 'native-mutation');
    assert.equal(entry.phase, 'done');
    assert.equal(entry.participant, NATIVE);
    assert.equal(entry.expectedHead, head.headHash);
    assert.match(entry.id, /^nm_[0-9a-z]{8}$/);
    const names = native.native.calls.map(call => call.name);
    assert.equal(names.lastIndexOf('status') < names.lastIndexOf('activate'), true, 'it asked after the participant\'s state, then activated');
    assert.equal(native.native.calls.filter(call => call.name === 'activate')[0].input.return, entry.id, 'under this transaction\'s host-assigned id');
    // The prefix map: (chat lineage, canonical sid, swipe key, block, op, prefix hash) -> before, after, selected.
    const mapping = host.timeline.host.prefix(NATIVE, head.cursor, head.prefixHash);
    assert.equal(mapping.selected, 'after');
    assert.equal(mapping.tx, entry.id);
    assert.equal(mapping.after.checkpoint, done.checkpoint);
    assert.equal(mapping.before.checkpoint !== mapping.after.checkpoint, true);
    assert.equal(host.timeline.host.prefix(NATIVE, head.cursor, 'f'.repeat(64)), null, 'another prefix has no mapping');
    assert.equal(host.registry.restore().state, 'idle', 'the barrier went up and came down');
    assert.deepEqual((await host.sdk.timeline.status()).participants, [{ module: NATIVE, checkpoint: done.checkpoint, hash: done.hash, schema: 1 }]);
    // The native mutation is part of the head: the head moved though the story did not.
    const after = await host.sdk.timeline.head();
    assert.notEqual(after.headHash, head.headHash);
    assert.equal(after.prefixHash, head.prefixHash);
});

test('nativeMutation: a stale head cancels the change before anything is shown; a head that moves during prepare does too', async t => {
    const { host, native } = await started(t);
    const head = await host.sdk.timeline.head();
    await host.sdk.command('tl.xp', { amount: 1 });
    const stale = await mutate(host, native, state => { state.dossiers.tavi.trust = 5; }, { expectedHead: head.headHash });
    assert.equal(stale.code, 'STALE');
    assert.equal(native.native.store.dossiers.tavi.trust, 3);
    assert.equal(native.native.calls.some(call => call.name === 'activate'), false);
    const moving = await mutate(host, native, null, {
        prepare: async () => {
            await host.sdk.command('tl.xp', { amount: 1 });
            const before = native.native.checkpoint();
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...before, schema: 1 }, prepared: 'pr_manual002' };
        },
    });
    assert.equal(moving.code, 'STALE');
    assert.equal(native.native.calls.some(call => call.name === 'abort'), true, 'the participant was told to release it');
    assert.equal(host.timeline.host.journal().some(entry => entry.kind === 'native-mutation'), false, 'nothing was journaled');
    assert.equal(host.registry.restore().state, 'idle');
    // A source that is not the reply at the head is stale too.
    const elsewhere = await mutate(host, native, state => { state.dossiers.tavi.trust = 5; }, { source: { sid: 'sr_nowhere1', swipeKey: 'sw_nowhere1', evidence: 'ev_nowhere1', ordinal: 0 } });
    assert.equal(elsewhere.code, 'STALE');
});

test('nativeMutation: only the registered participant calls it, with a whole request, and not during a restore', async t => {
    const { host, native } = await started(t);
    const head = (await host.sdk.timeline.head()).headHash;
    const ok = async patch => native.native.handle.nativeMutation({ participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head, prepare: async () => ({}), ...patch });
    assert.equal((await ok({ participant: 'someone-else' })).code, 'REFUSED', 'a participant cannot mutate for another');
    assert.equal((await ok({ participant: undefined })).code, 'REFUSED');
    assert.equal((await ok({ source: { sid: 1 } })).code, 'INVALID');
    assert.equal((await ok({ expectedHead: 'nothash' })).code, 'INVALID');
    assert.equal((await ok({ prepare: 5 })).code, 'INVALID');
    assert.equal((await ok({ surprise: 1 })).code, 'INVALID');
    assert.equal((await ok({})).code, 'INVALID', 'a prepare that gives neither checkpoint');
    assert.equal((await native.native.handle.nativeMutation(null)).code, 'INVALID');
    assert.equal((await host.sdk.timeline.nativeMutation({ participant: NATIVE })).code, 'REFUSED', 'the public object has no way in');
    host.registry.setRestore('pending', 'Restoring.');
    assert.equal((await ok({})).code, 'RESTORE_PENDING');
    host.registry.setRestore('idle');
    assert.equal(native.native.store.dossiers.tavi.trust, 3);
});

test('nativeMutation: an activation that fails leaves the barrier up and the journal\'s choice stands; recover completes it', async t => {
    const { host, native } = await started(t);
    native.native.fail.add('activate');
    const failed = await mutate(host, native, state => { state.dossiers.tavi.trust = 7; });
    assert.equal(failed.ok, false);
    assert.equal(host.registry.restore().state, 'pending', 'not unblocked while the participant is split from the story');
    assert.equal(host.timeline.host.journal().find(each => each.kind === 'native-mutation').phase, 'prepared');
    assert.equal((await host.sdk.timeline.head()).code, 'RESTORE_PENDING');
    native.native.fail.clear();
    assert.deepEqual(await host.timeline.host.recover(), { ok: true, state: 'idle', return: null });
    assert.equal(native.native.store.dossiers.tavi.trust, 7, 'the journal\'s choice');
    assert.equal(host.timeline.host.journal().find(each => each.kind === 'native-mutation').phase, 'done');
    assert.equal(host.registry.restore().state, 'idle');
    // A participant that answers other bytes than it prepared is a CONFLICT and stays held.
    native.native.fail.clear();
    const lying = await mutate(host, native, null, {
        prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = 8;
            const after = native.native.keep(next);
            native.native.prepared.pr_manual003 = { checkpoint: before.checkpoint, return: 'x' };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_manual003' };
        },
    });
    assert.equal(lying.code, 'CONFLICT');
    assert.equal(host.registry.restore().state, 'pending');
});

for (const phase of ['native.prepared', 'native.journaled']) {
    test(`crash at ${phase} during a native mutation: on reload the change is whole or never was`, async t => {
        const native = nativeModule();
        const state = { disk: null };
        const hook = { at: async at => { if (at === phase) { state.image = clone(state.disk.image); throw crash(); } } };
        const host = await createHost({ modules: [rulesModule(), native.def], timelineFaults: hook });
        t.after(() => host.close());
        await host.send('Hello.', reply('The road.'));
        state.disk = track(host);
        await assert.rejects(mutate(host, native, current => { current.dossiers.tavi.trust = 9; }), error => error.message.includes('simulated crash'));
        const again = await reload(createHost, state.image, [rulesModule(), native.def]);
        t.after(() => again.close());
        assert.equal(again.registry.restore().state, 'idle');
        assert.deepEqual(again.store.problems(), []);
        const entries = again.timeline.host.journal().filter(entry => entry.kind === 'native-mutation');
        if (phase === 'native.journaled') {
            assert.deepEqual(entries.map(entry => entry.phase), ['done'], 'journaled: finished forward');
            assert.equal(native.native.store.dossiers.tavi.trust, 9);
            assert.equal(again.timeline.host.prefix(NATIVE, entries[0].boundary.cursor, entries[0].boundary.prefixHash).selected, 'after');
        } else {
            assert.deepEqual(entries, [], 'nothing durable: the participant\'s checkpoints are just checkpoints');
            assert.equal(native.native.store.dossiers.tavi.trust, 3);
        }
    });
}

test('nativeEvent: a confirmed death reaches the participant once, with a durable ack, behind the barrier', async t => {
    const { host, native } = await started(t);
    const head = await host.sdk.timeline.head();
    const input = { event: 'ev_death001', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash };
    const barriers = [];
    host.sdk.on('modules', ({ changes }) => barriers.push(changes[0].status));
    assert.equal((await host.sdk.timeline.nativeEvent(input)).code, 'REFUSED', 'the host\'s outbox only');
    const first = await host.timeline.host.nativeEvent(input);
    assert.equal(first.ok, true, first.message);
    assert.equal(first.event, 'ev_death001');
    assert.equal(first.ack, true);
    assert.match(first.checkpoint, /^ck_/);
    assert.deepEqual(native.native.store.applied, ['ev_death001']);
    assert.deepEqual(native.native.calls.find(call => call.name === 'applyEvent').input, { event: 'ev_death001', nativeKey: 'tavi', kind: 'confirmed-death' }, 'by native key, found through npc.identity');
    assert.deepEqual(barriers, ['restore-pending', 'ready']);
    assert.equal(host.timeline.host.journal().at(-1).phase, 'done');
    // The same event with the same meaning is answered from the journal, once more.
    const calls = native.native.calls.length;
    assert.deepEqual(await host.timeline.host.nativeEvent({ ...input, expectedHead: (await host.sdk.timeline.head()).headHash }), first);
    assert.equal(native.native.calls.length, calls, 'the participant is not asked again');
    // Another meaning for the same event is a CONFLICT.
    assert.equal((await host.timeline.host.nativeEvent({ ...input, npc: 'np_other001', expectedHead: (await host.sdk.timeline.head()).headHash })).code, 'CONFLICT');
});

test('nativeEvent: unknown native identity holds the death, a stale head is STALE, and only a confirmed death is an event', async t => {
    const { host, native } = await started(t);
    const head = await host.sdk.timeline.head();
    const input = { event: 'ev_death002', participant: NATIVE, kind: 'confirmed-death', npc: 'np_ghost001', expectedHead: head.headHash };
    assert.equal((await host.timeline.host.nativeEvent(input)).code, 'REFUSED', 'unknown dossier: held, never guessed');
    assert.deepEqual(native.native.store.applied, []);
    assert.equal((await host.timeline.host.nativeEvent({ ...input, npc: NPC, expectedHead: 'f'.repeat(64) })).code, 'STALE');
    assert.equal((await host.timeline.host.nativeEvent({ ...input, npc: NPC, kind: 'revived' })).code, 'INVALID');
    assert.equal((await host.timeline.host.nativeEvent({ ...input, npc: 'not an id' })).code, 'INVALID');
    assert.equal((await host.timeline.host.nativeEvent({ ...input, npc: NPC, participant: 'tl-nobody' })).code, 'REFUSED');
    assert.equal((await host.timeline.host.nativeEvent({ ...input, npc: NPC, surprise: 1 })).code, 'INVALID');
    host.registry.setRestore('pending', 'Restoring.');
    assert.equal((await host.timeline.host.nativeEvent({ ...input, npc: NPC })).code, 'RESTORE_PENDING');
    host.registry.setRestore('idle');
    // A participant that cannot apply it leaves the barrier up; recover redelivers it, and the participant answers with its first ack.
    native.native.fail.add('applyEvent');
    const failed = await host.timeline.host.nativeEvent({ ...input, npc: NPC, expectedHead: (await host.sdk.timeline.head()).headHash });
    assert.equal(failed.ok, false);
    assert.equal(host.registry.restore().state, 'pending');
    native.native.fail.clear();
    assert.deepEqual(await host.timeline.host.recover(), { ok: true, state: 'idle', return: null });
    assert.deepEqual(native.native.store.applied, ['ev_death002']);
    assert.equal(host.registry.restore().state, 'idle');
});

test('the prefix map records a restore: after it, the participant\'s selected checkpoint is the one it acknowledged', async t => {
    const { host, native } = await started(t);
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Save' })).snapshot;
    native.native.edit(state => { state.dossiers.tavi.trust = 50; });
    await seal(host, batchFor('br_batch003'));
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: ['ev_death003'], batchResult: batchFor('br_batch003'), expectedHead: head.headHash });
    assert.equal((await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash })).status, 'complete');
    const now = await host.sdk.timeline.head();
    const mapping = host.timeline.host.prefix(NATIVE, now.cursor, now.prefixHash);
    assert.equal(mapping.selected, 'after');
    assert.equal(mapping.after.checkpoint, saved.participants[0].checkpoint);
    assert.equal(mapping.before, null);
    assert.deepEqual((await host.sdk.timeline.status()).participants, [{ module: NATIVE, checkpoint: saved.participants[0].checkpoint, hash: saved.participants[0].hash, schema: 1 }]);
});

test('head() carries the Source of the reply at the head, so a participant can name it in nativeMutation without the host\'s store', async t => {
    const { host, native } = await started(t);
    const head = await native.native.handle.head();
    assert.equal(head.ok, true);
    assert.deepEqual(head.source, host.store.sourceAt(host.store.headIndex()));
    assert.deepEqual(Object.keys(head.source).sort(), ['evidence', 'ordinal', 'sid', 'swipeKey']);
    // The Source it gives is the one nativeMutation accepts.
    const out = await native.native.handle.nativeMutation({
        participant: NATIVE, source: head.source, expectedHead: head.headHash,
        prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            const after = native.native.keep(next);
            native.native.prepared.pr_manual002 = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_manual002' };
        },
    });
    assert.equal(out.ok, true, out.message);
});
