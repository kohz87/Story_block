// Breaker cell c4 (storage), pass 1: the r3-1 fix (SB #95, runtime.js markUsed: a chat holding story state
// is marked chat_metadata.tainted when Story Block saves it) does not cover a change that reaches its chat's
// file by rescue. A new chat holds only the greeting; the reader's first action on it (people present, the
// character made in the wizard) is saved, the server refuses that one save, and the reader opens another chat
// before the retry. The retry finds another chat open and rescues the change into the first chat's file
// (runtime.js storeSaving.rescue): its records only, with the file's own header, which is not tainted. The
// next time that chat is open, a character card edit (createOrEditCharacter's pristine branch) or a rename
// makes the greeting again from the card and the record on it is gone (page and file).
// Invariant 7. Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { aiMessage } from '../../../testkit/fake-st.js';

const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };

// script.js createOrEditCharacter, the pristine-chat branch.
async function stCardSaved(h) {
    const { ctx, st } = h;
    const pristine = !ctx.chatMetadata?.tainted && ctx.chat.length === 1 && !ctx.chat[0].is_user && !ctx.chat[0].is_system;
    if (!pristine) return false;
    ctx.chat.splice(0, ctx.chat.length, aiMessage('The story begins.', { name: ctx.name2 }));
    await st.eventSource.emit('message_received', 0, 'first_message');
    await ctx.saveChat();
    return true;
}

test('C4-5: a pristine chat whose first change was rescued into its file keeps it through a card edit', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await createHost();
    t.after(() => h.close());
    // SillyTavern made the new chat's file with the greeting.
    const files = { 'chat-1': [{ chat_metadata: {} }, ...structuredClone(h.ctx.chat)], 'chat-B': [{ chat_metadata: { tainted: true } }, aiMessage('Other chat.')] };
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
    h.ctx.saveChat = async () => { files[h.ctx.chatId] = [{ chat_metadata: h.ctx.chatMetadata }, ...structuredClone(h.ctx.chat)]; };
    const open = async id => {
        const [header, ...messages] = structuredClone(files[id]);
        h.ctx.chatMetadata = header.chat_metadata ?? {};
        await h.st.loadChat(messages, id);
    };

    refuse = 1;
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    assert.equal(h.store.dirty(), true, 'its save was refused');
    await open('chat-B');                 // the reader opens another chat before the retry
    for (let i = 0; i < 10; i++) { t.mock.timers.tick(2000); await settle(); }
    assert.equal(h.store.dirty(), false, 'the change was rescued into chat-1\'s file');
    assert.ok(files['chat-1'][1].extra?.storySuite, 'the greeting\'s record is in the file');

    await open('chat-1');
    assert.deepEqual([...(h.head()?.domains?.scene?.present ?? [])], ['Ann']);
    await stCardSaved(h);
    h.store.rebuild();
    assert.deepEqual([...(h.head()?.domains?.scene?.present ?? [])], ['Ann'], 'the greeting\'s state survives the card edit (the rescued file is marked as used)');
});
