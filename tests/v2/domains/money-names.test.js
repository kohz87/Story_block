// Coins (currency hook, amounts) and item names (aliases, plurals, slugs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COINS, currencyFrom, formatAmount, formatWallet, normalizeCoins, parseAmount } from '../../../src/v2/domains/money.js';
import { aliasKey, cleanName, nameForms, resolveDef, slugify, trimText } from '../../../src/v2/domains/names.js';
import { COINS } from './fixtures.js';

test('currency: default, hook arrays, v1 tiers, unusable answers skipped', () => {
    assert.deepEqual(currencyFrom([]), DEFAULT_COINS);
    assert.deepEqual(currencyFrom([() => null, () => { throw new Error('broken'); }, () => COINS]), COINS);
    assert.deepEqual(currencyFrom([() => [{ name: 'silver', rate: 10 }]]), DEFAULT_COINS, 'no coin worth 1: unusable');
    assert.deepEqual(normalizeCoins([{ name: 'gold', rate: 100 }, { name: 'copper', rate: 1 }, { name: 'Copper', rate: 5 }, { name: '', rate: 2 }]),
        [{ name: 'copper', rate: 1 }, { name: 'gold', rate: 100 }]);
    assert.deepEqual(normalizeCoins({ mode: 'tiers', tiers: [{ name: 'copper', rate: 1 }, { name: 'silver', rate: 10 }, { name: 'gold', rate: 10 }] }), COINS);
    assert.equal(normalizeCoins({ mode: 'off', tiers: [] }), null);
    assert.equal(normalizeCoins('coins'), null);
});

test('parseAmount', () => {
    const cases = [
        ['3 silver, 8 copper', 38], ['3 silver and 8 copper', 38], ['1 gold 2 silver', 120], ['1g 5s', 150],
        ['5gp', 500], ['2 silver coins', 20], ['30', 30], ['12 coins', 12], ['1,000 copper', 1000], ['1 Gold + 1 Copper', 101],
    ];
    for (const [text, amount] of cases) assert.deepEqual(parseAmount(text, COINS), { amount }, text);
    assert.deepEqual(parseAmount('3', DEFAULT_COINS), { amount: 3 });
    assert.deepEqual(parseAmount('3 coin', DEFAULT_COINS), { amount: 3 });
    assert.match(parseAmount('3 zorkmids', COINS).error, /no coin called "zorkmids"/);
    assert.match(parseAmount('', COINS).error, /No amount/);
    assert.match(parseAmount('a handful', COINS).error, /not an amount/);
    assert.match(parseAmount('0 gold', COINS).error, /more than nothing/);
});

test('formatAmount and formatWallet', () => {
    assert.equal(formatAmount(386, COINS), '3 gold, 8 silver, 6 copper');
    assert.equal(formatAmount(0, COINS), '0 copper');
    assert.equal(formatAmount(40, COINS), '4 silver');
    assert.equal(formatAmount(7, DEFAULT_COINS), '7 coin');
    assert.equal(formatWallet(undefined, COINS), '0 copper');
    assert.equal(formatWallet({ copper: 12, gems: 2, shells: 0 }, COINS), '1 silver, 2 copper, 2 gems');
});

test('names: clean, alias key, forms', () => {
    assert.equal(cleanName('  the   Old  Rope '), 'Old Rope');
    assert.equal(aliasKey('A Moonveil Trout'), 'moonveil trout');
    assert.ok(nameForms('Ropes').includes('rope'));
    assert.ok(nameForms('Berries').includes('berry'));
    assert.ok(nameForms('Box').includes('boxes'));
    assert.ok(nameForms('Boxes').includes('box'));
    assert.ok(nameForms('Flasks of Oil').includes('flask of oil'));
    assert.ok(nameForms('Healing Potion').includes('healing potions'));
    assert.ok(!nameForms('Glass').includes('glas'), 'a word ending in ss is not a plural');
    assert.deepEqual(nameForms(''), []);
});

test('resolveDef', () => {
    const inventory = {
        defs: { 'story/rope': { id: 'story/rope', name: 'Rope' }, 'story/oil': { id: 'story/oil', name: 'Flask of Oil' } },
        aliases: { rope: 'story/rope', 'lamp oil': 'story/oil', ghost: 'story/ghost' },
    };
    assert.deepEqual(resolveDef(inventory, 'ROPES'), { status: 'found', id: 'story/rope', ids: ['story/rope'] });
    assert.equal(resolveDef(inventory, 'Lamp Oil').id, 'story/oil');
    assert.equal(resolveDef(inventory, 'flasks of oil').id, 'story/oil', 'a def name with no alias still resolves');
    assert.equal(resolveDef(inventory, 'ghost').status, 'none', 'an alias to a missing def is ignored');
    assert.equal(resolveDef(inventory, '').status, 'none');
    assert.equal(resolveDef(undefined, 'Rope').status, 'none');
});

test('slugify and trimText', () => {
    assert.equal(slugify('Moonveil Trout'), 'moonveil-trout');
    assert.equal(slugify("Jarl's Crème Brûlée!"), 'jarl-s-creme-brulee');
    assert.equal(slugify('魔剣 ムラマサ'), '魔剣-ムラマサ');
    assert.equal(slugify('!!!'), 'item');
    assert.ok(slugify('x'.repeat(80)).length <= 48);
    assert.equal(trimText('a  very long note', 8), 'a very…');
    assert.equal(trimText('short', 8), 'short');
});
