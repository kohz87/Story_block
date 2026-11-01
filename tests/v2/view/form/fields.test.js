// The form engine's field renderers (view/form/fields.js): what each draws, its ARIA, its keys, what it hands to
// onChange (only on a choice, never while typing), the states (disabled, read-only), and the lines list's reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../../ui-fake-dom.js';
import { RENDERERS, chipsField, chipsetField, linesField, newId, numberField, profileField, searchField, sectionBlock, segmentedField, selectField, sliderField, switchField, textField } from '../../../../src/v2/view/form/fields.js';
import { FIELD_KINDS, changeNote, fieldKind, labelOf, matchesSearch, optionsOf } from '../../../../src/v2/view/form/schema.js';
import { PROFILE_TEXT } from '../../../../src/v2/profile-field.js';

const doc = installFakeDom();
const classes = node => node.classes();
function make(renderer, field, value, extra = {}) {
    const calls = [];
    const invalid = [];
    const notes = [];
    const ctx = {
        doc, id: newId('t'), key: 'k', field, value, label: 'Label', labelledBy: 'lbl', disabled: false, readOnly: false, memo: new Map(),
        onChange: (next, meta) => calls.push([next, meta]), invalid: message => invalid.push(message), note: message => notes.push(message), ...extra,
    };
    const handle = renderer(ctx);
    doc.body.appendChild(handle.el);
    return { handle, calls, invalid, notes, el: handle.el, input: handle.input };
}

test('the renderers by kind, and which kind a schema field gets', () => {
    assert.deepEqual(Object.keys(RENDERERS), FIELD_KINDS);
    assert.equal(fieldKind({ type: 'bool' }), 'switch');
    assert.equal(fieldKind('bool'), 'switch');
    assert.equal(fieldKind({ type: 'text' }), 'text');
    assert.equal(fieldKind({ type: 'int' }), 'number');
    assert.equal(fieldKind({ type: 'int', min: 0, max: 9, form: 'slider' }), 'slider');
    assert.equal(fieldKind({ type: 'int', form: 'slider' }), 'number', 'a slider needs whole-number bounds');
    assert.equal(fieldKind({ type: 'int', min: 5, max: 5, form: 'slider' }), 'number');
    assert.equal(fieldKind({ type: 'choice', options: ['a'] }), 'select');
    assert.equal(fieldKind(['a', 'b']), 'select', 'an array is a choice');
    assert.equal(fieldKind({ type: 'choice', options: ['a'], form: 'chips' }), 'chips');
    assert.equal(fieldKind({ type: 'profile' }), 'profile');
    assert.equal(fieldKind({ type: 'text', form: 'chips', options: ['a'] }), 'chipset', 'chips over a text');
    assert.equal(fieldKind({ type: 'text', form: 'chips' }), 'text', 'no options: a plain text');
    assert.equal(fieldKind({ type: 'list', of: {} }), 'lines');
    assert.equal(fieldKind({ type: 'hologram' }), null, 'a newer module\'s type: not drawn');
    assert.equal(fieldKind(null), null);
    assert.deepEqual(optionsOf({ options: ['a', { value: 'b', label: 'Bee' }, { value: 3 }] }), [{ value: 'a', label: 'a' }, { value: 'b', label: 'Bee' }, { value: '3', label: '3' }]);
    assert.equal(labelOf('partyMembers', {}), 'Party Members', 'as the overlay does');
    assert.equal(labelOf('x', { label: 'Mine' }), 'Mine');
});

test('changeNote and matchesSearch: the words for a value moved by the store, and the search', () => {
    assert.match(changeNote({ type: 'int', min: 1, max: 10 }, 99, 10), /Set to 10, the most/);
    assert.match(changeNote({ type: 'int', min: 1, max: 10 }, -4, 1), /Set to 1, the least/);
    assert.equal(changeNote({ type: 'int' }, 5, 5), '');
    assert.match(changeNote({ type: 'text', max: 5 }, 'abcdefgh', 'abcde'), /Cut to 5 characters/);
    assert.equal(changeNote({ type: 'text' }, 'a', 'a'), '');
    assert.equal(changeNote({ type: 'bool' }, true, false), '');
    assert.ok(matchesSearch('budget', { label: 'Story coin per reply', help: 'Quest rewards' }, 'Money', 'coin'));
    assert.ok(matchesSearch('budget', { label: 'Story coin per reply' }, 'Money', 'MONEY story'), 'every word, anywhere, any case');
    assert.ok(!matchesSearch('budget', { label: 'Story coin per reply' }, 'Money', 'coin dragon'));
    assert.ok(matchesSearch('k', {}, 'g', '  '), 'an empty search matches all');
});

