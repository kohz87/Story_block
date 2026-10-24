// R2-b7-combos-2: B-b7-combos-2 is fixed only at the top level of a definition. An unknown TOP-level
// field is now logged and ignored, but a newer module's field one level down still refuses the
// whole module: `settings.features` (where MODULES §F100's feature flags would naturally go), a new
// settings field type, a new per-command option. A newer RPG Battle that adds any of these to an
// existing part is switched off on an older Story Block with "is not a settings field".
// Drop into Story_block/tests/v2/break/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../../testkit/index.js';

const base = extra => ({ id: 'zz-newer', name: 'Newer', version: '2.1.0', queries: { 'zz.ping': () => 'pong' }, ...extra });
const cases = {
    'settings.features': base({ settings: { defaults: {}, schema: {}, features: [{ id: 'wear', default: false }] } }),
    'a command option': base({ commands: { 'zz.go': { handler: () => ({ summary: 'Go.' }), internal: false, cooldown: 3 } } }),
};

for (const [label, def] of Object.entries(cases)) {
    test(`an optional field from a newer module (${label}) does not switch the module off`, async () => {
        const host = await createHost({ modules: [] });
        const warn = console.warn;
        console.warn = () => {};
        try {
            await host.sdk.registerModule(def);
        } finally {
            console.warn = warn;
        }
        assert.equal(host.sdk.query('zz.ping'), 'pong');
        host.close();
    });
}
