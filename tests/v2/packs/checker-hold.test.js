// A chat is never written without its stored packs' start because the pack checker had not landed (packs/installed.js `unchecked`, session.js
// `held`): with the checker late or failed, the first carrier gets no state, a Problem says why, and nothing pack-dependent is saved. When
// the checker lands the chat reads normally. seed() and onTimelineChanged wait for the loaders like CHAT_CHANGED does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const greeting = () => ({ name: 'Narrator', is_user: false, mes: 'The fire crackles.', extra: {} });
async function pending(state) {
    const host = await createHost({ st: { chat: [] } });
    host.ctx.chat.push(greeting());
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const part = host.packs.packs;
    part.unchecked = () => state.now;
    part.ready = () => (state.now ? gate.then(() => { state.now = null; return true; }) : undefined);
    return { host, release, gate };
}

test('a slow checker: nothing is written meanwhile; when it lands the state starts normally', async () => {
    const state = { now: 'loading' };
    const { host, release } = await pending(state);
    host.turn.onChatChanged();           // not awaited: the wait for the checker is under way
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(host.head(), null, 'no state while the packs are unchecked');
    assert.equal(host.ctx.chat[0].extra.storySuite, undefined, 'no record written');
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(host.ctx.chat[0].extra.storySuite, 'the chat reads normally once the checker is there');
    host.close();
});

test('a read without the checker (the wait gave up): a Problem says so, nothing is persisted; the checker landing later starts the state', async () => {
    const state = { now: 'loading' };
    const host = await createHost({ st: { chat: [] } });
    host.ctx.chat.push(greeting());
    let land;
    const part = host.packs.packs;
    part.unchecked = () => state.now;
    part.ready = () => (state.now ? new Promise(resolve => { land = () => { state.now = null; resolve(true); }; }) : undefined);
    await host.turn.onTimelineChanged('edit');   // the 4 s wait times out (RPG_LOAD_WAIT_MS), then the chat is read without the checker
    assert.equal(host.head(), null);
    assert.equal(host.ctx.chat[0].extra.storySuite, undefined, 'nothing persisted');
    assert.ok(host.turn.problems().some(p => p.code === 'LOADING'), 'said');
    land();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(host.head(), 'the chat reads normally on landing');
    host.close();
});

test('a checker that failed to load: no state is written, the Problem says it', async () => {
    const state = { now: 'failed' };
    const host = await createHost({ st: { chat: [] } });
    host.ctx.chat.push(greeting());
    host.packs.packs.unchecked = () => state.now;
    host.packs.packs.ready = () => Promise.resolve(false);
    await host.turn.onChatChanged();
    assert.equal(host.head(), null);
    assert.equal(host.ctx.chat[0].extra.storySuite, undefined);
    const found = host.turn.problems().find(p => p.code === 'FAILED');
    assert.match(found.message, /pack checker could not be loaded/);
    host.close();
});

test('seed() waits for the checker, then starts the state', async () => {
    const state = { now: 'loading' };
    const { host, release } = await pending(state);
    const seeded = host.turn.seed();
    assert.equal(typeof seeded.then, 'function', 'a promise while the checker is on its way');
    release();
    assert.equal(await seeded, true);
    assert.ok(host.ctx.chat[0].extra.storySuite);
    host.close();
});

test('the interceptor sends no prompt and starts no state while the packs are unchecked; after landing the reply goes out', async () => {
    const state = { now: 'loading' };
    const { host, release } = await pending(state);
    let aborted = 0;
    const send = () => host.turn.interceptor([], 8192, () => { aborted += 1; }, 'normal');
    await send();
    assert.equal(aborted, 1, 'the reply is stopped');
    assert.equal(host.head(), null, 'no state started');
    assert.equal(host.ctx.chat[0].extra.storySuite, undefined, 'nothing persisted');
    assert.ok(host.turn.problems().some(p => p.code === 'LOADING'), 'said');
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(host.head(), 'the chat reads normally on landing');
    await send();
    assert.equal(aborted, 1, 'the next reply is not stopped');
    host.close();
});

test('the interceptor with a checker that failed: stopped, Problem FAILED, nothing written', async () => {
    const host = await createHost({ st: { chat: [] } });
    host.ctx.chat.push(greeting());
    host.packs.packs.unchecked = () => 'failed';
    host.packs.packs.ready = () => Promise.resolve(false);
    let aborted = 0;
    await host.turn.interceptor([], 8192, () => { aborted += 1; }, 'normal');
    assert.equal(aborted, 1);
    assert.equal(host.head(), null);
    assert.ok(host.turn.problems().some(p => p.code === 'FAILED' && /could not be loaded/.test(p.message)));
    host.close();
});
