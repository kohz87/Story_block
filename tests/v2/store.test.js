// v2 state store (SPEC §2, §12): carriers, checkpoints, replay, head cache, swipe and delete rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    action, apply, deleteSwipe, fullReplay, greeting, initial, newSwipe, receipt, reply, setup, showSwipe, user,
    withoutStory,
} from './helpers/store-chat.js';

const isDeepFrozen = value => !value || typeof value !== 'object'
    || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));

// A chat of `n` user/reply turns after the greeting, one action per reply.
function story(n, options) {
    const { ctx, store } = setup([greeting()], options);
    store.ensureInitial(initial());
    for (let i = 1; i <= n; i++) {
        ctx.chat.push(user(`turn ${i}`), reply(`reply ${i}`));
        action(store, `it_${i}`, i);
    }
    return { ctx, store };
}

test('a greeting-only chat gets the initial state as its checkpoint; states are deep-frozen', () => {
    const { ctx, store } = setup();
    assert.equal(store.head(), null);
    assert.equal(store.headIndex(), 0);
    store.ensureInitial(initial());
    assert.deepEqual(store.head(), initial());
    assert.ok(isDeepFrozen(store.head()));
    assert.throws(() => { store.head().meta.rev = 9; }, TypeError);
    assert.deepEqual(store.at(0), initial());
    const record = ctx.chat[0].extra.storySuite;
    assert.equal(record.v, 2);
    assert.deepEqual(record.checkpoint, initial());
    assert.deepEqual([record.ops, record.receipts, record.narrated], [[], [], []]);
    assert.deepEqual(ctx.chat[0].swipe_info[0].extra.storySuite, record, 'swipe_info kept in step');
    assert.notEqual(ctx.chat[0].swipe_info[0].extra.storySuite, record, 'a copy, not the same object');
    assert.equal(store.dirty(), true);
    store.ensureInitial({ v: 2, meta: { rev: 5, claims: {} }, domains: {} });
    assert.deepEqual(store.head(), initial(), 'a chat that has state keeps it');
});

test('an empty chat, or one that starts with the user, has no state until a carrier exists', () => {
    const { ctx, store } = setup([]);
    assert.equal(store.headIndex(), -1);
    store.ensureInitial(initial());
    assert.equal(store.head(), null);
    assert.equal(store.dirty(), false);
    ctx.chat.push(user());
    store.ensureInitial(initial());
    assert.equal(store.head(), null);
    assert.throws(() => store.append({ ops: [], receipt: receipt() }), /no reply/);
    ctx.chat.push(reply());
    store.ensureInitial(initial());
    assert.equal(store.headIndex(), 1);
    assert.deepEqual(store.head(), initial());
    assert.equal(store.at(0), null, 'nothing before the first carrier');
    assert.throws(() => store.at(2), RangeError);
    assert.deepEqual(store.at(1), initial());
});

test('a chat with v1-only extras is treated as a chat with no state', () => {
    const v1 = {
        storyBlockIdentity: { id: 'old', swipe: 0 }, storyDirectorQuest: { receipts: [{ id: 'payment' }] },
        rpgBattleEvidence: { events: [] }, storySuite: { v: 1, state: { gold: 99 } },
    };
    const chat = [greeting(), user(), reply()];
    chat[0].extra = structuredClone(v1);
    chat[2].extra = structuredClone(v1);
    const { ctx, store } = setup(chat);
    assert.equal(store.head(), null);
    assert.deepEqual(store.untold(), []);
    store.ensureInitial(initial());
    assert.deepEqual(store.head(), initial());
    assert.deepEqual(ctx.chat[0].extra.storySuite.checkpoint, initial());
    assert.equal(ctx.chat[0].extra.storyBlockIdentity.id, 'old', 'v1 extras are left alone');
    assert.deepEqual(ctx.chat[2].extra, v1, 'later carriers are not touched');
});

