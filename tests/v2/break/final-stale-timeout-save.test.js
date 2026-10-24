// Final soak: a chat-file save that times out (persist.js createSaver, 20 s) is aborted on the page, but a
// request whose body already reached the server is still written by it. When that write lands after the
// retry (which carries a newer change), the chat file goes back to the older content. The saver counted the
// retry as saved, so nothing writes the file again: a reload loses the newer change. Invariant 7.
// Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('final: a timed-out save that lands late does not overwrite a newer save (stale overwrite)', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const files = {};
    const late = [];       // requests already on the server, written when released (abort cannot stop them)
    let slow = false;
    h.ctx.getRequestHeaders = () => ({});
    h.ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
    h.ctx.characterId = 0;
    t.mock.method(globalThis, 'fetch', (url, init = {}) => {
        const body = JSON.parse(init.body);
        const handle = () => {
            if (url === '/api/chats/save') files[body.file_name] = structuredClone(body.chat);
            return { ok: true, status: 200, json: async () => (url === '/api/chats/get' ? structuredClone(files[body.file_name] ?? []) : { ok: true }) };
        };
        if (slow && url === '/api/chats/save') {
            slow = false;
            // The page gives up (signal aborted) but the server has the body and writes it when it gets to it.
            return new Promise((resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                late.push(handle);
            });
        }
        return Promise.resolve(handle());
    });
    await h.send('Hello.', 'Hi.');
    await h.store.flush();
    t.mock.timers.enable({ apis: ['setTimeout'] });

    slow = true;
    const first = h.sdk.command('scene.present', { add: 'Ann' });   // its save hangs on the server
    for (let s = 0; s < 2; s++) {                                   // the turn's idle save goes out (IDLE_MS)
        t.mock.timers.tick(1000);
        for (let i = 0; i < 10; i++) await settle();
    }
    assert.equal(late.length, 1, 'the first save is on the server');
    const second = h.sdk.command('scene.present', { add: 'Bo' });   // a newer change while it hangs
    for (let s = 0; s < 40; s++) {                                  // 40 s: the first save times out, the retry carries both
        t.mock.timers.tick(1000);
        for (let i = 0; i < 5; i++) await settle();
    }
    await first; await second;
    assert.equal(h.store.dirty(), false, 'the saver counts both changes as saved');
    late.shift()();                                                 // now the server writes the old request
    for (let s = 0; s < 60; s++) { t.mock.timers.tick(1000); for (let i = 0; i < 5; i++) await settle(); }

    const name = Object.keys(files)[0];
    await h.st.loadChat(structuredClone(files[name]).slice(1), name);
    h.store.rebuild();
    assert.deepEqual([...(h.head()?.domains?.scene?.present ?? [])].sort(), ['Ann', 'Bo'], 'the chat file read back holds the newer change');
});
