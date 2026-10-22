// The form engine (view/form/form.js): a module's whole settings drawn from its schema, writing through the same
// settings store as the overlay: groups, every kind round-tripping to the store, the store's own limits shown
// as messages, read-only and `shows`, features, search, disabled, ARIA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../../ui-fake-dom.js';
import { createRegistry } from '../../../../src/v2/registry.js';
import { HOST_SETTINGS_SCHEMA, createSettings } from '../../../../src/v2/sdk.js';
import { changeNote, renderModuleForm, renderSettingsForm } from '../../../../src/v2/view/form/index.js';
import { groupFields, rowValue, fieldReadOnly } from '../../../../src/v2/host-ui.js';
import { UI_SAMPLE_FORM, mountDemoForm } from '../../../../src/v2/screens/ui-sample.js';

const doc = installFakeDom();

const SCHEMA = {
    strict: { type: 'bool', label: 'Strict checks', help: 'Code picks the stat.' },
    harder: { type: 'int', label: 'Difficulty', min: 1, max: 5, readOnly: values => values.strict !== true, shows: () => 3 },
    title: { type: 'text', label: 'Title', max: 8 },
    notes: { type: 'text', multiline: true, label: 'Notes', max: 40 },
    pace: { type: 'choice', form: 'chips', label: 'Pace', options: ['slow', 'steady', 'fast'] },
    prices: { type: 'choice', label: 'Prices', options: [{ value: 'by-place', label: 'By place' }, { value: 'flat', label: 'Flat' }] },
    budget: { type: 'int', form: 'slider', min: 0, max: 200, label: 'Money: Budget' },
    coins: { type: 'list', label: 'Money: Coins', of: { name: { type: 'text', label: 'Name', max: 12 }, worth: { type: 'int', label: 'Worth', min: 1, max: 1000 } } },
    days: { type: 'int', label: 'Calendar: Days', min: 1, max: 12, help: 'At most 12.' },
    months: { type: 'list', form: 'lines', label: 'Calendar: Months', of: { name: { type: 'text', label: 'Name' }, days: { type: 'int', label: 'Days', min: 1, max: 60 } } },
    connection: { type: 'profile', label: 'Connection' },
    pack: { type: 'text', label: 'Pack', readOnly: true, shows: () => 'From the pack' },
    ghost: { type: 'hologram', label: 'Newer' },
    fancy: { type: 'bool', label: 'Fancy', feature: 'demo.fancy' },
};
const DEFAULTS = { strict: false, harder: 3, title: 'Lowmere', notes: '', pace: 'steady', prices: 'by-place', budget: 60, coins: [{ name: 'penny', worth: 1 }], days: 7, months: [{ name: 'Frost', days: 30 }], connection: '', pack: 'mine', ghost: 'kept', fancy: false };

function setup(extra = {}, schema = SCHEMA, defaults = DEFAULTS) {
    const registry = createRegistry();
    const es = {};
    const stored = { m: { settings: { schema, defaults } } };
    const settings = createSettings({ root: () => es, registry: { module: id => stored[id] ?? null }, save: () => {} });
    const parent = doc.createElement('div');
    doc.body.appendChild(parent);
    const changes = [];
    const form = renderSettingsForm(parent, { moduleId: 'm', schema, settings, doc, profiles: () => ({ usable: true, profiles: [{ name: 'Main' }] }), onChange: change => changes.push(change), ...extra });
    return { registry, es, settings, parent, form, changes, saved: () => es.storySuite?.modules?.m ?? {} };
}
const row = (t, key) => t.form.field(key).row;
const input = (t, key) => t.form.field(key).handle.input;
const hasClass = (node, name) => node.classes().includes(name);