test('actions go onto the head carrier, even while the user message after it waits for a reply', () => {
    const { ctx, store } = setup([greeting(), user(), reply()]);
    store.ensureInitial(initial());
    const before = withoutStory(ctx.chat);
    const first = action(store, 'it_a', 2);
    assert.equal(store.head().domains.inventory.stacks.it_a.qty, 2);
    assert.equal(store.head().meta.rev, 1);
    ctx.chat.push(user('I drink it.'));
    assert.equal(store.headIndex(), 2);
    const second = action(store, 'it_a', 1);
    const record = ctx.chat[2].extra.storySuite;
    assert.deepEqual(record.receipts.map(r => r.id), [first.id, second.id]);
    assert.equal(record.ops.length, 4);
    assert.equal(record.rev, 2);
    assert.deepEqual(record.spans, [{ n: 2, story: false }, { n: 2, story: false }]);
    assert.deepEqual(ctx.chat[2].swipe_info[0].extra.storySuite, record);
    assert.equal(ctx.chat[3].extra.storySuite, undefined, 'user messages hold nothing');
    ctx.chat.pop();
    assert.deepEqual(withoutStory(ctx.chat), before, 'nothing in the chat but extra.storySuite changed');
    assert.ok(isDeepFrozen(store.head()));
});

test('a bad op or a duplicate receipt rejects the append and writes nothing', () => {
    const { ctx, store } = setup([greeting(), user(), reply()]);
    store.ensureInitial(initial());
    const r = action(store, 'it_a', 1);
    const snapshot = structuredClone(ctx.chat);
    const head = store.head();
    assert.throws(() => store.append({ ops: [{ op: 'replace', path: '/domains/nowhere/x', value: 1 }], receipt: receipt() }));
    assert.throws(() => store.append({ ops: [], receipt: r }), /already stored/);
    assert.throws(() => store.append({ ops: 'nope' }), TypeError);
    assert.deepEqual(ctx.chat, snapshot);
    assert.equal(store.head(), head);
    store.append({ ops: [] });
    assert.deepEqual(ctx.chat, snapshot, 'nothing to append is a no-op');
});

test('replay equals a full rebuild at every message, across many checkpoints', () => {
    const { ctx, store } = story(65);
    const checkpoints = ctx.chat.map((m, i) => (m.extra.storySuite?.checkpoint ? i : -1)).filter(i => i >= 0);
    assert.deepEqual(checkpoints, [0, 40, 80, 120], 'one every 20 carriers');
    for (let i = 0; i < ctx.chat.length; i++) assert.deepEqual(store.at(i), fullReplay(ctx.chat, i), `message ${i}`);
    const { store: fresh } = setup(ctx.chat);
    assert.deepEqual(fresh.head(), store.head(), 'a new store on the same chat rebuilds the same head');
    assert.deepEqual(fresh.head(), fullReplay(ctx.chat, ctx.chat.length - 1));
    assert.equal(fresh.head().meta.rev, 65);
});

test('the checkpoint is the state before the carrier\'s own ops, on the 20th carrier, not the 19th', () => {
    const { ctx, store } = story(19);
    assert.equal(ctx.chat.filter(m => m.extra.storySuite?.checkpoint).length, 1);
    const before = store.head();
    ctx.chat.push(user(), reply());
    action(store, 'it_20', 20);
    const record = ctx.chat.at(-1).extra.storySuite;
    assert.deepEqual(record.checkpoint, before);
    assert.equal(record.checkpoint.domains.inventory.stacks.it_20, undefined);
    assert.equal(store.head().domains.inventory.stacks.it_20.qty, 20);
});

test('carriers with no changes still count toward the next checkpoint', () => {
    const { ctx, store } = story(1);
    for (let i = 0; i < 25; i++) ctx.chat.push(user(), reply());
    action(store, 'it_late', 1);
    assert.ok(ctx.chat.at(-1).extra.storySuite.checkpoint, 'first record past the threshold');
    assert.equal(store.head().domains.inventory.stacks.it_1.qty, 1);
});

