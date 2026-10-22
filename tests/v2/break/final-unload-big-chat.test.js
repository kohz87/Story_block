// Final breaker report: on unload a save body over 64 KiB cannot go out with keepalive (chat-file.js
// KEEPALIVE_MAX), which is most real chats, and nothing saved on pagehide or when the tab was hidden.
// runtime.js saveOnUnload: the newest state is saved as soon as the page is hidden (visibilitychange) or
// hidden for good (pagehide), and the browser asks before closing whenever the unsaved body is too big
// for keepalive. SillyTavern 1.19 cannot write part of a chat file, so no smaller keepalive is possible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { saveOnUnload, storeSaving } from '../../../src/v2/runtime.js';

const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };

async function paged(t) {
    t.mock.method(console, 'warn', () => {});
    const page = new EventTarget();
    page.document = new EventTarget();
    page.document.visibilityState = 'visible';
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'window');
    globalThis.window = page;
    const h = await createHost();
    t.after(() => { h.close(); if (saved) Object.defineProperty(globalThis, 'window', saved); else delete globalThis.window; });
    const server = { saves: [], hold: false, timers: [] };
    h.ctx.getRequestHeaders = () => ({});
    h.ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
    h.ctx.characterId = 0;
    t.mock.method(globalThis, 'fetch', (url, init = {}) => {
        if (url === '/api/chats/save') {
            server.saves.push({ keepalive: init.keepalive === true, size: init.body.length });
            if (server.hold) return new Promise(() => {});
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    });
    return { h, page, server };
}

test('beforeunload with a save on its way: the newest state goes out with keepalive past it, and the reader is asked', async t => {
    const { h, page, server } = await paged(t);
    await h.store.flush();
    server.hold = true;
    h.sdk.command('scene.present', { add: 'Ann' });   // saved at once; it hangs
    await settle();
    server.hold = false;
    const before = server.saves.length;
    // A second, newer change waits behind the one on its way.
    h.sdk.command('scene.present', { add: 'Bo' });
    await settle();
    const event = new Event('beforeunload', { cancelable: true });
    page.dispatchEvent(event);
    await settle();
    const sent = server.saves.slice(before);
    assert.ok(sent.some(save => save.keepalive), 'the newest state went out with keepalive');
    assert.equal(event.defaultPrevented, true, 'asked: a save is still on its way');
});

test('beforeunload: an unsaved chat too big for keepalive always asks first; a small one does not', () => {
    const page = new EventTarget();
    const sent = [];
    const store = { dirty: () => true, inFlight: () => false, failing: () => false, saveUrgent: options => { sent.push(options); return Promise.resolve(true); } };
    let fits = false;
    const off = saveOnUnload(store, page, { fits: () => fits });
    const big = new Event('beforeunload', { cancelable: true });
    page.dispatchEvent(big);
    assert.equal(big.defaultPrevented, true, 'too big: asked');
    fits = true;
    const small = new Event('beforeunload', { cancelable: true });
    page.dispatchEvent(small);
    assert.equal(small.defaultPrevented, false, 'small: it goes out with keepalive, nobody is asked');
    assert.deepEqual(sent, [{ keepalive: true }, { keepalive: true }], 'sent both times');
    off();
    page.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    assert.equal(sent.length, 2, 'removed');
});

test('keepaliveFits: measured on the chat as it would be sent', async t => {
    const { h } = await paged(t);
    const saving = storeSaving({ ctx: h.ctx });
    assert.equal(saving.keepaliveFits(), true);
    await h.send('Hello.', `Hi. ${'long story '.repeat(8000)}`);   // about 88 KB of chat
    assert.equal(saving.keepaliveFits(), false);
    assert.equal(storeSaving({ ctx: { ...h.ctx, getRequestHeaders: undefined } }).keepaliveFits(), true, 'no file of its own (ctx.saveChat): not measured');
});

test('hidden (tab switch, phone) and pagehide save at once; a save on its way with the newest change is not sent twice on hidden', async t => {
    const { h, page, server } = await paged(t);
    await h.store.flush();
    server.hold = true;
    h.sdk.command('scene.present', { add: 'Ann' });   // in flight, carrying the newest change
    await settle();
    server.hold = false;
    const before = server.saves.length;
    page.document.visibilityState = 'hidden';
    page.document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    assert.equal(server.saves.length, before, 'hidden: the save on its way already carries it');
    h.sdk.command('scene.present', { add: 'Bo' });    // waits behind the hung one
    await settle();
    page.document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    assert.equal(server.saves.length, before + 1, 'hidden: the newer change goes out at once, past it');
    assert.equal(server.saves.at(-1).keepalive, true);
    page.dispatchEvent(new Event('pagehide'));
    await settle();
    assert.equal(server.saves.length, before + 2, 'pagehide: sent again with keepalive (the page may cut the other off)');
    assert.equal(server.saves.at(-1).keepalive, true);
});

test('hidden with nothing unsaved sends nothing', async t => {
    const { h, page, server } = await paged(t);
    await h.store.flush();
    const before = server.saves.length;
    page.document.visibilityState = 'hidden';
    page.document.dispatchEvent(new Event('visibilitychange'));
    page.dispatchEvent(new Event('pagehide'));
    await settle();
    assert.equal(server.saves.length, before);
});
