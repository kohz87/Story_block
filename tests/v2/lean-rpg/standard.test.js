// The Standard stat formula's roll engine (src/v2/lean-rpg/standard.js, rules.js, plan.js, precall.js, cue.js): the recorded rules, the
// planner's lines, the typed roll with its breakdown, the bars a hit or a heal moves, the turn order, the opening action, area and support,
// and a whole roll through the real turn. The numbers themselves are formula.js's (formula.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { blocksFor, foeHealthBlocks } from '../../../src/v2/lean-rpg/formula.js';
import { hostAvailable } from '../../../testkit/index.js';
import { LIMITS, PACE, RESOLVE, STAGES, leanRpgGuard, normalizeRules, parsePlanAnswer, positionalDice, prepare, readSheet, rollPrepared, stageWord, validatePlan } from '../../../src/v2/lean-rpg/index.js';
import { FORMULA_SETTING, STANDARD_FORMULA, STANDARD_PRESETS, STANDARD_RULE_KEYS, formulaOf, oddsFor, presetOf, rulesFromSettings, sameRules, PRESETS, subjectOdds, oddsSubject, STANDARD_SETTING, DIFFICULTY_SETTING } from '../../../src/v2/lean-rpg/rules.js';
import { PRECALL_HEAD, PRECALL_HEAD_STANDARD, precallPrompt, sheetText } from '../../../src/v2/lean-rpg/precall.js';
import { cueText } from '../../../src/v2/lean-rpg/cue.js';
import { judge, outcomeStd } from '../../../src/v2/lean-rpg/standard.js';
import { rollsOf } from '../../../src/v2/lean-rpg/resolve.js';
import { hashJson } from '../../../src/v2/replay.js';
import { PARTY, character, foeBlock, rollReceipt, setup, sheetDomain, skillBlock, tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

// ---- helpers ----------------------------------------------------------------------------------------------------------

// Wessel: STR 10, AGI 10, DEX 6, VIT 10 (6 Health blocks), Soul Class II; Ren: INT 16, DEX 10; a foe group of rats, class II (4 blocks).
function party({ foes = [['Sluice Rats', 6, 2, 4]], wessel = {}, ren = {}, skills = {} } = {}) {
    return {
        wessel: { role: 'character', fields: character('Wessel', { health: 6, str: 10, vit: 10, agi: 10, dex: 6, int: 5, luk: 9, cha: 5, soul: 2, ...wessel }) },
        'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', skills.wessel ?? [['Iron Breath', 2, 'str'], ['Spark', 0, 'int', 'mana']]) },
        ren: { role: 'character', fields: character('Ren', { health: 5, str: 5, vit: 5, agi: 8, dex: 10, int: 16, luk: 9, cha: 5, soul: 2, ...ren }) },
        'ren-skills': { role: 'skills', fields: skillBlock('Ren', skills.ren ?? [['Spark', 1, 'int', 'mana'], ['Mend', 0, 'int', 'mana']]) },
        foes: { role: 'foes', fields: foeBlock(foes) },
    };
}
const sheetOf = (blocks = party()) => readSheet({ domains: { dataModules: sheetDomain(blocks) } });
const std = (over = {}) => ({ ...STANDARD_FORMULA, ...over });
// Scripted dice: { 'act0': [pc, foe, …], 'foe0': […], 'init0': […] } by kind and place in the plan (init: character index, 16 + slot for a foe).
const dice = (table = {}, fallback = 10) => (kind, at) => {
    const list = [...(table[`${kind}${at}`] ?? [])];
    return () => (list.length ? list.shift() : fallback);
};
const planOf = (over = {}) => ({ formula: 'standard', pace: 'normal', acts: [], foes: [], checks: [], ...over });
const roll = (plan, { blocks = party(), rules = std(), source = dice(), carried = null } = {}) => {
    const sheet = sheetOf(blocks), prepared = prepare(plan, sheet, rules);
    return { sheet, prepared, result: rollPrepared(plan, prepared, source, rules, { carried }) };
};
const hit = { who: 'Wessel', skill: 'Iron Breath', target: 'Sluice Rats' };
// The bars a hit or a heal moved (a skill's cost also moves Stamina or Mana: see the cost tests).
const bodies = hurts => hurts.filter(item => item.field === 'health' || /^hurt/.test(item.field));

// ---- the recorded rules -----------------------------------------------------------------------------------------------

test('the setting picks the formula: Standard unless the reader chose Classic', () => {
    assert.equal(formulaOf({}), 'standard');
    assert.equal(formulaOf(undefined), 'standard');
    assert.equal(formulaOf({ [FORMULA_SETTING]: 'standard' }), 'standard');
    assert.equal(formulaOf({ [FORMULA_SETTING]: 'classic' }), 'classic');
    assert.equal(formulaOf({ [FORMULA_SETTING]: 'nonsense' }), 'standard');
});

test('Standard carries its formula and numbers in the rules; Gentle, Standard and Harsh move only the foe\'s base; Classic has no formula key', () => {
    const rules = difficulty => rulesFromSettings({ [DIFFICULTY_SETTING]: difficulty });
    assert.deepEqual(Object.keys(rules('standard')), [...STANDARD_RULE_KEYS]);
    assert.equal(rules('standard').formula, 'standard');
    assert.deepEqual(['gentle', 'standard', 'harsh'].map(name => rules(name).foeBase), [2, 4, 6]);
    for (const key of STANDARD_RULE_KEYS.filter(key => key !== 'foeBase')) assert.equal(rules('gentle')[key], rules('harsh')[key], key);
    assert.deepEqual(rules('standard'), { ...STANDARD_FORMULA });
    // formula.js's own numbers are the starting point: only the preset's foeBase differs from them.
    assert.deepEqual({ ...rules('standard'), foeBase: 3 }, { formula: 'standard', foeBase: 3, foeClassWeight: 3, classWeight: 2, costMargin: 2, decisiveMargin: 8, roundCap: 5,
        startStat: 5, createPoints: 10, createMin: 3, createMax: 10, pointsPerSoul: 4, statMax: 20, quickStartMargin: 10 });
    const classic = rulesFromSettings({ [FORMULA_SETTING]: 'classic', [DIFFICULTY_SETTING]: 'harsh' });
    assert.deepEqual(classic, PRESETS.harsh);
    assert.equal('formula' in classic, false);
});

test('Custom Standard numbers are each held to their range, and the creation numbers must agree', () => {
    const custom = given => rulesFromSettings({ [DIFFICULTY_SETTING]: 'custom', [STANDARD_SETTING]: given });
    assert.deepEqual(custom({ foeBase: 9, quickStartMargin: 6, pointsPerSoul: 3 }), { ...STANDARD_FORMULA, foeBase: 9, quickStartMargin: 6, pointsPerSoul: 3 });
    assert.equal(custom({ foeBase: 99 }).foeBase, STANDARD_FORMULA.foeBase, 'out of range: the preset\'s');
    assert.equal(custom({ foeClassWeight: 0 }).foeClassWeight, STANDARD_FORMULA.foeClassWeight);
    assert.equal(custom({ foeBase: 'x' }).foeBase, STANDARD_FORMULA.foeBase);
    assert.equal(custom({ createMin: 9, startStat: 5 }).createMin, 3, 'a lowest stat above the start is not kept');
    assert.deepEqual(custom(undefined), { ...STANDARD_FORMULA });
    assert.equal(custom({ formula: 'classic' }).formula, 'standard');
});

