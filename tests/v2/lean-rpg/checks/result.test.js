import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheckLine, validateCheck } from '../../../../src/v2/lean-rpg/checks/line.js';
import { resolveCheck } from '../../../../src/v2/lean-rpg/checks/result.js';
import { statPart } from '../../../../src/v2/lean-rpg/formula.js';
import { STANDARD } from '../../../../src/v2/lean-rpg/rules.js';

const member = { name: 'Astra', aliases: [], stats: { str: 10, vit: 8, agi: 12, dex: 6, int: 14, luk: 9, cha: 10 },
    skills: [{ name: 'Obscure', stat: 'dex', rank: 1, type: 'utility' }, { name: 'Iron Breath', stat: 'str', rank: 3, type: 'combat' }] };
const party = [member];
const check = (what, difficulty, die) => validateCheck(parseCheckLine(`? check Astra | ${what} | ${difficulty} | ${die}`), { party, offeredDice: [die], usedDice: [] });

test('success, success at a cost and fail follow the old check formula and the rules\' cost margin', () => {
    const statBonus = statPart('check', member.stats, { fittingStat: 'cha' }).value;
    assert.equal(statBonus, 6);
    const success = resolveCheck(check('CHA', 'normal', 13), 13, STANDARD);
    assert.deepEqual([success.total, success.outcome, success.decisive], [19, 'success', false]);
    assert.equal(success.bonus, statBonus, 'no skill: the stat part only');
    assert.equal(success.practice, null);

    const cost = resolveCheck(check('CHA', 'normal', 8), 8, STANDARD);
    assert.deepEqual([cost.total, cost.outcome, cost.decisive], [14, 'cost', false]);

    const fail = resolveCheck(check('CHA', 'normal', 6), 6, STANDARD);
    assert.deepEqual([fail.total, fail.outcome, fail.decisive], [12, 'fail', false]);
});

test('a skilled check adds its rank and gives exactly one practice use, never XP', () => {
    const skillBonus = statPart('check', member.stats, { skillStat: 'dex' }).value + 1;
    const cost = resolveCheck(check('Obscure', 'normal', 9), 9, STANDARD);
    assert.deepEqual([cost.total, cost.outcome, cost.bonus], [14, 'cost', skillBonus]);
    assert.deepEqual(cost.practice, { who: 'Astra', skill: 'Obscure', n: 1 });
    assert.equal('xp' in cost, false);
    assert.equal(cost.utility, true);
});

test('decisive is a natural 20, or a success whose lead reaches decisiveMargin', () => {
    const natural = resolveCheck(check('CHA', 'normal', 20), 20, STANDARD);
    assert.deepEqual([natural.total, natural.outcome, natural.decisive], [26, 'success', true]);
    const margin = resolveCheck(check('Iron Breath', 'easy', 9), 9, STANDARD);
    assert.deepEqual([margin.total, margin.outcome, margin.decisive], [18, 'success', true]);
});

test('the rules given decide the cost and decisive margins', () => {
    const tight = { ...STANDARD, costMargin: 0, decisiveMargin: 4 };
    const cost = resolveCheck(check('CHA', 'normal', 8), 8, tight);
    assert.equal(cost.outcome, 'fail', 'one short is not a cost at costMargin 0');
    const decisive = resolveCheck(check('CHA', 'normal', 13), 13, tight);
    assert.equal(decisive.decisive, true, 'a lead of four is decisive at decisiveMargin 4');
});
