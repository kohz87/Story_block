// The staged engine rolls the production fight rules on a copy of a test host's state.
// A later segment and a replay from the start must produce the same bars and dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import * as sessionApi from '../../../../src/v2/lean-rpg/board/session.js';
import { character, foeBlock, levelFoeBlock, setup, sheetDomain, skillBlock } from '../helpers.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const choice = { actions: [{ who: 'Astra', kind: 'attack', target: 1 }] };
const stateOf = blocks => ({ domains: { dataModules: sheetDomain(blocks) } });

test('a rolled exchange has no undo operation', () => {
    assert.equal(typeof sessionApi.undoExchange, 'undefined');
});

test('staged exchanges are deterministic and can continue from the same bars', async () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 5, health: 5 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Dodge', 1, 'agi', 'stamina', 'evasion']]) },
        foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) },
    };
    const { host } = await setup({ blocks });
    try {
        const before = host.head(), saved = JSON.stringify(before), config = { seed: 25, offset: 0, rules };
        const first = playBoard(before, config, [choice]);
        assert.equal(first.error, undefined);
        assert.equal(JSON.stringify(before), saved, 'staging never changes the live sheet');
        assert.deepEqual(playBoard(before, config, [choice]), first, 'replay uses the same dice');
        assert.equal(first.result.stop, 'open', 'the selected seed leaves the fight open');
        const next = playBoard(first.state, { ...config, offset: 1, order: first.result.order }, [choice]);
        const together = playBoard(before, config, [choice, choice]);
        assert.equal(next.error, undefined);
        assert.deepEqual(next.state, together.state);
        assert.deepEqual(next.result.rounds[0], together.result.rounds[1]);
    } finally { host.close(); }
});

test('flee uses the strongest foe and ends only when the contest succeeds', async () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra') },
        foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5], ['Ogre', 1, 3, 5]]) },
    };
    const { host } = await setup({ blocks });
    try {
        const outcomes = new Set();
        for (let seed = 0; seed < 100 && outcomes.size < 2; seed += 1) {
            const run = playBoard(host.head(), { seed, offset: 0, rules }, [{ actions: [{ who: 'Astra', kind: 'flee' }] }]);
            assert.equal(run.error, undefined);
            const line = run.result.rounds[0].lines[0];
            assert.equal(line.foe.name, 'Ogre');
            assert.equal(line.pc.stat, 'agi');
            assert.equal(run.result.stop === 'fled', line.outcome !== 'fail');
            outcomes.add(line.outcome === 'fail' ? 'fail' : 'success');
        }
        assert.deepEqual([...outcomes].sort(), ['fail', 'success']);
    } finally { host.close(); }
});

test('LONE_GROUPS: real count-one groups follow the new board area and defence rules', () => {
    const state = stateOf({
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, dex: 20, health: 8, stamina: 4 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Sweep', 3, 'str', 'stamina', 'sweep every foe'], ['Dodge', 3, 'agi', 'stamina', 'evasion']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Bat', 1, 1, 4], ['Wolf', 1, 1, 4]]) },
    });
    const config = { seed: 2, offset: 0, rules, members: 1 };
    const area = playBoard(state, config, [{ actions: [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 }] }]);
    assert.equal(area.error, undefined, area.error);
    assert.deepEqual(area.result.rounds[0].lines.filter(line => line.kind === 'act').map(line => line.foe.name), ['Bat'],
        'an area action aimed at group 1 does not reach the other real group');
    assert.deepEqual(area.result.members.map(member => [member.group, member.name]), [[1, 'Bat'], [2, 'Wolf']],
        'a new board result lists real count-one groups as members');

    const defence = playBoard(state, config, [choice]);
    assert.equal(defence.error, undefined, defence.error);
    const lines = defence.result.rounds[0].lines.filter(line => line.kind === 'foe');
    assert.deepEqual(lines.map(line => line.skill), ['Dodge', 'Dodge']);
    assert.deepEqual(lines.map(line => (line.cost ? [line.cost.from, line.cost.to] : null)), [[4, 3], null]);
    assert.deepEqual(defence.result.hurts.filter(hurt => hurt.field === 'stamina').map(hurt => [hurt.from, hurt.to]), [[4, 3]],
        'two attacks on the same defender pay one defence');
    assert.deepEqual(defence.result.members.map(member => member.group), [1, 2]);
});

test('FLEE_DOWN_GROUP: flee contests only a real group that still has a standing member', () => {
    const state = stateOf({
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 8 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Sweep', 5, 'str', 'stamina', 'sweep every foe']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Bear', 2, 30, 1], ['Rat', 1, 1, 4]]) },
    });
    const actions = [{ actions: [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 }] }, { actions: [{ who: 'Astra', kind: 'flee' }] }];
    let played;
    for (let seed = 0; seed < 1000; seed += 1) {
        const run = playBoard(state, { seed, offset: 0, rules, members: 1 }, actions);
        const acts = run.result?.rounds?.[0]?.lines?.filter(line => line.kind === 'act') ?? [];
        const flee = run.result?.rounds?.[1]?.lines?.find(line => line.flee);
        if (acts.length === 2 && acts.every(line => line.damage?.to === 0) && flee) { played = run; break; }
    }
    assert.ok(played, 'found a seed that defeats both bears before fleeing');
    assert.deepEqual(played.result.rounds[0].lines.filter(line => line.kind === 'act').map(line => line.foe.name), ['Bear 1', 'Bear 2']);
    const flee = played.result.rounds[1].lines.find(line => line.flee);
    assert.equal(flee.foe.slot, 2);
    assert.equal(flee.foe.name, 'Rat', 'the defeated Bear group is not contested');
    assert.equal(played.result.members.find(member => member.group === 2).standing, true);
});
