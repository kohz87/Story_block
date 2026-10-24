// A crash at each phase of a save point and of a restore leaves no half-applied state on reload (contract §8, §10 E;
// docs/v2/TIMELINE.md). The process "dies" at a phase: the fault hook takes what the last save wrote (the chat file, its
// metadata) and throws a crash the timeline rethrows from everywhere. A new host is then started over that file, the
// way a page reload is, and the participant's own storage (it is a module with a store of its own) is what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { crash } from '../../src/v2/timeline/index.js';
import { BATCH, DEATH, clone, nativeModule, reload, rulesModule, slice, track } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const cmd = async (host, type, payload = {}) => assert.equal((await host.sdk.command(type, payload)).ok, true, type);

// The story up to a save, and then on to a dead timeline; `crashAt` is the phase the process dies in.
async function dies(t, crashAt) {
    const native = nativeModule();
    const state = { disk: null, crashed: false };
    const hook = { at: async phase => { if (phase === crashAt) { state.crashed = true; state.image = clone(state.disk.image); throw crash(); } } };
    const host = await createHost({ modules: [rulesModule(), native.def], timelineFaults: hook });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ coin 30']));
    await cmd(host, 'tl.xp', { amount: 40 });
    await cmd(host, 'tl.time', { minutes: 600 });
    state.disk = track(host);
    return { host, native, state, hook, modules: () => [rulesModule(), native.def] };
}

const restored = (host, native, saved) => ({
    story: host.head().domains.savepoints?.returns && Object.keys(host.head().domains.savepoints.returns).length,
    xp: host.head().domains.progress.xp,
    native: native.native.store.dossiers.tavi.trust,
    active: native.native.active === saved.participants[0].checkpoint,
});

// Every phase of a save point, as the timeline names them.
const MAKE_PHASES = ['make.reserved', 'make.checkpoint:tl-native', 'make.checkpointed', 'make.archived', 'make.committed'];

for (const phase of MAKE_PHASES) {
    test(`crash at ${phase} while a save point is made: on reload the point is whole or not there at all`, async t => {
        const { host, state, modules } = await dies(t, phase);
        await assert.rejects(host.sdk.command('savepoint.make', { name: 'Doomed' }), error => error.message.includes('simulated crash'));
        assert.equal(state.crashed, true);
        const again = await reload(createHost, state.image, modules());
        t.after(() => again.close());
        // Recovery ran when the chat opened: nothing is left in flight, no barrier, no problem.
        assert.equal(again.registry.restore().state, 'idle');
        assert.deepEqual(await again.sdk.timeline.status(), { ok: true, state: 'idle', return: null, participants: [] });
        assert.deepEqual(again.store.problems(), []);
        const points = (await again.sdk.timeline.list()).points;
        assert.equal(points.length <= 1, true);
        for (const point of points) {
            assert.equal(point.available, true, 'a point that is there has its bytes');
            assert.equal(again.ctx.chatMetadata.storySuite.timeline.snapshots[point.id].descriptor.payloadHash, point.payloadHash);
        }
        // No entry is left half way, and the journal says what became of the attempt.
        const entries = again.timeline.host.journal();
        assert.equal(entries.every(entry => ['committed', 'discarded', 'aborted'].includes(entry.phase)), true, JSON.stringify(entries.map(entry => entry.phase)));
        if (!points.length) assert.equal(again.head().domains.savepoints, undefined, 'nothing of the save is in the story');
        // The story and the archive agree, and a save can be made now.
        const made = await again.sdk.timeline.make({ kind: 'manual', name: 'After the crash' });
        assert.equal(made.ok, true, made.message);
        assert.equal(Object.keys(again.head().domains.savepoints.points).length, points.length + 1);
    });
}

// Every phase of a restore.
const RESTORE_PHASES = [
    'prepare.journaled', 'prepare.participant:tl-native', 'prepare.prepared',
    'activate.checked', 'activate.committed',
    'activate.participant:tl-native:before', 'activate.participant:tl-native:acked', 'activate.acked', 'activate.completed',
];
// Whether the story shows the restore on reload, by the last phase that reached the chat file.
const COMMITTED = new Set(['activate.committed', 'activate.participant:tl-native:before', 'activate.participant:tl-native:acked', 'activate.acked', 'activate.completed']);

