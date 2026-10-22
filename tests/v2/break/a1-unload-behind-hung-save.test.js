// Beta final break cell, a1. runtime.js saveOnUnload: when the page is closed with an unsaved change, the
// change goes out with keepalive (store.saveSoon({ keepalive: true })), and the browser asks first only
// if saves have been failing. While an earlier save is still waiting for the server (a slow upload, a stuck
// proxy: up to the 20 s timeout of #113), the keepalive save waits behind it in createSaver's `exclusive`,
// so nothing is sent before the page is gone, and failing() is still false, so the reader is not asked
// either: the newest reply's state is lost without a word. Invariant 7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };

test('a1-4: closing the page while a save is still on its way sends the newest change or asks the reader', async t => {
    t.mock.method(console, 'warn', () => {});
    const page = new EventTarget();
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'window');
    globalThis.window = page;
    const h = await createHost();
    t.after(() => { h.close(); if (saved) Object.defineProperty(globalThis, 'window', saved); else delete globalThis.window; });
    const requests = [];
    let hold = false;
    h.ctx.getRequestHeaders = () => ({});
    h.ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
    h.ctx.characterId = 0;
    t.mock.method(globalThis, 'fetch', (url, init = {}) => {
        const body = JSON.parse(init.body);
        requests.push({ url, keepalive: init.keepalive === true, present: body.chat?.slice(1).map(m => m.extra?.storySuite).filter(Boolean).length ? JSON.stringify(body.chat) : '' });
        if (hold && url === '/api/chats/save') { hold = false; return new Promise(() => {}); }   // the server has not answered yet
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    });
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);
    await h.store.flush();

    hold = true;
    h.sdk.command('scene.present', { add: 'Bo' });       // its save goes out and hangs
    await settle();
    h.sdk.command('scene.present', { add: 'Cy' });       // the newest change, waiting behind it
    await settle();
    assert.equal(h.store.dirty(), true, 'setup: Cy is not saved yet');
    const before = requests.length;

    const event = new Event('beforeunload', { cancelable: true });
    page.dispatchEvent(event);
    await settle();                                     // microtasks only: the page is closing

    const sent = requests.slice(before).some(r => r.url === '/api/chats/save' && r.keepalive && r.present.includes('"Cy"'));
    assert.ok(sent || event.defaultPrevented, `the newest change goes out with keepalive, or the reader is asked before the page closes (sent: ${requests.length - before} requests, asked: ${event.defaultPrevented})`);
});
