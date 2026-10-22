// Storage tuning (docs/v2/PERFORMANCE.md): each record kept once, old receipts without `data`, and chats
// written before it. Each record is in `message.extra`; the shown swipe's copy in `swipe_info` is kept
// only on the last carrier and on carriers with more than one swipe (persist.js keepsCopy). The swipe
// moves below are SillyTavern 1.19's own (script.js swipe/deleteSwipe, bookmarks.js branch from the
// swipe picker), so what they read back from `swipe_info` is what SillyTavern would read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { KEY, RECEIPT_KEEP, readRecord } from '../../src/v2/persist.js';
import { everyCopy, relayout } from './bench/load.js';
import {
    action, fullReplay, greeting, initial, receipt, reply, setup, user,
} from './helpers/store-chat.js';

const reply3 = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const json = value => JSON.stringify(value);
const copyOf = message => message.swipe_info?.[message.swipe_id ?? 0]?.extra?.[KEY];
// Indexes of the messages whose shown swipe keeps a copy of the record.
const copies = chat => chat.map((message, index) => (copyOf(message) ? index : -1)).filter(index => index >= 0);
const lastCarrier = chat => chat.findLastIndex(message => !message.is_user);

async function host(t, options) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ st: { greeting: 'The quay.' }, ...options });
    t.after(() => h.close());
    return h;
}
const emit = (h, name, ...args) => h.st.eventSource.emit(h.ctx.eventTypes[name], ...args);

// SillyTavern's swipe to an existing swipe: the shown swipe is copied into its swipe_info first
// (syncMesToSwipe), then the new one is read back from its own (loadFromSwipeId → syncSwipeToMes).
async function stSwipe(h, index, to) {
    const message = h.ctx.chat[index];
    message.swipes[message.swipe_id] = message.mes;
    message.swipe_info[message.swipe_id] = { ...message.swipe_info[message.swipe_id], send_date: message.send_date, extra: structuredClone(message.extra) };
    syncSwipeToMes(message, to);
    await emit(h, 'MESSAGE_SWIPED', index);
}

function syncSwipeToMes(message, to) {
    message.swipe_id = to;
    message.mes = message.swipes[to];
    message.send_date = message.swipe_info[to]?.send_date;
    message.extra = structuredClone(message.swipe_info[to]?.extra) ?? {};
}

// SillyTavern's deleteSwipe: no copy of the shown swipe first; a deleted shown swipe moves to the next
// one, read back from its own swipe_info.
async function stDeleteSwipe(h, index, swipe) {
    const message = h.ctx.chat[index];
    const current = message.swipe_id;
    message.swipes.splice(swipe, 1);
    message.swipe_info.splice(swipe, 1);
    const next = swipe < current ? current - 1 : swipe > current ? current : Math.min(swipe, message.swipes.length - 1);
    message.swipe_id = next;
    await emit(h, 'MESSAGE_SWIPE_DELETED', { messageId: index, swipeId: swipe, newSwipeId: next });
    if (swipe === current) {
        syncSwipeToMes(message, next);
        await emit(h, 'MESSAGE_SWIPED', index);
    }
}

// The swipe picker's "Create Branch" on swipe `swipe` of message `index` (bookmarks.js
// getBranchChatSnapshot): chat[0..index], that message read back from the swipe's swipe_info, opened.
async function pickerBranch(h, index, swipe) {
    const snapshot = structuredClone(h.ctx.chat.slice(0, index + 1));
    syncSwipeToMes(snapshot[index], swipe);
    await h.st.loadChat(snapshot, `${h.ctx.chatId} - Branch`);
}

test('an older reply keeps its record once, in message.extra; the last reply keeps the swipe_info copy too', async t => {
    const h = await host(t);
    for (let i = 0; i < 4; i++) await h.send(`Turn ${i}.`, reply3('Gulls.', [`+ item Rope ${i} | qty: 1`]));
    const last = lastCarrier(h.ctx.chat);
    assert.deepEqual(copies(h.ctx.chat), [last]);
    assert.deepEqual(copyOf(h.ctx.chat[last]), h.ctx.chat[last].extra[KEY], 'the copy is in step');
    for (const message of h.ctx.chat) if (!message.is_user) assert.ok(readRecord(message), 'every reply keeps its own record');
    // The saved chat is the same (SillyTavern writes what the chat holds).
    await h.store.flush();
    assert.deepEqual(copies(h.st.saved()), [last]);
    // A reload reads the same state, and keeps the same copies.
    const head = json(h.head());
    await h.st.loadChat(h.st.saved());
    assert.equal(json(h.head()), head);
    assert.deepEqual(copies(h.ctx.chat), [last]);
});

