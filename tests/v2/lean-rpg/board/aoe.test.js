// The area rule of the board (record `aoe: 1`): an area skill hits EVERY standing group on one roll, the picked group in full and
// every other group one Health block less (never below a plain hit). Records without `aoe` keep the old one-group rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { autoPicks } from '../../../../src/v2/lean-rpg/board/auto.js';
import { memberRolls } from '../../../../src/v2/lean-rpg/board/member-rolls.js';
import { splitFoes } from '../../../../src/v2/lean-rpg/board/members.js';
import { exchangePlan } from '../../../../src/v2/lean-rpg/board/plan.js';
import { boardSession, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { prepareStandard, rollStandard } from '../../../../src/v2/lean-rpg/standard.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { buildPanel, panelModel, readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { character, levelFoeBlock, rollReceipt, setup, sheetDomain, skillBlock } from '../helpers.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const dice = (table = {}, fallback = 10) => (kind, at) => { const list = [...(table[`${kind}${at}`] ?? [])]; return () => (list.length ? list.shift() : fallback); };
const blocks = foes => ({
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 8, stamina: 4 }) },
    skills: { role: 'skills', fields: skillBlock('Astra', [['Sweep', 3, 'str', 'stamina', 'sweep every foe']]) },
    foes: { role: 'foes', fields: levelFoeBlock(foes) },
});
const stateOf = foes => ({ domains: { dataModules: sheetDomain(blocks(foes)) } });
const SWEEP = group => [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group }];

// Group 1 a lone Mother, group 2 a pack of 12 rats at `rats` of 8 blocks, group 3 a lone Bat.
function direct(rats, group, table, aoe = true) {
    const base = readSheet(stateOf([['Mother', 1, 1, 4], ['Rats', 12, 1, 4], ['Bat', 1, 1, 4]]));
    const sheet = { ...base, foes: splitFoes(base.foes, { carried: { values: { 21: rats }, counts: { 2: 12 } } }) };
    const built = exchangePlan(sheet, SWEEP(group), {}, 1, { members: true, aoe });
    assert.equal(built.error, undefined, built.error);
    const hooks = memberRolls(built.plan);
    const prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const rolled = rollStandard(built.plan, prepared, dice(table), rules, { flow: 2, fix: true, then: true, board: true, memberRolls: hooks });
    return { built, lines: rolled.rounds[0].lines.filter(line => line.kind === 'act') };
}

test('AOE: every standing group is hit on one roll, the picked group in full and the others reduced', () => {
    const { built, lines } = direct(8, 1, { init0: [20], act0: [20, 1] });
    assert.equal(built.plan.acts[0].aoe, true);
    assert.deepEqual(lines.map(line => line.foe.name.split(' ')[0]), ['Mother', 'Rats', 'Bat'], 'the groups in order');
    assert.equal(lines.length, 3, 'one line for each group');
    assert.deepEqual(lines.map(line => line.reduced === true), [false, true, true]);
    assert.equal(new Set(lines.map(line => `${line.pc.die}/${line.foe.die}/${line.outcome}/${line.decisive}`)).size, 1, 'one roll for the whole attack');
    assert.deepEqual(lines.map(line => line.pc.die), [20, 20, 20]);
    assert.equal(lines.every(line => line.area === true), true);
});

test('AOE: a reduced pack takes one block less than the main hit and never less than a plain hit', () => {
    // Main is the pack: decisive area blocks of an 8-block pack = ceil(8/3)+1 = 4. The lone groups take a plain decisive hit (2).
    const main = direct(8, 2, { init0: [20], act0: [20, 1] }).lines;
    assert.equal(main.find(line => line.foe.name.startsWith('Rats')).damage.blocks, 4);
    assert.deepEqual(main.filter(line => line.reduced).map(line => line.damage.blocks), [2, 2]);
    // Main is a lone group: the pack is the reduced one. 4 - 1 = 3, above the plain 2.
    const pack = direct(8, 1, { init0: [20], act0: [20, 1] }).lines.find(line => line.foe.name.startsWith('Rats'));
    assert.equal(pack.reduced, true);
    assert.equal(pack.damage.blocks, 3);
    // The floor, on a small pack: full decisive = 1 + 1 = 2, one less would be 1, but a plain decisive hit is 2.
    const hooks = memberRolls({}), bar = { value: 3, size: 3, foe: { pack: true } };
    assert.equal(hooks.hitBlocks({ area: true }, bar, true, true), 2);
    assert.equal(hooks.hitBlocks({ area: true }, bar, false, true), 1, 'not decisive: floor of 1');
    assert.equal(hooks.hitBlocks({ area: true }, { ...bar, size: 9, value: 9 }, false, true), 2, 'ceil(9/3) = 3, one less');
    assert.equal(hooks.hitBlocks({ area: true }, { ...bar, foe: {} }, true, true), undefined, 'a lone bar: the plain hit');
});

