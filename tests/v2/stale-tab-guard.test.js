// The wake check's guards (src/v2/runtime/wake.js): what the list can and cannot show, a check during a generation, a
// keepalive or a second hide during the check, a failed reload, a save the server applied but this tab has not heard of, groups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../testkit/index.js';
import { createChatFile } from '../../src/v2/chat-file.js';
import { createRuntime } from '../../src/v2/runtime.js';
import { createWakeCheck, fingerprint } from '../../src/v2/runtime/wake.js';
import { serveChats } from './helpers/st-server.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const settled = async (n = 8) => { for (let i = 0; i < n; i++) await settle(); };
const saves = server => server.requests.filter(r => r.url === '/api/chats/save');

async function tab(t) {
    const page = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    page.document = doc;
    const st = createFakeContext();
    const server = serveChats(t, { ctx: st.ctx });
    const toasts = [];
    const reloads = [];
    const box = { reload: null, runtime: null };
    st.ctx.reloadCurrentChat = async () => { reloads.push(1); if (box.reload) return box.reload();
        // SillyTavern reads the chat file again, then tells of the chat.
        const id = st.ctx.getCurrentChatId();
        if (server.files[id]) st.ctx.chat.splice(0, st.ctx.chat.length, ...structuredClone(server.files[id].slice(1)));
        await box.runtime.turn.onChatChanged(); };
    const runtime = createRuntime({ ctx: st.ctx, page, onWake: (text, kind) => toasts.push({ text, kind }), onSaveError: () => {} });
    box.runtime = runtime;
    runtime.turn.install({ globalName: null });
    t.after(() => runtime.turn.uninstall({ globalName: null }));
    await runtime.turn.onChatChanged();
    runtime.markReady();
    await runtime.store.flush();
    await settled();
    const visible = async state => { doc.visibilityState = state; doc.dispatchEvent(new Event('visibilitychange')); await settled(); };
    return { page, doc, st, server, toasts, reloads, runtime, box, show: () => visible('visible'), hide: () => visible('hidden'), chatId: () => st.ctx.getCurrentChatId() };
}
const work = x => x.runtime.sdk.command('scene.present', { add: 'Ser Nine' });

test('an earlier message edited on another device (same count, last message and date) is found by the size', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    const file = x.server.files[x.chatId()];
    file[1].mes = `${file[1].mes} and a much longer line that another device wrote into an earlier message`;
    const before = saves(x.server).length;
    await x.show();
    assert.equal(x.reloads.length, 1);
    assert.match(x.toasts[0].text, /changed on another device/);
    assert.equal(saves(x.server).length, before);
});

test('metadata changed on another device (the header line only) is found by the size too', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    x.server.files[x.chatId()][0].chat_metadata.note = 'x'.repeat(200);
    await x.show();
    assert.equal(x.reloads.length, 1);
});

test('a prefix edit of a long last message (outside the 400-character preview) is found by the size', async () => {
    const mes = `start ${'x'.repeat(600)}`;
    const messages = [{ mes: 'a', send_date: 'd1' }, { mes, send_date: 'd2' }];
    const row = { file_name: 'c', message_count: 2, last_mes: 'd2', preview_message: `...${mes.slice(-400)}`, file_size: '1KB' };
    const file = { where: () => ({ chatId: 'c' }), list: async () => [row] };
    const calls = [];
    const wake = createWakeCheck({ file, chat: () => messages, store: {}, reload: async () => { calls.push('reload'); wake.loaded(); }, say: () => {} });
    wake.sent({ chatId: 'c' }, fingerprint(messages, 1024));
    await wake.run('visible');
    assert.deepEqual(calls, [], 'the same file');
    row.file_size = '1.07KB';                                  // an earlier edit elsewhere lengthened the start of the last message
    await wake.run('visible');
    assert.deepEqual(calls, ['reload']);
});

test('the chat is missing from the list after the server listed it: stale, not safe', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    delete x.server.files[x.chatId()];
    await x.show();
    assert.equal(x.reloads.length, 1);
});

test('the chat is listed with no message after the server listed it with some: stale', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    const id = x.chatId();
    x.server.files[id] = [x.server.files[id][0]];
    await x.show();
    assert.equal(x.reloads.length, 1);
});

test('a chat the server never listed (new, unsaved) is not stale', async () => {
    const file = { where: () => ({ chatId: 'new', name: 'n', avatar: 'a.png' }), list: async () => [{ file_name: 'other', message_count: 1, last_mes: 'x', preview_message: 'y' }] };
    const calls = [];
    const wake = createWakeCheck({ file, chat: () => [{ mes: 'hi' }], store: {}, reload: async () => calls.push('reload'), say: text => calls.push(text) });
    wake.loaded();
    await wake.run('visible');
    assert.deepEqual(calls, []);
});

