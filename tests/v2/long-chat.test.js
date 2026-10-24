// Long chats (docs/v2/PERFORMANCE.md, "Long chats"): the work a reply and the reader's actions cost must not
// grow with the chat or with how long the page has been open. These tests count work (saves, replays,
// records read, whole-chat passes, message lookups), never time.
//
// * The turn's save: with a chat file, the reply's capture and the reader's actions after it are written
//   once, IDLE_MS after the last of them (at most IDLE_MAX_MS after the first); a failed save stays unsaved,
//   is told and tried again; a chat opened before the save gets nothing of it, and the change goes into its
//   own chat's file; a reply asked for before the save takes it along (nothing is written in its build).
// * The store keeps what a reply reads over the whole chat (receipts, untold) until the next write, and the
//   state at an earlier reply while its messages stay the same: equal to a fresh replay every time.
// * The cards, the notes and the extras under replies look up only the messages a change can touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { IDLE_MAX_MS, IDLE_MS, createSaver } from '../../src/v2/persist.js';
import { createStore } from '../../src/v2/store.js';
import { RECENT, createCardMount } from '../../src/v2/view/mounts/card.js';
import { RECENT_MESSAGES as NOTES_RECENT, createReplyNotes } from '../../src/v2/reply-notes.js';
import { RECENT_MESSAGES as EXTRAS_RECENT, createReplyExtras } from '../../src/v2/extras-ui.js';
import { serveChats } from './helpers/st-server.js';
import { prng, seedCrypto } from './qa/helpers/seeded.js';
import { checkInvariants } from './qa/helpers/oracle.js';
import { installFakeDom, makeMessage } from '../ui-fake-dom.js';
import { fakeChat, fakeObserverClass, fakeQuery, fakeRenderer, screen, screensWith, setupDom } from './view/mounts/helpers.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const settled = async (n = 6) => { for (let i = 0; i < n; i++) await settle(); };
const plain = value => JSON.parse(JSON.stringify(value));
const present = state => [...(state?.domains?.scene?.present ?? [])].sort();
const headOf = messages => createStore({ chat: () => structuredClone(messages), save: async () => {} }).head();

async function filed(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const srv = serveChats(t, h);
    await h.store.flush();
    const saves = () => srv.requests.filter(request => request.url === '/api/chats/save').length;
    const tick = async ms => { t.mock.timers.tick(ms); await settled(); };
    return { h, srv, saves, tick };
}

test('turn save: a reply and the reader\'s actions after it are written once, IDLE_MS after the last', async t => {
    const { h, srv, saves, tick } = await filed(t);
    assert.equal(h.store.idleSaves(), true, 'a chat file: the turn\'s save is used');
    const base = saves();
    await h.send('I look around.', 'Gulls.\n<Changes>\n+ present Fenna\n+ item Rope\n</Changes>');
    assert.equal(saves(), base, 'nothing is written inside the reply\'s capture');
    assert.equal(h.store.dirty(), true);
    for (const name of ['Ann', 'Bo', 'Cy']) {
        assert.equal((await h.sdk.command('scene.present', { add: name })).ok, true);
        assert.equal(saves(), base, `${name}: the action's result comes back without a write`);
        await tick(IDLE_MS - 100);
    }
    assert.equal(saves(), base, 'nothing while the reader keeps acting');
    await tick(100);
    assert.equal(saves(), base + 1, 'one write for the reply and three actions');
    assert.equal(h.store.dirty(), false);
    assert.deepEqual(srv.messages('chat-1'), plain(h.ctx.chat), 'the file is the chat');
    assert.deepEqual(present(headOf(srv.messages('chat-1'))), ['Ann', 'Bo', 'Cy', 'Fenna'], 'rebuilt from the file == live');
    await tick(IDLE_MAX_MS);
    assert.equal(saves(), base + 1, 'nothing more afterwards');
});

test('turn save: a reader who keeps acting is saved IDLE_MAX_MS after the first unsaved change', async t => {
    const { h, saves, tick } = await filed(t);
    const base = saves();
    for (let i = 0; i < 12; i++) {
        assert.equal((await h.sdk.command('scene.present', { add: `Guard ${i}` })).ok, true);
        await tick(1000);
    }
    assert.equal(saves(), base + 1, 'once by the window\'s end, not once per action');
    assert.equal(h.store.dirty(), true, 'the actions after it wait for the next window');
    await tick(IDLE_MS);
    assert.equal(saves(), base + 2);
    assert.equal(h.store.dirty(), false);
});

