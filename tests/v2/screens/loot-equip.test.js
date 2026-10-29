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

// A take is a guarded block (inventory.js lootTakeGuard), which needs a reply to hold it: the fake store's one carrier,
// with the Source and occurrence the real store would give.
function withReply(store) {
    let next = 0;
    return Object.assign(store, {
        carrierSid: () => 'sw_reply0000001',
        sourceAt: () => ({ sid: 'sr_reply001', swipeKey: 'sw_reply001', evidence: 'ev_reply001', ordinal: next }),
        allocateOccurrence: () => next++,
        opsAt: () => [],
    });
}

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
    const store = withReply(fakeStore(state));
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

test('inventory: "To pick up" lists the loot not yet taken, newest first, each with its own picks and Take selected (cards off too)', { skip }, async () => {
    const module = core();
    const state = lootState(module);
    state.meta.claims['loot:sw_taken000001'] = true;
    state.domains.inventory.loot.sw_taken000001 = { sid: 'sw_taken000001', n: 9, where: '', claim: 'loot:sw_taken000001', items: { 0: { name: 'Gone Thing', qty: 1 } } };
    const store = withReply(fakeStore(state));
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
