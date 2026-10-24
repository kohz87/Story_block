// B-b7-combos-2: module/host version mismatches. A module cannot say which Story Block it needs
// (no `requires` field: registry.js KNOWN_KEYS), and any field a newer module adds makes an older
// host refuse the whole module with "is not a module field" instead of a version message. A newer
// RPG Battle (with F100 `features`, say) on an alpha.1 host is therefore switched off with a toast
// that never says "update Story Block".
// Drop into Story_block/tests/v2/break/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../../testkit/index.js';

const mod = extra => ({ id: 'zz-versioned', name: 'Versioned', version: '2.1.0', queries: { 'zz.ping': () => 'pong' }, ...extra });

test('a module may declare the Story Block it needs, and registers when the host satisfies it', async () => {
    const host = await createHost({ modules: [] });
    await host.sdk.registerModule(mod({ requires: { storyBlock: '>=2.0.0-alpha.1' } }));
    assert.equal(host.sdk.query('zz.ping'), 'pong');
    host.close();
});

test('a module needing a newer Story Block is refused with a version message', async () => {
    const host = await createHost({ modules: [] });
    await assert.rejects(
        host.sdk.registerModule(mod({ requires: { storyBlock: '>=9.0.0' } })),
        error => /needs Story Block|version/i.test(error.message) && !/is not a module field/.test(error.message),
    );
    host.close();
});

test('an optional field from a newer module version does not switch the whole module off', async () => {
    const host = await createHost({ modules: [] });
    // e.g. a field a later version adds (MODULES §F100's feature flags were one, until this host learned them)
    await host.sdk.registerModule(mod({ achievements: [{ id: 'wear', label: 'Wear', default: false }] }));
    await host.sdk.registerModule({ id: 'zz-featured', queries: { 'zz.featured': () => 'yes' }, features: [{ id: 'zz-featured.wear', label: 'Wear', default: false, colour: 'red' }] });
    assert.equal(host.sdk.query('zz.featured'), 'yes');
    assert.equal(host.sdk.query('zz.ping'), 'pong');
    host.close();
});
