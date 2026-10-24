// Saves that follow the chat they were made in (SPEC §3.3; break round b2-timeline): the saver's check
// before each write, rescue, retries told once, the chat file written directly, the page closed with
// something unsaved; and the timeline fixes around them (the greeting deleted, swipe marks, damaged
// checkpoints, rewind that cannot take back, ctx.carrier.sid).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext, createHost } from '../../testkit/index.js';
import { createChatFile } from '../../src/v2/chat-file.js';
import { IDLE_MS, createSaver, markFits, readRecord, swipeMark, writeRecord } from '../../src/v2/persist.js';
import { createRewind } from '../../src/v2/rewind.js';
import { createRuntime, saveOnUnload } from '../../src/v2/runtime.js';
import { serveChats } from './helpers/st-server.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const settled = async (n = 4) => { for (let i = 0; i < n; i++) await settle(); };
const present = h => [...(h.head()?.domains?.scene?.present ?? [])];
const items = h => {
    const inv = h.head()?.domains?.inventory;
    return inv ? Object.values(inv.stacks).map(stack => inv.defs[stack.def]?.name).sort() : null;
};

// ---- the saver --------------------------------------------------------------------------------------

test('saver: a run of failed saves is told once, tried again with growing waits, and told again after one worked', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let failing = true;
    let saves = 0;
    const told = [];
    const saver = createSaver({ save: async () => { saves++; if (failing) throw new Error('500'); }, onError: error => told.push(error.message) });
    saver.touch();
    assert.equal(await saver.saveSoon(), false);
    assert.deepEqual(told, ['500']);
    for (const ms of [1000, 2000, 4000]) {
        t.mock.timers.tick(ms - 1);
        await settled();
        const before = saves;
        t.mock.timers.tick(1);
        await settled();
        assert.equal(saves, before + 1, `tried again after ${ms} ms`);
    }
    assert.deepEqual(told, ['500'], 'told once for the whole run');
    assert.equal(saver.dirty(), true);
    assert.equal(saver.failing(), true);
    failing = false;
    t.mock.timers.tick(8000);
    await settled();
    assert.equal(saver.dirty(), false);
    assert.equal(saver.failing(), false);
    failing = true;
    saver.touch();
    await saver.saveSoon();
    assert.deepEqual(told, ['500', '500'], 'a new run of failures is told again');
});

test('saver: check() right before the write: wait writes nothing and tries again; gone is clean; moved goes to rescue', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let verdict = '';
    const writes = [];
    const rescued = [];
    let n = 0;
    const saver = createSaver({
        save: change => { writes.push(change.id); },
        target: () => ({ chatId: 'A', id: ++n }),
        check: () => verdict,
        rescue: async change => { rescued.push(change.id); },
    });
    saver.touch();
    verdict = { wait: 'a chat is being opened' };
    await assert.rejects(saver.flush(), /not saved yet: a chat is being opened/);
    assert.deepEqual(writes, []);
    assert.equal(saver.dirty(), true);
    verdict = '';
    t.mock.timers.tick(200);
    await settled();
    assert.deepEqual(writes, [1], 'tried again shortly');
    saver.touch();
    verdict = { gone: 'deleted' };
    await saver.flush();
    assert.deepEqual(writes, [1]);
    assert.equal(saver.dirty(), false, 'nothing of it is left to save');
    saver.touch();
    verdict = { moved: 'another chat is open' };
    await saver.flush();
    assert.deepEqual(writes, [1], 'the open chat is not written');
    assert.deepEqual(rescued, [3], 'the change goes to its own chat');
    assert.equal(saver.dirty(), false);
    // C4-3: a chat that stays empty (a slow re-read of a big chat) is waited for: the change is never
    // dropped for it, after `waits` it is tried less often (the longest retry).
    const timers = [];
    const empty = createSaver({ save: () => { throw new Error('never written'); }, target: () => ({ chatId: 'A' }), check: () => ({ wait: 'empty' }), waits: 2,
        timers: { setTimeout: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimeout: () => {} } });
    empty.touch();
    for (let i = 0; i < 4; i++) await assert.rejects(empty.flush(), /not saved yet/);
    assert.equal(empty.dirty(), true, 'still unsaved, not dropped');
    assert.deepEqual(timers, [200, 200, 15000, 15000]);
});