test('turn save: a failed one stays unsaved, is told once and tried again until it is written', async t => {
    const { h, srv, saves, tick } = await filed(t);
    const base = saves();
    srv.failing = true;
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true, 'the action stands');
    await tick(IDLE_MS);
    assert.equal(saves(), base + 1, 'tried');
    assert.equal(h.store.dirty(), true, 'still unsaved');
    assert.equal(h.store.failing(), true);
    srv.failing = false;
    for (let i = 0; i < 4 && h.store.dirty(); i++) await tick(4000);
    assert.equal(h.store.dirty(), false, 'tried again until the server took it');
    assert.deepEqual(present(headOf(srv.messages('chat-1'))), ['Ann']);
});

test('turn save: a reply asked for before it takes it along; nothing is written while the reply is built', async t => {
    const { h, srv, saves, tick } = await filed(t);
    await h.send('One.', 'Fine.\n<Changes>\n+ present Fenna\n</Changes>');
    await tick(IDLE_MS);
    const base = saves();
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    // The reader sends at once: the interceptor writes nothing (the action waits for the reply's save).
    let during = null;
    const interceptor = h.st.interceptor;
    h.st.interceptor = async (...args) => { await interceptor(...args); during = saves(); };
    await h.send('Two.', 'Rain.\n<Changes>\n+ present Bo\n</Changes>');
    assert.equal(during, base, 'nothing written while the reply was built');
    assert.equal(saves(), base, 'nor in its capture');
    await tick(IDLE_MS);
    assert.equal(saves(), base + 1, 'one write for the action and the reply');
    assert.deepEqual(present(headOf(srv.messages('chat-1'))), ['Ann', 'Bo', 'Fenna']);
});

test('turn save: without a chat file this page can write, the reader\'s action is saved at once (as before)', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await createHost();
    t.after(() => h.close());
    await h.send('One.', 'Fine.');
    assert.equal(h.store.idleSaves(), false);
    const before = h.st.saves.length;
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    assert.equal(h.st.saves.length, before + 1, 'saved before sdk.command answers');
    assert.equal(h.store.dirty(), false);
});

test('createSaver idle(): a 400 ms schedule inside the window keeps the window; defer() keeps its latest save', async () => {
    const pending = [];
    const timers = {
        setTimeout: (fn, ms) => { const job = { fn, ms }; pending.push(job); return job; },
        clearTimeout: job => { const at = pending.indexOf(job); if (at >= 0) pending.splice(at, 1); },
    };
    const writes = [];
    const saver = createSaver({ timers, timeout: 0, save: async () => { writes.push(1); } });
    saver.touch();
    saver.idle();
    assert.deepEqual(pending.map(job => job.ms).sort((a, b) => a - b), [IDLE_MS, IDLE_MAX_MS]);
    saver.schedule(400);
    assert.deepEqual(pending.map(job => job.ms).sort((a, b) => a - b), [IDLE_MS, IDLE_MAX_MS], 'the window stands');
    saver.defer();
    assert.deepEqual(pending.map(job => job.ms), [IDLE_MAX_MS], 'only the window\'s latest save is left');
    assert.equal(saver.pending(), true);
    pending.shift().fn();
    await settled();
    assert.equal(writes.length, 1);
    assert.equal(saver.dirty(), false);
    assert.equal(pending.length, 0);
});

// ---- the store's memos ------------------------------------------------------------------------------

async function chatOf(t, replies = 40) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    for (let n = 1; n <= replies; n++) {
        await h.send(`Turn ${n}.`, `Reply ${n}.\n<Changes>\n+ item Thing ${n % 7} | qty: 1\n${n % 5 ? '' : `+ present Guest ${n}\n`}</Changes>`);
    }
    await h.store.flush();
    return h;
}

test('store.at: an earlier reply\'s state is replayed once and kept while its messages stay the same', async t => {
    const h = await chatOf(t, 40);
    const carriers = h.ctx.chat.map((message, index) => (message.is_user ? -1 : index)).filter(index => index >= 0).slice(0, -1);
    const fresh = createStore({ chat: () => h.ctx.chat, save: async () => {} });
    const start = h.store.work();
    for (const index of carriers) assert.deepEqual(h.store.at(index), fresh.at(index), `state at ${index} == a fresh replay`);
    const first = h.store.work();
    assert.equal(first.replays - start.replays, carriers.length, 'one replay each the first time');
    for (const index of carriers) h.store.at(index);
    assert.equal(h.store.work().replays, first.replays, 'none the second time');
    // A new reply (written on the head) leaves the earlier states as they were.
    await h.send('More.', 'Yet more.\n<Changes>\n+ item Thing 1\n</Changes>');
    const after = h.store.work();
    for (const index of carriers) assert.deepEqual(h.store.at(index), fresh.at(index));
    assert.equal(h.store.work().replays, after.replays, 'still kept');
    // An edit of an earlier reply's text: that reply and the ones after it are replayed again.
    const edited = carriers.at(-3);
    h.ctx.chat[edited].mes = 'Edited by hand.';
    const before = h.store.work().replays;
    for (const index of carriers) assert.deepEqual(h.store.at(index), fresh.at(index));
    assert.ok(h.store.work().replays - before >= 1 && h.store.work().replays - before <= 3, 'only those depending on it');
    // A deleted reply in the middle (the rebuild forgets everything kept), replay == fresh.
    h.ctx.chat.splice(carriers[10] - 1, 2);
    h.store.rebuild();
    const shifted = h.ctx.chat.map((message, index) => (message.is_user ? -1 : index)).filter(index => index >= 0).slice(0, -1);
    const again = createStore({ chat: () => h.ctx.chat, save: async () => {} });
    for (const index of shifted) assert.deepEqual(h.store.at(index), again.at(index), `after the delete, ${index}`);
});

