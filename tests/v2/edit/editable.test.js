import test from 'node:test';
import assert from 'node:assert/strict';
import { editable } from '../../../src/v2/view/widgets/editable.js';
import { fakeApi, host, installDom } from '../view/widgets/fake-dom.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function mount(props, command) {
    const doc = installDom();
    const el = host(doc);
    const api = command ? { command } : fakeApi();
    const handle = editable.render(el, props, api);
    return { doc, el, handle, pencil: el.querySelector('.ss-w-editable-pencil') };
}

test('a number edit focuses, refuses empty or fractional input, clamps, and returns focus on success', async () => {
    const calls = [];
    const m = mount({ value: 2, kind: 'number', min: -10, max: 10, label: 'Standing', command: 'dm.set', payload: { field: 'rank' } }, async (...args) => { calls.push(args); return { ok: true }; });
    m.pencil.click();
    const input = m.el.querySelector('input');
    assert.equal(m.doc.activeElement, input);
    input.value = '';
    input.dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.match(m.el.querySelector('.ss-w-editable-error').textContent, /whole number/);
    input.value = '1.5';
    input.dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.equal(calls.length, 0);
    input.value = '55';
    input.dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.deepEqual(calls, [['dm.set', { field: 'rank', value: 10 }]]);
    assert.equal(m.doc.activeElement, m.pencil);
    assert.equal(m.el.querySelector('.ss-w-editable-form'), null);
    m.handle.destroy();
});

test('a refusal stays open, Escape cancels, and text is cut by code point', async () => {
    const calls = [];
    const m = mount({ value: '<old>', kind: 'text', maxLength: 3, command: 'test.set', valueKey: 'name' }, async (...args) => { calls.push(args); return { ok: false, message: 'That name is taken.' }; });
    assert.equal(m.el.querySelector('.ss-w-editable-value').textContent, '<old>');
    m.pencil.click();
    const input = m.el.querySelector('input');
    input.value = '😀abcd';
    input.dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.deepEqual(calls, [['test.set', { name: '😀ab' }]]);
    assert.equal(m.el.querySelector('.ss-w-editable-error').textContent, 'That name is taken.');
    assert.equal(m.el.querySelector('.ss-w-editable-form').hidden, false);
    input.dispatch('keydown', { key: 'Escape' });
    assert.equal(m.doc.activeElement, m.pencil);
    assert.equal(m.el.querySelector('.ss-w-editable-form'), null);
});

test('list chips remove and add entries; without a command the pencil is hidden', async () => {
    const calls = [];
    const m = mount({ value: ['Ren', 'Mira'], kind: 'list', command: 'scene.present' }, async (...args) => { calls.push(args); return { ok: true }; });
    m.pencil.click();
    m.el.querySelector('.ss-w-editable-remove').click();
    const input = m.el.querySelector('input');
    input.value = 'Fenna';
    input.dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.deepEqual(calls, [['scene.present', { value: ['Mira', 'Fenna'] }]]);
    const doc = installDom();
    const el = host(doc);
    editable.render(el, { value: 'Read only', command: 'test.set' }, {});
    assert.equal(el.querySelector('.ss-w-editable-pencil').hidden, true);
});
