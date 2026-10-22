// The changes card's loot chips with "Take selected", and the Inventory screen's Equipped section,
// "Equip on…" and "Give…" pickers (MODULES §F99), drawn by the real template renderer; their payloads
// go through the real command bus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandBus } from '../../../src/v2/commands.js';
import { changesCardScreen, changesSummary, inventoryScreen } from '../../../src/v2/screens/index.js';
import { counterIds, fakeRegistry, fakeStore } from '../helpers/bus-fakes.js';
import { core, queries, renderSkip, settle, show, stocked, text } from './helpers.js';

const skip = renderSkip;
const SID = 'sw_loot00000001';

function lootState(module, { taken = false } = {}) {
    const state = stocked(module);
    state.domains.inventory.loot = {
        [SID]: { sid: SID, n: 3, where: 'on the cellar shelf', claim: `loot:${SID}`, items: { 0: { name: 'Rusty Key', qty: 1 }, 1: { name: 'Lantern Oil', qty: 2 }, 2: { name: 'Torn Map', qty: 1 } } },
        sw_older0000001: { sid: 'sw_older0000001', n: 1, where: '', claim: 'loot:sw_older0000001', items: { 0: { name: 'Old Boot', qty: 1 } } },
    };
    if (taken) state.meta.claims[`loot:${SID}`] = true;
    return state;
}

test('changes card: the reply\'s loot as chips; ticked ones go to inventory.lootTake; the bus takes them', { skip }, async () => {
    const module = core();
    const state = lootState(module);
    const store = fakeStore(state);
    // The reader has the loot feature on (the default), as the real registry answers.
    const registry = Object.assign(fakeRegistry([module]), { featureOn: () => true });
    const bus = createCommandBus({ store, registry, id: counterIds(), seed: () => 7 });
    const { el, view, calls, results } = show(changesCardScreen, {
        state, query: queries(module, state), changes: [`/domains/inventory/loot/${SID}`],
        command: (type, payload, options) => bus.command(type, payload, options),
    });
    assert.deepEqual(view.warnings, []);
    const loot = el.querySelectorAll('.loot');
    assert.equal(loot.length, 1, 'only this reply\'s offer');
    assert.equal(text(loot[0].querySelector('.loot-head')), 'Loot — on the cellar shelf');
    assert.deepEqual(loot[0].querySelectorAll('.pick').map(chip => text(chip)), ['Rusty Key', 'Lantern Oil ×2', 'Torn Map']);
    const boxes = loot[0].querySelectorAll('input[type="checkbox"]');
    for (const at of [0, 1]) {
        boxes[at].checked = true;
        boxes[at].dispatch('change');
    }
    loot[0].querySelector('.take').click();
    await settle();
    assert.deepEqual(calls.map(([type, payload, options]) => [type, payload, options.cause]), [['inventory.lootTake', { sid: SID, pick: ['0', '1'] }, 'ui']]);
    assert.equal(results[0].ok, true, results[0].message);
    const items = Object.values(store.head().domains.inventory.stacks).map(stack => store.head().domains.inventory.defs[stack.def].name);
    assert.ok(items.includes('Rusty Key') && items.includes('Lantern Oil') && !items.includes('Torn Map'));
    assert.equal(el.querySelector('.none'), null, 'laying out loot is a change');
});

test('changes card: an offer already taken says so, with no chips; the summary counts what was laid out', { skip }, () => {
    const module = core();
    const state = lootState(module, { taken: true });
    const { el, view } = show(changesCardScreen, { state, query: queries(module, state), changes: [`/domains/inventory/loot/${SID}`] });
    assert.deepEqual(view.warnings, []);
    assert.equal(el.querySelectorAll('.pick').length, 0);
    assert.equal(text(el.querySelector('.taken')), 'Taken.');
    assert.equal(changesSummary({ state, changes: [`/domains/inventory/loot/${SID}`] }), '3 things to pick up');
    assert.equal(changesSummary({ state, before: stocked(module), changes: ['/domains/inventory/loot'] }), '4 things to pick up');
});

