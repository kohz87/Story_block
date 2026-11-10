// The wake check (src/v2/runtime/wake.js): a tab that comes back asks the server before it saves. A chat another
// device changed is reloaded, not overwritten; a newer chat file is told of; one device and one tab see nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../testkit/index.js';
import { createChatFile } from '../../src/v2/chat-file.js';
import { IDLE_MS, createSaver } from '../../src/v2/persist.js';
import { createRuntime } from '../../src/v2/runtime.js';
import { createWakeCheck, fingerprint } from '../../src/v2/runtime/wake.js';
import { serveChats } from './helpers/st-server.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const settled = async (n = 6) => { for (let i = 0; i < n; i++) await settle(); };
const saves = server => server.requests.filter(r => r.url === '/api/chats/save');
const lists = server => server.requests.filter(r => r.url === '/api/chats/search');

// A page with a document whose visibility can be changed, a runtime on it, and a server standing in for SillyTavern's.
async function tab(t, { serve = true } = {}) {
    const page = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    page.document = doc;
    const st = createFakeContext();
    const h = { ctx: st.ctx };
    const server = serve ? serveChats(t, h) : null;
    const toasts = [];
    const reloads = [];
    // SillyTavern's reload ends in CHAT_CHANGED, which Story Block reads (the wake check takes that as the proof of the reload).
    let runtime = null;
    st.ctx.reloadCurrentChat = async () => { reloads.push(1); await runtime.turn.onChatChanged(); };
    runtime = createRuntime({ ctx: st.ctx, page, onWake: (text, kind) => toasts.push({ text, kind }), onSaveError: () => {} });
    runtime.turn.install({ globalName: null });
    t.after(() => runtime.turn.uninstall({ globalName: null }));
    await runtime.turn.onChatChanged();
    runtime.markReady();
    await runtime.store.flush();
    const show = async () => { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); await settled(); };
    const hide = async () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); await settled(); };
    const chatId = () => st.ctx.getCurrentChatId();
    return { page, doc, st, server, toasts, reloads, runtime, show, hide, chatId };
}
const otherDevice = (server, id) => server.files[id].push({ name: 'Narrator', is_user: false, mes: 'Played on the other device.', send_date: '2026-11-10T09:00:00.000Z', extra: {} });

test('discarding a stale chat keeps unsaved work left in other chats', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let chat = 'A';
    const saved = [];
    const rescued = [];
    const saver = createSaver({
        target: () => ({ chatId: chat }),
        check: change => change.chatId === chat ? '' : { moved: 'another chat' },
        save: change => saved.push(change.chatId),
        rescue: async change => rescued.push(change.chatId),
    });
    saver.touch();
    chat = 'B';
    saver.touch();
    assert.equal(saver.discard('B'), true);
    assert.equal(saver.dirty(), true, 'A still needs a rescue');
    await saver.flush();
    assert.deepEqual(rescued, ['A']);
    assert.deepEqual(saved, [], 'B is never written');
    assert.equal(saver.dirty(), false);

    chat = 'A';
    saver.touch();
    chat = 'B';
    assert.equal(saver.discard('B'), false, 'B has no work to drop');
    await saver.flush();
    assert.deepEqual(rescued, ['A', 'A'], 'A is still rescued');
});

test('discarding an orphan during another rescue does not remove or write unrelated work', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let chat = 'A';
    let release;
    const rescued = [];
    const saver = createSaver({
        target: () => ({ chatId: chat }),
        check: change => change.chatId === chat ? '' : { moved: 'another chat' },
        save: () => { throw new Error('the open chat has no work to save'); },
        rescue: change => {
            rescued.push(change.chatId);
            if (change.chatId === 'A') return new Promise(resolve => { release = resolve; });
        },
    });
    saver.touch();
    chat = 'B'; saver.touch();
    chat = 'C'; saver.touch();
    const saving = saver.saveSoon();
    await settled();
    chat = 'B';
    assert.equal(saver.discard('B'), true);
    release();
    await saving;
    assert.deepEqual(rescued, ['A', 'C']);
    assert.equal(saver.dirty(), false);
});

test('discarding an in-flight orphan leaves the next orphan queued', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let chat = 'B';
    let release;
    const rescued = [];
    const saver = createSaver({
        target: () => ({ chatId: chat }),
        check: change => change.chatId === chat ? '' : { moved: 'another chat' },
        save: () => { throw new Error('the open chat has no work to save'); },
        rescue: change => {
            rescued.push(change.chatId);
            if (change.chatId === 'B') return new Promise(resolve => { release = resolve; });
        },
    });
    saver.touch();
    chat = 'A'; saver.touch();
    chat = 'C'; saver.touch();
    const saving = saver.saveSoon();
    await settled();
    chat = 'B';
    assert.equal(saver.discard('B'), true);
    release();
    await saving;
    assert.deepEqual(rescued, ['B', 'A', 'C'], 'A and C are still rescued');
    assert.equal(saver.dirty(), false);
});

