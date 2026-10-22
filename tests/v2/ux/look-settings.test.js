// Settings → Story Suite: "Panel style" and "Font" (the look, view/theme.js) are rows of Story Suite's own
// fold; a change is stored and the look follows at once (theme.apply). Settings → Diagnostics → "Show the
// UI sample" opens the sample when the page offers one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { DIAGNOSTICS_FOLD, DIAGNOSTICS_TEXT, HOST_FOLD, renderSettingsHost } from '../../../src/v2/host-ui.js';

const doc = installFakeDom();

function setup() {
    const registry = createRegistry();
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    return { registry, es, settings };
}
const foldOf = (root, key) => root.querySelectorAll('details').find(node => node.dataset.fold === key);

test('Panel style and Font are choices in Story Suite\'s fold; a change is stored and applied at once', () => {
    const { registry, es, settings } = setup();
    let applied = 0;
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc, theme: { apply: () => { applied += 1; } } });
    const fold = foldOf(root, HOST_FOLD);
    const row = key => fold.querySelectorAll('.story-suite-row').find(node => node.dataset.field === key);
    const panel = row('panelStyle').querySelector('select');
    const font = row('font').querySelector('select');
    assert.deepEqual(panel.querySelectorAll('option').map(o => o.value), ['glass', 'solid', 'sillytavern']);
    assert.deepEqual(font.querySelectorAll('option').map(o => o.value), ['nunito', 'theme']);
    assert.equal(panel.value, 'glass');
    panel.value = 'solid';
    panel.dispatch('change');
    assert.equal(es.storySuite.host.panelStyle, 'solid');
    assert.equal(applied, 1);
    font.value = 'theme';
    font.dispatch('change');
    assert.equal(es.storySuite.host.font, 'theme');
    assert.equal(applied, 2);
    // Glass strength: a slider under Panel style, 30–90, stored when let go, the look follows at once.
    const order = fold.querySelectorAll('.story-suite-row').map(node => node.dataset.field);
    assert.equal(order.indexOf('glassStrength'), order.indexOf('panelStyle') + 1);
    const slider = row('glassStrength').querySelector('input');
    assert.equal(slider.type, 'range');
    assert.deepEqual([slider.min, slider.max, slider.value], ['30', '90', '50']);
    assert.equal(row('glassStrength').querySelector('output').textContent, '50');
    assert.equal(row('glassStrength').getAttribute('for'), slider.id, 'the label names the slider itself');
    slider.value = '72';
    slider.dispatch('input');
    assert.equal(row('glassStrength').querySelector('output').textContent, '72', 'shown while moving');
    assert.equal(es.storySuite.host.glassStrength, undefined, 'stored when let go');
    slider.dispatch('change');
    assert.equal(es.storySuite.host.glassStrength, 72);
    assert.equal(applied, 3);
    slider.value = '5';
    slider.dispatch('change');
    assert.equal(es.storySuite.host.glassStrength, 30, 'kept inside the range');
    applied = 2;
    // Other host rows do not redraw the look.
    const budget = row('tailBudget').querySelector('input');
    budget.value = '1200';
    budget.dispatch('change');
    assert.equal(applied, 2);
});

test('Diagnostics: "Show the UI sample" only when the page offers it; a failure is said in the status line', () => {
    const { registry, settings } = setup();
    const opened = [];
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc, diagnostics: { report: async () => 'R', sample: () => { opened.push(1); } } });
    const button = foldOf(root, DIAGNOSTICS_FOLD).querySelector('.story-suite-diagnostics-sample');
    assert.ok(button);
    assert.equal(button.textContent, DIAGNOSTICS_TEXT.sample);
    assert.equal(button.title, DIAGNOSTICS_TEXT.sampleTitle);
    button.click();
    assert.deepEqual(opened, [1]);
    const none = doc.createElement('div');
    renderSettingsHost(none, { registry, settings, doc, diagnostics: { report: async () => 'R' } });
    assert.equal(foldOf(none, DIAGNOSTICS_FOLD).querySelector('.story-suite-diagnostics-sample'), null);
    const failing = doc.createElement('div');
    renderSettingsHost(failing, { registry, settings, doc, diagnostics: { report: async () => 'R', sample: () => { throw new Error('no body'); } } });
    const fold = foldOf(failing, DIAGNOSTICS_FOLD);
    fold.querySelector('.story-suite-diagnostics-sample').click();
    assert.equal(fold.querySelector('.story-suite-diagnostics-status').textContent, 'The UI sample could not be shown: no body');
});