for (const phase of RESTORE_PHASES) {
    test(`crash at ${phase} during a restore: on reload it is finished or never was, never half`, async t => {
        const { host, native, state, hook, modules } = await dies(t, 'never');
        const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Before the cave' })).snapshot;
        state.disk = track(host);
        await cmd(host, 'tl.xp', { amount: 100 });
        await cmd(host, 'tl.hurt', { amount: 15 });
        native.native.edit(s => { s.dossiers.tavi.trust = 99; });
        const dead = slice(host.head());
        hook.at = async at => { if (at === phase) { state.crashed = true; state.image = clone(state.disk.image); throw crash(); } };
        const head = await host.sdk.timeline.head();
        await assert.rejects(async () => {
            const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
            if (!prepared.ok) throw new Error(`prepare failed: ${prepared.message}`);
            await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
        }, error => error.message.includes('simulated crash'));
        assert.equal(state.crashed, true);
        const again = await reload(createHost, state.image, modules());
        t.after(() => again.close());
        const now = restored(again, native, saved);
        // After recovery the barrier is down, nothing is in flight, nothing is reported.
        assert.equal(again.registry.restore().state, 'idle');
        assert.deepEqual(await again.sdk.timeline.status(), { ok: true, state: 'idle', return: null, participants: now.story ? [{ module: 'tl-native', checkpoint: saved.participants[0].checkpoint, hash: saved.participants[0].hash, schema: 1 }] : [] });
        assert.deepEqual(again.store.problems(), []);
        assert.equal(again.sdk.modules().every(module => module.status === 'ready'), true);
        const entries = again.timeline.host.journal().filter(entry => entry.kind === 'restore');
        if (COMMITTED.has(phase)) {
            // Committed in the chat file: finished forward, the story and the participant agree on the save.
            assert.equal(now.story, 1, 'the restore is in the story');
            assert.equal(now.xp, 40);
            assert.equal(now.native, 3, 'the participant switched to the saved checkpoint');
            assert.equal(now.active, true);
            assert.deepEqual(entries.map(entry => entry.phase), ['complete']);
            assert.equal(again.head().domains.savepoints.returns[entries[0].return].status, 'complete');
            assert.deepEqual(again.head().domains.party.pools, { hp: 20, mp: 5, sp: 10 });
        } else {
            // Not committed: the old consistent head, the participant on the dead timeline, the preparation aborted.
            assert.equal(now.story, 0, 'no return');
            assert.deepEqual(slice(again.head()), dead);
            assert.equal(now.native, 99, 'the participant still shows the dead timeline');
            assert.equal(entries.every(entry => entry.phase === 'aborted'), true, JSON.stringify(entries.map(entry => entry.phase)));
            // And the restore can be done now, from scratch.
            const fresh = await again.sdk.timeline.head();
            const prepared = await again.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: fresh.headHash });
            assert.equal(prepared.ok, true, prepared.message);
            const done = await again.timeline.host.activate({ prepared: prepared.prepared, expectedHead: fresh.headHash });
            assert.equal(done.status, 'complete');
            assert.equal(again.head().domains.progress.xp, 40);
            assert.equal(native.native.store.dossiers.tavi.trust, 3);
        }
        // Either way the reloaded story replays the same as its own rebuild.
        const seen = clone(again.head());
        again.store.rebuild();
        assert.deepEqual(clone(again.head()), seen);
    });
}

test('a restore whose participants were pending when the process died is finished on reload, by the journal and not by a choice', async t => {
    const { host, native, state, modules } = await dies(t, 'never');
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Before the cave' })).snapshot;
    state.disk = track(host);
    await cmd(host, 'tl.xp', { amount: 100 });
    native.native.edit(s => { s.dossiers.tavi.trust = 99; });
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    native.native.fail.add('activate');
    const pending = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.equal(pending.status, 'participants-pending');
    native.native.fail.clear();
    // The page is closed with the barrier up; the next one opens the chat.
    const again = await reload(createHost, state.disk.image, modules());
    t.after(() => again.close());
    assert.equal(again.registry.restore().state, 'idle', 'recovery ran and finished it');
    assert.equal(again.head().domains.progress.xp, 40);
    assert.equal(native.native.store.dossiers.tavi.trust, 3);
    assert.equal(again.head().domains.savepoints.returns[prepared.return].status, 'complete');
    // It did not reselect anything: the same save, the same return.
    assert.deepEqual(Object.keys(again.head().domains.savepoints.returns), [prepared.return]);
    assert.equal(again.head().domains.savepoints.returns[prepared.return].snapshot, saved.id);
});

test('the barrier is up from the moment a restore is committed until every part has agreed, even across a reload', async t => {
    const { host, native, state, modules } = await dies(t, 'never');
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Before the cave' })).snapshot;
    state.disk = track(host);
    await cmd(host, 'tl.xp', { amount: 100 });
    const head = await host.sdk.timeline.head();
    const seen = [];
    host.sdk.on('modules', ({ changes }) => seen.push(changes.map(change => change.status)));
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    native.native.fail.add('activate');
    await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.deepEqual(seen.at(0), ['restore-pending', 'restore-pending', 'restore-pending']);
    const pendingImage = clone(state.disk.image);
    native.native.fail.clear();
    await host.timeline.host.recover();
    assert.deepEqual(seen.at(-1), ['ready', 'ready', 'ready']);
    // A reload that finds the journal committed and the participant still unable keeps the barrier up.
    const second = await createHost({ modules: modules(), st: { chat: clone(pendingImage.chat) } });
    t.after(() => second.close());
    native.native.fail.add('activate');
    native.native.store = { dossiers: { tavi: { trust: 99 } }, applied: [] };
    native.native.status = {};
    native.native.active = null;
    second.ctx.chatMetadata = clone(pendingImage.metadata);
    await second.turn.onChatChanged();
    assert.equal(second.registry.restore().state, 'pending');
    assert.equal((await second.sdk.timeline.head()).code, 'RESTORE_PENDING');
    assert.equal((await second.sdk.command('tl.xp', { amount: 1 })).code, 'RESTORE_PENDING');
    native.native.fail.clear();
    await second.turn.onChatChanged();
    assert.equal(second.registry.restore().state, 'idle');
    assert.equal((await second.sdk.command('tl.xp', { amount: 1 })).ok, true);
});