test('a discarded orphan queued behind a rescue is not written again', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let chat = 'A';
    let release;
    const rescued = [];
    const saver = createSaver({
        target: () => ({ chatId: chat }),
        check: change => change.chatId === chat ? '' : { moved: 'another chat' },
        save: () => {},
        rescue: change => {
            rescued.push(change.chatId);
            if (change.chatId === 'A') return new Promise(resolve => { release = resolve; });
        },
    });
    saver.touch();
    chat = 'B'; saver.touch();
    const first = saver.saveSoon();
    await settled();
    const second = saver.saveSoon();
    await settled();
    chat = 'A';
    assert.equal(saver.discard('A'), true);
    release();
    await Promise.all([first, second]);
    assert.equal(rescued.filter(id => id === 'A').length, 1, 'only the already-started rescue ran');
});

test('a completed old save cannot revive discarded changes', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let release;
    let writes = 0;
    const saver = createSaver({
        target: () => ({ chatId: 'A' }),
        save: () => { writes++; return new Promise(resolve => { release = resolve; }); },
    });
    saver.touch();
    const saving = saver.saveSoon();
    await settled();
    saver.touch();
    assert.equal(saver.discard('A'), true);
    release();
    await saving;
    assert.equal(saver.dirty(), false);
    assert.equal(writes, 1);
});

test('stale tab: the server holds a newer copy: nothing is saved, the chat is reloaded, the toast says so', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    await x.hide();
    otherDevice(x.server, x.chatId());
    const before = saves(x.server).length;
    await x.show();
    assert.equal(saves(x.server).length, before, 'no save');
    assert.equal(x.reloads.length, 1);
    assert.deepEqual(x.toasts, [{ text: 'This chat changed on another device. Reloaded the newer copy.', kind: 'warning' }]);
});

test('stale tab: unsaved changes of the old tab are dropped, and the toast counts them', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    x.server.failing = true;
    assert.equal((await x.runtime.sdk.command('scene.present', { add: 'Ser Nine' })).ok, true);
    await settled();
    assert.equal(x.runtime.store.dirty(), true);
    const unsaved = x.runtime.store.unsavedCount();
    assert.ok(unsaved >= 1);
    x.server.failing = false;
    otherDevice(x.server, x.chatId());
    const before = saves(x.server).length;
    await x.show();
    t.mock.timers.tick(60000);
    await settled();
    assert.equal(saves(x.server).length, before, 'the stale copy is never written, not even by a retry');
    assert.equal(x.runtime.store.dirty(), false);
    assert.equal(x.reloads.length, 1);
    assert.equal(x.toasts[0].text, `This chat changed on another device. Reloaded the newer copy. ${unsaved} unsaved change${unsaved === 1 ? '' : 's'} in this tab ${unsaved === 1 ? 'was' : 'were'} dropped.`);
});

test('stale tab: a save asked for while the check is pending waits for it and is dropped when the chat is stale', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    otherDevice(x.server, x.chatId());
    x.server.failing = true;
    await x.runtime.sdk.command('scene.present', { add: 'Ser Nine' });
    x.server.failing = false;
    const before = saves(x.server).length;
    x.doc.dispatchEvent(new Event('visibilitychange'));       // visible: the check starts…
    const saving = x.runtime.store.saveSoon();                  // …and a save asks at the same moment
    await saving;
    await settled();
    assert.equal(saves(x.server).length, before);
    assert.equal(x.reloads.length, 1);
});

test('own keepalive then wake: nothing (no toast, no reload, no save): the fingerprint follows the tab\'s own writes', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    x.server.failing = true;
    await x.runtime.sdk.command('scene.present', { add: 'Ser Nine' });
    x.server.failing = false;
    await x.hide();                                              // the keepalive save goes out
    const kept = saves(x.server).at(-1);
    assert.equal(kept.keepalive, true);
    const count = saves(x.server).length;
    const listed = lists(x.server).length;
    await x.show();
    assert.equal(lists(x.server).length, listed + 1, 'asked the list, not the chat file');
    assert.equal(x.server.requests.filter(r => r.url === '/api/chats/get').length, 0);
    assert.deepEqual(x.toasts, []);
    assert.equal(x.reloads.length, 0);
    assert.equal(saves(x.server).length, count);
});