test('a checkpoint is due once the ops since the last one exceed 32 KB of JSON', () => {
    const big = n => [{ op: 'add', path: '/domains/scene/note', value: 'x'.repeat(n) }];
    const { ctx, store } = setup([greeting()]);
    store.ensureInitial(initial());
    const overhead = JSON.stringify(big(0)).length;
    store.append({ ops: big(32 * 1024 - overhead) });
    assert.equal(JSON.stringify(ctx.chat[0].extra.storySuite.ops).length, 32 * 1024);
    ctx.chat.push(user(), reply());
    store.append({ ops: [{ op: 'replace', path: '/meta/rev', value: 1 }] });
    assert.equal(ctx.chat[2].extra.storySuite.checkpoint, undefined, 'exactly 32 KB is not over');
    ctx.chat.push(user(), reply());
    store.append({ ops: [{ op: 'replace', path: '/meta/rev', value: 2 }] });
    assert.ok(ctx.chat[4].extra.storySuite.checkpoint, 'one byte more is');
    assert.equal(ctx.chat[4].extra.storySuite.checkpoint.meta.rev, 1);
    assert.deepEqual(store.head(), fullReplay(ctx.chat, 4));
});

test('each swipe has its own changes; a new swipe does not inherit the copied ones', () => {
    const { ctx, store } = story(2);
    const last = ctx.chat.at(-1);
    assert.equal(store.head().domains.inventory.stacks.it_2.qty, 2);
    newSwipe(last);
    assert.equal(last.extra.storySuite.swipe, 0, 'SillyTavern copied the old swipe\'s record');
    assert.equal(store.head().domains.inventory.stacks.it_2, undefined, 'the copy is not this swipe\'s state');
    assert.deepEqual(store.head(), store.at(2));
    action(store, 'it_x', 7);
    assert.equal(store.head().domains.inventory.stacks.it_x.qty, 7);
    assert.equal(last.swipe_info[1].extra.storySuite.swipe, 1);
    assert.deepEqual(last.swipe_info[1].extra.storySuite.ops, last.extra.storySuite.ops);
    showSwipe(last, 0);
    assert.equal(store.head().domains.inventory.stacks.it_2.qty, 2);
    assert.equal(store.head().domains.inventory.stacks.it_x, undefined);
    showSwipe(last, 1);
    assert.equal(store.head().domains.inventory.stacks.it_x.qty, 7);
});

test('a swipe that moved down after an earlier swipe was deleted keeps its changes', () => {
    const { ctx, store } = story(1);
    const last = ctx.chat.at(-1);
    newSwipe(last);
    action(store, 'it_b', 2);
    newSwipe(last);
    action(store, 'it_c', 3);
    deleteSwipe(last, 1);
    assert.equal(last.swipe_id, 1);
    assert.equal(last.extra.storySuite.swipe, 2);
    assert.equal(store.head().domains.inventory.stacks.it_c.qty, 3);
    assert.equal(store.head().domains.inventory.stacks.it_b, undefined);
});

test('deleting the last reply takes back its ops and the actions taken after it', () => {
    const { ctx, store } = story(3);
    const atTwo = store.at(4);
    const r = action(store, 'it_after', 9);
    ctx.chat.push(user('next'));
    action(store, 'it_after', 10);
    assert.deepEqual(ctx.chat[6].extra.storySuite.receipts.at(-2).id, r.id);
    ctx.chat.splice(5, 2);
    assert.equal(store.headIndex(), 4);
    assert.deepEqual(store.head(), atTwo);
    assert.equal(store.head().domains.inventory.stacks.it_after, undefined);
    assert.equal(store.head().domains.inventory.stacks.it_3, undefined);
});

test('a rebuild after a swipe of the last reply replays only from the nearest checkpoint', () => {
    let calls = 0;
    const counting = (state, ops) => { calls++; return apply(state, ops); };
    const { ctx, store } = story(45, { apply: counting });
    newSwipe(ctx.chat.at(-1));
    calls = 0;
    store.rebuild();
    // Checkpoints at carriers 0, 20, 40; the head is carrier 45: carriers 40..44 have ops, 45 is empty.
    assert.equal(calls, 5);
    calls = 0;
    store.head();
    store.head();
    assert.equal(calls, 0, 'the head is cached');
    action(store, 'it_new', 1);
    assert.equal(calls, 1, 'an append applies only its own ops');
});

