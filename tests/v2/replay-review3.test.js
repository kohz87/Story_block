// The third review of the replay core (docs/v2/REPLAY.md): revs strictly increasing across a Re-read, boundaries that follow
// a Re-read whose step comes out the same, a classifier that fails closed on the fallback path, repairs that keep every
// preserved record, tombstones with a baseline per chat, and one head per swipe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { Q1, Q2, guarded, harness } from './helpers/guarded.js';

const clone = value => JSON.parse(JSON.stringify(value));
const setStory = (host, at, text) => {
    host.ctx.chat[at].mes = text;
    host.ctx.chat[at].swipes[host.ctx.chat[at].swipe_id ?? 0] = text;
};
const revsOf = host => {
    const out = [];
    for (const message of host.ctx.chat) for (const op of message.extra?.storySuite?.ops ?? []) if (op.path === '/meta/rev') out.push(op.value);
    return out;
};
const receiptRevsOf = host => host.ctx.chat.flatMap(message => (message.extra?.storySuite?.receipts ?? []).map(receipt => receipt.rev));
const inOrder = list => list.every((rev, n) => n === 0 || rev > list[n - 1]);

test('F: revs stay strictly increasing and unique across the chat after a Re-read, with no step planned again', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 30\n</Changes>');
    const first = host.ctx.chat.length - 1;
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.hit', { actor: 'ac_00000001', amount: 1 }, { cause: 'ui' });
    await host.bus.command('gt.hit', { actor: 'ac_00000001', amount: 1 }, { cause: 'ui' });
    setStory(host, first, 'Dawn.\n\n<Changes>\n! tick 30\n! tick 31\n! tick 32\n</Changes>');
    const done = await host.turn.reread(first);
    assert.equal(done.ok, true, done.message);
    const revs = revsOf(host);
    assert.ok(inOrder(revs), `op revs ${revs}`);
    const receipts = receiptRevsOf(host);
    assert.ok(inOrder(receipts), `receipt revs ${receipts}`);
    assert.equal(host.head().meta.rev, revs.at(-1), 'the head is at the last rev');
    const live = JSON.stringify(host.head());
    await host.st.loadChat(clone(host.ctx.chat));
    assert.equal(JSON.stringify(host.head()), live);
});

test('B: a Re-read whose later step comes out the same still records where that step now stands', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', `Dawn.\n\n<Changes>\n! offer ${Q1}\n</Changes>`);
    const first = host.ctx.chat.length - 1;
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    await host.bus.command('gt.hit', { actor: 'ac_00000001', amount: 1 }, { cause: 'ui' });
    assert.deepEqual(host.store.boundaryProblems(), []);
    const before = host.head().domains.gt.credits[Q1];
    setStory(host, first, `Dawn.\n\n<Changes>\n! offer ${Q2}\n</Changes>`);
    const done = await host.turn.reread(first);
    assert.equal(done.ok, true, done.message);
    assert.equal(host.head().domains.gt.credits[Q1], before, 'the attempt came out the same');
    assert.equal(host.head().domains.gt.quests[Q2].state, 'open');
    assert.deepEqual(host.store.boundaryProblems(), [], 'its recorded prefix is what the chat now gives');
    // And it is what a reload sees.
    const live = JSON.stringify(host.head());
    await host.st.loadChat(clone(host.ctx.chat));
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(host.store.boundaryProblems(), []);
});