test('store.receipts and store.untold: one pass over the chat until the next write, equal to a fresh store', async t => {
    const h = await chatOf(t, 30);
    const fresh = () => createStore({ chat: () => h.ctx.chat, save: async () => {} });
    const start = h.store.work().lineScans;
    for (let i = 0; i < 5; i++) {
        assert.deepEqual(h.store.receipts(), fresh().receipts());
        assert.deepEqual(h.store.untold(), fresh().untold());
    }
    assert.equal(h.store.work().lineScans - start, 2, 'one pass for each, however often asked');
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    assert.deepEqual(h.store.receipts(), fresh().receipts(), 'a write: read again');
    assert.equal(h.store.work().lineScans - start, 3);
    h.ctx.chat.splice(h.ctx.chat.length - 2, 2);          // the last reply deleted (SillyTavern, before its event)
    assert.deepEqual(h.store.receipts(), fresh().receipts(), 'the chat changed under it: read again');
    assert.ok(Object.isFrozen(h.store.receipts()) && Object.isFrozen(h.store.receipts()[0].receipt), 'frozen');
});

test('a reply\'s build and capture read the whole chat a fixed number of times, not more as the chat grows', async t => {
    const h = await chatOf(t, 10);
    const cost = async n => {
        const before = h.store.work();
        await h.send(`Turn ${n}.`, `Reply ${n}.\n<Changes>\n+ item Thing 2\n+ present Ann\n</Changes>`);
        const after = h.store.work();
        return { replays: after.replays - before.replays, scans: after.lineScans - before.lineScans };
    };
    const early = await cost(11);
    for (let n = 12; n < 60; n++) await h.send(`Turn ${n}.`, `Reply ${n}.`);
    const late = await cost(60);
    assert.deepEqual(late, early, 'the same work at 60 replies as at 10');
    assert.ok(late.scans <= 2, `whole-chat passes per reply: ${late.scans}`);
});

// ---- cards, notes and extras --------------------------------------------------------------------------

function cardWorld({ count = 100, observer = true, cards = { 'm/sheet': true } } = {}) {
    const doc = setupDom();
    const chat = fakeChat(doc, Array.from({ length: count }, (_, i) => i + 1));
    const lookups = [];
    const Observer = observer ? fakeObserverClass() : null;
    const handlers = {};
    const mount = createCardMount({
        screens: screensWith([screen('m/sheet', ['card'])], { reader: { cards } }),
        render: fakeRenderer(),
        query: fakeQuery(),
        stateAt: chat.stateAt,
        headIndex: chat.headIndex,
        changesAt: chat.changesAt,
        carriers: chat.carriers,
        swipeAt: chat.swipeAt,
        messageElement: index => { lookups.push(index); return chat.messages[index] ?? null; },
        IntersectionObserver: Observer,
        on: (event, fn) => { (handlers[event] ??= []).push(fn); return () => {}; },
    });
    const emit = event => (handlers[event] ?? []).forEach(fn => fn({}));
    return { chat, lookups, mount, Observer, emit };
}

test('cards: a change to the story redraws the head carrier\'s cards alone; a rebuild the last RECENT and those on screen', () => {
    const { chat, lookups, mount, Observer, emit } = cardWorld();
    mount.attachAll();
    const observer = Observer.instances[0];
    assert.equal(observer.targets.size, 100, 'a chat opened: every drawn message is watched once');
    observer.show(chat.messages[5]);
    lookups.length = 0;
    chat.reads.length = 0;
    emit('committed');
    assert.deepEqual(lookups, [99], 'committed: the head carrier only');
    lookups.length = 0;
    emit('head');
    assert.equal(lookups.length, RECENT + 1, 'head: the last RECENT carriers and the one on screen');
    assert.ok(lookups.includes(5));
    assert.deepEqual([...new Set(chat.reads)], [5], 'states are built only for messages on screen');
});