test('normalizeRules: a payload without a formula is Classic (six keys), whatever else it says; with Standard it is the nine numbers and the shared four', () => {
    assert.deepEqual(Object.keys(normalizeRules({ foeBase: 7 })), ['foeBase', 'classWeight', 'statDivisor', 'costMargin', 'decisiveMargin', 'roundCap']);
    assert.deepEqual(normalizeRules({ formula: 'classic', foeBase: 7 }), normalizeRules({ foeBase: 7 }));
    assert.deepEqual(normalizeRules(undefined), PRESETS.standard);
    assert.deepEqual(normalizeRules({ formula: 'standard' }), { ...STANDARD_FORMULA });
    assert.deepEqual(normalizeRules({ formula: 'standard', foeBase: 5, junk: 1 }), { ...STANDARD_FORMULA, foeBase: 5 });
    assert.equal(hashJson(normalizeRules(PRESETS.gentle)), hashJson(PRESETS.gentle), 'a Classic set is its own normal form, so old payloads hash as before');
    assert.equal(hashJson(normalizeRules(STANDARD_PRESETS.harsh)), hashJson(STANDARD_PRESETS.harsh));
});

test('sameRules and presetOf tell the presets of each formula apart', () => {
    assert.equal(presetOf(STANDARD_PRESETS.harsh), 'harsh');
    assert.equal(presetOf(PRESETS.harsh), 'harsh');
    assert.equal(presetOf({ ...STANDARD_PRESETS.standard, foeBase: 5 }), 'custom');
    assert.equal(sameRules(STANDARD_PRESETS.standard, PRESETS.standard), false);
    assert.equal(sameRules(STANDARD_PRESETS.gentle, { ...STANDARD_PRESETS.gentle }), true);
});

test('the odds bar follows the formula in force: Standard puts the pair, the Soul Class and the rank against foeBase + 3 × class', () => {
    // Wessel, Iaijutsu-like: STR 10 + DEX 6/2, halved = 6, Soul Class II 4, Expert 2 → +12 against a class-II foe at base 4: 4 + 6 = 10.
    const rules = STANDARD_PRESETS.standard;
    const odds = oddsFor(rules, { bonus: 12, foeClass: 2 });
    let success = 0;
    for (let mine = 1; mine <= 20; mine += 1) for (let theirs = 1; theirs <= 20; theirs += 1) if (judge(mine, mine + 12, theirs, theirs + 10, rules).outcome === 'success') success += 1;
    assert.equal(odds.success, Math.round(success / 4));
    const subject = oddsSubject(sheetOf(), 'Wessel', { rankNames: ['Novice', 'Adept', 'Expert', 'Master'], soulNames: ['I', 'II'], fold: text => String(text).toLowerCase(), standard: true });
    assert.equal(subject.uses, 'stamina');
    const given = subjectOdds(rules, subject);
    assert.equal(given.bonus, 6 + 4 + 2, 'pair(10, 6) + Class II + Expert');
    assert.equal(given.success, odds.success);
    // Classic keeps its own bonus for the same subject.
    assert.equal(subjectOdds(PRESETS.standard, oddsSubject(sheetOf(), 'Wessel', { rankNames: [], soulNames: [], fold: text => String(text).toLowerCase() })).bonus, 5 + 4 + 2);
});

// ---- Classic stays byte for byte --------------------------------------------------------------------------------------

test('Classic output is byte-identical to the build before the Standard formula: prompt, sheet text, cue, rounds, witness, parse, rules', () => {
    // (Fingerprints taken from the build that holds formula.js only, c072d16, for this fixed party, plan and seed.)
    const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
    const sheet = sheetOf(PARTY());
    const prompt = precallPrompt({ sheet, message: 'I strike the rat.', excerpt: 'The rat hisses.', note: 'Be fair.' });
    const plan = { pace: 'normal', acts: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats', edge: 2, why: 'ambush' }, { who: 'Ren', skill: 'Spark', uses: 'mana', stat: 'int', target: 'Sluice Rats' }],
        foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }], checks: [{ who: 'Ren', stat: 'int', difficulty: 'hard' }] };
    const prepared = prepare(plan, sheet);
    const rolled = rollPrepared(plan, prepared, positionalDice(987654), PRESETS.standard);
    const answer = ['pace: all', 'act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats | edge: +2 ambush', 'foe Sluice Rats | target: Wessel | defend: AGI | skill: Iron Breath', 'check Ren | stat: INT | difficulty: hard'].join('\n');
    assert.deepEqual({
        prompt: sha(prompt), head: sha(PRECALL_HEAD), sheet: sha(sheetText(sheet)), cue: sha(rolled.text), rounds: sha(JSON.stringify(rolled.rounds)), witness: sha(JSON.stringify(prepared.witness)),
        parsed: sha(JSON.stringify(parsePlanAnswer(answer, sheet))), rules: sha(JSON.stringify(rulesFromSettings({ [FORMULA_SETTING]: 'classic', [DIFFICULTY_SETTING]: 'harsh' }))), presets: sha(JSON.stringify(PRESETS)),
    }, {
        prompt: '7a7e03371be22c46', head: '863ad8c46ed239f8', sheet: '0d382a6e9c87a18d', cue: '581fec519ba585d9', rounds: '4790ebdd2f084e80', witness: '9cc7432def3e988b',
        parsed: 'b0eedb0e4d7e0c16', rules: '0816289d883327a2', presets: '0a416a8d4dfe24d2',
    });
});

// ---- the plan ---------------------------------------------------------------------------------------------------------

test('a Standard plan carries a type, a fitting stat, area and support, and needs no stat or defend; Classic plans refuse those keys', () => {
    const ok = planOf({ acts: [{ who: 'Wessel', target: 'Rats' }, { who: 'Ren', skill: 'Spark', type: 'magic', area: true, target: 'Rats' }, { who: 'Ren', skill: 'Mend', support: true, difficulty: 'normal', target: 'Wessel' }],
        foes: [{ slot: 1, target: 'Wessel', againstMagic: true }], checks: [{ who: 'Wessel', type: 'check', fit: 'agi', difficulty: 'hard' }] });
    assert.deepEqual(validatePlan(ok), { ok: true, errors: [] });
    const bad = (change, text) => assert.match(validatePlan(planOf(change)).errors.join(' '), text);
    bad({ acts: [{ who: 'W', target: 'R', type: 'defence' }] }, /type must be one of physical, magic, social, check/);
    bad({ acts: [{ who: 'W', target: 'R', support: true }] }, /needs difficulty/);
    bad({ acts: [{ who: 'W', target: 'R', area: true, support: true, difficulty: 'easy' }] }, /both support and area/);
    bad({ acts: [{ who: 'W', target: 'R', difficulty: 'easy' }] }, /only a support action/);
    bad({ acts: [{ who: 'W', target: 'R', fit: 'luck' }] }, /fit to be one of/);
    bad({ foes: [{ slot: 1, target: 'W', againstMagic: 'yes' }] }, /againstMagic must be true/);
    bad({ checks: [{ who: 'W', type: 'physical', difficulty: 'easy' }] }, /type must be social or check/);
    assert.match(validatePlan({ ...planOf(), formula: 'classic' }).errors.join(' '), /formula must be standard/);
    // A Classic plan: the new keys are not its keys, and its stat and defend are still asked for.
    const classic = change => validatePlan({ pace: 'normal', acts: [], foes: [], checks: [], ...change });
    assert.match(classic({ acts: [{ who: 'W', target: 'R', stat: 'str', type: 'physical' }] }).errors.join(' '), /"type", which a plan does not use/);
    assert.match(classic({ acts: [{ who: 'W', target: 'R' }] }).errors.join(' '), /needs stat/);
    assert.match(classic({ foes: [{ slot: 1, target: 'W' }] }).errors.join(' '), /needs defend/);
});

