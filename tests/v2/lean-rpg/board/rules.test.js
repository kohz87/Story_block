// Board weapon and automatic defence decisions are deterministic sheet reads.
// These tests cover the usable skill and stat choices before any die is rolled.

import test from 'node:test';
import assert from 'node:assert/strict';
import { attackStat, bestDefence, consumablesIn, recoverBar, recoveryOf } from '../../../../src/v2/lean-rpg/board/rules.js';
import { itemLineText } from '../../../../src/v2/lean-rpg/cue.js';

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

// ---- consumables (owner 14 Nov): the one rule the inventory, the story line and the fight board share -----------------------------------------------------
test('recoveryOf: the pool from the name words, the tag overriding, the amount by rarity', () => {
    const pool = (name, tags = []) => recoveryOf({ name, tags, rarity: 'common' }).pool;
    for (const name of ['Healing Draught', 'Potion', 'Minor Elixir', 'Bandage']) assert.equal(pool(name), 'health', name);
    for (const name of ['Mana Potion', 'Ether', 'Arcane Draught', 'Focus Elixir', 'mana tonic']) assert.equal(pool(name), 'mana', name);
    for (const name of ['Stamina Draught', 'Trail Tonic', 'Travel Rations', 'Food', 'Cold Drink', 'Stale Bread', 'Green Tea', 'Dwarven Ale']) assert.equal(pool(name), 'stamina', name);
    assert.equal(pool('Mana Tea'), 'mana', 'mana is looked for first');
    assert.equal(pool('Pale Ale of Focus'), 'mana', 'so is any mana word, wherever it is');
    assert.equal(pool('Rationale'), 'health', 'whole words only');
    assert.equal(pool('Mana Potion', ['restores:health']), 'health', 'a tag decides over the name');
    assert.equal(pool('Healing Draught', ['Restores:Stamina']), 'stamina', 'the tag is not case sensitive');
    assert.equal(pool('Healing Draught', ['restores:gold', 'pretty']), 'health', 'a tag that names no pool is ignored');
    const blocks = rarity => recoveryOf({ name: 'Draught', rarity }).blocks;
    assert.deepEqual(['common', 'uncommon', 'rare', 'epic'].map(blocks), [2, 3, 4, 5]);
    assert.equal(blocks('legendary'), 5, 'legendary gives what epic does');
    assert.equal(blocks(undefined), 2, 'no rarity gives what common does');
});

test('recoverBar: up to the amount, never past the bar, nothing for a pool the character does not have', () => {
    assert.deepEqual(recoverBar({ value: 1, size: 6 }, 'health', 3), { pool: 'health', from: 1, to: 4, size: 6, gained: 3 });
    assert.deepEqual(recoverBar({ value: 5, size: 6 }, 'mana', 4), { pool: 'mana', from: 5, to: 6, size: 6, gained: 1 });
    assert.equal(recoverBar({ value: 6, size: 6 }, 'stamina', 2).gained, 0);
    assert.equal(recoverBar(undefined, 'mana', 2).gained, 0);
    assert.equal(recoverBar({ value: 0, size: 0 }, 'mana', 2).gained, 0);
});

test('itemLineText and consumablesIn: the sentence and the bag list the picker draws', () => {
    assert.equal(itemLineText({ who: 'Astra', target: 'Astra', item: 'Healing Draught', pool: 'health', gained: 3 }), 'Astra drinks the Healing Draught (+3 health)');
    assert.equal(itemLineText({ who: 'Astra', target: 'Ren', item: 'Travel Ration', pool: 'stamina', gained: 2 }), 'Astra gives Ren the Travel Ration (+2 stamina)');
    assert.equal(itemLineText({ who: 'Astra', target: 'Astra', item: 'Travel Ration', pool: 'stamina', gained: 2 }), 'Astra eats the Travel Ration (+2 stamina)');
    assert.equal(itemLineText({ who: 'Astra', target: 'Astra', item: 'Mana Potion', pool: 'mana', gained: 0 }), 'Astra drinks the Mana Potion (already full)');
    const inventory = { defs: { a: { kind: 'consumable', name: 'Mana Potion', rarity: 'rare' }, b: { kind: 'consumable', name: 'Bandage', rarity: 'common' }, c: { kind: 'equipment', name: 'Sword' } },
        stacks: { s1: { id: 's1', def: 'b', qty: 2 }, s2: { id: 's2', def: 'a', qty: 1 }, s3: { id: 's3', def: 'c', qty: 1 }, s4: { id: 's4', def: 'b', qty: 1, bound: 'ac_x' } } };
    assert.deepEqual(consumablesIn(inventory), [{ stack: 's1', name: 'Bandage', qty: 2, pool: 'health', blocks: 2 }, { stack: 's2', name: 'Mana Potion', qty: 1, pool: 'mana', blocks: 4 }],
        'consumables only, by name, a bound piece left out');
    assert.deepEqual(consumablesIn(inventory, ['s1', 's2']).map(item => [item.stack, item.qty]), [['s1', 1]], 'units chosen this exchange are not offered twice');
});
