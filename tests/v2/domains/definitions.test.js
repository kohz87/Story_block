// Item definitions stay available through the generic inventory query.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, line } from './helpers/fake-ctx.js';
import { core, def as defOf, stocked } from './fixtures.js';
import { DEFINITIONS_MAX_IDS, definitionsOf, defaultDef } from '../../../src/v2/domains/inventory.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { itemDefsIn } from '../../../src/v2/packs/content.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { fakeSettings } from '../packs/helpers/fake-settings.js';
import { itemsPack, sampleText } from '../packs/helpers/fixtures.js';

// ---------- inventory.definitions ----------

test('inventory.definitions: every definition, ID-sorted, copies; or just those asked for', () => {
    const module = core();
    const h = createHarness([module], { state: stocked(module) });
    const all = h.query('inventory.definitions');
    assert.deepEqual(all.map(item => item.id), ['pack.fantasy/dagger', 'pack.fantasy/iron-sword', 'pack.fantasy/potion', 'story/lantern', 'story/rope']);
    assert.deepEqual(all.find(item => item.id === 'story/rope'), { id: 'story/rope', name: 'Rope', kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' });
    assert.deepEqual(h.query('inventory.definitions', {}), all);
    assert.deepEqual(h.query('inventory.definitions', { ids: ['story/rope', 'pack.fantasy/dagger', 'story/rope', 'story/none'] }).map(item => item.id), ['pack.fantasy/dagger', 'story/rope'], 'unknown left out, each once, sorted');
    assert.deepEqual(h.query('inventory.definitions', { ids: [] }), []);
    assert.equal(h.query('inventory.definitions', { ids: ['pack.fantasy/iron-sword'] })[0].slot, 'hand');
});

test('inventory.definitions: malformed arguments give [], never an error', () => {
    const module = core();
    const h = createHarness([module], { state: stocked(module) });
    for (const args of [{ ids: 'story/rope' }, { ids: [1] }, { ids: ['Story Rope'] }, { ids: ['story/rope', null] }, { ids: { 0: 'story/rope' } }, { ids: Array.from({ length: DEFINITIONS_MAX_IDS + 1 }, () => 'story/rope') }, 'story/rope', 7, [], ['story/rope']]) {
        assert.deepEqual(h.query('inventory.definitions', args), [], JSON.stringify(args).slice(0, 40));
    }
    assert.equal(h.query('inventory.definitions', null).length, 5, 'no arguments at all: everything');
    assert.deepEqual(definitionsOf(undefined, {}), []);
    assert.deepEqual(definitionsOf({ defs: { 'story/a': 5 } }, {}), [], 'a record that is not a def is not listed');
    const first = h.query('inventory.definitions');
    first[0].name = 'Changed';
    assert.notEqual(h.query('inventory.definitions')[0].name, 'Changed', 'a copy each time');
});

test('inventory.definitions: sees a transaction\'s own drafts, makes nothing', () => {
    const peek = { id: 'zz-peek', domains: {}, commands: { 'peek.add': ctx => {
        ctx.call('inventory.grant', { name: 'Moonveil Trout' });
        return { summary: 'ok', data: { ids: ctx.query('inventory.definitions', { ids: ['story/moonveil-trout'] }).map(item => item.id) }, narrate: false };
    } } };
    const h = createHarness([core(), peek]);
    const out = h.run('peek.add', {}, { cause: 'system' });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(out.result.data.ids, ['story/moonveil-trout']);
    const before = h.state;
    h.query('inventory.definitions');
    assert.equal(h.state, before);
});