test('untold receipts: told once a later carrier lists them; a swipe of the telling reply re-tells', () => {
    const { ctx, store } = setup([greeting(), user(), reply()]);
    store.ensureInitial(initial());
    const a = action(store, 'it_a', 1);
    const quiet = action(store, 'it_b', 1, { narrate: false });
    const b = action(store, 'it_c', 1);
    assert.deepEqual(store.untold().map(r => r.id), [a.id, b.id], 'oldest first; narrate:false is left out');
    assert.ok(isDeepFrozen(store.untold()));
    assert.ok(!store.untold().some(r => r.id === quiet.id));
    ctx.chat.push(user(), reply('It is told.'));
    store.setNarrated(4, [a.id, b.id]);
    assert.deepEqual(store.untold(), []);
    assert.equal(ctx.chat[4].extra.storySuite.rev, 3);
    const c = action(store, 'it_d', 1);
    assert.deepEqual(store.untold().map(r => r.id), [c.id]);
    newSwipe(ctx.chat[4]);
    assert.deepEqual(store.untold().map(r => r.id), [a.id, b.id], 'the new swipe starts with nothing narrated');
    store.setNarrated(4, [a.id]);
    assert.deepEqual(store.untold().map(r => r.id), [b.id]);
    showSwipe(ctx.chat[4], 0);
    assert.deepEqual(store.untold().map(r => r.id), [c.id]);
    ctx.chat.splice(3, 2);
    assert.deepEqual(store.untold().map(r => r.id), [a.id, b.id], 'deleting the telling reply re-tells');
});

test('a cue committed on the carrier being re-generated is told by that same carrier', () => {
    const { ctx, store } = setup([greeting(), user(), reply()]);
    store.ensureInitial(initial());
    const cue = action(store, 'it_cue', 1, { cause: 'system' });
    store.setNarrated(2, [cue.id]);
    assert.deepEqual(store.untold(), []);
    assert.throws(() => store.setNarrated(1, []), RangeError);
    assert.throws(() => store.setNarrated(2, [1]), TypeError);
});

test('Re-read replaces the story receipts and their ops and keeps the ui and system ones', () => {
    const { ctx, store } = setup([greeting(), user(), reply()]);
    store.ensureInitial(initial());
    const story = receipt({ cause: 'story', rev: 1 });
    store.append({ ops: [{ op: 'replace', path: '/meta/rev', value: 1 }, { op: 'add', path: '/domains/scene/place', value: 'Lake' }], receipt: story });
    const ui = action(store, 'it_rope', 1);
    const cue = action(store, 'it_map', 1, { cause: 'system' });
    const reread = receipt({ cause: 'story', rev: 1 });
    store.replaceStory(2, { ops: [{ op: 'replace', path: '/domains/scene/place', value: 'Forest' }], receipts: [reread] });
    const record = ctx.chat[2].extra.storySuite;
    assert.deepEqual(record.receipts.map(r => r.id), [reread.id, ui.id, cue.id]);
    assert.equal(store.head().domains.scene.place, 'Forest');
    assert.equal(store.head().domains.inventory.stacks.it_rope.qty, 1);
    assert.equal(store.head().domains.inventory.stacks.it_map.qty, 1);
    assert.equal(store.head().meta.rev, 3);
    assert.deepEqual(store.head(), fullReplay(ctx.chat, 2));
    assert.deepEqual(record.spans, [{ n: 1, story: true }, { n: 2, story: false }, { n: 2, story: false }]);
    assert.deepEqual(ctx.chat[2].swipe_info[0].extra.storySuite, record);
});

