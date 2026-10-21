// The core module definition (§6): shape, queries, the static line and the tail view with its
// budget split (§5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_BUDGET, CORE_KINDS, CORE_MODULE_ID, CORE_STATIC, createCoreModule, createCorePart } from '../../../src/v2/domains/index.js';
import { createHarness, initialState, line } from './helpers/fake-ctx.js';
import { COINS, CURRENCY, core, def, stack, stocked } from './fixtures.js';

const view = state => ({ state, query: () => null, settings: {}, chat: { length: 1, lastUser: '' } });

test('the definition has the §6 shape', () => {
    const module = createCoreModule();
    assert.equal(module.id, CORE_MODULE_ID);
    assert.deepEqual(Object.keys(module.domains), ['scene', 'inventory']);
    assert.deepEqual(Object.keys(module.commands).sort(), [
        'inventory.consume', 'inventory.drop', 'inventory.equip', 'inventory.grant', 'inventory.merge', 'inventory.split',
        'inventory.transfer', 'inventory.unequip', 'scene.place', 'scene.present', 'wallet.pay', 'wallet.receive',
    ]);
    assert.deepEqual(Object.keys(module.queries).sort(), ['inventory.currency', 'inventory.find', 'inventory.items', 'inventory.wallet', 'scene.place', 'scene.present']);
    assert.deepEqual(Object.keys(module.capture.kinds), ['item', 'coin', 'place', 'present']);
    for (const kind of Object.values(CORE_KINDS)) assert.ok(kind.grammar && !kind.grammar.includes('\n'));
    assert.equal(module.context.budget, CORE_BUDGET);
    assert.deepEqual(module.tabs.map(tab => tab.id), ['inventory', 'scene']);
    assert.doesNotThrow(() => JSON.stringify(initialState([module])));
    assert.doesNotThrow(() => createCoreModule({ hooks: () => 'not a list' }).context.tail(view(initialState([module]))));
});

test('static() is byte-identical whatever the state', () => {
    const module = core({ currency: [() => CURRENCY] });
    const a = module.context.static();
    const h = createHarness([module], { state: stocked(module) });
    h.capture(line('+', 'item', 'Moonveil Trout'));
    assert.equal(module.context.static(), a);
    assert.equal(a, CORE_STATIC);
    assert.ok(!/\d/.test(a), 'no numbers');
});

test('scene commands', () => {
    const module = core();
    const h = createHarness([module]);
    const placed = h.run('scene.place', { name: 'Bluewatch', kind: 'settlement' });
    assert.equal(placed.ok, true, placed.message);
    assert.equal(placed.result.narrate, true);
    const present = h.run('scene.present', { add: ['Fenna', 'Tam'], remove: [] });
    assert.deepEqual(present.result.data.present, ['Fenna', 'Tam']);
    const both = h.run('scene.present', { add: 'Ivo', remove: 'Tam' });
    assert.equal(both.result.summary, 'Ivo is here; Tam leaves.');
    const none = h.run('scene.present', {});
    assert.equal(none.result.narrate, false);
    for (const [type, payload, code] of [
        ['scene.place', {}, 'INVALID'], ['scene.place', { name: 5 }, 'INVALID'], ['scene.place', { name: 'A', kind: 3 }, 'INVALID'],
        ['scene.present', { remove: 'Nobody' }, 'NOT_FOUND'], ['scene.present', { add: [''] }, 'INVALID'],
        ['scene.present', { add: ['x'.repeat(81)] }, 'INVALID'], ['scene.present', { remove: [3] }, 'INVALID'],
    ]) {
        const before = h.state;
        assert.equal(h.run(type, payload).code, code, `${type} ${JSON.stringify(payload)}`);
        assert.equal(h.state, before);
    }
});

test('queries return plain copies', () => {
    const module = core();
    const state = stocked(module);
    state.domains.scene = { place: { name: 'Bluewatch', kind: '', region: '' }, present: ['Fenna'] };
    const h = createHarness([module], { state });
    const items = h.query('inventory.items', {});
    assert.equal(items.length, 6);
    assert.deepEqual(items.map(item => item.stack), ['it_dagg0001', 'it_sword001', 'it_pota0001', 'it_potb0001', 'it_lant0001', 'it_rope0001'],
        'equipment before consumables and goods; then by name');
    assert.deepEqual(items[1], {
        stack: 'it_sword001', def: 'pack.fantasy/iron-sword', name: 'Iron Sword', kind: 'equipment', rarity: 'uncommon', value: 50,
        slot: 'hand', qty: 1, owner: 'party', equipped: null, note: '', from: '',
    });
    assert.deepEqual(h.query('inventory.items', { owner: 'ac_ren00001' }), []);
    assert.deepEqual(h.query('inventory.wallet', {}), { coin: 125 });
    assert.deepEqual(h.query('inventory.wallet', { owner: 'ac_ren00001' }), {});
    const found = h.query('inventory.find', { name: 'minor healing draughts' });
    assert.equal(found.status, 'found');
    assert.equal(found.defs[0].id, 'pack.fantasy/potion');
    assert.deepEqual(found.stacks.map(item => item.stack), ['it_pota0001', 'it_potb0001']);
    assert.deepEqual(h.query('inventory.find', { name: 'Golden Idol' }), { status: 'none', defs: [], stacks: [] });
    const place = h.query('scene.place');
    place.name = 'changed';
    assert.equal(h.state.domains.scene.place.name, 'Bluewatch', 'a copy, not the state');
    assert.deepEqual(h.query('scene.present'), ['Fenna']);
    assert.deepEqual(module.queries['scene.place'](undefined), { name: '', kind: '', region: '' });
    assert.deepEqual(h.query('inventory.currency'), { tiers: [{ name: 'coin', rate: 1, worth: 1 }], single: 'coin' });
    const tiered = core({ currency: [() => CURRENCY] });
    assert.deepEqual(tiered.queries['inventory.currency'](state, {}), {
        tiers: [{ name: 'copper', rate: 1, worth: 1 }, { name: 'silver', rate: 10, worth: 10 }, { name: 'gold', rate: 10, worth: 100 }],
        single: 'coins',
    });
});

