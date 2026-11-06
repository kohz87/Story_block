// Foe members in a staged board fight: the virtual bars, member plans, Standard hooks and the ordinary fields written at the end.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { carriedFrom, collapseFoes, packAreaBlocks, splitFoes } from '../../../../src/v2/lean-rpg/board/members.js';
import { exchangePlan } from '../../../../src/v2/lean-rpg/board/plan.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { hashJson } from '../../../../src/v2/replay.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { prepareStandard, rollStandard } from '../../../../src/v2/lean-rpg/standard.js';
import { character, levelFoeBlock, sheetDomain, skillBlock } from '../helpers.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const stateOf = blocks => ({ domains: { dataModules: sheetDomain(blocks) } });
const dice = (table = {}, fallback = 10) => (kind, at) => {
    const list = [...(table[`${kind}${at}`] ?? [])];
    return () => (list.length ? list.shift() : fallback);
};
const action = target => ({ actions: [{ who: 'Astra', kind: 'attack', target }] });
const fieldsAt = (state, slug = 'foes') => state.domains.dataModules.instances[`pack.chat/${slug}`].chat.fields;
const carriedFor = (values, counts = { 1: 3 }, group = 1) => ({
    values: Object.fromEntries(values.map((value, at) => [group * 10 + at + 1, value])), counts,
});
const boars = () => ({
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 8 }) },
    foes: { role: 'foes', fields: levelFoeBlock([['Bristle-boar', 3, 1, 4]]) },
});

test('three boars replay, continue and keep one initiative total and adjacency per real group', () => {
    const state = stateOf(boars()), setup = { seed: 25, offset: 0, rules, members: 1 }, choice = action(11);
    const first = playBoard(state, setup, [choice]);
    assert.equal(first.error, undefined);
    assert.deepEqual(playBoard(state, setup, [choice]), first, 'the recorded setup and choices replay the same bytes');
    const foes = first.result.order.filter(entry => !entry.party);
    assert.deepEqual(foes.map(entry => entry.id), ['f:11', 'f:12', 'f:13'], 'across the turn order, members stay together in number order');
    assert.equal(new Set(foes.map(entry => entry.total)).size, 1, 'one real-slot initiative die gives every member the same total');
    assert.deepEqual(first.result.members.map(member => member.name), ['Bristle-boar 1', 'Bristle-boar 2', 'Bristle-boar 3']);

    const carriedMembers = carriedFrom(first.result.members);
    const next = playBoard(first.state, { ...setup, offset: 1, order: first.result.order, carriedMembers }, [choice]);
    const together = playBoard(state, setup, [choice, choice]);
    assert.deepEqual(next.state, together.state, 'carried bars make the next segment equal to one continuous run');
    assert.deepEqual(next.result.rounds[0], together.result.rounds[1]);
    assert.deepEqual(next.result.members, together.result.members);
});

test('a pack makes its attacks-now count as its bar thins, and every pack attack uses the same bar', () => {
    const base = readSheet(stateOf({ hero: boars().hero, foes: { role: 'foes', fields: levelFoeBlock([['Cellar-rat', 12, 1, 4]]) } }));
    const attack = [{ who: 'Astra', kind: 'attack', target: 11 }];
    for (const [value, attacks] of [[8, 3], [5, 2], [2, 1]]) {
        const pack = splitFoes(base.foes, { kept: { 1: [value] } })[0], sheet = { ...base, foes: [pack] };
        const built = exchangePlan(sheet, attack, {}, 1, { members: true });
        assert.equal(built.error, undefined);
        assert.deepEqual(built.plan.foes.map(foe => foe.slot), Array(attacks).fill(11));
        assert.deepEqual(built.plan.foes.map(foe => foe.once), Array(attacks).fill(true));
    }
});

