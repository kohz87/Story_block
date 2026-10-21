// A short run of the v2 storage benchmark (docs/v2/PERFORMANCE.md), so the harness keeps working and
// its invariants hold: the full one is `node scripts/bench-v2.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { readRecord } from '../../../src/v2/persist.js';
import {
    PARTY_SIZE, STACKS, THREADS, UI_COMMANDS, UI_EVERY,
    breakdown, changeLines, compactCarrierOps, compactOps, measureLoad, measureSwipe, relayout, runScenario, sameHead,
    singleCopy, stripOldReceipts, v1Size,
} from './load.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const REPLIES = 24;

const shape = head => ({
    stacks: Object.keys(head.domains.inventory.stacks).length,
    actors: Object.keys(head.domains.party.actors).length,
    threads: Object.keys(head.domains.director.threads).length,
    minutes: head.domains.director.time.minutes,
    hp: Object.values(head.domains.party.actors).map(actor => actor.hp.cur),
    coin: head.domains.inventory.wallets.party.coin,
});

test('the bench run keeps the load it describes, one capture save per reply and a checkpoint every 20', { skip }, async () => {
    const run = await runScenario({ replies: REPLIES, repeat: 1, fast: false });
    assert.deepEqual(run.problems, []);
    const [snapshot] = run.snapshots;
    const head = shape(snapshot.head);
    assert.equal(head.stacks, STACKS);
    assert.equal(head.actors, PARTY_SIZE);
    assert.equal(head.threads, THREADS);
    assert.equal(head.minutes, 8 * 60 + 20 * REPLIES);
    assert.equal(changeLines(1).length, 5);

    const rounds = Math.floor((REPLIES - 1) / UI_EVERY);
    assert.equal(run.saves.capture, REPLIES, 'the after-reply capture saves once');
    assert.equal(run.saves.pre, rounds, 'a burst of UI clicks is saved once, when the next generation starts');
    assert.equal(snapshot.savesPerReply.max, 2);

    // The greeting holds the initial state; the next comes once 32 KB of ops have passed (the party's
    // set-up is most of it, and counts carry the value they replaced), then every 20 carriers after it.
    // Where 32 KB falls moves with the size of the ops, so the count is worked out from where it fell.
    const carrier = index => !run.chat[index].is_user;
    const placed = run.chat.map((message, index) => (carrier(index) && readRecord(message)?.checkpoint ? index : -1)).filter(index => index >= 0);
    const carriersBetween = (from, to) => run.chat.slice(from + 1, to + 1).filter(message => !message.is_user).length;
    assert.equal(placed[0], 0);
    assert.ok(placed.length >= 2 && carriersBetween(placed[0], placed[1]) < 20, 'the 32 KB checkpoint comes before 20 carriers');
    for (let n = 2; n < placed.length; n++) assert.equal(carriersBetween(placed[n - 1], placed[n]), 20);
    assert.equal(placed.length, 2 + Math.floor(carriersBetween(placed[1], run.chat.length - 1) / 20));
    assert.equal(snapshot.checkpoints.count, placed.length);
    const bytes = breakdown(run.chat);
    assert.equal(bytes.carriers, REPLIES + 1);
    assert.equal(bytes.records, bytes.checkpoint + bytes.ops + bytes.receipts + bytes.other);
    assert.equal(bytes.shown * 2, bytes.records, 'each record is stored twice: message.extra and the shown swipe');
    assert.ok(bytes.changeText > 0);
    assert.ok(snapshot.v1.perReply > 5800 && snapshot.v1.perReply < 6400, 'v1: about 3 KB in mes and again in the swipe');
    assert.equal(snapshot.swipe.sameAsBefore, true, 'a swipe of the last reply takes its changes back, swiping back restores them');
    assert.ok(snapshot.load.headBytes > 20000);
    assert.equal(run.host.store.dirty(), false);
});

test('the fast driver stores what the fake SillyTavern\'s own send does', { skip }, async () => {
    const slow = await runScenario({ replies: 9, repeat: 1, fast: false });
    const fast = await runScenario({ replies: 9, repeat: 1, fast: true });
    assert.deepEqual(shape(fast.snapshots[0].head), shape(slow.snapshots[0].head));
    assert.deepEqual(fast.saves, slow.saves);
    const count = chat => breakdown(chat).checkpoints.length;
    assert.equal(count(fast.chat), count(slow.chat));
});

test('the tuning variants keep the head: checkpoints moved, ops compacted, old receipts trimmed, one copy', { skip }, async () => {
    const { chat } = await runScenario({ replies: 30, repeat: 1 });
    for (const [every, bytes] of [[5, 32 * 1024], [50, 128 * 1024], [20, 2 * 1024]]) {
        const laid = relayout(chat, { every, bytes });
        assert.ok(sameHead(chat, laid), `checkpoint every ${every} / ${bytes} bytes`);
        assert.equal(measureSwipe(laid, { repeat: 1 }).sameAsBefore, true);
    }
    assert.equal(breakdown(relayout(chat, { every: 5 })).checkpoints.length, 7);
    const compacted = compactOps(chat);
    assert.ok(sameHead(chat, compacted));
    assert.ok(breakdown(compacted).ops < breakdown(chat).ops);
    assert.ok(sameHead(chat, stripOldReceipts(chat, { keep: 5, summaries: true })));
    const once = singleCopy(chat);
    assert.ok(sameHead(chat, once));
    assert.ok(breakdown(once).records < breakdown(chat).records * 0.6);
    assert.ok(measureLoad(once, { repeat: 1 }).rebuildMs.median >= 0);
    assert.ok(v1Size(chat).file > 0);
});

test('op compaction keeps the last write of each path and one meta.rev', () => {
    const ops = [
        { op: 'replace', path: '/domains/party/actors/ac_00000001/hp/cur', value: 50 },
        { op: 'replace', path: '/meta/rev', value: 2 },
        { op: 'add', path: '/domains/inventory/stacks/it_00000001', value: { qty: 1 } },
        { op: 'replace', path: '/domains/party/actors/ac_00000001/hp/cur', value: 44 },
        { op: 'replace', path: '/meta/rev', value: 3 },
    ];
    assert.deepEqual(compactCarrierOps(ops), [ops[2], ops[3], ops[4]]);
    assert.equal(UI_COMMANDS, 3);
});
