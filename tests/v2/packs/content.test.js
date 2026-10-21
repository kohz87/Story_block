// Lookups over enabled packs: item resolution precedence, content by kind, start states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStart, contentOf, itemDef, mergeStart, resolveItemIn } from '../../../src/v2/packs/content.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { itemsPack, pack, sample } from './helpers/fixtures.js';

const normalized = (...packs) => packs.map(input => {
    const result = validatePack(input);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
});

test('a resolved item is an inventory def (SPEC §7) and a fresh copy', () => {
    const [riverside] = normalized(sample());
    const def = resolveItemIn([riverside], 'Minor Healing Draught');
    assert.deepEqual(def, {
        id: 'pack.riverside-starter/minor-healing-draught', name: 'Minor Healing Draught', kind: 'consumable', rarity: 'common',
        value: 60, stack: true, slot: null, stats: {}, effect: { heal: 20 }, tags: [], note: '',
    });
    def.effect.heal = 999;
    assert.equal(resolveItemIn([riverside], 'Minor Healing Draught').effect.heal, 20);
    assert.deepEqual(Object.keys(itemDef(riverside.content.items[0])), ['id', 'name', 'kind', 'rarity', 'value', 'stack', 'slot', 'stats', 'effect', 'tags', 'note']);
});

test('item resolution precedence', () => {
    const packs = normalized(
        itemsPack('alpha', [{ name: 'Rope', value: 3 }, { name: 'Lantern Oil', slug: 'oil' }]),
        itemsPack('beta', [{ name: 'Rope', value: 9 }, { name: 'Coil', aliases: ['hemp rope'] }, { name: 'Iron Sword' }, { name: 'Lamp Oil', slug: 'lamp-oil', aliases: ['oil'] }]),
    );
    const id = name => resolveItemIn(packs, name)?.id ?? null;
    assert.equal(id('Rope'), 'pack.alpha/rope', 'the earlier pack wins a shared name');
    assert.equal(id('  ROPE '), 'pack.alpha/rope', 'case and spaces do not matter');
    assert.equal(id('Ｒope'), 'pack.alpha/rope', 'nor full-width letters');
    assert.equal(id('pack.beta/rope'), 'pack.beta/rope', 'a full ID names exactly that item');
    assert.equal(id('pack.gamma/rope'), null);
    assert.equal(id('hemp rope'), 'pack.beta/coil', 'an alias');
    assert.equal(id('oil'), 'pack.beta/lamp-oil', 'a name or alias beats an earlier pack\'s slug');
    assert.equal(id('Iron-Sword!'), 'pack.beta/iron-sword', 'the slug as a last resort');
    assert.equal(id('Lantern-Oil'), null, 'the slug is the item\'s slug, not its name\'s');
    assert.equal(id('Moonveil Trout'), null);
    assert.equal(id(''), null);
    assert.equal(id('???'), null);
    assert.equal(id(undefined), null);
    assert.equal(resolveItemIn([], 'Rope'), null);
});

test('content by kind, in pack order, with full IDs', () => {
    const packs = normalized(sample(), pack({ id: 'extra', content: { creatures: [{ name: 'Mire Toad', tier: 'even' }], quests: [{ name: 'Granary Rats', giver: 'Hollis' }] }, layouts: [{ id: 'board' }], theme: { '--ss-accent': '#000' }, screens: [{ id: 'rpg-battle/party', template: '<div>{{ q.pc.name }}</div>' }] }));
    assert.deepEqual(contentOf(packs, 'creatures').map(record => [record.id, record.pack]), [['pack.riverside-starter/weir-rat', 'riverside-starter'], ['pack.extra/mire-toad', 'extra']]);
    assert.deepEqual(contentOf(packs, 'creatures', { pack: 'extra' }).map(record => record.name), ['Mire Toad']);
    assert.deepEqual(contentOf(packs, 'quests'), [{ name: 'Granary Rats', giver: 'Hollis', id: 'pack.extra/granary-rats', slug: 'granary-rats', pack: 'extra' }]);
    assert.equal(contentOf(packs, 'shops')[0].stock.length, 3);
    assert.equal(contentOf(packs, 'recipes')[0].makes, 'pack.riverside-starter/willow-rod');
    assert.deepEqual(contentOf(packs, 'events').map(event => event.id), ['pack.riverside-starter/market-day', 'pack.riverside-starter/rat-trouble']);
    assert.deepEqual(contentOf(packs, 'layouts'), [{ id: 'board', pack: 'extra' }]);
    assert.deepEqual(contentOf(packs, 'theme'), [{ pack: 'riverside-starter', tokens: { '--ss-accent': '#3f7f8f' } }, { pack: 'extra', tokens: { '--ss-accent': '#000' } }]);
    assert.deepEqual(contentOf(packs, 'screens'), [{ id: 'rpg-battle/party', template: '<div>{{ q.pc.name }}</div>', theme: {}, pack: 'extra' }]);
    assert.deepEqual(contentOf(packs, 'spells'), []);
    contentOf(packs, 'creatures')[0].name = 'Changed';
    assert.equal(contentOf(packs, 'creatures')[0].name, 'Weir Rat', 'callers get copies');
});

