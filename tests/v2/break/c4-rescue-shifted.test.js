// Breaker cell c4 (storage), pass 1: a change whose save was refused once, then the reader deletes an
// earlier message (SillyTavern deletes it and saves the chat itself, records included), then opens another
// chat before Story Block's retry. The change is handed to rescue (persist.js createSaver orphans), which
// looks each changed message up in the old chat's file by the index it had when the record was written
// (store.js unsaved: { index }, runtime.js storeSaving.rescue → carryRecord(message, messages[index])). The
// delete moved it, so the rescue fails three times and the reader is told "A change made in chat "A" was
// not saved ... its chat file no longer holds message 6 as it was" although the file holds it. With
// SillyTavern's minute-resolution send_date the stale index can also match ANOTHER reply of the same
// character (same swipe, same minute) after a shift by two, and the record is written onto it.
// Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };

test('C4-4: a change saved by SillyTavern after a delete is not told as lost when another chat is opened', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const told = [];
    const h = await createHost();
    t.after(() => h.close());
    const files = {};
    let refuse = 0;
    h.ctx.getRequestHeaders = () => ({});
    h.ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
    h.ctx.characterId = 0;
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        const body = JSON.parse(init.body);
        if (url === '/api/chats/save') {
            if (refuse > 0) { refuse--; return { ok: false, status: 500, json: async () => ({}) }; }
            files[body.file_name] = structuredClone(body.chat);
        }
        return { ok: true, status: 200, json: async () => (url === '/api/chats/get' ? structuredClone(files[body.file_name] ?? {}) : { ok: true }) };
    });
    // SillyTavern's own save: the open chat with its records.
    h.ctx.saveChat = async () => { files[h.ctx.chatId] = [{ chat_metadata: h.ctx.chatMetadata }, ...structuredClone(h.ctx.chat)]; };
    for (let i = 1; i <= 3; i++) await h.send(`u${i}`, `r${i}\n<Changes>\n+ item Rope\n</Changes>`);
    await h.store.flush();

    refuse = 1;
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    assert.equal(h.store.dirty(), true, 'its save was refused');
    await h.st.deleteMessage(1);          // the reader deletes the first user message
    await h.ctx.saveChat();
    h.store.rebuild();
    // Another chat is opened before the retry.
    await h.st.loadChat([h.ctx.chat[0]].map(m => structuredClone(m)), 'chat-B');
    files['chat-B'] = [{ chat_metadata: {} }, ...structuredClone(h.ctx.chat)];
    const saver = h.store;
    for (let i = 0; i < 40; i++) { t.mock.timers.tick(16000); await settle(); }
    await saver.flush().catch(error => told.push(error.message));
    const warned = console.warn.mock.calls.map(call => call.arguments.map(String).join(' ')).filter(text => /was not saved/.test(text));
    assert.deepEqual(warned, [], 'nothing is told as not saved: the change is in chat A\'s file');
    assert.equal(saver.dirty(), false);
});