test('switch: a button with role=switch, aria-checked, named by its label; a click toggles and reports; locked ones do not', () => {
    const m = make(switchField, { type: 'bool' }, true);
    assert.equal(m.input.tagName, 'BUTTON');
    assert.equal(m.input.getAttribute('type'), 'button');
    assert.equal(m.input.getAttribute('role'), 'switch');
    assert.equal(m.input.getAttribute('aria-labelledby'), 'lbl');
    assert.equal(m.input.getAttribute('aria-checked'), 'true');
    assert.ok(classes(m.input).includes('ss-switch') && classes(m.input).includes('ss-switch-on'));
    m.input.click();
    assert.deepEqual(m.calls, [[false, undefined]]);
    assert.equal(m.input.getAttribute('aria-checked'), 'false');
    assert.ok(!classes(m.input).includes('ss-switch-on'));
    m.handle.set(true);
    assert.equal(m.input.getAttribute('aria-checked'), 'true');
    assert.equal(m.handle.get(), true);
    m.handle.setReadOnly(true);
    assert.equal(m.input.disabled, true);
    assert.equal(m.input.getAttribute('aria-disabled'), 'true');
    m.input.click();
    assert.equal(m.calls.length, 1, 'read-only: no change');
    m.handle.setReadOnly(false);
    assert.equal(m.input.disabled, false);
    m.handle.setDisabled(true);
    m.input.click();
    assert.equal(m.calls.length, 1, 'disabled: no change');
    // A label that stands in for the name (inside a list's row).
    const lone = make(switchField, { type: 'bool' }, false, { labelledBy: '', ariaLabel: 'On, item 1' });
    assert.equal(lone.input.getAttribute('aria-label'), 'On, item 1');
});

test('text: reports on change (not while typing), cuts a paste at its max, counts a text area, read-only is aria-readonly', () => {
    const m = make(textField, { type: 'text', max: 5 }, 'hello');
    assert.equal(m.input.tagName, 'INPUT');
    assert.equal(m.input.type, 'text');
    assert.equal(m.input.maxLength, 5);
    assert.equal(m.input.getAttribute('aria-labelledby'), 'lbl');
    m.input.value = 'abc';
    m.input.dispatch('input');
    assert.equal(m.calls.length, 0, 'not while typing');
    m.input.dispatch('change');
    assert.deepEqual(m.calls, [['abc', { typed: 'abc' }]]);
    m.input.value = 'abcdefghij';
    m.input.dispatch('change');
    assert.equal(m.input.value, 'abcde');
    assert.deepEqual(m.calls.at(-1), ['abcde', { typed: 'abcdefghij' }], 'what the reader pasted is passed on, so the form can say it was cut');
    m.handle.set('xy');
    assert.equal(m.handle.get(), 'xy');
    m.handle.setReadOnly(true);
    assert.equal(m.input.readOnly, true);
    assert.equal(m.input.getAttribute('aria-readonly'), 'true');
    m.handle.setReadOnly(false);
    assert.equal(m.input.getAttribute('aria-readonly'), null);
    m.handle.setDisabled(true);
    assert.equal(m.input.disabled, true);
    const area = make(textField, { type: 'text', multiline: true, max: 20 }, 'one two');
    assert.equal(area.input.tagName, 'TEXTAREA');
    assert.equal(area.el.querySelector('.ss-field-count').textContent, '7 of 20 characters');
    area.input.value = 'one two three';
    area.input.dispatch('input');
    assert.equal(area.el.querySelector('.ss-field-count').textContent, '13 of 20 characters');
    // Cut by code points, never inside a character.
    const emoji = make(textField, { type: 'text', max: 3 }, '');
    emoji.input.value = '😀😀😀😀😀';
    emoji.input.dispatch('change');
    assert.ok(Array.from(emoji.input.value).every(char => char === '😀'));
});