test('A: a block whose spans are gone stands for every receipt it merges: one guarded receipt among them keeps it off', () => {
    for (const [label, strip] of [
        ['no spans', record => { delete record.spans; }],
        ['spans that do not add up', record => { record.spans = record.spans.map(span => ({ n: span.n + 1, story: span.story })); }],
        ['spans cut down to n and story', record => { record.spans = [{ n: record.ops.length, story: false }]; }],
    ]) {
        const mode = { value: 'normal' };
        const h = harness([guarded({ mode })]);
        const at = h.send('u', 'r');
        assert.equal(h.command('gt.quick', { id: Q1 }).ok, true, label);
        assert.equal(h.command('gt.hit', { actor: 'ac_00000001', amount: 2 }).ok, true, label);
        assert.equal(h.gt().coin, 1, label);
        strip(h.record(at));
        // The guard cannot say yes any more: the merged block is not applied, and it says so (the unguarded hit is one of its parts).
        mode.value = 'throw';
        h.store.rebuild();
        assert.equal(h.gt().coin, 0, `${label}: the coin is not paid`);
        assert.ok(h.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'), label);
        // Without a guarded receipt nothing changes: the same merge of plain commands replays as it always did.
        const plain = harness([guarded({ mode })]);
        const there = plain.send('u', 'r');
        plain.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
        plain.command('gt.hit', { actor: 'ac_00000001', amount: 2 });
        strip(plain.record(there));
        plain.store.rebuild();
        assert.equal(plain.gt().lost.ac_00000001, 3, `${label}: plain commands are applied`);
        assert.deepEqual(plain.problems(), [], label);
    }
});

test('A: the same on a Re-read: a kept guarded block among merged receipts is asked, and the checkpoints after it follow', () => {
    const mode = { value: 'normal' };
    const h = harness([guarded({ mode })], { checkpointEvery: 3, checkpointBytes: 1 << 30 });
    const at = h.send('u', 'r');
    assert.equal(h.command('gt.quick', { id: Q1 }).ok, true);
    assert.equal(h.command('gt.hit', { actor: 'ac_00000001', amount: 2 }).ok, true);
    for (let n = 0; n < 5; n++) {
        h.send(`u${n}`, `r${n}`);
        h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    }
    const record = h.record(at);
    record.spans = [{ n: record.ops.length, story: false }];
    mode.value = 'throw';
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    const checkpoints = () => h.chat.map(message => message.extra?.storySuite).filter(each => each?.checkpoint && each.sid !== h.record(0)?.sid).map(each => each.checkpoint.domains.gt.coin);
    h.store.replaceStory(at, { ops: [] });
    assert.equal(h.gt().coin, 0, 'still off after the Re-read');
    assert.ok(checkpoints().every(coin => coin === 0), `no checkpoint holds the coin: ${checkpoints()}`);
    assert.equal(h.gt().lost.ac_00000001, 5, 'the plain hits after it are still there (the merged block took its own hit with it)');
});

test('C: every record a repair sets aside survives any number of repairs', () => {
    const v1 = { v: 1, state: { gold: 99 } };
    const h = harness([guarded()]);
    h.chat.length = 0;
    h.chat.push({ is_user: false, is_system: false, mes: 'Hi.', swipe_id: 0, swipes: ['Hi.'], extra: { storySuite: clone(v1) } });
    h.store.rebuild();
    h.store.ensureInitial(h.registry.initialState());
    assert.equal(h.store.readOnly().kind, 'legacy');
    h.store.startOver({ confirmed: true });
    assert.equal(h.store.readOnly(), null);
    assert.deepEqual(h.chat[0].extra.storySuiteAside, [{ kind: 'legacy', record: v1 }]);
    // The replacement is damaged later; the reader starts over again.
    const damaged = { v: 2, sid: 'sw_damaged0001', ops: 'x', receipts: [], narrated: [] };
    h.chat[0].extra.storySuite = clone(damaged);
    h.store.rebuild();
    h.store.ensureInitial(h.registry.initialState());
    assert.equal(h.store.readOnly().kind, 'damaged');
    h.store.startOver({ confirmed: true });
    assert.deepEqual(h.chat[0].extra.storySuiteAside, [{ kind: 'legacy', record: v1 }, { kind: 'damaged', record: damaged }], 'the first one is still there');
    // And a third time.
    const worse = { v: 1, state: { gold: 1 } };
    h.chat[0].extra.storySuite = clone(worse);
    h.store.rebuild();
    h.store.ensureInitial(h.registry.initialState());
    h.store.startOver({ confirmed: true });
    assert.deepEqual(h.chat[0].extra.storySuiteAside.map(entry => entry.record), [v1, damaged, worse]);
    // A list from before (one record, as a single value) is kept too.
    h.chat[0].extra.storySuiteAside = clone(v1);
    h.chat[0].extra.storySuite = clone(damaged);
    h.store.rebuild();
    h.store.ensureInitial(h.registry.initialState());
    h.store.startOver({ confirmed: true });
    assert.deepEqual(h.chat[0].extra.storySuiteAside, [{ kind: 'earlier', record: v1 }, { kind: 'damaged', record: damaged }]);
    // An array that is not a list of our entries (records from before) is one earlier record as a whole, not taken for the list.
    const before = [{ v: 1 }, 'x', { kind: 'legacy' }];
    h.chat[0].extra.storySuiteAside = clone(before);
    h.chat[0].extra.storySuite = clone(damaged);
    h.store.rebuild();
    h.store.ensureInitial(h.registry.initialState());
    h.store.startOver({ confirmed: true });
    assert.deepEqual(h.chat[0].extra.storySuiteAside, [{ kind: 'earlier', record: before }, { kind: 'damaged', record: damaged }]);
});

test('D: a store opened over saved records knows their ids from its first rebuild, and one chat\'s ids never reach another\'s archive', () => {
    const made = (metadata, base = 0) => {
        let n = base;
        const h = harness([guarded()], { metadata: () => metadata, recordId: () => `sw_${(++n).toString(16).padStart(12, '0')}` });
        const at = [];
        for (let n = 1; n <= 3; n++) {
            at.push(h.send(`u${n}`, `r${n}`));
            h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
        }
        return { h, at };
    };
    const { h: source, at } = made({});
    const saved = clone(source.chat);
    const goneIds = ['logical', 'swipeKey', 'evidence'].map(name => source.record(at[1]).source[name]);
    // Opened over the saved chat: rebuilt once, then a reply is deleted before anything is written.
    const meta = {};
    const opened = harness([guarded()], { metadata: () => meta });
    opened.chat.splice(0, opened.chat.length, ...clone(saved));
    opened.store.rebuild();
    opened.chat.splice(at[1] - 1, 2);
    opened.store.rebuild();
    for (const id of goneIds) assert.equal(opened.store.archived(id), true, `${id} is archived`);
    assert.ok(goneIds.every(id => meta.storySuite.sourceArchive.deleted.includes(id)));

    // Two chats in the one array: the first chat's ids are not put in the second's archive.
    let chatId = 'a';
    const metas = { a: {}, b: {} };
    const two = harness([guarded()], { chatId: () => chatId, metadata: () => metas[chatId] });
    two.chat.splice(0, two.chat.length, ...clone(saved));
    two.store.rebuild();
    const other = made({}, 0x500);
    chatId = 'b';
    two.chat.splice(0, two.chat.length, ...clone(other.h.chat));
    two.store.rebuild();
    assert.deepEqual(two.store.archiveList(), [], 'nothing was deleted from the second chat');
    assert.equal(metas.b.storySuite, undefined, 'and its metadata holds nothing of the first');
    const own = ['logical', 'swipeKey', 'evidence'].map(name => two.record(other.at[1]).source[name]);
    two.chat.splice(other.at[1] - 1, 2);
    two.store.rebuild();
    assert.deepEqual(two.store.archiveList(), [...own].sort(), 'only the second chat\'s own ids');
    assert.equal(goneIds.some(id => two.store.archived(id)), false);
});

// SillyTavern's deleteSwipe: the swipe is spliced out and the next one is under swipe_id before MESSAGE_SWIPE_DELETED;
// what the reader sees (mes, extra) is loaded after it, with MESSAGE_SWIPED.
async function stDeleteSwipe(host, index, swipe) {
    const message = host.ctx.chat[index];
    const current = message.swipe_id;
    message.swipe_info[current].extra = structuredClone(message.extra);
    message.swipes.splice(swipe, 1);
    message.swipe_info.splice(swipe, 1);
    const next = swipe < current ? current - 1 : swipe > current ? current : Math.min(swipe, message.swipes.length - 1);
    message.swipe_id = next;
    await host.st.eventSource.emit('message_swipe_deleted', { messageId: index, swipeId: swipe, newSwipeId: next });
    if (swipe === current) {
        message.mes = message.swipes[next];
        message.extra = structuredClone(message.swipe_info[next].extra);
        await host.st.eventSource.emit('message_swiped', index);
    }
}

test('E: deleting the shown swipe publishes one head, already reconciled, not one for the half-way state', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>');
    const first = host.ctx.chat.length - 1;
    await host.swipe('Dawn again.\n\n<Changes>\n! tick 0\n</Changes>');
    await host.store.flush();
    await host.st.swipeTo(first, 0);
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    assert.equal(host.head().domains.gt.credits[Q1], 1);
    const seen = [];
    host.sdk.on('head', () => seen.push(host.head().domains.gt.credits[Q1]));
    await stDeleteSwipe(host, first, 0);        // the clock reply's swipe 0 (90) goes; swipe 1 (0) is shown
    assert.deepEqual(seen, [0], 'one head, with the attempt planned again on the clock that is shown now');
    assert.equal(host.head().domains.gt.minutes, 0);
    assert.deepEqual(host.store.problems().filter(problem => problem.code !== 'REPLANNED'), []);
});

