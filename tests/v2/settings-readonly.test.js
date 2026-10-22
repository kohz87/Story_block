// Read-only settings fields (SPEC §6 Settings): a schema field's `readOnly` (true, or a function of the
// module's current values) draws it disabled with its value and help shown, and the overlay stores nothing
// from it; a function's rows follow the other fields as they change (Story Director's calendar fields
// while Calendar is `pack`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../ui-fake-dom.js';
import { createRegistry, definitionProblems } from '../../src/v2/registry.js';
import { createSettings } from '../../src/v2/sdk.js';
import { fieldReadOnly, renderSettingsHost } from '../../src/v2/host-ui.js';

const doc = installFakeDom();

const calendarLike = () => ({
    id: 'clock',
    name: 'Clock',
    settings: {
        defaults: { preset: 'pack', era: 'CY', months: [{ name: 'Frostmoon', days: 30 }], fixed: 'v1' },
        schema: {
            preset: { type: 'choice', label: 'Calendar: Calendar', options: ['pack', 'custom'] },
            era: { type: 'text', label: 'Calendar: Era', help: 'Written before the year.', readOnly: values => values.preset === 'pack' },
            months: { type: 'list', label: 'Calendar: Months', of: { name: 'text', days: { type: 'int', min: 1 } }, readOnly: values => values.preset === 'pack' },
            fixed: { type: 'text', label: 'Format', readOnly: true, help: 'Set by the module.' },
            broken: { type: 'bool', label: 'Broken', readOnly: () => { throw new Error('no'); } },
        },
    },
});

function setup() {
    const registry = createRegistry();
    registry.register(calendarLike());
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    return { registry, es, settings, root };
}
const rowOf = (root, key) => root.querySelectorAll('.story-suite-row').find(row => row.dataset.field === key);
const controlsOf = row => row.querySelectorAll('input, select, textarea, button');

test('fieldReadOnly: true, a function of the values, anything else false; a function that throws is false', () => {
    assert.equal(fieldReadOnly({ type: 'text', readOnly: true }, {}), true);
    assert.equal(fieldReadOnly({ type: 'text' }, {}), false);
    assert.equal(fieldReadOnly('text', {}), false);
    assert.equal(fieldReadOnly({ type: 'text', readOnly: v => v.a === 1 }, { a: 1 }), true);
    assert.equal(fieldReadOnly({ type: 'text', readOnly: v => v.a === 1 }, { a: 2 }), false);
    assert.equal(fieldReadOnly({ type: 'text', readOnly: () => { throw new Error('x'); } }, {}), false);
});

test('a readOnly that is not true, false or a function refuses the module with a plain sentence', () => {
    const def = calendarLike();
    def.settings.schema.era.readOnly = 'yes';
    assert.ok(definitionProblems(def).some(problem => /"era"\.readOnly is not true, false or a function/.test(problem)));
    assert.deepEqual(definitionProblems(calendarLike()), []);
});

test('read-only rows show their value and help with every control disabled, and store nothing', () => {
    const { es, root } = setup();
    const era = rowOf(root, 'era');
    assert.equal(era.dataset.readonly, 'true');
    assert.ok(era.classList.contains('story-suite-row-readonly'));
    assert.match(era.textContent, /Written before the year\./, 'the help is shown');
    const input = era.querySelector('input');
    assert.equal(input.value, 'CY');
    assert.equal(input.disabled, true);
    assert.equal(input.getAttribute('aria-disabled'), 'true');
    // A list: its rows, its × and Add and its text switch are all disabled.
    const months = rowOf(root, 'months');
    assert.ok(controlsOf(months).length >= 4);
    assert.ok(controlsOf(months).every(node => node.disabled === true));
    // Nothing is stored from a read-only row, even if a change reaches it.
    input.value = 'AE';
    input.dispatch('change');
    months.querySelectorAll('button').find(node => /story-suite-list-add/.test(node.className)).click();
    assert.deepEqual(es.storySuite?.modules?.clock ?? {}, {});
    // A fixed readOnly: true field the same; a function that throws leaves its field editable.
    assert.equal(rowOf(root, 'fixed').querySelector('input').disabled, true);
    assert.match(rowOf(root, 'fixed').textContent, /Set by the module\./);
    assert.notEqual(rowOf(root, 'broken').querySelector('input').disabled, true);
    assert.notEqual(rowOf(root, 'preset').querySelector('select').disabled, true);
});

test('switching the field a readOnly follows draws those rows again: editable, with the value they showed', () => {
    const { es, root, settings } = setup();
    const select = rowOf(root, 'preset').querySelector('select');
    select.value = 'custom';
    select.dispatch('change');
    assert.equal(es.storySuite.modules.clock.preset, 'custom');
    const era = rowOf(root, 'era');
    assert.notEqual(era.dataset.readonly, 'true');
    assert.notEqual(era.querySelector('input').disabled, true);
    assert.equal(era.querySelector('input').value, 'CY', 'pre-filled with what it showed');
    assert.ok(controlsOf(rowOf(root, 'months')).every(node => node.disabled !== true));
    assert.equal(rowOf(root, 'fixed').querySelector('input').disabled, true, 'readOnly: true stays');
    assert.equal(root.querySelectorAll('.story-suite-row').filter(row => row.dataset.field === 'era').length, 1, 'one row, replaced');
    // Now it stores.
    const input = rowOf(root, 'era').querySelector('input');
    input.value = 'AE';
    input.dispatch('change');
    assert.equal(settings('clock').era, 'AE');
    // Back to pack: read-only again, showing the stored value.
    select.value = 'pack';
    select.dispatch('change');
    assert.equal(rowOf(root, 'era').querySelector('input').disabled, true);
    assert.equal(rowOf(root, 'era').querySelector('input').value, 'AE');
});

test('settings.set from code is not limited by readOnly', () => {
    const { settings } = setup();
    assert.equal(settings.set('clock', 'era', 'AE'), 'AE');
    assert.equal(settings('clock').era, 'AE');
});