test('number: a whole number inside its range; a number moved into the range reports what was typed; text is refused and said', () => {
    const m = make(numberField, { type: 'int', min: 1, max: 10 }, 4);
    assert.equal(m.input.type, 'number');
    assert.deepEqual([m.input.min, m.input.max, m.input.step, m.input.inputMode, m.input.value], ['1', '10', '1', 'numeric', '4']);
    m.input.value = '7';
    m.input.dispatch('change');
    assert.deepEqual(m.calls, [[7, { typed: 7 }]]);
    m.input.value = '99';
    m.input.dispatch('change');
    assert.deepEqual(m.calls.at(-1), [10, { typed: 99 }], 'moved to the most; what was asked is passed on');
    assert.equal(m.input.value, '10');
    m.input.value = '-3';
    m.input.dispatch('change');
    assert.deepEqual(m.calls.at(-1), [1, { typed: -3 }]);
    m.input.value = '4.6';
    m.input.dispatch('change');
    assert.equal(m.calls.at(-1)[0], 5, 'rounded');
    const before = m.calls.length;
    m.input.value = 'lots';
    m.input.dispatch('change');
    assert.equal(m.calls.length, before, 'not a number: nothing reported');
    assert.equal(m.input.value, '5', 'the stored value is shown again');
    assert.deepEqual(m.invalid, ['Enter a whole number. The setting stays 5.']);
    m.input.value = '';
    m.input.dispatch('change');
    assert.equal(m.invalid.length, 2, 'empty is not a number either');
    m.handle.set(null);
    assert.equal(m.input.value, '');
    assert.equal(m.handle.get(), null);
    m.handle.set(8);
    assert.equal(m.handle.get(), 8);
});

test('slider: a native range; the value beside it and spoken (aria-valuetext) while moving; reported when let go; the fill is a custom property', () => {
    const m = make(sliderField, { type: 'int', min: 30, max: 90, form: 'slider', unit: '%' }, 50);
    assert.equal(m.input.type, 'range');
    assert.deepEqual([m.input.min, m.input.max, m.input.step, m.input.value], ['30', '90', '1', '50']);
    // `step`: a whole number from 1 up (a budget in steps of 50); anything else is 1.
    assert.equal(make(sliderField, { type: 'int', min: 100, max: 6000, form: 'slider', step: 50 }, 1500).input.step, '50');
    assert.equal(make(sliderField, { type: 'int', min: 0, max: 10, form: 'slider', step: 0.5 }, 5).input.step, '1');
    assert.equal(m.el.querySelector('.ss-slider-value').textContent, '50%');
    assert.equal(m.el.querySelector('.ss-slider-value').getAttribute('aria-hidden'), 'true');
    assert.equal(m.input.getAttribute('aria-valuetext'), '50%');
    assert.equal(m.input.getAttribute('aria-labelledby'), 'lbl');
    assert.equal(m.input.style.getPropertyValue('--ss-fill'), '0.3333');
    m.input.value = '72';
    m.input.dispatch('input');
    assert.equal(m.el.querySelector('.ss-slider-value').textContent, '72%');
    assert.equal(m.calls.length, 0, 'not while dragging');
    m.input.dispatch('change');
    assert.deepEqual(m.calls, [[72, { typed: 72 }]]);
    m.handle.set(500);
    assert.equal(m.input.value, '90', 'kept inside the bounds');
    m.handle.set('x');
    assert.equal(m.input.value, '30');
    m.handle.setReadOnly(true);
    assert.equal(m.input.disabled, true);
});

test('select: the options, a change reports the value; set shows another', () => {
    const m = make(selectField, { type: 'choice', options: [{ value: 'glass', label: 'Glass' }, 'solid'] }, 'solid');
    assert.equal(m.input.tagName, 'SELECT');
    assert.deepEqual(m.input.querySelectorAll('option').map(o => [o.value, o.textContent]), [['glass', 'Glass'], ['solid', 'solid']]);
    assert.equal(m.input.value, 'solid');
    m.input.value = 'glass';
    m.input.dispatch('change');
    assert.deepEqual(m.calls, [['glass', { typed: 'glass' }]]);
    m.handle.set('solid');
    assert.equal(m.handle.get(), 'solid');
    m.handle.setReadOnly(true);
    assert.equal(m.input.disabled, true);
    m.handle.setReadOnly(false);
    assert.equal(m.input.disabled, false);
});

