// Breaker cell c4 (storage), pass 1: a change not saved yet (its save was refused once, or it is still in
// the 400 ms window) while SillyTavern reads the SAME chat again (reloadCurrentChat: clearChat empties the
// chat array in place, then getChat fills it from the server). persist.js createSaver puts the save off while
// the array is empty ({ wait }), every 200 ms up to `waits` = 50 times; after that (10 s: a big chat on a slow
// connection) it marks the change saved without writing it (`if (verdict?.gone || verdict?.wait) saved = goal`).
// When the chat arrives the change is gone from the page and from the file, and nothing is told.
// Invariant 7 (a failed save never drops a turn's state). Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { storeSaving } from '../../../src/v2/runtime.js';
import { createStore } from '../../../src/v2/store.js';
import { aiMessage } from '../../../testkit/fake-st.js';

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

test('C4-3: a change waiting to be saved survives a slow re-read of the same chat', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const files = new Map();
    let refuse = 0;
    const ctx = {
        chat: [aiMessage('Hello.')], characterId: 0, characters: [{ name: 'N', avatar: 'n.png' }], chatMetadata: {},
        getCurrentChatId: () => 'chat-A', getRequestHeaders: () => ({}),
    };
    const fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        if (url.endsWith('/save')) {
            if (refuse > 0) { refuse--; return { ok: false, status: 500, json: async () => ({}) }; }
            files.set(body.file_name, structuredClone(body.chat));
            return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => structuredClone(files.get(body.file_name) ?? {}) };
    };
    const errors = [];
    const store = createStore({ ...storeSaving({ ctx, live: () => ctx, fetch, onSaveError: e => errors.push(e.message) }) });
    const onDisk = () => createStore({ chat: () => structuredClone(files.get('chat-A')).slice(1), save: async () => {} }).head();
    store.ensureInitial({ v: 2, meta: { rev: 0, claims: {} }, domains: { n: { x: 0 } } });
    await store.flush();

    refuse = 1;
    store.append({ ops: [{ op: 'replace', path: '/domains/n/x', value: 7 }, { op: 'replace', path: '/meta/rev', value: 1 }], receipt: { id: 'rc_aaaaaaaa', type: 't', cause: 'ui', rev: 1 } });
    assert.equal(await store.saveSoon(), false, 'the first save is refused (told, tried again)');

    // reloadCurrentChat: the array is emptied in place; the file takes 12 s to come.
    ctx.chat.splice(0, ctx.chat.length);
    for (let i = 0; i < 60; i++) { t.mock.timers.tick(200); await settle(); }
    ctx.chat.push(...structuredClone(files.get('chat-A')).slice(1));
    store.rebuild();
    for (let i = 0; i < 100; i++) { t.mock.timers.tick(200); await settle(); }

    assert.equal(store.head().domains.n.x, 7, 'the open chat still has the change');
    assert.equal(onDisk().domains.n.x, 7, 'and its file holds it');
});
