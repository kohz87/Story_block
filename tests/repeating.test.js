// Repeating blocks: several tags of one block in a reply read, and are stored, as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBlocks, latestBlockInText, mergeRepeats } from '../src/envelope.js';
import { blockStatusInText, blockView } from '../src/view.js';
import { checkRolls, parseDice, readRolls, stampRolls } from '../src/dice.js';
import { normalizeBlock } from '../src/schema.js';
import { templateById } from '../src/templates.js';

const dice = templateById('dice-everyone');
const env = (...parts) => `<!-- STORY_BLOCKS_V1\n<Blocks>\n${parts.join('\n')}\n</Blocks>\n-->`;
const two = env('<Dice_All>\n🎲 Maelis climbs — d20+2 vs 15 → 12+2 = 14 · success, at a cost\n</Dice_All>', '<Dice_All>\n🎲 Astra spots the lantern — d20 vs 10 → 20 = 20 · critical success\n</Dice_All>');

test('the Dice templates repeat; other blocks do not', () => {
    assert.equal(templateById('dice').repeating, true);
    assert.equal(dice.repeating, true);
    assert.equal(templateById('inventory').repeating, false);
    assert.equal(normalizeBlock({ name: 'X' }).repeating, false);
});

test('one tag per roll reads as one block with every roll, in order', () => {
    const found = latestBlockInText(two, dice);
    assert.equal(found.merged, 2);
    assert.deepEqual(parseDice(found.state.text).rolls.map(roll => roll.roll), [12, 20]);
    assert.equal(blockStatusInText(two, dice).status, 'valid');
    const plain = normalizeBlock({ ...dice, repeating: false });
    assert.deepEqual(parseDice(latestBlockInText(two, plain).state.text).rolls.map(roll => roll.roll), [20], 'without repeating only the newest copy counts');
});

test('mergeRepeats folds the copies into the last tag, keeping its attributes and the rest of the message', () => {
    const text = `Story.\n${two.replace('<Dice_All>\n🎲 Astra', '<Dice_All rolls="12, 20">\n🎲 Astra')}\nMore story.`;
    const folded = mergeRepeats(text, dice);
    assert.equal(extractBlocks(folded, [dice]).length, 1);
    assert.match(folded, /<Dice_All rolls="12, 20">\n🎲 Maelis climbs[^\n]*\n🎲 Astra spots[^\n]*\n<\/Dice_All>/);
    assert.ok(folded.startsWith('Story.\n<!-- STORY_BLOCKS_V1\n<Blocks>\n<Dice_All'));
    assert.ok(folded.endsWith('</Blocks>\n-->\nMore story.'));
    assert.equal(mergeRepeats(folded, dice), folded, 'idempotent');
    assert.equal(mergeRepeats(text, normalizeBlock({ ...dice, repeating: false })), text);
});

test('rolls stamped after folding are checked against every roll of the reply', () => {
    const stamped = stampRolls(mergeRepeats(two, dice), dice, [12, 20, 4]);
    const chat = [{ is_user: true, mes: 'go' }, { is_user: false, mes: stamped }];
    const view = blockView(chat, dice);
    assert.deepEqual(view.rolls, [12, 20, 4]);
    assert.equal(checkRolls(parseDice(view.state.text), readRolls(stamped, dice)).ok, true);
});
