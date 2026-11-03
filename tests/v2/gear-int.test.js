// Gear integration (Story Block 2.18.0) review fixes G1 to G8: the shared bag goes to the reader's own Character, encumbrance at the limit only with gear
// on, a lasting legendary flag, the first-name / alias member match, and the item Edit that hands over and wears in one command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreModule } from '../../src/v2/domains/index.js';
import { createHarness } from './domains/helpers/fake-ctx.js';
import { stocked } from './domains/fixtures.js';
import { encumbrance, legendEarned } from '../../src/v2/domains/inventory.js';
import { planGear, sameWho } from '../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../src/v2/lean-rpg/index.js';
import { character, sheetDomain } from './lean-rpg/helpers.js';

const sheetOf = b => readSheet({ domains: { dataModules: sheetDomain(b) } });
const gearAnswer = piece => ({ on: true, slots: piece ? { weapon: { name: piece, stats: { STR: 1 }, broken: false } } : {}, statBonus: piece ? { STR: 1 } : {}, carry: { encumbered: false, penalty: 0 } });

test('G1: the shared bag goes to the reader\'s own Character, not to whoever sorts first', () => {
    const sheet = sheetOf({ ana: { role: 'character', fields: character('Ana') }, wessel: { role: 'character', fields: character('Wessel') } });
    assert.deepEqual(sheet.characters.map(entry => entry.key), ['ana', 'wessel'], 'the companion sorts first');
    const answers = { party: gearAnswer('Cane Sword'), ac_ana: gearAnswer(null), ac_wes: gearAnswer(null) };
    const ask = pc => (name, args) => {
        if (name === 'party.actors') return [{ id: 'ac_ana', name: 'Ana' }, { id: 'ac_wes', name: 'Wessel' }];
        if (name === 'party.pc') return pc;
        if (name === 'inventory.gear') return answers[args.owner] ?? null;
        throw new Error('no');
    };
    // by the reader's name
    let plan = planGear(sheet, ask(null), 'Wessel');
    assert.deepEqual([plan.who.ana.own, plan.who.wessel.own], [['ac_ana'], ['ac_wes', 'party']]);
    assert.deepEqual(plan.who.wessel.add, { str: 1 });
    assert.equal(plan.who.ana.add, undefined);
    // by the party module's main character
    plan = planGear(sheet, ask({ id: 'ac_wes' }));
    assert.deepEqual(plan.who.wessel.own, ['ac_wes', 'party']);
    // the persona's first name is enough
    plan = planGear(sheetOf({ ana: { role: 'character', fields: character('Ana') }, wessel: { role: 'character', fields: character('Wessel Ashby') } }), ask(null), 'Wessel');
    assert.deepEqual(plan.who.wesselashby.own.includes('party'), true);
    // no match at all: the first block, as before
    plan = planGear(sheet, ask(null), 'Nobody');
    assert.deepEqual(plan.who.ana.own, ['ac_ana', 'party']);
    assert.deepEqual(plan.who.wessel.own, ['ac_wes']);
});

test('G8: a member is the Character by the whole name, the first name or an alias; an exact name wins', () => {
    const ren = { key: 'renashby', who: 'Ren Ashby' };
    assert.equal(sameWho(ren, 'Ren Ashby'), true);
    assert.equal(sameWho(ren, 'ren'), true, 'Ren is Ren Ashby');
    assert.equal(sameWho(ren, 'Ren Holt'), false);
    assert.equal(sameWho(ren, 'Captain', ['the Captain', 'Ren']), true, 'an alias');
    assert.equal(sameWho({ key: 'ren', who: 'Ren' }, 'Ren Ashby'), true, 'the other way round');
    const sheet = sheetOf({ a: { role: 'character', fields: character('Ren') }, b: { role: 'character', fields: character('Ren Ashby') } });
    const plan = planGear(sheet, (name, args) => (name === 'party.actors' ? [{ id: 'ac_r', name: 'Ren Ashby' }] : name === 'inventory.gear' ? gearAnswer(null) : null));
    assert.deepEqual([plan.who.ren.own.includes('ac_r'), plan.who.renashby.own.includes('ac_r')], [false, true], 'the exact name takes the actor');
});

test('G2: exactly at the limit is encumbered only with gear on; with gear off it is not (5 of 5)', () => {
    const view = { on: true, people: [{ id: 'ac_ren00001', name: 'Ren', load: 5, capacity: 5 }], load: 5, capacity: 5 };
    const tools = { query: () => view };
    assert.equal(encumbrance({}, tools).encumbered, false, 'gear off: 5/5 is not encumbered');
    assert.equal(encumbrance({}, tools, false).party, false);
    assert.equal(encumbrance({}, tools, true).encumbered, true, 'gear on: at the limit');
    const over = { on: true, people: [], load: 6, capacity: 5 };
    assert.equal(encumbrance({}, { query: () => over }).encumbered, true, 'over the limit is encumbered either way');
});

test('G4: legendary lasts once an earlier roll of the record had legend: 1, or a quest ended done; a reply taken away takes it back', () => {
    const roll = (index, legend) => ({ index, receipt: { type: 'rpg.resolve', data: { v2: { result: legend ? { legend: 1 } : {} } } } });
    const tools = (entries, threads = [], at = 8) => ({ reply: { index: at }, receipts: () => entries, query: () => threads });
    assert.equal(legendEarned(tools([roll(2, false), roll(4, false)])), false);
    assert.equal(legendEarned(tools([roll(2, true), roll(4, false)])), true, 'an earlier roll won big');
    assert.equal(legendEarned(tools([roll(2, true)], [], 1)), false, 'a roll after the reply asking does not count (replay)');
    assert.equal(legendEarned(tools([roll(4, false)])), false, 'the winning reply swiped or deleted: its receipt is gone, so is the flag');
    assert.equal(legendEarned(tools([], [{ kind: 'quest', ended: { outcome: 'done' } }])), true, 'a quest completed');
    assert.equal(legendEarned(tools([], [{ kind: 'quest', ended: { outcome: 'failed' } }, { kind: 'quest', ended: null }])), false, 'failed or open quests do not');
    assert.equal(legendEarned({ receipts: () => { throw new Error('x'); }, query: () => { throw new Error('y'); } }), false);
});

test('G7: Equipped by is all or nothing: if the slot is refused the item stays with its owner; if it fits it moves and is worn, in one command', async () => {
    const module = createCoreModule({ hooks: () => [], settings: () => ({}), extras: { gearOn: () => true, persona: () => 'Astra' } });
    const state = stocked(module);
    state.domains.inventory.defs['pack.fantasy/iron-sword'].slot = 'weapon';
    state.domains.party = { actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    const h = createHarness([module], { state });
    const run = payload => h.run('item.equip', payload, { cause: 'ui', extra: { feature: id => id === 'story-block.gear' || id === 'story-block.rpg' } });
    const stackOf = () => Object.values(h.state.domains.inventory.stacks).find(item => item.def === 'pack.fantasy/iron-sword');
    const before = [stackOf().owner, stackOf().equipped];
    const refused = await run({ stack: stackOf().id, owner: 'ac_ren00001', slot: 'body', transfer: true });
    assert.equal(refused.ok, false);
    assert.deepEqual([stackOf().owner, stackOf().equipped], before, 'nothing moved');
    const done = await run({ stack: stackOf().id, owner: 'ac_ren00001', slot: 'weapon', transfer: true });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.deepEqual([stackOf().owner, stackOf().equipped], ['ac_ren00001', 'weapon']);
});
