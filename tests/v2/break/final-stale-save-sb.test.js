// Final soak, a timed-out save that lands late (persist.js createSaver `confirm`, runtime.js storeSaving):
// after a timeout, later saves carry a rising number in chat_metadata and the file is read back after a
// few delays; one holding an older save is written again. Without a timeout nothing is stamped or read,
// and the read-backs never hold a save, a command or the next reply. The soak's and the cell's own
// tests: final-stale-timeout-save.test.js, f1-late-save-overwrites-newer.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { RECHECK_MS, createSaver } from '../../../src/v2/persist.js';
import { SAVE_SEQ_KEY } from '../../../src/v2/runtime.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function seconds(t, n) {
    for (let s = 0; s < n; s++) { t.mock.timers.tick(1000); for (let i = 0; i < 5; i++) await settle(); }
}

// A host whose chat file goes through fetch (as in SillyTavern), with a server that may hold a save.
async function served(t) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    const server = { files: {}, gets: 0, saves: 0, hold: false, late: [], hangGets: false };
    h.ctx.getRequestHeaders = () => ({});
    h.ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
    h.ctx.characterId = 0;
    t.mock.method(globalThis, 'fetch', (url, init = {}) => {
        const body = JSON.parse(init.body);
        const handle = () => {
            if (url === '/api/chats/save') { server.saves += 1; server.files[body.file_name] = structuredClone(body.chat); }
            return { ok: true, status: 200, json: async () => (url === '/api/chats/get' ? structuredClone(server.files[body.file_name] ?? []) : { ok: true }) };
        };
        if (url === '/api/chats/get') {
            server.gets += 1;
            if (server.hangGets) return new Promise(() => {});
        }
        if (server.hold && url === '/api/chats/save') {
            server.hold = false;
            return new Promise((resolve, reject) => {
                server.late.push(handle);
                init.signal?.addEventListener?.('abort', () => reject(new Error('aborted')));
            });
        }
        return Promise.resolve(handle());
    });
    return { h, server };
}

test('normal saves: no read-back and no save number in the chat\'s metadata', async t => {
    const { h, server } = await served(t);
    await h.send('Hello.', 'Hi.');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const name of ['Ann', 'Bo', 'Cy', 'Di']) {
        assert.equal((await h.sdk.command('scene.present', { add: name })).ok, true);
        await seconds(t, 5);
    }
    await seconds(t, 400);
    assert.ok(server.saves >= 4);
    assert.equal(server.gets, 0, 'nothing read back');
    assert.equal(h.store.suspect?.() ?? false, false);
    const header = Object.values(server.files)[0][0];
    assert.equal(Object.hasOwn(header.chat_metadata ?? {}, SAVE_SEQ_KEY), false);
});

test('after a timeout: the next save is stamped, read back a few times, then never again', async t => {
    const { h, server } = await served(t);
    await h.send('Hello.', 'Hi.');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    server.hold = true;
    h.sdk.command('scene.present', { add: 'Ann' });
    await seconds(t, 25);                       // timed out at 20 s, saved again a second later
    assert.equal(h.store.dirty(), false);
    const header = Object.values(server.files)[0][0];
    assert.equal(header.chat_metadata[SAVE_SEQ_KEY], 1, 'the retry carries save number 1');
    await seconds(t, RECHECK_MS.reduce((a, b) => a + b, 0) / 1000 + 10);
    assert.equal(server.gets, RECHECK_MS.length, 'one read-back per delay');
    // The window has passed: saves are plain again.
    const gets = server.gets;
    await h.sdk.command('scene.present', { add: 'Bo' });
    await seconds(t, 400);
    assert.equal(server.gets, gets, 'no read-back without a new timeout');
    server.late.shift()();                      // far too late to matter here; cleaned up
});

test('a read-back that hangs holds neither a command nor its save', async t => {
    const { h, server } = await served(t);
    await h.send('Hello.', 'Hi.');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    server.hold = true;
    h.sdk.command('scene.present', { add: 'Ann' });
    await seconds(t, 25);
    server.hangGets = true;
    await seconds(t, 12);                       // the first read-back is on its way and never answers
    assert.equal(server.gets, 1);
    const saves = server.saves;
    const done = await h.sdk.command('scene.present', { add: 'Bo' });
    assert.equal(done.ok, true);
    await seconds(t, 2);                        // the turn's idle save (IDLE_MS)
    assert.equal(server.saves, saves + 1, 'saved, past the hanging read-back');
    assert.equal(h.store.dirty(), false);
});