test('saver: a change in one chat while another chat\'s change waits hands that one to rescue; it is given up and told after three tries', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let chat = 'A';
    const saved = [];
    const told = [];
    let rescueFails = true;
    const tries = [];
    const saver = createSaver({
        save: change => { saved.push(change.chatId); },
        target: () => ({ chatId: chat }),
        check: change => (change.chatId === chat ? '' : { moved: 'other' }),
        rescue: async change => { tries.push(change.chatId); if (rescueFails) throw new Error('the server is away'); },
        onError: error => told.push(error.message),
    });
    saver.touch();               // in A, not saved yet
    chat = 'B';
    saver.touch();               // in B
    assert.equal(await saver.saveSoon(), false, 'A is still owed');
    assert.deepEqual(saved, ['B'], 'B is saved anyway');
    assert.deepEqual(tries, ['A']);
    for (let i = 0; i < 2; i++) {
        t.mock.timers.tick(15000);
        await settled();
    }
    assert.deepEqual(tries, ['A', 'A', 'A']);
    assert.equal(told.length, 1);
    assert.match(told[0], /made in chat "A" was not saved: that chat was no longer open when it was saved, and the server is away/);
    assert.equal(saver.dirty(), false);
    rescueFails = false;
});

test('saver: the check and the write start in one tick, even behind a save that is still running', async () => {
    let chat = 'A';
    let release;
    const wrote = [];
    const rescued = [];
    const saver = createSaver({
        save: change => {
            wrote.push(`${change.chatId} in ${chat}`);
            if (wrote.length === 1) return new Promise(resolve => { release = resolve; });
            return undefined;
        },
        target: () => ({ chatId: chat }),
        check: change => (change.chatId === chat ? '' : { moved: 'other' }),
        rescue: async change => { rescued.push(change.chatId); },
    });
    saver.touch();
    const first = saver.flush();
    await settle();
    saver.touch();               // a second change while the first save runs…
    const second = saver.flush();
    await settle();
    chat = 'B';                  // …and the reader opens another chat before it is written
    release();
    await Promise.all([first, second]);
    assert.deepEqual(wrote, ['A in A'], 'nothing of A is written into B');
    assert.deepEqual(rescued, ['A'], 'the second change goes to A\'s own file');
});

test('saver: rapid reader actions while a save is writing share one more save, which writes the newest state', async () => {
    // In a 3000-message chat one write takes about half a second (measured live): actions made while it
    // runs must not each write the whole chat again.
    let n = 0;
    let release;
    const wrote = [];
    const saver = createSaver({
        save: change => {
            wrote.push(change.n);
            if (wrote.length === 1) return new Promise(resolve => { release = resolve; });
            return undefined;
        },
        target: () => ({ chatId: 'A', n }),
        check: () => '',
    });
    n++; saver.touch();
    const answers = [saver.saveSoon()];
    await settle();
    for (let i = 0; i < 4; i++) {
        n++; saver.touch();
        answers.push(saver.saveSoon());
        await settle();
    }
    release();
    const saved = await Promise.all(answers);
    assert.equal(saved.at(-1), true, 'every action has its answer once the newest state is written');
    assert.deepEqual(wrote, [1, 5], 'one save running, one more behind it with the newest change');
    assert.equal(saver.dirty(), false);
});

// ---- the chat file ----------------------------------------------------------------------------------