test('Re-read rejects non-story receipts and changes that no longer fit, writing nothing', () => {
    const { ctx, store } = setup([greeting(), user(), reply()]);
    store.ensureInitial(initial());
    store.append({ ops: [{ op: 'add', path: '/domains/inventory/stacks/it_trout', value: { id: 'it_trout', qty: 1 } }],
        receipt: receipt({ cause: 'story' }) });
    store.append({ ops: [{ op: 'replace', path: '/domains/inventory/stacks/it_trout/qty', value: 0 }], receipt: receipt() });
    const snapshot = structuredClone(ctx.chat);
    const head = store.head();
    assert.throws(() => store.replaceStory(2, { ops: [], receipts: [receipt({ cause: 'ui' })] }), /story receipts only/);
    assert.throws(() => store.replaceStory(2, { ops: [], receipts: [] }), /do not fit/);
    assert.throws(() => store.replaceStory(1, { ops: [], receipts: [] }), RangeError);
    assert.deepEqual(ctx.chat, snapshot);
    assert.equal(store.head(), head);
});

test('Re-read of an older reply refreshes later checkpoints so replay still equals a rebuild', () => {
    const { ctx, store } = story(25);
    const at = 2;
    const story1 = receipt({ cause: 'story' });
    store.replaceStory(at, { ops: [{ op: 'add', path: '/domains/scene/place', value: 'Reread' }], receipts: [story1] });
    // carrier 2's ui action (it_1) is kept after the new story op
    assert.equal(store.head().domains.scene.place, 'Reread');
    assert.equal(store.head().domains.inventory.stacks.it_1.qty, 1);
    assert.equal(ctx.chat[40].extra.storySuite.checkpoint.domains.scene.place, 'Reread');
    for (let i = 0; i < ctx.chat.length; i += 7) assert.deepEqual(store.at(i), fullReplay(ctx.chat, i));
    const { store: fresh } = setup(ctx.chat);
    assert.deepEqual(fresh.head(), store.head());
});

test('Re-read of an older reply is refused when a later change depends on what it replaces', () => {
    const { ctx, store } = setup([greeting(), user(), reply()]);
    store.ensureInitial(initial());
    store.append({ ops: [{ op: 'add', path: '/domains/inventory/stacks/it_t', value: { id: 'it_t', qty: 1 } }],
        receipt: receipt({ cause: 'story' }) });
    ctx.chat.push(user(), reply());
    store.append({ ops: [{ op: 'remove', path: '/domains/inventory/stacks/it_t' }], receipt: receipt() });
    const snapshot = structuredClone(ctx.chat);
    assert.throws(() => store.replaceStory(2, { ops: [], receipts: [] }), /later change \(message 4\)/);
    assert.deepEqual(ctx.chat, snapshot);
});

test('ops stored on a carrier that no longer apply are skipped and reported, not thrown', () => {
    const { ctx, store } = story(3);
    ctx.chat[4].extra.storySuite.ops.push({ op: 'remove', path: '/domains/missing' });
    store.rebuild();
    assert.equal(store.problems().length, 1);
    assert.equal(store.problems()[0].index, 4);
    assert.equal(store.head().domains.inventory.stacks.it_2, undefined, 'the whole carrier is skipped');
    assert.equal(store.head().domains.inventory.stacks.it_3.qty, 3);
});

test('replay skips only the block that no longer applies; the carrier\'s other receipts and later commits stay', () => {
    const { ctx, store } = story(2);
    const kept = action(store, 'it_x', 7);          // a second block on the head carrier (4)
    const record = ctx.chat[4].extra.storySuite;
    assert.deepEqual(record.spans.map(span => span.n), [2, 2]);
    const broken = record.receipts[0];
    record.ops[1] = { op: 'remove', path: '/domains/missing' };   // the first block now fails
    store.rebuild();
    assert.deepEqual(store.problems().map(problem => [problem.index, problem.block, problem.receipts]), [[4, 0, [broken.id]]]);
    assert.equal(store.head().domains.inventory.stacks.it_2, undefined, 'the broken block is skipped');
    assert.deepEqual(store.head().domains.inventory.stacks.it_x, { id: 'it_x', qty: 7 }, 'the block after it applies');
    assert.equal(store.head().meta.rev, kept.rev, 'the skipped block\'s rev still counts');
    const later = action(store, 'it_y', 1);
    assert.equal(later.rev, kept.rev + 1, 'a new receipt gets a rev of its own');
    store.rebuild();
    assert.equal(store.head().domains.inventory.stacks.it_y.qty, 1, 'a commit onto the carrier survives the rebuild');
    assert.equal(store.problems().length, 1);
    const { store: fresh } = setup(structuredClone(ctx.chat));
    assert.deepEqual(fresh.head(), store.head(), 'a new store agrees');
});

