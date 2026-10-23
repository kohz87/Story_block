// One stack of modal layers (bug 3): the game view, the dialogs, the More sheet and the settings window share it. Only the
// topmost layer takes Escape and holds Tab; a layer that closes hands the focus back to what opened it; the shared listeners
// are there only while a layer is open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stackOf } from '../../../src/v2/view/modal-stack.js';
import { createDialogMount } from '../../../src/v2/view/mounts/dialog.js';
import { createScreenMount } from '../../../src/v2/view/mounts/screen.js';
import { fakeApi, fakeChat, fakeQuery, fakeRenderer, screensWith, setupDom } from '../../v2/view/mounts/helpers.js';

// A key the way the page gets it: every listener of that type, with the event's own fields.
function dispatch(doc, type, init = {}) {
    const event = { type, key: '', shiftKey: false, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...init };
    for (const entry of [...doc.listeners]) if (entry.type === type) entry.fn(event);
    return event;
}

function layerIn(doc, names) {
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const buttons = names.map(name => {
        const node = doc.createElement('button');
        node.textContent = name;
        root.appendChild(node);
        return node;
    });
    return { root, buttons };
}

test('only the topmost layer takes Escape', () => {
    const doc = setupDom();
    const stack = stackOf(doc);
    const low = layerIn(doc, ['a']);
    const high = layerIn(doc, ['b']);
    const calls = [];
    const lower = { name: 'low', root: low.root, onEscape: () => { calls.push('low'); return true; } };
    const upper = { name: 'high', root: high.root, onEscape: () => { calls.push('high'); return true; } };
    stack.push(lower);
    stack.push(upper);
    const event = dispatch(doc, 'keydown', { key: 'Escape' });
    assert.deepEqual(calls, ['high']);
    assert.equal(event.defaultPrevented, true);
    assert.equal(stack.top(), upper);
    stack.pop(upper);
    dispatch(doc, 'keydown', { key: 'Escape' });
    assert.deepEqual(calls, ['high', 'low'], 'after the top closes, the layer under it is the one that takes the key');
    stack.pop(lower);
});

test('a layer that does not take Escape (a field clearing its text, say) lets the key on', () => {
    const doc = setupDom();
    const stack = stackOf(doc);
    const layer = { name: 'settings', root: layerIn(doc, ['a']).root, onEscape: () => false };
    stack.push(layer);
    const event = dispatch(doc, 'keydown', { key: 'Escape' });
    assert.equal(event.defaultPrevented, false);
    assert.equal(stack.top(), layer, 'still open');
    stack.pop(layer);
});

test('Tab cycles inside the topmost layer, and a focus that lands outside it is brought back in', () => {
    const doc = setupDom();
    const stack = stackOf(doc);
    const page = doc.createElement('button');
    doc.body.appendChild(page);
    const top = layerIn(doc, ['x', 'y', 'z']);
    stack.push({ name: 'top', root: top.root, onEscape: () => true });
    top.buttons[2].focus();
    let event = dispatch(doc, 'keydown', { key: 'Tab' });
    assert.equal(doc.activeElement, top.buttons[0], 'past the last control to the first');
    assert.equal(event.defaultPrevented, true);
    event = dispatch(doc, 'keydown', { key: 'Tab', shiftKey: true });
    assert.equal(doc.activeElement, top.buttons[2], 'Shift+Tab back to the last');
    top.buttons[0].focus();
    event = dispatch(doc, 'keydown', { key: 'Tab' });
    assert.equal(event.defaultPrevented, false, 'a Tab between two controls is the browser\'s');
    page.focus();
    dispatch(doc, 'focusin', { target: page });
    assert.equal(doc.activeElement, top.buttons[0], 'the focus comes back into the layer');
    stack.pop(stack.top());
});