test('start states merge in pack order', () => {
    const items = [{ name: 'Rope' }, { name: 'Torch' }];
    const packs = normalized(
        pack({ id: 'a', content: { items }, start: { scene: { place: { name: 'Bluewatch', kind: 'settlement' }, present: ['Hollis', 'Fenna'] }, inventory: { items: ['rope', { item: 'torch', qty: 2, note: 'oiled' }], money: 50 } } }),
        pack({ id: 'b', content: { items: [{ name: 'Rope' }] }, start: { scene: { place: { name: 'Elsewhere' }, present: ['fenna', 'Bram'] }, inventory: { items: [{ item: 'rope', qty: 2 }, { item: 'pack.a/rope', qty: 3 }, { item: 'pack.a/torch' }, { item: 'pack.gone/lamp' }], money: 27 } } }),
        pack({ id: 'quiet', content: { items } }),
    );
    const start = mergeStart(packs);
    assert.deepEqual(start.scene, { place: { name: 'Bluewatch', kind: 'settlement', region: '' }, present: ['Hollis', 'Fenna', 'Bram'] });
    assert.deepEqual(start.inventory.items.map(line => [line.def.id, line.qty, line.note]), [
        ['pack.a/rope', 4, ''], ['pack.a/torch', 2, 'oiled'], ['pack.b/rope', 2, ''], ['pack.a/torch', 1, ''],
    ], 'same def and note add up; other notes stay separate lines');
    assert.equal(start.inventory.money, 77);
    assert.deepEqual(start.packs, ['a', 'b']);
    assert.equal(start.problems.length, 1);
    assert.match(start.problems[0], /pack\.gone\/lamp/);
    assert.deepEqual(mergeStart([]), { scene: { place: null, present: [] }, inventory: { items: [], money: 0 }, packs: [], problems: [] });
    // Without pack a, its items are not there to give.
    const later = mergeStart(packs.slice(1));
    assert.deepEqual(later.inventory.items.map(line => line.def.id), ['pack.b/rope']);
    assert.equal(later.problems.length, 3);
    assert.equal(later.scene.place.name, 'Elsewhere');
});

test('the sample pack\'s start', () => {
    const start = mergeStart(normalized(sample()));
    assert.deepEqual(start.scene, { place: { name: 'Bluewatch Village', kind: 'settlement', region: 'the Lowmere' }, present: ['Hollis'] });
    assert.deepEqual(start.inventory.items.map(line => [line.def.name, line.qty]), [['Willow Rod', 1], ['Hemp Line', 3], ['Minor Healing Draught', 1]]);
    assert.deepEqual(start.inventory.items[2].aliases, ['healing draught']);
    assert.equal(start.inventory.money, 50);
    assert.equal(start.inventory.items[0].def.stack, false, 'equipment does not stack');
});

test('applyStart writes the merged start into an initial state', () => {
    const packs = normalized(pack({ id: 'a', content: { items: [{ name: 'Rope', aliases: ['cord'] }, { name: 'Torch', stack: false }] }, start: { scene: { place: { name: 'Bluewatch' }, present: ['Hollis'] }, inventory: { items: [{ item: 'rope', qty: 3 }, { item: 'torch', qty: 2 }], money: 5 } } }));
    const initial = {
        v: 2, meta: { rev: 0, claims: {} },
        domains: {
            scene: { place: { name: '', kind: '', region: '' }, present: ['hollis'] },
            inventory: { defs: {}, stacks: {}, wallets: { party: { copper: 1 } }, aliases: { cord: 'story/cord' } },
            party: { actors: {} },
        },
    };
    let n = 0;
    const id = prefix => `${prefix}_${String(++n).padStart(8, '0')}`;
    const next = applyStart(initial, mergeStart(packs), { id, coin: 'copper' });
    assert.notEqual(next, initial);
    assert.equal(initial.domains.inventory.defs['pack.a/rope'], undefined, 'the input is not changed');
    assert.deepEqual(next.domains.scene, { place: { name: 'Bluewatch', kind: '', region: '' }, present: ['hollis'] });
    assert.deepEqual(Object.keys(next.domains.inventory.defs), ['pack.a/rope', 'pack.a/torch']);
    assert.deepEqual(next.domains.inventory.aliases, { cord: 'story/cord', rope: 'pack.a/rope', torch: 'pack.a/torch' }, 'a taken alias is kept');
    assert.deepEqual(Object.values(next.domains.inventory.stacks), [
        { id: 'it_00000001', def: 'pack.a/rope', qty: 3, owner: 'party', equipped: null, note: '', from: '' },
        { id: 'it_00000002', def: 'pack.a/torch', qty: 1, owner: 'party', equipped: null, note: '', from: '' },
        { id: 'it_00000003', def: 'pack.a/torch', qty: 1, owner: 'party', equipped: null, note: '', from: '' },
    ], 'an item that does not stack gets one stack each');
    assert.deepEqual(next.domains.inventory.wallets, { party: { copper: 6 } });
    assert.deepEqual(applyStart(initial, mergeStart(packs), { id }).domains.inventory.wallets.party, { copper: 1, coin: 5 }, 'the default coin');
    assert.deepEqual(next.domains.party, { actors: {} });
    assert.throws(() => applyStart(initial, mergeStart(packs)), /id\(prefix\)/);
});

test('applyStart keeps a place already set and skips missing slices', () => {
    const packs = normalized(pack({ id: 'a', content: { items: [{ name: 'Rope' }] }, start: { scene: { place: { name: 'Bluewatch' } }, inventory: { items: ['rope'] } } }));
    const placed = { v: 2, meta: { rev: 0, claims: {} }, domains: { scene: { place: { name: 'Harbor', kind: '', region: '' }, present: [] } } };
    const next = applyStart(placed, mergeStart(packs), { id: () => 'it_x' });
    assert.deepEqual(next, placed);
    const empty = applyStart({ v: 2, meta: { rev: 0, claims: {} }, domains: { inventory: {} } }, mergeStart(normalized(pack())), { id: () => 'it_x' });
    assert.deepEqual(empty.domains.inventory, { defs: {}, stacks: {}, wallets: {}, aliases: {} }, 'no wallet for no coins');
});