// A saver on hand-run timers: `run(filter)` fires the first pending timer it matches.
function harness({ memo = null } = {}) {
    const pending = [];
    const timers = {
        setTimeout: (fn, ms) => { const job = { fn, ms }; pending.push(job); return job; },
        clearTimeout: job => { const at = pending.indexOf(job); if (at >= 0) pending.splice(at, 1); },
    };
    const run = async (filter = () => true) => {
        const job = pending.find(filter);
        assert.ok(job, 'a timer is pending');
        pending.splice(pending.indexOf(job), 1);
        job.fn();
        for (let i = 0; i < 10; i++) await settle();
        return job;
    };
    const state = { hang: true, saves: [], holds: [], restores: [], open: 'a', fileHolds: true, fresh: true, stamp: 100 };
    const saver = createSaver({
        timers, timeout: 20000, recheck: [10, 20], memo,
        target: () => ({ chatId: state.open, place: { chatId: state.open } }),
        check: change => (change.chatId === state.open ? '' : { moved: 'another chat' }),
        save: (change, { signal, stamp } = {}) => {
            state.saves.push([change.chatId, stamp === true]);
            if (state.hang) { state.hang = false; return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))); }
            return Promise.resolve(stamp ? { stamp: ++state.stamp } : null);
        },
        confirm: {
            holds: async (change, stamp) => { state.holds.push([change.chatId, stamp]); return state.fileHolds; },
            fresh: () => state.fresh,
            restore: async (change, stamp) => { state.restores.push([change.chatId, stamp]); return true; },
        },
    });
    return { saver, run, state, pending };
}

test('createSaver: an older file is saved again while open, put back from the copy once another chat is open', async () => {
    const { saver, run, state } = harness();
    saver.touch();
    const first = saver.saveSoon();
    await settle();
    await run(job => job.ms === 20000);         // the timeout
    assert.equal(await first, false);
    assert.equal(saver.suspect(), true);
    await run(job => job.ms === 1000);          // the retry, stamped
    assert.deepEqual(state.saves, [['a', false], ['a', true]]);
    assert.equal(saver.dirty(), false);
    state.fileHolds = false;                    // the late write landed
    await run(job => job.ms === 10);
    assert.deepEqual(state.holds, [['a', 101]]);
    assert.deepEqual(state.saves.at(-1), ['a', true], 'the open chat written again at once, stamped');
    // Another chat open now; the late write lands again: chat a's file gets the copy back.
    state.open = 'b';
    await run(job => job.ms === 10);
    assert.deepEqual(state.holds.at(-1), ['a', 102], 'chat a is read although b is open');
    assert.deepEqual(state.restores, [['a', 102]]);
    state.fileHolds = true;
    await run(job => job.ms === 10);
    await run(job => job.ms === 20);
    assert.equal(saver.suspect(), false, 'the read-backs are over');
    assert.equal(state.saves.filter(([id]) => id === 'b').length, 0, 'chat b was never written');
});

test('createSaver: a rename moves the read-backs; a reload of the page goes on with them (memo)', async () => {
    const store = new Map();
    const memo = { get: id => store.get(id) ?? null, set: (id, value) => (value ? store.set(id, structuredClone(value)) : store.delete(id)) };
    const { saver, run, state } = harness({ memo });
    saver.touch();
    saver.saveSoon();
    await settle();
    await run(job => job.ms === 20000);
    await run(job => job.ms === 1000);
    assert.deepEqual(store.get('a'), { good: 101, step: 0, place: { chatId: 'a' } });
    state.open = 'a2';
    assert.equal(saver.renamed('a', 'a2'), true);
    assert.equal(store.has('a'), false);
    assert.equal(store.get('a2').place.chatId, 'a2');
    state.fileHolds = false;
    await run(job => job.ms === 10);
    assert.deepEqual(state.holds, [['a2', 101]], 'read under its new name');
    // A new page (F5) on the same chat: the memo's read-backs go on.
    const next = harness({ memo });
    next.state.open = 'a2';
    next.state.fileHolds = false;
    assert.equal(next.saver.resume({ chatId: 'a2', place: { chatId: 'a2' } }), true);
    await next.run(job => job.ms === 10);
    assert.deepEqual(next.state.holds, [['a2', store.get('a2')?.good ?? 102]]);
    assert.deepEqual(next.state.saves.at(-1), ['a2', true], 'saved again from the reloaded chat');
    assert.equal(next.saver.resume({ chatId: 'zz' }), false, 'nothing kept for another chat');
});
