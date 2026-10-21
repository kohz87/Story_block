// The core module on the real command bus (src/v2/commands.js): ops pass the generic checks,
// validators run, nothing is stored on a rejection, and capture runs through bus.run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandBus } from '../../../src/v2/commands.js';
import { counterIds, fakeRegistry, fakeStore } from '../helpers/bus-fakes.js';
import { initialState, line } from './helpers/fake-ctx.js';
import { core, stocked } from './fixtures.js';

function setup(extra = [], hookMap = {}) {
    const module = core(hookMap);
    const modules = [module, ...extra];
    const store = fakeStore(stocked(module));
    const bus = createCommandBus({ store, registry: fakeRegistry(modules), id: counterIds(), seed: () => 42 });
    return { module, store, bus };
}

test('story grant of a new item creates a def and a stack that pass the ops checks', () => {
    const { bus, store } = setup([], { 'item.define': [definition => ({ rarity: 'rare' })] });
    const result = bus.command('inventory.grant', { name: 'Moonveil Trout', note: 'violet' }, { cause: 'story' });
    assert.equal(result.ok, true, result.message);
    const inv = store.head().domains.inventory;
    assert.equal(inv.defs['story/moonveil-trout'].rarity, 'rare');
    const [id] = result.receipt.data.stacks;
    assert.equal(inv.stacks[id].from, result.receipt.id);
    assert.equal(result.receipt.module, 'story-block');
    assert.equal(result.receipt.narrate, false);
    const unicode = bus.command('inventory.grant', { name: '魔剣' }, { cause: 'story' });
    assert.equal(unicode.ok, true, unicode.message);
});

test('rejections store nothing', () => {
    const { bus, store } = setup();
    const before = store.head();
    for (const [type, payload, code] of [
        ['inventory.grant', { def: 'story/rope' }, 'REFUSED'],
        ['inventory.equip', { stack: 'it_rope0001' }, 'REFUSED'],
        ['wallet.pay', { amount: 1000 }, 'NOT_ENOUGH'],
        ['inventory.drop', { stack: 'it_nope0001' }, 'NOT_FOUND'],
    ]) {
        const result = bus.command(type, payload, { cause: 'ui' });
        assert.equal(result.ok, false, type);
        assert.equal(result.code, code, `${type}: ${result.message}`);
    }
    assert.equal(store.head(), before);
    assert.equal(store.appended.length, 0);
});

test('ui commands commit with a narrated receipt', () => {
    const { bus, store } = setup();
    const result = bus.command('inventory.equip', { stack: 'it_sword001' }, { cause: 'ui' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.receipt.narrate, true);
    assert.equal(result.receipt.summary, 'The party equips Iron Sword (hand).');
    assert.equal(store.head().domains.inventory.stacks.it_sword001.equipped, 'hand');
    assert.deepEqual(store.appended[0].ops.filter(op => op.path.startsWith('/domains')), [
        { op: 'replace', path: '/domains/inventory/stacks/it_sword001/equipped', value: 'hand' },
    ]);
});

test('capture lines run through bus.run and chain within one reply', () => {
    const { bus, module, store } = setup();
    const capture = { moduleId: module.id, apply: module.capture.apply };
    let state = store.head();
    state = { ...state, domains: { ...state.domains, inventory: { ...state.domains.inventory, wallets: { party: { coin: 0 } } } } };
    for (const change of [
        line('+', 'item', 'Moonveil Trout', { note: 'violet-streaked' }),
        line('+', 'coin', '38 gold', { from: 'the sealer' }),
        line('~', 'place', 'Bluewatch Village', { kind: 'settlement' }),
        line('+', 'present', 'Fenna'),
        line('-', 'item', 'Rope'),
    ]) {
        const result = bus.run(`${change.kind}.capture`, change, { cause: 'story', seed: 7, state, capture });
        assert.equal(result.ok, true, `${change.raw}: ${result.message}`);
        state = result.state;
    }
    assert.equal(state.domains.inventory.wallets.party.coin, 38);
    assert.equal(state.domains.scene.place.name, 'Bluewatch Village');
    assert.deepEqual(state.domains.scene.present, ['Fenna']);
    assert.equal(state.domains.inventory.stacks.it_rope0001.qty, 2);
    const bad = bus.run('item.capture', line('+', 'item', 'Torch', { qty: 'lots' }), { cause: 'story', state, capture });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /"lots" is not a quantity/);
});

test('another module reads the inventory and pays through ctx.call', () => {
    const shop = {
        id: 'rpg-battle',
        domains: {},
        commands: {
            'trade.fee'(ctx) {
                const owned = ctx.query('inventory.items', { owner: 'party' }).length;
                ctx.call('wallet.pay', { amount: 5, to: 'the guild' });
                return { summary: `Fee paid; ${owned} lots carried.` };
            },
        },
    };
    const { bus, store } = setup([shop]);
    const result = bus.command('trade.fee', {}, { cause: 'ui' });
    assert.equal(result.ok, true, result.message);
    assert.equal(store.head().domains.inventory.wallets.party.coin, 120);
    const broke = createCommandBus({ store: fakeStore(initialState([core()])), registry: fakeRegistry([core(), shop]), id: counterIds(), seed: () => 1 });
    assert.equal(broke.command('trade.fee', {}, { cause: 'ui' }).code, 'NOT_ENOUGH');
});

// Spec question: the bus's ctx says nothing about being inside ctx.call, so a click that buys an
// item (trade.buy → inventory.grant, cause 'ui') is refused until the bus sets `ctx.caller`.
test('a ui-caused grant through another module\'s ctx.call', { todo: 'needs ctx.caller from the bus' }, () => {
    const shop = { id: 'rpg-battle', domains: {}, commands: { 'trade.buy': ctx => ctx.call('inventory.grant', { def: 'story/rope' }) } };
    const { bus } = setup([shop]);
    const result = bus.command('trade.buy', {}, { cause: 'ui' });
    assert.equal(result.ok, true, result.message);
});
