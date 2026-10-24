// Beta final break cell, a1. SB #115 (persist.js startRechecks) reads the file back after a timed-out save and
// writes over a late stale copy only while `open`: latest.chatId is the suspect's AND check(latest) is ''. After
// the reader reloads the same chat (F5, or opens it again from the list) the old target's carrier is no longer
// in the chat and every unsaved entry was already forgotten, so check() answers { gone } and the read-backs
// are skipped: a late request of the timed-out save that lands after the reload stays in the file. Invariant 7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, aiMessage } from '../../../testkit/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const present = state => [...(state?.domains?.scene?.present ?? [])].sort();

test('a1-2: a late timed-out save does not overwrite a newer save after the reader reloaded the chat', async t => {
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
    // The reader reloads the same chat (F5, or opens it again from the list): it is read back from the file.
    const there = structuredClone(files['chat-1']).slice(1);
    await h.st.loadChat(there, 'chat-1');
    assert.deepEqual(present(h.head()), ['Ann', 'Bo', 'Cy'], 'setup: the reloaded chat shows the newest change');
    await run(5);
    late.shift()();                    // the stale request of chat-1 reaches the server now
    await run(400);

    await h.st.loadChat(structuredClone(files['chat-1']).slice(1), 'chat-1');
    assert.deepEqual(present(h.head()), ['Ann', 'Bo', 'Cy'], 'chat-1 on disk still holds the newest change');
});