test('the planner\'s Standard lines read into a plan against the sheet; a Classic read of the same answer is untouched', () => {
    const sheet = sheetOf(party());
    const answer = [
        'pace: all',
        'act Wessel | skill: Iron Breath | type: physical | target: Sluice Rats | edge: +2 ambush',
        'act Ren | skill: Spark | type: magic | target: Sluice Rats | area',
        'act Ren | skill: Mend | type: magic | target: Wessel | support: hard',
        'act Wessel | type: social | target: Sluice Rats',
        'foe Sluice Rats | target: Ren | magic',
        'check Wessel | type: check | fit: AGI | difficulty: hard',
        'check Ren | skill: Spark | type: social | difficulty: easy',
    ].join('\n');
    const { plan, dropped } = parsePlanAnswer(answer, sheet, { formula: 'standard' });
    assert.equal(dropped, 0);
    assert.deepEqual(plan, {
        formula: 'standard', pace: 'all',
        acts: [
            { who: 'Wessel', skill: 'Iron Breath', type: 'physical', target: 'Sluice Rats', edge: 2, why: 'ambush' },
            { who: 'Ren', skill: 'Spark', type: 'magic', area: true, target: 'Sluice Rats' },
            { who: 'Ren', skill: 'Mend', type: 'magic', support: true, difficulty: 'hard', target: 'Wessel' },
            { who: 'Wessel', type: 'social', target: 'Sluice Rats' },
        ],
        foes: [{ slot: 1, target: 'Ren', againstMagic: true }],
        checks: [{ who: 'Wessel', type: 'check', fit: 'agi', difficulty: 'hard' }, { who: 'Ren', skill: 'Spark', type: 'social', difficulty: 'easy' }],
    });
    assert.deepEqual(validatePlan(plan), { ok: true, errors: [] });
    // A support line whose target is not on the party is dropped; a bare `support` is a normal difficulty.
    const odd = parsePlanAnswer('act Ren | skill: Mend | target: Nobody | support\nact Ren | skill: Mend | target: Wessel | support', sheet, { formula: 'standard' });
    assert.equal(odd.dropped, 1);
    assert.deepEqual(odd.plan.acts, [{ who: 'Ren', skill: 'Mend', support: true, difficulty: 'normal', target: 'Wessel' }]);
    // Classic reads the same answer as before: no type, no fit, no area.
    const classic = parsePlanAnswer('act Wessel | skill: Iron Breath | type: physical | target: Sluice Rats | area', sheet);
    assert.deepEqual(classic.plan.acts, [{ who: 'Wessel', skill: 'Iron Breath', target: 'Sluice Rats' }]);
    assert.equal('formula' in classic.plan, false);
});

test('the Standard planner prompt asks for a type, not a stat; it is no longer than it must be, and a Classic chat gets the Classic prompt', () => {
    const sheet = sheetOf(party());
    assert.match(PRECALL_HEAD_STANDARD, /type: physical\|magic\|social\|check/);
    assert.doesNotMatch(PRECALL_HEAD_STANDARD, /defend:/);
    assert.ok(PRECALL_HEAD_STANDARD.length <= PRECALL_HEAD.length * 1.05, `${PRECALL_HEAD_STANDARD.length} against ${PRECALL_HEAD.length}`);
    const input = { sheet, message: 'I attack.', excerpt: '' };
    assert.ok(precallPrompt({ ...input, standard: true }).startsWith(PRECALL_HEAD_STANDARD));
    assert.ok(precallPrompt(input).startsWith(PRECALL_HEAD));
    assert.equal(precallPrompt({ ...input, standard: false }), precallPrompt(input));
    // The sheet in blocks (the words are spread over the bar like the Party tab's): Health 6 of 6 is Unhurt, 3 of 6 Hurt, and the rats' 3 of 4 blocks read the same way.
    // (what readSheet gives for blocks of the Standard formula: the size of each bar next to the blocks left)
    const sized = sheet => ({ ...sheet, characters: sheet.characters.map(item => ({ ...item, size: blocksFor(item.stats) })), foes: sheet.foes.map(item => ({ ...item, size: foeHealthBlocks(item.class) })) });
    const hurt = sized(sheetOf(party({ wessel: { health: 3 }, foes: [['Sluice Rats', 6, 2, 3]] })));
    assert.match(sheetText(hurt, { standard: true }), /Wessel \(class II\): STR 10 VIT 10 AGI 10 DEX 6 INT 5 LUK 9 CHA 5; Health Hurt/);
    assert.match(sheetText(hurt, { standard: true }), /1\. Sluice Rats x6 \(class II, Scratched\)/);
    assert.match(sheetText(sized(sheetOf(party())), { standard: true }), /Health Unhurt/);
});

// ---- the typed roll ---------------------------------------------------------------------------------------------------

test('a physical roll: (skill stat + DEX/2)/2 + Soul Class + rank against d20 + foeBase + 3 × class, and a hit takes 1 block', () => {
    const { result, sheet } = roll(planOf({ pace: 'careful', acts: [hit] }), { source: dice({ act0: [14, 9] }) });
    const [line] = result.rounds[0].lines;
    assert.deepEqual(line.pc, { who: 'Wessel', type: 'physical', stat: 'str', second: 'dex', mainValue: 10, secondValue: 6, statBonus: 6, classValue: 2, classBonus: 4, rank: 2, window: { min: -1, max: 3 }, situation: 0, edge: 0, die: 14, total: 26 });
    assert.deepEqual(line.foe, { slot: 1, name: 'Sluice Rats', base: 4, classValue: 2, classBonus: 6, die: 9, total: 19 });
    assert.equal(line.outcome, 'success');
    assert.equal(line.decisive, false);
    assert.deepEqual(line.damage, { id: 'f:1', kind: 'foe', name: 'Sluice Rats', blocks: 1, from: 4, to: 3, size: 4 });
    assert.deepEqual(bodies(result.hurts), [{ id: 'f:1', kind: 'foe', name: 'Sluice Rats', module: 'pack.chat/foes', field: 'hurt1', from: 4, to: 3, size: 4 }]);
    assert.match(result.text, /Round 1: Wessel → Sluice Rats \(Iron Breath\): SUCCESS \(26 vs 19\), a hit/);
    assert.equal(sheet.characters.find(item => item.who === 'Wessel').health, 6, 'the roll reads the sheet and never writes it');
});

