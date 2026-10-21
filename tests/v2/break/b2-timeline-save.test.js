// Break round F103, b2-timeline: saves (invariant #7).
//
// B-b2-timeline-1: the 400 ms UI save fired after SillyTavern had switched chats. SillyTavern 1.19 never
// saves the old chat on a switch (clearChat cancels its own debounced save), empties the shared chat
// array in place, sets the new file name, then awaits getChat. Story Block's pending timer then called
// ctx.saveChat(), which saves whatever chat is current: the UI command was lost for chat A, and when the
// timer landed while getChat was in flight an EMPTY chat was written over chat B's file.
// Now: the reader's action is saved before sdk.command answers; every save checks, in the tick it starts
// writing, that the chat is still the one the change was made in (else nothing of the open chat is
// written, and the change goes into its own chat's file).
//
// B-b2-timeline-2: ctx.saveChat is saveChatConditional in SillyTavern 1.19: it catches its own errors
// and returns quietly on a save timeout, so a failed save resolved and the store marked the state saved.
// Now the store writes the chat file itself (src/v2/chat-file.js), and a refused save throws.
//
// Since #76 wallet.receive is refused from a button, so the reader's action here is scene.present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { createStore } from '../../../src/v2/store.js';
import { readRecord } from '../../../src/v2/persist.js';
import { serveChats } from '../helpers/st-server.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const settled = async (n = 4) => { for (let i = 0; i < n; i++) await settle(); };
const present = state => [...(state?.domains?.scene?.present ?? [])];
const headOf = messages => (messages ? createStore({ chat: () => structuredClone(messages), save: async () => {} }).head() : null);

// SillyTavern's chat switch (openCharacterChat → clearChat → getChat) on the testkit's fake, in place:
// the chat array is emptied and the file name changes before the new chat arrives from the server.
function stSwitch(h, files, id) {
    const { ctx, st } = h;
    ctx.chat.length = 0;              // clearChat({ clearData: true })
    ctx.chatId = id;                  // characters[this_chid].chat = file_name
    return async function arrive() {  // getChat() resolves
        ctx.chat.push(...structuredClone(files(id)));
        await st.eventSource.emit('chat_id_changed', id);
    };
}

async function twoChats(t, { server = false } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const files = {};
    const srv = server ? serveChats(t, h) : null;
    // Without the server: the fake's saveChat writes ctx.chat to the file of the current chat id, like SillyTavern's.
    if (!srv) h.ctx.saveChat = async () => { files[h.ctx.chatId] = structuredClone(h.ctx.chat); };
    const read = id => (srv ? srv.messages(id) : structuredClone(files[id] ?? null));
    await h.send('In A.', 'Chat A.\n<Changes>\n~ place Bluewatch\n</Changes>');
    const b = [structuredClone(h.ctx.chat[0]), { name: 'You', is_user: true, mes: 'B1', extra: {} }, structuredClone(h.ctx.chat[2]),
        { name: 'You', is_user: true, mes: 'B2', extra: {} }, structuredClone(h.ctx.chat[2])];
    if (srv) srv.files['chat-B'] = [{ chat_metadata: {} }, ...b];
    else files['chat-B'] = b;
    return { h, srv, read, bLength: b.length };
}

test('B-b2-timeline-1: a UI command, then another chat opened within 400 ms: chat B is not overwritten and A keeps the command', async t => {
    const { h, read, bLength } = await twoChats(t);
    assert.equal((await h.sdk.command('scene.present', { add: 'Guard Seven' })).ok, true);
    assert.deepEqual(present(h.head()), ['Guard Seven']);
    const arrive = stSwitch(h, read, 'chat-B');     // the reader opens chat B 0-399 ms later
    t.mock.timers.tick(400);                        // a save scheduled before would fire during getChat
    await settled();
    await arrive();
    t.mock.timers.tick(1000);
    await settled();
    assert.equal(read('chat-B').length, bLength, `chat B's file still holds its ${bLength} messages (actual: ${read('chat-B').length})`);
    assert.deepEqual(present(headOf(read('chat-1'))), ['Guard Seven'], 'chat A on disk holds the command made in it');
});

