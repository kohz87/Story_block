// Settings → Diagnostics → "Show the UI sample" opens the sample when the page offers one. (Panel style, Glass strength and Font
// are the Look section's: tests/v2/ux/settings-window.test.js.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { DIAGNOSTICS_FOLD, DIAGNOSTICS_TEXT, renderSettingsHost } from '../../../src/v2/host-ui.js';

const doc = installFakeDom();

function setup() {
    const registry = createRegistry();
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    return { registry, es, settings };
}
const foldOf = (root, key) => root.querySelectorAll('details').find(node => node.dataset.fold === key);

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