test('closing a layer hands the focus back to what opened it; the shared listeners go with the last layer', () => {
    const doc = setupDom();
    const stack = stackOf(doc);
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus();
    const top = layerIn(doc, ['x']);
    const layer = { name: 'dialog', root: top.root, onEscape: () => true };
    stack.push(layer);
    top.buttons[0].focus();
    assert.ok(doc.listeners.some(entry => entry.type === 'keydown'), 'listening while a layer is open');
    stack.pop(layer);
    assert.equal(doc.activeElement, opener, 'the focus is back on the opener');
    assert.equal(doc.listeners.filter(entry => ['keydown', 'keypress', 'focusin'].includes(entry.type)).length, 0, 'no listeners left');
});

test('an Enter on a page button that SillyTavern clicks is cancelled once by the browser (one click, not two)', () => {
    const doc = setupDom();
    const stack = stackOf(doc);
    const top = layerIn(doc, []);
    const menu = doc.createElement('button');
    menu.className = 'menu_button ss-modal-action';
    const plain = doc.createElement('button');
    top.root.append(menu, plain);
    stack.push({ name: 'top', root: top.root, onEscape: () => true });
    assert.equal(dispatch(doc, 'keydown', { key: 'Enter', target: menu }).defaultPrevented, true);
    assert.equal(dispatch(doc, 'keydown', { key: 'Enter', target: plain }).defaultPrevented, false, 'a button SillyTavern does not click keeps its own Enter');
    stack.pop(stack.top());
});

test('a game view with a dialog over it: one Escape closes the dialog only, the next closes the view; its More sheet first', () => {
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 5]);
    const screens = screensWith([
        { id: 'game/home', title: 'Home', icon: 'fa-house', mounts: ['screen'], template: '<p>Home</p>' },
        { id: 'game/new-hero', title: 'New hero', mounts: ['dialog'], template: '<input data-draft="name">' },
    ]);
    const deps = { screens, render: fakeRenderer(), query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api: fakeApi(), document: doc };
    const view = createScreenMount(deps);
    const dialogs = createDialogMount(deps);
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus();
    assert.equal(view.open('game/home'), true);

    const dialog = dialogs.open('game/new-hero', { draft: {} });
    assert.ok(dialog);
    dispatch(doc, 'keydown', { key: 'Escape' });
    assert.equal(dialog.isOpen(), false, 'the dialog closed');
    assert.equal(view.isOpen(), true, 'the game view stayed open');

    dispatch(doc, 'keydown', { key: 'Escape' });
    assert.equal(view.isOpen(), false, 'the next Escape closes the game view');
    assert.equal(doc.activeElement, opener, 'the focus is back on what opened the view');
});

test('Tab inside the game view stays in it, and the More sheet takes the keys while it is open', () => {
    const doc = setupDom();
    const chat = fakeChat(doc, [1]);
    const screens = screensWith([
        { id: 'game/home', title: 'Home', icon: 'fa-house', mounts: ['screen'], template: '<p>Home</p>' },
        { id: 'game/bag', title: 'Bag', icon: 'fa-bag-shopping', mounts: ['screen'], template: '<p>Bag</p>' },
    ]);
    const deps = { screens, render: fakeRenderer(), query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api: fakeApi(), document: doc };
    const view = createScreenMount(deps);
    const page = doc.createElement('button');
    doc.body.appendChild(page);
    view.open('game/home');
    const root = doc.body.querySelector('.ss-gameview');
    const inside = () => root.querySelectorAll('button').filter(node => !node.hidden);
    for (let i = 0; i < 12; i++) {
        dispatch(doc, 'keydown', { key: 'Tab' });
        assert.ok(root.contains(doc.activeElement) || inside().includes(doc.activeElement), `Tab ${i + 1} stayed in the game view`);
    }
    assert.equal(view.openMore(), true);
    dispatch(doc, 'keydown', { key: 'Escape' });
    assert.equal(view.isMoreOpen(), false, 'Escape closes More first');
    assert.equal(view.isOpen(), true, 'the view is still open');
    view.close();
});
