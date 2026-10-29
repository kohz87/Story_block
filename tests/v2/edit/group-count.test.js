import test from 'node:test';
import assert from 'node:assert/strict';
import { core, stocked, stack } from '../domains/fixtures.js';
import { createHarness } from '../domains/helpers/fake-ctx.js';

test('the count pencil changes separate pieces for the same owner in one edit', () => {
    const module = core(), state = stocked(module), inv = state.domains.inventory;
    inv.stacks.it_lant0002 = stack('it_lant0002', 'story/lantern', 1);
    inv.stacks.it_lant0003 = stack('it_lant0003', 'story/lantern', 1, { owner: 'ac_ren00001' });
    const h = createHarness(module, { state });
    const edit = qty => h.run('inventory.edit', { stack: 'it_lant0001', group: true, qty });
    assert.equal(h.query('inventory.counts').it_lant0001, 2);
    let result = edit(4);
    assert.equal(result.ok, true, result.message);
    assert.match(result.result.summary, /Lantern.*4/);
    assert.equal(result.result.data.edit, true);
    assert.equal(h.query('inventory.counts').it_lant0001, 4);
    result = edit(2);
    assert.equal(result.ok, true, result.message);
    assert.equal(h.query('inventory.counts').it_lant0001, 2);
    assert.ok(h.state.domains.inventory.stacks.it_lant0002, 'newer additions go first');
    assert.ok(h.state.domains.inventory.stacks.it_lant0003, 'another owner is untouched');
    assert.equal(edit(51).ok, false);
});

test('group count cannot remove equipped pieces', () => {
    const module = core(), state = stocked(module), inv = state.domains.inventory;
    inv.stacks.it_sword001.equipped = 'hand';
    inv.stacks.it_sword002 = stack('it_sword002', 'pack.fantasy/iron-sword', 1);
    const h = createHarness(module, { state });
    assert.equal(h.run('inventory.edit', { stack: 'it_sword002', group: true, qty: 1 }).ok, true);
    assert.ok(h.state.domains.inventory.stacks.it_sword001);
    assert.equal(h.run('inventory.edit', { stack: 'it_sword001', group: true, qty: 2 }).ok, true);
    const next = structuredClone(h.state);
    const loose = Object.values(next.domains.inventory.stacks).find(item => item.def === 'pack.fantasy/iron-sword' && item.equipped === null);
    loose.equipped = 'head';
    h.state = next;
    const refused = h.run('inventory.edit', { stack: 'it_sword001', group: true, qty: 1 });
    assert.equal(refused.code, 'REFUSED');
    assert.match(refused.message, /Unequip/);
});
