// Beta final break cell (found by reading the code; runs here now).
// SB #113 (persist.js createSaver `answered`): a save the server does not answer within `timeout` (20 s)
// counts as failed and the next save goes out. Aborting the fetch only stops the page waiting: a request
// already on its way (a slow upload, a stuck proxy that later forwards it) is still handled by the server
// when it arrives. Both requests carry the same chat_metadata.integrity, so SillyTavern accepts the stale
// one, and it lands AFTER the newer save: the chat file on disk loses the newer change. verify.after ran
// for the newer save before the stale one landed, so nothing notices. Invariant 7.
// Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const present = state => [...(state?.domains?.scene?.present ?? [])].sort();

test('F1-1: a timed-out save that reaches the server late does not overwrite a newer save', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const files = {};
    const late = [];       // requests in transit: the server handles them when they arrive (abort or not)
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
            // The page's abort rejects its own wait; the bytes already left and still reach the server later.
            return new Promise((resolve, reject) => {
                late.push(handle);
                init.signal?.addEventListener?.('abort', () => reject(new Error('aborted')));
            });
        }
        return Promise.resolve(handle());
    });
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    await h.store.flush();
    t.mock.timers.enable({ apis: ['setTimeout'] });

    hold = true;
    h.sdk.command('scene.present', { add: 'Bo' });
    for (let s = 0; s < 60; s++) { t.mock.timers.tick(1000); for (let i = 0; i < 5; i++) await settle(); }
    assert.equal(late.length, 1, 'the first save of Bo is still in transit');
    // A newer change, saved fine.
    h.sdk.command('scene.present', { add: 'Cy' });
    for (let s = 0; s < 30; s++) { t.mock.timers.tick(1000); for (let i = 0; i < 5; i++) await settle(); }
    assert.equal(h.store.dirty(), false, 'the newer change is saved');
    // Now the stale request arrives at the server.
    late.shift()();
    for (let s = 0; s < 120; s++) { t.mock.timers.tick(1000); for (let i = 0; i < 5; i++) await settle(); }

    const name = Object.keys(files)[0];
    h.store.rebuild();
    await h.st.loadChat(structuredClone(files[name]).slice(1), name);
    assert.deepEqual(present(h.head()), ['Ann', 'Bo', 'Cy'], 'the chat file still holds the newest change after the late request lands');
});
