// PLAN-NET: the planner heads show `then:` and `else:` on the act line, plan.js reads both from it, and a skill on a foe line earns practice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanAnswer, prepare, readSheet, rollPrepared, validatePlan } from '../../../src/v2/lean-rpg/index.js';
import { STANDARD_FORMULA } from '../../../src/v2/lean-rpg/rules.js';
import { PRECALL_HEAD, PRECALL_HEAD_STANDARD } from '../../../src/v2/lean-rpg/precall.js';
import { usesOf } from '../../../src/v2/lean-rpg/practice.js';
import { character, foeBlock, sheetDomain, skillBlock } from './helpers.js';

const sheet = () => readSheet({ domains: { dataModules: sheetDomain({
    astra: { role: 'character', fields: character('Astra', { health: 6, mana: 3, stamina: 4, str: 10, vit: 10, agi: 14, dex: 8, int: 10, luk: 9, cha: 5, soul: 2 }) },
    'astra-skills': { role: 'skills', fields: skillBlock('Astra', [['Shadow Cut', 1, 'agi', 'mana'], ['Iaijutsu', 1, 'agi', 'stamina'], ['Shadow Step', 1, 'agi', 'stamina']]) },
    foes: { role: 'foes', fields: foeBlock([['Rats A', 6, 2, 5], ['Rats B', 6, 2, 5]]) },
}) } });

test('both heads show `then:` and `else:` on the act line, and the rule lines stay', () => {
    for (const head of [PRECALL_HEAD, PRECALL_HEAD_STANDARD]) {
        const act = head.split('\n').find(line => line.startsWith('act <who>'));
        assert.ok(act.endsWith('| then: <skill>? | else: <skill>? | guard: <skill>?'), act);
        assert.ok(head.includes('- Skills ordered "A, then B": skill: A, then: B (B from round 2).'));
    }
    assert.ok(PRECALL_HEAD_STANDARD.includes('- else: the skill to use when the first runs out of Mana or Stamina.'));
});

test('an act line written in the head\'s shape parses then: and else: (Standard and Classic)', () => {
    const s = sheet();
    const std = parsePlanAnswer('pace: all\nact Astra | skill: Shadow Cut | type: magic | target: Rats A | edge: +1 trap | area | then: Iaijutsu | else: Shadow Step', s, { formula: 'standard' }).plan;
    assert.deepEqual([std.acts[0].then, std.acts[0].else], ['Iaijutsu', 'Shadow Step']);
    assert.equal(validatePlan(std).ok, true);
    const classic = parsePlanAnswer('pace: all\nact Astra | skill: Shadow Cut | stat: AGI | target: Rats A | edge: +1 trap | then: Iaijutsu | else: Shadow Step', s, { formula: 'classic' }).plan;
    assert.deepEqual([classic.acts[0].then, classic.acts[0].else], ['Iaijutsu', 'Shadow Step']);
});

test('a Shadow Step on a foe line is a rolled use and earns practice', () => {
    const s = sheet();
    const plan = parsePlanAnswer('pace: all\nact Astra | skill: Shadow Cut | guard: Shadow Step | type: magic | target: Rats A | area\nfoe Rats A | target: Astra\nfoe Rats B | target: Astra', s, { formula: 'standard' }).plan;
    const rules = { ...STANDARD_FORMULA };
    const dice = Object.assign(() => () => 10, { positional: true });
    const result = rollPrepared(plan, prepare(plan, s, rules, { fix: true, then: true }), dice, rules, { flow: 2, fix: true, then: true });
    assert.equal(result.rounds[0].lines.find(line => line.kind === 'foe').skill, 'Shadow Step');
    const uses = Object.fromEntries(usesOf({ checks: result.checks, rounds: result.rounds, opening: result.opening }).map(use => [use.skill, use.n]));
    assert.ok(uses['Shadow Step'] >= 1, JSON.stringify(uses));
});

test('guard: on the act is copied as the skill onto every foe line aimed at that character; a skill already on a foe line, a hold line and a skill the character lacks are left alone', () => {
    const s = sheet();
    const act = 'act Astra | skill: Shadow Cut | then: Iaijutsu | guard: Shadow Step | type: magic | target: Rats A | area';
    const both = parsePlanAnswer(['pace: all', act, 'foe Rats A | target: Astra', 'foe Rats B | target: Astra'].join('\n'), s, { formula: 'standard' }).plan;
    assert.deepEqual(both.foes.map(foe => foe.skill), ['Shadow Step', 'Shadow Step']);
    assert.equal('guard' in both.acts[0], false);
    assert.equal(both.acts[0].then, 'Iaijutsu');
    assert.equal(validatePlan(both).ok, true);
    // the foe lines may come before the act line
    const early = parsePlanAnswer(['pace: all', 'foe Rats A | target: Astra', act, 'foe Rats B | target: Astra'].join('\n'), s, { formula: 'standard' }).plan;
    assert.deepEqual(early.foes.map(foe => foe.skill), ['Shadow Step', 'Shadow Step']);
    const given = parsePlanAnswer(['pace: all', act, 'foe Rats A | target: Astra | skill: Iaijutsu', 'foe Rats B | hold'].join('\n'), s, { formula: 'standard' }).plan;
    assert.deepEqual(given.foes, [{ slot: 1, target: 'Astra', skill: 'Iaijutsu' }, { slot: 2, hold: true }]);
    const lacks = parsePlanAnswer(['pace: all', act.replace('Shadow Step', 'Wind Walk'), 'foe Rats A | target: Astra'].join('\n'), s, { formula: 'standard' }).plan;
    assert.equal('skill' in lacks.foes[0], false);
    assert.equal('skill' in parsePlanAnswer(['pace: all', act.replace(' | guard: Shadow Step', ''), 'foe Rats A | target: Astra'].join('\n'), s, { formula: 'standard' }).plan.foes[0], false);
    const classic = parsePlanAnswer('pace: all\nact Astra | skill: Shadow Cut | guard: shadow step | target: Rats A\nfoe Rats A | target: Astra | defend: AGI', s, { formula: 'classic' }).plan;
    assert.equal(classic.foes[0].skill, 'Shadow Step');
});

test('both heads put guard: on the act line and the guard rule line', () => {
    for (const head of [PRECALL_HEAD, PRECALL_HEAD_STANDARD]) {
        assert.ok(head.split('\n').find(line => line.startsWith('act <who>')).endsWith('| then: <skill>? | else: <skill>? | guard: <skill>?'));
        assert.ok(head.includes('- Defending with a skill (evade, dodge, parry, block): guard: that skill on the act; else leave it out.'));
    }
});