test('every field of a known type is drawn in its group; one the engine does not know is not, and its value is left alone', () => {
    const t = setup();
    assert.deepEqual(t.form.keys(), ['strict', 'harder', 'title', 'notes', 'pace', 'prices', 'connection', 'pack', 'fancy', 'budget', 'coins', 'days', 'months']);
    assert.equal(t.form.field('ghost'), undefined);
    assert.deepEqual(t.parent.querySelectorAll('.ss-section-title').map(n => n.textContent), ['General', 'Money', 'Calendar'], 'the groups of the overlay: General, then "Group: " prefixes');
    assert.deepEqual(t.parent.querySelectorAll('.ss-section').map(s => s.querySelectorAll('.ss-field').length), [9, 2, 2]);
    assert.deepEqual(['strict', 'harder', 'title', 'notes', 'pace', 'prices', 'budget', 'coins', 'days', 'months', 'connection', 'pack'].map(key => t.form.field(key).kind), ['switch', 'number', 'text', 'text', 'chips', 'select', 'slider', 'lines', 'number', 'lines', 'profile', 'text']);
    assert.deepEqual(groupFields(SCHEMA).map(g => g.name), ['General', 'Money', 'Calendar'], 'the same grouping function as the overlay');
    // Labels lose their "Group: " prefix, as in the overlay.
    assert.equal(row(t, 'budget').querySelector('.ss-field-label').textContent, 'Budget');
    // One group alone has no heading of its own.
    const single = setup({}, { a: { type: 'bool', label: 'A' }, b: { type: 'bool', label: 'B' } });
    assert.ok(single.parent.querySelector('.ss-section-head').hidden);
    // Defaults show; the store is untouched by drawing.
    assert.equal(input(t, 'title').value, 'Lowmere');
    assert.equal(input(t, 'budget').value, '60');
    assert.deepEqual(t.saved(), {});
});

test('values round-trip to the settings store: each control writes what the store keeps and shows it back', () => {
    const t = setup();
    // switch
    input(t, 'strict').click();
    assert.equal(t.saved().strict, true);
    // text, cut by the store at its max
    input(t, 'title').value = 'The Lowmere Reaches';
    input(t, 'title').dispatch('change');
    assert.equal(t.saved().title, 'The Lowm');
    assert.equal(input(t, 'title').value, 'The Lowm');
    // number
    input(t, 'days').value = '9';
    input(t, 'days').dispatch('change');
    assert.equal(t.saved().days, 9);
    // slider
    input(t, 'budget').value = '120';
    input(t, 'budget').dispatch('input');
    assert.equal(t.saved().budget, undefined, 'not while dragging');
    input(t, 'budget').dispatch('change');
    assert.equal(t.saved().budget, 120);
    // select and chips
    input(t, 'prices').value = 'flat';
    input(t, 'prices').dispatch('change');
    assert.equal(t.saved().prices, 'flat');
    row(t, 'pace').querySelectorAll('.ss-chip')[2].click();
    assert.equal(t.saved().pace, 'fast');
    // profile
    input(t, 'connection').value = 'Main';
    input(t, 'connection').dispatch('change');
    assert.equal(t.saved().connection, 'Main');
    // the whole of a list, rows
    row(t, 'coins').querySelector('.ss-lines-add').click();
    const fresh = row(t, 'coins').querySelectorAll('.ss-lines-row')[1].querySelectorAll('input');
    fresh[0].value = 'silver';
    fresh[0].dispatch('change');
    fresh[1].value = '10';
    fresh[1].dispatch('change');
    assert.deepEqual(t.saved().coins, [{ name: 'penny', worth: 1 }, { name: 'silver', worth: 10 }]);
    // a list as lines
    const area = row(t, 'months').querySelector('.ss-lines-text');
    area.value = 'Frostmoon: 30\nSeedmoon: 31';
    area.dispatch('change');
    assert.deepEqual(t.saved().months, [{ name: 'Frostmoon', days: 30 }, { name: 'Seedmoon', days: 31 }]);
    // The same store, the same values: a second form over it shows what the first wrote, and onChange saw each.
    const again = renderSettingsForm(t.parent, { moduleId: 'm', schema: SCHEMA, settings: t.settings, doc });
    assert.equal(again.field('title').handle.input.value, 'The Lowm');
    assert.equal(again.field('budget').handle.input.value, '120');
    assert.equal(again.field('prices').handle.input.value, 'flat');
    assert.equal(again.field('coins').row.querySelectorAll('.ss-lines-row').length, 2);
    assert.deepEqual(t.changes.map(c => c.key), ['strict', 'title', 'days', 'budget', 'prices', 'pace', 'connection', 'coins', 'coins', 'coins', 'months']);
    assert.deepEqual(t.changes[1], { moduleId: 'm', key: 'title', value: 'The Lowm' });
});

