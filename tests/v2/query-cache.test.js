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

// ---- one generation for the whole chat (store.js witnessGeneration) ----------------------------------------------------------

// The cursors of op 0 of every carrier: what a timeline with a boundary at each reply asks, without the native changes.
const cursorsOf = host => host.ctx.chat.flatMap((message, index) => {
    if (message.is_user) return [];
    const source = host.store.sourceAt(index);
    return source ? [{ sid: source.sid, swipeKey: source.swipeKey, op: 0 }] : [];
});
// → { misses, found } for one walk over `cursors` (what selectionPlan does on each query).
const walk = (host, cursors) => {
    const before = host.store.work().witnessMisses;
    let found = 0;
    for (const cursor of cursors) if (host.store.prefixWitness(cursor)) found++;
    return { misses: host.store.work().witnessMisses - before, found };
};
const plain = async (t, replies, modules = [rulesModule(), nativeModule().def, featureModule()]) => {
    const host = await createHost({ modules });
    t.after(() => host.close());
    for (let i = 0; i < replies; i++) await host.send(`Hello ${i}.`, `Reply ${i}.`);
    return host;
};

test('more boundaries than the old cap of 256: the second walk works out no witness', async t => {
    const host = await plain(t, 300);
    const cursors = cursorsOf(host);
    assert.ok(cursors.length > 256);
    assert.deepEqual(walk(host, cursors), { misses: cursors.length, found: cursors.length });
    assert.deepEqual(walk(host, cursors), { misses: 0, found: cursors.length });
    assert.deepEqual(walk(host, cursors), { misses: 0, found: cursors.length });
    assert.equal(host.store.witnessMemoSize(), cursors.length, 'every boundary is kept, one answer each');
});

test('when the chat changes the whole old generation is dropped, not kept beside the new one', async t => {
    const host = await plain(t, 8);
    const cursors = cursorsOf(host);
    walk(host, cursors);
    assert.equal(host.store.witnessMemoSize(), cursors.length);
    host.ctx.chat[1].mes = 'Edited.';
    walk(host, cursors.slice(0, 2));
    assert.equal(host.store.witnessMemoSize(), 2, 'the old answers are gone');
});

// Changes the store is not told about (no write, no epoch): the fingerprint alone must see them.
for (const [name, change] of [
    ['an in-place swipe_id flip', host => { host.ctx.chat.at(-1).swipe_id = 0; }],
    ['a swipe_info array replaced', host => { const message = host.ctx.chat.at(-1); message.swipe_info = [...message.swipe_info]; }],
    ['a swipe_info copy\'s record replaced', host => { const message = host.ctx.chat.at(-1); message.swipe_info = message.swipe_info.map(info => ({ ...info, extra: { ...info.extra } })); }],
    ['the chat metadata replaced', host => { host.ctx.chatMetadata = { ...host.ctx.chatMetadata }; }],
    ['a reply\'s text changed in place', host => { host.ctx.chat.at(-1).mes = 'Changed.'; }],
]) test(`${name}, with no write, makes every witness miss`, async t => {
    const host = await plain(t, 5);
    await host.swipe('A second swipe.');
    const cursors = cursorsOf(host);
    walk(host, cursors);
    assert.equal(walk(host, cursors).misses, 0);
    change(host);
    assert.equal(walk(host, cursors).misses, cursors.length);
    assert.equal(walk(host, cursors).misses, 0);
});

