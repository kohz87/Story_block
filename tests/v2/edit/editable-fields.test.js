// `ss.editable` kind `fields` beyond text and number (UI cleanup, Nov 2): `type: 'choice'` (a select over options) and `type: 'time'`, a text field's
// suggestions, groups and rows, `soft` numbers, blank numbers that stay blank, and a `plan` that runs several commands in order. The older uses
// (the mount editor on Home: ungrouped text and number fields, one command) keep their look and words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editable } from '../../../src/v2/view/widgets/editable.js';
import { host, installDom } from '../view/widgets/fake-dom.js';

const settle = async () => { for (let n = 0; n < 6; n += 1) await new Promise(resolve => setImmediate(resolve)); };
function mount(props, command) {
    const doc = installDom();
    const el = host(doc);
    const calls = [];
    const api = { command: async (...args) => { calls.push(args); return command ? command(...args) : { ok: true }; } };
    const handle = editable.render(el, props, api);
    const box = label => el.querySelectorAll('label').find(each => each.querySelector('span').textContent === label)?.querySelector('input') ?? el.querySelectorAll('label').find(each => each.querySelector('span').textContent === label)?.querySelector('select');
    return { doc, el, handle, calls, box, pencil: el.querySelector('.ss-w-editable-pencil'), save: () => el.querySelector('.ss-w-editable-save'), error: () => el.querySelector('.ss-w-editable-error')?.textContent };
}
const MONTHS = [{ value: 1, label: 'Dawnwane' }, { value: 2, label: 'Rainmoot' }];

test('a choice field is a select over its options and sends the option\'s own value (a number stays a number); a time field is a time box', async () => {
    const m = mount({ kind: 'fields', command: 'x.set', fields: [
        { key: 'month', label: 'Month', type: 'choice', value: 2, options: MONTHS },
        { key: 'when', label: 'Time', type: 'time', value: '13:30' },
        { key: 'kind', label: 'Kind', type: 'choice', value: 'b', options: ['a', 'b'] },
    ] });
    m.pencil.click();
    const month = m.box('Month');
    assert.equal(month.localName, 'select');
    assert.deepEqual(month.querySelectorAll('option').map(option => [option.value, option.textContent]), [['1', 'Dawnwane'], ['2', 'Rainmoot']]);
    assert.equal(month.value, '2');
    assert.equal(m.box('Time').getAttribute('type'), 'time');
    assert.equal(m.box('Time').value, '13:30');
    assert.equal(m.box('Kind').value, 'b');
    m.save().click();
    await settle();
    assert.deepEqual(m.calls, [], 'nothing changed: nothing sent');
    assert.equal(m.el.querySelector('.ss-w-editable-form'), null, 'closed');
    m.pencil.click();
    m.box('Month').value = '1';
    m.box('Time').value = '06:40';
    m.box('Kind').value = 'a';
    m.save().click();
    await settle();
    assert.deepEqual(m.calls, [['x.set', { month: 1, when: '06:40', kind: 'a' }]]);
});

test('a text field with options suggests them (a list of places); a soft number keeps min and max as hints and clamps nothing; a plain number still clamps', async () => {
    const m = mount({ kind: 'fields', command: 'x.set', fields: [
        { key: 'place', label: 'Place', type: 'text', value: 'Weir', options: ['Weir', { name: 'Harbour' }] },
        { key: 'day', label: 'Day', type: 'number', value: 5, min: 1, max: 30, soft: true },
        { key: 'hard', label: 'Hard', type: 'number', value: 5, min: 1, max: 30 },
    ] });
    m.pencil.click();
    assert.deepEqual(m.el.querySelectorAll('datalist option').map(option => option.value), ['Weir', 'Harbour']);
    assert.equal(m.box('Place').getAttribute('list'), m.el.querySelector('datalist').getAttribute('id'));
    assert.equal(m.box('Day').getAttribute('max'), '30');
    m.box('Day').value = '31';
    m.box('Hard').value = '99';
    m.save().click();
    await settle();
    assert.deepEqual(m.calls, [['x.set', { day: 31, hard: 30 }]], 'soft: 31 goes on to the command that knows the month; plain: clamped as before');
});

test('a blank number that was blank stays unchanged; one that had a value cannot be emptied; a grouped form names the field, an ungrouped one keeps the old words', async () => {
    const m = mount({ kind: 'fields', command: 'x.set', fields: [
        { key: 'year', label: 'Year', type: 'number', value: '' },
        { key: 'note', label: 'Note', type: 'text', value: '' },
    ] });
    m.pencil.click();
    m.box('Note').value = 'hi';
    m.save().click();
    await settle();
    assert.deepEqual(m.calls, [['x.set', { note: 'hi' }]]);
    const n = mount({ kind: 'fields', command: 'x.set', fields: [{ key: 'qty', label: 'How many', type: 'number', value: 3 }] });
    n.pencil.click();
    n.box('How many').value = '';
    n.save().click();
    await settle();
    assert.deepEqual(n.calls, []);
    assert.equal(n.error(), 'Enter a whole number.', 'ungrouped: the older words');
    const g = mount({ kind: 'fields', command: 'x.set', fields: [{ key: 'qty', label: 'How many', type: 'number', value: 3, group: 'Things' }] });
    g.pencil.click();
    g.box('How many').value = 'two';
    g.save().click();
    await settle();
    assert.deepEqual(g.calls, []);
    assert.equal(g.error(), 'How many: enter a whole number.');
});

