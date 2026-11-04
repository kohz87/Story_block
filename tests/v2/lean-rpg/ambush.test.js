// The ambush check (PRACTICE-FIX 4, lean-rpg/ambush.js): a skill used before a fight to gain the drop on the foes is a plan check that carries `ambush`.
// A success gives the party's round-1 acts +2 (and, Standard, the quick start); a failure gives nothing; with no such check there is no ambush edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { parsePlanAnswer, prepare, readSheet, rollPrepared, validatePlan } from '../../../src/v2/lean-rpg/index.js';
import { EARLIER_RULES } from '../../../src/v2/lean-rpg/rules.js';
import { STANDARD_FORMULA as STANDARD } from '../../../src/v2/lean-rpg/rules.js';
import { PRECALL_HEAD, PRECALL_HEAD_STANDARD, sheetText } from '../../../src/v2/lean-rpg/precall.js';
import { cueOfResult } from '../../../src/v2/lean-rpg/cue.js';
import { usesOf } from '../../../src/v2/lean-rpg/practice.js';
import { buildPanel, panelModel, readResolve } from '../../../src/v2/lean-rpg/view/battle-log.js';
import { setupDom } from '../view/mounts/helpers.js';
import { PARTY, character, foeBlock, rollReceipt, setup, sheetDomain, skillBlock } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const SHADOW = 'slips through shadow to reappear behind a foe';
const blocks = () => ({
    wessel: { role: 'character', fields: character('Wessel', { health: 6, str: 10, vit: 10, agi: 10, dex: 6, int: 5, luk: 9, cha: 5, soul: 2 }) },
    'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Iron Breath', 2, 'str'], ['Shadow Step', 1, 'agi', 'stamina', SHADOW]]) },
    foes: { role: 'foes', fields: foeBlock([['Sluice Rats', 6, 2, 4]]) },
});
const sheet = () => readSheet({ domains: { dataModules: sheetDomain(blocks()) } });
// Scripted dice by kind and place in the plan: { check0: [d20], act0: [pc, foe, …] }; positional, so each action has its own stream.
const dice = (table = {}, fallback = 10) => Object.assign((kind, at) => { const list = [...(table[`${kind}${at}`] ?? [])]; return () => (list.length ? list.shift() : fallback); }, { positional: true });
const AMBUSH = 'check Wessel | skill: Shadow Step | difficulty: normal | ambush';
const ACT = 'act Wessel | skill: Iron Breath | target: Sluice Rats';