test('profile: "Same as chat" then the Connection Manager\'s profiles; a profile that is gone stays, with a note; no profiles: a note', () => {
    const list = { usable: true, profiles: [{ name: 'Flash Lite' }, { name: 'Main' }] };
    const m = make(profileField, { type: 'profile' }, 'Main', { profiles: () => list });
    assert.deepEqual(m.input.querySelectorAll('option').map(o => o.textContent), [PROFILE_TEXT.same, 'Flash Lite', 'Main']);
    assert.equal(m.input.value, 'Main');
    assert.deepEqual(m.notes, [''], 'nothing to say');
    m.input.value = '';
    m.input.dispatch('change');
    assert.deepEqual(m.calls, [['', { typed: '' }]]);
    m.handle.set('Old One');
    assert.equal(m.input.value, 'Old One');
    assert.ok(m.input.querySelectorAll('option').some(o => o.textContent === 'Old One (not found)'));
    assert.match(m.notes.at(-1), /is not in the Connection Manager any more/);
    const none = make(profileField, { type: 'profile' }, '', { profiles: () => ({ usable: false, why: 'The Connection Manager is off.' }) });
    assert.equal(none.notes.at(-1), 'The Connection Manager is off.');
    assert.deepEqual(none.input.querySelectorAll('option').map(o => o.textContent), [PROFILE_TEXT.same]);
    // Nothing to pick but "Same as chat": the select is disabled (the note says why); a profile that is gone can still be changed.
    assert.equal(none.input.disabled, true);
    assert.equal(m.input.disabled, false);
    m.handle.setReadOnly(true);
    assert.equal(m.input.disabled, true);
    m.handle.setReadOnly(false);
    assert.equal(m.input.disabled, false);
    const empty = make(profileField, { type: 'profile' }, '', { profiles: () => ({ usable: true, profiles: [] }) });
    assert.equal(empty.input.disabled, true);
    assert.equal(empty.notes.at(-1), PROFILE_TEXT.none);
    const gone = make(profileField, { type: 'profile' }, 'Old One', { profiles: () => ({ usable: true, profiles: [] }) });
    assert.equal(gone.input.disabled, false, 'a stored profile that is gone can be changed');
    gone.handle.set('');
    assert.equal(gone.input.disabled, true);
});

test('chipset: several chips over a comma-separated text; entries the options do not list are kept and never drawn', () => {
    const field = { type: 'text', form: 'chips', options: [{ value: '~ time', label: 'Time' }, { value: '~ place', label: 'Place' }, { value: '~ weather', label: 'Weather' }], read: text => String(text).split(',').map(part => part.trim()).filter(Boolean) };
    const m = make(chipsetField, field, '~ weather, ~ mood, ~ time');
    const chips = () => m.el.querySelectorAll('.ss-chip');
    assert.deepEqual(chips().map(c => c.textContent), ['Time', 'Place', 'Weather']);
    assert.deepEqual(chips().map(c => c.getAttribute('aria-pressed')), ['true', 'false', 'true']);
    assert.equal(m.handle.get(), '~ time, ~ weather, ~ mood', 'the options\' order, then the kept entries');
    chips()[1].click();
    assert.deepEqual(m.calls.at(-1), ['~ time, ~ place, ~ weather, ~ mood', { typed: '~ time, ~ place, ~ weather, ~ mood' }]);
    chips()[0].click();
    chips()[1].click();
    chips()[2].click();
    assert.equal(m.calls.at(-1)[0], '~ mood', 'the kept entry stays when every chip is off');
    m.handle.set('~ place');
    assert.deepEqual(chips().map(c => c.getAttribute('aria-pressed')), ['false', 'true', 'false']);
    assert.equal(m.handle.get(), '~ place', 'a text without the kept entry forgets it');
    m.handle.setDisabled(true);
    chips()[0].click();
    assert.equal(m.calls.length, 4, 'a locked chipset reports nothing');
    // Without `read`: split on commas, semicolons and new lines, lower-cased.
    const plain = make(chipsetField, { type: 'text', form: 'chips', options: ['red', 'green'] }, 'Green; blue\nRED');
    assert.deepEqual(plain.el.querySelectorAll('.ss-chip').map(c => c.getAttribute('aria-pressed')), ['true', 'true']);
    assert.equal(plain.handle.get(), 'red, green, blue');
});

