// Dialogs and wizards (SPEC §13.4, §13.6): head + draft, steps sharing one draft, Back/Next, the last step
// submits one command, Random previews and Accept commits that exact token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogMount } from '../../../../src/v2/view/mounts/dialog.js';
import { fakeApi, fakeChat, fakeQuery, fakeRenderer, screensWith, setupDom } from './helpers.js';

const wizard = {
    id: 'game/new-hero',
    title: 'New hero',
    mounts: ['dialog'],
    template: '',
    data: { hp: { query: 'party.hp' } },
    steps: [
        { id: 'who', title: 'Who', template: '<input data-draft="name">' },
        { id: 'stats', title: 'Stats', template: '<ss-widget name="stepper"></ss-widget>' },
        { id: 'done', title: 'Done', template: '<button data-submit="party.create">Create</button>' },
    ],
};

function world(defs = [wizard]) {
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 5]);
    const render = fakeRenderer();
    const api = fakeApi();
    const deps = { screens: screensWith(defs), render, query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api };
    return { doc, chat, render, api, dialogs: createDialogMount(deps) };
}

// The fake renderer stands in for data-draft inputs: what a step "types" goes into scope.draft.
function typeInto(render, values) {
    Object.assign(render.last().scope.draft, values);
}

test('a wizard: steps share one draft, Back/Next move, the last step submits one command', async () => {
    const { doc, chat, render, api, dialogs } = world();
    let done = null;
    const handle = dialogs.open('game/new-hero', { draft: { name: '', points: 10 }, onDone: result => { done = result; } });
    const root = doc.body.querySelector('.ss-dialog');
    assert.equal(root.getAttribute('role'), 'dialog');
    assert.equal(root.querySelector('.ss-dialog-title').textContent, 'New hero');
    assert.deepEqual(root.querySelectorAll('.ss-dialog-step').map(li => li.textContent), ['Who', 'Stats', 'Done']);
    assert.equal(root.querySelector('[aria-current="step"]').textContent, 'Who');
    assert.equal(root.querySelector('.ss-dialog-back').hidden, true);
    assert.equal(root.querySelector('.ss-dialog-next').hidden, false);

    // Step 1 draws its own template with head state and the draft.
    let call = render.last();
    assert.equal(call.screen.template, '<input data-draft="name">');
    assert.equal(call.screen.steps, undefined);
    assert.equal(call.scope.state, chat.states[1]);
    assert.deepEqual(call.scope.q, { hp: 50 });
    assert.equal(call.scope.mount, 'dialog');
    typeInto(render, { name: 'Ren' });

    root.querySelector('.ss-dialog-next').click();
    assert.equal(handle.stepId(), 'stats');
    call = render.last();
    assert.equal(call.scope.draft, handle.draft, 'one draft object for every step');
    assert.equal(call.scope.draft.name, 'Ren');
    typeInto(render, { points: 4, str: 6 });

    root.querySelector('.ss-dialog-back').click();
    assert.equal(handle.stepId(), 'who');
    assert.equal(render.last().scope.draft.str, 6, 'going back keeps what later steps filled');
    handle.next();
    handle.next();
    assert.equal(handle.stepId(), 'done');
    assert.equal(handle.next(), 2, 'no step past the last');
    assert.equal(root.querySelector('.ss-dialog-next').hidden, true);
    assert.equal(root.querySelector('.ss-dialog-submit').hidden, true, 'the template has its own submit button');
    assert.deepEqual(api.calls, [], 'nothing sent before the last step submits');

    // The template's [data-submit] button sends the draft as exactly one command, even clicked twice.
    const send = root.querySelector('.ss-dialog-body [data-submit]');
    send.click();
    send.click();
    const result = await handle.closed;
    assert.deepEqual(api.calls, [['command', 'party.create', { name: 'Ren', points: 4, str: 6 }, { cause: 'ui' }]]);
    assert.equal(result.ok, true);
    assert.equal(done, result);
    assert.equal(doc.body.querySelector('.ss-dialog'), null);
});

test('a rejected submit stays open with the reason; the starting draft is copied', async () => {
    const { doc, api, dialogs } = world();
    const start = { name: 'Ren' };
    const handle = dialogs.open('game/new-hero', { draft: start });
    handle.draft.name = 'Changed';
    assert.equal(start.name, 'Ren');
    handle.goTo(2);
    api.nextCommand = { ok: false, code: 'INVALID', message: 'Spend every point first.' };
    const result = await handle.submit();
    assert.equal(result.code, 'INVALID');
    assert.equal(handle.isOpen(), true);
    const error = doc.body.querySelector('.ss-dialog-error');
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, 'Spend every point first.');
    api.nextCommand = { ok: true, receipt: {} };
    await handle.submit();
    assert.equal(handle.isOpen(), false);
    assert.equal(api.calls.length, 2);
});

