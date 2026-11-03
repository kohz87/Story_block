// USER 3 Nov: "+ coin 3 silver 6 copper | from: Marrit" was refused and the pay lost. A coin line whose numbers each name
// a known coin adds them up in the smallest unit, live and on Re-read/rebuild alike; bare or unknown parts stay refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../../../src/v2/domains/money.js';

const COPPER = { name: 'copper', plural: 'copper', coins: [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }] };

test('mixed known coins add up; a thousands comma is still one number', () => {
    for (const [text, amount] of [['3 silver 6 copper', 36], ['3 silver, 6 copper', 36], ['3 silver and 6 copper', 36], ['1 gold 2 silver 3 copper', 123], ['1,200 copper 3 silver', 1230]]) {
        assert.deepEqual(parseAmount(text, COPPER), { amount }, text);
    }
});

test('anything not made only of known coins is refused, never guessed and never loops', () => {
    for (const text of ['30 5', '3 silver 6', '3 silver 6 copper 2 apples', '3 silver 0 copper', '3 silver 5 pennies']) {
        assert.match(parseAmount(text, COPPER).error, /more than one number/, text);
    }
});
