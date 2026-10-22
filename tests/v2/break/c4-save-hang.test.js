// Breaker cell c4 (storage), pass 1: a chat-file save whose answer never comes holds every later save,
// the reader's command that started it, and the next generation, for as long as the request stays open.
// src/v2/chat-file.js write() has no timeout; persist.js createSaver runs one write at a time (exclusive)
// and turn.js's interceptor awaits store.flush() ('before the reply') before it builds the prompt. A request
// that is never answered (a dropped connection on a phone or laptop, a stuck proxy) is not an error, so it is
// never retried and nothing is told: buttons wait, and the next reply never starts (invariant 4: no stuck
// generation; invariant 7: the change is never saved, though the server is fine again).
// Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('C4-1: a save the server never answers does not hold the next generation or the reader\'s command forever', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const files = {};
    let silent = false;
    h.ctx.getRequestHeaders = () => ({});
    h.ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
    h.ctx.characterId = 0;
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        const body = JSON.parse(init.body);
        // The one request that is lost: never answered (no error either).
        if (silent) { silent = false; return new Promise(() => {}); }
        if (url === '/api/chats/save') files[body.file_name] = structuredClone(body.chat);
        return { ok: true, status: 200, json: async () => (url === '/api/chats/get' ? structuredClone(files[body.file_name] ?? []) : { ok: true }) };
    });
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    t.mock.timers.enable({ apis: ['setTimeout'] });

    silent = true;
    let command = null;
    let generation = null;
    h.sdk.command('scene.present', { add: 'Bo' }).then(result => { command = result; });
    h.send('Hello.', 'Hi.\n<Changes>\n+ item Rope\n</Changes>').then(result => { generation = result; });
    // Five minutes go by; the server answers every other request at once.
    for (let s = 0; s < 300; s++) {
        t.mock.timers.tick(1000);
        for (let i = 0; i < 5; i++) await settle();
    }
    assert.ok(command, 'the reader\'s command answered (a save that never answers times out and is tried again)');
    assert.ok(generation, 'the next generation went on (its prompt was built)');
    assert.deepEqual([...(h.head()?.domains?.scene?.present ?? [])].sort(), ['Ann', 'Bo']);
    assert.equal(h.store.dirty(), false, 'and the change is saved by a later try');
});
