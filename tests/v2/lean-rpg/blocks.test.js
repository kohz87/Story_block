// The Standard formula's bars (src/v2/lean-rpg/blocks.js): stage words spread over the bar's size, the size from the stats or the foe's
// class, the "next block / next luck" numbers, and the words a story writes turned into blocks (the same rounding the templates use).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES } from '../../../src/v2/lean-rpg/names.js';
import { blocksFor, foeHealthBlocks } from '../../../src/v2/lean-rpg/formula.js';
import { barFields, barOf, barReading, characterBars, growthOf, sizeOf, spreadIndex, spreadWord, stageText, wordToBlocks, wordsOf } from '../../../src/v2/lean-rpg/blocks.js';
import { STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';

const standard = name => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition);
const wessel = { str: 10, vit: 10, agi: 10, dex: 6, int: 5, luk: 3, cha: 5 };

test('the first word is exactly empty and the last exactly full, whatever the bar\'s size', () => {
    for (const size of [3, 4, 5, 6, 7, 8]) {
        assert.equal(spreadWord(STAGES.health, 0, size), 'Down');
        assert.equal(spreadWord(STAGES.health, size, size), 'Unhurt');
        assert.equal(spreadWord(STAGES.stamina, 0, size), 'Empty');
        assert.equal(spreadWord(STAGES.stamina, size, size), 'Fresh');
        for (let value = 1; value < size; value += 1) {
            const word = spreadWord(STAGES.health, value, size);
            assert.notEqual(word, 'Down', `${value} of ${size} is not Down`);
            assert.notEqual(word, 'Unhurt', `${value} of ${size} is not Unhurt`);
        }
    }
});

test('the words in between spread over the size, in order, by the nearest word (the mockup\'s 4 of 6 is Hurt, 5 of 6 Scratched, 1 of 5 Badly wounded)', () => {
    assert.equal(spreadWord(STAGES.health, 4, 6), 'Hurt');
    assert.equal(spreadWord(STAGES.health, 5, 6), 'Scratched');
    assert.equal(spreadWord(STAGES.health, 1, 5), 'Badly wounded');
    assert.equal(spreadWord(STAGES.stamina, 2, 5), 'Tired');
    assert.equal(spreadWord(STAGES.mana, 4, 4), 'Fresh');
    for (const [words, size] of [[STAGES.health, 4], [STAGES.health, 8], [STAGES.mana, 5], [STAGES.stamina, 7]]) {
        let last = -1;
        for (let value = 0; value <= size; value += 1) {
            const at = spreadIndex(value, size, words.length);
            assert.ok(at >= last, `${words[0]} ${value}/${size} never goes back a word`);
            last = at;
        }
    }
    assert.equal(spreadIndex(3, 0, 6), 0, 'a bar with no size reads as empty, never divides by zero');
});

test('a story word becomes blocks by the same rounding the templates\' kinds use: the first word is 0, the last the full bar, between the nearest block', () => {
    for (const size of [4, 5, 6, 7, 8]) {
        assert.equal(wordToBlocks(0, size, 6), 0);
        assert.equal(wordToBlocks(5, size, 6), size);
        for (let index = 1; index <= 4; index += 1) {
            const blocks = wordToBlocks(index, size, 6);
            assert.ok(blocks >= 1 && blocks <= size - 1, `${STAGES.health[index]} in ${size} is a middle count (${blocks})`);
            assert.equal(blocks, Math.round(index * size / 5 + 1e-9), 'nearest block, halves up');
        }
    }
    assert.deepEqual([0, 1, 2, 3, 4].map(index => wordToBlocks(index, 4, 5)), [0, 1, 2, 3, 4], 'a four-block mana bar: one word a block');
    assert.deepEqual([0, 1, 2, 3, 4].map(index => wordToBlocks(index, 7, 5)), [0, 2, 4, 5, 7]);
});

