// Exchange choices are checked against the live sheet before they can be rolled.
// The test host supplies the same sheet reader as production.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { splitFoes } from '../../../../src/v2/lean-rpg/board/members.js';
import { actionSkills, exchangePlan } from '../../../../src/v2/lean-rpg/board/plan.js';
import { character, foeBlock, levelFoeBlock, setup, sheetDomain, skillBlock } from '../helpers.js';

const stateOf = blocks => ({ domains: { dataModules: sheetDomain(blocks) } });

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

test('R2: grouped plans keep a real group and flatten a pack into rotating defence entries', () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, health: 8 }) },
        ally: { role: 'character', fields: character('Ren', { str: 8, agi: 8, health: 8 }) },
        foes: { role: 'foes', fields: levelFoeBlock([['Cellar-rat', 12, 1, 4]]) },
    };
    const base = readSheet(stateOf(blocks)), sheet = { ...base, foes: splitFoes(base.foes) };
    const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'attack', target: 11 }, { who: 'Ren', kind: 'attack', target: 11 }], {}, 1, { members: true });
    assert.equal(built.error, undefined, built.error);
    assert.deepEqual(built.plan.foes.map(foe => foe.target), ['Ren', 'Astra', 'Ren'], 'targets rotate over the full attacker list');
    assert.deepEqual(built.plan.foes.map(foe => foe.once), [true, true, true], 'every pack attack joins the pay-once exchange');

    const grouped = readSheet(stateOf({
        hero: blocks.hero,
        skills: { role: 'skills', fields: skillBlock('Astra', [['Sweep', 3, 'str', 'stamina', 'sweep every foe']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Bristle-boar', 2, 1, 4], ['Spiders', 2, 1, 4]]) },
    }));
    const area = exchangePlan({ ...grouped, foes: splitFoes(grouped.foes) },
        [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 2 }], {}, 1, { members: true });
    assert.equal(area.error, undefined, area.error);
    assert.equal(area.plan.acts[0].group, 2);
    assert.equal(area.plan.acts[0].target, 'foe21');
    assert.deepEqual(area.plan.foes.map(foe => foe.target), Array(4).fill('Astra'), 'each split member attacks the lone actor');
});

test('R2: a new-board real-only fight still rotates real groups and their own automatic defence', () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, health: 8 }) },
        heroSkills: { role: 'skills', fields: skillBlock('Astra', [['Dodge', 2, 'agi', 'stamina', 'evasion']]) },
        ally: { role: 'character', fields: character('Ren', { str: 8, agi: 8, health: 8 }) },
        allySkills: { role: 'skills', fields: skillBlock('Ren', [['Duck', 1, 'agi', 'stamina', 'evasion']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Bat', 1, 1, 4], ['Wolf', 1, 1, 4]]) },
    };
    const base = readSheet(stateOf(blocks)), sheet = { ...base, foes: splitFoes(base.foes) };
    const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'attack', target: 1 }, { who: 'Ren', kind: 'attack', target: 2 }], {}, 1, { members: true });
    assert.equal(built.error, undefined, built.error);
    assert.deepEqual(built.plan.foes.map(foe => foe.slot), [1, 2], 'real count-one foes keep their real slots');
    assert.deepEqual(built.plan.foes.map(foe => foe.target), built.plan.rotation.targets.map(guard => guard.target));
    assert.deepEqual(built.plan.foes.map(foe => foe.skill), built.plan.rotation.targets.map(guard => guard.skill));
    assert.ok(built.plan.foes.every(foe => foe.once === true), 'real-only attacks share the pay-once exchange');
});

test('R2: a mixed real and pack fight picks either group and plans every pack attack', () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, health: 8 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Sweep', 3, 'str', 'stamina', 'sweep every foe'], ['Dodge', 2, 'agi', 'stamina', 'evasion']]) },
        ally: { role: 'character', fields: character('Ren', { str: 8, health: 8 }) },
        foes: { role: 'foes', fields: levelFoeBlock([['Bat', 1, 1, 4], ['Rats', 6, 1, 4]]) },
    };
    const base = readSheet(stateOf(blocks)), sheet = { ...base, foes: splitFoes(base.foes) };
    const packSlot = sheet.foes.find(foe => foe.group === 2).slot;
    for (const group of [1, 2]) {
        const area = exchangePlan(sheet, [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group }, { who: 'Ren', kind: 'attack', target: group === 1 ? packSlot : 1 }], {}, 1, { members: true });
        assert.equal(area.error, undefined, area.error);
        assert.equal(area.plan.acts[0].group, group);
        assert.equal(area.plan.acts[0].target, group === 1 ? 'foe1' : `foe${packSlot}`);
    }
    const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'attack', target: 1 }, { who: 'Ren', kind: 'attack', target: 1 }], {}, 1, { members: true });
    assert.equal(built.plan.foes.length, 3, 'the real Bat adds one attack to the two of a six-rat pack');
    assert.deepEqual(built.plan.foes.map(foe => foe.slot), [1, packSlot, packSlot]);
    assert.ok(built.plan.foes.every(foe => foe.once === true));
});