test('groups: a fieldset and legend each in order of first use, fields of one row side by side, the help line, the sentence, then Save and Cancel; ungrouped fields keep the older layout', () => {
    const m = mount({ kind: 'fields', command: 'x.set', label: 'Edit things', help: 'Changes apply from this reply on.', fields: [
        { key: 'a', label: 'A', group: 'One', row: 'r' }, { key: 'b', label: 'B', group: 'One', row: 'r' }, { key: 'c', label: 'C', group: 'One' },
        { key: 'd', label: 'D', group: 'Two' },
    ] });
    m.pencil.click();
    const groups = m.el.querySelectorAll('fieldset.ss-w-editable-group');
    assert.deepEqual(groups.map(group => group.querySelector('legend').textContent), ['One', 'Two']);
    assert.equal(groups[0].querySelectorAll('.ss-w-editable-row').length, 1);
    assert.equal(groups[0].querySelector('.ss-w-editable-row').querySelectorAll('label').length, 2);
    const form = m.el.querySelector('.ss-w-editable-form');
    assert.equal(form.getAttribute('role'), 'group');
    assert.equal(form.getAttribute('aria-label'), 'Edit things');
    assert.deepEqual(form.childNodes.map(node => node.className.split(' ')[0] || node.localName), ['ss-w-editable-field', 'ss-w-editable-help', 'ss-w-editable-error', 'ss-w-editable-actions']);
    assert.deepEqual(form.querySelector('.ss-w-editable-actions').childNodes.map(node => node.textContent), ['Save', 'Cancel']);
    const plain = mount({ kind: 'fields', command: 'x.set', fields: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] });
    plain.pencil.click();
    assert.equal(plain.el.querySelector('fieldset'), null);
    assert.equal(plain.el.querySelector('.ss-w-editable-help'), null);
    assert.ok(plain.el.querySelector('.ss-w-editable-record-fields'));
});

test('a plan runs its steps in order through the api; the first refusal stops the rest, shows its sentence and keeps the form; a step done is not sent again', async () => {
    const plan = (changed, all) => ({ steps: [
        ...('a' in changed ? [{ command: 'x.a', payload: { v: all.a }, keys: ['a'] }] : []),
        ...('b' in changed ? [{ command: 'x.b', payload: { v: all.b }, keys: ['b'] }] : []),
        ...('c' in changed ? [{ command: 'x.c', payload: { v: all.c }, keys: ['c'] }] : []),
    ] });
    let refuse = true;
    const m = mount({ kind: 'fields', bare: true, open: true, plan, fields: [{ key: 'a', label: 'A', value: '1' }, { key: 'b', label: 'B', value: '2' }, { key: 'c', label: 'C', value: '3' }] },
        type => (type === 'x.b' && refuse ? { ok: false, message: 'B is not allowed.' } : { ok: true }));
    assert.ok(m.el.querySelector('.ss-w-editable-form'), 'open at once (`open`), with no pencil');
    assert.equal(m.pencil.hidden, true, 'bare: no pencil');
    m.box('A').value = 'a2';
    m.box('B').value = 'b2';
    m.box('C').value = 'c2';
    m.save().click();
    await settle();
    assert.deepEqual(m.calls, [['x.a', { v: 'a2' }], ['x.b', { v: 'b2' }]], 'the third was not sent');
    assert.equal(m.error(), 'B is not allowed.');
    assert.ok(m.el.querySelector('.ss-w-editable-form'));
    assert.equal(m.save().disabled, false);
    refuse = false;
    m.save().click();
    await settle();
    assert.deepEqual(m.calls.slice(2), [['x.b', { v: 'b2' }], ['x.c', { v: 'c2' }]], 'A went through before: not again');
    assert.equal(m.el.querySelector('.ss-w-editable-form'), null);
});

test('a plan\'s error sends nothing; a plan with no steps closes; `onClose` hears of every close but not of one the `open` prop asked for; Escape closes', async () => {
    let closed = 0;
    const base = { kind: 'fields', bare: true, open: true, onClose: () => { closed += 1; }, fields: [{ key: 'a', label: 'A', value: '1' }] };
    const m = mount({ ...base, plan: () => ({ error: 'No.' }) });
    m.box('A').value = '2';
    m.save().click();
    await settle();
    assert.deepEqual(m.calls, []);
    assert.equal(m.error(), 'No.');
    assert.equal(closed, 0);
    m.el.querySelector('.ss-w-editable-form').dispatch('keydown', { key: 'Escape' });
    assert.equal(closed, 1);
    assert.equal(m.el.querySelector('.ss-w-editable-form'), null);
    m.handle.update({ ...base, open: false, plan: () => ({ steps: [] }) });
    m.handle.update({ ...base, open: true, plan: () => ({ steps: [] }) });
    assert.ok(m.el.querySelector('.ss-w-editable-form'), '`open` opens it');
    m.box('A').value = '2';
    m.save().click();
    await settle();
    assert.equal(closed, 2, 'no steps: closed');
    m.handle.update({ ...base, open: true, plan: () => ({ steps: [] }) });
    m.handle.update({ ...base, open: false, plan: () => ({ steps: [] }) });
    assert.equal(m.el.querySelector('.ss-w-editable-form'), null, 'the `open` prop closes it');
    assert.equal(closed, 2, 'and the caller is not told of what it asked for');
});