test('inventory: with members, an Equipped section with Take off, and Equip on… / Give… pickers', { skip }, async () => {
    const module = core();
    const state = stocked(module);
    state.domains.party = { pc: null, order: ['ac_ren00001', 'ac_mira0001'], actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' }, ac_mira0001: { id: 'ac_mira0001', name: 'Mira' } } };
    state.domains.inventory.stacks.it_dagg0001.owner = 'ac_mira0001';
    state.domains.inventory.stacks.it_dagg0001.equipped = 'hand';
    state.domains.inventory.stacks.it_dagg0001.cond = 40;
    const store = fakeStore(state);
    const bus = createCommandBus({ store, registry: fakeRegistry([module]), id: counterIds(), seed: () => 42 });
    const { el, view, calls, results } = show(inventoryScreen, {
        state, query: queries(module, state), command: (type, payload, options) => bus.command(type, payload, options),
    });
    assert.deepEqual(view.warnings, []);
    const worn = el.querySelector('.worn');
    assert.deepEqual(worn.querySelectorAll('h5').map(head => text(head)), ['Mira']);
    assert.equal(text(worn.querySelector('.piece')), 'hand Dagger 40/100 Take off');
    const row = name => el.querySelectorAll('.item').find(item => item.querySelector('.name').textContent === name);
    const choices = (item, cls) => item.querySelectorAll(`.${cls} .choices button`).map(button => text(button));
    assert.deepEqual(choices(row('Iron Sword'), 'equip-on'), ['Ren', 'Mira']);
    assert.deepEqual(choices(row('Dagger'), 'equip-on'), ['Ren'], 'not its wearer');
    assert.equal(row('Rope').querySelectorAll('.equip-on').length, 0, 'not equipment');
    assert.deepEqual(choices(row('Rope'), 'give'), ['Ren', 'Mira']);
    assert.deepEqual(choices(row('Dagger'), 'give'), ['the party\'s bag', 'Ren']);
    assert.equal(row('Iron Sword').querySelectorAll('[data-command="inventory.equip"]').length, 0, 'the picker replaces the plain Equip');
    assert.equal(el.querySelectorAll('ss-widget').length, 0, 'no item detail widget without RPG Battle');

    row('Iron Sword').querySelectorAll('.equip-on .choices button')[0].click();
    await settle();
    worn.querySelector('[data-command="inventory.unequip"]').click();
    await settle();
    row('Rope').querySelectorAll('.give .choices button')[0].click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload]), [
        ['inventory.equipOn', { stack: 'it_sword001', actor: 'ac_ren00001' }],
        ['inventory.unequip', { stack: 'it_dagg0001' }],
        ['inventory.transfer', { stack: 'it_rope0001', to: 'ac_ren00001' }],
    ]);
    assert.deepEqual(results.map(result => result.ok), [true, true, true]);
    const stacks = store.head().domains.inventory.stacks;
    assert.deepEqual([stacks.it_sword001.owner, stacks.it_sword001.equipped], ['ac_ren00001', 'hand']);
    assert.deepEqual([stacks.it_dagg0001.owner, stacks.it_dagg0001.equipped], ['ac_mira0001', null], 'taken off, still in Mira\'s pack');
    assert.equal(stacks.it_rope0001.owner, 'ac_ren00001');
});

test('inventory: RPG Battle\'s item detail widget sits in each row when its query is there', { skip }, () => {
    const module = core();
    const state = stocked(module);
    const drawn = [];
    const widgets = { 'rpg-battle.item-detail': { render(el, props) { drawn.push(props.stack); } } };
    const { view } = show(inventoryScreen, { state, query: queries(module, state, { 'rpg-battle.itemDetail': () => null }), widgets });
    assert.deepEqual(view.warnings, []);
    assert.deepEqual(drawn.sort(), Object.keys(state.domains.inventory.stacks).sort());
});