test('a guard mark change (a module held back), with no write, makes every witness miss', async t => {
    const owner = {
        id: 'qc-owner', name: 'Guard owner', version: '1.0.0',
        domains: { qcs: { initial: () => ({}) } },
        capture: { kinds: { qcg: { grammar: '! qcg <name>' } }, apply: ctx => {
            ctx.draft('qcs').one = ctx.source;
            ctx.replayGuard({ owner: 'qc-owner', version: 2, epoch: 'ep_00000000', rulesHash: null, inputHash: ctx.hash({ one: 1 }), predicate: { kind: 'one' } });
            return { summary: 'Recorded.', narrate: false };
        } },
        hooks: { replayGuard: () => ({ ok: true }) },
    };
    const host = await plain(t, 3, [rulesModule(), nativeModule().def, owner]);
    await host.send('Guarded.', 'A guarded reply.\n\n<Changes>\n! qcg one\n</Changes>');
    const cursors = cursorsOf(host);
    walk(host, cursors);
    assert.equal(walk(host, cursors).misses, 0);
    let told = 0;
    const lifecycle = host.store.lifecycleChanged;
    host.store.lifecycleChanged = (...args) => { told++; return lifecycle.apply(host.store, args); };
    host.registry.setRestore('pending', 'A restore.');
    const during = walk(host, cursors);
    host.registry.setRestore('idle', '');
    assert.equal(during.misses, cursors.length, 'the owner is held back: the guards answer differently');
    assert.equal(told, 0, 'the mark alone made it miss, not a lifecycle call');
    host.store.lifecycleChanged = lifecycle;
});

// ---- the memo against a fresh replay, over a fuzz run ---------------------------------------------------------------

test('fuzz: every witness the memo answers equals the witness worked out afresh', async t => {
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def, featureModule()] });
    t.after(() => host.close());
    let seed = 20260611;
    const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const compared = { hits: 0, misses: 0 };
    const original = host.store.prefixWitness.bind(host.store);
    host.store.prefixWitness = cursor => {
        const before = host.store.work().witnessMisses;
        const answer = original(cursor);
        if (host.store.work().witnessMisses === before) compared.hits++; else compared.misses++;
        assert.equal(JSON.stringify(answer), JSON.stringify(host.store.witnessFresh(cursor)), 'the memo answers what a fresh replay answers');
        return answer;
    };
    const mutate = async n => {
        const head = await host.sdk.timeline.head();
        await native.native.handle.nativeMutation({
            participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head.headHash,
            prepare: async () => {
                const before = native.native.checkpoint();
                const next = clone(native.native.store);
                next.dossiers.tavi.trust = 10 + (n % 80);
                const after = native.native.keep(next);
                native.native.prepared[`pr_fz${n}`] = { checkpoint: after.checkpoint };
                return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: `pr_fz${n}` };
            },
        });
    };
    await host.send('Start.', 'The start.');
    for (let step = 0; step < 60; step++) {
        const pick = random(8);
        const carriers = host.ctx.chat.map((m, i) => (m.is_user ? -1 : i)).filter(i => i >= 0);
        if (pick === 0) await host.send(`Go ${step}.`, `Reply ${step}.`);
        else if (pick === 1) await mutate(step);
        else if (pick === 2) await host.swipe(`Alternative ${step}.`);
        else if (pick === 3 && host.ctx.chat.length > 4) await host.st.deleteMessage(1 + random(host.ctx.chat.length - 2));
        else if (pick === 4) { const at = carriers[random(carriers.length)]; await host.st.editMessage(at, `${host.ctx.chat[at].mes} (edited)`); }
        else if (pick === 5) await host.sdk.command('savepoint.make', { name: `P${step}` });
        // (picks 6 and 7: nothing changes, the memo is asked again)
        host.sdk.query('savepoint.contract');
        for (const cursor of cursorsOf(host)) host.store.prefixWitness(cursor);
        host.sdk.query('savepoint.contract');
    }
    assert.ok(compared.hits > 100 && compared.misses > 20, `the run reached both paths (${compared.hits} hits, ${compared.misses} misses)`);
});

test('inside witnessScope the memo is checked once, and a rebuild inside it still forgets the answers', async t => {
    const host = await plain(t, 6);
    const cursors = cursorsOf(host);
    const outside = cursors.map(cursor => JSON.stringify(host.store.prefixWitness(cursor)));
    const inside = host.store.witnessScope(() => cursors.map(cursor => JSON.stringify(host.store.prefixWitness(cursor))));
    assert.deepEqual(inside, outside);
    host.store.witnessScope(() => {
        assert.equal(walk(host, cursors).misses, 0);
        host.store.rebuild();   // (a write or lifecycle change moves the epoch)
        assert.equal(walk(host, cursors).misses, cursors.length);
        assert.equal(walk(host, cursors).misses, 0);
    });
    assert.equal(host.store.witnessScope(() => 7), 7, 'the read\'s answer is handed back');
});
