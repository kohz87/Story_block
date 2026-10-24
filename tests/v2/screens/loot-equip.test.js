// The changes card's loot chips with "Take selected", and the Inventory screen's Equipped section,
// "Equip on…" picker (MODULES §F99), drawn by the real template renderer; their payloads
// go through the real command bus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandBus } from '../../../src/v2/commands.js';
import { changesCardScreen, changesSummary, inventoryScreen } from '../../../src/v2/screens/index.js';
import { counterIds, fakeRegistry, fakeStore } from '../helpers/bus-fakes.js';
import { core, foldOf, openFold, queries, renderSkip, settle, show, stocked, text } from './helpers.js';

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

// RPG Battle's item detail answers, which is how the screen knows RPG Battle is installed (equipment is its).
const RPG_BATTLE = { 'rpg-battle.itemDetail': () => null };
// The item detail widget RPG Battle draws in each row (its query answers, so the row asks for the widget).
const DETAIL_WIDGET = { 'rpg-battle.item-detail': { render: () => ({ update() {}, destroy() {} }) } };

test('inventory: with RPG Battle and members, Equip on… / Give… pickers and a "Worn by" tag; no Equipped section', { skip }, async () => {
    const module = core();
    const state = stocked(module);
    state.domains.party = { pc: null, order: ['ac_ren00001', 'ac_mira0001'], actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' }, ac_mira0001: { id: 'ac_mira0001', name: 'Mira' } } };
    state.domains.inventory.stacks.it_dagg0001.owner = 'ac_mira0001';
    state.domains.inventory.stacks.it_dagg0001.equipped = 'hand';
    state.domains.inventory.stacks.it_dagg0001.cond = 40;
    const store = fakeStore(state);
    const bus = createCommandBus({ store, registry: fakeRegistry([module]), id: counterIds(), seed: () => 42 });
    const { el, view, calls, results } = show(inventoryScreen, {
        state, query: queries(module, state, RPG_BATTLE), widgets: DETAIL_WIDGET, draft: {}, command: (type, payload, options) => bus.command(type, payload, options),
    });
    assert.deepEqual(view.warnings, []);
    assert.equal(el.querySelector('.worn'), null, 'the Equipped section is gone: a worn piece is a bag row now');
    const row = name => el.querySelectorAll('.item').find(item => item.querySelector('.name').textContent === name);
    const worn = row('Dagger');
    assert.equal(text(worn.querySelector('.worn-by')), 'Worn by Mira', 'the tag names the wearer');
    assert.equal(text(worn.querySelector('.cond')), '40/100', 'the condition stays on the row');
    assert.equal(row('Rope').querySelector('.worn-by'), null, 'a piece not worn has no tag');
    // Equip on… is a fold row under the actions: its members show once it is chosen (not before).
    const folded = stack => (foldOf(el, stack)?.querySelectorAll('button:not(.fold-cancel)') ?? []).map(button => text(button));
    assert.deepEqual(folded('it_sword001'), [], 'closed');
    openFold(el, 'it_sword001', 'equipOn');
    assert.deepEqual(folded('it_sword001'), ['Ren', 'Mira']);
    assert.equal(row('Dagger').querySelector('button[value="equipOn"]'), null, 'worn: no Equip on…, only Unequip and Drop');
    assert.equal(row('Rope').querySelector('button[value="equipOn"]'), null, 'not equipment');
    assert.equal(row('Rope').querySelector('.give'), null, 'Give is gone: the party shares one bag');
    assert.equal(row('Dagger').querySelector('.give'), null, 'Give is gone: the party shares one bag');
    assert.equal(row('Iron Sword').querySelectorAll('[data-command="inventory.equip"]').length, 0, 'the picker replaces the plain Equip');
    assert.equal(el.querySelectorAll('ss-widget').length, el.querySelectorAll('.item').length, 'one item detail per row, RPG Battle\'s');

    foldOf(el, 'it_sword001').querySelectorAll('button')[0].click();
    await settle();
    worn.querySelector('[data-command="inventory.unequip"]').click();
    await settle();
    // Equip on… for an unworn piece is RPG Battle's item.equip { stack, to } (not refused here: this bus has no RPG Battle).
    assert.deepEqual(calls.map(([type, payload]) => [type, payload]), [
        ['item.equip', { stack: 'it_sword001', to: 'ac_ren00001' }],
        ['inventory.unequip', { stack: 'it_dagg0001' }],
    ]);
    assert.equal(results[1].ok, true);
    const stacks = store.head().domains.inventory.stacks;
    assert.deepEqual([stacks.it_dagg0001.owner, stacks.it_dagg0001.equipped], ['ac_mira0001', null], 'taken off, still in Mira\'s pack');
    assert.equal(stacks.it_rope0001.owner, 'party', 'Give is gone: the Rope stays in the bag');
});

test('inventory: Equip on… for an unworn piece lists only the members who can wear it (items.canWear per member), and sends item.equip { stack, to }', { skip }, async () => {
    const module = core();
    const state = stocked(module);
    state.domains.party = { pc: null, order: ['ac_ren00001', 'ac_mira0001'], actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' }, ac_mira0001: { id: 'ac_mira0001', name: 'Mira' } } };
    const asked = [];
    const query = queries(module, state, {
        ...RPG_BATTLE,
        // Mira cannot wear this piece (say, too heavy for her); Ren can.
        'items.canWear': (s, args) => { asked.push(args.actor); return args.actor === 'ac_mira0001' ? { ok: false, why: 'too heavy for Mira' } : { ok: true }; },
    });
    const { el, view, calls } = show(inventoryScreen, { state, query, widgets: DETAIL_WIDGET, draft: {}, command: async () => ({ ok: true }) });
    assert.deepEqual(view.warnings, []);
    const folded = stack => (foldOf(el, stack)?.querySelectorAll('button:not(.fold-cancel)') ?? []).map(button => text(button));
    openFold(el, 'it_sword001', 'equipOn');
    assert.deepEqual(folded('it_sword001'), ['Ren'], 'only who can wear it');
    assert.ok(asked.includes('ac_ren00001') && asked.includes('ac_mira0001'), 'each member is asked');
    assert.equal(el.querySelector('[id="' + foldOf(el, 'it_sword001').getAttribute('id') + '"] .fold-q') !== null, true);
    foldOf(el, 'it_sword001').querySelector('button').click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload]), [['item.equip', { stack: 'it_sword001', to: 'ac_ren00001' }]]);
});