test('B-b2-timeline-1: a save that comes due while another chat is being opened writes nothing of it, and puts the change into its own chat', async t => {
    const { h, srv, read, bLength } = await twoChats(t, { server: true });
    // A step Story Block takes itself (an event, a module set up) waits 400 ms for its save.
    assert.equal((await h.bus.command('scene.present', { add: 'Watcher' }, { cause: 'system' })).ok, true);
    const saves = srv.requests.length;
    // clearChat has emptied the chat; the new file name is not set yet (SillyTavern awaits in between).
    h.ctx.chat.length = 0;
    t.mock.timers.tick(400);                        // due now
    await settled();
    assert.equal(srv.requests.length, saves, 'nothing is written while a chat is being opened');
    assert.equal(h.store.dirty(), true);
    h.ctx.chatId = 'chat-B';                        // then the name, then getChat
    h.ctx.chat.push(...read('chat-B'));
    await h.st.eventSource.emit('chat_id_changed', 'chat-B');
    t.mock.timers.tick(200);                        // tried again: another chat is open now
    await settled(8);
    assert.equal(read('chat-B').length, bLength, 'chat B is never written with chat A\'s state, or empty');
    assert.ok(srv.requests.every(request => request.url !== '/api/chats/save' || request.body.file_name !== 'chat-B'), 'nothing was saved to chat B at all');
    assert.deepEqual(present(headOf(read('chat-1'))), ['Watcher'], 'chat A\'s file got its change');
    assert.equal(read('chat-1').length, 3, 'and nothing else of chat A changed');
    assert.equal(h.store.dirty(), false);
});

test('B-b2-timeline-1: without a chat file to write (no SillyTavern server), a change of a chat that is no longer open is never saved into the open one', async t => {
    const { h, read, bLength } = await twoChats(t);
    assert.equal((await h.bus.command('scene.present', { add: 'Watcher' }, { cause: 'system' })).ok, true);
    const arrive = stSwitch(h, read, 'chat-B');
    t.mock.timers.tick(400);
    await settled();
    await arrive();
    for (let i = 0; i < 6; i++) {
        t.mock.timers.tick(15000);
        await settled();
    }
    assert.equal(read('chat-B').length, bLength);
    assert.deepEqual(readRecord(read('chat-B')[4]).receipts.map(r => r.type), readRecord(h.ctx.chat[4]).receipts.map(r => r.type), 'chat B\'s records are its own');
    assert.equal(h.store.dirty(), false, 'given up after a few tries (and told)');
});

test('B-b2-timeline-1: the same chat opened again before its save: the change is carried onto the messages as read back and saved', async t => {
    const { h, read } = await twoChats(t, { server: true });
    assert.equal((await h.bus.command('scene.present', { add: 'Watcher' }, { cause: 'system' })).ok, true);
    // Chat A is read again from its file (a reload) before the save: the message objects are new ones.
    const arrive = stSwitch(h, read, 'chat-1');
    await arrive();
    assert.deepEqual(present(h.head()), [], 'the file as read back does not hold the change yet');
    t.mock.timers.tick(400);
    await settled(8);
    assert.deepEqual(present(headOf(read('chat-1'))), ['Watcher'], 'saved into chat A');
    assert.deepEqual(present(h.head()), ['Watcher'], 'and the open chat holds it again');
});

test('B-b2-timeline-2: a save the server refuses leaves the state marked unsaved, and the retry writes it (SPEC §3.3)', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const srv = serveChats(t, h);
    await h.send('One.', 'Fine.\n<Changes>\n~ place Bluewatch\n</Changes>');
    assert.equal(h.store.dirty(), false);
    srv.failing = true;
    assert.equal((await h.sdk.command('scene.present', { add: 'Ser Nine' })).ok, true, 'the action stands');
    assert.deepEqual(present(headOf(srv.messages('chat-1'))), [], 'precondition: the file does not hold the command');
    assert.equal(h.store.dirty(), true, 'the store knows the command was not saved');
    assert.equal(h.store.failing(), true);
    await assert.rejects(h.store.flush(), /the server answered 500/, 'a flush says why');
    srv.failing = false;
    for (let i = 0; i < 3 && h.store.dirty(); i++) {
        t.mock.timers.tick(4000);
        await settled();
    }
    assert.equal(h.store.dirty(), false, 'tried again until the server takes it');
    assert.deepEqual(present(headOf(srv.messages('chat-1'))), ['Ser Nine']);
});
