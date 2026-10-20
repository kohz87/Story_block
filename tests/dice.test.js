// Dice: rolled by the extension, handed over through {{rolls}}, stamped on the block and checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRolls, formatRolls, parseDice, promptRolls, readRolls, rollDice, stampRolls } from '../src/dice.js';
import { buildContext } from '../src/prompt.js';
import { normalizeBlock } from '../src/schema.js';
import { templateById } from '../src/templates.js';
import { blockView } from '../src/view.js';
import { turnItems } from '../src/turn.js';

const dice = templateById('dice');

test('rollDice: count and range, rejection sampling skips biased draws, crypto by default', () => {
    const values = [0xFFFFFFFF, 0, 19, 20];
    assert.deepEqual(rollDice(3, 20, () => values.shift()), [1, 20, 1], 'the draw above the last full cycle is thrown away');
    for (const roll of rollDice(10, 6)) assert.ok(roll >= 1 && roll <= 6);
    assert.equal(rollDice(50).length, 10, 'capped');
    assert.deepEqual(rollDice(0), []);
    assert.equal(rollDice(1, 7).length, 1, 'unknown dice fall back to d20');
    assert.equal(formatRolls([3, 14]), '3, 14');
    assert.equal(formatRolls(null), 'none');
});

test('parseDice reads Megumin roll lines, loosely written, and refuses prose', () => {
    const parsed = parseDice('🎲 Maelis climbs the wet wall — d20+2 vs 15 → 12+2 = 14 · success, at a cost\n- Astra spots the lantern - d20 vs DC 10 -> 20 · critical success\n🎲 Pick the lock — d20-1 vs 20 → 9-1 = 8 · fail, the pick snaps');
    assert.deepEqual(parsed.rolls.map(roll => [roll.attempt, roll.roll, roll.mod, roll.total, roll.dc, roll.outcome, roll.note]), [
        ['Maelis climbs the wet wall', 12, 2, 14, 15, 'cost', ''],
        ['Astra spots the lantern', 20, 0, 20, 10, 'crit', ''],
        ['Pick the lock', 9, -1, 8, 20, 'fail', 'the pick snaps'],
    ]);
    assert.equal(parseDice('She smiled.'), null);
    assert.equal(parseDice('🎲 jump — d20 vs 10 → 25 · success'), null, 'a d20 never shows 25');
    assert.equal(parseDice('🎲 jump — d20+2 vs 10 → 8+2 = 13 · success').rolls[0].sumOk, false);
});

test('checkRolls: in order and as handed passes; reordered, invented, extra or badly summed rolls are named', () => {
    const parsed = parseDice('🎲 a — d20 vs 10 → 12 · success\n🎲 b — d20 vs 10 → 5 · fail');
    assert.deepEqual(checkRolls(parsed, [12, 5, 19]), { checked: true, ok: true, problems: [] });
    assert.deepEqual(checkRolls(parsed, [5, 12]).problems.map(problem => problem.kind), ['order', 'order']);
    assert.deepEqual(checkRolls(parsed, [12]).problems.map(problem => problem.kind), ['invented']);
    assert.deepEqual(checkRolls(parsed, [7, 5]).problems.map(problem => problem.kind), ['invented']);
    assert.equal(checkRolls(parsed, null).checked, false);
    assert.deepEqual(checkRolls(parseDice('🎲 a — d20+2 vs 10 → 12+2 = 15 · success'), [12]).problems.map(problem => problem.text), ['12+2 is not 15']);
    assert.deepEqual(checkRolls(parseDice('🎲 a — d20 vs 10 → 3 = 5 · success'), [3]).problems.map(problem => problem.text), ['3 is not 5']);
    assert.deepEqual(checkRolls(parseDice('🎲 a — d20-1 vs 10 → 9-1 = 7 · fail'), [9]).problems.map(problem => problem.text), ['9−1 is not 7']);
});

test('stampRolls records the handed rolls on the newest copy; readRolls reads them back', () => {
    const text = 'Story.\n<!-- STORY_BLOCKS_V1\n<Blocks>\n<Dice>\n🎲 a — d20 vs 10 → 12 · success\n</Dice>\n</Blocks>\n-->';
    const stamped = stampRolls(text, dice, [12, 5, 19]);
    assert.match(stamped, /<Dice rolls="12, 5, 19">/);
    assert.deepEqual(readRolls(stamped, dice), [12, 5, 19]);
    assert.match(stampRolls(stamped, dice, [3]), /<Dice rolls="3">/, 'restamping replaces');
    assert.equal(stampRolls('no dice here', dice, [1]), 'no dice here');
    assert.equal(readRolls(text, dice), null);
});