test('H3: an area act is scoped to its group, and a decisive area hit takes a third of a pack plus one', () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 8 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Sweep', 3, 'str', 'stamina', 'sweep every foe']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Bristle-boar', 2, 1, 4], ['Cellar-rat', 2, 1, 4]]) },
    };
    const base = readSheet(stateOf(blocks)), sheet = { ...base, foes: splitFoes(base.foes) };
    const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 2 }], {}, 1, { members: true });
    assert.equal(built.plan.acts[0].group, 2);
    assert.equal(built.plan.acts[0].target, 'foe21');
    const prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true });
    const rolled = rollStandard(built.plan, prepared, dice({ init0: [20], init17: [1], init18: [1], act0: [20, 10, 10] }), rules, { flow: 2, fix: true, then: true, board: true });
    assert.deepEqual(rolled.rounds[0].lines.filter(line => line.kind === 'act').map(line => line.foe.name), ['Cellar-rat 1', 'Cellar-rat 2']);

    const packBase = readSheet(stateOf({ hero: blocks.hero, skills: blocks.skills, foes: { role: 'foes', fields: levelFoeBlock([['Cellar-rat', 12, 1, 4]]) } }));
    const pack = splitFoes(packBase.foes, { kept: { 1: [8] } })[0], packSheet = { ...packBase, foes: [pack] };
    const packPlan = exchangePlan(packSheet, [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true }], {}, 1, { members: true });
    assert.equal(packPlan.error, undefined, 'one group is selected automatically');
    const packPrepared = prepareStandard(packPlan.plan, packSheet, rules, { lv: true, fix: true, then: true });
    const packRolled = rollStandard(packPlan.plan, packPrepared, dice({ init0: [20], init17: [1], act0: [20, 1] }), rules, { flow: 2, fix: true, then: true, board: true });
    const hit = packRolled.rounds[0].lines.find(line => line.kind === 'act');
    assert.equal(hit.decisive, true);
    assert.equal(hit.damage.blocks, packAreaBlocks(8, true));
    assert.equal(hit.damage.blocks, 4);
});

test('H4: automatic defence is paid once per exchange and covers every attack on that member', () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 5, agi: 20, vit: 20, dex: 20, health: 8, stamina: 4 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Dodge', 3, 'agi', 'stamina', 'evasion']]) },
        foes: boars().foes,
    };
    const base = readSheet(stateOf(blocks)), sheet = { ...base, foes: splitFoes(base.foes) };
    const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'attack', target: 11 }], {}, 1, { members: true });
    assert.deepEqual(built.plan.foes.map(foe => foe.once), [true, true, true]);
    assert.deepEqual(built.plan.foes.map(foe => foe.paid), [undefined, undefined, undefined]);
    const prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true });
    assert.deepEqual(prepared.foes.map(foe => foe.once), [true, true, true]);
    assert.deepEqual(prepared.foes.map(foe => foe.paid), [undefined, undefined, undefined]);
    const source = dice({ init0: [20], init17: [1] });
    const rolled = rollStandard(built.plan, prepared, source, rules, { flow: 2, fix: true, then: true, board: true });
    const defence = rolled.rounds[0].lines.filter(line => line.kind === 'foe');
    assert.equal(defence.length, 3);
    assert.ok(defence.every(line => line.skill === 'Dodge'), 'the skill still adds its defence bonus');
    assert.equal(defence[0].cost.from, 4);
    assert.equal(defence[0].cost.to, 3);
    assert.ok(defence.slice(1).every(line => line.cost === undefined), 'later attacks do not spend the resource again');
    assert.deepEqual(rolled.hurts.filter(hurt => hurt.field === 'stamina').map(hurt => [hurt.from, hurt.to]), [[4, 3]]);

    const nextSheet = { ...sheet, characters: sheet.characters.map(member => ({ ...member, stamina: 3 })) };
    const nextPlan = exchangePlan(nextSheet, [{ who: 'Astra', kind: 'attack', target: 11 }], {}, 1, { members: true });
    const nextPrepared = prepareStandard(nextPlan.plan, nextSheet, rules, { lv: true, fix: true, then: true });
    const next = rollStandard(nextPlan.plan, nextPrepared, source, rules, { flow: 2, fix: true, then: true, board: true });
    assert.equal(next.rounds[0].lines.find(line => line.kind === 'foe').cost.to, 2, 'the next exchange pays again');
});

test('DEFENCE_FIRST_KILLED: payment belongs to the first attack that actually reaches the defender', () => {
    const state = stateOf({
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, dex: 20, health: 8, stamina: 4 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Dodge', 3, 'agi', 'stamina', 'evasion']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Boar', 3, 1, 1]]) },
    });
    const base = readSheet(state), sheet = { ...base, foes: splitFoes(base.foes) };
    const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'attack', target: 11 }], {}, 1, { members: true });
    const prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true });
    const fixed = (kind, at) => {
        if (kind === 'init') return () => (at === 0 ? 20 : 1);
        if (kind === 'act') return () => (at === 0 ? 20 : 1);
        return () => 10;
    };
    const rolled = rollStandard(built.plan, prepared, fixed, rules, { flow: 2, fix: true, then: true, board: true });
    const defences = rolled.rounds[0].lines.filter(line => line.kind === 'foe');
    assert.deepEqual(defences.map(line => line.foe.name), ['Boar 2', 'Boar 3'], 'the first attacker fell before it could defend');
    assert.deepEqual(defences.map(line => line.skill), ['Dodge', 'Dodge']);
    assert.deepEqual(defences.map(line => (line.cost ? [line.cost.from, line.cost.to] : null)), [[4, 3], null]);
    assert.deepEqual(rolled.hurts.filter(hurt => hurt.field === 'stamina').map(hurt => [hurt.from, hurt.to]), [[4, 3]]);
});

