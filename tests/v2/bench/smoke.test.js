// A short run of the v2 storage benchmark (docs/v2/PERFORMANCE.md), so the harness keeps working and
// its invariants hold: the full one is `node scripts/bench-v2.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { KEY, readRecord } from '../../../src/v2/persist.js';
import { CHECKPOINT_BYTES, CHECKPOINT_EVERY } from '../../../src/v2/store.js';
import {
    PARTY_SIZE, STACKS, THREADS, UI_COMMANDS, UI_EVERY,
    breakdown, changeLines, compactCarrierOps, compactOps, everyCopy, measureLoad, measureSwipe, relayout, runScenario, sameHead,
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

test('the bench run keeps the load it describes, one capture save per reply, the checkpoint rule, one copy', { skip }, async () => {
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

    // The greeting holds the initial state; a later carrier gets one when CHECKPOINT_EVERY carriers have
    // passed since the last, or the ops since then (the last checkpoint's carrier's own included) exceed
    // CHECKPOINT_BYTES (store.js needsCheckpoint). Worked out here from the stored ops.
    const placed = run.chat.map((message, index) => (!message.is_user && readRecord(message)?.checkpoint ? index : -1)).filter(index => index >= 0);
    assert.equal(placed[0], 0);
    const expected = [0];
    let carriers = 0;
    let opBytes = new TextEncoder().encode(JSON.stringify(readRecord(run.chat[0]).ops)).length;
    run.chat.forEach((message, index) => {
        if (message.is_user || index === 0) return;
        carriers += 1;
        if (carriers >= CHECKPOINT_EVERY || opBytes > CHECKPOINT_BYTES) {
            expected.push(index);
            carriers = 0;
            opBytes = 0;
        }
        opBytes += new TextEncoder().encode(JSON.stringify(readRecord(message).ops)).length;
    });
    assert.deepEqual(placed, expected);
    assert.equal(snapshot.checkpoints.count, placed.length);
    const bytes = breakdown(run.chat);
    assert.equal(bytes.carriers, REPLIES + 1);
    assert.equal(bytes.records, bytes.checkpoint + bytes.ops + bytes.receipts + bytes.other);
    // Each record is kept once: the shown swipe's copy only on the last carrier (every reply here has
    // one swipe).
    const copies = run.chat.map((message, index) => (message.swipe_info?.[message.swipe_id ?? 0]?.extra?.[KEY] ? index : -1)).filter(index => index >= 0);
    assert.deepEqual(copies, [run.chat.length - 1]);
    assert.deepEqual(run.chat.at(-1).swipe_info[0].extra[KEY], run.chat.at(-1).extra[KEY]);
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
    assert.equal(breakdown(once).records, breakdown(chat).records, 'as built, each record is kept once already');
    const twice = everyCopy(chat);
    assert.ok(sameHead(chat, twice));
    assert.ok(breakdown(twice).records > breakdown(chat).records * 1.7, 'the copy on every carrier, as before');
    assert.ok(measureLoad(twice, { repeat: 1 }).rebuildMs.median >= 0);
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
