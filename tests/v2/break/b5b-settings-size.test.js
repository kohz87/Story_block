// B-b5b-robust-12: a text setting's `max` (domains/index.js currency: max 24, assist profile: max 80, RPG Battle
// trade place: max 80) is never applied. host-ui.js control() builds the input without maxlength and stores
// whatever is typed or pasted (settings.set copies it into extension_settings, saved to settings.json on every
// change); readers clip it later (money.js currencyOf), so the reader is never told and the file grows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { renderSettingsHost } from '../../../src/v2/host-ui.js';

const doc = installFakeDom();

test('B-b5b-robust-12: a text field with max: 24 does not store a 1 MB paste', () => {
    const registry = createRegistry();
    registry.register({
        id: 'shop', name: 'Shop',
        settings: { defaults: { currency: 'gold' }, schema: { currency: { type: 'text', label: 'Currency', max: 24 } } },
    });
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const input = root.querySelectorAll('.story-suite-row').find(row => row.dataset.field === 'currency').querySelector('input');
    input.value = 'x'.repeat(1024 * 1024);
    input.dispatch('change');
    const stored = es.storySuite.modules.shop.currency;
    assert.ok(stored.length <= 24, `stored ${stored.length} characters for a field whose max is 24`);
});
