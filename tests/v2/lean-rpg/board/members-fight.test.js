// Foe members in a staged board fight: the virtual bars, member plans, Standard hooks and the ordinary fields written at the end.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { FOE_LEVEL, foeBlocksByLevel, hardBlocksByLevel, hardFightFor } from '../../../../src/v2/lean-rpg/foes.js';
import { DM_LIMITS } from '../../../../src/v2/data-modules/schema.js';
import { openBoard } from '../../../../src/v2/lean-rpg/board/session.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { capAttackers, carriedFrom, collapseFoes, packAreaBlocks, splitFoes } from '../../../../src/v2/lean-rpg/board/members.js';
import { memberRolls } from '../../../../src/v2/lean-rpg/board/member-rolls.js';
import { exchangePlan } from '../../../../src/v2/lean-rpg/board/plan.js';
import { fleeRoll } from '../../../../src/v2/lean-rpg/board/flee.js';
import { oddsFor, subjectOdds } from '../../../../src/v2/lean-rpg/rules.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { hashJson } from '../../../../src/v2/replay.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { prepareStandard as prepareMemberStandard, rollStandard as rollMemberStandard } from '../../../../src/v2/lean-rpg/standard.js';
import { character, levelFoeBlock, sheetDomain, skillBlock } from '../helpers.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const prepareStandard = (plan, sheet, rules, options) => prepareMemberStandard(plan, sheet, rules, { ...options, memberRolls: memberRolls(plan) });
const rollStandard = (plan, prepared, source, rules, options) => rollMemberStandard(plan, prepared, source, rules, { ...options, memberRolls: memberRolls(plan) });
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
        const pack = splitFoes(base.foes, { carried: carriedFor([value], { 1: 12 }) })[0], sheet = { ...base, foes: [pack] };
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
    const pack = splitFoes(packBase.foes, { carried: carriedFor([8], { 1: 12 }) })[0], packSheet = { ...packBase, foes: [pack] };
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

// ---- the six-group rule: setup `foesSix: 1` ----

const sixBlocks = (foes, size = 6) => ({
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 8 }) },
    foes: { role: 'foes', fields: levelFoeBlock(foes, size) },
});
const SIX_GROUPS = [['Boars', 2, 1, 4], ['Rats', 3, 1, 4], ['Wolves', 1, 1, 4], ['Crows', 6, 1, 4], ['Gulls', 2, 1, 4], ['Bats', 4, 1, 4]];

test('six groups on one Foes block are read and fought: every group has its own bars and chips', () => {
    const state = stateOf(sixBlocks(SIX_GROUPS)), sheet = readSheet(state);
    assert.deepEqual(sheet.foes.map(foe => [foe.slot, foe.local, foe.name]), SIX_GROUPS.map(([name], at) => [at + 1, at + 1, name]));
    const setup = { seed: 31, offset: 0, rules, members: 1, foesSix: 1 }, first = playBoard(state, setup, []);
    assert.equal(first.error, undefined);
    assert.equal(first.result.foesSix, 1);
    const groups = [...new Set(first.result.members.map(member => member.group))];
    assert.deepEqual(groups, [1, 2, 3, 4, 5, 6]);
    assert.equal(first.result.members.length, 2 + 3 + 1 + 6 + 2 + 4, 'a group of six has six member bars');
    assert.equal(new Set(first.result.members.map(member => member.slot)).size, first.result.members.length);
    const played = playBoard(state, setup, [{ actions: [{ who: 'Astra', kind: 'attack', target: 51 }] }]);
    assert.equal(played.error, undefined);
    assert.deepEqual(playBoard(state, setup, [{ actions: [{ who: 'Astra', kind: 'attack', target: 51 }] }]), played, 'replay is the same bytes');
});

test('six groups: a group of six is six bars, a group of seven is one pack, and a 12-foe swarm attacks six times at a full bar and thins with it', () => {
    const state = stateOf(sixBlocks([['Gulls', 6, 1, 4], ['Swarm', 12, 1, 4]]));
    const base = readSheet(state), bars = splitFoes(base.foes, { six: true });
    assert.equal(bars.filter(bar => bar.group === 1 && bar.member).length, 6);
    const swarm = bars.find(bar => bar.group === 2);
    assert.equal(swarm.pack, true);
    const attack = [{ who: 'Astra', kind: 'attack', target: 21 }];
    for (const [value, attacks] of [[swarm.size, 6], [Math.ceil(swarm.size / 2), 3], [1, 1]]) {
        const built = exchangePlan({ ...base, foes: [{ ...swarm, hurt: value }] }, attack, {}, 1, { members: true });
        assert.equal(built.error, undefined);
        assert.equal(built.plan.foes.length, attacks, `bar ${value} of ${swarm.size}`);
    }
});