test('segmented: a choice with form "segmented" is the one-of chips drawn as one joined row (Text size), with the same value, keys and reports', () => {
    const field = { type: 'choice', form: 'segmented', options: [{ value: '100', label: 'Normal' }, { value: '110', label: '110%' }, { value: '120', label: '120%' }] };
    assert.equal(fieldKind(field), 'segmented');
    assert.equal(fieldKind({ ...field, form: 'chips' }), 'chips', 'chips are as they were');
    assert.equal(fieldKind({ type: 'choice', options: ['a'] }), 'select');
    assert.equal(RENDERERS.segmented, segmentedField);
    const m = make(segmentedField, field, '110');
    assert.ok(classes(m.el).includes('ss-chips') && classes(m.el).includes('ss-segmented'));
    assert.equal(m.input.getAttribute('role'), 'radiogroup');
    const buttons = () => m.el.querySelectorAll('.ss-chip');
    assert.deepEqual(buttons().map(c => c.textContent), ['Normal', '110%', '120%']);
    assert.ok(buttons().every(c => classes(c).includes('ss-tap-pill')), 'its chips opt in to the compact pill (size.css)');
    assert.deepEqual(buttons().map(c => c.getAttribute('aria-checked')), ['false', 'true', 'false']);
    buttons()[2].click();
    assert.deepEqual(m.calls, [['120', { typed: '120' }]]);
    assert.equal(m.handle.get(), '120');
    buttons()[2].dispatch('keydown', { key: 'Home' });
    assert.equal(m.handle.get(), '100');
    m.handle.set('110');
    assert.deepEqual(buttons().map(c => c.getAttribute('aria-checked')), ['false', 'true', 'false']);
    m.handle.setReadOnly(true);
    assert.ok(buttons().every(c => c.disabled));
});

test('chips, one of: a radio group with aria-checked, one Tab stop, the arrow keys move and choose (wrapping), Home and End', () => {
    const field = { type: 'choice', form: 'chips', options: ['slow', { value: 'steady', label: 'Steady' }, 'fast'] };
    const m = make(chipsField, field, 'steady');
    assert.equal(m.input.getAttribute('role'), 'radiogroup');
    assert.equal(m.input.getAttribute('aria-labelledby'), 'lbl');
    const chips = () => m.el.querySelectorAll('.ss-chip');
    assert.deepEqual(chips().map(c => c.textContent), ['slow', 'Steady', 'fast']);
    assert.ok(chips().every(c => c.getAttribute('role') === 'radio' && c.getAttribute('type') === 'button'));
    assert.deepEqual(chips().map(c => c.getAttribute('aria-checked')), ['false', 'true', 'false']);
    assert.deepEqual(chips().map(c => c.getAttribute('tabindex')), ['-1', '0', '-1']);
    chips()[2].click();
    assert.deepEqual(m.calls, [['fast', { typed: 'fast' }]]);
    assert.deepEqual(chips().map(c => c.getAttribute('tabindex')), ['-1', '-1', '0']);
    chips()[2].focus();
    let event = chips()[2].dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(event.defaultPrevented);
    assert.equal(m.handle.get(), 'slow', 'wraps to the first');
    assert.equal(doc.activeElement, chips()[0]);
    chips()[0].dispatch('keydown', { key: 'ArrowLeft' });
    assert.equal(m.handle.get(), 'fast');
    chips()[2].dispatch('keydown', { key: 'Home' });
    assert.equal(m.handle.get(), 'slow');
    chips()[0].dispatch('keydown', { key: 'End' });
    assert.equal(m.handle.get(), 'fast');
    chips()[2].dispatch('keydown', { key: 'ArrowUp' });
    assert.equal(m.handle.get(), 'steady');
    const count = m.calls.length;
    chips()[1].click();
    assert.equal(m.calls.length, count, 'the same choice again reports nothing');
    event = chips()[1].dispatch('keydown', { key: 'a' });
    assert.ok(!event.defaultPrevented);
    m.handle.setReadOnly(true);
    assert.ok(chips().every(c => c.disabled));
    chips()[0].click();
    assert.equal(m.calls.length, count);
    m.handle.set('slow');
    assert.equal(chips()[0].getAttribute('aria-checked'), 'true');
});

