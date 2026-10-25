import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { nativeModule, rulesModule, restore, clone, reload, NATIVE } from './helpers/timeline.js';
import { hashJson } from '../../src/v2/replay.js';
import { createParticipants } from '../../src/v2/timeline/participants.js';

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
    assert.equal((await call).code, 'FAILED');
    assert.equal((await participants.call(NATIVE, 'status', {})).code, 'FAILED');
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
    const coordinator = await readFile(new URL('../../src/v2/timeline/coordinator.js', import.meta.url), 'utf8');
    const participants = await readFile(new URL('../../src/v2/timeline/participants.js', import.meta.url), 'utf8');
    assert.equal((coordinator.match(/function selectionPlan\(/g) ?? []).length, 1);
    assert.equal((coordinator.match(/await store\.flush\(/g) ?? []).length, 1);
    assert.equal((participants.match(/timer = setTimeout\(/g) ?? []).length, 1);
    assert.equal(coordinator.includes('archive.prefixes(module).at(-1)'), false);
});
