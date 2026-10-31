import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { createInstalled } from '../../../src/v2/packs/installed.js';
import { HOST_CAPABILITIES } from '../../../src/v2/packs/limits.js';

test('rules manifests are rejected and cannot replace an installed pack', async () => {
    const store = {};
    const installed = createInstalled({ settings: { read: () => store, save: async () => {} }, capabilities: () => ['scene', 'inventory'] });
    const world = { id: 'world', version: '1.0.0', requires: { storyBlock: '^2' }, content: {} };
    assert.equal((await installed.install(world)).ok, true);
    const rules = { ...world, version: '2.0.0', content: { rules: [{}] } };
    const result = await installed.install(rules);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.code === 'UNKNOWN_KIND' && error.path === 'content.rules'));
    assert.equal(installed.list()[0].version, '1.0.0');
    assert.deepEqual(HOST_CAPABILITIES, ['data-modules-v1']);
});

test('the open world example remains valid with the supported host capabilities', () => {
    const input = readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8');
    // Story Director (2.3.0) gives chronicle-lasting, which 2.2.0's world events use.
    const result = validatePack(input, { capabilities: ['scene', 'inventory', 'chronicle-lasting', ...HOST_CAPABILITIES] });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.pack.content.places.length, 320);
    assert.equal(result.pack.content.routes.length, 350);
    assert.equal(result.pack.content.dataModules.length, 4);
});