test('the size of a loaded chat is learned from the list at once, so the first wake sees an earlier edit', async () => {
    const messages = [{ mes: 'a', send_date: 'd1' }, { mes: 'b', send_date: 'd2' }];
    let size = '1KB';
    const file = { where: () => ({ chatId: 'c' }), list: async () => [{ file_name: 'c', message_count: 2, last_mes: 'd2', preview_message: 'b', file_size: size }] };
    const calls = [];
    const wake = createWakeCheck({ file, chat: () => messages, store: { discardUnsaved: () => 0 }, reload: async () => { calls.push('reload'); wake.loaded(); }, say: text => calls.push(text) });
    wake.loaded();
    await settled();
    size = '1.2KB';
    await wake.run('visible');
    assert.equal(calls[0], 'reload');
});

test('a save the server applied but the tab has not heard of yet does not look foreign', async () => {
    const messages = [{ mes: 'a', send_date: 'd1' }];
    const written = [{ mes: 'a', send_date: 'd1' }, { mes: 'b', send_date: 'd2' }];
    const file = { where: () => ({ chatId: 'c' }), list: async () => [{ file_name: 'c', message_count: 2, last_mes: 'd2', preview_message: 'b', file_size: '100B' }] };
    const calls = [];
    const wake = createWakeCheck({ file, chat: () => messages, store: {}, reload: async () => calls.push('reload'), say: text => calls.push(text) });
    wake.loaded();
    wake.sent({ chatId: 'c' }, fingerprint(written, 100));   // sent; the answer has not come
    messages.push({ mes: 'c', send_date: 'd3' });             // the tab went on meanwhile
    await wake.run('visible');
    assert.deepEqual(calls, []);
});

test('the print of a write is taken when it is sent: a message changed before the answer is not mixed in', async () => {
    const seen = [];
    const messages = [{ mes: 'one', send_date: 'd1' }];
    let answer;
    const fetch = async () => new Promise(resolve => { answer = resolve; });
    const file = createChatFile({
        context: () => ({ getRequestHeaders: () => ({}), getCurrentChatId: () => 'a', characters: [{ name: 'N', avatar: 'n.png' }], characterId: 0 }),
        fetch, onSent: (place, print) => seen.push(print),
    });
    const writing = file.write(file.where(), messages, { m: 1 });
    messages[0].mes = 'two, changed while the request was on its way';
    messages.push({ mes: 'three' });
    answer({ ok: true });
    await writing;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].count, 1);
    assert.equal(seen[0].preview, 'one');
    const lines = [{ chat_metadata: { m: 1 }, user_name: 'unused', character_name: 'unused' }, { mes: 'one', send_date: 'd1' }].map(m => JSON.stringify(m)).join('\n');
    assert.equal(seen[0].size, new TextEncoder().encode(lines).length, 'the size the file will have');
});

test('a wake during a generation: the check is made at once, nothing is written until it ends, the reload waits for the reply', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    let release;
    let busy = true;
    const turn = x.runtime.turn;
    turn.replyBusy = () => busy;
    turn.whenIdle = () => (busy ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
    x.server.files[x.chatId()].push({ name: 'Narrator', mes: 'Played elsewhere.', send_date: '2026-11-10T09:00:00.000Z', extra: {} });
    const before = saves(x.server).length;
    await x.show();
    assert.equal(x.reloads.length, 0, 'the reply is not cut');
    await work(x);
    await x.runtime.store.saveSoon();                         // the reply's own save asks (it must not wait for the reply)
    await x.runtime.store.saveSoon({ keepalive: true });
    assert.equal(saves(x.server).length, before, 'the stale copy is never written while the reload waits');
    busy = false;
    release();
    await settled();
    assert.equal(x.reloads.length, 1);
    assert.match(x.toasts[0].text, /Reloaded the newer copy/);
});

test('a keepalive save met by a pending check is skipped, and made after a clean check', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    await work(x);
    x.server.listing = 'hang';
    const before = saves(x.server).length;
    x.doc.dispatchEvent(new Event('visibilitychange'));       // visible: the check is pending
    await settled();
    await x.hide();                                           // the page goes away during the check: keepalive
    assert.equal(saves(x.server).length, before, 'skipped');
    x.server.listing = '';
    t.mock.timers.tick(8000);
    await settled();
    assert.ok(saves(x.server).length > before, 'the change is written once the check ended clean');
});

