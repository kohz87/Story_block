import test from 'node:test';
import assert from 'node:assert/strict';
import { replyDice, offerLine, dicePayload, diceOf, diceRecord } from '../../../../src/v2/lean-rpg/checks/dice.js';
import { bonusTable } from '../../../../src/v2/lean-rpg/checks/result.js';
import { LIMITS } from '../../../../src/v2/lean-rpg/names.js';
import { rulesFromSettings } from '../../../../src/v2/lean-rpg/rules.js';

const astra = { name: 'Astra', aliases: [], stats: { str: 10, vit: 8, agi: 12, dex: 6, int: 14, luk: 9, cha: 10 }, level: 10, soul: 1,
    skills: [{ name: 'Obscure', stat: 'dex', rank: 1, type: 'utility' }, { name: 'Lore', stat: null, rank: 0, type: 'utility' }] };
const rules = { levelDivisor: 5, classWeight: 2, costMargin: 2, decisiveMargin: 8 };

test('a reply gets three whole d20 from its seed, and the same seed gives the same dice', () => {
    const first = replyDice(0x1234abcd), again = replyDice(0x1234abcd), other = replyDice(0x1234abce);
    assert.equal(first.length, 3);
    assert.ok(first.every(die => Number.isInteger(die) && die >= 1 && die <= 20), String(first));
    assert.deepEqual(again, first);
    assert.notDeepEqual(other, first);
});

test('the note tells the dice, the difficulty numbers, the success rule and each member\'s exact bonus for every stat and skill', () => {
    const record = { list: [9, 17, 4], rules, dc: { ...LIMITS.dc }, perUse: 3, table: bonusTable([astra], rules) };
    // stat part floor((2 x main + dex) / 4) + floor(level 10 / 5) = 2 (STR: 6 + 2); a skill adds its rank (Obscure: 4 + 2 + 1); a skill with no stat leads with STR, as the fight code does (Lore: 6 + 2 + 0)
    assert.equal(offerLine(record), 'Dice for this reply, in order: 9, 17, 4. Use one for each attempt that can fail (yours or a party member\'s): total = die + bonus, against easy 10 (routine for a trained person), normal 15 (a real chance to fail), hard 20 (a skilled person often fails), very hard 25 (rarely done). Total at the number or over: success; up to 2 short: success at a cost; less: fail; a natural 20 always succeeds and a natural 1 always fails. Bonus by stat or skill (level included): Astra: STR+8 VIT+7 AGI+9 DEX+6 INT+10 LUK+8 CHA+8; Obscure+7, Lore+8. The story must follow each result strictly. Report each: ? roll Name | skill or stat | difficulty | die.');
});

test('the margin the note names is the one recorded, not a fixed number', () => {
    const text = offerLine({ list: [1, 2, 3], rules: { ...rules, costMargin: 4 }, dc: { easy: 8, normal: 12, hard: 17, 'very hard': 22 }, table: [] });
    assert.ok(text.includes('up to 4 short') && text.includes('easy 8') && text.includes('very hard 22'));
    assert.equal(text.includes('Bonus by'), false, 'no party: no bonus list');
});

test('a record is read back only whole: three dice in range, the rules, the difficulty numbers and a practice per use', () => {
    const good = { list: [9, 17, 4], rules, dc: { ...LIMITS.dc }, perUse: 3 };
    assert.deepEqual(diceOf(good), good);
    for (const bad of [null, { ...good, list: [9, 17] }, { ...good, list: [9, 17, 21] }, { ...good, rules: null }, { ...good, rules: { ...rules, costMargin: 'two' } }, { ...good, dc: { easy: 10 } }, { ...good, perUse: 9 }]) {
        assert.equal(diceOf(bad), null, JSON.stringify(bad));
    }
});

test('the payload records today\'s numbers once: the rules, the practice per use and the party\'s bonus table', () => {
    const payload = dicePayload([astra], { rpgPracticePerUse: 5, rpgDifficulty: 'harsh' });
    assert.equal(payload.perUse, 5);
    assert.equal(payload.rules.costMargin, rulesFromSettings({ rpgDifficulty: 'harsh' }).costMargin);
    assert.deepEqual(payload.dc, LIMITS.dc);
    assert.equal(payload.table[0].who, 'Astra');
    assert.equal(payload.table[0].stats.length, 7);
});

test('the prelude records the dice from the seed and keeps the payload to replan with', () => {
    const ctx = { cause: 'system', caller: null, rng: () => 0.25, fail: (code, message) => { throw new Error(`${code} ${message}`); } };
    const payload = dicePayload([astra], {});
    const made = diceRecord(ctx, payload);
    assert.equal(made.replan, true);
    assert.deepEqual(made.data.v2.dice.list, replyDice(Math.floor(0.25 * 4294967296) >>> 0));
    assert.deepEqual(made.data.v2.dice.table, payload.table);
    assert.deepEqual(made.data.v2.dice.rules, payload.rules);
    assert.deepEqual(diceRecord(ctx, { rules: { costMargin: 99 } }).data.v2.dice.rules.costMargin, 2, 'damaged numbers are not kept: Standard\'s are');
    assert.throws(() => diceRecord({ ...ctx, cause: 'ui' }, payload), /REFUSED/u);
});