test('a decisive hit takes 2 blocks: the winner\'s natural 20, the loser\'s natural 1 or a lead of 8; the bar never goes below 0', () => {
    const one = (dieValues, foes = [['Sluice Rats', 6, 2, 5]]) => roll(planOf({ pace: 'careful', acts: [hit] }), { blocks: party({ foes }), source: dice({ act0: dieValues }) }).result;
    assert.equal(one([20, 10]).rounds[0].lines[0].damage.blocks, 2, 'natural 20');
    assert.equal(one([12, 1]).rounds[0].lines[0].damage.blocks, 2, 'the foe rolled a 1');
    assert.equal(one([18, 10]).rounds[0].lines[0].damage.blocks, 2, 'a lead of 10: 30 against 20');
    assert.equal(one([14, 10]).rounds[0].lines[0].damage.blocks, 1, '26 against 20');
    const last = one([20, 10], [['Sluice Rats', 6, 2, 1]]);
    assert.deepEqual(bodies(last.hurts).map(({ from, to }) => [from, to]), [[1, 0]]);
    assert.equal(last.rounds[0].lines[0].damage.blocks, 1, 'only the block that was left');
    assert.equal(last.stop, 'decisive');
});

test('success at a cost lands the hit; a fail takes no block from the foe, even a decisive one', () => {
    const one = dieValues => roll(planOf({ pace: 'careful', acts: [hit] }), { source: dice({ act0: dieValues }) }).result.rounds[0].lines[0];
    const cost = one([8, 10]);              // 8 + 12 = 20 against 20 is a success; 7 + 12 = 19 against 20 is at a cost
    assert.equal(cost.outcome, 'success');
    const near = one([7, 10]);
    assert.equal(near.outcome, 'cost');
    assert.equal(near.damage.blocks, 1);
    const fail = one([2, 20]);
    assert.equal(fail.outcome, 'fail');
    assert.equal(fail.decisive, true);
    assert.equal(fail.damage, undefined);
});

test('magic uses INT (or the skill\'s stat) with half DEX; a skill uses its own stat in the main slot; nothing is added on top', () => {
    const magic = roll(planOf({ pace: 'careful', acts: [{ who: 'Ren', skill: 'Spark', target: 'Sluice Rats' }] }), { source: dice({ act0: [10, 10] }) }).result.rounds[0].lines[0];
    assert.equal(magic.type, 'magic', 'a Mana skill is magic');
    assert.deepEqual([magic.pc.stat, magic.pc.second, magic.pc.statBonus, magic.pc.rank, magic.pc.classBonus], ['int', 'dex', 10, 1, 4]);
    assert.equal(magic.pc.total, 10 + 10 + 4 + 1);
    // A stamina skill is physical even when the planner said magic; a skill with another stat puts it in the main slot.
    const blocks = party({ skills: { wessel: [['Fleet Cut', 1, 'agi']] } });
    const agi = roll(planOf({ pace: 'careful', acts: [{ who: 'Wessel', skill: 'Fleet Cut', type: 'magic', target: 'Sluice Rats' }] }), { blocks, source: dice({ act0: [10, 10] }) }).result.rounds[0].lines[0];
    assert.deepEqual([agi.type, agi.pc.stat, agi.pc.second, agi.pc.statBonus], ['physical', 'agi', 'dex', 6]);
    // With no skill the plan's physical or magic decides, and the type's own stat is used.
    const bare = roll(planOf({ pace: 'careful', acts: [{ who: 'Ren', type: 'magic', target: 'Sluice Rats' }] })).result.rounds[0].lines[0];
    assert.deepEqual([bare.type, bare.pc.stat, bare.skill, bare.pc.rank], ['magic', 'int', null, 0]);
});

test('social and check rolls: CHA + INT/2 and the fitting stat + DEX/2; a social or check act against a foe harms nobody', () => {
    const talk = roll(planOf({ pace: 'careful', acts: [{ who: 'Wessel', type: 'social', target: 'Sluice Rats' }] }), { source: dice({ act0: [19, 10] }) }).result;
    const [line] = talk.rounds[0].lines;
    assert.deepEqual([line.type, line.pc.stat, line.pc.second, line.pc.statBonus, line.outcome, line.damage], ['social', 'cha', 'int', 3, 'success', undefined]);
    assert.deepEqual(talk.hurts, []);
    const check = roll(planOf({ checks: [{ who: 'Wessel', type: 'check', fit: 'agi', difficulty: 'normal' }] }), { source: dice({ check0: [9] }) }).result.checks[0];
    assert.deepEqual([check.type, check.pc.stat, check.pc.second, check.pc.statBonus, check.dc, check.pc.total, check.outcome], ['check', 'agi', 'dex', 6, 15, 9 + 6 + 4, 'success']);
    const lore = roll(planOf({ checks: [{ who: 'Ren', type: 'social', difficulty: 'hard' }] })).result.checks[0];
    assert.deepEqual([lore.pc.stat, lore.pc.second], ['cha', 'int']);
});

test('defence: the higher of AGI and VIT leads (a tie dodges), a spell is warded with INT or VIT; a hit on the defender takes 1 block, 2 when decisive', () => {
    const foe = target => planOf({ pace: 'careful', foes: [{ slot: 1, target, ...(target === 'Ren' ? { againstMagic: true } : {}) }], acts: [{ who: 'Wessel', skill: 'Iron Breath', target: 'Sluice Rats' }] });
    const tie = roll(foe('Wessel'), { source: dice({ foe0: [5, 12] }) }).result;
    const line = tie.rounds[0].lines.find(item => item.kind === 'foe');
    assert.deepEqual([line.type, line.pc.stat, line.pc.second, line.pc.style, line.pc.statBonus], ['defence', 'agi', 'vit', 'dodge', 7]);
    assert.equal(line.pc.total, 5 + 7 + 4);
    assert.equal(line.foe.total, 12 + 10);
    assert.equal(line.outcome, 'fail');
    assert.deepEqual(line.damage, { id: 'c:wessel', kind: 'char', name: 'Wessel', blocks: 1, from: 6, to: 5, size: 6 });
    assert.match(tie.text, /Sluice Rats attacks Wessel: FAIL for Wessel \(16 vs 22\), hits Wessel/);
    const heavy = roll(foe('Wessel'), { source: dice({ foe0: [3, 18] }) }).result.rounds[0].lines.find(item => item.kind === 'foe');
    assert.deepEqual([heavy.decisive, heavy.damage.blocks, heavy.damage.to], [true, 2, 4]);
    // VIT 14 leads over AGI 10: block. Against a spell Ren's INT 16 wards (second VIT 5); Wessel's INT 5 is below VIT 10, so he blocks.
    const block = roll(foe('Wessel'), { blocks: party({ wessel: { vit: 14 } }) }).result.rounds[0].lines.find(item => item.kind === 'foe');
    assert.deepEqual([block.pc.style, block.pc.stat, block.pc.second], ['block', 'vit', 'agi']);
    const ward = roll(foe('Ren')).result.rounds[0].lines.find(item => item.kind === 'foe');
    assert.deepEqual([ward.pc.style, ward.pc.stat, ward.pc.second, ward.pc.statBonus], ['ward', 'int', 'vit', 9]);
    const stopped = roll(foe('Wessel'), { source: dice({ foe0: [15, 5] }) }).result.rounds[0].lines.find(item => item.kind === 'foe');
    assert.equal(stopped.damage, undefined, 'a defence that holds takes nothing');
    assert.deepEqual(roll(foe('Wessel'), { source: dice({ foe0: [15, 5] }) }).result.hurts.filter(item => item.kind === 'char' && item.field === 'health'), []);
});

