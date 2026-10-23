// A wizard's field keeps the focus while it is typed in (bug 2): a draft change is drawn into the view that is there
// (a template's inputs stay), and a redraw that does rebuild a field puts the focus, the caret and the scroll back on
// the same field, by its draft key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogMount } from '../../../../src/v2/view/mounts/dialog.js';
import { createScreenRenderer } from '../../../../src/v2/view/render-screen.js';
import { fakeApi, fakeChat, fakeQuery, screensWith, setupDom } from './helpers.js';

const wizard = {
    id: 'game/new-hero',
    title: 'New hero',
    mounts: ['dialog'],
    template: '',
    steps: [
        { id: 'who', title: 'Who', template: '<input data-draft="name">' },
        { id: 'portrait', title: 'Portrait', template: '<input data-draft="portrait">' },
        { id: 'done', title: 'Done', template: '<button data-submit="party.create">Create</button>' },
    ],
};

function world(render) {
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 5]);
    const dialogs = createDialogMount({ screens: screensWith([wizard]), render, query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api: fakeApi() });
    return { doc, dialogs };
}

test('typing into a wizard field on the last step keeps the focus, the text and the caret (the view is updated, not rebuilt)', () => {
    const renderer = createScreenRenderer({ queryAt: () => null, widgets: () => ({}) });
    const { doc, dialogs } = world(renderer.render);
    const handle = dialogs.open('game/new-hero', { draft: {} });
    handle.goTo(1);
    const field = doc.body.querySelector('.ss-dialog-body [data-draft="portrait"]');
    field.focus();
    field.value = 'Ar';
    field.setSelectionRange(2, 2);
    field.dispatch('input');
    const now = doc.body.querySelector('.ss-dialog-body [data-draft="portrait"]');
    assert.equal(handle.draft.portrait, 'Ar');
    assert.equal(now.value, 'Ar');
    assert.equal(doc.activeElement, now, 'the field that was typed in still has the focus');
    assert.equal(now.selectionStart, 2, 'the caret stays where it was');
});

test('a redraw that rebuilds the fields puts the focus, the caret and the scroll back on the same field', () => {
    // A renderer that always builds its inputs again (a layout, say): the dialog must restore the field itself.
    let rebuilds = 0;
    const render = (el, screen, scope) => {
        rebuilds++;
        const doc = el.ownerDocument;
        el.replaceChildren();
        const input = doc.createElement('input');
        input.setAttribute('data-draft', 'portrait');
        input.value = String(scope.draft.portrait ?? '');
        input.addEventListener('input', () => scope.api.onDraft('portrait', input.value));
        el.appendChild(input);
    };
    const { doc, dialogs } = world(render);
    const handle = dialogs.open('game/new-hero', { draft: {} });
    handle.goTo(1);
    const body = doc.body.querySelector('.ss-dialog-body');
    const first = body.querySelector('[data-draft="portrait"]');
    body.scrollTop = 30;
    first.focus();
    first.value = 'Ar';
    first.setSelectionRange(2, 2);
    const before = rebuilds;
    first.dispatch('input');
    assert.equal(rebuilds, before + 1, 'the step was drawn again');
    const now = body.querySelector('[data-draft="portrait"]');
    assert.notEqual(now, first, 'the field was rebuilt by this renderer');
    assert.equal(now.value, 'Ar');
    assert.equal(doc.activeElement, now, 'the focus went back to the same field');
    assert.equal(now.selectionStart, 2, 'the caret is where it was');
    assert.equal(body.scrollTop, 30, 'the scroll is where it was');
});