test('swipe right and left on the last reply; a reply with other swipes keeps its copy once it is older', async t => {
    const h = await host(t);
    await h.send('a', reply3('A rope.', ['+ item Rope']));
    await h.send('b', reply3('A lamp.', ['+ item Lamp']));
    const index = lastCarrier(h.ctx.chat);
    const first = json(h.head());
    await h.swipe(reply3('A coin.', ['+ coin 3']));                     // a new swipe (right)
    const second = json(h.head());
    assert.notEqual(second, first);
    await h.st.swipeTo(index, 0);                                        // left, read back from swipe_info
    assert.equal(json(h.head()), first, 'swiping back brings back the first swipe\'s changes');
    await stSwipe(h, index, 1);
    assert.equal(json(h.head()), second);
    await stSwipe(h, index, 0);
    assert.equal(json(h.head()), first);
    // A reply on top: the swiped reply has two swipes, so its shown swipe's copy stays (a branch can be
    // made from either swipe); each swipe keeps its own record.
    await h.send('c', reply3('A bell.', ['+ item Bell']));
    const older = h.ctx.chat[index];
    assert.deepEqual(copies(h.ctx.chat), [index, lastCarrier(h.ctx.chat)]);
    assert.equal(older.swipe_info[0].extra[KEY].sid, older.extra[KEY].sid);
    assert.notEqual(older.swipe_info[1].extra[KEY].sid, older.extra[KEY].sid);
    const atShown = json(h.store.at(index));
    // The swipe picker's branch from the shown swipe reads it back from swipe_info: same state.
    const before = structuredClone(h.ctx.chat);
    await pickerBranch(h, index, 0);
    assert.equal(json(h.head()), atShown, 'a branch from the shown swipe keeps its changes');
    await h.st.loadChat(before, 'main');
    await pickerBranch(h, index, 1);
    assert.equal(json(h.head()), second, 'a branch from the other swipe has that swipe\'s changes');
});

test('deleting the last reply gives the one before it its copy back, and swiping it rolls back as before', async t => {
    const h = await host(t);
    await h.send('a', reply3('A rope.', ['+ item Rope']));
    await h.send('b', reply3('A lamp.', ['+ item Lamp']));
    const index = lastCarrier(h.ctx.chat);
    const atIndex = json(h.head());
    await h.send('c', reply3('A bell.', ['+ item Bell']));
    assert.equal(copyOf(h.ctx.chat[index]), undefined, 'older, one swipe: no copy');
    await h.st.deleteMessage(h.ctx.chat.length - 1);
    await h.st.deleteMessage(h.ctx.chat.length - 1);
    assert.equal(lastCarrier(h.ctx.chat), index);
    assert.equal(json(h.head()), atIndex);
    assert.deepEqual(copyOf(h.ctx.chat[index]), h.ctx.chat[index].extra[KEY], 'the last reply again: its copy is back');
    // The fake's swipe reads back from swipe_info without copying first (stricter than SillyTavern).
    await h.swipe(reply3('Nothing.', []));
    assert.notEqual(json(h.head()), atIndex);
    await h.st.swipeTo(index, 0);
    assert.equal(json(h.head()), atIndex);
});

test('deleting a swipe, shown or not, leaves each swipe its own record', async t => {
    const h = await host(t);
    await h.send('a', reply3('A rope.', ['+ item Rope']));
    const index = lastCarrier(h.ctx.chat);
    const states = [json(h.head())];
    await h.swipe(reply3('A lamp.', ['+ item Lamp']));
    states.push(json(h.head()));
    await h.swipe(reply3('A bell.', ['+ item Bell']));
    states.push(json(h.head()));
    await stSwipe(h, index, 1);
    assert.equal(json(h.head()), states[1]);
    await stDeleteSwipe(h, index, 0);                    // not the shown one
    assert.equal(h.ctx.chat[index].swipe_id, 0);
    assert.equal(json(h.head()), states[1], 'the shown swipe keeps its changes when an earlier one goes');
    await stDeleteSwipe(h, index, 0);                    // the shown one: the next is read back
    assert.equal(json(h.head()), states[2]);
    // A reply on top, then the older reply's swipe picker branch: the one swipe left still has its own.
    await h.send('b', reply3('Quiet.', ['+ item Cup']));
    assert.equal(copyOf(h.ctx.chat[index]), undefined, 'one swipe left: no copy once older');
    assert.equal(json(h.store.at(index)), states[2]);
});

test('a record SillyTavern copied into a new swipe is still not that swipe\'s, with one copy kept', async t => {
    const h = await host(t);
    await h.send('a', reply3('A rope.', ['+ item Rope']));
    const before = json(h.store.at(0));
    const index = lastCarrier(h.ctx.chat);
    await h.swipe('No changes this time.');
    // The new swipe started from SillyTavern's copy of swipe 0's record in message.extra: not its own.
    assert.equal(json(h.head()), before);
    assert.notEqual(h.ctx.chat[index].extra[KEY]?.sid, h.ctx.chat[index].swipe_info[0].extra[KEY].sid);
    await h.send('b', 'Still nothing.');
    assert.equal(json(h.store.at(index)), before);
    await h.st.loadChat(structuredClone(h.ctx.chat));
    assert.equal(json(h.store.at(index)), before, 'and after a reload');
});

