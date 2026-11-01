// The Standard stat formula's pure numbers (src/v2/lean-rpg/formula.js), as agreed on 1 Nov.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    pair, statPart, luckOf, edgeWithLuck, blocksFor, foeHealthBlocks, foeBonus, initiativeBonus, foeInitiativeBonus,
    quickStart, turnOrder, companionStats, STANDARD_NUMBERS,
} from '../../../src/v2/lean-rpg/formula.js';

const wessel = { str: 10, vit: 10, agi: 10, dex: 6, int: 5, luk: 3, cha: 5 };

test('a pair is (main + second/2)/2, rounded down once at the end', () => {
    assert.equal(pair(9, 7), 6);   // (9 + 3.5) / 2 = 6.25
    assert.equal(pair(10, 6), 6);  // 6.5
    assert.equal(pair(5, 5), 3);   // 3.75
    assert.equal(pair(20, 20), 15);
});

test('each roll type takes its main and second stat; a skill puts its own stat in the main slot', () => {
    assert.deepEqual(statPart('physical', wessel), { value: 6, main: 'str', second: 'dex', style: null });
    assert.deepEqual(statPart('physical', wessel, { skillStat: 'agi' }), { value: 6, main: 'agi', second: 'dex', style: null });
    assert.deepEqual(statPart('magic', wessel), { value: 4, main: 'int', second: 'dex', style: null });
    assert.deepEqual(statPart('social', wessel), { value: 3, main: 'cha', second: 'int', style: null });
    assert.deepEqual(statPart('check', wessel, { fittingStat: 'vit' }), { value: 6, main: 'vit', second: 'dex', style: null });
});

test('defence leads with the higher of AGI and VIT (a tie dodges); against magic, INT or VIT', () => {
    assert.deepEqual(statPart('defence', wessel), { value: 7, main: 'agi', second: 'vit', style: 'dodge' });
    assert.deepEqual(statPart('defence', { ...wessel, vit: 14 }), { value: 9, main: 'vit', second: 'agi', style: 'block' });
    assert.deepEqual(statPart('defence', { ...wessel, int: 16 }, { againstMagic: true }), { value: 10, main: 'int', second: 'vit', style: 'ward' });
});

test('luck steps at 13, 16, 19 and −1 at 7 or below; it shrinks bad edges, grows good ones, never past ±6', () => {
    assert.deepEqual([3, 7, 8, 12, 13, 16, 19, 20].map(luckOf), [-1, -1, 0, 0, 1, 2, 3, 3]);
    assert.equal(edgeWithLuck(-3, 1), -2);
    assert.equal(edgeWithLuck(-1, 3), 0);
    assert.equal(edgeWithLuck(3, 1), 4);
    assert.equal(edgeWithLuck(3, 3), 6);
    assert.equal(edgeWithLuck(1, -1), 0);
    assert.equal(edgeWithLuck(-3, -1), -4);
    assert.equal(edgeWithLuck(0, 3), 0);
});

test('bars: Health 4 + VIT/5, Stamina 3 + AGI/5, Mana 3 + INT/5; foes 4 + class/2', () => {
    assert.deepEqual(blocksFor(wessel), { health: 6, stamina: 5, mana: 4 });
    assert.deepEqual(blocksFor({ vit: 3, agi: 3, int: 3 }), { health: 4, stamina: 3, mana: 3 });
    assert.deepEqual(blocksFor({ vit: 20, agi: 20, int: 20 }), { health: 8, stamina: 7, mana: 7 });
    assert.deepEqual([1, 2, 4, 8, 9].map(foeHealthBlocks), [4, 5, 6, 8, 8]);
});

test('foes add 3 + 3 × class; turn order adds class + AGI/2 (foes 2 × class); a 10-point lead earns a quick start', () => {
    assert.equal(foeBonus(4), 15);
    assert.equal(initiativeBonus(wessel, 4), 9);
    assert.equal(foeInitiativeBonus(4), 8);
    assert.equal(quickStart(21, 11), true);
    assert.equal(quickStart(21, 12), false);
    assert.deepEqual(turnOrder([
        { id: 'rat', total: 17, agi: 0, party: false }, { id: 'ren', total: 17, agi: 8, party: true },
        { id: 'wessel', total: 21, agi: 10, party: true }, { id: 'drake', total: 17, agi: 8, party: false },
    ]), ['wessel', 'ren', 'drake', 'rat']);
});

test('a companion the story adds: 5s, the best stat 9, then 4 points per Soul Class above I on the best and DEX', () => {
    assert.deepEqual(companionStats('int', 1), { str: 5, vit: 5, agi: 5, dex: 5, int: 9, luk: 5, cha: 5 });
    assert.deepEqual(companionStats('int', 3), { str: 5, vit: 5, agi: 5, dex: 9, int: 13, luk: 5, cha: 5 });
    const late = companionStats('str', 9);
    assert.equal(late.str, STANDARD_NUMBERS.statMax);
    assert.deepEqual(late, { str: 20, vit: 11, agi: 5, dex: 20, int: 5, luk: 5, cha: 5 });
    assert.equal(Object.values(late).reduce((a, b) => a + b, 0), 35 + 4 + 4 * 8, 'no point is left unspent');
});
