// rx-ui (beta rolling break, keyboard/screen reader + F100): every feature row is drawn twice (the
// Features overview and the module's own fold) with the same input id, and each row is a
// <label for="that id">. A label with `for` names the FIRST element with that id, so the switch in the
// module's fold has no label of its own (screen readers read it unnamed) and its text toggles the
// overview's switch. Ids from different features can also collide (`a.b_c` of module `a` and `a.b.c`
// of module `a.b` both become story_suite_feature_a_b_c), and then a label toggles another module's feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { renderSettingsHost } from '../../../src/v2/host-ui.js';

const modA = { id: 'a', name: 'A', features: [{ id: 'a.b_c', label: 'A b_c' }] };
const modAB = { id: 'a.b', name: 'A.B', features: [{ id: 'a.b.c', label: 'A.B c' }] };

test('each feature switch has an id of its own, and its row labels that switch', async () => {
    const doc = setupDom();
    const host = await createHost({ modules: [modA, modAB] });
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    renderSettingsHost(root, { registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk });
    const rows = root.querySelectorAll('.story-suite-feature');
    assert.ok(rows.length >= 4);
    const ids = rows.map(row => row.querySelector('input').id);
    const dupes = ids.filter((id, at) => ids.indexOf(id) !== at);
    assert.deepEqual(dupes, [], `ids used twice: ${[...new Set(dupes)].join(', ')}`);
    for (const row of rows) assert.equal(row.getAttribute('for'), row.querySelector('input').id, `the row of ${row.dataset.feature} labels its own switch`);
    host.close();
});