test('AOE: a missed roll hurts no group', () => {
    const lines = direct(8, 1, { init0: [20], act0: [1, 20] }).lines;
    assert.equal(lines.length, 3);
    assert.equal(lines.every(line => !line.damage), true);
});

test('AOE: a record without aoe keeps the old rule (the picked group only, no reduced line)', () => {
    const old = direct(8, 1, { init0: [20], act0: [20, 1] }, false);
    assert.equal(old.built.plan.acts[0].aoe, undefined);
    assert.deepEqual(old.lines.map(line => line.foe.name), ['Mother']);
    assert.equal(old.lines.some(line => line.reduced), false);
});

test('AOE: the engine plays the same exchange the same way twice, and a setup without aoe plays the old way', () => {
    const state = stateOf([['Mother', 1, 1, 4], ['Bat', 1, 1, 4]]);
    const config = { seed: 3, offset: 0, rules, members: 1, aoe: 1 }, choice = [{ actions: SWEEP(1) }];
    const a = playBoard(state, config, choice), b = playBoard(state, config, choice);
    assert.equal(a.error, undefined, a.error);
    assert.deepEqual(a.result, b.result, 'replay == live');
    const lines = a.result.rounds[0].lines.filter(line => line.kind === 'act');
    assert.deepEqual(lines.map(line => line.foe.name), ['Mother', 'Bat']);
    assert.deepEqual(lines.map(line => line.reduced === true), [false, true]);
    const old = playBoard(state, { ...config, aoe: undefined }, choice);
    assert.deepEqual(old.result.rounds[0].lines.filter(line => line.kind === 'act').map(line => line.foe.name), ['Mother']);
});

test('AOE: a new session records aoe: 1 and Auto picks the weakest group as the main target', () => {
    const state = stateOf([['Mother', 1, 1, 4], ['Bat', 1, 1, 2]]);
    const opened = openBoard({}, state, { sid: 's1', rules });
    assert.equal(opened.error, undefined, opened.error);
    assert.equal(opened.session.setup.aoe, 1);
    const picks = autoPicks({ state, setup: opened.session.setup }, rules), area = picks.find(pick => pick.area);
    assert.equal(area?.target, 2, 'Auto aims the area at the weakest group, as its target always was');
    const sheet = readSheet(state), built = exchangePlan({ ...sheet, foes: splitFoes(sheet.foes) }, picks, opened.session.setup.flags, 1, { members: true, aoe: true });
    assert.equal(built.plan.acts[0].group, 2);
    assert.equal(built.plan.acts[0].aoe, true);
});

test('AOE: the battle log reads "also hits <group> (reduced)" after the main hit', () => {
    const state = stateOf([['Mother', 1, 1, 4], ['Bat', 1, 1, 4]]);
    const played = playBoard(state, { seed: 3, offset: 0, rules, members: 1, aoe: 1 }, [{ actions: SWEEP(1) }]);
    const roles = () => ({ name: 'Astra', party: true });
    const result = { v: 1, key: 'k', pace: 'careful', rules, flow: 2, fix: 3, checks: [], ...played.result };
    const panel = buildPanel(setupDom(), panelModel({ resolve: readResolve(result), state: { domains: { dataModules: { instances: {}, active: {} } } }, before: null, roleOf: roles }));
    const lines = [...panel.querySelectorAll('.rpg-act-text')].map(node => node.textContent).filter(text => !text.includes(' attacks '));
    assert.ok(lines[0].startsWith('Astra uses Sweep on Mother (area)'), lines[0]);
    assert.ok(lines[1].startsWith('… also hits Bat (reduced)'), lines[1]);
    assert.equal(lines.length, 2);
});

test('AOE: the live host stores aoe: 1, rolls the reduced line, and Re-read keeps it', async () => {
    const restore = seedCrypto(77);
    const fight = blocks([['Mother', 1, 1, 4], ['Bat', 1, 1, 4]]);
    const { host } = await setup({ blocks: fight, board: true });
    try {
        const sid = host.store.carrierSid(host.store.headIndex());
        const opened = openBoard(host.ctx.chatMetadata, host.head(), { sid, rules });
        assert.equal(opened.error, undefined, opened.error);
        assert.equal(stageExchange(host.ctx.chatMetadata, host.head(), SWEEP(1)).error, undefined);
        await host.send('Go.', 'One.');
        const first = rollReceipt(host, 2).data.v2.result;
        assert.equal(boardSession(host.ctx.chatMetadata)?.setup.aoe, 1);
        const acts = first.rounds[0].lines.filter(line => line.kind === 'act');
        assert.deepEqual(acts.map(line => line.reduced === true), [false, true]);
        assert.equal((await host.sdk.reread(2)).ok, true);
        assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, first.rounds, 'Re-read keeps the rounds');
    } finally { host.close(); restore(); }
});