test('cards: with no card screen turned on, a change looks up no message and builds no state', () => {
    const { chat, lookups, mount, emit } = cardWorld({ cards: {} });
    mount.attachAll();
    emit('head');
    emit('committed');
    assert.equal(lookups.filter(index => index !== 99).length, 0, 'no message looked up for a pass');
    assert.deepEqual(chat.reads, []);
});

function noteWorld(count) {
    const doc = installFakeDom();
    const chat = [];
    for (let i = 0; i < count; i++) {
        chat.push(i % 2 ? { is_user: false, mes: `Reply ${i}.`, extra: { storySuite: { v: 2, ops: [], receipts: [], narrated: [] } } }
            : { is_user: true, mes: `Turn ${i}.`, extra: {} });
        makeMessage(doc, i);
    }
    let queries = 0;
    const real = doc.querySelector;
    doc.querySelector = selector => { queries++; return real(selector); };
    const checked = [];
    const ctx = { chat, eventSource: null };
    return { doc, chat, ctx, checked, queries: () => queries };
}

test('notes and extras: a redraw after a new message or a rebuild looks at the last few drawn messages, with one query', () => {
    const { doc, ctx, queries } = noteWorld(200);
    const notes = createReplyNotes({ ctx, doc });
    const before = queries();
    let touched = 0;
    const read = ctx.chat.map((message, index) => new Proxy(message, { get: (target, key) => { if (key === 'extra' || key === 'mes') touched = Math.max(touched, 200 - index); return target[key]; } }));
    ctx.chat.splice(0, ctx.chat.length, ...read);
    notes.refreshAll({ recent: true });
    assert.equal(queries() - before, 0, 'no document query per message');
    assert.ok(touched <= NOTES_RECENT, `only the last ${NOTES_RECENT} looked at (reached ${touched} back)`);
    let shown = 0;
    const extras = createReplyExtras({ ctx, doc, display: () => { shown++; return {}; }, featureOn: () => true });
    extras.refreshAll({ recent: true });
    assert.equal(queries() - before, 0);
    assert.ok(shown <= EXTRAS_RECENT, `extras read ${shown} replies`);
    shown = 0;
    extras.refreshAll();
    // Only the latest reply has anything under it now (its Choices; chatter is not drawn under replies).
    assert.equal(shown, 1, 'a full pass (a chat opened) reads the latest reply alone');
});

// ---- replay == live, and the file == live, with the turn's save ----------------------------------------

test('fuzz: sends, reader actions, swipes and middle deletes with the turn\'s save: every state replays as live, and the file rebuilds as live', async t => {
    for (const seed of [5, 17, 42]) await t.test(`seed ${seed}`, async st => {
        const restore = seedCrypto(seed);
        try {
            const { h, srv, tick } = await filed(st);
            const r = prng(seed);
            for (let step = 0; step < 24; step++) {
                const roll = r.int(0, 9);
                const label = `seed ${seed} step ${step}`;
                if (roll < 6 || h.ctx.chat.length < 6) {
                    const lines = [`+ item Thing ${r.int(0, 4)} | qty: ${r.int(1, 3)}`, r.chance(0.5) ? `+ coin ${r.int(1, 20)}` : `+ present Guest ${step}`];
                    await h.send(`Step ${step}.`, `Step ${step} goes on.\n<Changes>\n${lines.join('\n')}\n</Changes>`);
                } else if (roll < 8) {
                    await h.swipe(`Another take on step ${step}.\n<Changes>\n+ item Thing ${r.int(0, 4)}\n</Changes>`);
                } else {
                    const replies = h.ctx.chat.map((message, at) => (!message.is_user && at > 2 && at < h.ctx.chat.length - 1 ? at : -1)).filter(at => at >= 0);
                    if (replies.length) {
                        const gone = r.pick(replies);
                        await h.st.deleteMessage(gone);
                        await h.st.deleteMessage(gone - 1);
                    }
                }
                for (let n = r.int(0, 3); n > 0; n--) {
                    assert.equal((await h.sdk.command('scene.present', { add: `Visitor ${step}-${n}` })).ok, true, label);
                    await tick(r.int(100, 2000));
                }
                checkInvariants(h, label);
                if (r.chance(0.5)) {
                    await tick(IDLE_MAX_MS);
                    assert.equal(h.store.dirty(), false, `${label}: saved`);
                    // The page reloaded: the chat read back from its file rebuilds to the same head.
                    const live = plain(h.head());
                    await h.st.loadChat(srv.messages('chat-1'), 'chat-1');
                    assert.deepEqual(plain(h.head()), live, `${label}: the file rebuilds as live`);
                }
            }
        } finally {
            restore();
        }
    });
});
