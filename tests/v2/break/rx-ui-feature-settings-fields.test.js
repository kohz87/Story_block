// rx-ui (beta rolling break, invariant 4 + F100): a feature turned off leaves its settings behind. A
// schema field cannot say which feature it belongs to (a `feature` on a field is taken without a word
// and ignored), so the overlay keeps showing switches and numbers that do nothing while the feature is
// off (Story Director's "Day digest: …" fields with story-director.digest off, for one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { renderSettingsHost } from '../../../src/v2/host-ui.js';

const probe = () => ({
    id: 'probe',
    name: 'Probe',
    features: [{ id: 'probe.digest', label: 'Digest' }],
    settings: {
        defaults: { keep: 3, color: 'red' },
        schema: {
            keep: { type: 'int', label: 'Digest: days kept', min: 1, max: 9, feature: 'probe.digest' },
            color: { type: 'text', label: 'Colour' },
        },
    },
});

async function overlay() {
    const doc = setupDom();
    const host = await createHost({ modules: [probe()] });
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const view = renderSettingsHost(root, { registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk });
    return { host, root, view };
}

test('a settings field of a feature that is off is not shown (no dead control); on again it is back', async () => {
    const { host, root, view } = await overlay();
    assert.ok(root.textContent.includes('days kept'), 'shown while on');
    host.features.set('probe.digest', false);
    view.refresh();
    assert.ok(root.textContent.includes('Colour'), 'the module\'s other fields stay');
    assert.ok(!root.textContent.includes('days kept'), 'the off feature\'s field is still in the overlay');
    host.features.set('probe.digest', true);
    view.refresh();
    assert.ok(root.textContent.includes('days kept'));
    host.close();
});