test('Re-read of an older reply keeps a later block that was already skipped skipped, and is not refused for it', () => {
    const { ctx, store } = setup([greeting(), user(), reply(), user(), reply()]);
    store.ensureInitial(initial());
    ctx.chat.splice(3);
    store.append({ ops: [{ op: 'add', path: '/domains/scene/place', value: 'Old' }], receipt: receipt({ cause: 'story' }) });
    ctx.chat.push(user(), reply());
    action(store, 'it_a', 1);
    action(store, 'it_b', 2);
    ctx.chat[4].extra.storySuite.ops[1] = { op: 'remove', path: '/domains/missing' };
    store.rebuild();
    assert.equal(store.problems().length, 1);
    store.replaceStory(2, { ops: [{ op: 'replace', path: '/domains/scene/place', value: 'New' }], receipts: [receipt({ cause: 'story' })] });
    assert.equal(store.head().domains.scene.place, 'New');
    assert.equal(store.head().domains.inventory.stacks.it_b.qty, 2);
    assert.equal(store.head().domains.inventory.stacks.it_a, undefined, 'still skipped');
    assert.deepEqual(store.problems().map(problem => [problem.index, problem.block]), [[4, 0]], 'and still reported');
});

test('save verification (SPEC §3.3): a record replaced while saving fails the save, keeps it dirty, and is told once', async () => {
    let tamper = null;
    const errors = [];
    const { ctx, store } = setup([greeting(), user(), reply()], { save: async () => { tamper?.(); } });
    store.ensureInitial(initial());
    action(store, 'it_1', 1);
    tamper = () => { ctx.chat[2].extra = { storySuite: { ...ctx.chat[2].extra.storySuite, rev: 99 } }; };
    await assert.rejects(store.flush(), /message 2 no longer holds its latest changes \(change 99 instead of 1\); the story stays marked unsaved/);
    assert.equal(store.dirty(), true, 'still marked unsaved');
    tamper = null;
    await store.flush();
    assert.equal(store.dirty(), false, 'the next save writes the chat as it is and is not refused again');
    // A scheduled save that fails the check goes to onSaveError.
    const timers = { setTimeout: fn => { timers.fn = fn; return 1; }, clearTimeout: () => {} };
    const second = setup([greeting(), user(), reply()], { save: async () => { tamper?.(); }, onSaveError: error => errors.push(error.message), timers });
    second.store.ensureInitial(initial());
    action(second.store, 'it_1', 1);
    tamper = () => { second.ctx.chat[2].extra.storySuite.rev = 5; };
    second.store.scheduleSave();
    timers.fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no longer holds its latest changes/);
    assert.equal(second.store.dirty(), true);
});

test('save verification: a change made during the save, or a message deleted, is no false alarm', async () => {
    let during = null;
    const { ctx, store } = setup([greeting(), user(), reply()], { save: async () => { await null; during?.(); } });
    store.ensureInitial(initial());
    action(store, 'it_1', 1);
    during = () => action(store, 'it_2', 2);
    await store.flush();
    assert.equal(store.dirty(), true, 'the change made during the save goes with the next one');
    during = null;
    await store.flush();
    assert.equal(store.dirty(), false);
    action(store, 'it_3', 3);
    during = () => { ctx.chat.splice(1); };
    await store.flush();
    assert.equal(store.dirty(), false, 'the written reply is gone: nothing of it to check');
});

