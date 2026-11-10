import test from 'node:test';
import assert from 'node:assert/strict';
import { replyDice, offerLine } from '../../../../src/v2/lean-rpg/checks/dice.js';

test('a reply gets three whole d20 from its seed, and the same seed gives the same dice', () => {
    const first = replyDice(0x1234abcd), again = replyDice(0x1234abcd), other = replyDice(0x1234abce);
    assert.equal(first.length, 3);
    assert.ok(first.every(die => Number.isInteger(die) && die >= 1 && die <= 20), String(first));
    assert.deepEqual(again, first);
    assert.notDeepEqual(other, first);
});

test('the offer line is the approved mockup text, with the dice in order', () => {
    assert.equal(offerLine([9, 17, 4]), 'Dice for this reply, in order: 9, 17, 4. Use one for each attempt that can fail (yours or a party member\'s): d20 + stat part + skill rank against easy 10 (routine for a trained person), normal 15 (a real chance to fail), hard 20 (a skilled person often fails), very hard 25 (rarely done). The story must follow each result strictly. Report each: ? check Name | skill or stat | difficulty | die.');
});
