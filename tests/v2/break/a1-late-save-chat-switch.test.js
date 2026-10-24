// Beta final break cell, a1. SB #115 (persist.js startRechecks) re-reads the file after a timed-out save and
// writes over a late stale copy, but only while the suspect chat is still the open one (`open`): once the
// reader switched to another chat, `holds` is never asked and a late request of the timed-out save lands
// on the old chat's file for good. Same setup as f1-late-save-overwrites-newer.test.js, plus a chat switch
// before the stale request arrives. Invariant 7 (a saved reply's state is lost on disk).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, aiMessage } from '../../../testkit/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const present = state => [...(state?.domains?.scene?.present ?? [])].sort();

test('a1-1: a late timed-out save does not overwrite a newer save after the reader opened another chat', async t => {
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
    // The reader opens another chat of the same character.
    files['chat-2'] = [{ chat_metadata: {} }, aiMessage('Another story.')];
    await h.st.loadChat([aiMessage('Another story.')], 'chat-2');
    await run(5);
    late.shift()();                    // the stale request of chat-1 reaches the server now
    await run(400);

    await h.st.loadChat(structuredClone(files['chat-1']).slice(1), 'chat-1');
    assert.deepEqual(present(h.head()), ['Ann', 'Bo', 'Cy'], 'chat-1 on disk still holds the newest change');
});