test('E: deleting a swipe that is not shown is one change and one head, as ever', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>');
    const first = host.ctx.chat.length - 1;
    await host.swipe('Dawn again.\n\n<Changes>\n! tick 0\n</Changes>');
    await host.swipe('Dawn thrice.\n\n<Changes>\n! tick 20\n</Changes>');
    await host.store.flush();
    await host.st.swipeTo(first, 0);
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    const seen = [];
    host.sdk.on('head', () => seen.push(host.head().domains.gt.credits[Q1]));
    await stDeleteSwipe(host, first, 2);
    assert.deepEqual(seen, [1], 'one head; the shown clock (90) is the same');
    assert.equal(host.ctx.chat[first].swipes.length, 2);
});

test('F+A: a merged block renumbered by a Re-read keeps every receipt tied to its ops, so its guarded receipt still holds it off', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 30\n</Changes>');
    const first = host.ctx.chat.length - 1;
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.quick', { id: Q1 }, { cause: 'ui' });
    await host.bus.command('gt.hit', { actor: 'ac_00000001', amount: 2 }, { cause: 'ui' });
    const later = host.ctx.chat.length - 1;
    assert.equal(host.head().domains.gt.coin, 1);
    const record = host.ctx.chat[later].extra.storySuite;
    delete record.spans;
    host.store.rebuild();
    assert.equal(host.head().domains.gt.coin, 0, 'stripped: off');
    setStory(host, first, 'Dawn.\n\n<Changes>\n! tick 30\n! tick 31\n! tick 32\n</Changes>');
    const done = await host.turn.reread(first);
    assert.equal(done.ok, true, done.message);
    const stored = host.ctx.chat[later].extra.storySuite;
    const opRevs = stored.ops.filter(op => op.path === '/meta/rev').map(op => op.value);
    assert.deepEqual(stored.receipts.map(receipt => receipt.rev), opRevs, 'every receipt still names its own ops');
    assert.ok(inOrder(receiptRevsOf(host)), `receipt revs ${receiptRevsOf(host)}`);
    assert.equal(host.head().domains.gt.coin, 0, 'still off after the Re-read');
    assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    await host.st.loadChat(clone(host.ctx.chat));
    assert.equal(host.head().domains.gt.coin, 0, 'and after a reload');
});

