// Gear condition on stacks (`cond`, 0…100; absent = 100) for RPG Battle's wear rules:
// `inventory.wear { stack, by }` and `inventory.repair { stack, to }`, another module's calls only,
// with clamps; the validator, split, merge, transfer and the item rows keep it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COND_MAX, condOf, listItems, validateInventory } from '../../../src/v2/domains/inventory.js';
import { createHarness } from './helpers/fake-ctx.js';
import { core, stocked } from './fixtures.js';

const fresh = () => {
    const module = core();
    return createHarness([module], { state: stocked(module) });
};
const asModule = { caller: 'rpg-battle', cause: 'story' };
const sword = h => h.state.domains.inventory.stacks.it_sword001;

test('wear and repair are another module\'s calls only, whatever the cause', () => {
    const h = fresh();
    for (const cause of ['ui', 'story', 'system']) {
        const out = h.run('inventory.wear', { stack: 'it_sword001', by: 10 }, { cause });
        assert.deepEqual([out.ok, out.code], [false, 'REFUSED'], cause);
        assert.match(out.message, /another module's rules/);
        assert.equal(h.run('inventory.repair', { stack: 'it_sword001' }, { cause }).code, 'REFUSED');
    }
    assert.equal(sword(h).cond, undefined, 'a stack with no condition is as new');
    assert.equal(condOf(sword(h)), COND_MAX);
});

test('wear goes down, never below 0 (broken); repair goes up to its mark, never down; as new drops the field', () => {
    const h = fresh();
    let out = h.run('inventory.wear', { stack: 'it_sword001', by: 30 }, asModule);
    assert.equal(out.ok, true, out.message);
    assert.equal(out.result.summary, 'Iron Sword wears (100 → 70).');
    assert.deepEqual([sword(h).cond, out.result.data.now, out.result.narrate], [70, 70, false]);
    out = h.run('inventory.wear', { stack: 'it_sword001', by: 500 }, asModule);
    assert.deepEqual([out.ok, sword(h).cond, out.result.data.by, out.result.data.broken], [true, 0, 100, true]);
    assert.equal(out.result.summary, 'Iron Sword breaks.');
    out = h.run('inventory.wear', { stack: 'it_sword001', by: 5 }, asModule);
    assert.deepEqual([out.ok, out.result.summary], [true, 'Iron Sword is already broken.']);
    out = h.run('inventory.repair', { stack: 'it_sword001', to: 60 }, asModule);
    assert.deepEqual([out.ok, sword(h).cond, out.result.summary], [true, 60, 'Iron Sword is mended (0 → 60).']);
    out = h.run('inventory.repair', { stack: 'it_sword001', to: 40 }, asModule);
    assert.deepEqual([out.ok, sword(h).cond], [true, 60], 'a repair never lowers it');
    out = h.run('inventory.repair', { stack: 'it_sword001', to: 250 }, asModule);
    assert.deepEqual([out.ok, Object.hasOwn(sword(h), 'cond'), out.result.data.now], [true, false, 100]);
    out = h.run('inventory.repair', { stack: 'it_sword001' }, asModule);
    assert.equal(out.result.summary, 'Iron Sword needs no mending to 100.');
});

test('malformed amounts are INVALID; a missing stack NOT_FOUND', () => {
    const h = fresh();
    for (const by of [0, -3, 1.5, '5', null]) assert.equal(h.run('inventory.wear', { stack: 'it_sword001', by }, asModule).code, 'INVALID', String(by));
    for (const to of [-1, 2.5, 'all']) assert.equal(h.run('inventory.repair', { stack: 'it_sword001', to }, asModule).code, 'INVALID', String(to));
    assert.equal(h.run('inventory.wear', { stack: 'it_nothere1', by: 1 }, asModule).code, 'NOT_FOUND');
});

test('the validator holds cond to a whole number 0…100; items rows carry it when it is there', () => {
    const state = stocked(core());
    const inv = state.domains.inventory;
    assert.deepEqual(validateInventory(inv), []);
    for (const bad of [-1, 101, 2.5, '50', null]) {
        inv.stacks.it_sword001.cond = bad;
        assert.match(validateInventory(inv).join(' '), /condition of .*whole number from 0 to 100/, String(bad));
    }
    inv.stacks.it_sword001.cond = 0;
    assert.deepEqual(validateInventory(inv), []);
    const rows = listItems(inv);
    assert.equal(rows.find(row => row.stack === 'it_sword001').cond, 0);
    assert.equal(Object.hasOwn(rows.find(row => row.stack === 'it_rope0001'), 'cond'), false);
});

test('split keeps the condition; stacks in different condition never merge or pile together', () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.stacks.it_rope0001.cond = 40;
    const h = createHarness([module], { state });
    const split = h.run('inventory.split', { stack: 'it_rope0001', qty: 1 });
    assert.equal(split.ok, true, split.message);
    assert.equal(h.state.domains.inventory.stacks[split.result.data.made].cond, 40);
    const merged = h.run('inventory.merge', { stack: split.result.data.made, into: 'it_rope0001' });
    assert.equal(merged.ok, true, 'same condition: together again');
    // A worn lot handed to someone who holds a fresh lot stays its own stack.
    const two = stocked(module);
    two.domains.inventory.stacks.it_rope0001.cond = 40;
    two.domains.inventory.stacks.it_rope0002 = { ...two.domains.inventory.stacks.it_rope0001, id: 'it_rope0002', owner: 'ac_ren00001', qty: 1 };
    delete two.domains.inventory.stacks.it_rope0002.cond;
    const g = createHarness([module], { state: two });
    assert.equal(g.run('inventory.merge', { stack: 'it_rope0001', into: 'it_rope0002' }).code, 'REFUSED');
    const moved = g.run('inventory.transfer', { stack: 'it_rope0001', to: 'ac_ren00001', qty: 1 });
    assert.equal(moved.ok, true, moved.message);
    const lots = Object.values(g.state.domains.inventory.stacks).filter(s => s.def === 'story/rope' && s.owner === 'ac_ren00001');
    assert.deepEqual(lots.map(s => [s.qty, condOf(s)]).sort(), [[1, 100], [1, 40]]);
});
