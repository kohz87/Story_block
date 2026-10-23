// A dialog belongs to the chat and the story it was opened on (bug 1): a chat change closes it, the More sheet with it,
// and a submit, a roll or an accept whose chat or branch no longer matches sends nothing and says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogMount } from '../../../../src/v2/view/mounts/dialog.js';
import { createRuntime } from '../../../../src/v2/runtime.js';
import { mountUi } from '../../../../src/v2/ui-host.js';
import { createFakeContext } from '../../../../testkit/fake-st.js';
import { fakeApi, fakeChat, fakeQuery, fakeRenderer, screensWith, setupDom } from './helpers.js';

const wizard = {
    id: 'game/new-hero',
    title: 'New hero',
    mounts: ['dialog'],
    template: '',
    data: { hp: { query: 'party.hp' } },
    steps: [
        { id: 'who', title: 'Who', template: '<input data-draft="name">' },
        { id: 'done', title: 'Done', template: '<button data-submit="party.create">Create</button>' },
    ],
};

// `at` is what the dialog reads as "the chat and the branch now": { chat, branch }.
function world(at) {
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 5]);
    const api = fakeApi();
    const deps = { screens: screensWith([wizard]), render: fakeRenderer(), query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api, chatScope: () => ({ ...at }) };
    return { doc, api, dialogs: createDialogMount(deps) };
}

test('a submit after the chat changed sends nothing, keeps the reason on screen', async () => {
    const at = { chat: 'chat-a', branch: '1:s1' };
    const { doc, api, dialogs } = world(at);
    const handle = dialogs.open('game/new-hero', { draft: { name: 'Ren' } });
    handle.goTo(1);
    at.chat = 'chat-b';
    const result = await handle.submit();
    assert.equal(result.code, 'CHAT_CHANGED');
    assert.deepEqual(api.calls, [], 'nothing sent into the other chat');
    const error = doc.body.querySelector('.ss-dialog-error');
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /opened in another chat/);
});

test('a roll or an accept after the story moved on (the branch changed) is refused too', async () => {
    const at = { chat: 'chat-a', branch: '1:s1' };
    const { api, dialogs } = world(at);
    const handle = dialogs.open('game/new-hero', { random: 'party.roll', submit: 'party.create' });
    await handle.random();
    assert.equal(api.calls.length, 1);
    at.branch = '2:s2';
    assert.equal((await handle.accept()).code, 'CHAT_CHANGED');
    assert.equal((await handle.random()).code, 'CHAT_CHANGED');
    assert.equal((await handle.submit()).code, 'CHAT_CHANGED');
    assert.deepEqual(api.calls.map(call => call[0]), ['preview'], 'no commit and no second preview');
});

test('the same chat and branch: the submit goes through as before', async () => {
    const { api, dialogs } = world({ chat: 'chat-a', branch: '1:s1' });
    const handle = dialogs.open('game/new-hero', { draft: { name: 'Ren' } });
    handle.goTo(1);
    assert.equal((await handle.submit()).ok, true);
    assert.deepEqual(api.calls, [['command', 'party.create', { name: 'Ren' }, { cause: 'ui' }]]);
});

test('a chat change closes every open dialog and the More sheet; the old dialog cannot create anything', async t => {
    t.mock.method(console, 'warn', () => {});
    const created = [];
    const doc = setupDom();
    const st = createFakeContext();
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    await runtime.sdk.registerModule({
        id: 'qa-wiz',
        name: 'Wizard',
        version: '2.0.0-alpha.1',
        commands: { 'qa-wiz.create'(ctx, payload) { created.push(payload); return { summary: 'Created.' }; } },
        screens: [
            { id: 'qa-wiz/new', title: 'New hero', mounts: ['dialog', 'screen'], template: '<input data-draft="name">' },
            { id: 'qa-wiz/bag', title: 'Bag', mounts: ['screen'], template: '<p>Bag</p>' },
        ],
    });
    ui.refresh();
    const handle = ui.mounts.dialog.open('qa-wiz/new', { submit: 'qa-wiz.create', draft: { name: 'Ren' } });
    assert.ok(handle, 'the dialog opened');
    assert.equal(ui.mounts.screen.open('qa-wiz/bag'), true);
    assert.equal(ui.mounts.screen.openMore(), true, 'the More sheet is open');
    assert.equal(ui.mounts.screen.isMoreOpen(), true);

    await st.loadChat([], 'chat-b');

    assert.equal(handle.isOpen(), false, 'the dialog closed with the chat');
    assert.equal(ui.mounts.dialog.current(), null);
    assert.equal(ui.mounts.screen.isMoreOpen(), false, 'the More sheet closed with the chat');
    assert.equal(ui.mounts.screen.isOpen(), true, 'the game view itself stays open');
    assert.equal((await handle.submit()).code, 'CLOSED');
    assert.deepEqual(created, []);
});
