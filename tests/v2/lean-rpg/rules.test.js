// The numbers a roll is made with (src/v2/lean-rpg/rules.js): the presets, the Custom ranges, the exact odds, and what each
// number does in the roll (resolve.js). Pure: a sheet read from state, scripted dice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CLASS_NAMES, DIFFICULTIES, DIFFICULTY_SETTING, EARLIER_RULES, STANDARD, STANDARD_PRESETS, STANDARD_RANGES, STANDARD_RULE_KEYS, STANDARD_SETTING, RANK_NAMES,
    difficultyOf, fold, normalizeRules, oddsFor, oddsSubject, outcomeOf, prepare, presetOf, readSheet, rollPrepared, rulesFromSettings, sameRules, subjectOdds,
} from '../../../src/v2/lean-rpg/index.js';
import { foeBonus } from '../../../src/v2/lean-rpg/formula.js';
import { PARTY, character, sheetDomain, skillBlock } from './helpers.js';

const sheetOf = (blocks = PARTY()) => readSheet({ domains: { dataModules: sheetDomain(blocks) } });
const calm = () => () => () => 10;
const wessel = (over = {}) => ({ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats', ...over });
const plan = (over = {}) => ({ formula: 'standard', pace: 'normal', acts: [wessel()], foes: [], checks: [], ...over });

const PRESETS = STANDARD_PRESETS;
const GENTLE = { success: 69, cost: 7, fail: 25 }, MIDDLE = { success: 61, cost: 8, fail: 31 }, HARSH = { success: 52, cost: 9, fail: 39 };

test('Standard is the one formula; Gentle and Harsh move the foe\'s base only', () => {
    assert.equal(STANDARD, PRESETS.standard);
    assert.deepEqual([PRESETS.gentle.foeBase, PRESETS.standard.foeBase, PRESETS.harsh.foeBase], [2, 4, 6]);
    for (const name of ['gentle', 'harsh']) assert.deepEqual({ ...PRESETS[name], foeBase: 4 }, { ...PRESETS.standard });
    assert.equal(PRESETS.standard.formula, 'standard');
    assert.deepEqual(DIFFICULTIES, ['gentle', 'standard', 'harsh', 'custom']);
    assert.ok(Object.isFrozen(PRESETS.standard) && Object.isFrozen(PRESETS));
    assert.deepEqual(Object.keys(normalizeRules()), STANDARD_RULE_KEYS);
});

test('Custom numbers are whole numbers inside their ranges, else Standard\'s; always the same keys in the same order', () => {
    assert.deepEqual(STANDARD_RANGES.foeBase, { min: 0, max: 15 });
    assert.deepEqual(STANDARD_RANGES.decisiveMargin, { min: 4, max: 15 });
    assert.deepEqual(STANDARD_RANGES.roundCap, { min: 1, max: 8 });
    assert.deepEqual(STANDARD_RANGES.costMargin, { min: 0, max: 5 });
    assert.deepEqual(normalizeRules({ foeBase: 15, classWeight: 3, costMargin: 0, decisiveMargin: 4, roundCap: 1 }), { ...STANDARD, foeBase: 15, classWeight: 3, costMargin: 0, decisiveMargin: 4, roundCap: 1 });
    // Out of range, not whole, not a number, missing: Standard's value for that number.
    const bad = normalizeRules({ foeBase: 16, classWeight: 0, costMargin: 2.5, decisiveMargin: '8', roundCap: 9, extra: 1 });
    assert.deepEqual(bad, STANDARD);
    assert.deepEqual(normalizeRules({ roundCap: 3, foeBase: -1 }), { ...STANDARD, roundCap: 3 });
    // A record with no `formula` replays as Standard.
    for (const nothing of [undefined, null, 5, 'x', [], [1]]) assert.deepEqual(normalizeRules(nothing), STANDARD);
    assert.equal(normalizeRules({ roundCap: 3 }).formula, 'standard');
    assert.equal(JSON.stringify(normalizeRules({ roundCap: 3, foeBase: 9 })), JSON.stringify(normalizeRules({ foeBase: 9, roundCap: 3 })), 'key order does not depend on how it was given');
});

test('the settings give the numbers: a preset by its word, Custom by its stored numbers, anything else Standard', () => {
    assert.equal(difficultyOf({}), 'standard');
    assert.equal(difficultyOf({ [DIFFICULTY_SETTING]: 'maybe' }), 'standard');
    // (From 2.17.0 every set the settings give also carries the level divisor, 5 unless the Custom numbers say 3 to 8: `levelled`.)
    const levelled = rules => ({ ...rules, levelDivisor: 5 });
    for (const name of ['gentle', 'standard', 'harsh']) assert.deepEqual(rulesFromSettings({ [DIFFICULTY_SETTING]: name }), levelled(PRESETS[name]));
    assert.deepEqual(rulesFromSettings({}), levelled(STANDARD));
    assert.deepEqual(rulesFromSettings({ [DIFFICULTY_SETTING]: 'custom', [STANDARD_SETTING]: { foeBase: 11, costMargin: 4, roundCap: 99 } }), levelled({ ...STANDARD, foeBase: 11, costMargin: 4 }));
    assert.deepEqual(rulesFromSettings({ [DIFFICULTY_SETTING]: 'custom' }), levelled(STANDARD), 'Custom with nothing stored');
    assert.deepEqual(rulesFromSettings({ [DIFFICULTY_SETTING]: 'gentle', [STANDARD_SETTING]: { foeBase: 11 } }), levelled(PRESETS.gentle), 'the custom numbers are not read for a preset');
    assert.notEqual(rulesFromSettings({}), STANDARD, 'a copy');
    assert.equal(presetOf(PRESETS.harsh), 'harsh');
    assert.equal(presetOf({ ...STANDARD, roundCap: 4 }), 'custom');
    assert.equal(sameRules(STANDARD, { roundCap: 8 }), true);
    assert.equal(sameRules(STANDARD, PRESETS.harsh), false);
});

test('the odds: a +9 bonus against a Class I foe is 69 / 7 / 25 Gentle, 61 / 8 / 31 Standard, 52 / 9 / 39 Harsh', () => {
    const at = rules => oddsFor(rules, { bonus: 9, foeClass: 1 });
    assert.deepEqual(at(PRESETS.gentle), GENTLE);
    assert.deepEqual(at(PRESETS.standard), MIDDLE);
    assert.deepEqual(at(PRESETS.harsh), HARSH);
    assert.ok(GENTLE.success > MIDDLE.success && MIDDLE.success > HARSH.success);
    assert.deepEqual(at(undefined), at(STANDARD), 'no numbers: Standard');
});

test('the odds agree with the roll itself over every pair of dice, for any numbers', () => {
    for (const rules of [PRESETS.gentle, PRESETS.harsh, { ...STANDARD, foeBase: 15, classWeight: 3, costMargin: 5 }, { ...STANDARD, foeBase: 0, costMargin: 0 }]) {
        for (const [bonus, foeClass] of [[0, 1], [9, 1], [14, 3], [30, 9]]) {
            const counts = { success: 0, cost: 0, fail: 0 };
            for (let pc = 1; pc <= 20; pc += 1) for (let foe = 1; foe <= 20; foe += 1) counts[outcomeOf(pc, pc + bonus, foe + foeBonus(foeClass, rules), rules)] += 1;
            assert.deepEqual(oddsFor(rules, { bonus, foeClass }), { success: Math.round(counts.success / 4), cost: Math.round(counts.cost / 4), fail: Math.round(counts.fail / 4) });
        }
    }
});

test('who the odds are for: the persona-named character, else the first; their best skill, else their best stat; against their own Soul Class', () => {
    const party = PARTY();
    party.wessel.fields = character('Wessel', { str: 12, soul: 1 });
    party['wessel-skills'].fields = skillBlock('Wessel', [['Iron Breath', 1, 'str'], ['Spark', 0, 'int', 'mana']]);
    const sheet = sheetOf(party);
    const names = { rankNames: RANK_NAMES, soulNames: CLASS_NAMES, fold };
    const mine = oddsSubject(sheet, 'Wessel', names);
    assert.deepEqual(mine, { who: 'Wessel', stat: 'str', statValue: 12, soul: 1, level: 5, rank: 1, skill: 'Iron Breath', foeClass: 1, foeLevel: 5, rankName: 'Adept', soulName: 'I' });
    assert.deepEqual(subjectOdds(PRESETS.standard, mine), { bonus: 9, success: 61, cost: 8, fail: 31 });
    assert.equal(subjectOdds({ ...STANDARD, classWeight: 3 }, mine).bonus, 6 + 3 + 1, 'the stat\'s share, ×3 for the class, plus the rank');
    assert.equal(oddsSubject(sheet, 'Ren', names).who, 'Ren');
    assert.equal(oddsSubject(sheet, 'Ren', names).stat, 'int', 'Ren has no Spark ranked above Novice, so the first skill, and its stat');
    assert.equal(oddsSubject(sheet, 'a stranger', names).who, 'Ren', 'a persona with no block: the first Character block (they are read in block order)');
    assert.equal(oddsSubject(sheet, '', names).who, 'Ren');
    delete party['wessel-skills']; delete party['ren-skills'];
    const bare = oddsSubject(sheetOf(party), 'Wessel', names);
    assert.deepEqual([bare.skill, bare.rank, bare.rankName, bare.stat], [null, 0, '', 'str'], 'no skills: the best stat, untrained');
    assert.equal(oddsSubject(sheetOf({ foes: PARTY().foes }), 'Wessel', names), null, 'no character');
});

test('with no numbers given, a roll is made with Standard\'s (what it always was)', () => {
    const sheet = sheetOf();
    const body = plan();
    const plain = rollPrepared(body, prepare(body, sheet), calm());
    const standard = rollPrepared(body, prepare(body, sheet, STANDARD), calm(), STANDARD);
    assert.deepEqual(plain, standard);
});

test('each number does its work in the roll: the foe\'s base, the "at a cost" window, the decisive margin and the most exchanges', () => {
    const sheet = sheetOf();
    const run = (rules, body = plan({ pace: 'all' }), pcDie = 10, foeDie = 10) => rollPrepared(body, prepare(body, sheet, rules), () => { let turn = 0; return () => (turn++ % 2 === 0 ? pcDie : foeDie); }, rules);
    const first = rules => run(rules, plan({ pace: 'careful' })).rounds[0].lines[0];
    assert.equal(first({ ...STANDARD, foeBase: 9 }).foe.total - first(STANDARD).foe.total, 5, 'the foe\'s base is added to its die');
    // Cost window: the number of totals short of the foe's that still count as "at a cost".
    const gap = first(STANDARD).foe.total - first(STANDARD).pc.total;
    const at = (costMargin, pcDie) => run({ ...STANDARD, costMargin }, plan({ pace: 'careful' }), pcDie, 10).rounds[0].lines[0].outcome;
    const low = 10 + gap - 1;
    assert.ok(low > 1 && low < 20, `a gap of ${gap}`);
    assert.equal(at(0, low), 'fail');
    assert.equal(at(5, low), 'cost');
    assert.equal(at(5, 1), 'fail', 'a natural 1 always fails');
    // The most exchanges per reply: the cap, whatever the pace.
    const long = (roundCap, margin = STANDARD.decisiveMargin) => run({ ...STANDARD, roundCap, decisiveMargin: margin }, plan({ pace: 'all' }), 10, 10);
    for (const roundCap of [1, 2, 3]) assert.equal(long(roundCap).rounds.length, roundCap, `cap ${roundCap}`);
    assert.ok(long(8).rounds.length > 3 || long(8).stop !== 'cap', 'eight rounds: all of the pace, or what the cue budget holds');
    assert.equal(run(STANDARD, plan({ pace: 'careful' }), 10, 10).rounds.length, 1, 'careful is one');
    assert.equal(EARLIER_RULES.roundCap, 5, 'a roll made before the flow of stage 49 replays with the cap of 5');
});