test('luck is a window on the edge: the situation\'s edge is held inside LUK\'s window and a best case reaches its top', () => {
    const edge = (luk, asked) => roll(planOf({ pace: 'careful', acts: [{ ...hit, edge: asked }] }), { blocks: party({ wessel: { luk } }), source: dice({ act0: [10, 10] }) }).result.rounds[0].lines[0].pc;
    // LUK 13: +1..+4. A best case (+3) is +4, a bad situation is lifted to +1, and the total carries the edge after the window.
    assert.deepEqual([edge(13, 3).window, edge(13, 3).situation, edge(13, 3).edge, edge(13, 3).total], [{ min: 1, max: 4 }, 3, 4, 10 + 12 + 4]);
    assert.deepEqual([edge(13, -2).edge, edge(13, 0).edge, edge(13, 2).edge], [1, 1, 2]);
    // LUK 5 (a fresh character): −2..+3.
    assert.deepEqual([-3, -2, 0, 3].map(asked => edge(5, asked).edge), [-2, -2, 0, 3]);
    assert.deepEqual([edge(3, -3).edge, edge(4, -3).edge, edge(7, -3).edge, edge(9, -3).edge, edge(11, -3).edge, edge(19, -3).edge, edge(19, 3).edge, edge(17, 3).edge], [-3, -3, -1, -1, 0, 3, 5, 5]);
    assert.equal(edge(9, 3).window.max, 3);
});

test('out of the resource: no skill, rank 0 and the type\'s own stat, and the cue says so; a skill the character lacks is rolled untrained', () => {
    const blocks = party({ ren: { mana: 0 } });
    const { result, prepared } = roll(planOf({ pace: 'careful', acts: [{ who: 'Ren', skill: 'Spark', type: 'magic', target: 'Sluice Rats' }] }), { blocks });
    const line = result.rounds[0].lines[0];
    assert.deepEqual([line.skill, line.pc.rank, line.pc.stat], [null, 0, 'int']);
    assert.deepEqual(prepared.refused.map(entry => entry.text), ['Ren cannot use Spark (Mana Empty): rolled without it.']);
    assert.match(result.text, /Ren cannot use Spark \(Mana Empty\): rolled without it\./);
    const stamina = roll(planOf({ pace: 'careful', acts: [hit] }), { blocks: party({ wessel: { stamina: 0 } }) }).result.rounds[0].lines[0];
    assert.deepEqual([stamina.skill, stamina.pc.rank, stamina.pc.stat], [null, 0, 'str']);
    const lacks = roll(planOf({ pace: 'careful', acts: [{ who: 'Wessel', skill: 'Fireball', type: 'magic', target: 'Sluice Rats' }] }));
    assert.deepEqual(lacks.prepared.refused.map(entry => entry.text), ['Wessel has no skill called Fireball: rolled untrained.']);
    assert.deepEqual([lacks.result.rounds[0].lines[0].type, lacks.result.rounds[0].lines[0].pc.stat], ['magic', 'int']);
});

test('area: one attack roll against each foe\'s own roll; the bars of each move on their own', () => {
    const foes = [['Rats', 2, 1, 4], ['Drake', 1, 2, 4]];
    const { result } = roll(planOf({ pace: 'careful', acts: [{ who: 'Ren', skill: 'Spark', area: true, target: 'Rats' }] }), { blocks: party({ foes }), source: dice({ act0: [12, 3, 17] }) });
    const lines = result.rounds[0].lines;
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map(line => line.area), [true, true]);
    assert.deepEqual(lines.map(line => line.pc.die), [12, 12], 'one roll');
    assert.deepEqual(lines.map(line => line.foe.die), [3, 17], 'against their own');
    assert.deepEqual(lines.map(line => line.outcome), ['success', 'success']);
    assert.deepEqual(lines.map(line => [line.foe.name, line.damage?.to]), [['Rats', 2], ['Drake', 3]]);
    // (Ren's 12 + 15 = 27 beats the Rats' 10 by 17, a decisive hit of 2 blocks, and just reaches the Drake's 17 + 10 = 27 for 1)
    assert.match(result.text, /Ren → Drake \(Spark\) \(area\)/);
});

test('support: a roll against a difficulty heals 1 block (2 decisive), never past the bar, nothing on a fail', () => {
    const mend = difficulty => planOf({ pace: 'careful', acts: [{ who: 'Ren', skill: 'Mend', support: true, difficulty, target: 'Wessel' }] });
    const heal = (wessel, dieValue, difficulty = 'normal') => roll(mend(difficulty), { blocks: party({ wessel }), source: dice({ act0: [dieValue, 10] }) }).result;
    const line = heal({ health: 3 }, 6).rounds[0].lines[0];          // 6 + (10 + 4 + 0) = 20 against 15
    assert.deepEqual([line.kind, line.support, line.target, line.outcome, line.dc, line.pc.total], ['check', true, 'Wessel', 'success', 15, 20]);
    assert.deepEqual(line.damage, { id: 'c:wessel', kind: 'char', name: 'Wessel', blocks: -1, from: 3, to: 4, size: 6 });
    assert.match(heal({ health: 3 }, 6).text, /Ren → Wessel \(Mend, support\): SUCCESS \(20 vs 15\), heals/);
    assert.equal(heal({ health: 3 }, 20).rounds[0].lines[0].damage.to, 5, 'a decisive heal gives 2');
    assert.deepEqual(heal({ health: 5 }, 20).rounds[0].lines[0].damage, { id: 'c:wessel', kind: 'char', name: 'Wessel', blocks: -1, from: 5, to: 6, size: 6 }, 'clamped to the bar');
    assert.equal(heal({ health: 6 }, 20).rounds[0].lines[0].damage, undefined, 'a full bar heals nothing');
    assert.equal(heal({ health: 3 }, 1).rounds[0].lines[0].damage, undefined, 'a fail heals nothing');
    assert.deepEqual(bodies(heal({ health: 0 }, 5).hurts).map(({ from, to }) => [from, to]), [[0, 1]], 'someone who is Down can be mended');
    assert.equal(heal({ health: 3 }, 5, 'hard').rounds[0].lines[0].outcome, 'cost', '19 against 20 is at a cost, and it still heals');
    assert.equal(heal({ health: 3 }, 5, 'hard').rounds[0].lines[0].damage.to, 4);
});

// ---- the fight: turn order, the opening action, who acts ---------------------------------------------------------------

// (Characters are numbered in sheet order, which is block order: Ren 0, Wessel 1; a foe group is 16 + its slot: the rats are 17.)
const two = { acts: [hit, { who: 'Ren', skill: 'Spark', target: 'Sluice Rats' }], foes: [{ slot: 1, target: 'Wessel' }] };