test('six groups: an old fight (no foesSix) keeps cap 5 and the three-attack rule, and its bytes do not change', () => {
    const six = stateOf(sixBlocks([['Gulls', 6, 1, 4], ['Swarm', 12, 1, 4]], 4));
    const old = { seed: 31, offset: 0, rules, members: 1 }, fresh = { ...old, foesSix: 1 };
    const before = playBoard(six, old, [{ actions: [{ who: 'Astra', kind: 'attack', target: 11 }] }]);
    assert.equal(before.error, undefined);
    assert.equal(before.result.foesSix, undefined);
    assert.equal(before.result.members.filter(member => member.group === 1).length, 1, 'six foes are one pack without the mark');
    assert.equal(before.result.members.find(member => member.group === 2).attacks, 3);
    assert.deepEqual(playBoard(six, old, [{ actions: [{ who: 'Astra', kind: 'attack', target: 11 }] }]), before);
    const marked = playBoard(six, fresh, []);
    assert.equal(marked.result.members.filter(member => member.group === 1).length, 6);
    assert.equal(marked.result.members.find(member => member.group === 2).attacks, 6);
});

test('six groups: a four-slot Foes block loads unchanged (slots 5 and 6 are absent, not empty slots)', () => {
    const sheet = readSheet(stateOf(sixBlocks([['Boars', 2, 1, 4]], 4)));
    assert.equal(sheet.foes.length, 4);
    assert.ok(sheet.foes.every(foe => !('local' in foe)), 'an older block reads with the keys it always had');
    const two = readSheet(stateOf({ a: sixBlocks([['Boars', 2, 1, 4]], 4).foes, b: sixBlocks([['Rats', 2, 1, 4]], 4).foes }));
    assert.deepEqual(two.foes.map(foe => [foe.slot, foe.local]), [[1, undefined], [2, undefined], [3, undefined], [4, undefined], [5, undefined], [6, undefined], [7, undefined], [8, undefined]], 'a second block still numbers 5…8');
});

// ---- the harder-foes rule: setup `foesHard: 1`, on a Foes block of the new template (its Health field holds up to 15) ----

const HURT = Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`hurt${n}`, { type: 'int', min: 0, max: 15, blocks: 'foe' }]));
const OLD_HURT = Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`hurt${n}`, { type: 'int', min: 0, max: 8, blocks: 'foe' }]));
const partyOf = n => Object.fromEntries(['Astra', 'Bram', 'Cass', 'Dov'].slice(0, n).map(who => [who, { role: 'character', fields: character(who, { str: 8, agi: 8, vit: 8, health: 8 }) }]));
const hardBlocks = (foes, party = 1, state = HURT) => ({ ...partyOf(party), foes: { role: 'foes', fields: levelFoeBlock(foes, 6), definition: { state } } });
const everyone = n => ['Astra', 'Bram', 'Cass', 'Dov'].slice(0, n).map(who => ({ who, kind: 'attack', target: 1 }));
const attacksOf = (foes, party, hard, number = 1) => {
    const sheet = readSheet(stateOf(hardBlocks(foes, party))), bars = splitFoes(sheet.foes, { six: true });
    const built = exchangePlan({ ...sheet, foes: bars }, everyone(party).map((act, at) => ({ ...act, target: bars[Math.min(at, bars.length - 1)].slot })), {}, number, { members: true, hard });
    assert.equal(built.error, undefined);
    return built.plan.foes;
};

test('harder foes: a foe has 12 + level/30 Health blocks on a new Foes block and reads as hard; an older block keeps its 4 + level/30', () => {
    const hard = readSheet(stateOf(hardBlocks([['Ogre', 1, 1, 12], ['Troll', 1, 45, 13], ['Giant', 1, 99, 15]])));
    assert.deepEqual(hard.foes.filter(foe => foe.filled).map(foe => [foe.size, foe.hard]), [[12, 1], [13, 1], [15, 1]]);
    const old = readSheet(stateOf(hardBlocks([['Ogre', 1, 1, 4], ['Troll', 1, 45, 5]], 1, OLD_HURT)));
    assert.deepEqual(old.foes.filter(foe => foe.filled).map(foe => [foe.size, foe.hard]), [[4, undefined], [5, undefined]]);
});