test('one device, one tab: wakes change nothing and the saves are the same as without them', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    for (let i = 0; i < 3; i++) {
        await x.hide();
        await x.show();
        x.doc.dispatchEvent(new Event('resume'));
        x.page.dispatchEvent(new Event('pageshow'));
        await settled();
    }
    await x.runtime.sdk.command('scene.present', { add: 'Ser Nine' });
    t.mock.timers.tick(IDLE_MS);
    await settled();
    await x.show();
    assert.deepEqual(x.toasts, []);
    assert.equal(x.reloads.length, 0);
    assert.equal(x.runtime.store.dirty(), false);
    assert.ok(saves(x.server).every(r => r.url === '/api/chats/save'));
});

test('a newer chat file of the character: a warning toast only, once; the open chat is kept', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    x.server.files['Narrator - newer'] = [{ chat_metadata: {} }, { name: 'Narrator', mes: 'Later.', send_date: '2030-01-01T00:00:00.000Z', extra: {} }];
    const before = saves(x.server).length;
    await x.show();
    await x.show();
    assert.deepEqual(x.toasts, [{ text: 'A newer chat exists for this character: Narrator - newer. Open it from Manage chats.', kind: 'info' }]);
    assert.equal(x.reloads.length, 0);
    assert.equal(saves(x.server).length, before);
});

test('server unreachable or silent: saving goes on as it did, and the reader is told once', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    x.server.listing = 'down';
    await x.show();
    await x.show();
    assert.deepEqual(x.toasts.map(n => n.kind), ['warning']);
    assert.match(x.toasts[0].text, /Could not check whether this chat changed on another device.*Saving as usual/);
    await x.runtime.sdk.command('scene.present', { add: 'Ser Nine' });
    t.mock.timers.tick(IDLE_MS);
    await settled();
    assert.equal(x.runtime.store.dirty(), false, 'saved as ever');
    // silent: the save waits for the answer, up to the limit
    x.server.listing = '';
    await x.show();                                              // answered again: a later outage is told again
    x.server.listing = 'hang';
    x.toasts.length = 0;
    const count = saves(x.server).length;
    x.doc.dispatchEvent(new Event('visibilitychange'));
    await x.runtime.sdk.command('scene.present', { add: 'Ser Ten' });
    t.mock.timers.tick(IDLE_MS);
    await settled();
    assert.equal(saves(x.server).length, count, 'held while the check is pending');
    t.mock.timers.tick(8000);
    await settled();
    assert.ok(saves(x.server).length > count, 'then saved as today');
    assert.equal(x.toasts.length, 1);
});

test('a long hidden time with the event missed: the first save after it asks first', () => {
    let at = 0;
    const file = { where: () => ({ chatId: 'c' }), list: () => new Promise(() => {}) };
    const wake = createWakeCheck({ file, chat: () => [], store: {}, now: () => at, longMs: 1000 });
    assert.equal(wake.hold(), null);
    at = 1001;
    assert.ok(wake.hold() instanceof Promise);
});

test('testkit and temporary chats: no file to list, so nothing is asked and nothing is said', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const asked = t.mock.method(globalThis, 'fetch', async () => { throw new Error('no request expected'); });
    const x = await tab(t, { serve: false });
    await x.hide();
    await x.show();
    x.page.dispatchEvent(new Event('pageshow'));
    await settled();
    assert.equal(asked.mock.callCount(), 0);
    assert.deepEqual(x.toasts, []);
    assert.equal(x.reloads.length, 0);
});

test('the chat list: its request for a character and for a group; the fingerprint of messages', async () => {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => [{ file_name: 'a' }] }; };
    const make = ctx => createChatFile({ context: () => ({ getRequestHeaders: () => ({}), getCurrentChatId: () => 'a', ...ctx }), fetch });
    const character = make({ characters: [{ name: 'N', avatar: 'n.png' }], characterId: 0 });
    const group = make({ groupId: 'g1' });
    assert.deepEqual(await character.list(character.where()), [{ file_name: 'a' }]);
    await group.list(group.where());
    assert.deepEqual(calls, [
        { url: '/api/chats/search', body: { query: '', avatar_url: 'n.png' } },
        { url: '/api/chats/search', body: { query: '', group_id: 'g1' } },
    ]);
    assert.deepEqual(fingerprint([{ mes: 'a', send_date: 'd1' }, { mes: '', send_date: 'd2' }]), { count: 2, last: 'd2', preview: '[The message is empty]', size: null });
    assert.deepEqual(fingerprint([], 5), { count: 0, last: null, preview: '', size: 5 });
});