test('chat file: SillyTavern\'s save body for a character and a group chat; a refusal says why; read gives the file', async () => {
    const calls = [];
    let answer = { ok: true, status: 200, json: async () => ({ ok: true }) };
    const context = { getRequestHeaders: () => ({ 'X-CSRF-Token': 't' }), getCurrentChatId: () => 'Ann - 1', characters: [{ name: 'Ann', avatar: 'ann.png' }], characterId: 0 };
    const file = createChatFile({ context: () => context, fetch: (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve(answer); } });
    const place = file.where();
    assert.deepEqual(place, { chatId: 'Ann - 1', name: 'Ann', avatar: 'ann.png' });
    const done = file.write(place, [{ mes: 'Hi' }], { integrity: 'x' });
    assert.equal(calls.length, 1, 'the request is sent before write returns');
    await done;
    assert.equal(calls[0].url, '/api/chats/save');
    assert.deepEqual(calls[0].body, { ch_name: 'Ann', file_name: 'Ann - 1', avatar_url: 'ann.png', force: false,
        chat: [{ chat_metadata: { integrity: 'x' }, user_name: 'unused', character_name: 'unused' }, { mes: 'Hi' }] });
    assert.equal(calls[0].init.headers['X-CSRF-Token'], 't');
    await file.write(place, [], {}, { keepalive: true });
    assert.equal(calls[1].init.keepalive, true, 'keepalive for a small body (the page is closing)');
    answer = { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ error: 'x' }) };
    await assert.rejects(file.write(place, [], {}), /the server answered 500 Internal Server Error/);
    answer = { ok: false, status: 400, json: async () => ({ error: 'integrity' }) };
    await assert.rejects(file.write(place, [], {}), /replaced since it was opened/);
    answer = { ok: true, status: 200, json: async () => [{ chat_metadata: {} }, { mes: 'Hi' }] };
    assert.deepEqual(await file.read(place), [{ chat_metadata: {} }, { mes: 'Hi' }]);
    assert.deepEqual(calls.at(-1).body, { ch_name: 'Ann', file_name: 'Ann - 1', avatar_url: 'ann.png' });
    context.groupId = 'g1';
    assert.deepEqual(file.where(), { chatId: 'Ann - 1', group: 'g1' });
    answer = { ok: true, status: 200, json: async () => ({}) };
    await file.write(file.where(), [], {});
    assert.equal(calls.at(-1).url, '/api/chats/group/save');
    assert.deepEqual(Object.keys(calls.at(-1).body), ['id', 'chat', 'force']);
    assert.equal(createChatFile({ context: () => ({}) }).where(), null, 'not SillyTavern: no file (ctx.saveChat is used)');
});

test('runtime: a page closed with something unsaved sends it with keepalive; the browser asks first while saves fail', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const page = new EventTarget();
    const st = createFakeContext();
    const told = [];
    const h = { ctx: st.ctx };
    const server = serveChats(t, h);
    const runtime = createRuntime({ ctx: st.ctx, page, onSaveError: error => told.push(error.message) });
    runtime.turn.install({ globalName: null });
    t.after(() => runtime.turn.uninstall({ globalName: null }));
    await runtime.turn.onChatChanged();
    runtime.markReady();
    await runtime.store.flush();
    server.failing = true;
    assert.equal((await runtime.sdk.command('scene.present', { add: 'Ser Nine' })).ok, true);
    t.mock.timers.tick(IDLE_MS);           // the turn's save goes out, and fails
    await settled();
    assert.equal(told.length, 1, 'the reader is told (once)');
    assert.match(told[0], /the server answered 500/);
    server.failing = false;
    const event = new Event('beforeunload', { cancelable: true });
    page.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, 'saves were failing: the browser asks before the page goes');
    await settled();
    const last = server.requests.at(-1);
    assert.equal(last.keepalive, true);
    assert.deepEqual(last.body.chat.at(-1).extra.storySuite.receipts.at(-1).type, 'scene.present');
    assert.equal(runtime.store.dirty(), false);
    const calm = new Event('beforeunload', { cancelable: true });
    page.dispatchEvent(calm);
    assert.equal(calm.defaultPrevented, false, 'nothing unsaved: nothing asked');
    assert.equal(typeof saveOnUnload({}, null), 'function', 'no page: nothing to listen to');
});

