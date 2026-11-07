// PLAN-NET: a skill on a foe line earns practice when a stored plan is rolled (the plan is built by the test-only legacy planner).
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, readSheet, rollPrepared } from '../../../src/v2/lean-rpg/index.js';
import { parsePlanAnswer } from './legacy-planner.js';
import { STANDARD_FORMULA } from '../../../src/v2/lean-rpg/rules.js';
import { usesOf } from '../../../src/v2/lean-rpg/practice.js';
import { character, foeBlock, sheetDomain, skillBlock } from './helpers.js';

const sheet = () => readSheet({ domains: { dataModules: sheetDomain({
    astra: { role: 'character', fields: character('Astra', { health: 6, mana: 3, stamina: 4, str: 10, vit: 10, agi: 14, dex: 8, int: 10, luk: 9, cha: 5, soul: 2 }) },
    'astra-skills': { role: 'skills', fields: skillBlock('Astra', [['Shadow Cut', 1, 'agi', 'mana'], ['Iaijutsu', 1, 'agi', 'stamina'], ['Shadow Step', 1, 'agi', 'stamina']]) },
    foes: { role: 'foes', fields: foeBlock([['Rats A', 6, 2, 5], ['Rats B', 6, 2, 5]]) },
}) } });

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
