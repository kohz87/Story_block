// The Ersveil pack's signature gear (content.items, docs/v2/ERSVEIL.md "Signature gear"): sixteen equipment items that pass the
// pack validator, with the slot, rarity and stats the owners' look text suggests, each inside its rarity's gear budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { GEAR, statsFor } from '../../../src/v2/domains/gear.js';

const text = readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8');
const pack = () => JSON.parse(text);

const EXPECTED = [
    ['Long Watch Great Axe', 'weapon', 'legendary', { STR: 2, VIT: 2 }],
    ['White-Fur Watch Cloak', 'cloak', 'rare', { VIT: 2 }],
    ['Carved Beacon-Horn', 'accessory', 'uncommon', { CHA: 1 }],
    ['Rain-Veil Hood', 'cloak', 'epic', { AGI: 2, LUK: 1 }],
    ["Cell-Runner's Knives", 'weapon', 'epic', { DEX: 2, AGI: 1 }],
    ['Rune-Collar Hammer', 'weapon', 'rare', { STR: 1, INT: 1 }],
    ['Iron Guard Plate', 'body', 'rare', { VIT: 2 }],
    ['Iron Guard Longsword', 'weapon', 'rare', { STR: 1, DEX: 1 }],
    ['Gold-Thread Hooded Cloak', 'cloak', 'rare', { CHA: 1, AGI: 1 }],
    ['Rune-Marked Dwarven War-Hammer', 'weapon', 'rare', { STR: 1, VIT: 1 }],
    ['Atlantean Breathing Sheath', 'accessory', 'rare', { VIT: 1, AGI: 1 }],
    ['Huge Spiked Iron Maul', 'weapon', 'uncommon', { STR: 1 }],
    ['Fang Charm', 'accessory', 'common', {}],
    ['Startrace Travelling Coat', 'body', 'uncommon', { INT: 1 }],
    ['Three Walnut Shells', 'accessory', 'uncommon', { LUK: 1 }],
    ['Flame-Cross Pendant', 'accessory', 'uncommon', { CHA: 1 }],
];

test('the pack lists the sixteen signature items, in order, as equipment', () => {
    const items = pack().content.items;
    assert.deepEqual(items.map(item => item.name), EXPECTED.map(row => row[0]));
    for (const item of items) {
        assert.equal(item.kind, 'equipment');
        assert.ok(item.note && item.note.length <= 500, `${item.name}: a short about line`);
        assert.ok(Number.isInteger(item.value) && item.value >= 0);
    }
});

test('each item has the slot, rarity and stats set down, inside its rarity budget and two stats at most', () => {
    const items = pack().content.items;
    for (const [index, [name, slot, rarity, stats]] of EXPECTED.entries()) {
        const item = items[index];
        assert.equal(item.slot, slot, `${name} slot`);
        assert.equal(item.rarity, rarity, `${name} rarity`);
        assert.deepEqual(item.stats, stats, `${name} stats`);
        assert.ok(GEAR.slots.includes(item.slot), `${name}: a slot gear knows`);
        assert.ok(Object.keys(item.stats).length <= GEAR.maxStats, `${name}: at most ${GEAR.maxStats} stats`);
        const total = Object.values(item.stats).reduce((sum, n) => sum + n, 0);
        assert.equal(total, GEAR.budget[rarity], `${name}: the stats use the whole ${rarity} budget`);
        assert.ok(Object.keys(item.stats).every(stat => GEAR.stats.includes(stat)), `${name}: known stats`);
        assert.deepEqual(statsFor({ ...item, id: `pack.ersveil/${item.slug}` }), stats, `${name}: gear keeps the stats whole`);
    }
});

test('values rise with rarity and the whole pack passes the pack validator with the items kept', () => {
    const items = pack().content.items;
    const rank = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    for (const a of items) for (const b of items) if (rank.indexOf(a.rarity) < rank.indexOf(b.rarity)) assert.ok(a.value < b.value, `${a.name} is worth less than ${b.name}`);
    const result = validatePack(pack());
    assert.equal(result.ok, true, JSON.stringify(result.errors ?? result.problems ?? result));
    assert.equal(result.pack.content.items.length, 16);
    assert.equal(new Set(items.map(item => item.slug)).size, 16);
});

test('each cast member lists their signature gear by slug, every piece is an item of the pack, and the renamed pieces keep slot, rarity and stats', () => {
    const p = pack();
    const gear = Object.fromEntries(p.content.cast.map(person => [person.id, person.gear]));
    assert.deepEqual(gear, {
        harrak: ['long-watch-great-axe', 'white-fur-watch-cloak', 'carved-beacon-horn'], hush: ['rain-veil-hood'], nysseth: ['cell-runners-knives'],
        ysmeth: ['rune-collar-hammer'], lothar: ['iron-guard-plate', 'iron-guard-longsword'], asphodel: ['gold-thread-hooded-cloak'],
        gorm: ['rune-marked-dwarven-war-hammer'], nerissa: ['atlantean-breathing-sheath'], torka: ['huge-spiked-iron-maul', 'fang-charm'],
        rika: ['startrace-travelling-coat'], barney: ['three-walnut-shells'], temiwa: ['flame-cross-pendant'],
    });
    const slugs = new Set(p.content.items.map(item => item.slug));
    for (const list of Object.values(gear)) for (const slug of list) assert.ok(slugs.has(slug), slug);
    const byName = Object.fromEntries(p.content.items.map(item => [item.name, item]));
    assert.deepEqual([byName['Rune-Marked Dwarven War-Hammer'].slot, byName['Rune-Marked Dwarven War-Hammer'].rarity, byName['Rune-Marked Dwarven War-Hammer'].stats], ['weapon', 'rare', { STR: 1, VIT: 1 }]);
    assert.deepEqual([byName['Huge Spiked Iron Maul'].slot, byName['Huge Spiked Iron Maul'].rarity, byName['Huge Spiked Iron Maul'].stats], ['weapon', 'uncommon', { STR: 1 }]);
    assert.equal(p.version, '2.6.1');
});
