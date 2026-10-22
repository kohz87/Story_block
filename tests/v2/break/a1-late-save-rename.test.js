// Beta final break cell, a1. SB #115 (persist.js startRechecks): after a timed-out save, the file is read back
// only while the open chat's id is the suspect's (`open`). CHAT_RENAMED (createSaver.renamed) moves `latest`,
// the orphans and `sending` to the new name but not `suspect.chatId`, so after a rename the read-backs never
// run: a late stale request that landed just before the rename stays in the renamed file. Invariant 7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, aiMessage } from '../../../testkit/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const present = state => [...(state?.domains?.scene?.present ?? [])].sort();

test('a1-3: a late timed-out save does not overwrite a newer save when the chat is renamed before the read-back', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const files = {};
    const late = [];
    let hold = false;
    h.ctx.getRequestHeaders = () => ({});
    h.ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
    h.ctx.characterId = 0;
    t.mock.method(globalThis, 'fetch', (url, init = {}) => {
        const body = JSON.parse(init.body);
        const handle = () => {
            if (url === '/api/chats/save') files[body.file_name] = structuredClone(body.chat);
            return { ok: true, status: 200, json: async () => (url === '/api/chats/get' ? structuredClone(files[body.file_name] ?? []) : { ok: true }) };
        };
        if (hold && url === '/api/chats/save') {
            hold = false;
            return new Promise((resolve, reject) => {
                late.push(handle);
                init.signal?.addEventListener?.('abort', () => reject(new Error('aborted')));
            });
        }
        return Promise.resolve(handle());
    });
    const run = async seconds => { for (let s = 0; s < seconds; s++) { t.mock.timers.tick(1000); for (let i = 0; i < 5; i++) await settle(); } };
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    await h.store.flush();
    t.mock.timers.enable({ apis: ['setTimeout'] });

    hold = true;
    h.sdk.command('scene.present', { add: 'Bo' });
    await run(60);
    assert.equal(late.length, 1, 'the save of Bo is still in transit');
    h.sdk.command('scene.present', { add: 'Cy' });
    await run(5);
    assert.equal(h.store.dirty(), false, 'the newer change is saved');
    late.shift()();                    // the stale request reaches the server now (before the first read-back)
    await run(2);
    // Then the reader renames the chat (SillyTavern: the server renames the file, the chat is read back, CHAT_RENAMED).
    files['chat-1 renamed'] = files['chat-1'];
    delete files['chat-1'];
    await h.st.loadChat(structuredClone(files['chat-1 renamed']).slice(1), 'chat-1 renamed');
    await h.st.eventSource.emit('chat_renamed', { oldFileName: 'chat-1.jsonl', newFileName: 'chat-1 renamed.jsonl' });
    await run(400);

    h.store.rebuild();
    await h.st.loadChat(structuredClone(files['chat-1 renamed']).slice(1), 'chat-1 renamed');
    assert.deepEqual(present(h.head()), ['Ann', 'Bo', 'Cy'], 'the renamed chat on disk holds the newest change');
});