// ---- the greeting deleted (B-b2-timeline-3) ---------------------------------------------------------

test('ensureInitial never replaces a record already on the first carrier: it gets a starting point and keeps its changes', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('a', 'A rope.\n<Changes>\n+ item Rope\n</Changes>');
    await h.store.flush();
    // The greeting is gone from the file (deleted in another session): the reply opens the chat.
    const chat = structuredClone(h.ctx.chat.slice(1));
    await h.st.loadChat(chat);
    const record = readRecord(h.ctx.chat[1]);
    assert.ok(record.checkpoint, 'it got a starting point');
    assert.deepEqual(record.receipts.map(r => r.type), ['capture.item'], 'and kept its receipt');
    assert.equal(record.sid, readRecord(chat[1]).sid);
    assert.deepEqual(items(h), ['Rope']);
});

test('the greeting deleted: the story starts where the greeting ended, and every reply keeps its record', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.sdk.command('scene.present', { add: 'Ann' });
    await h.send('a', 'A rope.\n<Changes>\n+ item Rope\n</Changes>');
    await h.sdk.command('scene.present', { add: 'Bo' });
    await h.st.deleteMessage(0);
    await h.st.deleteMessage(0);    // and the reader's first message
    assert.deepEqual(present(h), ['Ann', 'Bo']);
    assert.deepEqual(items(h), ['Rope']);
    assert.deepEqual(readRecord(h.ctx.chat[0]).receipts.map(r => r.type), ['capture.item', 'scene.present']);
    assert.deepEqual(readRecord(h.ctx.chat[0]).checkpoint.domains.scene.present, ['Ann']);
});

// ---- swipe marks (B-b2-timeline-6) ------------------------------------------------------------------

test('a swipe mark: a Continue (new date) and an edit (new opening) keep the record; a copy on another swipe does not', () => {
    const record = { v: 2, sid: 'sw_a', ops: [], receipts: [], narrated: [], spans: [] };
    const message = { is_user: false, mes: 'The door opens.\n<Changes>\n+ item Rope\n</Changes>', send_date: 'May 1, 2026 10:00am',
        swipe_id: 0, swipes: ['The door opens.'], swipe_info: [{ extra: {} }], extra: {} };
    writeRecord(message, record);
    assert.deepEqual(message.extra.storySuite.mark, swipeMark(message));
    message.mes = 'The door opens.\n\n<!-- STORY_SUITE_V2\n<Changes>\n+ item Rope\n</Changes>\n-->';    // the block hidden
    assert.ok(readRecord(message));
    message.mes = 'The door opens. A lamp is lit.';     // a Continue: the text goes on, the date moves
    message.send_date = 'May 1, 2026 10:05am';
    assert.ok(readRecord(message), 'a Continue keeps it');
    message.mes = 'The doors open. A lamp is lit.';     // and an edit of the opening on top
    assert.equal(readRecord(message), null, 'both parts moved without the store seeing either: no longer this swipe\'s');
    message.mes = 'The door opens. A lamp is lit.';
    message.send_date = 'May 1, 2026 10:00am';
    message.mes = 'The doors open.';                    // an edit alone keeps it (same date)
    assert.ok(readRecord(message));
    assert.equal(markFits(undefined, message), true, 'a record from before marks fits');
    // A reply still being written (no text yet) has no mark, so a record written then is not tied to it.
    assert.equal(swipeMark({ mes: '' }), null);
});