test('chips, several of: a group of toggle buttons with aria-pressed; the value keeps the options\' order', () => {
    const m = make(chipsField, { type: 'choice', multiple: true, options: ['time', 'place', 'weather'] }, ['weather']);
    assert.equal(m.input.getAttribute('role'), 'group');
    const chips = () => m.el.querySelectorAll('.ss-chip');
    assert.ok(chips().every(c => c.getAttribute('role') === null));
    assert.deepEqual(chips().map(c => c.getAttribute('aria-pressed')), ['false', 'false', 'true']);
    chips()[0].click();
    assert.deepEqual(m.calls.at(-1)[0], ['time', 'weather']);
    chips()[2].click();
    assert.deepEqual(m.calls.at(-1)[0], ['time']);
    chips()[1].click();
    assert.deepEqual(m.calls.at(-1)[0], ['time', 'place']);
    assert.deepEqual(m.handle.get(), ['time', 'place']);
    m.handle.set(['weather', 'nonsense']);
    assert.deepEqual(chips().map(c => c.getAttribute('aria-pressed')), ['false', 'false', 'true']);
    m.handle.set('x');
    assert.deepEqual(m.handle.get(), []);
    m.handle.setDisabled(true);
    chips()[0].click();
    assert.equal(m.calls.length, 3);
});

const COINS = { type: 'list', label: 'Coins', of: { name: { type: 'text', label: 'Name', max: 20 }, worth: { type: 'int', label: 'Worth', min: 1 } } };
const rowsOf = m => m.el.querySelectorAll('.ss-lines-row');

test('lines, rows: a row per item with its fields named by field and item, Remove and Add; the list is reported whole', () => {
    const m = make(linesField, COINS, [{ name: 'penny', worth: 1 }, { name: 'silver', worth: 10 }], { id: 'coins' });
    assert.equal(m.input.getAttribute('role'), 'group');
    assert.equal(m.input.getAttribute('aria-labelledby'), 'lbl');
    assert.equal(m.el.getAttribute('data-form'), 'rows');
    assert.equal(rowsOf(m).length, 2);
    const inputs = rowsOf(m)[1].querySelectorAll('input');
    assert.deepEqual(inputs.map(i => i.getAttribute('aria-label')), ['Name, item 2', 'Worth, item 2']);
    assert.deepEqual(inputs.map(i => i.value), ['silver', '10']);
    assert.equal(rowsOf(m)[0].querySelector('.ss-lines-remove').getAttribute('aria-label'), 'Remove penny');
    // Edit a field: the whole list is reported.
    inputs[1].value = '12';
    inputs[1].dispatch('change');
    assert.deepEqual(m.calls.at(-1)[0], [{ name: 'penny', worth: 1 }, { name: 'silver', worth: 12 }]);
    // Add: a new empty row, reported, and the focus in its first field.
    m.el.querySelector('.ss-lines-add').click();
    assert.equal(rowsOf(m).length, 3);
    assert.deepEqual(m.calls.at(-1)[0].at(-1), { name: '', worth: 1 });
    assert.equal(doc.activeElement, rowsOf(m)[2].querySelector('input'));
    // Remove the first: reported, and the focus goes to the next item's Remove, never the page behind.
    rowsOf(m)[0].querySelector('.ss-lines-remove').click();
    assert.deepEqual(m.calls.at(-1)[0].map(c => c.name), ['silver', '']);
    assert.equal(rowsOf(m).length, 2);
    assert.equal(doc.activeElement, rowsOf(m)[0].querySelector('.ss-lines-remove'));
    // Remove the last: the focus goes to Add.
    rowsOf(m)[1].querySelector('.ss-lines-remove').click();
    rowsOf(m)[0].querySelector('.ss-lines-remove').click();
    assert.equal(rowsOf(m).length, 0);
    assert.equal(doc.activeElement, m.el.querySelector('.ss-lines-add'));
    assert.ok(m.el.querySelector('.ss-lines-empty'));
});

