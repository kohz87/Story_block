// E6b review fix 1: a restore's activation binds its checkpoint to the head only if the committed restore still survives in the
// selected head. A swipe, delete or Re-read that takes the restore away while a participant is still activating leaves the
// participants on the checkpoint of the head that is selected now, and the barrier holds until they confirm it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHost } from '../../testkit/index.js';
import { nativeModule, rulesModule, batchFor, clone, pause, reload, seal, NATIVE, DEATH } from './helpers/timeline.js';
import { hashJson } from '../../src/v2/replay.js';
import { HOST_DOMAIN } from '../../src/v2/timeline/index.js';

const BATCH = batchFor('br_batch001');

// A story with a save point, a native change (trust 3 -> 9) after it and a death; the restore is prepared, not activated.
async function setup(t, { alternate = false } = {}) {
    const native = nativeModule();
    const gate = pause(native.def.participant, 'activate');
    const modules = [rulesModule(), native.def];
    const host = await createHost({ modules });
    t.after(() => host.close());
    await host.send('Begin.', 'Start.');
    const point = (await host.sdk.timeline.make({ kind: 'manual' })).snapshot;
    await host.send('Next.', 'Before death.');
    await host.sdk.command('tl.xp', { amount: 5 });   // (a change the restore stands on: deleting this reply turns the restore off)
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
    const last = host.ctx.chat.length - 1;
    if (alternate) {
        await host.swipe('Another ending.');
        await host.st.swipeTo(last, 0);
    }
    await seal(host, BATCH);
    const now = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: point.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: now.headHash });
    assert.equal(prepared.ok, true, prepared.message);
    return { host, native: native.native, gate, modules, last, point, activate: () => host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: now.headHash }) };
}

const returnsOf = host => Object.keys(host.head().domains[HOST_DOMAIN]?.returns ?? {});

for (const action of ['delete', 'swipe', 'delete-earlier']) test(`a restore whose reply is ${action === 'swipe' ? 'swiped away' : action === 'delete' ? 'deleted' : 'cut off by deleting an earlier reply'} while a participant activates is not bound to the new head`, async t => {
    const { host, native, gate, modules, last, activate } = await setup(t, { alternate: action === 'swipe' });
    gate.arm();
    const activation = activate();
    await gate.entered;
    assert.equal(host.registry.restore().state, 'pending');
    if (action === 'delete') await host.st.deleteMessage(last);
    if (action === 'swipe') await host.st.swipeTo(last, 1);
    if (action === 'delete-earlier') await host.st.deleteMessage(4);
    gate.release();
    const done = await activation;
    assert.equal(done.ok, false, 'the restore did not take');
    assert.equal(done.code, 'STALE');
    // the participant follows the head that is selected now: the native change is on the line unless its reply went too
    assert.equal(native.store.dossiers.tavi.trust, action === 'delete-earlier' ? 3 : 9);
    assert.deepEqual(returnsOf(host), []);
    assert.equal(host.registry.restore().state, 'idle');
    assert.equal((await host.timeline.host.recover()).state, 'idle');
    assert.equal((await host.sdk.timeline.status()).state, 'idle');
    assert.equal((await host.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
    assert.equal(host.timeline.host.journal().some(entry => entry.kind === 'restore' && entry.phase === 'retracted'), true);
    assert.equal((await host.sdk.timeline.head()).ok, true);
    // a rebuild and a start again from the chat file agree
    const state = clone(host.head());
    host.store.rebuild();
    assert.deepEqual(clone(host.head()), state);
    const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules);
    t.after(() => fresh.close());
    assert.equal(fresh.registry.restore().state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, action === 'delete-earlier' ? 3 : 9);
    assert.equal((await fresh.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
    assert.deepEqual(returnsOf(fresh), []);
});

test('a restore that survives its activation is published for the head and completes as before', async t => {
    const { host, native, gate, activate } = await setup(t);
    gate.arm();
    const activation = activate();
    await gate.entered;
    // an edit that leaves the restore where it is changes nothing
    gate.release();
    const done = await activation;
    assert.equal(done.status, 'complete');
    assert.equal(native.store.dossiers.tavi.trust, 3);
    assert.equal(returnsOf(host).length, 1);
    assert.equal(host.registry.restore().state, 'idle');
    assert.equal((await host.sdk.timeline.status()).participants[0].hash, hashJson(native.store));
    // swiping the restore away afterwards still goes back to the native change
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal((await host.timeline.host.recover()).state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, 9);
});

test('a restore retracted while its participant acknowledges leaves the barrier up until the selected checkpoint is confirmed', async t => {
    const { host, native, gate, last, activate } = await setup(t);
    gate.arm();
    const activation = activate();
    await gate.entered;
    await host.st.deleteMessage(last);
    // the selected checkpoint cannot be switched to yet: the barrier holds
    native.fail.add('prepare');
    gate.release();
    const done = await activation;
    assert.equal(done.ok, false);
    assert.equal(host.registry.restore().state, 'pending');
    assert.equal((await host.sdk.timeline.head()).code, 'RESTORE_PENDING');
    native.fail.delete('prepare');
    assert.equal((await host.timeline.host.recover()).state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, 9);
    assert.equal(host.registry.restore().state, 'idle');
});

test('a restore is published for a head only after the head is checked to still hold it (one site, same section)', async () => {
    const coordinator = await readFile(new URL('../../src/v2/timeline/coordinator.js', import.meta.url), 'utf8');
    assert.equal((coordinator.match(/\bpublishRestore\(/g) ?? []).length, 2, 'its definition and one call');
    assert.equal((coordinator.match(/function restoreHeld\(/g) ?? []).length, 1);
    const at = coordinator.indexOf('publishRestore(entry);');
    assert.equal(coordinator.slice(coordinator.lastIndexOf('restoreHeld(', at), at).includes('await'), false, 'no wait between the look and the publication');
});
