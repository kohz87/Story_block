// Records the store does not own are kept as they are (docs/v2/REPLAY.md "Preserved records", contract §2/§9):
// opening a chat never writes over a future version's record or repairs a damaged first record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { greeting, initial, reply, setup, user } from './helpers/store-chat.js';

const FUTURE = { v: 3, sid: 'sw_future00001', checkpoint: { v: 3, whatever: [1, 2, 3] }, ops: [{ op: 'x' }], receipts: [], narrated: [], rev: 9, extraField: { a: 1 } };

test('a future-version record survives opening the chat byte for byte; the head is empty and read-only', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('a', 'A rope.');
    const chat = structuredClone(h.ctx.chat);
    chat[0].extra.storySuite = structuredClone(FUTURE);
    chat[0].swipe_info[0].extra.storySuite = structuredClone(FUTURE);
    const before = JSON.stringify(chat);
    await h.st.loadChat(chat);
    assert.equal(JSON.stringify(h.ctx.chat), before);
    assert.deepEqual(h.ctx.chat[0].extra.storySuite, FUTURE);
    assert.equal(h.store.dirty(), false, 'nothing to save');
    assert.equal(h.store.readOnly().kind, 'future');
    assert.ok(h.head().domains.inventory, 'an empty working state');
    assert.match(h.turn.problems().find(problem => problem.code === 'DAMAGED').message, /message 0 is from a newer version \(v3\)/);
    // Nothing writes: a reader's action is refused, and nothing is changed.
    const result = await h.sdk.command('scene.place', { name: 'Riverbank' });
    assert.equal(result.ok, false);
    assert.match(result.message, /read-only/);
    assert.equal(JSON.stringify(h.ctx.chat), before);
    // Opening it again says the same and still changes nothing.
    await h.st.loadChat(structuredClone(h.ctx.chat));
    assert.equal(JSON.stringify(h.ctx.chat), before);
});

test('a damaged first record is not rewritten', () => {
    const damaged = { v: 2, sid: 'sw_damaged0001', checkpoint: { v: 2 }, ops: [], receipts: [], narrated: [] };
    const { ctx, store } = setup([greeting(), user(), reply()]);
    ctx.chat[0].extra.storySuite = structuredClone(damaged);
    const before = JSON.stringify(ctx.chat);
    const notes = store.ensureInitial(initial());
    assert.equal(notes.length, 1);
    assert.match(notes[0], /message 0 is damaged/);
    assert.deepEqual(store.ensureInitial(initial()), [], 'told once');
    assert.equal(JSON.stringify(ctx.chat), before);
    assert.deepEqual(store.head(), initial());
    assert.equal(store.dirty(), false);
    assert.throws(() => store.append({ ops: [], receipt: { id: 'rc_00000001', type: 't', module: 'm', cause: 'ui', seed: 1, summary: '', narrate: false, data: {}, rev: 1 } }), /read-only/);
    assert.throws(() => store.setNarrated(2, []), /read-only/);
    assert.equal(JSON.stringify(ctx.chat), before);
    assert.equal(store.readOnly().kind, 'damaged');
});

test('a future record on a later reply is never written over either', () => {
    const { ctx, store } = setup([greeting(), user(), reply()]);
    store.ensureInitial(initial());
    ctx.chat[2].extra.storySuite = structuredClone(FUTURE);
    const before = JSON.stringify(ctx.chat[2]);
    assert.throws(() => store.setNarrated(2, ['rc_00000001']), /newer version/);
    assert.equal(JSON.stringify(ctx.chat[2]), before);
});

test('a normal v2 record and a fresh chat behave as before', () => {
    const fresh = setup([greeting()]);
    assert.deepEqual(fresh.store.ensureInitial(initial()), []);
    assert.equal(fresh.store.readOnly(), null);
    assert.deepEqual(fresh.store.head(), initial());
    assert.equal(fresh.ctx.chat[0].extra.storySuite.v, 2);
    const again = JSON.stringify(fresh.ctx.chat);
    fresh.store.ensureInitial({ v: 2, meta: { rev: 5, claims: {} }, domains: {} });
    assert.equal(JSON.stringify(fresh.ctx.chat), again, 'a record that is there is never replaced');
});