test('flee faces the real slot, not a virtual member', () => {
    const state = stateOf(boars()), setup = { seed: 0, offset: 0, rules, members: 1 };
    const fled = playBoard(state, setup, [{ actions: [{ who: 'Astra', kind: 'flee' }] }]);
    assert.equal(fled.result.stop, 'fled');
    const line = fled.result.rounds[0].lines[0];
    assert.equal(line.foe.slot, 1);
    assert.equal(line.foe.name, 'Bristle-boar');
});

test('won, lost and fled fights collapse members to ordinary count/hurt fields', () => {
    const wonState = stateOf({
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 8 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Sweep', 3, 'str', 'stamina', 'sweep every foe']]) },
        foes: boars().foes,
    });
    const won = playBoard(wonState, { seed: 0, offset: 0, rules, members: 1, carriedMembers: carriedFor([1, 1, 1]) },
        [{ actions: [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true }] }]);
    assert.equal(won.result.stop, 'won');
    assert.deepEqual(fieldsAt(won.state).count1, 3);
    assert.deepEqual(fieldsAt(won.state).hurt1, 0);
    assert.ok(won.result.hurts.some(hurt => hurt.field === 'hurt1' && hurt.to === 0));

    const lostState = stateOf({
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 12, health: 1 }) },
        foes: boars().foes,
    });
    const lost = playBoard(lostState, { seed: 1, offset: 0, rules, members: 1, carriedMembers: carriedFor([1, 4, 4]) }, [action(11)]);
    assert.equal(lost.result.stop, 'lost');
    assert.deepEqual([fieldsAt(lost.state).count1, fieldsAt(lost.state).hurt1], [2, 4]);
    assert.ok(lost.result.hurts.some(hurt => hurt.field === 'count1' && hurt.from === 3 && hurt.to === 2));

    const fledState = stateOf(boars());
    const fled = playBoard(fledState, { seed: 0, offset: 0, rules, members: 1, carriedMembers: carriedFor([1, 4, 4]) },
        [action(11), { actions: [{ who: 'Astra', kind: 'flee' }] }]);
    assert.equal(fled.result.stop, 'fled');
    assert.deepEqual([fieldsAt(fled.state).count1, fieldsAt(fled.state).hurt1], [2, 4]);
    assert.deepEqual(fled.result.hurts.filter(hurt => hurt.kind === 'foe').map(hurt => hurt.field), ['count1']);
});

test('pack collapse writes its left count and per-member hurt, and a setup without members keeps the old result', () => {
    const packState = stateOf({ hero: boars().hero, foes: { role: 'foes', fields: levelFoeBlock([['Reed-gnasher', 13, 1, 4]]) } });
    const packed = playBoard(packState, { seed: 0, offset: 0, rules, members: 1, carriedMembers: carriedFor([0, 3], { 1: 13 }) }, []);
    assert.deepEqual(packed.result.hurts, [], 'an open fight keeps the real Foes block untouched');
    assert.deepEqual([fieldsAt(packed.state).count1, fieldsAt(packed.state).hurt1], [13, 4]);
    assert.deepEqual(collapseFoes(readSheet(packState).foes, { 11: 0, 12: 3 }), [
        { slot: 1, module: 'pack.chat/foes', count: { from: 13, to: 3 }, hurt: { from: 4, to: 2 } },
    ], 'the pure collapse keeps the pack split');

    const fixture = JSON.parse(readFileSync(new URL('../fixtures/party.json', import.meta.url), 'utf8'));
    const role = { Character: 'character', Skills: 'skills', Foes: 'foes' };
    const blocks = Object.fromEntries(fixture.blocks.map(block => [block.slug, { role: role[block.template], fields: block.fields }]));
    const state = stateOf(blocks), sheet = readSheet(state);
    const actions = sheet.characters.filter(actor => actor.alive !== false && actor.health !== 0).map(actor => ({ who: actor.who, kind: 'attack', target: 1 }));
    const setup = { seed: 25, offset: 0, rules }, replay = playBoard(state, setup, [{ actions }]);
    assert.equal(replay.result.members, undefined, 'a setup without members never splits the foe slots');
    assert.equal(hashJson({ state: replay.state, result: replay.result }), '24a43d13a6ba8eee80469e363958399921f2edbb19b668332fb9e21213726a23');
    assert.deepEqual(playBoard(state, setup, [{ actions }]), replay);
});
