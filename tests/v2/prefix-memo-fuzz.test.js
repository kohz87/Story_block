// The prefix memo (store/prefix-memo.js) against the truth. Every state it serves must equal a replay that never saw the memo:
// here a cold host reloaded from the saved chat (nothing memoised) answers the same witnesses, over a fuzz run of send, swipe,
// delete, edit, rewind and Re-read. A guarded chat takes the full replay (no one-record steps), and the memo is cleared by a rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { nativeModule, reload, rulesModule, track } from './helpers/timeline.js';

const cursorsOf = host => host.ctx.chat.flatMap((message, index) => {
    if (message.is_user) return [];
    const source = host.store.sourceAt(index);
    return source ? [{ sid: source.sid, swipeKey: source.swipeKey, op: 0 }] : [];
});
const answers = (host, cursors) => host.store.witnessScope(() => cursors.map(cursor => JSON.stringify(host.store.prefixWitness(cursor))));
const fresh = (host, cursors) => cursors.map(cursor => JSON.stringify(host.store.witnessFresh(cursor)));

test('fuzz: the memo equals the memo-free truth over send, swipe, delete, edit, rewind and Re-read', async t => {
    const native = nativeModule();
    const modules = [rulesModule(), native.def];
    const host = await createHost({ modules });
    t.after(() => host.close());
    const disk = track(host);
    let seed = 137;
    const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    await host.send('Start.', 'The start.');
    let colds = 0;
    for (let step = 0; step < 48; step++) {
        const carriers = host.ctx.chat.map((m, i) => (m.is_user ? -1 : i)).filter(i => i >= 0);
        const pick = random(8);
        if (pick <= 1) await host.send(`Go ${step}.`, `Reply ${step}.\n\n<Changes>\n+ coin ${1 + (step % 3)}\n</Changes>`);
        else if (pick === 2) await host.swipe(`Alternative ${step}.`);
        else if (pick === 3 && host.ctx.chat.length > 4) await host.st.deleteMessage(1 + random(host.ctx.chat.length - 2));
        else if (pick === 4) { const at = carriers[random(carriers.length)]; await host.st.editMessage(at, `${host.ctx.chat[at].mes} (edited)`); }
        else if (pick === 5) {
            const entry = host.sdk.receipts().find(each => each.receipt.rev !== undefined);
            if (entry) await host.sdk.rewind({ index: entry.index, beforeRev: entry.receipt.rev });
        } else if (pick === 6) await host.turn.reread(carriers[random(carriers.length)]);
        const cursors = cursorsOf(host);
        const warm = answers(host, cursors);
        assert.deepEqual(answers(host, cursors), warm, `step ${step}: asking twice gives the same`);
        assert.deepEqual(warm, fresh(host, cursors), `step ${step}: the scoped memo equals witnessFresh`);
        if (step % 6 === 5) {
            const cold = await reload(createHost, disk.image, modules);
            t.after(() => cold.close());
            assert.deepEqual(answers(cold, cursorsOf(cold)), warm, `step ${step}: a cold host with no memo answers the same`);
            colds++;
        }
    }
    const work = host.store.work();
    assert.ok(colds >= 7);
    assert.ok(work.prefixHits > 0 && work.prefixSteps > 0, `the run used the memo (${work.prefixHits} hits, ${work.prefixSteps} steps)`);
});

test('a new reply replays at most one carrier once the older prefixes are known', async t => {
    const host = await createHost({ modules: [rulesModule(), nativeModule().def] });
    t.after(() => host.close());
    for (let i = 0; i < 12; i++) await host.send(`Hello ${i}.`, `Reply ${i}.`);
    answers(host, cursorsOf(host));
    const before = host.store.work();
    await host.send('More.', 'Another reply.');
    answers(host, cursorsOf(host));
    const spent = host.store.work();
    assert.ok(spent.prefixReplays - before.prefixReplays <= 1, 'at most one full replay for the new prefix');
    assert.ok(spent.prefixHits - before.prefixHits >= 10, 'the older prefixes were found');
});

test('a guarded chat takes the full replay and still answers like a cold host', async t => {
    const owner = {
        id: 'pm-owner', name: 'Guard owner', version: '1.0.0',
        domains: { pms: { initial: () => ({}) } },
        capture: { kinds: { pmg: { grammar: '! pmg <name>' } }, apply: ctx => {
            ctx.draft('pms').one = ctx.source;
            ctx.replayGuard({ owner: 'pm-owner', version: 2, epoch: 'ep_00000000', rulesHash: null, inputHash: ctx.hash({ one: 1 }), predicate: { kind: 'one' } });
            return { summary: 'Recorded.', narrate: false };
        } },
        hooks: { replayGuard: () => ({ ok: true }) },
    };
    const modules = [rulesModule(), nativeModule().def, owner];
    const host = await createHost({ modules });
    t.after(() => host.close());
    const disk = track(host);
    await host.send('One.', 'A guarded reply.\n\n<Changes>\n! pmg one\n</Changes>');
    for (let i = 0; i < 4; i++) await host.send(`Hello ${i}.`, `Reply ${i}.`);
    const steps = host.store.work().prefixSteps;
    const warm = answers(host, cursorsOf(host));
    assert.equal(host.store.work().prefixSteps, steps, 'no one-record step in a window with a guarded block');
    const cold = await reload(createHost, disk.image, modules);
    t.after(() => cold.close());
    assert.deepEqual(answers(cold, cursorsOf(cold)), warm);
});

test('a rebuild clears the prefix memo and the answers stay the same', async t => {
    const host = await createHost({ modules: [rulesModule(), nativeModule().def] });
    t.after(() => host.close());
    for (let i = 0; i < 6; i++) await host.send(`Hello ${i}.`, `Reply ${i}.`);
    const cursors = cursorsOf(host);
    const warm = answers(host, cursors);
    host.store.rebuild();
    const replays = host.store.work().prefixReplays;
    assert.deepEqual(answers(host, cursors), warm);
    assert.ok(host.store.work().prefixReplays > replays, 'the cleared memo replayed again');
});
