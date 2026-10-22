// Breaker cell c4 (storage), pass 1: the open chat is renamed while Story Block's save of a change is still
// on its way, and that request reaches the server after the rename (a big chat file on a slow upload; the
// rename's own request is tiny). The server writes it under the OLD file name, a chat file that no longer
// exists: SillyTavern now has a ghost copy of the chat under the old name, and the renamed chat (read back
// from its file before the save landed) lacks the change. The save answered OK, so the store forgets the
// change (persist.js createSaver: `saved = goal`; store.js verify.after skips a message no longer in the
// chat), and CHAT_RENAMED (store.renamed) only moves changes not saved yet. Invariant 7.
// Drop into Story_block/tests/v2/break/.
// Fixed (fix-sb-batch): the save that landed under the old name does not count; the change is saved
// again into the renamed chat's file. Left open: the copy under the old name (test.todo below).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };
const present = state => [...(state?.domains?.scene?.present ?? [])];

test('C4-2: a change whose save lands after the chat was renamed ends up in the renamed chat, not under the old name', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const files = { 'chat-1': [{ chat_metadata: {} }, ...structuredClone(h.ctx.chat)] };
    const late = [];       // requests on their way: the server handles them when they arrive
    let slow = false;
    h.ctx.getRequestHeaders = () => ({});
    h.ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
    h.ctx.characterId = 0;
    const ok = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });
    t.mock.method(globalThis, 'fetch', (url, init = {}) => {
        const body = JSON.parse(init.body);
        const handle = () => {
            if (url === '/api/chats/save') files[body.file_name] = structuredClone(body.chat);
            return ok(url === '/api/chats/get' ? files[body.file_name] ?? {} : { ok: true });
        };
        if (slow && url === '/api/chats/save') { slow = false; return new Promise(resolve => late.push(() => resolve(handle()))); }
        return Promise.resolve(handle());
    });
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    await h.send('Hello.', 'Hi.');
    await h.store.flush();

    slow = true;
    const command = h.sdk.command('scene.present', { add: 'Bo' });
    await settle();
    assert.equal(late.length, 1, 'the save of the change is on its way');
    // SillyTavern's renameChat: the server renames the file, the chat is read back from it, CHAT_CHANGED, CHAT_RENAMED.
    files['chat-1 renamed'] = files['chat-1'];
    delete files['chat-1'];
    await h.st.loadChat(structuredClone(files['chat-1 renamed']).slice(1), 'chat-1 renamed');
    await h.st.eventSource.emit('chat_renamed', { oldFileName: 'chat-1.jsonl', newFileName: 'chat-1 renamed.jsonl' });
    // Now the save arrives.
    late.shift()();
    await command;
    await settle();
    await h.store.flush();
    await settle();

    assert.deepEqual(present(h.head()).sort(), ['Ann', 'Bo'], 'the open (renamed) chat still has the change');
    // The request already sent lands under the old name on the server (a copy of the chat there); the
    // page cannot take back a request the server handles late. That copy is not fixed here (see below).
    h.store.rebuild();
    const onDisk = files['chat-1 renamed'].slice(1);
    await h.st.loadChat(structuredClone(onDisk), 'chat-1 renamed');
    assert.deepEqual(present(h.head()).sort(), ['Ann', 'Bo'], 'the renamed chat\'s file holds the change');
});

test.todo('C4-2 (open): no chat file is made again under the old name by a save already on its way (needs the server to refuse a save of a renamed chat, or the page to delete that copy)');
