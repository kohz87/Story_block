// A swipe on the head reply that leaves the chat and the head record the same is not a move: a dialog opened before it can
// still submit (fix 8a review, blocking 5). What moves the head is another chat or another head record (its sid).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../src/v2/runtime.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { createFakeContext } from '../../testkit/fake-st.js';
import { setupDom } from './view/mounts/helpers.js';

// A reply that carries the story's record (its sid), with two swipes that hold the same text.
const headReply = (sid = 'sw_head01') => ({
    name: 'Narrator', is_user: false, mes: 'You see a lake.', swipe_id: 0,
    swipes: ['You see a lake.', 'You see a lake.'], swipe_info: [{ extra: {} }, { extra: {} }],
    extra: { storySuite: { v: 2, sid, ops: [], receipts: [], narrated: [], spans: [] } },
});

async function world() {
    const doc = setupDom();
    const st = createFakeContext();
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    const created = [];
    await runtime.sdk.registerModule({
        id: 'qa-swipe',
        name: 'Swipe',
        version: '2.0.0-alpha.1',
        commands: { 'qa-swipe.create'(ctx, payload) { created.push(payload); return { summary: 'Created.' }; } },
        screens: [{ id: 'qa-swipe/new', title: 'New hero', mounts: ['dialog'], template: '<input data-draft="name">' }],
    });
    return { st, runtime, ui, created };
}

test('a same-chat swipe with the same head record does not refuse a submit opened before it', async () => {
    const { st, runtime, ui, created } = await world();
    await st.loadChat([headReply()], 'chat-a');
    await runtime.turn.onChatChanged();
    ui.refresh();
    const handle = ui.mounts.dialog.open('qa-swipe/new', { submit: 'qa-swipe.create', draft: { name: 'Ren' } });
    assert.ok(handle, 'the dialog opened on the head');
    // The reader swipes the head to its other swipe: same chat, same head record, same text.
    st.ctx.chat[0].swipe_id = 1;
    const result = await handle.submit();
    assert.equal(result.ok, true, `not refused: ${result.code ?? ''}`);
    assert.deepEqual(created, [{ name: 'Ren' }]);
});

test('a different head record in the same chat still refuses a submit opened before it', async () => {
    const { st, runtime, ui, created } = await world();
    await st.loadChat([headReply()], 'chat-a');
    await runtime.turn.onChatChanged();
    ui.refresh();
    const handle = ui.mounts.dialog.open('qa-swipe/new', { submit: 'qa-swipe.create', draft: { name: 'Ren' } });
    assert.ok(handle);
    st.ctx.chat[0].extra.storySuite.sid = 'sw_head02';
    assert.equal((await handle.submit()).code, 'CHAT_CHANGED');
    assert.deepEqual(created, []);
});
