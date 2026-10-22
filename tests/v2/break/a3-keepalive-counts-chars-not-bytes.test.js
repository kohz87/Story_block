// Breaker a3 (v2 pass 2): the 64 KiB keepalive limit is a limit in BYTES (the request body as UTF-8), but
// chat-file.js post() and runtime.js storeSaving().keepaliveFits() compare JSON.stringify(...).length, a
// count of UTF-16 code units. A chat in Japanese, Chinese, Korean or with emoji takes 2-4 bytes per unit,
// so a body of ~60k units (up to ~180 KB) is sent with keepalive: Chrome rejects that fetch outright
// ("TypeError: Failed to fetch", checked live in SillyTavern 1.19 / Chromium), and beforeunload does not ask
// because keepaliveFits() said it fits. The newest reply's state is lost on close with no warning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatFile, KEEPALIVE_MAX } from '../../../src/v2/chat-file.js';
import { storeSaving } from '../../../src/v2/runtime.js';

const bytes = text => new TextEncoder().encode(text).length;
// ~25k CJK characters: about 25k code units, about 75 KB as UTF-8.
const story = '雨の中、ミラは港の灯りを見つめていた。'.repeat(1300);

test('chat-file: a body over 64 KiB as UTF-8 is never sent with keepalive', async () => {
    const calls = [];
    const file = createChatFile({
        context: () => ({ getRequestHeaders: () => ({}), getCurrentChatId: () => 'c1', characters: [{ name: 'N', avatar: 'n.png' }], characterId: 0 }),
        fetch: (url, init) => { calls.push(init); return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); },
    });
    await file.write({ chatId: 'c1', name: 'N', avatar: 'n.png' }, [{ mes: story, is_user: false, extra: {} }], {}, { keepalive: true });
    const init = calls[0];
    assert.ok(bytes(init.body) > 64 * 1024, `the body is ${bytes(init.body)} bytes`);
    assert.ok(init.body.length <= KEEPALIVE_MAX, 'and fewer code units than KEEPALIVE_MAX (why it slips through)');
    assert.notEqual(init.keepalive, true, `a ${bytes(init.body)}-byte body was sent with keepalive (the browser refuses it)`);
});

test('storeSaving.keepaliveFits: false for a chat whose body is over 64 KiB as UTF-8', () => {
    const ctx = { chat: [{ mes: story, is_user: false, extra: {} }], chatMetadata: {}, getCurrentChatId: () => 'c1', characters: [{ name: 'N', avatar: 'n.png' }], characterId: 0, getRequestHeaders: () => ({}) };
    const saving = storeSaving({ ctx, fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }) });
    const body = JSON.stringify({ chat: [{}, ...ctx.chat] });
    assert.ok(bytes(body) > 64 * 1024);
    assert.equal(saving.keepaliveFits(), false, `keepaliveFits() said a ${bytes(body)}-byte body fits keepalive, so beforeunload does not ask`);
});
