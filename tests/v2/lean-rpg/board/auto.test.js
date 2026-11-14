// Auto-fight is deterministic: it targets the weakest foe, heals below half, compares payable attacks on their odds,
// guards only when hurt, and stops on the fight, a heavy hit, or the cap.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { exchangePlan } from '../../../../src/v2/lean-rpg/board/plan.js';
import { autoPicks, autoStop } from '../../../../src/v2/lean-rpg/board/auto.js';
import { character, foeBlock, levelFoeBlock, sheetDomain, skillBlock } from '../helpers.js';

const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const stateOf = blocks => ({ domains: { dataModules: sheetDomain(blocks) } });

test('Auto attacks the weakest standing foe and ties go to the first slot, for every actor', () => {
    const state = stateOf({
        first: { role: 'character', fields: character('Astra', { health: 8 }) },
        second: { role: 'character', fields: character('Ren', { health: 8 }) },
        foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 2], ['Boars', 1, 2, 2], ['Wolves', 1, 1, 4]]) },
    });
    const picks = autoPicks(state, RULES);
    assert.deepEqual(picks, [{ who: 'Astra', kind: 'attack', target: 1 }, { who: 'Ren', kind: 'attack', target: 1 }]);
    const sheet = readSheet(state);
    assert.equal(exchangePlan(sheet, picks, {}, 1).error, undefined, 'the picks are ordinary board actions');
});

test('a payable healing skill targets the lowest ally below half Health, while an empty pool does not heal', () => {
    const state = stateOf({
        astra: { role: 'character', fields: character('Astra', { health: 3 }) },
        ren: { role: 'character', fields: character('Ren', { health: 2 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Mend', 2, 'int', 'mana', 'restore an ally']]) },
        foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 4]]) },
    });
    const picks = autoPicks(state, RULES);
    assert.deepEqual(picks[0], { who: 'Astra', kind: 'skill', skill: 'Mend', target: 'Ren', support: true, difficulty: 'normal' });
    assert.equal(picks[1].kind, 'attack', 'Ren has no healing skill and attacks');
    const empty = stateOf({
        astra: { role: 'character', fields: character('Astra', { health: 2, mana: 0 }) },
        ren: { role: 'character', fields: character('Ren', { health: 1 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Mend', 2, 'int', 'mana', 'restore an ally']]) },
        foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 4]]) },
    });
    assert.equal(autoPicks(empty, RULES)[0].kind, 'attack');
});

test('the best payable attack skill is used only when its landed odds beat a plain attack', () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 5, dex: 5, health: 8 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Great Cut', 3, 'str', 'stamina', 'a strong strike']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Ogre', 1, 10, 8]]) },
    };
    const state = stateOf(blocks);
    const base = readSheet(state);
    const config = { seed: 1, offset: 0, rules: RULES, members: 1 };
    const auto = autoPicks({ state, setup: config }, RULES);
    assert.equal(auto[0].kind, 'skill');
    assert.equal(auto[0].skill, 'Great Cut');
    assert.equal(auto[0].target, 1);
    const poor = stateOf({
        ...blocks,
        skills: { role: 'skills', fields: skillBlock('Astra', [['Great Cut', 0, 'str', 'stamina', 'a strong strike']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Ogre', 1, 1, 8]]) },
    });
    assert.equal(autoPicks(poor, RULES)[0].kind, 'attack');
    assert.equal(base.characters[0].skills[0].name, 'Great Cut', 'Auto reads the sheet without changing it');
});

test('a hero below half carries the best payable defence hint; a whole hero carries none', () => {
    const state = stateOf({
        hero: { role: 'character', fields: character('Astra', { health: 2 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Dodge', 1, 'agi', 'stamina', 'evasion'], ['Parry', 3, 'str', 'stamina', 'parry']]) },
        foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 4]]) },
    });
    assert.equal(autoPicks(state, RULES)[0].defence, 'Parry');
    const whole = stateOf({
        hero: { role: 'character', fields: character('Astra', { health: 5 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Parry', 3, 'str', 'stamina', 'parry']]) },
        foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 4]]) },
    });
    assert.equal(autoPicks(whole, RULES)[0].defence, undefined);
});

test('Auto is deterministic and never flees, including in a member fight', () => {
    const state = stateOf({
        hero: { role: 'character', fields: character('Astra', { str: 20, health: 8, stamina: 4 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Sweep', 3, 'str', 'stamina', 'sweep every foe']]) },
        foes: { role: 'foes', fields: foeBlock([['Boars', 3, 1, 4]]) },
    });
    const first = autoPicks({ state, setup: { members: 1 } }, RULES);
    assert.deepEqual(autoPicks({ state, setup: { members: 1 } }, RULES), first);
    assert.equal(first[0].target, 11, 'the lowest member slot is first');
    assert.ok(first.every(action => action.kind !== 'flee'));
});

test('autoStop reports the fight first, then a heavy hit, then the cap', () => {
    const round = (lines = []) => ({ rounds: [{ n: 1, lines }] });
    assert.equal(autoStop({ stop: 'won', ...round() }, { cap: 1, done: 1 }), 'won');
    assert.equal(autoStop({ stop: 'lost', ...round() }, { cap: 1, done: 1 }), 'lost');
    assert.equal(autoStop({ stop: 'open', ...round([{ damage: { id: 'c:astra', kind: 'char', blocks: 2 } }]) }, { cap: 1, done: 1 }), 'hurt');
    assert.equal(autoStop({ stop: 'open', ...round([{ damage: { id: 'c:astra:mana', kind: 'char', blocks: 2 } }]) }, { cap: 1, done: 1 }), 'cap',
        'a resource cost is not Health');
    assert.equal(autoStop({ stop: 'open', ...round([{ damage: { id: 'c:astra', kind: 'char', blocks: 1 } }, { damage: { id: 'c:astra', kind: 'char', blocks: 1 } }]) }, { cap: 1, done: 1 }), 'hurt',
        'two hits on the same hero in one exchange add up');
    assert.equal(autoStop({ stop: 'open', ...round([{ damage: { id: 'c:astra', kind: 'char', from: 4, to: 2 } }]) }, { cap: 2, done: 1 }), 'hurt');
    assert.equal(autoStop({ stop: 'open', ...round([{ damage: { id: 'f:1', kind: 'foe', blocks: 3 } }]) }, { cap: 1, done: 1 }), 'cap');
    assert.equal(autoStop({ stop: 'open', ...round() }, { cap: 3, done: 2 }), null);
    assert.equal(autoStop({ stop: 'fled', ...round() }, { cap: 1, done: 1 }), 'cap');
});

test('Auto never uses a bag item, even for a hurt party that holds healing', () => {
    const state = stateOf({
        astra: { role: 'character', fields: character('Astra', { health: 1 }) },
        ren: { role: 'character', fields: character('Ren', { health: 1 }) },
        foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 4]]) },
    });
    state.domains.inventory = { defs: { 'story/draught': { id: 'story/draught', name: 'Healing Draught', kind: 'consumable', rarity: 'rare', tags: [] } },
        stacks: { it_a: { id: 'it_a', def: 'story/draught', qty: 5, owner: 'party', equipped: null } }, wallets: {}, aliases: {} };
    const picks = autoPicks(state, RULES);
    assert.equal(picks.length, 2);
    assert.ok(picks.every(pick => pick.kind !== 'item'), JSON.stringify(picks));
});