test('harder foes: a fight opens with foesHard only when every foe is on a new Foes block', () => {
    const rulesOf = { ...rules };
    const open = blocks => openBoard({}, stateOf(blocks), { sid: '5-abcdef', rules: rulesOf }).session.setup;
    const scaled = blocks => ({ ...blocks, ...Object.fromEntries(Object.entries(blocks).filter(([, block]) => block.role === 'character').map(([who, block]) => [who, { ...block, definition: structuredClone(STANDARD_TEMPLATES[0].definition) }])) });
    assert.equal(open(scaled(hardBlocks([['Ogre', 1, 1, 12]]))).foesHard, 1);
    assert.equal(open(scaled(hardBlocks([['Ogre', 1, 1, 4]], 1, OLD_HURT))).foesHard, undefined);
    assert.equal(open(sixBlocks([['Ogre', 1, 1, 4]])).foesHard, undefined, 'a block with no definition of its own is an older one');
});

test('harder foes: a foe hit costs 2 Health blocks, a decisive one 4; without the flag 1 and 2', () => {
    const state = stateOf(hardBlocks([['Ogre', 1, 1, 12]])), seen = { hard: new Set(), old: new Set() };
    for (let seed = 1; seed <= 40; seed += 1) for (const [name, extra] of [['hard', { foesHard: 1 }], ['old', {}]]) {
        const played = playBoard(state, { seed, offset: 0, rules, members: 1, foesSix: 1, ...extra }, [{ actions: everyone(1) }]);
        assert.equal(played.error, undefined);
        for (const line of played.result.rounds.flatMap(round => round.lines)) if (line.kind === 'foe' && line.damage) seen[name].add(`${line.decisive ? 'decisive' : 'clean'}:${line.damage.blocks}`);
        assert.equal(played.result.foesHard, extra.foesHard);
    }
    assert.deepEqual([...seen.hard].sort(), ['clean:2', 'decisive:4']);
    assert.deepEqual([...seen.old].sort(), ['clean:1', 'decisive:2']);
});

test('harder foes: the foe side of a roll adds level / 4 (heroes and the order keep the numbers\' divisor)', () => {
    const sheet = readSheet(stateOf(hardBlocks([['Ogre', 1, 20, 12]])));
    const built = exchangePlan(sheet, everyone(1), {}, 1, { members: false });
    const bonus = hard => prepareStandard(built.plan, sheet, rules, { lv: true, hard }).foes[0].foe.classBonus;
    assert.equal(bonus(true), 5);
    assert.equal(bonus(false), 4);
    const initiative = hard => prepareStandard(built.plan, sheet, rules, { lv: true, hard }).roster.foes[0].initiative;
    assert.equal(initiative(true), initiative(false));
});

test('harder foes: a lone foe attacks ceil(living party / 2) times; a group of several foes and the old rules keep one each', () => {
    for (const [party, attacks] of [[1, 1], [2, 1], [3, 2], [4, 2]]) {
        assert.equal(attacksOf([['Ogre', 1, 5, 12]], party, true).length, attacks, `${party} heroes`);
        assert.equal(attacksOf([['Ogre', 1, 5, 12]], party, false).length, 1, `${party} heroes, old rules`);
    }
    assert.equal(attacksOf([['Wolves', 3, 5, 12]], 4, true).length, 3, 'a group of three foes: one attack each');
    assert.equal(attacksOf([['Ogre', 1, 5, 12], ['Troll', 1, 5, 12], ['Giant', 1, 5, 12]], 4, true).length, 6, 'three single foes, two attacks each, under the cap of 8');
});

test('harder foes: the foes\' attacks in all are capped at 2 x the living party, in proportion and the same each time', () => {
    const six = [['A', 1, 5, 12], ['B', 1, 5, 12], ['C', 1, 5, 12], ['D', 1, 5, 12], ['E', 1, 5, 12], ['F', 1, 5, 12]];
    const first = attacksOf(six, 2, true, 1);
    assert.equal(first.length, 4, 'six groups, two heroes: at most 4 attacks');
    assert.deepEqual(attacksOf(six, 2, true, 1), first);
    assert.notDeepEqual(attacksOf(six, 2, true, 2).map(foe => foe.slot), first.map(foe => foe.slot), 'which groups attack turns with the exchange');
    assert.equal(attacksOf(six, 2, false, 1).length, 6, 'without the flag there is no cap');
    const list = [1, 1, 1, 1, 1, 1, 2, 2, 3].map(slot => ({ slot }));
    assert.deepEqual(capAttackers(list, 4).map(foe => foe.slot), [1, 1, 2, 3], 'proportional, at least one per living group');
    assert.equal(capAttackers(list, 20), list);
});

