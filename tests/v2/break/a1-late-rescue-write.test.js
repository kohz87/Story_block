// Beta final break cell, a1. persist.js createSaver.rescueOrphans runs the rescue (runtime.js storeSaving.rescue:
// read the other chat's file, put the records on, write it back) under `answered` with no onTimeout: a rescue
// write that times out is not marked suspect (markSuspect is only called for the open chat's saves), so the
// F1-1 guard of #115 (stamps + read-backs) never covers it. When that request still reaches the server
// later, after the chat was opened again and a newer change was saved, it writes the old file over it.
// Invariant 7: the newer reply's state is lost on disk without a word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, aiMessage } from '../../../testkit/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const present = state => [...(state?.domains?.scene?.present ?? [])].sort();

test('a1-5: a timed-out rescue write that lands late does not overwrite a newer save of that chat', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const files = {};
    const late = [];
    let refuse = 0;
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
        if (url === '/api/chats/save' && refuse > 0) { refuse--; return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }); }
        if (url === '/api/chats/save' && hold && body.file_name === 'chat-1') {
            hold = false;
            return new Promise((resolve, reject) => {
                late.push(handle);
                init.signal?.addEventListener?.('abort', () => reject(new Error('aborted')));
            });
        }
        return Promise.resolve(handle());
    });
    const run = async seconds => { for (let s = 0; s < seconds; s++) { t.mock.timers.tick(1000); for (let i = 0; i < 5; i++) await settle(); } };
    await h.send('Hello.', 'Hi.');
    await h.store.flush();
    t.mock.timers.enable({ apis: ['setTimeout'] });

    refuse = 1;
    h.sdk.command('scene.present', { add: 'Ann' });      // refused once: left unsaved
    await run(0);
    // The reader opens another chat before the retry: Ann goes to chat-1's file by rescue, whose write hangs.
    files['chat-2'] = [{ chat_metadata: {} }, aiMessage('Another story.')];
    hold = true;
    await h.st.loadChat([aiMessage('Another story.')], 'chat-2');
    await run(90);
    assert.equal(late.length, 1, 'setup: the first rescue write is still in transit');
    assert.equal(h.store.dirty(), false, 'setup: a later rescue wrote Ann into chat-1');
    // Back to chat-1 (read from its file), and a newer change, saved fine.
    await h.st.loadChat(structuredClone(files['chat-1']).slice(1), 'chat-1');
    assert.deepEqual(present(h.head()), ['Ann'], 'setup: chat-1 holds the rescued change');
    assert.equal((await h.sdk.command('scene.present', { add: 'Cy' })).ok, true);
    await run(5);
    assert.equal(h.store.dirty(), false, 'setup: Cy is saved');
    late.shift()();                                      // the stale rescue write reaches the server now
    await run(400);

    h.store.rebuild();
    await h.st.loadChat(structuredClone(files['chat-1']).slice(1), 'chat-1');
    assert.deepEqual(present(h.head()), ['Ann', 'Cy'], 'chat-1 on disk still holds the newer change');
});