test('F+A: a guarded receipt that names no ops of its record keeps the record\'s plain blocks off too (a record an older build renumbered)', () => {
    const h = harness([guarded()]);
    const at = h.send('u', 'r');
    h.command('gt.quick', { id: Q1 });
    h.command('gt.hit', { actor: 'ac_00000001', amount: 2 });
    const record = h.record(at);
    record.spans = [{ n: record.ops.length, story: false }];
    record.receipts[0].rev = 99;       // detached from every op
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    assert.equal(h.gt().lost.ac_00000001, undefined);
    assert.ok(h.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE' && /guarded receipt/.test(problem.why)));
});

test('F+A: taking back a guarded change leaves the plain ones before it applied (its dropped receipt is not an orphan)', () => {
    const h = harness([guarded()]);
    const at = h.send('u', 'r');
    h.command('gt.hit', { actor: 'ac_00000001', amount: 2 });
    h.command('gt.quick', { id: Q1 });
    assert.equal(h.gt().coin, 1);
    const result = h.store.truncate(at, 2);
    assert.equal(result.dropped.length, 1);
    assert.equal(h.gt().lost.ac_00000001, 2, 'the hit before it stays');
    assert.equal(h.gt().coin, 0);
    assert.deepEqual(h.problems(), []);
});

test('E: the deleted shown swipe is told by its record, not its text: identical text still gives one reconciled head', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.');
    const first = host.ctx.chat.length - 1;
    await host.bus.command('gt.tick', { minutes: 90 }, { cause: 'ui' });
    await host.swipe('Dawn.');                                   // the same text, its own record
    await host.bus.command('gt.tick', { minutes: 0 }, { cause: 'ui' });
    await host.store.flush();
    await host.st.swipeTo(first, 0);
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    assert.equal(host.head().domains.gt.credits[Q1], 1);
    const message = host.ctx.chat[first];
    assert.equal(message.swipes[0], message.swipes[1], 'the two swipes read the same');
    const seen = [];
    host.sdk.on('head', () => seen.push(host.head().domains.gt.credits[Q1]));
    await stDeleteSwipe(host, first, 0);
    assert.deepEqual(seen, [0], 'one head, with the attempt planned again on the clock that is shown now');
    assert.equal(host.head().domains.gt.minutes, 0);
});