test('the reply context puts lead blocks in a first envelope and fills {{rolls}}; optional blocks may be left out', () => {
    const context = buildContext([{ def: dice, rolls: [12, 5, 19] }, { def: templateById('inventory'), state: null }]);
    assert.match(context, /### Dice — <Dice> \(first: this reply only, written before the story\)/);
    assert.match(context, /This reply's rolls, in order: Roll 1 = 12 · Roll 2 = 5 · Roll 3 = 19 \(the first attempt takes Roll 1, the next Roll 2, and so on, whatever they say\)\./);
    assert.match(context, /Optional: leave the whole <Dice> tag out/);
    assert.match(context, /Blocks marked "first" go in their own hidden envelope at the very start/);
    const skeleton = context.slice(context.indexOf('Write it exactly like this:'));
    assert.ok(skeleton.indexOf('<Dice>') < skeleton.indexOf('[your reply]'));
    assert.ok(skeleton.indexOf('[your reply]') < skeleton.indexOf('<Inventory_Changes>'));
    assert.doesNotMatch(buildContext([{ def: dice, rolls: null }]), /\[your reply\]/, 'no closing envelope when only lead blocks are asked for');
    assert.match(buildContext([{ def: dice, rolls: null }]), /rolls, in order: none\./);
});

test('the view hands the stamped rolls to the display, and the strip reports each roll', () => {
    const chat = [{ is_user: true, mes: 'climb' }, { is_user: false, mes: '<!-- STORY_BLOCKS_V1\n<Blocks>\n<Dice rolls="12, 5, 19">\n🎲 Climb — d20+2 vs 15 → 12+2 = 14 · success, at a cost\n</Dice>\n</Blocks>\n-->\nShe climbed.' }];
    const view = blockView(chat, dice);
    assert.deepEqual(view.rolls, [12, 5, 19]);
    assert.deepEqual(turnItems([{ view, tabId: 't' }]).map(item => [item.text, item.tone]), [['🎲 Climb: 14 vs 15 · success, at a cost', 'neutral']]);
    assert.equal(blockView([{ is_user: false, mes: 'No roll this time.' }], dice), null, 'no roll, no tab');
});

test('schema: lead kind, optional and rolls are normalized', () => {
    const block = normalizeBlock({ name: 'Luck', kind: 'lead', optional: true, rolls: { count: 99, sides: 7 } });
    assert.equal(block.kind, 'lead');
    assert.equal(block.optional, true);
    assert.deepEqual(block.rolls, { count: 10, sides: 20 });
    assert.deepEqual(normalizeBlock({ name: 'Plain' }).rolls, { count: 0, sides: 20 });
    assert.equal(normalizeBlock({ name: 'Plain' }).optional, false);
});

test('the model is handed each roll tied to its attempt; a skipped die gets what it would have said (0.9.6)', () => {
    assert.equal(promptRolls([2, 13, 18]), 'Roll 1 = 2 · Roll 2 = 13 · Roll 3 = 18 (the first attempt takes Roll 1, the next Roll 2, and so on, whatever they say)');
    assert.equal(promptRolls([7]), 'Roll 1 = 7 (the attempt takes it, whatever it says)');
    assert.equal(promptRolls([]), 'none');
    assert.equal(formatRolls([2, 13]), '2, 13', 'the display list is unchanged');

    // The handcart: the 2 skipped for the 13 against DC 10.
    const check = checkRolls(parseDice('🎲 Wessel rents a handcart from the village yard — d20 vs DC 10 → 13 · success'), [2, 13, 18, 16, 1, 6]);
    assert.equal(check.ok, false);
    assert.deepEqual(check.problems[0].expected, { roll: 2, total: 2, outcome: 'fail', label: 'fail' });
    // With a modifier, a near miss reads as at a cost; a natural 20 or 1 as critical.
    const near = checkRolls(parseDice('🎲 Climb — d20+3 vs DC 15 → 14+3 = 17 · success'), [10, 14]);
    assert.deepEqual(near.problems[0].expected, { roll: 10, total: 13, outcome: 'cost', label: 'success, at a cost' });
    assert.equal(checkRolls(parseDice('🎲 Leap — d20 vs DC 12 → 15 · success'), [1, 15]).problems[0].expected.outcome, 'critfail');
    assert.equal(checkRolls(parseDice('🎲 Leap — d20 vs DC 12 → 9 · fail'), [20]).problems[0].expected.outcome, 'crit', 'an invented number too');
    // A roll beyond the handed ones has no die to say anything.
    assert.equal(checkRolls(parseDice('🎲 A — d20 vs DC 5 → 2 · fail\n🎲 B — d20 vs DC 5 → 9 · success'), [2]).problems[0].expected, undefined);
});

test('the context keeps envelopes on their own lines and leaves an empty first envelope out (0.9.9)', () => {
    const context = buildContext([{ def: dice, rolls: [12] }, { def: templateById('inventory'), state: null }]);
    assert.match(context, /Put each envelope on its own lines, a blank line away from the story \(never on a line of story\)/);
    assert.match(context, /When none of them has anything this reply, leave that envelope out rather than writing it empty\./);
});
