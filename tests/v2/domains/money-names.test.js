// Money (one currency, amounts) and item names (aliases, plurals, slugs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CURRENCY, currencyOf, formatAmount, formatWallet, parseAmount } from '../../../src/v2/domains/money.js';
import { aliasKey, cleanName, nameForms, resolveDef, slugify, trimText } from '../../../src/v2/domains/names.js';
import { DEF_ID } from '../../../src/v2/check.js';

test('currency: one name from settings, default gold', () => {
    assert.deepEqual(currencyOf(undefined), DEFAULT_CURRENCY);
    assert.deepEqual(currencyOf({}), { name: 'gold', short: 'g' });
    assert.deepEqual(currencyOf({ currency: '  Gil ' }), { name: 'Gil', short: 'g' });
    assert.deepEqual(currencyOf({ currency: 'crowns', currencyShort: 'cr' }), { name: 'crowns', short: 'cr' });
    assert.deepEqual(currencyOf({ currency: '   ' }), DEFAULT_CURRENCY);
    assert.equal(currencyOf({ currency: 'x'.repeat(40) }).name.length, 24);
});

test('parseAmount: only the number counts', () => {
    const cases = [['30', 30], ['30 gold', 30], ['30 coins', 30], ['3 silver', 3], ['1,200 crowns', 1200], ['about 12.', 12], ['5gp', 5]];
    for (const [text, amount] of cases) assert.deepEqual(parseAmount(text), { amount }, text);
    assert.match(parseAmount('3 silver, 8 copper').error, /more than one number/);
    assert.match(parseAmount('').error, /No amount/);
    assert.match(parseAmount('a handful').error, /No amount/);
    assert.match(parseAmount('0 gold').error, /more than nothing/);
    assert.match(parseAmount('2.5 gold').error, /not a whole amount/);
});

test('formatAmount and formatWallet', () => {
    assert.equal(formatAmount(386), '386 gold');
    assert.equal(formatAmount(0, { name: 'Gil', short: 'g' }), '0 Gil');
    assert.equal(formatWallet(undefined), '0 gold');
    assert.equal(formatWallet({ coin: 12 }, { name: 'crowns', short: 'cr' }), '12 crowns');
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
    assert.match(slugify('魔剣 ムラマサ'), /^item-[0-9a-z]+$/);
    assert.equal(slugify('魔剣 ムラマサ'), slugify('魔剣 ムラマサ'), 'stable');
    assert.notEqual(slugify('魔剣'), slugify('ムラマサ'));
    assert.equal(slugify('Jarl 魔剣'), 'jarl');
    for (const name of ['Moonveil Trout', '魔剣', 'Crème', 'A--B', '_x_', 'Rope 2']) assert.match(`story/${slugify(name)}`, DEF_ID, name);
    assert.ok(slugify('x'.repeat(80)).length <= 48);
    assert.equal(trimText('a  very long note', 8), 'a very…');
    assert.equal(trimText('short', 8), 'short');
});
