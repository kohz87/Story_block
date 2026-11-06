// Exchange choices are checked against the live sheet before they can be rolled.
// The test host supplies the same sheet reader as production.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { actionSkills, exchangePlan } from '../../../../src/v2/lean-rpg/board/plan.js';
import { character, foeBlock, setup, skillBlock } from '../helpers.js';

test('an exchange validates actors, target scope and resources and supplies automatic defence', async () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { mana: 0 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Shadow Cut', 1, 'agi', 'mana', 'sweep every foe'], ['Shadow Step', 2, 'agi', 'stamina', 'evasion']]) },
        foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5], ['Spiders', 1, 2, 5]]) },
    };
    const { host } = await setup({ blocks });
    try {
        const sheet = readSheet(host.head()), actor = sheet.characters[0];
        assert.equal(actionSkills(actor)[0].reason, 'Mana is Empty');
        assert.match(exchangePlan(sheet, [{ who: 'Astra', kind: 'skill', skill: 'Shadow Cut', area: true }]).error, /Mana is Empty/);
        assert.match(exchangePlan(sheet, [{ who: 'Astra', kind: 'attack', target: 99 }]).error, /no longer standing/);
        assert.match(exchangePlan(sheet, [{ who: 'Astra', kind: 'skill', skill: 'Shadow Step', target: 1 }]).error, /cannot be used/);
        const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'attack', target: 2 }]);
        assert.equal(built.plan.acts[0].target, 'foe2');
        assert.deepEqual(built.plan.foes.map(foe => foe.skill), ['Shadow Step', 'Shadow Step']);
    } finally { host.close(); }
});