test('an ambush check parses (Classic and Standard), validates, and a plan keeps the flag', () => {
    const answer = ['pace: normal', AMBUSH, ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n');
    for (const formula of ['classic', 'standard']) {
        const { plan } = parsePlanAnswer(answer, sheet(), { formula });
        assert.deepEqual(plan.checks, [{ who: 'Wessel', skill: 'Shadow Step', difficulty: 'normal', ambush: true }], formula);
        assert.equal(validatePlan(plan).ok, true, formula);
    }
    const plain = parsePlanAnswer(['pace: normal', 'check Wessel | skill: Shadow Step | difficulty: normal', ACT].join('\n'), sheet()).plan;
    assert.equal('ambush' in plain.checks[0], false);
    assert.match(validatePlan({ ...plain, checks: [{ ...plain.checks[0], ambush: 'yes' }] }).errors[0], /ambush must be true/);
});

test('a plan with no ambush check gives no ambush edge: an act\'s own "+2 ambush" is dropped; with the check it is kept', () => {
    const edged = 'act Wessel | skill: Iron Breath | target: Sluice Rats | edge: +2 ambush from the drain';
    const without = parsePlanAnswer(['pace: normal', edged].join('\n'), sheet()).plan;
    assert.deepEqual(without.acts, [{ who: 'Wessel', skill: 'Iron Breath', target: 'Sluice Rats' }]);
    const withCheck = parsePlanAnswer(['pace: normal', AMBUSH, edged].join('\n'), sheet()).plan;
    assert.equal(withCheck.acts[0].edge, 2);
    // a trap edge is not an ambush and stays
    assert.equal(parsePlanAnswer(['pace: normal', 'act Wessel | skill: Iron Breath | target: Sluice Rats | edge: -2 trap'].join('\n'), sheet()).plan.acts[0].edge, -2);
});

test('Classic: a successful ambush check gives round-1 acts +2 and not round 2; a failed one gives nothing; the record, the cue and the panel tell it', () => {
    const plan = parsePlanAnswer(['pace: normal', AMBUSH, ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n'), sheet()).plan;
    const prepared = prepare(plan, sheet(), EARLIER_RULES);
    assert.equal(prepared.checks[0].ambush, true);
    // d20 + AGI 10/2 + class 2×2 + rank 1 = die + 10: DC normal is 12 here, so die 7 → 17 succeeds, die 1 fails
    const won = rollPrepared(plan, prepared, dice({ check0: [7] }), EARLIER_RULES);
    assert.equal(won.checks[0].ambush, true);
    assert.deepEqual(won.ambush, { who: 'Wessel', skill: 'Shadow Step', outcome: 'success', total: won.checks[0].pc.total, dc: won.checks[0].dc, success: true });
    const edges = result => result.rounds.map(round => round.lines.find(line => line.kind === 'act').pc.edge);
    assert.deepEqual(edges(won).slice(0, 2), [2, 0], 'round 1 only');
    const lost = rollPrepared(plan, prepared, dice({ check0: [1] }), EARLIER_RULES);
    assert.equal(lost.ambush.success, false);
    assert.deepEqual(edges(lost).slice(0, 2), [0, 0], 'a failed ambush gives nothing');
    const record = { v: 1, key: 'k', pace: 'normal', stop: won.stop, checks: won.checks, rounds: won.rounds, refused: [], summary: won.summary, ambush: won.ambush };
    assert.match(cueOfResult(record), /Shadow Step \(AGI\), normal: SUCCESS \(\d+ vs \d+\); ambush works, the party strikes first/);
    assert.match(cueOfResult({ ...record, checks: lost.checks, rounds: lost.rounds, ambush: lost.ambush }), /; ambush fails, no surprise/);
    const model = readResolve(record);
    assert.equal(model.ambush.success, true);
    const doc = setupDom();
    const panel = buildPanel(doc, panelModel({ resolve: model, state: { domains: {} }, roleOf: () => null }));
    const line = panel.querySelectorAll('.rpg-bl-ambush')[0];
    assert.match(line.textContent, /^Ambush: Wessel's Shadow Step check — Success \(\d+ vs \d+\): the party strikes first, \+2 this round$/);
    const failedModel = readResolve({ ...record, checks: lost.checks, rounds: lost.rounds, ambush: lost.ambush });
    const failedPanel = buildPanel(doc, panelModel({ resolve: failedModel, state: { domains: {} }, roleOf: () => null }));
    assert.equal(failedPanel.querySelectorAll('.rpg-bl-ambush')[0].textContent, 'Ambush: Wessel\'s Shadow Step check — Failed: no surprise');
});

test('Standard: a successful ambush gives round-1 acts +2 and the opening action without the lead; a failed one neither; the check\'s skill is practised', () => {
    const plan = parsePlanAnswer(['pace: normal', AMBUSH, ACT, 'foe Sluice Rats | target: Wessel'].join('\n'), sheet(), { formula: 'standard' }).plan;
    const prepared = prepare(plan, sheet(), STANDARD);
    assert.equal(prepared.checks[0].ambush, true);
    // the foes roll high for initiative so that no quick start comes by the margin alone
    const table = ambushDie => ({ check0: [ambushDie], init0: [1], init16: [20] });
    const won = rollPrepared(plan, prepared, dice(table(20)), STANDARD);
    assert.equal(won.ambush.success, true);
    assert.deepEqual(won.quickStart.map(item => item.who), ['Wessel'], 'the quick start by the ambush');
    assert.equal(won.opening.length, 1);
    const act1 = won.rounds[0].lines.find(line => line.kind === 'act'), act2 = won.rounds[1]?.lines.find(line => line.kind === 'act');
    assert.equal(act1.pc.edge, 2);
    if (act2) assert.equal(act2.pc.edge, 0);
    const lost = rollPrepared(plan, prepared, dice(table(1)), STANDARD);
    assert.equal(lost.ambush.success, false);
    assert.equal(lost.quickStart.length, 0);
    assert.equal(lost.rounds[0].lines.find(line => line.kind === 'act').pc.edge, 0);
    // the check's skill earns practice through the existing path: it is one of the roll's checks
    const uses = usesOf({ checks: won.checks, rounds: won.rounds, opening: won.opening });
    assert.ok(uses.some(use => use.skill === 'Shadow Step' && use.who === 'Wessel'));
});

test('without an ambush check the roll has no ambush record and no edge (a plan with only the act)', () => {
    const plan = parsePlanAnswer(['pace: normal', ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n'), sheet()).plan;
    const result = rollPrepared(plan, prepare(plan, sheet(), EARLIER_RULES), dice(), EARLIER_RULES);
    assert.equal('ambush' in result, false);
    assert.ok(result.rounds[0].lines.every(line => line.pc.edge === 0));
});

test('the planner heads carry the ambush rule (any skill that sets up a fight, judged from its description) and the shorter stat wording', () => {
    for (const head of [PRECALL_HEAD, PRECALL_HEAD_STANDARD]) {
        assert.ok(head.includes('is a check with that skill and ambush. No ambush edge without one.'));
        assert.ok(head.includes('lure, distract, slip behind them; judge by its description'));
        assert.ok(!head.includes('edge: ambush +2'));
        assert.ok(head.includes('| ambush?'));
    }
    assert.ok(PRECALL_HEAD_STANDARD.includes('A skill brings its own stat; leave the stat out.'));
    assert.ok(!PRECALL_HEAD_STANDARD.includes('A skill brings its stat: write none.'));
});

test('the planner sees a skill\'s own description, so a non-stealth skill ("slips through shadow to reappear behind a foe") can be judged an ambush', () => {
    assert.match(sheetText(sheet()), new RegExp(`Shadow Step \\(Adept, AGI: ${SHADOW}\\)`));
    const long = readSheet({ domains: { dataModules: sheetDomain({ ...blocks(), 'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Long', 0, 'str', 'stamina', 'x'.repeat(200)]]) } }) } });
    assert.ok(sheetText(long).includes(`Long (Novice, STR: ${'x'.repeat(69)}…)`), 'cut at 70 characters');
});

test('on the real host: a planner answer with an ambush check for the shadow skill is rolled, recorded and told', { skip }, async () => {
    const answer = ['pace: normal', AMBUSH, ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n');
    const { host, callModel } = await setup({ blocks: blocks(), answers: [answer] });
    await host.send('I slip behind the rats with Shadow Step, then strike.', 'The rats turn.');
    assert.match(callModel.calls[0].prompt, new RegExp(SHADOW));
    const result = rollReceipt(host, 2).data.v2.result;
    assert.equal(result.checks[0].ambush, true);
    assert.equal(typeof result.ambush.success, 'boolean');
    assert.ok(result.rounds.length >= 1);
    host.close();
});