test('the turn order is d20 + class + AGI/2 (foes d20 + 2 × class), ties to the higher AGI then the party, and is recorded with every total', () => {
    const { result } = roll(planOf({ pace: 'careful', ...two }), { source: dice({ init0: [10], init1: [10], init17: [10] }) });
    assert.deepEqual(result.order.map(({ id, name, total, die, bonus, agi, party, fresh }) => ({ id, name, total, die, bonus, agi, party, fresh })), [
        { id: 'c:wessel', name: 'Wessel', total: 19, die: 10, bonus: 9, agi: 10, party: true, fresh: true },
        { id: 'c:ren', name: 'Ren', total: 18, die: 10, bonus: 8, agi: 8, party: true, fresh: true },
        { id: 'f:1', name: 'Sluice Rats', total: 14, die: 10, bonus: 4, agi: 0, party: false, fresh: true },
    ]);
    assert.match(result.text, /Turn order: Wessel, Ren, Sluice Rats\./);
    const tie = roll(planOf({ pace: 'careful', ...two }), { source: dice({ init0: [11], init1: [10], init17: [15] }) }).result.order.map(entry => entry.id);
    assert.deepEqual(tie, ['c:wessel', 'c:ren', 'f:1'], 'all three on 19: the higher AGI, then the party');
    const rats = roll(planOf({ pace: 'careful', ...two }), { source: dice({ init0: [1], init1: [1], init17: [20] }) }).result.order.map(entry => entry.id);
    assert.deepEqual(rats, ['f:1', 'c:wessel', 'c:ren']);
    // The rounds follow the order: the rats strike first when they win it.
    const first = roll(planOf({ pace: 'careful', ...two }), { source: dice({ init0: [1], init1: [1], init17: [20] }) }).result.rounds[0].lines.map(line => line.kind);
    assert.deepEqual(first, ['foe', 'act', 'act']);
});

test('a fight keeps its order across replies: the carried order is used as it is, a late arrival rolls on entry, a different fight rolls anew', () => {
    const carried = [{ id: 'f:1', name: 'Sluice Rats', total: 30, die: 26, bonus: 4, agi: 0, party: false }, { id: 'c:wessel', name: 'Wessel', total: 5, agi: 10, party: true }];
    const { result } = roll(planOf({ pace: 'careful', ...two }), { carried, source: dice({ init0: [20] }) });
    assert.deepEqual(result.order.map(entry => [entry.id, entry.total, entry.fresh]), [['f:1', 30, false], ['c:ren', 28, true], ['c:wessel', 5, false]], 'Ren arrives late: 20 + 8');
    assert.deepEqual(result.quickStart, [], 'a quick start is for the start of a fight');
    assert.deepEqual(result.opening, []);
    // The same names under other slots, or another group in the slot, is another fight.
    const other = roll(planOf({ pace: 'careful', ...two }), { carried: [{ ...carried[0], name: 'Weir-drake' }, carried[1]], source: dice({ init17: [10] }) }).result;
    assert.ok(other.order.every(entry => entry.fresh));
    // Nobody who is beaten is in the order.
    const beaten = roll(planOf({ pace: 'careful', ...two }), { blocks: party({ foes: [['Sluice Rats', 6, 2, 0]] }) }).result;
    assert.deepEqual(beaten.order.map(entry => entry.id).sort(), ['c:ren', 'c:wessel']);
});

test('quick start: a character 10 ahead of a foe in the order acts once against it before round 1, at the start of the fight only', () => {
    const plan = planOf({ pace: 'careful', acts: [hit], foes: [{ slot: 1, target: 'Wessel' }] });
    const { result } = roll(plan, { source: dice({ init1: [20], init17: [1], open0: [15, 10] }) });
    assert.deepEqual(result.quickStart, [{ who: 'Wessel', against: 'Sluice Rats' }]);
    assert.equal(result.opening.length, 1);
    const [opening] = result.opening;
    assert.deepEqual([opening.opening, opening.pc.die, opening.foe.die, opening.outcome, opening.damage.to], [true, 15, 10, 'success', 3]);
    assert.match(result.text, /Wessel is quick enough to act first against Sluice Rats \(an opening action\)\.\nOpening: Wessel → Sluice Rats \(Iron Breath\): SUCCESS \(27 vs 20\), a hit/);
    // The opening hit and the round's hit both count: 5 → 4 → 3 (round 1: default dice 10 against 10).
    assert.deepEqual(result.hurts.find(item => item.id === 'f:1'), { id: 'f:1', kind: 'foe', name: 'Sluice Rats', module: 'pack.chat/foes', field: 'hurt1', from: 4, to: 2, size: 4 });
    // A 9-point lead is not enough (29 against 20).
    assert.deepEqual(roll(plan, { source: dice({ init1: [11], init17: [7] }) }).result.quickStart, []);
});

test('beaten before its turn does not act: a foe group at 0 and a character who is Down lose their turn that round, and the fight ends when a side is gone', () => {
    // Wessel goes first and finishes the rats (1 block left); the rats do not strike back.
    const win = roll(planOf({ pace: 'all', ...two }), { blocks: party({ foes: [['Sluice Rats', 6, 2, 1]] }), source: dice({ init0: [1], init1: [10], init17: [15] }) }).result;
    assert.deepEqual(win.rounds[0].lines.map(line => [line.kind, line.pc.who]), [['act', 'Wessel']], 'Wessel ties the rats on 19 and goes first (AGI)');
    assert.deepEqual(win.idle, [{ n: 1, id: 'f:1', who: 'Sluice Rats', kind: 'foe', why: 'beaten' }, { n: 1, id: 'c:ren', who: 'Ren', kind: 'char', why: 'no-target' }]);
    assert.equal(win.stop, 'over');
    assert.match(win.text, /Round 1: Sluice Rats does not act: beaten\./);
    assert.match(win.text, /Round 1 is the end of the fight/);
    // The rats go first and put Wessel (1 block) Down with a decisive hit; he does not act, Ren does.
    const down = roll(planOf({ pace: 'careful', ...two }), { blocks: party({ wessel: { health: 1 } }), source: dice({ init0: [1], init1: [1], init17: [20], foe0: [1, 15] }) }).result;
    assert.deepEqual(down.rounds[0].lines.map(line => line.kind === 'foe' ? 'foe' : line.pc.who), ['foe', 'Ren']);
    assert.deepEqual(down.idle.map(item => [item.who, item.kind, item.why]), [['Wessel', 'char', 'down']]);
    assert.deepEqual(down.hurts.find(item => item.kind === 'char'), { id: 'c:wessel', kind: 'char', name: 'Wessel', module: 'pack.chat/wessel', field: 'health', from: 1, to: 0, size: 6 });
    assert.match(down.text, /Round 1: Wessel does not act: Down\./);
});

test('a foe group acts once a round whatever its count, and its Health is the group\'s: the bar belongs to the slot', () => {
    const { result } = roll(planOf({ pace: 'all', acts: [hit], foes: [{ slot: 1, target: 'Wessel' }] }), { blocks: party({ foes: [['Sluice Rats', 40, 2, 5]] }), source: dice({ act0: [1, 20], foe0: [20, 1] }) });
    for (const round of result.rounds) assert.equal(round.lines.filter(line => line.kind === 'foe').length, 1);
    assert.equal(result.rounds[0].lines.find(line => line.kind === 'act').foe.name, 'Sluice Rats');
});

test('the cue tells the narrator which bars code moved and where they stand in words; it never gives a block count', () => {
    const { result } = roll(planOf({ pace: 'careful', ...two }), { source: dice({ act0: [14, 9], foe0: [3, 18] }) });
    assert.match(result.text, /has already moved the bars they hit, heal or spend .*never set those yourself/);
    assert.match(result.text, /\nBars now: .*Wessel (Badly wounded|Wounded|Hurt|Scratched).*\./);
    assert.doesNotMatch(result.text, /block/i);
    assert.equal(stageWord(STAGES.health, 4, 6), 'Hurt');
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(blocks => stageWord(STAGES.health, blocks, 6)), ['Down', 'Badly wounded', 'Wounded', 'Hurt', 'Hurt', 'Scratched', 'Unhurt']);
    assert.deepEqual([0, 1, 4].map(blocks => stageWord(STAGES.health, blocks, 4)), ['Down', 'Badly wounded', 'Unhurt']);
});

