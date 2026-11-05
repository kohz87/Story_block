// A restore or branch never waits silently forever (docs/v2/TIMELINE.md): a participant's failure to follow the selected head is classified
// (permanent: a Problem at once; transient: tried again on a fixed schedule, then a Problem), and the status and head say why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { nativeModule, rulesModule, clone, NATIVE } from './helpers/timeline.js';
import { RETRY_SCHEDULE_MS } from '../../src/v2/timeline/coordinator-block.js';
import { ensureModules } from '../../src/v2/sdk.js';

// A chat whose selected head needs an older native checkpoint: a native change, then the reply it stood on is deleted.
async function setup(t, { timers = false } = {}) {
    if (timers) t.mock.timers.enable({ apis: ['setTimeout'] });
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def] });
    t.after(() => host.close());
    await host.send('Begin.', 'Start.');
    await host.sdk.timeline.make({ kind: 'manual' });
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
    return { host, native: native.native };
}
const tick = async (t, ms) => { t.mock.timers.tick(ms); for (let i = 0; i < 40; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const problemsOf = host => host.turn.problems(NATIVE);

test('a transient failure is tried again on the schedule and then settles', async t => {
    const { host, native } = await setup(t, { timers: true });
    native.fail.add('prepare');
    await host.st.deleteMessage(4);
    const pending = await host.sdk.timeline.status();
    assert.equal(pending.state, 'pending');
    assert.equal(pending.blockedBy.module, NATIVE);
    assert.equal(pending.blockedBy.code, 'FAILED');
    assert.deepEqual(problemsOf(host), [], 'a transient failure is not told yet');
    await tick(t, RETRY_SCHEDULE_MS[0]);
    assert.equal((await host.sdk.timeline.status()).state, 'pending', 'still failing at the first retry');
    native.fail.delete('prepare');
    await tick(t, RETRY_SCHEDULE_MS[1]);
    assert.equal((await host.sdk.timeline.status()).state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, 3);
    assert.deepEqual(problemsOf(host), []);
    assert.equal(host.registry.restore().state, 'idle');
});

test('a transient failure that never clears becomes a Problem after the schedule, once, and no timer is left', async t => {
    const { host, native } = await setup(t, { timers: true });
    native.fail.add('prepare');
    await host.st.deleteMessage(4);
    for (const ms of RETRY_SCHEDULE_MS) {
        assert.deepEqual(problemsOf(host), []);
        await tick(t, ms);
    }
    const told = problemsOf(host);
    assert.equal(told.length, 1);
    assert.equal(told[0].code, 'FAILED');
    assert.match(told[0].message, /Test native.*still could not load/);
    const calls = native.calls.length;
    await tick(t, 60000);
    assert.equal(native.calls.length, calls, 'nothing is asked after the schedule');
    const status = await host.sdk.timeline.status();
    assert.equal(status.state, 'pending');
    assert.match(status.reason, /Reload the page|delete the changed reply/);
    // a reload-time recovery (ensureModules) does not tell it again
    await ensureModules({ store: host.store, bus: host.bus, registry: host.registry });
    await ensureModules({ store: host.store, bus: host.bus, registry: host.registry });
    assert.equal(problemsOf(host).length, 1);
});

test('a permanent failure is a Problem at once, with no retry', async t => {
    const { host, native } = await setup(t, { timers: true });
    native.missing.add(Object.keys(native.checkpoints)[0]);
    for (const id of Object.keys(native.checkpoints)) native.missing.add(id);
    await host.st.deleteMessage(4);
    const told = problemsOf(host);
    assert.equal(told.length, 1);
    assert.equal(told[0].code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(told[0].message, /Test native cannot restore its saved records for this point \(.*is gone\)/);
    for (let i = 0; i < 3; i += 1) await ensureModules({ store: host.store, bus: host.bus, registry: host.registry });
    assert.equal(problemsOf(host).length, 1, 'opening the chat again and again raises it once');
    assert.equal(problemsOf(host)[0].toast, true);
    const calls = native.calls.length;
    await tick(t, 60000);
    assert.equal(native.calls.length, calls, 'no timer was set');
});

test('status and head carry the reason, the code and who blocks', async t => {
    const { host, native } = await setup(t);
    for (const id of Object.keys(native.checkpoints)) native.missing.add(id);
    await host.st.deleteMessage(4);
    const status = await host.sdk.timeline.status();
    assert.equal(status.state, 'pending');
    assert.equal(status.code, 'SNAPSHOT_UNAVAILABLE');
    assert.deepEqual(status.blockedBy, { module: NATIVE, code: 'SNAPSHOT_UNAVAILABLE' });
    assert.match(status.reason, /Test native cannot restore/);
    const head = await host.sdk.timeline.head();
    assert.equal(head.code, 'RESTORE_PENDING');
    assert.deepEqual(head.blockedBy, { module: NATIVE, code: 'SNAPSHOT_UNAVAILABLE' });
    assert.equal(head.reason, status.reason);
    // what the send-time toast says: the cause and what the reader can do, not a restore that cannot work while pending
    assert.doesNotMatch(host.registry.restore().reason, /restore a save point/);
    assert.match(host.registry.restore().reason, /delete the changed reply/);
});

test('a callback that runs out of time is STALE (retry shortly), not a lost snapshot, and the late call stays quarantined', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const native = nativeModule();
    let late;
    const checkpoint = native.def.participant.checkpoint;
    native.def.participant.checkpoint = input => (late ? checkpoint(input) : new Promise(resolve => { late = () => resolve(checkpoint(input)); }));
    const host = await createHost({ modules: [rulesModule(), native.def] });
    t.after(() => host.close());
    await host.send('Begin.', 'Start.');
    const making = host.sdk.timeline.make({ kind: 'manual' });
    for (let i = 0; i < 40; i += 1) await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(10000);
    for (let i = 0; i < 40; i += 1) await new Promise(resolve => setImmediate(resolve));
    const made = await making;
    assert.equal(made.code, 'STALE');
    assert.match(made.message, /still running/);
    const again = await host.sdk.timeline.make({ kind: 'manual' });
    assert.equal(again.code, 'STALE', 'while the late call runs, a new one is refused as retry shortly');
    late();
    for (let i = 0; i < 40; i += 1) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await host.sdk.timeline.make({ kind: 'manual' })).ok, true, 'once it settles the next call goes through');
});
