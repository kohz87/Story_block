// "Use on…" on the Inventory screen (beta.1 live test: "use item is missing"): a consumable's row offers
// the members a module says a dose would help now (`items.useOn`, RPG Battle's rule; none while a fight
// has the party), and each runs `item.use { stack, target }`. Bag management (rule 6), like Equip on… and
// Give…. Without a module answering `items.useOn` (Story Block alone) there is no picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentView } from '../../../src/v2/domains/inventory.js';
import { inventoryScreen } from '../../../src/v2/screens/index.js';
import { core, queries, renderSkip, settle, show, stocked, text } from './helpers.js';

const REN = 'ac_ren00001';
const MIRA = 'ac_mira0001';

function partyState(module) {
    const state = stocked(module);
    state.domains.party = { pc: REN, order: [REN, MIRA], actors: { [REN]: { id: REN, name: 'Ren' }, [MIRA]: { id: MIRA, name: 'Mira' } } };
    return state;
}

test('inventory.equipment users: only consumables, only members, only what the module names; {} without it', () => {
    const module = core();
    const state = partyState(module);
    const ask = extra => equipmentView(state, { query: queries(module, state, extra) });
    assert.deepEqual(ask({}).users, {}, 'Story Block alone: no Use on…');
    const users = ask({
        'items.useOn': () => ({
            it_pota0001: [{ id: MIRA }, { id: REN }, { id: 'ac_gone0001' }, MIRA],
            it_potb0001: [],
            it_rope0001: [{ id: REN }],
            it_nope0001: [{ id: REN }],
        }),
    }).users;
    assert.deepEqual(users, { it_pota0001: [{ id: MIRA, name: 'Mira' }, { id: REN, name: 'Ren' }] }, 'a stranger, a duplicate, rope and a gone stack are left out');
    assert.deepEqual(ask({ 'items.useOn': () => { throw new Error('broken'); } }).users, {}, 'a module that fails: no picker');
    assert.deepEqual(ask({ 'items.useOn': () => ['x'] }).users, {}, 'not a record: no picker');
});

test('inventory: a consumable row has Use on… with the members it would help; a click sends item.use', { skip: renderSkip }, async () => {
    const module = core();
    const state = partyState(module);
    const { el, view, calls } = show(inventoryScreen, {
        state,
        query: queries(module, state, { 'items.useOn': () => ({ it_pota0001: [{ id: MIRA }], it_potb0001: [{ id: REN }, { id: MIRA }] }) }),
        command: async () => ({ ok: true, receipt: { summary: 'done' } }),
    });
    assert.deepEqual(view.warnings, []);
    const rows = el.querySelectorAll('.item').filter(item => item.querySelector('.name').textContent === 'Minor Healing Draught');
    assert.equal(rows.length, 2);
    const choices = row => row.querySelectorAll('.use-on .choices button').map(button => text(button));
    assert.deepEqual(rows.map(choices), [['Mira'], ['Ren', 'Mira']]);
    assert.equal(text(rows[0].querySelector('.use-on summary')), 'Use on…');
    const rope = el.querySelectorAll('.item').find(item => item.querySelector('.name').textContent === 'Rope');
    assert.equal(rope.querySelectorAll('.use-on').length, 0, 'not a consumable');
    rows[1].querySelectorAll('.use-on .choices button')[1].click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload]), [['item.use', { stack: 'it_potb0001', target: MIRA }]]);
});

test('inventory: no Use on… without a module answering items.useOn', { skip: renderSkip }, () => {
    const module = core();
    const state = partyState(module);
    const { el, view } = show(inventoryScreen, { state, query: queries(module, state) });
    assert.deepEqual(view.warnings, []);
    assert.equal(el.querySelectorAll('.use-on').length, 0);
});
