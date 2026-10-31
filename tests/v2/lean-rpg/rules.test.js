// The numbers a roll is made with (src/v2/lean-rpg/rules.js): the presets, the Custom ranges, the exact odds, and what each
// number does in the roll (resolve.js). Pure: a sheet read from state, scripted dice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CLASS_NAMES, CUSTOM_SETTING, DIFFICULTIES, DIFFICULTY_SETTING, FORMULA, LIMITS, NOTE_MAX, NOTE_SETTING, PRESETS, RANK_NAMES, RULE_KEYS, RULE_RANGES, STANDARD,
    difficultyOf, fold, normalizeRules, oddsFor, oddsSubject, outcomeOf, plannerNoteOf, precallPrompt, prepare, presetOf, readSheet, rollPrepared, rulesFromSettings, sameRules, subjectOdds,
} from '../../../src/v2/lean-rpg/index.js';
import { PARTY, character, sheetDomain, skillBlock } from './helpers.js';

const sheetOf = (blocks = PARTY()) => readSheet({ domains: { dataModules: sheetDomain(blocks) } });
const dice = (...values) => () => {
    if (!values.length) throw new Error('the script ran out of dice');
    return values.shift();
};
const calm = (n = 200) => dice(...Array.from({ length: n }, () => 10));
const wessel = (over = {}) => ({ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats', ...over });
const plan = (over = {}) => ({ pace: 'normal', acts: [wessel()], foes: [], checks: [], ...over });

test('Standard is today\'s formula, to the number; Gentle and Harsh move the foe\'s base and the "at a cost" window only', () => {
    assert.deepEqual(STANDARD, { foeBase: FORMULA.foeBase, classWeight: FORMULA.classWeight, statDivisor: FORMULA.statDivisor, costMargin: FORMULA.costMargin, decisiveMargin: LIMITS.decisiveMargin, roundCap: LIMITS.roundCap });
    assert.deepEqual(PRESETS.gentle, { foeBase: 3, classWeight: 2, statDivisor: 2, costMargin: 3, decisiveMargin: 8, roundCap: 5 });
    assert.deepEqual(PRESETS.standard, { foeBase: 5, classWeight: 2, statDivisor: 2, costMargin: 2, decisiveMargin: 8, roundCap: 5 });
    assert.deepEqual(PRESETS.harsh, { foeBase: 7, classWeight: 2, statDivisor: 2, costMargin: 1, decisiveMargin: 8, roundCap: 5 });
    assert.deepEqual(DIFFICULTIES, ['gentle', 'standard', 'harsh', 'custom']);
    assert.ok(Object.isFrozen(PRESETS.standard) && Object.isFrozen(PRESETS));
    assert.deepEqual(Object.keys(normalizeRules()), RULE_KEYS);
});

test('Custom numbers are whole numbers inside their ranges, else Standard\'s; always the same six keys in the same order', () => {
    assert.deepEqual(RULE_RANGES.foeBase, { min: 0, max: 15 });
    assert.deepEqual(RULE_RANGES.decisiveMargin, { min: 4, max: 15 });
    assert.deepEqual(RULE_RANGES.roundCap, { min: 1, max: 8 });
    assert.deepEqual(RULE_RANGES.costMargin, { min: 0, max: 5 });
    assert.deepEqual(normalizeRules({ foeBase: 15, classWeight: 3, statDivisor: 3, costMargin: 0, decisiveMargin: 4, roundCap: 1 }), { foeBase: 15, classWeight: 3, statDivisor: 3, costMargin: 0, decisiveMargin: 4, roundCap: 1 });
    // Out of range, not whole, not a number, missing: Standard's value for that number.
    const bad = normalizeRules({ foeBase: 16, classWeight: 0, statDivisor: 4, costMargin: 2.5, decisiveMargin: '8', roundCap: 9, extra: 1 });
    assert.deepEqual(bad, STANDARD);
    assert.deepEqual(normalizeRules({ roundCap: 3, foeBase: -1 }), { ...STANDARD, roundCap: 3 });
    for (const nothing of [undefined, null, 5, 'x', [], [1]]) assert.deepEqual(normalizeRules(nothing), STANDARD);
    assert.equal(JSON.stringify(normalizeRules({ roundCap: 3, foeBase: 9 })), JSON.stringify(normalizeRules({ foeBase: 9, roundCap: 3 })), 'key order does not depend on how it was given');
});

test('the settings give the numbers: a preset by its word, Custom by its stored numbers, anything else Standard', () => {
    assert.equal(difficultyOf({}), 'standard');
    assert.equal(difficultyOf({ [DIFFICULTY_SETTING]: 'maybe' }), 'standard');
    for (const name of ['gentle', 'standard', 'harsh']) assert.deepEqual(rulesFromSettings({ [DIFFICULTY_SETTING]: name }), PRESETS[name]);
    assert.deepEqual(rulesFromSettings(undefined), STANDARD);
    assert.deepEqual(rulesFromSettings({ [DIFFICULTY_SETTING]: 'custom', [CUSTOM_SETTING]: { foeBase: 11, costMargin: 4, roundCap: 99 } }), { ...STANDARD, foeBase: 11, costMargin: 4 });
    assert.deepEqual(rulesFromSettings({ [DIFFICULTY_SETTING]: 'custom' }), STANDARD, 'Custom with nothing stored');
    assert.deepEqual(rulesFromSettings({ [DIFFICULTY_SETTING]: 'gentle', [CUSTOM_SETTING]: { foeBase: 11 } }), PRESETS.gentle, 'the custom numbers are not read for a preset');
    assert.notEqual(rulesFromSettings({}), STANDARD, 'a copy');
    assert.equal(presetOf(PRESETS.harsh), 'harsh');
    assert.equal(presetOf({ ...STANDARD, roundCap: 4 }), 'custom');
    assert.equal(sameRules(STANDARD, { roundCap: 5 }), true);
    assert.equal(sameRules(STANDARD, PRESETS.harsh), false);
});

test('the odds: Wessel (+9: STR 12, Soul Class I, Adept) against a Class I foe is 69 / 10 / 22 Gentle, 61 / 8 / 31 Standard, 52 / 5 / 43 Harsh', () => {
    const at = rules => oddsFor(rules, { bonus: 9, foeClass: 1 });
    assert.deepEqual(at(PRESETS.gentle), { success: 69, cost: 10, fail: 22 });
    assert.deepEqual(at(PRESETS.standard), { success: 61, cost: 8, fail: 31 });
    assert.deepEqual(at(PRESETS.harsh), { success: 52, cost: 5, fail: 43 });
    assert.deepEqual(at(undefined), at(STANDARD), 'no numbers: Standard');
});

test('the odds agree with the roll itself over every pair of dice, for any numbers', () => {
    for (const rules of [PRESETS.gentle, PRESETS.harsh, { ...STANDARD, foeBase: 15, classWeight: 3, costMargin: 5 }, { ...STANDARD, foeBase: 0, costMargin: 0 }]) {
        for (const [bonus, foeClass] of [[0, 1], [9, 1], [14, 3], [30, 9]]) {
            const counts = { success: 0, cost: 0, fail: 0 };
            for (let pc = 1; pc <= 20; pc += 1) for (let foe = 1; foe <= 20; foe += 1) counts[outcomeOf(pc, pc + bonus, foe + rules.foeBase + rules.classWeight * foeClass, rules)] += 1;
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
    assert.deepEqual(mine, { who: 'Wessel', stat: 'str', statValue: 12, soul: 1, rank: 1, skill: 'Iron Breath', foeClass: 1, rankName: 'Adept', soulName: 'I' });
    assert.deepEqual(subjectOdds(PRESETS.standard, mine), { bonus: 9, success: 61, cost: 8, fail: 31 });
    assert.equal(subjectOdds({ ...STANDARD, statDivisor: 3, classWeight: 3 }, mine).bonus, 4 + 3 + 1, 'a third of the stat, ×3 for the class, plus the rank');
    assert.equal(oddsSubject(sheet, 'Ren', names).who, 'Ren');
    assert.equal(oddsSubject(sheet, 'Ren', names).stat, 'int', 'Ren has no Spark ranked above Novice, so the first skill, and its stat');
    assert.equal(oddsSubject(sheet, 'a stranger', names).who, 'Ren', 'a persona with no block: the first Character block (they are read in block order)');
    assert.equal(oddsSubject(sheet, '', names).who, 'Ren');
    delete party['wessel-skills']; delete party['ren-skills'];
    const bare = oddsSubject(sheetOf(party), 'Wessel', names);
    assert.deepEqual([bare.skill, bare.rank, bare.rankName, bare.stat], [null, 0, '', 'str'], 'no skills: the best stat, untrained');
    assert.equal(oddsSubject(sheetOf({ foes: PARTY().foes }), 'Wessel', names), null, 'no character');
});

test('each number does its work in the roll', () => {
    const sheet = sheetOf();
    const at = (rules, body = plan({ pace: 'careful' }), rolls = dice(14, 9)) => rollPrepared(body, prepare(body, sheet, rules), rolls, rules);
    // The foe's base and what a Soul Class adds (Sluice Rats are Class I, Wessel Class II).
    const hard = at({ ...STANDARD, foeBase: 9, classWeight: 3 }).rounds[0].lines[0];
    assert.deepEqual([hard.foe.base, hard.foe.classBonus, hard.foe.total, hard.pc.classBonus, hard.pc.total], [9, 3, 9 + 9 + 3, 6, 14 + 7 + 6 + 1]);
    // The stat's share: STR 14 counts half (7) or a third (4).
    assert.equal(at(STANDARD).rounds[0].lines[0].pc.statBonus, 7);
    assert.equal(at({ ...STANDARD, statDivisor: 3 }).rounds[0].lines[0].pc.statBonus, 4);
    // "At a cost": the window below the foe's total, and 0 turns it off.
    const outcome = (rules, pcDie) => at(rules, plan({ pace: 'careful' }), dice(pcDie, 9)).rounds[0].lines[0].outcome;
    // Wessel's total is die + 12; the foe's is 9 + 5 + 2 = 16: die 2 is 14, two short.
    assert.equal(outcome(STANDARD, 2), 'cost');
    assert.equal(outcome({ ...STANDARD, costMargin: 1 }, 2), 'fail');
    assert.equal(outcome({ ...STANDARD, costMargin: 0 }, 3), 'fail', 'one short, window 0: a fail');
    assert.equal(outcome({ ...STANDARD, costMargin: 5 }, 2), 'cost');
    assert.equal(outcome({ ...STANDARD, costMargin: 3 }, 2), 'cost');
});

test('the decisive margin and the most exchanges per reply', () => {
    const sheet = sheetOf();
    const body = plan({ pace: 'all' });
    // A margin of 7 each round: Wessel's 12 + 12 = 24 against the foe's 10 + 5 + 2 = 17.
    const run = rules => rollPrepared(body, prepare(body, sheet, rules), calmWith(12, 10), rules);
    const calmWith = (pc, foe) => { let turn = 0; return () => (turn++ % 2 === 0 ? pc : foe); };
    assert.equal(run(STANDARD).rounds.length, 5, 'margin 7 is not decisive at 8: five rounds (the cap)');
    assert.equal(run(STANDARD).stop, 'cap');
    const keen = run({ ...STANDARD, decisiveMargin: 7 });
    assert.deepEqual([keen.rounds.length, keen.stop], [1, 'decisive'], 'at 7 the first round settles it');
    for (const roundCap of [1, 2, 3, 8]) {
        const result = run({ ...STANDARD, roundCap });
        assert.equal(result.rounds.length, roundCap, `cap ${roundCap}`);
    }
    assert.equal(run({ ...STANDARD, roundCap: 8 }).stop === 'pace' || run({ ...STANDARD, roundCap: 8 }).stop === 'budget', true, 'eight rounds: all of the pace, or what the cue budget holds');
    const careful = plan({ pace: 'careful' });
    assert.equal(rollPrepared(careful, prepare(careful, sheet, { ...STANDARD, roundCap: 8 }), calm(), { ...STANDARD, roundCap: 8 }).rounds.length, 1, 'careful is still one');
});

test('with no numbers given, a roll is made with Standard\'s (what it always was)', () => {
    const sheet = sheetOf();
    const body = plan();
    const plain = rollPrepared(body, prepare(body, sheet), calm());
    const standard = rollPrepared(body, prepare(body, sheet, STANDARD), calm(), STANDARD);
    assert.deepEqual(plain, standard);
});

test('the planner\'s extra instructions: tidied, at most 400 characters, after the fixed part and before the party', () => {
    assert.equal(plannerNoteOf({}), '');
    assert.equal(plannerNoteOf({ [NOTE_SETTING]: '  Play it safe.  \r\n\r\n  Talk is free.   ' }), 'Play it safe.\n\n  Talk is free.', 'trimmed, lines kept');
    assert.equal(plannerNoteOf({ [NOTE_SETTING]: 5 }), '');
    assert.equal([...plannerNoteOf({ [NOTE_SETTING]: 'a'.repeat(900) })].length, NOTE_MAX);
    assert.equal([...plannerNoteOf({ [NOTE_SETTING]: '🙂'.repeat(500) })].length, NOTE_MAX, 'never inside a character');
    const sheet = sheetOf();
    const without = precallPrompt({ sheet, message: 'hi' });
    const withNote = precallPrompt({ sheet, message: 'hi', note: 'Companions play it safe.' });
    assert.ok(!without.includes('Player\'s instructions'));
    assert.ok(withNote.includes('\n\nPlayer\'s instructions: Companions play it safe.\n\nParty:'));
    assert.ok(withNote.startsWith(without.slice(0, without.indexOf('\n\nParty:'))), 'the fixed part comes first, unchanged');
    assert.equal(precallPrompt({ sheet, message: 'hi', note: '   ' }), without, 'a blank note adds nothing');
});