test('a chat written before (a copy on every reply, checkpoints every 20) loads and replays the same', async t => {
    const h = await host(t);
    for (let i = 0; i < 45; i++) await h.send(`Turn ${i}.`, reply3('Gulls.', [`+ item Rope ${i % 7} | qty: 1`, '+ coin 1']));
    const fresh = structuredClone(h.ctx.chat);
    const old = everyCopy(relayout(fresh, { every: 20, bytes: 32 * 1024 }));
    assert.ok(old.filter(message => readRecord(message)?.checkpoint).length >= 3, 'the old checkpoint rule');
    assert.equal(copies(old).length, old.filter(message => !message.is_user).length, 'a copy on every reply');
    const states = fresh.map((_, i) => json(setup(fresh).store.at(i)));
    const { store } = setup(old);
    for (let i = 0; i < old.length; i++) assert.equal(json(store.at(i)), states[i], `message ${i}`);
    // Its next rebuild drops the copies it no longer keeps (saved with the next save); nothing else moves.
    store.rebuild();
    assert.deepEqual(copies(old), [lastCarrier(old)]);
    for (let i = 0; i < old.length; i++) assert.equal(json(store.at(i)), states[i], `message ${i} after the rebuild`);
    // Opened in the host: the same head, and a new reply goes on as before.
    await h.st.loadChat(old);
    assert.equal(json(h.head()), states.at(-1));
    await h.send('again', reply3('More.', ['+ coin 2']));
    assert.equal(h.head().domains.inventory.wallets.party.coin, 47);
});

// ---- receipts more than RECEIPT_KEEP carriers back drop `data` ------------------------------------

test(`receipts ${RECEIPT_KEEP} carriers back keep everything but data; the state and the untold list do not move`, () => {
    const { ctx, store } = setup([greeting()]);
    store.ensureInitial(initial());
    const turns = RECEIPT_KEEP + 30;
    for (let i = 1; i <= turns; i++) {
        ctx.chat.push(user(`turn ${i}`), reply(`reply ${i}`));
        // Every 50th action is not told by any later reply, so it stays untold however old it is.
        action(store, `it_${i}`, i, { data: { shown: i }, line: `h${i}`, seed: i, cause: i % 2 ? 'story' : 'ui' });
        if (i % 50) store.setNarrated(ctx.chat.length - 1, [ctx.chat.at(-1).extra.storySuite.receipts[0].id]);
    }
    const carriers = ctx.chat.map((message, index) => (message.is_user ? -1 : index)).filter(index => index >= 0);
    const back = index => carriers.length - 1 - carriers.indexOf(index);
    for (const index of carriers.slice(1)) {
        const [kept] = ctx.chat[index].extra.storySuite.receipts;
        const n = carriers.indexOf(index);
        if (back(index) >= RECEIPT_KEEP) {
            assert.equal(Object.hasOwn(kept, 'data'), false, `message ${index} is ${back(index)} back`);
            assert.deepEqual(
                [kept.type, kept.module, kept.cause, kept.seed, kept.summary, kept.narrate, kept.line, kept.rev],
                ['test.do', 'test', n % 2 ? 'story' : 'ui', n, 'Something happens.', true, `h${n}`, n],
                'every other field stays',
            );
        } else {
            assert.deepEqual(kept.data, { shown: n }, `message ${index} is only ${back(index)} back`);
        }
    }
    for (let i = 0; i < ctx.chat.length; i += 17) assert.deepEqual(store.at(i), fullReplay(ctx.chat, i), `message ${i}`);
    assert.deepEqual(store.untold().map(r => r.rev), [50, 100, 150, 200], 'old untold receipts are still untold, and told once a reply tells them');
    assert.equal(store.receipts().length, turns);
});

test('a chat with every receipt\'s data trims the old ones on its rebuild, and its state stays', () => {
    const { ctx, store } = setup([greeting()]);
    store.ensureInitial(initial());
    for (let i = 1; i <= RECEIPT_KEEP + 5; i++) {
        ctx.chat.push(user(), reply());
        action(store, `it_${i}`, i, { data: { shown: i } });
    }
    // As written before: every receipt keeps its data (and a copy on every reply).
    const old = everyCopy(ctx.chat);
    for (const message of old) for (const r of message.extra.storySuite?.receipts ?? []) r.data = { shown: r.rev };
    for (const message of old) {
        const info = message.swipe_info?.[0];
        if (info?.extra?.[KEY]) info.extra[KEY] = structuredClone(message.extra[KEY]);
    }
    const { store: reader } = setup(old);
    const head = reader.head();
    const untold = reader.untold().map(r => r.id);
    reader.rebuild();
    const kept = old.filter(message => message.extra.storySuite?.receipts?.some(r => Object.hasOwn(r, 'data'))).length;
    assert.equal(kept, RECEIPT_KEEP, 'the last RECEIPT_KEEP replies keep data');
    assert.deepEqual(reader.head(), head);
    assert.deepEqual(reader.untold().map(r => r.id), untold);
    // Re-read on a trimmed reply still works: its kept receipts stay, without data.
    const index = 4;
    reader.replaceStory(index, { ops: [{ op: 'add', path: '/domains/scene/place', value: 'Reread' }], receipts: [receipt({ cause: 'story', rev: 1 })] });
    assert.equal(reader.head().domains.scene.place, 'Reread');
    assert.equal(old[index].extra.storySuite.receipts.length, 2);
});