test('inventory without RPG Battle: the bag and purse only, no equipment controls, tags, condition or filter', { skip }, () => {
    const module = core();
    const state = stocked(module);
    state.domains.party = { pc: null, order: ['ac_ren00001'], actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    state.domains.inventory.stacks.it_dagg0001.owner = 'ac_ren00001';
    state.domains.inventory.stacks.it_dagg0001.equipped = 'hand';
    state.domains.inventory.stacks.it_dagg0001.cond = 40;
    const { el, view } = show(inventoryScreen, { state, query: queries(module, state) });
    assert.deepEqual(view.warnings, []);
    const dagger = el.querySelectorAll('.item').find(item => item.querySelector('.name').textContent === 'Dagger');
    assert.equal(dagger.querySelector('.worn-by'), null, 'no "Worn by" tag');
    assert.equal(dagger.querySelector('.cond'), null, 'no condition');
    assert.equal(dagger.querySelector('button[value="equipOn"]'), null, 'no Equip on…');
    assert.equal(dagger.querySelector('[data-command="inventory.unequip"]'), null, 'no Unequip');
    assert.equal(dagger.classList.contains('equipped'), false);
    assert.equal(el.querySelector('.filter .check'), null, 'no equipped-only filter');
    assert.equal(el.querySelector('option[value="equipment"]'), null, 'no equipment kind in the filter');
    assert.equal(dagger.querySelector('.give'), null, 'no Give: the party shares one bag');
    assert.ok(dagger.querySelector('button[value="drop"]'), 'Drop stays: it is bag management');
    assert.equal(text(dagger.querySelector('.owner')), 'Ren', 'who carries it is still said');
});

test('inventory: a piece the shared bag wears is "Worn by" the main character, or by "the party" with none', { skip }, () => {
    const module = core();
    const state = stocked(module);
    state.domains.party = { pc: 'ac_ren00001', order: ['ac_ren00001'], actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    state.domains.inventory.stacks.it_dagg0001.equipped = 'hand';
    const tagOf = () => {
        const { el, view } = show(inventoryScreen, { state, query: queries(module, state, RPG_BATTLE), widgets: DETAIL_WIDGET });
        assert.deepEqual(view.warnings, []);
        return text(el.querySelectorAll('.item').find(item => item.querySelector('.name').textContent === 'Dagger').querySelector('.worn-by'));
    };
    assert.equal(tagOf(), 'Worn by Ren');
    state.domains.party.pc = null;
    assert.equal(tagOf(), 'Worn by the party');
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

test('inventory: "To pick up" lists the loot not yet taken, newest first, each with its own picks and Take selected (cards off too)', { skip }, async () => {
    const module = core();
    const state = lootState(module);
    state.meta.claims['loot:sw_taken000001'] = true;
    state.domains.inventory.loot.sw_taken000001 = { sid: 'sw_taken000001', n: 9, where: '', claim: 'loot:sw_taken000001', items: { 0: { name: 'Gone Thing', qty: 1 } } };
    const store = fakeStore(state);
    const registry = Object.assign(fakeRegistry([module]), { featureOn: () => true });
    const bus = createCommandBus({ store, registry, id: counterIds(), seed: () => 11 });
    const { el, view, calls, results } = show(inventoryScreen, {
        state, query: queries(module, state), command: (type, payload, options) => bus.command(type, payload, options),
    });
    assert.deepEqual(view.warnings, []);
    const offers = el.querySelectorAll('.loot .offer');
    assert.deepEqual(offers.map(offer => text(offer.querySelector('.loot-head'))), ['Loot — on the cellar shelf', 'Loot'], 'newest first; a taken one is not listed');
    assert.deepEqual(offers[1].querySelectorAll('.pick').map(chip => text(chip)), ['Old Boot']);
    // Ticks in one offer are that offer's own.
    const boxes = offers[0].querySelectorAll('input[type="checkbox"]');
    boxes[2].checked = true;
    boxes[2].dispatch('change');
    const other = offers[1].querySelector('input[type="checkbox"]');
    other.checked = true;
    other.dispatch('change');
    offers[0].querySelector('.take').click();
    await settle();
    offers[1].querySelector('.take').click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload]), [
        ['inventory.lootTake', { sid: SID, pick: ['2'] }],
        ['inventory.lootTake', { sid: 'sw_older0000001', pick: ['0'] }],
    ]);
    assert.deepEqual(results.map(result => result.ok), [true, true]);
    const names = Object.values(store.head().domains.inventory.stacks).map(stack => store.head().domains.inventory.defs[stack.def].name);
    assert.ok(names.includes('Torn Map') && names.includes('Old Boot'));
    assert.deepEqual(queries(module, store.head())('inventory.loot'), [], 'both taken: nothing left to pick up');
});