test('harder foes: a fight begun without the flag replays its old numbers byte for byte, and the flag is the only difference', () => {
    const state = stateOf(hardBlocks([['Ogre', 1, 1, 12]])), old = { seed: 9, offset: 0, rules, members: 1, foesSix: 1 };
    const choices = [{ actions: everyone(1) }, { actions: everyone(1) }];
    const before = playBoard(state, old, choices);
    assert.deepEqual(playBoard(state, structuredClone(old), choices), before);
    assert.equal(before.result.foesHard, undefined);
    const marked = playBoard(state, { ...old, foesHard: 1 }, choices);
    assert.equal(marked.result.foesHard, 1);
    const differs = [1, 2, 3, 4, 5, 6, 7, 8].some(seed => JSON.stringify(playBoard(state, { ...old, seed }, choices).result.rounds) !== JSON.stringify(playBoard(state, { ...old, seed, foesHard: 1 }, choices).result.rounds));
    assert.ok(differs, 'the flag changes the numbers on some seed');
});

test('harder foes: the new Foes template starts a group at 12 Health, holds up to 15, and the checker allows that many stages', () => {
    const foes = STANDARD_TEMPLATES.find(entry => entry.name === 'Foes').definition;
    assert.equal(foes.state.hurt1.default, 12);
    assert.equal(foes.state.hurt6.max, FOE_LEVEL.hardMax);
    assert.equal(hardBlocksByLevel(99), FOE_LEVEL.hardMax, 'level 99 is the most');
    assert.equal(DM_LIMITS.foeStages, FOE_LEVEL.hardMax + 1);
    assert.deepEqual([1, 29, 30, 60, 90].map(hardBlocksByLevel), [12, 12, 13, 14, 15]);
    assert.deepEqual([1, 29, 30, 60, 90].map(level => foeBlocksByLevel(level)), [4, 4, 5, 6, 7], 'the older rule is untouched');
});

test('harder foes: the board\'s "attacks on you" count is what the plan makes (lone foe doubling and the cap), and unchanged without the flag', () => {
    const attacksIn = (foes, party, hard, offset = 0) => {
        const played = playBoard(stateOf(hardBlocks(foes, party)), { seed: 3, offset, rules, members: 1, foesSix: 1, ...(hard ? { foesHard: 1 } : {}) }, []);
        assert.equal(played.error, undefined);
        return played.result.members.map(member => member.attacks);
    };
    assert.deepEqual(attacksIn([['Ogre', 1, 5, 12]], 3, true), [2], 'a lone foe against 3 heroes: 2 attacks');
    assert.deepEqual(attacksIn([['Ogre', 1, 5, 12]], 4, true), [2]);
    assert.deepEqual(attacksIn([['Ogre', 1, 5, 12]], 3, false), [1], 'without the flag: 1');
    assert.deepEqual(attacksIn([['Wolves', 3, 5, 12]], 4, true), [1, 1, 1], 'a group of several: one each');
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map(name => [name, 1, 5, 12]);
    const capped = attacksIn(six, 2, true);
    assert.equal(capped.reduce((a, b) => a + b, 0), 4, 'six lone foes against 2 heroes: the cap of 4 shows');
    assert.equal(attacksIn(six, 2, false).reduce((a, b) => a + b, 0), 6);
    // the board's count is the plan's: for every party size and exchange number
    for (const party of [1, 2, 3, 4]) for (const offset of [0, 1, 2]) {
        const state = stateOf(hardBlocks(six.slice(0, 3), party)), sheet = readSheet(state), bars = splitFoes(sheet.foes, { six: true });
        const built = exchangePlan({ ...sheet, foes: bars }, everyone(party).map(act => ({ ...act, target: bars[0].slot })), {}, offset + 1, { members: true, hard: true });
        const shown = playBoard(state, { seed: 3, offset, rules, members: 1, foesSix: 1, foesHard: 1 }, []).result.members.reduce((sum, member) => sum + member.attacks, 0);
        assert.equal(shown, built.plan.foes.length, `${party} heroes, exchange ${offset + 1}`);
    }
});