test('a state handed out is never the object stored in the chat', () => {
    const { ctx, store } = story(1);
    assert.notEqual(store.at(0), ctx.chat[0].extra.storySuite.checkpoint);
    assert.equal(Object.isFrozen(ctx.chat[0].extra.storySuite.checkpoint), false);
    assert.equal(Object.isFrozen(ctx.chat[2].extra.storySuite.ops[1].value), false);
});

test('a chat switched in place (same array) is noticed without an explicit rebuild', () => {
    const { ctx, store } = story(2);
    const other = story(5).ctx.chat;
    ctx.chat.splice(0, ctx.chat.length, ...other.slice(0, 5));
    assert.deepEqual(store.head(), fullReplay(other, 4));
});

test('saves are batched: one per burst, 400 ms after the last call', async () => {
    const timers = fakeTimers();
    const { ctx, store } = setup([greeting()], { timers });
    store.ensureInitial(initial());
    store.scheduleSave();
    timers.advance(300);
    store.scheduleSave();
    timers.advance(300);
    assert.equal(ctx.saves, 0);
    store.scheduleSave();
    timers.advance(399);
    assert.equal(ctx.saves, 0);
    timers.advance(1);
    await settle();
    assert.equal(ctx.saves, 1);
    assert.equal(store.dirty(), false);
    await store.flush();
    assert.equal(ctx.saves, 1, 'nothing to save');
});

test('flush saves a pending burst at once and waits for it', async () => {
    const timers = fakeTimers();
    let release;
    const { ctx, store } = setup([greeting()], {
        timers, save: () => new Promise(resolve => { release = () => { ctx.saves++; resolve(); }; }),
    });
    store.ensureInitial(initial());
    store.scheduleSave();
    let done = false;
    const flushing = store.flush().then(() => { done = true; });
    await settle();
    assert.equal(timers.count(), 0, 'the timer is cancelled');
    assert.equal(done, false);
    action(store, 'it_during', 1);
    release();
    await flushing;
    assert.equal(ctx.saves, 1);
    assert.equal(store.dirty(), true, 'a change made during the save is still unsaved');
    const again = store.flush();
    await settle();
    release();
    await again;
    assert.equal(store.dirty(), false);
});

test('a failed save keeps the store dirty, rethrows from flush, and a later flush retries', async () => {
    const timers = fakeTimers();
    let fail = true;
    const errors = [];
    const { ctx, store } = setup([greeting()], {
        timers, onSaveError: error => errors.push(error.message),
        save: async () => { if (fail) throw new Error('disk full'); ctx.saves++; },
    });
    store.ensureInitial(initial());
    store.scheduleSave();
    timers.advance(400);
    await settle();
    assert.deepEqual(errors, ['disk full'], 'a scheduled save reports, it does not throw');
    assert.equal(store.dirty(), true);
    await assert.rejects(store.flush(), /disk full/);
    assert.equal(store.dirty(), true);
    fail = false;
    await store.flush();
    assert.equal(ctx.saves, 1);
    assert.equal(store.dirty(), false);
});

test('the default apply comes from ops.js', async () => {
    const { createStore } = await import('./helpers/store-chat.js');
    const chat = [greeting()];
    const store = createStore({ chat: () => chat, save: async () => {} });
    store.ensureInitial(initial());
    store.append({ ops: [{ op: 'replace', path: '/meta/rev', value: 1 }], receipt: receipt() });
    assert.equal(store.head().meta.rev, 1);
});

function fakeTimers() {
    let now = 0;
    let next = 1;
    const pending = new Map();
    return {
        setTimeout(fn, ms) { pending.set(next, { fn, at: now + ms }); return next++; },
        clearTimeout(id) { pending.delete(id); },
        advance(ms) {
            now += ms;
            for (const [id, { fn, at }] of [...pending]) if (at <= now) { pending.delete(id); fn(); }
        },
        count: () => pending.size,
    };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
