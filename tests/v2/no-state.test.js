// A reader's action in a chat with no state yet (stage 39, "Could not make the character: There is no state to change yet."):
// SillyTavern shows a new chat's greeting before it tells of the chat (CHAT_CHANGED comes after its save and after every
// listener ahead of Story Block's), and a message added with no event Story Block reads (/sendas into an empty chat) starts
// nothing. The action now starts the state on the first carrier first (turn.seed, as onChatChanged would); with no message
// at all, or no chat open, nothing is written and the action is refused as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

const greeting = () => ({ name: 'Narrator', is_user: false, mes: 'The fire crackles.', extra: {} });

// The greeting SillyTavern has put in the chat; its CHAT_CHANGED has not reached Story Block yet.
async function waiting(options = {}) {
    const host = await createHost({ st: { chat: [], ...options } });
    host.ctx.chat.push(greeting());
    assert.equal(host.head(), null, 'no state yet: the greeting carries no record');
    return host;
}

test('a reader\'s action in a chat whose greeting has no state yet starts the state first, then runs', async () => {
    const host = await waiting();
    const done = await host.sdk.command('scene.present', { add: 'Ann' });
    assert.equal(done.ok, true, done.message);
    assert.ok(host.ctx.chat[0].extra.storySuite, 'the greeting carries the record');
    assert.deepEqual(host.head().domains.scene.present.map(entry => entry.name ?? entry), ['Ann']);
    // CHAT_CHANGED coming after changes nothing: the state was started as it would have started it, and replay == live.
    const live = structuredClone(host.head());
    await host.turn.onChatChanged();
    assert.deepEqual(host.head(), live);
    host.store.rebuild();
    assert.deepEqual(host.head(), live, 'replayed from the record: the same');
    host.close();
});

test('the state started by an action is the one CHAT_CHANGED would have started', async () => {
    const seeded = await waiting();
    assert.equal(seeded.turn.seed(), true);
    const told = await waiting();
    await told.turn.onChatChanged();
    assert.deepEqual(seeded.head(), told.head());
    assert.equal(seeded.turn.seed(), true, 'a chat with a state: nothing more to do');
    seeded.close();
    told.close();
});

test('a preview starts the state too, and one action after a message added with no event (/sendas) works', async () => {
    const host = await createHost({ st: { chat: [] } });
    host.ctx.chat.push({ name: 'Seraphina', is_user: false, mes: 'Seraphina looks up.', extra: {} });
    const seen = await host.sdk.preview('scene.present', { add: 'Ann' });
    assert.equal(seen.ok, true, seen.message);
    assert.ok(host.head());
    host.close();
});

test('no message at all: nothing is written and the action is refused as before', async () => {
    const host = await createHost({ st: { chat: [] } });
    assert.equal(host.turn.seed(), false);
    const refused = await host.sdk.command('scene.present', { add: 'Ann' });
    assert.equal(refused.ok, false);
    assert.equal(refused.message, 'There is no state to change yet.');
    assert.equal(host.head(), null);
    // Only the reader's own message: still no carrier.
    host.ctx.chat.push({ name: 'You', is_user: true, mes: 'Hello?', extra: {} });
    assert.equal((await host.sdk.command('scene.present', { add: 'Ann' })).ok, false);
    assert.equal(host.ctx.chat[0].extra.storySuite, undefined);
    host.close();
});

test('no chat open (SillyTavern\'s welcome screen): its messages are not given a state by an action', async () => {
    const host = await waiting({ chatId: '' });
    assert.equal(host.turn.seed(), false);
    assert.equal((await host.sdk.command('scene.present', { add: 'Ann' })).ok, false);
    assert.equal(host.ctx.chat[0].extra.storySuite, undefined, 'nothing written');
    host.close();
});
