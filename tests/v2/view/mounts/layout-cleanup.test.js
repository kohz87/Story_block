// A layout's widgets are taken down when the dialog that holds them is closed or drawn again (fix 8a review, blocking 1): a window
// with a radar and a dialog in its layout, opened and closed 100 times, leaves no ResizeObserver, no modal layer and no document
// listener, and nothing left over that takes the keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogMount } from '../../../../src/v2/view/mounts/dialog.js';
import { createScreenRenderer } from '../../../../src/v2/view/render-screen.js';
import { standardWidgets } from '../../../../src/v2/view/widgets/index.js';
import { stackOf } from '../../../../src/v2/view/modal-stack.js';
import { fakeApi, fakeChat, fakeQuery, screensWith, setupDom } from './helpers.js';

const observers = new Set();
class FakeObserver {
    constructor() { this.targets = new Set(); observers.add(this); }
    observe(node) { this.targets.add(node); }
    unobserve(node) { this.targets.delete(node); }
    disconnect() { this.targets.clear(); observers.delete(this); }
}

const panel = {
    id: 'qa/panel',
    title: 'Panel',
    mounts: ['dialog'],
    layout: {
        root: {
            type: 'col',
            children: [
                { type: 'ss.radar', props: { axes: [{ label: 'STR', value: 3, max: 5 }, { label: 'DEX', value: 4, max: 5 }, { label: 'INT', value: 2, max: 5 }] } },
                { type: 'ss.dialog', props: { title: 'Inner', text: 'Keep going?', open: true } },
            ],
        },
    },
};

test('a dialog with a radar and a dialog in its layout, opened and closed 100 times, leaves nothing behind', () => {
    const doc = setupDom();
    // The radar takes its observer from the document's window (widgets/radar.js); the fake stands in there.
    doc.defaultView = { ...(doc.defaultView ?? {}), ResizeObserver: FakeObserver };
    {
        observers.clear();
        const chat = fakeChat(doc, [1, 5]);
        const renderer = createScreenRenderer({ queryAt: () => null, widgets: () => ({ ...standardWidgets }) });
        const dialogs = createDialogMount({ screens: screensWith([panel]), render: renderer.render, query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api: fakeApi() });
        const listenersBefore = doc.listeners.length;
        for (let round = 0; round < 100; round++) {
            const handle = dialogs.open('qa/panel', {});
            assert.ok(handle, `round ${round}: the dialog opened`);
            assert.ok(observers.size >= 1, `round ${round}: the radar observes while the dialog is open`);
            handle.close();
        }
        assert.equal(observers.size, 0, 'no ResizeObserver left');
        assert.equal(stackOf(doc).layers().length, 0, 'no modal layer left (the inner dialog\'s)');
        assert.equal(doc.listeners.filter(entry => ['keydown', 'focusin', 'keypress'].includes(entry.type)).length, 0, 'no document key or focus listener left');
        assert.equal(doc.listeners.length, listenersBefore, 'the document listeners are back at the baseline');
        assert.equal(doc.body.querySelectorAll('.ss-dialog-backdrop').length, 0, 'no backdrop left');
        // The top of the stack takes Escape: with nothing open, an Escape closes nothing and reaches nothing.
        assert.doesNotThrow(() => doc.key('Escape'));
        const again = dialogs.open('qa/panel', {});
        assert.equal(again.isOpen(), true, 'a fresh open after 100 rounds works');
        again.close();
    }
});
