// Re-break r2, b2-timeline: a change not yet saved when SillyTavern renames the open chat is lost.
// SillyTavern 1.19 renameChat: the server renames the file, characters[].chat becomes the new name, then
// reloadCurrentChat() reads it back (new message objects), then CHAT_RENAMED. The store sees another chat
// id ("moved"), hands the change to rescue(), which reads the OLD file name (gone), fails three times and
// gives up ("another chat was opened before it was saved"); the renamed chat, which is the same chat,
// never gets it. The change can be one inside the 400 ms window or one whose save is being retried after
// a refusal. (Fix: CHAT_RENAMED moves the change to the new name, turn.js onChatRenamed → store.renamed.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { storeSaving } from '../../../src/v2/runtime.js';
import { createStore } from '../../../src/v2/store.js';
import { createTurn } from '../../../src/v2/turn.js';
import { aiMessage, createEventSource } from '../../../testkit/fake-st.js';

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

function setup(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const files = new Map();
    const ctx = {
        chat: [aiMessage('Hello.')], characterId: 0, characters: [{ name: 'N', avatar: 'n.png' }], chatMetadata: {},
        id: 'chat-A', getCurrentChatId() { return this.id; }, getRequestHeaders: () => ({}),
    };
    const fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        if (url.endsWith('/save')) { files.set(body.file_name, structuredClone(body.chat)); return { ok: true, json: async () => ({}) }; }
        // SillyTavern's /get answers {} for a file that is not there.
        if (url.endsWith('/get')) { const f = files.get(body.file_name); return { ok: true, json: async () => (f ? structuredClone(f) : {}) }; }
        return { ok: false, status: 404, json: async () => ({}) };
    };
    const errors = [];
    const store = createStore({ ...storeSaving({ ctx, live: () => ctx, fetch, onSaveError: e => errors.push(e.message) }) });
    const onDisk = id => createStore({ chat: () => structuredClone(files.get(id) ?? [{}]).slice(1), save: async () => {} }).head();
    // SillyTavern's renameChat, with what the rename popup does: file renamed, chat read back.
    const rename = (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
        ctx.id = to;
        ctx.chat.splice(0, ctx.chat.length, ...structuredClone(files.get(to)).slice(1));
    };
    return { ctx, files, store, errors, onDisk, rename };
}

async function changed(store) {
    store.ensureInitial({ v: 2, meta: { rev: 0, claims: {} }, domains: { n: { x: 0 } } });
    await store.flush();
    store.append({ ops: [{ op: 'replace', path: '/domains/n/x', value: 7 }, { op: 'replace', path: '/meta/rev', value: 1 }], receipt: { id: 'rc_aaaaaaaa', type: 't', cause: 'system', rev: 1 } });
    store.scheduleSave();
}

test('B-b2-timeline-r2-2: a change pending while the open chat is renamed is saved into the renamed chat', async t => {
    const { store, errors, onDisk, rename, files } = setup(t);
    await changed(store);
    rename('chat-A', 'chat-B');
    // The save comes due while the chat is read back, before CHAT_RENAMED: the old file is gone.
    t.mock.timers.tick(500);
    await settle();
    assert.equal(store.renamed('chat-A', 'chat-B'), true, 'CHAT_RENAMED finds the change');
    for (let i = 0; i < 12; i++) { t.mock.timers.tick(16000); await settle(); }
    assert.equal(onDisk('chat-B').domains.n.x, 7, `the renamed chat's file holds the change (actual: ${onDisk('chat-B').domains.n.x}; told: ${JSON.stringify(errors)})`);
    assert.deepEqual(errors, [], 'and nothing is told');
    assert.equal(files.has('chat-A'), false, 'no file is made again under the old name');
    assert.equal(store.dirty(), false);
});

test('B-b2-timeline-r2-2: the change also follows a rename that lands before its save comes due', async t => {
    const { store, errors, onDisk, rename } = setup(t);
    await changed(store);
    rename('chat-A', 'chat-B');
    store.renamed('chat-A', 'chat-B');
    for (let i = 0; i < 4; i++) { t.mock.timers.tick(1000); await settle(); }
    assert.equal(onDisk('chat-B').domains.n.x, 7);
    assert.deepEqual(errors, []);
});

test('B-b2-timeline-r2-2: a change left in a chat whose file is gone is told with that reason', async t => {
    const { store, errors, files, ctx } = setup(t);
    await changed(store);
    files.delete('chat-A');
    ctx.id = 'chat-C';
    ctx.chat.splice(0, ctx.chat.length, aiMessage('Another chat.'));
    for (let i = 0; i < 12; i++) { t.mock.timers.tick(16000); await settle(); }
    assert.equal(errors.length, 1);
    assert.match(errors[0], /chat "chat-A" was not saved: that chat was no longer open when it was saved, and its chat file is no longer on the server/);
    assert.doesNotMatch(errors[0], /another chat was opened/);
});

test('B-b2-timeline-r2-2: turn.js passes SillyTavern\'s CHAT_RENAMED on to the store, by chat ID', async () => {
    const eventSource = createEventSource();
    const calls = [];
    let open = 'Bob - 2026-10-21@12h00m00s';
    const ctx = { chat: [], eventSource, eventTypes: { CHAT_RENAMED: 'chat_renamed' }, getCurrentChatId: () => open };
    const store = { renamed: (from, to) => { calls.push([from, to]); return true; } };
    const turn = createTurn({ ctx, store, bus: {}, registry: { hookEntries: () => [] }, settings: () => ({}) });
    turn.install({ globalName: null });
    open = 'Our trip';
    await eventSource.emit('chat_renamed', { avatarId: 'bob.png', groupId: null, oldFileName: 'Bob - 2026-10-21@12h00m00s.jsonl', newFileName: 'Our trip.jsonl' });
    // The server cleaned the name up ("?" is not allowed in a file name): the open chat's ID is the new name.
    open = 'Where now';
    await eventSource.emit('chat_renamed', { oldFileName: 'Our trip.jsonl', newFileName: 'Where now?.jsonl' });
    turn.uninstall({ globalName: null });
    assert.deepEqual(calls, [['Bob - 2026-10-21@12h00m00s', 'Our trip'], ['Our trip', 'Where now']]);
});