test('hiding again during a check that finds the chat stale writes nothing', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    await x.hide();
    x.server.files[x.chatId()].push({ name: 'Narrator', mes: 'Played elsewhere.', send_date: '2026-11-10T09:00:00.000Z', extra: {} });
    x.server.failing = true;
    await work(x);
    x.server.failing = false;
    const before = saves(x.server).length;
    x.doc.visibilityState = 'visible';
    x.doc.dispatchEvent(new Event('visibilitychange'));
    await x.hide();
    await x.hide();
    await x.show();
    assert.equal(saves(x.server).length, before);
    assert.equal(x.reloads.length, 1);
});

test('a reload that fails keeps the chat from being saved, tells so, and the next wake tries again', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const x = await tab(t);
    x.server.files[x.chatId()].push({ name: 'Narrator', mes: 'Played elsewhere.', send_date: '2026-11-10T09:00:00.000Z', extra: {} });
    x.box.reload = async () => { throw new Error('no network'); };
    const before = saves(x.server).length;
    await x.show();
    assert.match(x.toasts.at(-1).text, /newer copy could not be loaded.*paused/);
    await work(x);
    await x.runtime.store.saveSoon();
    await x.runtime.store.saveSoon({ keepalive: true });
    t.mock.timers.tick(60000);
    await settled();
    assert.equal(saves(x.server).length, before, 'nothing written over the newer file');
    x.box.reload = null;
    await x.show();
    assert.match(x.toasts.at(-1).text, /Reloaded the newer copy/);
    await work(x);
    t.mock.timers.tick(60000);
    await settled();
    assert.ok(saves(x.server).length > before, 'saving goes on after the reload');
});

test('a reload that is missing, or never reads the chat, is a failed reload', async () => {
    const file = { where: () => ({ chatId: 'c' }), list: async () => [{ file_name: 'c', message_count: 5, last_mes: 'x', preview_message: 'new' }] };
    const calls = [];
    const wake = createWakeCheck({ file, chat: () => [{ mes: 'old' }], store: {}, reload: null, say: text => calls.push(text), reloadMs: 5 });
    wake.loaded();
    await wake.run('visible');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.match(calls[0], /could not be loaded/);
    assert.equal(wake.hold(), false, 'saving stays stopped');
});

test('a group chat: stale reload, the newer-file warning and a failed list, with the group request', async () => {
    const rows = { value: [{ file_name: 'g1', message_count: 3, last_mes: '2026-01-01T00:00:00Z', preview_message: 'newer', file_size: '1KB' }] };
    const requests = [];
    const fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return { ok: rows.value !== null, status: 500, json: async () => rows.value }; };
    const file = createChatFile({ context: () => ({ getRequestHeaders: () => ({}), getCurrentChatId: () => 'g1', groupId: 'grp' }), fetch });
    const chat = [{ mes: 'a', send_date: 'd1' }];
    const calls = [];
    const wake = createWakeCheck({ file, chat: () => chat, store: { discardUnsaved: () => 0, unsavedCount: () => 0 }, reload: async () => { calls.push('reload'); chat.splice(0, 1, { mes: 'x' }, { mes: 'y' }, { mes: 'newer', send_date: '2026-01-01T00:00:00Z' }); wake.loaded(); }, say: (text, kind) => calls.push(`${kind}: ${text}`) });
    wake.loaded();
    await wake.run('visible');
    assert.ok(requests.length >= 2 && requests.every(r => r.url === '/api/chats/search' && r.body.group_id === 'grp' && r.body.query === ''));
    assert.deepEqual(calls, ['reload', 'warning: This chat changed on another device. Reloaded the newer copy.']);
    rows.value = [{ file_name: 'g1', message_count: 3, last_mes: '2026-01-01T00:00:00Z', preview_message: 'newer', file_size: '1KB' }, { file_name: 'g2', message_count: 1, last_mes: '2027-01-01T00:00:00Z', preview_message: 'x' }];
    calls.length = 0;
    await wake.run('visible');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^info: A newer chat exists for this character: g2/);
    rows.value = null;
    calls.length = 0;
    await wake.run('visible');
    assert.match(calls[0], /^warning: Could not check/);
});

test('the check waits for a save on its way before it asks the server', async () => {
    let done;
    const asked = [];
    const file = { where: () => ({ chatId: 'c' }), list: async () => { asked.push(1); return [{ file_name: 'c', message_count: 1, last_mes: 'd1', preview_message: 'a' }]; } };
    const wake = createWakeCheck({ file, chat: () => [{ mes: 'a', send_date: 'd1' }], store: {}, settle: () => new Promise(resolve => { done = resolve; }) });
    const running = wake.run('visible');
    await settled();
    assert.deepEqual(asked, [], 'not asked while a write is on its way');
    done();
    await running;
    assert.equal(asked.length, 1);
});
