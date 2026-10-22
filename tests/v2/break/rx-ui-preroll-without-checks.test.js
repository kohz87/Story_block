// rx-ui (beta rolling break, standalone priority + invariant 4): Story Block's "Roll checks before the
// reply" feature (story-block.preroll) only works when a module keeps checks (RPG Battle's `check` kind).
// In a chat without one (Story Block alone, or with Story Director / NPC State Delta) the switch is
// still offered and can be turned on; it then never runs ("did not run (no module keeps checks …)") —
// a dead control. It should be hidden there, or shown off and disabled with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { renderSettingsHost } from '../../../src/v2/host-ui.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';

test('without a module that keeps checks, the pre-roll switch is not a live control', async () => {
    const doc = setupDom();
    const host = await createHost({});
    try {
        assert.equal(host.registry.capture('check'), null, 'no module keeps checks here');
        const root = doc.createElement('div');
        doc.body.appendChild(root);
        renderSettingsHost(root, { registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk });
        const live = root.querySelectorAll('.story-suite-feature')
            .filter(row => row.dataset.feature === CORE_FEATURE.preroll)
            .map(row => row.querySelector('input'))
            .filter(input => !input.disabled);
        assert.equal(live.length, 0, `${live.length} live "Roll checks before the reply" switch(es) in a chat where nothing keeps checks`);
    } finally {
        host.close();
    }
});