test('a fuzz of fights: no bar leaves 0 to its size, a Down actor never acts, and the hurts are exactly what the told lines did', () => {
    const rules = std({ roundCap: 8 });
    for (let seed = 1; seed <= 150; seed += 1) {
        const hurtStart = [4, 2, 1][seed % 3], health = [6, 2, 1][seed % 3];
        const blocks = party({ wessel: { health }, foes: [['Sluice Rats', 6, 2, hurtStart], ['Weir-drake', 1, 4, 6]] });
        const plan = planOf({ pace: 'all', acts: [hit, { who: 'Ren', skill: 'Spark', area: seed % 2 === 0, target: 'Sluice Rats' }, { who: 'Ren', skill: 'Mend', support: true, difficulty: 'normal', target: 'Wessel' }],
            foes: [{ slot: 1, target: 'Wessel' }, { slot: 2, target: 'Ren', againstMagic: seed % 2 === 1 }] });
        const sheet = sheetOf(blocks), prepared = prepare(plan, sheet, rules);
        const result = rollPrepared(plan, prepared, positionalDice(seed * 7919), rules, {});
        const all = [...prepared.roster.characters, ...prepared.roster.foes, ...prepared.roster.resources];
        const bars = new Map(all.map(bar => [bar.id, bar.value]));
        const acted = new Set();
        for (const line of [...result.opening, ...result.checks, ...result.rounds.flatMap(round => round.lines)]) {
            const actor = line.kind === 'foe' ? `f:${line.foe.slot}` : `c:${line.pc.who.toLowerCase()}`;
            assert.ok(bars.get(actor) > 0, `seed ${seed}: ${actor} acted at 0`);
            acted.add(actor);
            for (const moved of [line.damage, line.cost]) {
                if (!moved) continue;
                assert.equal(moved.from, bars.get(moved.id), `seed ${seed}: the line starts from the bar`);
                assert.ok(moved.to >= 0 && moved.to <= moved.size);
                bars.set(moved.id, moved.to);
            }
        }
        for (const hurt of result.hurts) assert.equal(hurt.to, bars.get(hurt.id), `seed ${seed}: hurt ends where the lines end`);
        assert.equal(result.hurts.length, all.filter(bar => bar.value !== bars.get(bar.id)).length);
        const total = result.rounds.length;
        assert.ok(total <= rules.roundCap);
        assert.ok(['decisive', 'over', 'pace', 'cap', 'budget', 'none'].includes(result.stop));
        for (const round of result.rounds.slice(0, -1)) assert.equal(round.decisive, false, `seed ${seed}: only the last round may be decisive`);
    }
});

// ---- a pack may set the formula and its numbers -----------------------------------------------------------------------------

import { validatePack } from '../../../src/v2/packs/validate.js';
import { packRulesOf } from '../../../src/v2/lean-rpg/rules.js';
import { createHost } from '../../../testkit/index.js';

const packOf = rpg => ({ id: 'sealed', version: '1.0.0', name: 'Sealed', author: 'Test', description: 'A pack that plays on the Classic formula.', requires: { storyBlock: '^2' }, content: { rpg } });

test('a pack\'s content.rpg may name the formula and its numbers; they are kept as one more record and read as the story\'s default', () => {
    const ok = validatePack(packOf({ formula: 'classic', numbers: { foeBase: 7, costMargin: 3 }, skillSets: [{ name: 'Set', skills: [{ name: 'Spear', about: 'Holds a line.', stat: 'str' }] }] }));
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    const records = ok.pack.content.rpg;
    assert.equal(records.length, 2, 'the skill set, then the formula record');
    assert.deepEqual(records.at(-1), { id: 'sealed/formula', slug: 'formula', pack: 'sealed', formula: 'classic', numbers: { foeBase: 7, costMargin: 3 } });
    assert.deepEqual(packRulesOf(records), { pack: 'sealed', formula: 'classic', numbers: { foeBase: 7, costMargin: 3 } });
    assert.equal(packRulesOf(records.slice(0, 1)), null);
    assert.equal(packRulesOf(undefined), null);
    // Bad words are named and the pack is refused; a pack with only skill sets is exactly what it was.
    const bad = validatePack(packOf({ formula: 'modern', numbers: { foeBase: 'high', luck: 3 } }));
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.errors.map(error => error.path).sort(), ['content.rpg.formula', 'content.rpg.numbers.foeBase', 'content.rpg.numbers.luck']);
    assert.equal(validatePack(packOf({ skillSets: [] })).pack.content.rpg.length, 0);
    // The reader's choice wins; a pack fills in what they have not chosen.
    const pack = packRulesOf(records);
    assert.equal(formulaOf({}, pack), 'classic');
    assert.equal(formulaOf({ rpgFormula: 'standard' }, pack), 'standard');
    assert.equal(formulaOf({ rpgFormula: 'classic' }, null), 'classic');
    assert.deepEqual(rulesFromSettings({}, pack), normalizeRules({ ...PRESETS.standard, foeBase: 7, costMargin: 3 }));
    assert.deepEqual(rulesFromSettings({ rpgDifficulty: 'harsh' }, pack), PRESETS.harsh, 'a difficulty the reader picked is theirs');
    const standardPack = packRulesOf([{ slug: 'formula', formula: 'standard', numbers: { foeBase: 6, startStat: 6 } }]);
    assert.deepEqual(rulesFromSettings({}, standardPack), { ...STANDARD_FORMULA, foeBase: 6, startStat: 6 });
    assert.deepEqual(rulesFromSettings({}, null), STANDARD_FORMULA);
});

test('a roll in a story whose pack asks for Classic is rolled on Classic with the pack\'s numbers, unless the reader chose Standard', { skip }, async () => {
    const roll = async settings => {
        const callModel = async () => 'act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats';
        const host = await createHost({ callModel, settings: { modules: { 'story-block': settings } } });
        host.features.set('story-block.rpg', true);
        assert.equal((await host.packs.packs.install(packOf({ formula: 'classic', numbers: { foeBase: 8 } }))).ok, true);
        await host.send('Begin.', 'Opening.');
        const { LEAN_RPG_TEMPLATES } = await import('../../../src/v2/lean-rpg/templates.js');
        for (const entry of LEAN_RPG_TEMPLATES.filter(item => ['character', 'skills', 'foes'].includes(item.definition.role))) {
            const definition = structuredClone(entry.definition);
            if (definition.role === 'character') { definition.slug = 'wessel'; definition.name = 'Wessel'; definition.state.who.default = 'Wessel'; }
            if (definition.role === 'skills') { definition.slug = 'wessel-skills'; definition.state.who.default = 'Wessel'; definition.state.skill1.default = 'Iron Breath'; definition.state.stat1.default = 'str'; }
            if (definition.role === 'foes') { definition.state.foe1.default = 'Sluice Rats'; definition.state.count1.default = 2; }
            assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
        }
        await host.send('I hit the rat.', 'They scatter.');
        const result = host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve')?.data.v2.result;
        host.close();
        return result;
    };
    const asked = await roll({});
    assert.deepEqual(asked.rules, normalizeRules({ ...PRESETS.standard, foeBase: 8 }), 'Classic with the pack\'s base');
    assert.equal('order' in asked, false);
    const chosen = await roll({ rpgFormula: 'standard' });
    assert.equal(chosen.rules.formula, 'standard');
    assert.equal(chosen.rules.foeBase, STANDARD_FORMULA.foeBase, 'the pack\'s numbers belong to its own formula');
});