test('a handler can use the core queries through ctx.query, drafts included', () => {
    const module = core();
    const reader = {
        id: 'reader',
        domains: {},
        commands: {
            'x.count'(ctx) {
                ctx.call('inventory.drop', { stack: 'it_rope0001' });
                return { summary: '', data: { lots: ctx.query('inventory.items', {}).length, wallet: ctx.query('inventory.wallet', {}) } };
            },
        },
    };
    const h = createHarness([module, reader], { state: stocked(module) });
    assert.deepEqual(h.run('x.count', {}).result.data, { lots: 5, wallet: { coin: 125 } });
});

test('createCorePart gives the same pieces in the MODULES.md part shape', () => {
    const part = createCorePart({ hooks: () => [] });
    const module = createCoreModule();
    assert.deepEqual(Object.keys(part.kinds), Object.keys(module.capture.kinds));
    for (const [name, kind] of Object.entries(part.kinds)) {
        assert.equal(kind.grammar, CORE_KINDS[name].grammar);
        assert.equal(typeof kind.apply, 'function');
    }
    assert.deepEqual(Object.keys(part.commands), Object.keys(module.commands));
    assert.deepEqual(Object.keys(part.queries), Object.keys(module.queries));
    assert.equal(part.context.budget, CORE_BUDGET);
});

test('tail: place, present, equipped, wallet and carried items with notes trimmed', () => {
    const module = core({ currency: [() => CURRENCY] });
    const state = stocked(module);
    state.domains.scene = { place: { name: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshire' }, present: ['Fenna', 'Old Tam'] };
    const inv = state.domains.inventory;
    inv.wallets = { party: { coin: 38 }, ac_ren00001: { coin: 5 }, ac_zed00001: { coin: 0 } };
    inv.stacks.it_sword001.equipped = 'hand';
    inv.stacks.it_dagg0001.owner = 'ac_ren00001';
    inv.stacks.it_dagg0001.equipped = 'hand';
    inv.stacks.it_rope0001.note = 'tarred hemp, sixty feet, knotted every yard for climbing the well';
    state.domains.party = { actors: { ac_ren00001: { name: 'Ren' } } };
    const tail = module.context.tail(view(state));
    assert.deepEqual(tail, {
        lines: [
            'Place: Bluewatch Village (settlement, Lakeshire)',
            'Present: Fenna, Old Tam',
            'Equipped: Iron Sword [hand]',
            'Equipped (Ren): Dagger [hand]',
            'Wallet: 3 silver, 8 copper; Ren 5 copper',
            'Carried: Minor Healing Draught ×2, Minor Healing Draught (cloudy), Lantern, Rope ×3 (tarred hemp, sixty feet, knotted every…)',
        ],
        optional: [],
    });
});

test('tail: an empty start says so', () => {
    const module = core();
    assert.deepEqual(module.context.tail(view(initialState([module]))), { lines: ['Wallet: 0 coin', 'Carried: nothing'], optional: [] });
});

test('tail: a long inventory overflows into optional, then into a count, within the budget', () => {
    const module = core();
    const state = initialState([module]);
    const inv = state.domains.inventory;
    for (let i = 0; i < 120; i += 1) {
        const id = `story/trinket-${String(i).padStart(3, '0')}`;
        inv.defs[id] = def(id, `Trinket ${String(i).padStart(3, '0')}`);
        const sid = `it_t${String(i).padStart(7, '0')}`;
        inv.stacks[sid] = stack(sid, id, 1 + (i % 3), { note: i % 2 ? 'a little chipped at one corner' : '' });
    }
    const tail = module.context.tail(view(state));
    const size = list => list.reduce((sum, item) => sum + item.length + 1, 0);
    assert.ok(size(tail.lines) <= CORE_BUDGET * 2, `required part ${size(tail.lines)} chars`);
    assert.ok(size(tail.optional) <= CORE_BUDGET * 2 + 40, `optional part ${size(tail.optional)} chars`);
    assert.ok(tail.lines.every(item => item.length <= 200) && tail.optional.every(item => item.length <= 200));
    assert.match(tail.lines[1], /^Carried: Trinket 000, Trinket 001 ×2 \(a little chipped/);
    assert.match(tail.optional[0], /^Also carried: /);
    assert.match(tail.optional.at(-1), /^…and \d+ more items\.$/);
    // Every trinket is either listed once or counted.
    const listed = [...tail.lines, ...tail.optional].join(' ').match(/Trinket \d{3}/g).length;
    const counted = Number(tail.optional.at(-1).match(/\d+/)[0]);
    assert.equal(listed + counted, 120);
});
