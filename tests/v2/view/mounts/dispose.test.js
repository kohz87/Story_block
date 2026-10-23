// A widget is taken down when the dialog or tab pane that holds it is removed or drawn again (bug 4): its listeners and its
// observers go, so a window opened and closed three times leaves nothing behind (no listener, no observer: the baseline).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogMount } from '../../../../src/v2/view/mounts/dialog.js';
import { createTabHost } from '../../../../src/v2/host-ui.js';
import { shell } from '../../../../src/v2/view/widgets/dom.js';
import { fakeApi, fakeChat, fakeQuery, screensWith, setupDom } from './helpers.js';

// Observers still connected (a ResizeObserver stands in: it is taken down by disconnect()).
const live = new Set();
class FakeObserver {
    constructor() { this.targets = new Set(); live.add(this); }
    observe(node) { this.targets.add(node); }
    disconnect() { this.targets.clear(); live.delete(this); }
}

// A widget like the map or the radar: a click listener on its root and an observer on it, both made in the shell and freed by its
// cleanup. `roots` collects each drawn root, so a test can count the listeners that are still on it.
function probe(el, roots) {
    return shell(el, 'div', 'probe', ({ root, listen, cleanup }) => {
        roots.push(root);
        listen(root, 'click', () => {});
        const observer = new FakeObserver();
        observer.observe(root);
        cleanup(() => observer.disconnect());
        return { update() {} };
    });
}

const holder = { id: 'game/probe', title: 'Probe', mounts: ['dialog', 'tab'], template: '' };

test('a dialog opened and closed three times leaves no listener and no observer behind', () => {
    live.clear();
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 5]);
    const roots = [];
    const render = (el, screen, scope) => probe(el, roots);
    const dialogs = createDialogMount({ screens: screensWith([holder]), render, query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api: fakeApi() });
    assert.equal(live.size, 0, 'the baseline');
    for (let round = 1; round <= 3; round++) {
        const handle = dialogs.open('game/probe', {});
        assert.ok(roots.at(-1).listeners.length >= 1, `round ${round}: the widget listens while it is open`);
        assert.ok(live.size >= 1, `round ${round}: and observes`);
        handle.close();
    }
    assert.equal(roots.length, 3);
    for (const [index, root] of roots.entries()) assert.equal(root.listeners.length, 0, `widget ${index + 1} stopped listening`);
    assert.equal(live.size, 0, 'no observer left');
});

test('a tab pane drawn again takes the widgets of its last drawing down', () => {
    live.clear();
    const doc = setupDom();
    const roots = [];
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const registry = { tabs: () => [{ id: 'game/probe', title: 'Probe', render: pane => probe(pane, roots) }] };
    const host = createTabHost(root, { registry, view: () => ({}), api: null, doc });
    host.refresh();
    host.refresh();
    assert.equal(roots.length, 3);
    for (const [index, node] of roots.slice(0, -1).entries()) assert.equal(node.listeners.length, 0, `earlier drawing ${index + 1} stopped listening`);
    assert.ok(roots.at(-1).listeners.length >= 1, 'the current drawing listens');
    assert.equal(live.size, 1, 'only the current drawing observes');
});
