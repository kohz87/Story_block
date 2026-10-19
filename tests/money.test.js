// The purse in one sum (0.9.12): money rows in a list block, read in the reader's coins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CURRENCY, formatMoney, normalizeCurrency, parseMoney, parseTiersText, purseLine, purseOf, tiersText } from '../src/money.js';

const state = rows => ({ categories: [{ name: 'General', items: rows.map(([name, quantity, remark = '']) => ({ name, quantity, remark })) }] });

test('a purse kept under its own name, in three coins, is added up', () => {
    const inventory = state([
        ['Coin Pouch', '1', '1 Gold, 35 Silver, 14 Copper'],
        ['Guild Badge (F-Rank)', '1', 'Stamped lead token'],
        ['Wolf Bounty Voucher', '1', 'Stamped council slip for 1 gold'],
    ]);
    assert.deepEqual(purseOf(inventory, DEFAULT_CURRENCY), { total: 464, rows: [{ name: 'Coin Pouch', cell: 'note' }] }, 'a voucher worth gold is not money in hand');
    assert.equal(purseLine(inventory, DEFAULT_CURRENCY), 'Purse in all: 4 gold, 6 silver, 4 copper; nothing dearer can be paid for (the seller refuses, haggles or takes goods in trade).');
    assert.equal(purseOf(state([['Coins', '3 gold, 2 silver'], ['Purse', '1', '5 silver']]), DEFAULT_CURRENCY).total, 370, 'every purse counts');
    assert.equal(purseLine(state([['Rope', '1', 'coiled']]), DEFAULT_CURRENCY), '', 'no purse, no line');
    assert.equal(purseLine(inventory, { mode: 'off' }), '', 'off');
});

test('one coin, or coins of the reader\'s own', () => {
    const crowns = { mode: 'single', single: 'crowns' };
    assert.equal(purseOf(state([['Coins', '120'], ['Coin Pouch', '1', '50 crowns']]), crowns).total, 170);
    assert.equal(purseOf(state([['Coin Pouch', '1', 'empty']]), crowns), null, 'a pouch counted as one is no money');
    const own = parseTiersText('bits=1, marks=12, crowns=20');
    assert.equal(tiersText(own), 'bits=1, marks=12, crowns=20');
    assert.equal(parseMoney('2 crowns, 3 marks', own), 2 * 240 + 3 * 12);
    assert.equal(formatMoney(253, own), '1 crown, 1 mark, 1 bit');
    assert.equal(normalizeCurrency({ mode: 'off' }), null);
    assert.equal(parseTiersText(''), null);
});
