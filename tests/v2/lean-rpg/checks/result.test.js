import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheckLine, validateCheck } from '../../../../src/v2/lean-rpg/checks/line.js';
import { bonusTable, resolveCheck, workChecks } from '../../../../src/v2/lean-rpg/checks/result.js';
import { statPart } from '../../../../src/v2/lean-rpg/formula.js';
import { STANDARD } from '../../../../src/v2/lean-rpg/rules.js';

const member = { name: 'Astra', aliases: [], stats: { str: 10, vit: 8, agi: 12, dex: 6, int: 14, luk: 9, cha: 10 },
    skills: [{ name: 'Obscure', stat: 'dex', rank: 1, type: 'utility' }, { name: 'Iron Breath', stat: 'str', rank: 3, type: 'combat' }] };
member.level = 10;
const party = [member];
const check = (what, difficulty, die) => validateCheck(parseCheckLine(`? roll Astra | ${what} | ${difficulty} | ${die}`), { party, offeredDice: [die], usedDice: [] });

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

test('the bonus the narrator is told for each stat and skill is exactly the bonus the result adds', () => {
    const rules = { ...STANDARD, levelDivisor: 5 };
    const [row] = bonusTable(party, rules);
    const stats = ['str', 'vit', 'agi', 'dex', 'int', 'luk', 'cha'];
    stats.forEach((stat, at) => assert.equal(resolveCheck(check(stat.toUpperCase(), 'normal', 9), 9, rules).bonus, row.stats[at], stat));
    for (const [name, bonus] of row.skills) assert.equal(resolveCheck(check(name, 'normal', 9), 9, rules).bonus, bonus, name);
    assert.equal(row.stats[6], statPart('check', member.stats, { fittingStat: 'cha' }).value + 2, 'the level term is floor(10 / 5)');
});

test('a skill with no stored stat leads with the type\'s main stat, in the table and in the result', () => {
    const old = { ...member, name: 'Brin', skills: [{ name: 'Lore', stat: null, rank: 2, type: 'utility' }] };
    const found = validateCheck(parseCheckLine('? roll Brin | Lore | normal | 9'), { party: [old], offeredDice: [9], usedDice: [] });
    const done = resolveCheck(found, 9, { ...STANDARD, levelDivisor: 5 });
    assert.equal(done.stat, 'str');
    assert.equal(done.bonus, statPart('check', old.stats, {}).value + 2 + 2);
    assert.equal(bonusTable([old], { ...STANDARD, levelDivisor: 5 })[0].skills[0][1], done.bonus);
});

test('workChecks uses the rules, difficulty numbers and practice recorded with the dice, never other numbers', () => {
    const dice = { list: [9, 17, 4], rules: { levelDivisor: 5, classWeight: 2, costMargin: 0, decisiveMargin: 4 }, dc: { easy: 8, normal: 12, hard: 17, 'very hard': 22 }, perUse: 5 };
    const lines = ['? roll Astra | Obscure | normal | 9', '? roll Astra | CHA | normal | 4', '? roll Nobody | CHA | easy | 17'];
    const worked = workChecks([member, { ...member, name: 'Rook' }], lines, dice);
    assert.equal(worked.results.length, 1, 'the second line is out of order and the third has no one: refused');
    assert.equal(worked.notes.length, 2);
    const [first] = worked.results;
    assert.equal(first.dc, 12);
    assert.equal(first.practiceGained, 5);
    assert.deepEqual(worked.uses, [{ who: 'Astra', skill: 'Obscure', n: 1 }]);
    assert.equal(workChecks(party, lines, null).results.length, 0, 'no dice recorded: none used');
    assert.ok(workChecks(party, lines, null).notes.every(note => note.includes('no dice were offered')));
});

test('with the note\'s table a check is worked at the bonuses the note showed, not the sheet\'s newer ones', () => {
    const shown = bonusTable(party, STANDARD);
    const raised = { ...member, stats: { ...member.stats, cha: 20 }, skills: [...member.skills, { name: 'Fresh', stat: 'dex', rank: 2, type: 'utility' }] };
    const dice = { list: [10, 10, 10], rules: STANDARD, dc: { easy: 8, normal: 12, hard: 16, extreme: 20 }, perUse: 3 };
    const line = what => `? roll Astra | ${what} | normal | 10`;
    const stat = workChecks([raised], [line('CHA')], dice, shown).results[0];
    assert.equal(stat.bonus, shown[0].stats[6], 'the table\'s CHA, not the raised one');
    assert.equal(stat.total, 10 + shown[0].stats[6]);
    assert.equal(stat.unlisted, undefined);
    const skill = workChecks([raised], [line('Obscure')], dice, shown).results[0];
    assert.equal(skill.bonus, shown[0].skills[0][1]);
    const live = workChecks([raised], [line('CHA')], dice).results[0];
    assert.notEqual(live.bonus, stat.bonus, 'no table: the sheet\'s bonus, as before');
});

test('a member or skill the table did not show rolls with no bonus, and the notes say why', () => {
    const shown = bonusTable(party, STANDARD);
    const raised = { ...member, skills: [...member.skills, { name: 'Fresh', stat: 'dex', rank: 2, type: 'utility' }] };
    const joined = { name: 'Newcomer', aliases: [], stats: member.stats, level: 10, skills: [] };
    const dice = { list: [10, 10, 10], rules: STANDARD, dc: { easy: 8, normal: 12, hard: 16, extreme: 20 }, perUse: 3 };
    const out = workChecks([raised, joined], ['? roll Newcomer | CHA | normal | 10', '? roll Astra | Fresh | normal | 10'], dice, shown);
    assert.deepEqual(out.results.map(r => [r.who, r.bonus, r.total, r.unlisted]), [['Newcomer', 0, 10, 'member'], ['Astra', 0, 10, 'skill']]);
    assert.equal(out.notes.length, 2);
    assert.match(out.notes[0], /Newcomer rolled CHA with no bonus: they were not in the table the note showed/u);
    assert.match(out.notes[1], /Fresh with no bonus: it was not in the table/u);
});
