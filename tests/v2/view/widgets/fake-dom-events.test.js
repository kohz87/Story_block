// The fake DOM's events keep their propagation state (fix 8a review, item 7): a stop at the target stops the rest of the path and the
// document's listeners; stopImmediatePropagation also stops the listeners on the same node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './fake-dom.js';

test('a stop at the target keeps the rest of the path from hearing the event (a parent, the document)', () => {
    const doc = installDom();
    const parent = doc.createElement('div');
    const child = doc.createElement('button');
    parent.appendChild(child);
    doc.body.appendChild(parent);
    const heard = [];
    child.addEventListener('keydown', event => { heard.push('child'); event.stopPropagation(); });
    parent.addEventListener('keydown', () => heard.push('parent'));
    doc.docListeners.push({ type: 'keydown', fn: () => heard.push('document'), capture: false });
    const event = child.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(heard, ['child']);
    assert.equal(event.stopped, true);
});

test('a stop on the document\'s capturing listener keeps the target from hearing the event', () => {
    const doc = installDom();
    const button = doc.createElement('button');
    doc.body.appendChild(button);
    const heard = [];
    doc.docListeners.push({ type: 'keydown', fn: event => { heard.push('capture'); event.stopPropagation(); }, capture: true });
    button.addEventListener('keydown', () => heard.push('target'));
    doc.fire('keydown', { key: 'Enter' }, button);
    assert.deepEqual(heard, ['capture']);
});

test('fire: a stop at the target stops the document\'s bubbling listeners (one event, one state)', () => {
    const doc = installDom();
    const button = doc.createElement('button');
    doc.body.appendChild(button);
    const heard = [];
    button.addEventListener('keydown', event => { heard.push('target'); event.stopPropagation(); });
    doc.docListeners.push({ type: 'keydown', fn: () => heard.push('document'), capture: false });
    const event = doc.fire('keydown', { key: 'Escape' }, button);
    assert.deepEqual(heard, ['target']);
    assert.equal(event.stopped, true, 'the event the caller holds says it was stopped');
});

test('stopImmediatePropagation stops the later listeners on the same node, and the document\'s', () => {
    const doc = installDom();
    const button = doc.createElement('button');
    doc.body.appendChild(button);
    const heard = [];
    button.addEventListener('keydown', event => { heard.push('first'); event.stopImmediatePropagation(); });
    button.addEventListener('keydown', () => heard.push('second'));
    doc.docListeners.push({ type: 'keydown', fn: () => heard.push('document'), capture: false });
    doc.fire('keydown', { key: 'Enter' }, button);
    assert.deepEqual(heard, ['first']);
    const other = doc.createElement('button');
    doc.body.appendChild(other);
    const seen = [];
    doc.docListeners.push({ type: 'keydown', fn: event => { seen.push('a'); event.stopImmediatePropagation(); }, capture: false });
    doc.docListeners.push({ type: 'keydown', fn: () => seen.push('b'), capture: false });
    doc.fire('keydown', { key: 'Enter' }, other);
    assert.deepEqual(seen, ['a']);
});
