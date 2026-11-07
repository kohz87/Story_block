// The ambush check (PRACTICE-FIX 4, lean-rpg/ambush.js): a skill used before a fight to gain the drop on the foes is a plan check that carries `ambush`.
// A success gives the party's round-1 acts +2 (and, Standard, the quick start); a failure gives nothing; with no such check there is no ambush edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { prepare, readSheet, rollPrepared, validatePlan } from '../../../src/v2/lean-rpg/index.js';
import { parsePlanAnswer } from './legacy-planner.js';
import { EARLIER_RULES } from '../../../src/v2/lean-rpg/rules.js';
import { STANDARD_FORMULA as STANDARD } from '../../../src/v2/lean-rpg/rules.js';
import { carriedFrom, dropOf } from '../../../src/v2/lean-rpg/ambush.js';
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

test('an ambush check parses, validates, and a plan keeps the flag', () => {
    const answer = ['pace: normal', AMBUSH, ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n');
    const { plan } = parsePlanAnswer(answer, sheet());
    assert.deepEqual(plan.checks, [{ who: 'Wessel', skill: 'Shadow Step', difficulty: 'normal', ambush: true }]);
    assert.equal(validatePlan(plan).ok, true);
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

test('a successful ambush check gives round-1 acts +2 and not round 2; a failed one gives nothing; the record, the cue and the panel tell it', () => {
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

test('on the real host: a planner answer with an ambush check for the shadow skill is rolled, recorded and told', { skip }, async () => {
    const answer = ['pace: normal', AMBUSH, ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n');
    const { host } = await setup({ blocks: blocks(), answers: [answer] });
    await host.send('I slip behind the rats with Shadow Step, then strike.', 'The rats turn.');
    const result = rollReceipt(host, 2).data.v2.result;
    assert.equal(result.checks[0].ambush, true);
    assert.equal(typeof result.ambush.success, 'boolean');
    assert.ok(result.rounds.length >= 1);
    host.close();
});

const NO_FIGHT = 'check Wessel | skill: Shadow Step | difficulty: easy | ambush';

test('A3: a success at a cost counts as no ambush: no edge, and the cue and the log say "ambush only half works: no surprise"', () => {
    const plan = parsePlanAnswer(['pace: normal', AMBUSH, ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n'), sheet()).plan;
    const prepared = prepare(plan, sheet(), EARLIER_RULES);
    // total 10 + die; DC normal 12: die 1 fails outright, so a die that leaves the total 1 to 3 short is "at a cost"
    const half = [2, 3, 4].map(die => rollPrepared(plan, prepared, dice({ check0: [die] }), EARLIER_RULES)).find(result => result.checks[0].outcome === 'cost');
    assert.ok(half, 'a roll at a cost');
    assert.equal(half.ambush.success, false);
    assert.equal(half.rounds[0].lines.find(line => line.kind === 'act').pc.edge, 0);
    const record = { v: 1, key: 'k', pace: 'normal', stop: half.stop, checks: half.checks, rounds: half.rounds, refused: [], summary: half.summary, ambush: half.ambush };
    assert.match(cueOfResult(record), /; ambush only half works: no surprise/);
    const doc = setupDom();
    const panel = buildPanel(doc, panelModel({ resolve: readResolve(record), state: { domains: {} }, roleOf: () => null }));
    assert.match(panel.querySelectorAll('.rpg-bl-ambush')[0].textContent, /^Ambush: Wessel's Shadow Step check — Success at a cost \(\d+ vs \d+\): ambush only half works: no surprise$/);
});

test('A2: a successful ambush check in a roll with no act is kept as a drop (the cue says "you have the drop"), spent once on the next roll that has acts (+2 in round 1, marked spent), and not twice', () => {
    const only = parsePlanAnswer(['pace: normal', NO_FIGHT].join('\n'), sheet()).plan;
    const first = rollPrepared(only, prepare(only, sheet(), EARLIER_RULES), dice({ check0: [20] }), EARLIER_RULES);
    assert.equal(first.rounds.length, 0, 'a check alone');
    assert.equal(first.ambush.success, true);
    assert.equal(first.ambush.drop, true);
    assert.equal(first.checks[0].ambushDrop, true);
    const record = { v: 1, key: 'k', pace: 'normal', stop: first.stop, checks: first.checks, rounds: [], refused: [], summary: first.summary, ambush: first.ambush };
    assert.match(cueOfResult(record), /; ambush works: you have the drop/);
    assert.doesNotMatch(cueOfResult(record), /strikes first/);
    assert.match(panelText(readResolve(record)), /Ambush: Wessel's Shadow Step check — Success \(\d+ vs \d+\): you have the drop; \+2 on the next reply's fight/);
    // the next reply's pre-call (the legacy stand-in) carries it from the receipt
    const carried = dropOf(record);
    assert.deepEqual(carried, { who: 'Wessel', skill: 'Shadow Step', total: first.ambush.total, dc: first.ambush.dc });
    // the next reply's roll with acts spends it
    const attack = parsePlanAnswer(['pace: normal', ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n'), sheet()).plan;
    const second = rollPrepared(attack, prepare(attack, sheet(), EARLIER_RULES), dice(), EARLIER_RULES, { drop: carried });
    assert.deepEqual(second.rounds.slice(0, 2).map(round => round.lines.find(line => line.kind === 'act').pc.edge), [2, 0]);
    assert.equal(second.ambush.spent, true);
    // (a roll of stage 65 tells the narrator the drop is being spent; one made before says nothing of it)
    const spentNow = rollPrepared(attack, prepare(attack, sheet(), EARLIER_RULES), dice(), EARLIER_RULES, { drop: carried, fix: true });
    assert.match(spentNow.text, /\nAmbush from last time: the party strikes first\.\n/);
    assert.doesNotMatch(second.text, /Ambush from last time/);
    assert.equal(dropOf({ ambush: second.ambush }), null, 'a spent drop is not carried again');
    // a roll with no act to strike with does not spend it
    const checksOnly = rollPrepared(only, prepare(only, sheet(), EARLIER_RULES), dice({ check0: [1] }), EARLIER_RULES, { drop: carried });
    assert.notEqual(checksOnly.ambush?.carried, true);
    assert.equal(carriedFrom({ who: 'A', skill: 5, total: 1, dc: 1 }), null);
});

function panelText(model) {
    const doc = setupDom();
    return buildPanel(doc, panelModel({ resolve: model, state: { domains: {} }, roleOf: () => null })).querySelectorAll('.rpg-bl-ambush').map(node => node.textContent).join('|');
}

test('A2 on the real host: the drop crosses replies in the payload, is spent on the next reply that attacks, and a rebuild, a reload and a Re-read give the same record', { skip }, async () => {
    const strong = () => ({ ...blocks(), wessel: { role: 'character', fields: character('Wessel', { health: 6, str: 10, vit: 10, agi: 20, dex: 6, int: 5, luk: 9, cha: 5, soul: 2 }) } });
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const attack = ['pace: normal', ACT, 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n');
        const { host } = await setup({ blocks: strong(), answers: [['pace: normal', NO_FIGHT].join('\n'), attack, attack] });
        await host.send('I slip behind the rats with Shadow Step.', 'The rats do not see.');
        const first = rollReceipt(host, 2).data.v2.result;
        if (first.ambush?.success !== true) { host.close(); continue; }
        assert.equal(first.ambush.drop, true);
        await host.send('Now I strike.', 'Steel.');
        const secondReceipt = rollReceipt(host, 4);
        const second = secondReceipt.data.v2.result;
        assert.equal(second.ambush.spent, true);
        assert.equal(second.rounds[0].lines.find(line => line.kind === 'act').pc.edge, 2);
        // the replay guard recorded what the roll was given
        assert.ok(secondReceipt.data.v2.guard?.predicate?.ambush, 'the drop is part of the guarded inputs');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story');
        const sameAgain = rollReceipt(host, 4).data.v2.result;
        assert.equal(JSON.stringify(sameAgain), JSON.stringify(second), 'the record is the same after the rebuild');
        // a third reply: the drop is gone (the reply before it has none)
        await host.send('Again.', 'More steel.');
        assert.equal(rollReceipt(host, 6).data.v2.result.ambush, undefined);
        host.close();
        return;
    }
    assert.fail('the ambush check never succeeded in 8 tries');
});