test('B-b2-timeline-6 (live shape): an edit followed by a Continue keeps the reply\'s record (the mark follows the edit)', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('a', 'A rope here.\n<Changes>\n+ item Rope\n</Changes>');
    await h.sdk.command('scene.present', { add: 'Bo' });
    h.ctx.chat[2].send_date = 'May 1, 2026 10:00am';
    writeRecord(h.ctx.chat[2], readRecord(h.ctx.chat[2]));
    await h.st.editMessage(2, `Two ropes here.${h.ctx.chat[2].mes.slice('A rope here.'.length)}`);
    h.ctx.chat[2].send_date = 'May 1, 2026 10:09am';   // SillyTavern dates the Continue
    await h.cont(' And a lamp.');
    assert.deepEqual(items(h), ['Rope']);
    assert.deepEqual(present(h), ['Bo']);
});

// ---- damaged checkpoints (B-b2-timeline-7) ----------------------------------------------------------

test('a damaged first record is kept as it is (read-only, empty story, listed as a Problem); a damaged later one is skipped and listed', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('a', 'A rope.\n<Changes>\n+ item Rope\n</Changes>');
    await h.store.flush();
    const chat = structuredClone(h.ctx.chat);
    // (the greeting keeps no swipe_info copy once a reply follows it: each record is kept once)
    for (const extra of [chat[0].extra, chat[0].swipe_info[0].extra]) if (extra.storySuite) extra.storySuite.checkpoint = { v: 2 };
    const before = JSON.stringify(chat);
    await h.st.loadChat(chat);
    assert.equal(JSON.stringify(h.ctx.chat), before, 'nothing in the chat was rewritten');
    assert.deepEqual(items(h), [], 'an empty story, not the damaged one and not the reply after it');
    assert.equal(h.store.readOnly().kind, 'damaged');
    const damaged = h.turn.problems().filter(problem => problem.code === 'DAMAGED');
    assert.equal(damaged.length, 1);
    assert.match(damaged[0].message, /message 0 is damaged \(its saved starting point \(checkpoint\) is damaged\)/);
    assert.equal(h.store.dirty(), false);
    // A damaged record after a good start is skipped and listed by the store.
    const fresh = await createHost();
    t.after(() => fresh.close());
    await fresh.send('a', 'A rope.\n<Changes>\n+ item Rope\n</Changes>');
    await fresh.store.flush();
    const later = structuredClone(fresh.ctx.chat);
    later[2].extra.storySuite.ops = 'x';
    later[2].swipe_info[0].extra.storySuite.ops = 'x';
    await fresh.st.loadChat(later);
    assert.ok(fresh.store.problems().some(problem => problem.code === 'DAMAGED' && problem.index === 2));
});

// ---- rewind (B-b2-timeline-8) -----------------------------------------------------------------------

test('rewind: when the changes still cannot be taken back on the branch, the reader is taken back to the chat they were in', async () => {
    const ctx = { chat: [{ is_user: false, extra: { storySuite: { receipts: [] } } }], getCurrentChatId: () => 'chat-1' };
    const opened = [];
    let flushes = 0;
    const store = {
        flush: async () => { flushes++; },
        rebuild() {},
        truncate: (index, rev, { dryRun } = {}) => {
            if (dryRun) return { dropped: ['rc_1'], rev: 1 };
            throw new Error('the branch does not hold it');
        },
    };
    const rewind = createRewind({ ctx, store, branch: async () => 'chat-1 - Branch #1', reopen: async name => { opened.push(name); } });
    const result = await rewind({ index: 0, beforeRev: 1 });
    assert.equal(result.ok, false);
    assert.match(result.message, /could not be taken back on the branch: the branch does not hold it; nothing was taken back, and you are back in "chat-1"/);
    assert.deepEqual(opened, ['chat-1']);
    assert.equal(flushes, 1);
    // Nothing to take back: no branch at all.
    const none = createRewind({ ctx, store: { ...store, truncate: () => ({ dropped: [], rev: 1 }) }, branch: async () => { throw new Error('no branch expected'); } });
    assert.equal((await none({ index: 0, beforeRev: 1 })).code, 'NOT_FOUND');
});