test('what the store moved or refused is said under the field, with the stored value shown (aria-invalid, aria-describedby, role=alert)', () => {
    const t = setup();
    const days = input(t, 'days');
    days.value = '99';
    days.dispatch('change');
    const error = row(t, 'days').querySelector('.ss-field-error');
    assert.equal(error.getAttribute('role'), 'alert');
    assert.equal(error.textContent, 'Set to 12, the most this allows.');
    assert.ok(!error.hidden);
    assert.equal(days.value, '12');
    assert.equal(t.saved().days, 12);
    assert.equal(days.getAttribute('aria-invalid'), 'true');
    assert.ok(days.getAttribute('aria-describedby').split(' ').includes(error.id), 'said again by the description');
    assert.ok(days.getAttribute('aria-describedby').includes(row(t, 'days').querySelector('.ss-field-help').id), 'with the help');
    // A good value clears it.
    days.value = '5';
    days.dispatch('change');
    assert.ok(error.hidden);
    assert.equal(days.getAttribute('aria-invalid'), null);
    assert.ok(!days.getAttribute('aria-describedby').includes(error.id));
    // Not a number: nothing is stored, the message says what it stays.
    days.value = 'many';
    days.dispatch('change');
    assert.equal(error.textContent, 'Enter a whole number. The setting stays 5.');
    assert.equal(t.saved().days, 5);
    assert.equal(days.value, '5');
    // A text cut.
    const title = input(t, 'title');
    title.value = 'aaaaaaaaaaaa';
    title.dispatch('change');
    assert.equal(row(t, 'title').querySelector('.ss-field-error').textContent, 'Cut to 8 characters, the most this allows.');
    // A value the store refuses (a choice that is not an option): not stored, the control goes back.
    const prices = input(t, 'prices');
    prices.value = 'barter';
    prices.dispatch('change');
    assert.equal(t.saved().prices, undefined);
    assert.equal(prices.value, 'by-place');
    assert.equal(row(t, 'prices').querySelector('.ss-field-error').textContent, 'That could not be saved. The setting stays by-place.');
    assert.equal(t.changes.some(c => c.key === 'prices'), false, 'onChange only for what was stored');
    // The slider keeps the engine out of range values; the list says nothing when it reads.
    const lines = row(t, 'months').querySelector('.ss-lines-text');
    lines.value = 'Frost: 99';
    lines.dispatch('change');
    assert.match(row(t, 'months').querySelector('.ss-lines-error').textContent, /Days must be at most 60/);
    assert.equal(t.saved().months, undefined, 'a list that does not read is kept as it was');
});