test('lines, text: one item per line ("Name: Worth"), read back through the overlay\'s reader; a bad line is named and nothing is reported', () => {
    const items = [{ name: 'penny', worth: 1 }, { name: 'Day: of Ash', worth: 30 }];
    const m = make(linesField, COINS, items, { id: 'coins' });
    // Rows → text.
    m.el.querySelector('.ss-lines-toggle').click();
    assert.equal(m.el.getAttribute('data-form'), 'lines');
    const area = m.el.querySelector('.ss-lines-text');
    assert.equal(area.value, 'penny: 1\nDay: of Ash: 30', 'the extra colon belongs to the one text field');
    assert.equal(doc.activeElement, m.el.querySelector('.ss-lines-toggle'));
    // A good edit, tidied and reported; a blank line is skipped.
    area.value = 'penny: 1\n\n copper bit : 2\nDay: of Ash: 30';
    area.dispatch('change');
    assert.deepEqual(m.calls.at(-1)[0], [{ name: 'penny', worth: 1 }, { name: 'copper bit', worth: 2 }, { name: 'Day: of Ash', worth: 30 }]);
    assert.equal(area.value, 'penny: 1\ncopper bit: 2\nDay: of Ash: 30');
    // Bad lines: each named with the reason, aria-invalid, described by the error (role=alert); the list is kept.
    const count = m.calls.length;
    for (const [text, why] of [['penny: lots', /Worth is not a whole number/], ['penny: 0', /Worth must be at least 1/], ['penny', /it needs Name: Worth/]]) {
        area.value = text;
        area.dispatch('change');
        const error = m.el.querySelector('.ss-lines-error');
        assert.equal(error.getAttribute('role'), 'alert');
        assert.ok(!error.hidden);
        assert.match(error.textContent, why);
        assert.match(error.textContent, /Line 1 \("/);
        assert.equal(area.getAttribute('aria-invalid'), 'true');
        assert.ok(area.getAttribute('aria-describedby').includes(error.id));
        assert.equal(m.calls.length, count, 'nothing reported');
    }
    // Back to rows is refused while the text does not read; the focus stays in the text.
    m.el.querySelector('.ss-lines-toggle').click();
    assert.equal(m.el.getAttribute('data-form'), 'lines');
    assert.equal(doc.activeElement, area);
    area.value = 'penny: 1';
    area.dispatch('change');
    assert.ok(m.el.querySelector('.ss-lines-error').hidden);
    assert.equal(area.getAttribute('aria-invalid'), null);
    m.el.querySelector('.ss-lines-toggle').click();
    assert.equal(m.el.getAttribute('data-form'), 'rows');
    assert.equal(rowsOf(m).length, 1);
});

test('lines: `form: "lines"` starts as text; the choice is kept in the memo across redraws; a list with a switch has rows only', () => {
    const memo = new Map();
    const field = { ...COINS, form: 'lines' };
    const a = make(linesField, field, [{ name: 'a', worth: 2 }], { id: 'c1', memo });
    assert.equal(a.el.getAttribute('data-form'), 'lines');
    a.el.querySelector('.ss-lines-toggle').click();
    assert.equal(a.el.getAttribute('data-form'), 'rows');
    const b = make(linesField, field, [], { id: 'c1', memo });
    assert.equal(b.el.getAttribute('data-form'), 'rows', 'the reader\'s last choice for this field');
    const withSwitch = make(linesField, { type: 'list', form: 'lines', of: { name: { type: 'text' }, on: { type: 'bool' } } }, [{ name: 'x', on: true }], { id: 'c2' });
    assert.equal(withSwitch.el.getAttribute('data-form'), 'rows');
    assert.equal(withSwitch.el.querySelectorAll('.ss-lines-toggle').length, 0, 'no text form for a list that holds a switch');
    assert.ok(withSwitch.el.querySelector('.ss-switch'));
    // A sub-field of a type the engine does not know is not drawn; a nested list is never drawn.
    const odd = make(linesField, { type: 'list', of: { name: { type: 'text' }, ghost: { type: 'hologram' }, inner: { type: 'list', of: { a: 'text' } } } }, [{ name: 'x', ghost: 1 }], { id: 'c3' });
    assert.equal(odd.el.querySelectorAll('.ss-lines-cell').length, 1);
});

test('lines: set() writes into the rows in place when the count is the same (a focus stays), else draws again; read-only and disabled lock it', () => {
    const m = make(linesField, COINS, [{ name: 'a', worth: 1 }], { id: 'c' });
    const first = rowsOf(m)[0].querySelector('input');
    first.focus();
    m.handle.set([{ name: 'b', worth: 5 }]);
    assert.equal(rowsOf(m)[0].querySelector('input'), first, 'the same input');
    assert.equal(first.value, 'b');
    assert.equal(doc.activeElement, first);
    m.handle.set([{ name: 'b', worth: 5 }, { name: 'c', worth: 6 }]);
    assert.equal(rowsOf(m).length, 2);
    assert.deepEqual(m.handle.get(), [{ name: 'b', worth: 5 }, { name: 'c', worth: 6 }]);
    m.handle.setReadOnly(true);
    assert.ok(m.el.querySelectorAll('input').every(i => i.readOnly));
    assert.ok(m.el.querySelector('.ss-lines-remove').disabled && m.el.querySelector('.ss-lines-add').disabled);
    m.handle.setReadOnly(false);
    m.handle.setDisabled(true);
    assert.ok(m.el.querySelectorAll('input').every(i => i.disabled));
    // The list holds at most 100 rows: Add is off at the limit.
    const full = make(linesField, COINS, Array.from({ length: 100 }, (_, i) => ({ name: `n${i}`, worth: 1 })), { id: 'full' });
    assert.ok(full.el.querySelector('.ss-lines-add').disabled);
});

test('search: a search input named by a hidden label, a clear button while it holds text, Escape clears; onInput as the reader types', () => {
    const seen = [];
    const s = searchField(doc, { onInput: text => seen.push(text), id: 'q1' });
    doc.body.appendChild(s.el);
    assert.equal(s.el.getAttribute('role'), 'search');
    assert.equal(s.input.type, 'search');
    assert.equal(s.input.id, 'q1');
    const label = s.el.querySelector('label');
    assert.equal(label.getAttribute('for'), 'q1');
    assert.equal(label.textContent, 'Search settings');
    assert.ok(classes(label).includes('ss-visually-hidden'));
    assert.equal(s.input.placeholder, 'Search settings…');
    const clear = s.el.querySelector('.ss-search-clear');
    assert.ok(clear.hidden);
    assert.equal(clear.getAttribute('aria-label'), 'Clear the search');
    s.input.value = 'coin';
    s.input.dispatch('input');
    assert.deepEqual(seen, ['coin']);
    assert.ok(!clear.hidden);
    const event = s.input.dispatch('keydown', { key: 'Escape' });
    assert.ok(event.defaultPrevented && event.stopped);
    assert.deepEqual(seen, ['coin', '']);
    assert.equal(s.get(), '');
    assert.ok(clear.hidden);
    s.set('x');
    assert.ok(!clear.hidden);
    clear.click();
    assert.equal(s.get(), '');
    assert.equal(doc.activeElement, s.input);
    s.input.dispatch('keydown', { key: 'Escape' });
    assert.equal(seen.at(-1), '', 'Escape on an empty box does nothing more');
});

test('section: a glass card with a heading (a section label) named for it; collapsible: a details with a summary', () => {
    const s = sectionBlock(doc, { title: 'Calendar', hint: '2 settings', id: 'sec1' });
    assert.equal(s.el.tagName, 'SECTION');
    assert.ok(classes(s.el).includes('ss-section') && classes(s.el).includes('ss-glass'));
    assert.equal(s.title.tagName, 'H3');
    assert.ok(classes(s.title).includes('ss-label'));
    assert.equal(s.el.getAttribute('aria-labelledby'), 'sec1-title');
    assert.equal(s.el.querySelector('.ss-section-hint').textContent, '2 settings');
    s.setHidden(true);
    assert.equal(s.el.hidden, true);
    const bare = sectionBlock(doc, {});
    assert.ok(bare.el.querySelector('.ss-section-head').hidden, 'no title: no heading');
    assert.equal(bare.el.getAttribute('aria-labelledby'), null);
    const fold = sectionBlock(doc, { title: 'More', collapsible: true, open: false });
    assert.equal(fold.el.tagName, 'DETAILS');
    assert.equal(fold.el.open, false);
    assert.equal(fold.el.querySelector('summary').textContent, 'More');
});