test('harder foes: the foe side of a new roll records its divisor (4); an old roll records none, so its log keeps ÷ 5', () => {
    const sheet = readSheet(stateOf(hardBlocks([['Ogre', 1, 20, 12]])));
    const built = exchangePlan(sheet, everyone(1), {}, 1, { members: false });
    const side = hard => prepareStandard(built.plan, sheet, rules, { lv: true, hard }).foes[0].foe;
    assert.equal(side(true).divisor, 4);
    assert.equal(Object.hasOwn(side(false), 'divisor'), false);
    const played = playBoard(stateOf(hardBlocks([['Ogre', 1, 20, 12]])), { seed: 2, offset: 0, rules, members: 1, foesSix: 1, foesHard: 1 }, [{ actions: everyone(1) }]);
    const lines = played.result.rounds.flatMap(round => round.lines).filter(line => line.foe);
    assert.ok(lines.length > 0 && lines.every(line => line.foe.divisor === 4), 'every recorded foe side of the fight tells ÷ 4');
});

test('harder foes: the flag is set only with the doubled bars too (every character scale 2): a stock Foes block added to an old-pin party plays the old rules', () => {
    const open = blocks => openBoard({}, stateOf(blocks), { sid: '5-abcdef', rules }).session.setup;
    const scaled = blocks => ({ ...blocks, ...Object.fromEntries(Object.entries(blocks).filter(([, block]) => block.role === 'character').map(([who, block]) => [who, { ...block, definition: structuredClone(STANDARD_TEMPLATES[0].definition) }])) });
    const both = open(scaled(hardBlocks([['Ogre', 1, 1, 12]], 2)));
    assert.deepEqual([both.bars, both.foesHard], [2, 1], 'new Characters and a new Foes block: both marks');
    const old = open(hardBlocks([['Ogre', 1, 1, 12]], 2));
    assert.deepEqual([old.bars, old.foesHard], [undefined, undefined], 'old-pin Characters with a new Foes block: neither mark, the old rules');
    const mixed = hardBlocks([['Ogre', 1, 1, 12]], 2);
    mixed.Astra = { ...mixed.Astra, definition: structuredClone(STANDARD_TEMPLATES[0].definition) };
    assert.equal(open(mixed).foesHard, undefined, 'one old-pin Character among new ones: no marks');
});

test('harder foes: the flee contest and the odds the skills view shows use the foe\'s level / 4 too; without the flag they keep the numbers\' divisor, byte for byte', () => {
    const sheet = readSheet(stateOf(hardBlocks([['Ogre', 1, 20, 12]])));
    const flee = hard => fleeRoll(sheet.characters[0], sheet.foes, rules, () => 10, { hard });
    assert.equal(flee(true).foe.classBonus, 5);
    assert.equal(flee(true).foe.divisor, 4, 'the line tells its divisor (the battle log reads ÷ 4)');
    assert.equal(flee(false).foe.classBonus, 4);
    assert.equal(Object.hasOwn(flee(false).foe, 'divisor'), false);
    assert.deepEqual(fleeRoll(sheet.characters[0], sheet.foes, rules, () => 10), flee(false), 'a call with no option is the old roll');
    const subject = { stat: 'str', statValue: 10, stats: { str: 10, dex: 10 }, level: 20, soul: 5, rank: 1, foeLevel: 20, foeClass: 5 };
    const old = subjectOdds(rules, subject), hard = subjectOdds(rules, { ...subject, hard: true });
    assert.deepEqual(oddsFor(rules, { bonus: 9, foeClass: 20 }), oddsFor(rules, { bonus: 9, foeClass: 20, hard: false }));
    assert.ok(hard.success < old.success, 'a level 20 foe adding 5 instead of 4 lowers the hero\'s chance');
    assert.equal(hard.bonus, old.bonus, 'the hero\'s own roll keeps its divisor');
});

test('harder foes: hardFightFor is one predicate for the board and the odds (doubled bars + every foe on a new block; empty slots decide when none is filled)', () => {
    const scaled = blocks => Object.fromEntries(Object.entries(blocks).map(([key, block]) => [key, block.role === 'character' ? { ...block, definition: structuredClone(STANDARD_TEMPLATES[0].definition) } : block]));
    const read = blocks => readSheet(stateOf(blocks));
    assert.equal(hardFightFor(read(scaled(hardBlocks([['Ogre', 1, 5, 12]])))), true);
    assert.equal(hardFightFor(read(hardBlocks([['Ogre', 1, 5, 12]]))), false, 'old-pin hero');
    assert.equal(hardFightFor(read(scaled(hardBlocks([['Ogre', 1, 5, 4]], 1, OLD_HURT)))), false, 'old Foes block');
    assert.equal(hardFightFor(read(scaled(hardBlocks([])))), true, 'no foe filled: the new block\'s slots decide');
});