test('E: deleting the shown swipe of the last reply never writes over the swipe that takes its place', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>');
    const at = host.ctx.chat.length - 1;
    await host.swipe('Dawn, once more.\n\n<Changes>\n! tick 0\n</Changes>');
    await host.store.flush();
    const message = host.ctx.chat[at];
    assert.equal(message.swipe_id, 1);
    const own = clone(message.swipe_info[0].extra.storySuite);
    assert.equal(host.head().domains.gt.minutes, 0);
    const seen = [];
    host.sdk.on('head', () => seen.push(host.head().domains.gt.minutes));
    await stDeleteSwipe(host, at, 1);                            // the shown one goes; swipe 0 is shown
    assert.deepEqual(seen, [90], 'one head, the clock of the swipe that is shown');
    assert.equal(host.head().domains.gt.minutes, 90);
    assert.deepEqual(message.swipe_info[0].extra.storySuite.ops, own.ops, 'swipe 0\'s own record was not written over');
    assert.equal(message.swipe_info[0].extra.storySuite.sid, own.sid);
    await host.st.loadChat(clone(host.ctx.chat));
    assert.equal(host.head().domains.gt.minutes, 90, 'and it stays so for good');
});

test('E: a swipe that is not shown, and a message with no swipe left, are one change each and never throw', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>');
    const at = host.ctx.chat.length - 1;
    await host.swipe('Dawn, once more.\n\n<Changes>\n! tick 0\n</Changes>');
    await host.store.flush();
    await host.st.swipeTo(at, 1);
    const seen = [];
    host.sdk.on('head', () => seen.push(host.head().domains.gt.minutes));
    await stDeleteSwipe(host, at, 0);                            // not the shown one
    assert.deepEqual(seen, [0], 'one head, nothing held back');
    // The only swipe is gone (SillyTavern does not allow it; whatever is sent must not throw).
    const message = host.ctx.chat[at];
    message.swipes.splice(0, 1);
    message.swipe_info.splice(0, 1);
    message.swipe_id = -1;
    await host.st.eventSource.emit('message_swipe_deleted', { messageId: at, swipeId: 0, newSwipeId: -1 });
    assert.doesNotThrow(() => host.head());
});

test('a checkpoint a Re-read rewrites is given the window it has now, so a later delete cannot make it trusted over a record it includes', () => {
    const SMALL = { checkpointEvery: 3, checkpointBytes: 1 << 30 };
    const h = harness([guarded()], SMALL);
    const at = [];
    for (let n = 1; n <= 8; n++) {
        at.push(h.send(`u${n}`, `r${n}`));
        h.command('gt.hit', { actor: 'ac_00000001', amount: n });
    }
    const cps = at.filter(i => h.chat[i].extra.storySuite.checkpoint);
    const cp = cps.at(-1);
    const record = h.chat[cp].extra.storySuite;
    const inside = at.filter(i => i > cps.at(-2) && i < cp)[0];
    // The window as an older write made it: without the record at `inside`.
    record.covers = record.covers.filter(sid => sid !== h.chat[inside].extra.storySuite.sid);
    h.store.rebuild();
    h.store.replaceStory(at[0], { ops: [], receipts: [] });
    const now = h.chat[cp].extra.storySuite;
    assert.ok(now.covers.includes(h.chat[inside].extra.storySuite.sid), 'the window names the record that is in it');
    // The reply inside it is deleted: a state that includes it must not be trusted.
    h.chat.splice(inside - 1, 2);
    h.store.rebuild();
    const live = JSON.stringify(h.store.head());
    const fresh = harness([guarded()], { checkpointEvery: 100000, checkpointBytes: 1 << 30 });
    const copy = clone(h.chat);
    copy.forEach((message, i) => { if (i && message.extra?.storySuite) { delete message.extra.storySuite.checkpoint; delete message.extra.storySuite.covers; delete message.extra.storySuite.coverHash; } });
    fresh.chat.splice(0, fresh.chat.length, ...copy);
    fresh.store.rebuild();
    assert.equal(live, JSON.stringify(fresh.store.head()));
});
