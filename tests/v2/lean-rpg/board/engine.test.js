// The staged engine rolls the production fight rules on a copy of a test host's state.
// A later segment and a replay from the start must produce the same bars and dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { character, foeBlock, setup, skillBlock } from '../helpers.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const choice = { actions: [{ who: 'Astra', kind: 'attack', target: 1 }] };

test('staged exchanges are deterministic, reversible and can continue from the same bars', async () => {
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
        assert.deepEqual(playBoard(before, config, [choice]), first, 'undo and replay use the same dice');
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
