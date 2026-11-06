// Board weapon and automatic defence decisions are deterministic sheet reads.
// These tests cover the usable skill and stat choices before any die is rolled.

import test from 'node:test';
import assert from 'node:assert/strict';
import { attackStat, bestDefence } from '../../../../src/v2/lean-rpg/board/rules.js';

test('a plain weapon uses strength, or the best eligible stat for finesse', () => {
    const hero = { stats: { str: 8, agi: 14, dex: 12 } };
    assert.equal(attackStat(hero, { name: 'Hammer' }), 'str');
    assert.equal(attackStat(hero, { name: 'Cane Sword' }), 'agi');
    assert.equal(attackStat(hero, { name: 'Old blade', stats: { DEX: 2 } }), 'dex');
    assert.equal(attackStat({ stats: { str: 16, agi: 14, dex: 12 } }, { kind: 'finesse' }), 'str');
});

test('automatic defence picks the highest usable defence bonus and falls back when empty', () => {
    const hero = { stats: { str: 5, agi: 12, vit: 8, dex: 5 }, stamina: 1, mana: 0, skills: [
        { name: 'Dodge', stat: 'agi', rank: 1, uses: 'stamina' },
        { name: 'Ward', stat: 'vit', rank: 4, uses: 'mana' },
        { name: 'Slash', stat: 'str', rank: 5, uses: 'stamina' },
    ] };
    assert.equal(bestDefence(hero)?.name, 'Dodge');
    hero.stamina = 0;
    assert.equal(bestDefence(hero), null);
    hero.mana = 1;
    assert.equal(bestDefence(hero)?.name, 'Ward');
    assert.equal(bestDefence(hero, () => ({ defence: false })), null);
});
