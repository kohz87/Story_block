// The timeline's witness of each archived boundary (store.prefixWitness) is asked on every sdk.query (settle → selectionPlan), and
// each answer replays a prefix and hashes it. It is kept while nothing it reads has changed (store.js witnessMemo): these tests
// count replays (store.work()) over a burst of queries, and check that every kind of change forgets the memo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { NATIVE, clone, nativeModule, reload, rulesModule, track } from './helpers/timeline.js';

const featureModule = () => ({ id: 'qc-feat', name: 'Query cache feature', version: '1.0.0', features: [{ id: 'qc-feat.x', label: 'X', describe: 'A switch.', default: true }] });

async function started(t, replies = 4) {
    const native = nativeModule();
    const modules = [rulesModule(), native.def, featureModule()];
    const host = await createHost({ modules });
    t.after(() => host.close());
    const disk = track(host);
    for (let i = 0; i < replies; i++) await host.send(`Hello ${i}.`, `Reply ${i}.`);
    const head = await host.sdk.timeline.head();
    const made = await native.native.handle.nativeMutation({
        participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head.headHash,
        prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = 9;
            const after = native.native.keep(next);
            native.native.prepared.pr_cache001 = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_cache001' };
        },
    });
    assert.equal(made.ok, true);
    return { host, native, modules, disk };
}

// The timeline witnesses a burst of queries works out (memo misses; a hit costs no replay).
const burst = (host, n = 10) => {
    const before = host.store.work().witnessMisses;
    for (let i = 0; i < n; i++) host.sdk.query('savepoint.contract');
    return host.store.work().witnessMisses - before;
};
// What an action and the burst after it work out: the action's own queries may already have asked.
const after = async (host, action) => {
    const before = host.store.work().witnessMisses;
    await action();
    burst(host);
    return host.store.work().witnessMisses - before;
};

test('a burst of queries on an unchanged chat replays once, and none when nothing changed since', async t => {
    const { host } = await started(t);
    assert.equal(burst(host, 50) <= 1, true);
    assert.equal(burst(host, 50), 0);
});

test('a repeated query answers the same and works out no witness', async t => {
    const { host } = await started(t);
    const first = host.sdk.query('savepoint.contract');
    const second = host.sdk.query('savepoint.contract');
    assert.deepEqual(second, first);
    assert.notEqual(second, first, 'each caller gets its own copy');
    assert.equal(burst(host, 1), 0);
});

test('a new reply makes the next query replay again', async t => {
    const { host } = await started(t);
    burst(host);
    assert.ok(await after(host, () => host.send('More.', 'Another reply.')) >= 1);
    assert.equal(burst(host), 0);
});

test('a swipe makes the next query replay again', async t => {
    const { host } = await started(t);
    burst(host);
    assert.ok(await after(host, () => host.swipe('A different reply.')) >= 1);
    assert.equal(burst(host), 0);
});

test('a middle delete makes the next query replay again', async t => {
    const { host } = await started(t);
    burst(host);
    assert.ok(await after(host, () => host.st.deleteMessage(2)) >= 1);
    assert.equal(burst(host), 0);
});

test('an edit of a reply\'s text makes the next query replay again', async t => {
    const { host } = await started(t);
    burst(host);
    assert.ok(await after(host, () => { host.ctx.chat[1].mes = 'Edited reply.'; }) >= 1);
    assert.equal(burst(host), 0);
});

test('a save point (a write) makes the next query replay again', async t => {
    const { host } = await started(t);
    burst(host);
    assert.ok(await after(host, async () => assert.equal((await host.sdk.command('savepoint.make', { name: 'Camp' })).ok, true)) >= 1);
    assert.equal(burst(host), 0);
});

test('a rewind makes the next query replay again', async t => {
    const { host } = await started(t);
    await host.send('Loot.', 'Coins.\n\n<Changes>\n+ coin 1\n</Changes>');
    burst(host);
    const entry = host.sdk.receipts().find(each => each.receipt.type === 'capture.coin' || each.receipt.rev !== undefined);
    assert.ok(entry, 'the reply stored a receipt');
    assert.ok(await after(host, async () => {
        const done = await host.sdk.rewind({ index: entry.index, beforeRev: entry.receipt.rev });
        assert.equal(done.ok, true, done.message);
    }) >= 1);
    assert.equal(burst(host), 0);
});

test('a reloaded chat starts with no memo', async t => {
    const { host, modules, disk } = await started(t);
    burst(host);
    const again = await reload(createHost, disk.image, modules);
    t.after(() => again.close());
    assert.ok(again.store.work().witnessMisses >= 1, 'the new store works its witnesses out itself');
    assert.equal(burst(again), 0);
});

test('another chat opened in the same store makes the next query replay again', async t => {
    const { host } = await started(t);
    burst(host);
    assert.ok(await after(host, () => host.st.loadChat(clone(host.ctx.chat), 'chat-2')) >= 1);
    assert.equal(burst(host), 0);
});

test('a Feature switched makes the next query replay again; a setting does not change what a replay reads', async t => {
    const { host } = await started(t);
    burst(host);
    assert.equal(await after(host, () => host.settings.set('story-block', 'chatterInPrompt', true)), 0, 'a replay never reads settings');
    assert.ok(await after(host, () => host.features.set('qc-feat.x', false)) >= 1);
    assert.equal(burst(host), 0);
});

test('the memo does not change a witness: what it answers is what a fresh replay answers', async t => {
    const { host, modules, disk } = await started(t);
    burst(host);
    const status = clone(await host.sdk.timeline.status());
    const again = await reload(createHost, disk.image, modules);
    t.after(() => again.close());
    assert.deepEqual(clone(await again.sdk.timeline.status()).participants, status.participants);
    assert.deepEqual(again.sdk.query('savepoint.contract'), host.sdk.query('savepoint.contract'));
});
