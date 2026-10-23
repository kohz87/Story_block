// Hiding the Story panel closes the dialogs the panel opened; destroying the UI closes every dialog and disposes the open tab pane
// (fix 8a review, blocking 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../src/v2/runtime.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { createFakeContext } from '../../testkit/fake-st.js';
import { setupDom } from './view/mounts/helpers.js';

async function setup() {
    const doc = setupDom();
    const st = createFakeContext();
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    await runtime.turn.onChatChanged();
    return { doc, ui, runtime };
}

test('hiding the Story panel closes a dialog the panel opened, and leaves one opened from the page alone', async () => {
    const { doc, ui, runtime } = await setup();
    await runtime.sdk.registerModule({
        id: 'qa-teardown',
        name: 'Teardown',
        version: '2.0.0-alpha.1',
        screens: [{ id: 'qa-teardown/ask', title: 'Ask', mounts: ['dialog'], template: '<p>Ask</p>' }],
        tabs: [{ id: 'bag', title: 'Bag', icon: 'fa-bag-shopping', render: () => {} }],
    });
    ui.refresh();
    ui.openPanel();
    const inPanel = doc.querySelector('.story-suite-sheet').querySelector('button') ?? doc.querySelector('.story-suite-sheet');
    // A dialog opened from the panel: its opener is a control in the panel.
    const button = doc.createElement('button');
    doc.querySelector('.story-suite-sheet').appendChild(button);
    button.focus();
    const fromPanel = ui.mounts.dialog.open('qa-teardown/ask', {});
    assert.ok(fromPanel, 'opened');
    assert.ok(inPanel);
    ui.closePanel();
    assert.equal(fromPanel.isOpen(), false, 'the dialog the panel opened closed with the panel');
    assert.equal(ui.mounts.dialog.current(), null);
    // A dialog opened from the page (its opener is outside the panel) stays open when the panel hides.
    ui.openPanel();
    const outside = doc.createElement('button');
    doc.body.appendChild(outside);
    outside.focus();
    const fromPage = ui.mounts.dialog.open('qa-teardown/ask', {});
    ui.closePanel();
    assert.equal(fromPage.isOpen(), true, 'a page dialog stays');
    fromPage.close();
});

test('destroying the UI closes every open dialog and disposes the open tab pane', async () => {
    const { doc, ui, runtime } = await setup();
    let disposed = 0;
    await runtime.sdk.registerModule({
        id: 'qa-teardown',
        name: 'Teardown',
        version: '2.0.0-alpha.1',
        screens: [{ id: 'qa-teardown/ask', title: 'Ask', mounts: ['dialog'], template: '<p>Ask</p>' }],
        tabs: [{ id: 'bag', title: 'Bag', icon: 'fa-bag-shopping', order: -100, render: () => () => { disposed += 1; } }],
    });
    ui.refresh();
    ui.openPanel();
    const dialog = ui.mounts.dialog.open('qa-teardown/ask', {});
    assert.equal(dialog.isOpen(), true);
    ui.destroy();
    assert.equal(dialog.isOpen(), false, 'the dialog closed');
    assert.equal(ui.mounts.dialog.current(), null);
    assert.equal(doc.body.querySelectorAll('.ss-dialog-backdrop').length, 0, 'no backdrop left');
    assert.equal(disposed, 1, 'the open tab pane was disposed');
});

test('a chat change closes the Story panel\'s More sheet too (the sheet belongs to the chat it was opened in)', async () => {
    const { doc, ui, runtime } = await setup();
    await runtime.sdk.registerModule({
        id: 'qa-teardown',
        name: 'Teardown',
        version: '2.0.0-alpha.1',
        screens: [{ id: 'qa-teardown/ask', title: 'Ask', mounts: ['dialog'], template: '<p>Ask</p>' }],
        tabs: [
            { id: 'bag', title: 'Bag', icon: 'fa-bag-shopping', render: () => {} },
            { id: 'map', title: 'Map', icon: 'fa-map', render: () => {} },
            { id: 'log', title: 'Log', icon: 'fa-scroll', render: () => {} },
            { id: 'people', title: 'People', icon: 'fa-users', render: () => {} },
            { id: 'notes', title: 'Notes', icon: 'fa-note-sticky', render: () => {} },
        ],
    });
    ui.refresh();
    ui.openPanel();
    const more = doc.querySelector('.story-suite-sheet .ss-screenbar-more');
    assert.ok(more, 'the panel bar has a More button');
    more.click();
    assert.equal(more.getAttribute('aria-expanded'), 'true', 'the panel\'s More sheet is open');
    await runtime.turn.onChatChanged();
    assert.equal(more.getAttribute('aria-expanded'), 'false', 'the sheet closed with the chat');
    assert.equal(doc.querySelector('.story-suite-sheet-bar .ss-screenbar-sheet')?.hidden ?? true, true, 'its sheet is hidden');
});