// ---- a skill costs a block of its resource ----------------------------------------------------------------------------------

test('a skill used spends one block of its resource (Stamina or Mana), recorded on the line and on the roll\'s hurts; an action with no skill spends nothing', () => {
    // Wessel: AGI 10 → 5 Stamina blocks, 4 held; Ren: INT 16 → 6 Mana blocks (the stock fields held 4 stages at most: the sheet says 4).
    const { result } = roll(planOf({ pace: 'careful', acts: [hit, { who: 'Ren', skill: 'Spark', target: 'Sluice Rats' }] }), { blocks: party({ ren: { mana: 3 } }), source: dice({ init1: [10], init0: [1] }) });
    const [wessel, ren] = ['Wessel', 'Ren'].map(name => result.rounds[0].lines.find(line => line.pc.who === name));
    assert.deepEqual(wessel.cost, { id: 'c:wessel:stamina', kind: 'char', name: 'Wessel', blocks: 1, from: 4, to: 3, size: 5 });
    assert.deepEqual(ren.cost, { id: 'c:ren:mana', kind: 'char', name: 'Ren', blocks: 1, from: 3, to: 2, size: 6 });
    assert.deepEqual(result.hurts.filter(item => /stamina|mana/.test(item.field)).map(({ id, field, from, to }) => [id, field, from, to]), [['c:wessel:stamina', 'stamina', 4, 3], ['c:ren:mana', 'mana', 3, 2]]);
    assert.match(result.text, /Bars now: .*Wessel Stamina (Winded|Tired|Fresh).*Ren Mana /);
    assert.doesNotMatch(result.text, /block/i);
    const bare = roll(planOf({ pace: 'careful', acts: [{ who: 'Wessel', type: 'physical', target: 'Sluice Rats' }] })).result;
    assert.equal(bare.rounds[0].lines[0].cost, undefined);
    assert.deepEqual(bare.hurts.filter(item => /stamina|mana/.test(item.field)), []);
});

test('an area attack, a heal and a defence with a skill each cost one block; a refused or idle action costs nothing', () => {
    const foes = [['Rats', 2, 1, 4], ['Drake', 1, 2, 4]];
    const area = roll(planOf({ pace: 'careful', acts: [{ who: 'Ren', skill: 'Spark', area: true, target: 'Rats' }] }), { blocks: party({ foes, ren: { mana: 4 } }) }).result;
    assert.equal(area.rounds[0].lines.length, 2);
    assert.deepEqual(area.rounds[0].lines.map(line => line.cost?.to), [3, undefined], 'one cost for the action, on its first line');
    const mend = roll(planOf({ pace: 'careful', acts: [{ who: 'Ren', skill: 'Mend', support: true, difficulty: 'normal', target: 'Wessel' }] }), { blocks: party({ wessel: { health: 3 }, ren: { mana: 4 } }) }).result;
    assert.equal(mend.rounds[0].lines[0].cost.id, 'c:ren:mana');
    const defence = roll(planOf({ pace: 'careful', foes: [{ slot: 1, target: 'Wessel', skill: 'Iron Breath' }], acts: [] }), { blocks: party({ wessel: { stamina: 3 } }) }).result;
    assert.equal(defence.rounds[0].lines[0].skill, 'Iron Breath');
    assert.deepEqual([defence.rounds[0].lines[0].cost.from, defence.rounds[0].lines[0].cost.to], [3, 2]);
    // Down before its turn: no action, no cost.
    const down = roll(planOf({ pace: 'careful', acts: [hit], foes: [{ slot: 1, target: 'Wessel' }] }), { blocks: party({ wessel: { health: 1 } }), source: dice({ init1: [1], init17: [20], foe0: [1, 15] }) }).result;
    assert.deepEqual(down.hurts.filter(item => item.field === 'stamina'), []);
    // A check with a skill counts too.
    const check = roll(planOf({ checks: [{ who: 'Ren', skill: 'Spark', type: 'check', fit: 'int', difficulty: 'easy' }] }), { blocks: party({ ren: { mana: 2 } }) }).result;
    assert.deepEqual([check.checks[0].cost.from, check.checks[0].cost.to], [2, 1]);
});

test('the resource runs out in the fight: the last block is spent, then the action is rolled without the skill and the line says so; nothing goes below 0', () => {
    const blocks = party({ wessel: { stamina: 1 } });
    const { result, prepared } = roll(planOf({ pace: 'all', acts: [hit] }), { blocks, source: dice({ init1: [10], init17: [10] }) });
    assert.deepEqual(prepared.refused, [], 'it was not empty at the start');
    const lines = result.rounds.flatMap(round => round.lines);
    assert.ok(lines.length >= 2, 'a calm fight of several rounds');
    assert.deepEqual([lines[0].skill, lines[0].cost.to, lines[0].without], ['Iron Breath', 0, undefined]);
    assert.deepEqual([lines[1].skill, lines[1].pc.rank, lines[1].pc.stat, lines[1].without, lines[1].cost], [null, 0, 'str', 'Iron Breath', undefined]);
    assert.equal(lines[1].pc.total - lines[1].pc.die, 6 + 4, 'the pair and Soul Class only: no rank');
    assert.match(result.text, /Round 2: Wessel → Sluice Rats \(Iron Breath unavailable: resource spent\)/);
    assert.equal(result.hurts.find(item => item.field === 'stamina').to, 0);
    // Already empty at the start: refused as before, rolled without it, and nothing to spend.
    const empty = roll(planOf({ pace: 'careful', acts: [hit] }), { blocks: party({ wessel: { stamina: 0 } }) });
    assert.equal(empty.prepared.refused.length, 1);
    assert.equal(empty.result.rounds[0].lines[0].cost, undefined);
});

test('the cost goes through the turn: it is written to the sheet, and a Re-read, a swipe, a rebuild and a reload agree', { skip }, async () => {
    const { host } = await setup({ blocks: party({ wessel: { stamina: 4 } }), answers: ['pace: careful\nact Wessel | skill: Iron Breath | type: physical | target: Sluice Rats'], settings: { rpgFormula: 'standard' } });
    const fieldsOf = () => host.head().domains.dataModules.instances['pack.chat/wessel'].chat.fields;
    const result = () => host.ctx.chat[2].extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve').data.v2.result;
    // (an opening action and each round's action each spend one: the sheet holds 4 less what the told lines spent)
    const spentBy = () => [...result().opening, ...result().rounds.flatMap(round => round.lines)].filter(line => line.cost).length;
    await host.send('I strike.', 'The rats scatter.');
    assert.ok(spentBy() >= 1);
    assert.equal(fieldsOf().stamina, 4 - spentBy());
    assert.equal(result().hurts.find(item => item.field === 'stamina').to, fieldsOf().stamina);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(JSON.stringify(host.head()), live, 'a Re-read keeps it');
    for (let n = 0; n < 3; n += 1) { await host.swipe(`Again ${n}.`); assert.equal(fieldsOf().stamina, 4 - spentBy(), 'a swipe starts from the sheet before the reply, and spends only what its own roll spent'); }
    await host.st.deleteMessage(2);
    assert.equal(fieldsOf().stamina, 4, 'a delete gives the blocks back');
    host.close();
});