test('a [data-submit] button on an earlier step moves to the next step instead of sending', () => {
    const early = { ...wizard, steps: [{ id: 'a', template: '<button data-submit="x.y">Go</button>' }, { id: 'b', template: '' }] };
    const { doc, api, dialogs } = world([early]);
    const handle = dialogs.open('game/new-hero');
    doc.body.querySelector('.ss-dialog-body [data-submit]').click();
    assert.equal(handle.stepId(), 'b');
    assert.deepEqual(api.calls, []);
});

test('Random previews and shows the receipt; Accept commits exactly that token', async () => {
    const { doc, api, dialogs } = world();
    let done = null;
    const handle = dialogs.open('game/new-hero', { draft: { name: 'Ren' }, random: 'party.roll', onDone: result => { done = result; } });
    const root = doc.body.querySelector('.ss-dialog');
    const random = root.querySelector('.ss-dialog-random');
    assert.equal(random.hidden, false);
    random.click();
    await new Promise(resolve => setImmediate(resolve));
    await handle.random();   // a second roll replaces the first
    assert.deepEqual(api.calls.map(call => call.slice(0, 2)), [['preview', 'party.roll'], ['preview', 'party.roll']]);
    assert.deepEqual(api.calls[0][2], { name: 'Ren' });
    const receipt = root.querySelector('.ss-dialog-receipt');
    assert.equal(receipt.hidden, false);
    assert.equal(receipt.querySelector('.ss-dialog-receipt-text').textContent, 'Rolled 6.');

    root.querySelector('.ss-dialog-accept').click();
    const result = await handle.closed;
    assert.deepEqual(api.calls.at(-1), ['commit', 'pv_2']);
    assert.equal(api.calls.filter(call => call[0] === 'command').length, 0, 'accepting is not a second command');
    assert.equal(result.receipt.summary, 'Kept pv_2.');
    assert.equal(done, result);
});

test('Random: a payload of its own, a failed preview, a stale commit, accept without a roll', async () => {
    const { doc, api, dialogs } = world();
    const handle = dialogs.open('game/new-hero', { random: { type: 'party.roll', payload: { dice: '4d6' } } });
    assert.equal((await handle.accept()).code, 'NO_PREVIEW');
    api.nextPreview = { ok: false, code: 'NOT_ENOUGH', message: 'No rerolls left.' };
    await handle.random();
    assert.deepEqual(api.calls[0], ['preview', 'party.roll', { dice: '4d6' }]);
    assert.equal(doc.body.querySelector('.ss-dialog-error').textContent, 'No rerolls left.');
    assert.equal(doc.body.querySelector('.ss-dialog-receipt').hidden, true);

    api.nextPreview = null;
    await handle.random();
    api.commit = async token => { api.calls.push(['commit', token]); return { ok: false, code: 'STALE', message: 'The story changed since this preview; try the action again.' }; };
    const stale = await handle.accept();
    assert.equal(stale.code, 'STALE');
    assert.equal(handle.isOpen(), true);
    assert.match(doc.body.querySelector('.ss-dialog-error').textContent, /story changed/);
    assert.equal((await handle.accept()).code, 'NO_PREVIEW', 'a token is used once');

    const plain = world().dialogs.open('game/new-hero');
    assert.equal((await plain.random()).code, 'NO_COMMAND');
});

test('a one-step dialog with a footer submit; Esc and the close button close it', async () => {
    const form = { id: 'shop/sell', title: 'Sell', mounts: ['dialog', 'tab'], template: '<input data-draft="qty">' };
    const { doc, api, dialogs } = world([form]);
    let closedWith = 'unset';
    const handle = dialogs.open('shop/sell', { submit: 'trade.sell', draft: { qty: 1 }, onClose: result => { closedWith = result; } });
    const root = doc.body.querySelector('.ss-dialog');
    assert.equal(root.querySelector('.ss-dialog-steps').hidden, true);
    assert.equal(root.querySelector('.ss-dialog-submit').hidden, false);
    assert.equal(root.querySelector('.ss-dialog-random').hidden, true);
    const event = doc.key('Escape');
    assert.equal(event.defaultPrevented, true);
    assert.equal(handle.isOpen(), false);
    assert.equal(closedWith, null);
    assert.equal(await handle.closed, null);
    assert.equal(doc.listeners.length, 0);

    const again = dialogs.open('shop/sell', { submit: 'trade.sell', draft: { qty: 2 } });
    doc.body.querySelector('.ss-dialog-submit').click();
    await again.closed;
    assert.deepEqual(api.calls, [['command', 'trade.sell', { qty: 2 }, { cause: 'ui' }]]);

    const third = dialogs.open('shop/sell');
    assert.equal((await third.submit()).code, 'NO_COMMAND');
    doc.body.querySelector('.ss-dialog-close').click();
    assert.equal(third.isOpen(), false);
    assert.equal(dialogs.current(), null);
});

test('Esc closes only the topmost dialog', () => {
    const { doc, dialogs } = world();
    const first = dialogs.open('game/new-hero');
    const second = dialogs.open('game/new-hero');
    doc.key('Escape');
    assert.deepEqual([first.isOpen(), second.isOpen()], [true, false]);
    assert.equal(dialogs.current(), first);
    dialogs.closeAll();
    assert.equal(first.isOpen(), false);
});