test('barOf reads the field\'s `blocks` mark; a field without it is a Classic stage bar', () => {
    const { state } = standard('Character');
    assert.deepEqual(['health', 'stamina', 'mana'].map(key => barOf(state[key])), ['health', 'stamina', 'mana']);
    assert.equal(barOf({ type: 'int', min: 0, max: 5, default: 5 }), null);
    assert.equal(barOf({ type: 'int', min: 0, max: 5, default: 5, blocks: 'bogus' }), null);
    assert.equal(barOf({ type: 'text', max: 4, default: '', blocks: 'health' }), null);
    assert.equal(barOf(null), null);
    assert.equal(barOf(standard('Foes').state.hurt1), 'foe');
});

test('a character\'s bar size is blocksFor(stats) and a foe group\'s is foeHealthBlocks(class)', () => {
    const { state } = standard('Character');
    assert.deepEqual(['health', 'stamina', 'mana'].map(key => sizeOf(state[key], wessel, key)), [blocksFor(wessel).health, blocksFor(wessel).stamina, blocksFor(wessel).mana]);
    assert.deepEqual(['health', 'stamina', 'mana'].map(key => sizeOf(state[key], wessel, key)), [6, 5, 4]);
    const foes = standard('Foes').state;
    assert.equal(sizeOf(foes.hurt2, { class2: 4 }, 'hurt2'), foeHealthBlocks(4));
    assert.equal(sizeOf(foes.hurt2, { class2: 4 }, 'hurt2'), 6);
    assert.equal(sizeOf(foes.hurt1, {}, 'hurt1'), 4, 'no class yet: class 1');
    assert.equal(sizeOf({ type: 'int', min: 0, max: 5, default: 5 }, wessel, 'health'), null);
});

test('a reading holds the value to 0..size, and a block that is not a block bar reads as null', () => {
    const { state } = standard('Character');
    assert.deepEqual(barReading(state.health, { ...wessel, health: 4 }, 'health'), { value: 4, size: 6, word: 'Hurt' });
    assert.equal(barReading(state.health, { ...wessel, health: 8 }, 'health').value, 6, 'more than the bar holds is the full bar');
    assert.equal(barReading(state.health, { ...wessel, health: -3 }, 'health').value, 0);
    assert.equal(barReading({ type: 'int', min: 0, max: 5, default: 5 }, wessel, 'health'), null);
    assert.equal(characterBars(structuredClone({ state: { health: { type: 'int', min: 0, max: 5, default: 5 } } }), wessel), null, 'Classic');
    assert.equal(stageText('stamina', 0, 5), 'Empty');
    assert.equal(stageText('foe', 5, 6), 'Scratched');
    assert.deepEqual(wordsOf('foe'), STAGES.health);
});

test('the next block and next luck: the stat that earns it, none past the stat maximum or LUK 19', () => {
    assert.deepEqual(growthOf(wessel), {
        health: { blocks: 6, stat: 'vit', value: 10, next: 15 }, stamina: { blocks: 5, stat: 'agi', value: 10, next: 15 },
        mana: { blocks: 4, stat: 'int', value: 5, next: 10 }, luck: { value: -1, stat: 'luk', current: 3, next: 8 },
    });
    const top = growthOf({ ...wessel, vit: 20, luk: 19, int: 14 });
    assert.equal(top.health.blocks, 8);
    assert.equal(top.health.next, null, 'VIT 20 is the maximum: no next block');
    assert.deepEqual([top.luck.value, top.luck.next], [3, null]);
    assert.equal(top.mana.next, 15);
    assert.equal(growthOf({ ...wessel, luk: 13 }).luck.next, 16);
    assert.deepEqual([7, 8, 12].map(luk => growthOf({ ...wessel, luk }).luck.next), [8, 13, 13], 'below LUK 8 the next change is back to 0');
});

test('a new character\'s bars are full for its stats, with the sizes the rules compare against', () => {
    assert.deepEqual(barFields({ str: 5, vit: 5, agi: 5, dex: 5, int: 5, luk: 5, cha: 5 }), { health: 5, stamina: 4, mana: 4, 'health-blocks': 5, 'stamina-blocks': 4, 'mana-blocks': 4 });
    assert.deepEqual(barFields({ vit: 15, agi: 20, int: 9 }), { health: 7, stamina: 7, mana: 4, 'health-blocks': 7, 'stamina-blocks': 7, 'mana-blocks': 4 });
});