test('labels, help and descriptions: the label names the control, the help describes it; chips and lists are named by aria-labelledby', () => {
    const t = setup();
    const strict = row(t, 'strict');
    const label = strict.querySelector('.ss-field-label');
    assert.equal(label.tagName, 'LABEL');
    assert.equal(label.getAttribute('for'), input(t, 'strict').id, 'the label points at the control');
    assert.equal(input(t, 'strict').getAttribute('aria-labelledby'), label.id);
    assert.equal(input(t, 'strict').getAttribute('aria-describedby'), strict.querySelector('.ss-field-help').id);
    assert.equal(strict.querySelector('.ss-field-help').textContent, 'Code picks the stat.');
    assert.ok(hasClass(strict, 'ss-field-inline'), 'a switch sits beside its text');
    assert.ok(!hasClass(row(t, 'title'), 'ss-field-inline'));
    assert.equal(input(t, 'title').getAttribute('aria-describedby'), null, 'no help: nothing to describe');
    for (const key of ['pace', 'coins', 'months']) {
        const field = row(t, key);
        const name = field.querySelector('.ss-field-label');
        assert.equal(name.tagName, 'SPAN', `${key}: a group is not labelable`);
        assert.equal(input(t, key).getAttribute('aria-labelledby'), name.id);
    }
    // Every id is unique on the page.
    const ids = [...t.parent.querySelectorAll('[id]')].map(n => n.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('read-only: the control is locked and the row says "Read only"; nothing is stored; `shows` is what it displays, the stored value kept', () => {
    const t = setup();
    const pack = row(t, 'pack');
    assert.equal(input(t, 'pack').value, 'From the pack', '`shows`');
    assert.equal(input(t, 'pack').readOnly, true);
    assert.equal(input(t, 'pack').getAttribute('aria-readonly'), 'true');
    assert.ok(!pack.querySelector('.ss-field-tag').hidden);
    assert.equal(pack.querySelector('.ss-field-tag').textContent, 'Read only');
    assert.ok(hasClass(pack, 'ss-field-readonly'));
    assert.equal(pack.getAttribute('data-readonly'), 'true');
    assert.ok(input(t, 'pack').getAttribute('aria-describedby').includes(pack.querySelector('.ss-field-tag').id));
    assert.deepEqual(t.saved(), {});
    // A read-only that is a function of the values follows them: locked while Strict is off, free after.
    assert.equal(input(t, 'harder').readOnly, true);
    assert.equal(input(t, 'harder').value, '3');
    input(t, 'strict').click();
    assert.equal(input(t, 'harder').readOnly, false);
    assert.equal(row(t, 'harder').getAttribute('data-readonly'), 'false');
    assert.ok(row(t, 'harder').querySelector('.ss-field-tag').hidden);
    input(t, 'harder').value = '5';
    input(t, 'harder').dispatch('change');
    assert.equal(t.saved().harder, 5);
    input(t, 'strict').click();
    assert.equal(input(t, 'harder').readOnly, true);
    assert.equal(input(t, 'harder').value, '3', '`shows` again; the stored 5 is kept');
    assert.equal(t.saved().harder, 5);
    // The same functions the overlay uses decide.
    assert.equal(fieldReadOnly(SCHEMA.harder, { strict: true }), false);
    assert.equal(rowValue('harder', SCHEMA.harder, { strict: false, harder: 5 }), 3);
    // Switches and chips are disabled when read-only.
    const lock = setup({}, { on: { type: 'bool', label: 'On', readOnly: true }, pick: { type: 'choice', form: 'chips', options: ['a', 'b'], readOnly: true } });
    assert.equal(lock.form.field('on').handle.input.disabled, true);
    lock.form.field('on').handle.input.click();
    lock.form.field('pick').row.querySelectorAll('.ss-chip')[1].click();
    assert.deepEqual(lock.saved(), {});
});

test('lockText: a locked row says why in its tag (a sentence, or a function of the values); the plain tag is "Read only"', () => {
    let reason = 'Off while the net is off';
    const t = setup({}, {
        net: { type: 'bool', label: 'Net' },
        kinds: { type: 'text', label: 'Kinds', readOnly: values => values.net !== true, lockText: values => (values.net === true ? '' : reason) },
        plain: { type: 'text', label: 'Plain', readOnly: true },
        fixed: { type: 'text', label: 'Fixed', readOnly: true, lockText: 'Set by the pack' },
    }, { net: false, kinds: 'a', plain: 'x', fixed: 'y' });
    const tagOf = key => row(t, key).querySelector('.ss-field-tag');
    assert.equal(tagOf('kinds').hidden, false);
    assert.equal(tagOf('kinds').textContent, 'Off while the net is off');
    assert.ok(hasClass(tagOf('kinds'), 'ss-field-tag-why'));
    assert.equal(tagOf('plain').textContent, 'Read only');
    assert.ok(!hasClass(tagOf('plain'), 'ss-field-tag-why'));
    assert.equal(tagOf('fixed').textContent, 'Set by the pack');
    assert.equal(tagOf('net').hidden, true);
    input(t, 'net').click();
    assert.equal(tagOf('kinds').hidden, true, 'open: no tag');
    assert.equal(input(t, 'kinds').readOnly, false);
    reason = 'Off again';
    input(t, 'net').click();
    assert.equal(tagOf('kinds').textContent, 'Off again');
    assert.equal(input(t, 'kinds').readOnly, true);
});

test('sources: a field can live outside the module\'s settings; its value is read from and written to the source, which can refuse', () => {
    const store = { on: false, refuse: false };
    const sources = {
        on: { get: () => store.on, set: value => { if (store.refuse) return undefined; store.on = value; return value; } },
        broken: { get: () => { throw new Error('gone'); }, set: value => value },
    };
    const t = setup({ sources }, { on: { type: 'bool', label: 'On' }, broken: { type: 'text', label: 'Broken' }, title: { type: 'text', label: 'Title' } }, { on: true, broken: 'kept', title: 'Lowmere' });
    assert.equal(input(t, 'on').getAttribute('aria-checked'), 'false', 'the source\'s value, not the module default');
    input(t, 'on').click();
    assert.equal(store.on, true);
    assert.deepEqual(t.saved(), {}, 'nothing written to the module\'s settings for it');
    assert.deepEqual(t.changes.at(-1).key, 'on');
    // A source that throws reads as an empty value; a refusal shows the field's old value again.
    assert.equal(input(t, 'broken').value, '');
    store.refuse = true;
    input(t, 'on').click();
    assert.equal(store.on, true, 'the source refused');
    assert.equal(input(t, 'on').getAttribute('aria-checked'), 'true', 'the field shows what is stored');
    // A field with no source still goes to the settings store.
    input(t, 'title').value = 'Mill';
    input(t, 'title').dispatch('change');
    assert.equal(t.saved().title, 'Mill');
    // refresh() rereads the source.
    store.on = false;
    t.form.refresh();
    assert.equal(input(t, 'on').getAttribute('aria-checked'), 'false');
});

test('disabled: the whole form can be switched off and on', () => {
    const t = setup({ disabled: true });
    assert.ok(hasClass(row(t, 'title'), 'ss-field-disabled'));
    assert.equal(input(t, 'title').disabled, true);
    assert.equal(input(t, 'strict').disabled, true);
    assert.ok(row(t, 'pace').querySelectorAll('.ss-chip').every(c => c.disabled));
    input(t, 'strict').click();
    assert.deepEqual(t.saved(), {});
    t.form.setDisabled(false);
    assert.equal(input(t, 'title').disabled, false);
    assert.equal(input(t, 'strict').disabled, false);
    assert.ok(!hasClass(row(t, 'title'), 'ss-field-disabled'));
    assert.equal(input(t, 'pack').readOnly, true, 'read-only stays read-only');
    input(t, 'strict').click();
    assert.equal(t.saved().strict, true);
});

test('features: a field of a feature that is off is not shown; refresh() brings it back when the feature is on', () => {
    let on = false;
    const t = setup({ featureOn: id => (id === 'demo.fancy' ? on : true) });
    assert.equal(row(t, 'fancy').hidden, true);
    assert.equal(row(t, 'title').hidden, false);
    on = true;
    t.form.refresh();
    assert.equal(row(t, 'fancy').hidden, false);
    // A featureOn that throws leaves the field shown.
    const bad = setup({ featureOn: () => { throw new Error('no'); } });
    assert.equal(bad.form.field('fancy').row.hidden, false);
});

test('search: filters rows by label, help, group and key; empty sections hide; the count is said (aria-live); a search that finds nothing says so', () => {
    const t = setup({ search: true });
    const status = t.parent.querySelector('.ss-form-status');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.ok(status.hidden);
    const box = t.parent.querySelector('.ss-search-input');
    box.value = 'coin';
    box.dispatch('input');
    const shown = () => t.form.keys().filter(key => !row(t, key).hidden);
    assert.deepEqual(shown(), ['coins']);
    assert.equal(status.textContent, '1 setting shown');
    assert.deepEqual(t.parent.querySelectorAll('.ss-section').map(s => s.hidden), [true, false, true], 'sections with nothing shown are hidden');
    // By group name and by help.
    assert.equal(t.form.filter('calendar'), 2);
    assert.equal(status.textContent, '2 settings shown');
    assert.deepEqual(shown(), ['days', 'months']);
    assert.equal(t.form.filter('at most'), 1);
    assert.deepEqual(shown(), ['days']);
    // By the key.
    assert.deepEqual((t.form.filter('strict'), shown()), ['strict']);
    // Nothing.
    assert.equal(t.form.filter('dragon'), 0);
    const empty = t.parent.querySelector('.ss-form-empty');
    assert.ok(!empty.hidden);
    assert.equal(empty.textContent, 'No settings match "dragon".');
    // Cleared: all back, no message; the search box follows a filter set from outside.
    t.form.filter('');
    assert.equal(shown().length, t.form.keys().length);
    assert.ok(empty.hidden && status.hidden);
    t.form.filter('coin');
    assert.equal(box.value, 'coin');
    // Escape in the box clears the filter.
    box.dispatch('keydown', { key: 'Escape' });
    assert.equal(shown().length, t.form.keys().length);
    // A filter keeps the values and states of the rows it hides.
    input(t, 'title').value = 'abc';
    t.form.filter('title');
    input(t, 'title').dispatch('change');
    assert.equal(t.saved().title, 'abc');
});

test('the host\'s own schema (moduleId null): Panel style, Glass strength (a slider) and the rest write through the host settings', () => {
    const es = {};
    const settings = createSettings({ root: () => es, registry: { module: () => null }, save: () => {} });
    const parent = doc.createElement('div');
    doc.body.appendChild(parent);
    const form = renderSettingsForm(parent, { moduleId: null, schema: HOST_SETTINGS_SCHEMA, settings, doc });
    assert.equal(form.field('panelStyle').kind, 'select');
    assert.equal(form.field('glassStrength').kind, 'slider');
    assert.equal(form.field('callQueue').kind, 'switch');
    assert.equal(form.field('tailBudget').kind, 'number');
    const slider = form.field('glassStrength').handle.input;
    assert.deepEqual([slider.min, slider.max, slider.value], ['30', '90', '50']);
    slider.value = '70';
    slider.dispatch('change');
    assert.equal(es.storySuite.host.glassStrength, 70);
    form.field('panelStyle').handle.input.value = 'solid';
    form.field('panelStyle').handle.input.dispatch('change');
    assert.equal(es.storySuite.host.panelStyle, 'solid');
    const budget = form.field('tailBudget').handle.input;
    budget.value = '50';
    budget.dispatch('change');
    assert.equal(es.storySuite.host.tailBudget, 100, 'moved into its range by the store');
    assert.match(form.field('tailBudget').row.querySelector('.ss-field-error').textContent, /Set to 100, the least/);
});

test('renderModuleForm takes a registry entry (settingsDefs()); a store without set() is refused', () => {
    const registry = createRegistry();
    registry.register({ id: 'demo', name: 'Demo', version: '1.0.0', settings: { section: 'Demo settings', defaults: { on: true }, schema: { on: { type: 'bool', label: 'On' } } } });
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    const def = registry.settingsDefs()[0];
    const parent = doc.createElement('div');
    const form = renderModuleForm(parent, def, { settings, doc });
    assert.equal(parent.querySelector('.ss-form-title').textContent, 'Demo settings');
    assert.equal(parent.querySelector('.ss-form').getAttribute('data-module'), 'demo');
    assert.equal(form.field('on').handle.get(), true, 'the module\'s default');
    form.field('on').handle.input.click();
    assert.equal(settings('demo').on, false);
    assert.throws(() => renderSettingsForm(parent, { schema: {}, settings: () => ({}), doc }), /settings store/);
    form.destroy();
    assert.equal(parent.querySelector('.ss-form'), null);
});

test('the demo form of the UI sample draws one of each field and shows what the store holds', () => {
    const slot = doc.createElement('div');
    doc.body.appendChild(slot);
    const demo = mountDemoForm(doc, slot);
    assert.deepEqual(demo.form.keys().map(key => demo.form.field(key).kind), ['switch', 'number', 'text', 'text', 'chips', 'text', 'slider', 'select', 'lines', 'number', 'lines', 'profile']);
    assert.deepEqual(slot.querySelectorAll('.ss-form .ss-section-title').map(n => n.textContent), ['General', 'Money', 'Calendar', 'Assist']);
    assert.equal(slot.querySelector('.ss-sample-stored').textContent, 'Stored: {}');
    demo.form.field('strict').handle.input.click();
    assert.equal(slot.querySelector('.ss-sample-stored').textContent, 'Stored: {"strict":true}');
    // The several-of chips on their own.
    const chips = slot.querySelectorAll('.ss-chip').filter(c => c.getAttribute('aria-pressed') !== null);
    assert.equal(chips.length, UI_SAMPLE_FORM.chips.options.length);
    assert.equal(chips.filter(c => c.getAttribute('aria-pressed') === 'true').length, UI_SAMPLE_FORM.chips.value.length);
    // Profiles come from the sample's own list, never the page's.
    assert.deepEqual(demo.form.field('connection').handle.input.querySelectorAll('option').map(o => o.textContent), ['Same as chat', 'Flash Lite (cheap)', 'Main']);
    demo.destroy();
    assert.equal(slot.querySelector('.ss-form'), null);
});

// ---- step 3c: what the Money page needs of the engine

test('slider: a `format` says the value in words, `sliderMax` is the range offered and grows to a larger value, a function field follows the others', () => {
    const calls = [];
    const schema = { budget: { type: 'int', form: 'slider', min: 0, max: 1_000_000, sliderMax: 100, label: 'Budget', format: n => (n === 0 ? 'Automatic' : `${n} units`) } };
    const { form } = setup({}, schema, { budget: 60 });
    const slider = form.field('budget').handle.input;
    const out = form.field('budget').row.querySelector('.ss-slider-value');
    assert.equal(slider.max, '100', 'the offered range, not the store\'s');
    assert.equal(out.textContent, '60 units');
    assert.equal(slider.getAttribute('aria-valuetext'), '60 units');
    slider.value = '0';
    slider.dispatch('input');
    assert.equal(out.textContent, 'Automatic');
    // A stored value past the offered range: the range grows to it, the value is shown whole.
    form.field('budget').handle.set(5000);
    assert.equal(slider.max, '5000');
    assert.equal(slider.value, '5000');
    assert.equal(out.textContent, '5000 units');
    form.field('budget').handle.set(10);
    assert.equal(slider.max, '100');
    // A format that throws or says nothing falls back to the number and the unit.
    const plain = setup({}, { n: { type: 'int', form: 'slider', min: 0, max: 10, label: 'N', unit: ' coins', format: () => { throw new Error('x'); } } }, { n: 0 }).form;
    assert.equal(plain.field('n').row.querySelector('.ss-slider-value').textContent, '0 coins');
    assert.ok(calls.length === 0);
});

test('a field whose `format` reads other values follows them after any change (the budget\'s unit follows the coins)', () => {
    const schema = {
        word: { type: 'text', label: 'Word', max: 10 },
        n: { type: 'int', form: 'slider', min: 0, max: 100, label: 'N', format: n => `${n} ${registryValues().word}` },
    };
    let current = { word: 'penny' };
    const registryValues = () => current;
    const { form, settings } = setup({}, schema, { word: 'penny', n: 5 });
    assert.equal(form.field('n').row.querySelector('.ss-slider-value').textContent, '5 penny');
    current = { word: 'mark' };
    const box = form.field('word').handle.input;
    box.value = 'mark';
    box.dispatch('change');
    assert.equal(settings('m').word, 'mark');
    assert.equal(form.field('n').row.querySelector('.ss-slider-value').textContent, '5 mark');
});

test('a field\'s `check` says what the store cannot (a row the module will not use), after the value is stored, with the note of what the store moved', () => {
    const schema = { coins: { type: 'list', label: 'Coins', of: { name: { type: 'text', label: 'Name', max: 12 }, worth: { type: 'int', label: 'Worth', min: 1, max: 1000 } }, check: rows => (rows.some(row => !row.name) ? 'A coin has no name, so it is not used.' : '') } };
    const { form, settings } = setup({}, schema, { coins: [{ name: 'penny', worth: 1 }] });
    const coins = form.field('coins').row;
    coins.querySelector('.ss-lines-add').click();
    const error = coins.querySelector('.ss-field-error');
    assert.equal(error.textContent, 'A coin has no name, so it is not used.');
    assert.equal(settings('m').coins.length, 2, 'kept as typed');
    const name = coins.querySelectorAll('.ss-lines-row')[1].querySelector('.ss-lines-cell[data-field="name"] input');
    name.value = 'silver';
    name.dispatch('change');
    assert.equal(error.hidden, true);
    // A check that throws or answers a non-string says nothing.
    const bad = setup({}, { n: { type: 'int', label: 'N', check: () => { throw new Error('x'); } } }, { n: 1 }).form;
    const box = bad.field('n').handle.input;
    box.value = '2';
    box.dispatch('change');
    assert.equal(bad.field('n').row.querySelector('.ss-field-error').hidden, true);
});

test('a number in a list row that the box moved into its range, or refused, is named by row and field', () => {
    const schema = { coins: { type: 'list', label: 'Coins', of: { name: { type: 'text', label: 'Name', max: 12 }, worth: { type: 'int', label: 'Worth', min: 1, max: 1000 } } } };
    const { form, settings } = setup({}, schema, { coins: [{ name: 'penny', worth: 1 }, { name: 'gold', worth: 100 }] });
    const coins = form.field('coins').row;
    const worth = at => coins.querySelectorAll('.ss-lines-row')[at].querySelector('.ss-lines-cell[data-field="worth"] input');
    worth(1).value = '5000';
    worth(1).dispatch('change');
    assert.equal(settings('m').coins[1].worth, 1000);
    assert.equal(coins.querySelector('.ss-field-error').textContent, 'Row 2, Worth: Set to 1000, the most this allows.');
    worth(0).value = '0';
    worth(0).dispatch('change');
    assert.equal(coins.querySelector('.ss-field-error').textContent, 'Row 1, Worth: Set to 1, the least this allows.');
    worth(0).value = 'lots';
    worth(0).dispatch('change');
    assert.equal(coins.querySelector('.ss-field-error').textContent, 'Row 1, Worth: Enter a whole number. The setting stays 1.');
    worth(0).value = '3';
    worth(0).dispatch('change');
    assert.equal(coins.querySelector('.ss-field-error').hidden, true, 'a plain change says nothing');
});

test('changeNote on a list: rows the store left out, else the first row\'s field it moved', () => {
    const field = { type: 'list', of: { name: { type: 'text', label: 'Name', max: 4 }, worth: { type: 'int', label: 'Worth', min: 1, max: 9 } } };
    assert.equal(changeNote(field, [{ name: 'a', worth: 1 }], [{ name: 'a', worth: 1 }]), '');
    assert.equal(changeNote(field, [{ name: 'abcdefg', worth: 1 }], [{ name: 'abcd', worth: 1 }]), 'Row 1, Name: Cut to 4 characters, the most this allows.');
    assert.equal(changeNote(field, [{ worth: 1 }, { worth: 50 }], [{ worth: 1 }, { worth: 9 }]), 'Row 2, Worth: Set to 9, the most this allows.');
    assert.equal(changeNote(field, [{}, {}, {}], [{}]), 'Only 1 of the 3 rows could be kept.');
    assert.equal(changeNote(field, 'x', []), '');
});

test('`quiet` leaves the search count and the empty message to a window around the form; `className` adds a class', () => {
    const { form, parent } = setup({ search: false, className: 'ss-money', quiet: true });
    assert.ok(form.el.classList.contains('ss-form') && form.el.classList.contains('ss-money'));
    assert.equal(form.filter('title') > 0, true, 'the count is still returned');
    assert.equal(form.el.querySelector('.ss-form-status').hidden, true);
    assert.equal(form.filter('zzzz'), 0);
    assert.equal(form.el.querySelector('.ss-form-empty').hidden, true);
    assert.equal(parent.querySelectorAll('.ss-form-status').filter(node => !node.hidden).length, 0);
    const loud = setup({ search: false });
    loud.form.filter('zzzz');
    assert.equal(loud.form.el.querySelector('.ss-form-empty').hidden, false, 'without it the form says so itself');
});
