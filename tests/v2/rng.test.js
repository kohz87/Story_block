// Seeded randomness: sfc32 from a uint32 seed, crypto seeds, dice expressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSeed, rng, roll, seed } from '../../src/v2/rng.js';

test('rng: the same seed gives the same stream, floats in [0, 1)', () => {
    const a = rng(123456789);
    const b = rng(123456789);
    const first = Array.from({ length: 1000 }, a);
    assert.deepEqual(Array.from({ length: 1000 }, b), first);
    for (const value of first) assert.ok(value >= 0 && value < 1);
    assert.ok(new Set(first).size > 990, 'no short cycle');
});

test('rng: nearby seeds start far apart; the edges of uint32 work', () => {
    const one = Array.from({ length: 8 }, rng(1));
    const two = Array.from({ length: 8 }, rng(2));
    assert.notDeepEqual(one, two);
    assert.equal(one.filter((value, i) => Math.abs(value - two[i]) < 0.01).length < 3, true);
    assert.equal(typeof rng(0)(), 'number');
    assert.equal(typeof rng(0xFFFFFFFF)(), 'number');
});

test('rng: a known value pins the algorithm (a change would re-roll every saved receipt)', () => {
    // Recorded once from this implementation; receipts store seeds, so these must never move.
    assert.deepEqual(Array.from({ length: 3 }, rng(42)), [0.23955312534235418, 0.5859209857881069, 0.09323416277766228]);
    assert.equal(rng(0)(), 0.9791452463250607);
});

test('rng: refuses seeds that are not uint32', () => {
    for (const bad of [-1, 1.5, 2 ** 32, NaN, '7', null, undefined]) assert.throws(() => rng(bad), /seed/);
    assert.equal(isSeed(7), true);
    assert.equal(isSeed(-7), false);
});

test('seed: a uint32 from crypto.getRandomValues, or a plain error without it', () => {
    for (let i = 0; i < 20; i++) assert.ok(isSeed(seed()));
    const fake = { getRandomValues: array => { array[0] = 0xDEADBEEF; return array; } };
    assert.equal(seed(fake), 0xDEADBEEF);
    assert.throws(() => seed({}), /crypto/);
});

test('roll: NdM+K with bounds, defaults and negative bonuses', () => {
    const r = rng(7);
    const result = roll(r, '2d6+1');
    assert.equal(result.dice.length, 2);
    assert.equal(result.mod, 1);
    assert.equal(result.total, result.dice[0] + result.dice[1] + 1);
    assert.deepEqual(roll(rng(7), '2d6+1'), result, 'same seed, same roll');
    assert.equal(roll(r, 'd20').dice.length, 1);
    assert.equal(roll(r, ' 3 D 4 - 2 ').mod, -2);
    assert.deepEqual(roll(() => 0.999999, '1d1'), { total: 1, dice: [1], mod: 0 });
    assert.deepEqual(roll(() => 0, '3d6-3'), { total: 0, dice: [1, 1, 1], mod: -3 });
    for (let i = 0; i < 500; i++) {
        const die = roll(r, 'd6').dice[0];
        assert.ok(Number.isInteger(die) && die >= 1 && die <= 6);
    }
});

test('roll: every face comes up, about evenly', () => {
    const r = rng(99);
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 6000; i++) counts[roll(r, 'd6').total]++;
    for (let face = 1; face <= 6; face++) assert.ok(counts[face] > 850 && counts[face] < 1150, `face ${face}: ${counts[face]}`);
});

test('roll: refuses what is not a dice roll', () => {
    const r = rng(1);
    for (const bad of ['', 'banana', '2d', 'd', '0d6', '101d6', '1d0', '1d1001', '1d6+', '1d6*2', '1d6+2000000', null]) {
        assert.throws(() => roll(r, bad), Error, String(bad));
    }
    assert.throws(() => roll(null, '1d6'), /random source/);
});
