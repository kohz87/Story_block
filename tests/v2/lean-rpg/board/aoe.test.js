// The area rule of the board (record `aoe: 1`): an area skill hits EVERY standing group on one roll, the picked group in full and
// every other group one Health block less (never below a plain hit). Records without `aoe` keep the old one-group rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { autoPicks } from '../../../../src/v2/lean-rpg/board/auto.js';
import { memberRolls } from '../../../../src/v2/lean-rpg/board/member-rolls.js';
import { boardFoes, splitFoes } from '../../../../src/v2/lean-rpg/board/members.js';
import { exchangePlan } from '../../../../src/v2/lean-rpg/board/plan.js';
import { boardSession, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { settledNote } from '../../../../src/v2/lean-rpg/board/note.js';
import { memberGroups } from '../../../../src/v2/lean-rpg/board/view-data.js';
import { earnedLegend, wearGear } from '../../../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { prepareStandard, rollStandard } from '../../../../src/v2/lean-rpg/standard.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { buildPanel, panelModel, readResolve, resolveOf } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { character, levelFoeBlock, rollReceipt, setup, sheetDomain, skillBlock, tailOf } from '../helpers.js';

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

test('AOE: draws exactly two dice for the attack and skips Down or cleared groups and members', () => {
    const base = readSheet(stateOf([['Mother', 1, 1, 4], ['Rats', 3, 1, 4], ['Down', 1, 1, 0], ['Cleared', 0, 1, 4]]));
    const sheet = { ...base, foes: splitFoes(base.foes, { carried: { values: { 21: 0, 22: 4, 23: 4 }, counts: { 2: 3 } } }) };
    const built = exchangePlan(sheet, SWEEP(1), {}, 1, { members: true, aoe: true });
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    let drawn = 0;
    const source = dice({ init0: [20], act0: [20, 1] });
    const counted = (kind, at) => { const next = source(kind, at); return () => { if (kind === 'act') drawn += 1; return next(); }; };
    const rolled = rollStandard(built.plan, prepared, counted, rules, { flow: 2, fix: true, then: true, board: true, memberRolls: hooks });
    const acts = rolled.rounds[0].lines.filter(line => line.kind === 'act');
    assert.equal(drawn, 2, 'one contested roll, regardless of the number of targets');
    assert.deepEqual(acts.map(line => line.foe.slot), [1, 22, 23]);
    assert.deepEqual(acts.map(line => line.reduced === true), [false, true, true]);
    assert.ok(acts.every(line => line.damage?.blocks === 2), 'members and the lone target use the plain-hit floor');
});

test('AOE: a main group cleared by an earlier actor is not hit, and other standing groups still take reduced damage', () => {
    const fight = blocks([['Mother', 1, 1, 1], ['Rats', 3, 1, 4]]);
    fight.ally = { role: 'character', fields: character('Ally', { str: 20, agi: 20, vit: 20, health: 8 }) };
    const base = readSheet({ domains: { dataModules: sheetDomain(fight) } });
    const sheet = { ...base, foes: splitFoes(base.foes, { carried: { values: { 21: 0, 22: 4, 23: 4 }, counts: { 2: 3 } } }) };
    const actions = [{ who: 'Ally', kind: 'attack', target: 1 }, ...SWEEP(1)];
    const built = exchangePlan(sheet, actions, {}, 1, { members: true, aoe: true });
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const table = { act0: [20, 1], act1: [20, 1] };
    sheet.characters.forEach((actor, at) => { table[`init${at}`] = [actor.who === 'Ally' ? 20 : 10]; });
    for (let at = 16; at < 21; at += 1) table[`init${at}`] = [1];
    const rolled = rollStandard(built.plan, prepared, dice(table, 1), rules, { flow: 2, fix: true, then: true, board: true, memberRolls: hooks });
    const area = rolled.rounds[0].lines.filter(line => line.aoe);
    assert.deepEqual(area.map(line => line.foe.slot), [1, 22, 23]);
    assert.equal(area[0].aoeNoTarget, true);
    assert.equal(area[0].damage, undefined);
    assert.ok(area.slice(1).every(line => line.reduced && line.damage?.blocks === 2));
    assert.match(settledNote({ ...rolled, members: [] }), /main target already Down/);
});

test('AOE: a decisive miss wears the weapon once for the roll, even with multiple main and reduced bars', () => {
    const base = readSheet(stateOf([['Rats', 3, 1, 4], ['Bat', 1, 1, 4]]));
    const sheet = { ...base, foes: splitFoes(base.foes) }, built = exchangePlan(sheet, SWEEP(1), {}, 1, { members: true, aoe: true });
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const rolled = rollStandard(built.plan, prepared, dice({ init0: [20], act0: [1, 20] }), rules, { flow: 2, fix: true, then: true, board: true, memberRolls: hooks });
    const acts = rolled.rounds[0].lines.filter(line => line.kind === 'act');
    assert.equal(acts.length, 4);
    let wears = 0;
    const ctx = { query: () => ({ slots: { weapon: { name: 'Sword', cond: 4, broken: false } } }), call: () => { wears += 1; return { data: { before: 4, now: 3 } }; } };
    const events = wearGear(ctx, { who: { astra: { own: ['party'] } } }, { rounds: [{ n: 1, lines: acts }], rules, condWord: String });
    assert.equal(wears, 1);
    assert.equal(events.length, 1);
});

test('AOE: secondary groups keep their own level while the breakdown uses the main target\'s roll', () => {
    const base = readSheet(stateOf([['Mother', 1, 1, 4], ['Wyrm', 1, 25, 4]]));
    const sheet = { ...base, foes: splitFoes(base.foes) }, built = exchangePlan(sheet, SWEEP(1), {}, 1, { members: true, aoe: true });
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const rolled = rollStandard(built.plan, prepared, dice({ init0: [20], act0: [20, 1] }), rules, { flow: 2, fix: true, then: true, board: true, memberRolls: hooks });
    const area = rolled.rounds[0].lines.filter(line => line.aoe);
    assert.deepEqual(area.map(line => line.aoeLevel), [1, 25]);
    assert.equal(area[1].foe.total, area[0].foe.total, 'both targets use the main target\'s contest');
    const result = { ...rolled, lv: 1, stop: 'won', rounds: [{ n: 1, lines: area }] };
    const read = readResolve(result);
    assert.equal(read.orderEntries.find(entry => entry.name === 'Wyrm').level, 25);
    assert.match(read.rounds[0].lines[1].breakdown, /vs Mother d20/u);
    assert.equal(earnedLegend(result, { characters: [{ level: 5 }] }, true), true, 'a higher-level secondary group counts toward the award');
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

test('AOE: picker and recorded group names keep a lone foe singular and name several packs together', () => {
    const state = stateOf([['Tunnel Rat', 24, 1, 4], ['Grey-Tooth Nest-Mother', 1, 1, 4]]);
    const config = { seed: 3, offset: 0, rules, members: 1, aoe: 1 };
    const members = playBoard(state, config, []).result.members;
    assert.deepEqual(memberGroups(members, readSheet(state).foes, { aoe: true }).map(group => group.label), ['Tunnel Rat packs', 'Grey-Tooth Nest-Mother']);
    const acts = playBoard(state, config, [{ actions: SWEEP(1) }]).result.rounds[0].lines.filter(line => line.aoe);
    assert.deepEqual(acts.map(line => line.aoeName), ['Tunnel Rat packs', 'Tunnel Rat packs', 'Grey-Tooth Nest-Mother']);
});

test('AOE: the battle log reads "also hits <group> (reduced)" after the main hit', () => {
    const state = stateOf([['Mother', 1, 1, 4], ['Bat', 1, 1, 4]]);
    const played = playBoard(state, { seed: 3, offset: 0, rules, members: 1, aoe: 1 }, [{ actions: SWEEP(1) }]);
    const roles = () => ({ name: 'Astra', party: true });
    const result = { v: 1, key: 'k', pace: 'careful', rules, flow: 2, fix: 3, checks: [], ...played.result };
    const panel = buildPanel(setupDom(), panelModel({ resolve: readResolve(result), state: { domains: { dataModules: { instances: {}, active: {} } } }, before: null, roleOf: roles }));
    const lines = [...panel.querySelectorAll('.rpg-act-text')].map(node => node.textContent).filter(text => !text.includes(' attacks '));
    assert.ok(lines[0].startsWith('Astra uses Sweep (area) on Mother'), lines[0]);
    assert.match(lines[1], /^… also (hits|targets) Bat \(reduced\)/u);
    assert.equal(lines.length, 2);
});

test('AOE: the battle log combines each group\'s bars and reports a lone reduced target from its recorded move', () => {
    const base = readSheet(stateOf([['Rat', 24, 1, 4], ['Spider', 3, 1, 4], ['Mother', 1, 1, 4]]));
    const sheet = { ...base, foes: splitFoes(base.foes) }, built = exchangePlan(sheet, SWEEP(1), {}, 1, { members: true, aoe: true });
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const rolled = rollStandard(built.plan, prepared, dice({ init0: [20], act0: [20, 1] }), rules, { flow: 2, fix: true, then: true, board: true, memberRolls: hooks });
    for (const line of rolled.rounds[0].lines.filter(line => line.aoe)) line.aoeName = { 1: 'Rat packs', 2: 'Spiders', 3: 'Mother' }[line.aoeGroup];
    const values = new Map(sheet.foes.map(foe => [foe.slot, foe.hurt]));
    const result = { v: 1, key: 'k', pace: 'careful', rules, flow: 2, fix: 3, checks: [], ...rolled, members: boardFoes(base.foes, values), board: { id: 'b' } };
    const summary = settledNote(result), roles = () => ({ name: 'Astra', party: true });
    const resolve = resolveOf({ receipts: [{ type: 'rpg.resolve', summary, data: { v2: { result } } }] });
    assert.equal(resolve.receipt, summary, 'the displayed receipt is exactly the actual narrator cue');
    const panel = buildPanel(setupDom(), panelModel({ resolve, state: { domains: { dataModules: { instances: {}, active: {} } } }, roleOf: roles }));
    const lines = [...panel.querySelectorAll('.rpg-act-text')].map(node => node.textContent).filter(text => text.startsWith('Astra uses') || text.startsWith('… also'));
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Astra uses Sweep \(area\) on Rat packs — .* → .*Rat pack 1 .*Rat pack 2 /u);
    assert.match(lines[1], /^… also hits Spiders \(reduced\) → .*Spider 1 .*Spider 2 .*Spider 3 /u);
    assert.match(lines[2], /^… also hits Mother \(reduced\) → \w+/u);
    const state = stateOf([['Rat', 24, 1, 4], ['Spider', 3, 1, 4], ['Mother', 1, 1, 4]]);
    const model = panelModel({ resolve, state, roleOf: definition => definition.role });
    assert.deepEqual(model.foes.map(foe => foe.text.split(' · ')[0]), ['Rat ×24', 'Spider ×3', 'Mother']);
});

test('AOE: the battle log does not claim a missed area attack hit the other groups', () => {
    const lines = direct(8, 1, { init0: [20], act0: [1, 20] }).lines;
    const result = { v: 1, key: 'k', pace: 'careful', rules, flow: 2, fix: 3, checks: [], rounds: [{ n: 1, lines }] };
    const roles = () => ({ name: 'Astra', party: true });
    const panel = buildPanel(setupDom(), panelModel({ resolve: readResolve(result), state: { domains: { dataModules: { instances: {}, active: {} } } }, roleOf: roles }));
    const shown = [...panel.querySelectorAll('.rpg-act-text')].map(node => node.textContent);
    assert.ok(shown.some(text => /^… also targets Rats \(reduced\) — /u.test(text)));
    assert.ok(shown.some(text => /^… also targets Bat \(reduced\) — /u.test(text)));
    assert.ok(shown.every(text => !text.includes('also hits')));
});

test('AOE: the live host stores aoe: 1, rolls the reduced line, and Re-read keeps it', async () => {
    const restore = seedCrypto(77);
    const fight = blocks([['Mother', 1, 1, 4], ['Bat', 1, 1, 4]]);
    const { host } = await setup({ blocks: fight, board: true });
    try {
        const sid = host.store.carrierSid(host.store.headIndex());
        const opened = openBoard(host.ctx.chatMetadata, host.head(), { sid, rules });
        assert.equal(opened.error, undefined, opened.error);
        delete opened.session.setup.areaAll;   // an old record: it has no `areaAll` mark and keeps the main-group rule
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), SWEEP(1));
        assert.equal(staged.error, undefined);
        const sent = await host.send('Go.', 'One.');
        const first = rollReceipt(host, 2).data.v2.result;
        const cue = rollReceipt(host, 2).summary;
        assert.deepEqual(first.rounds, staged.preview.result.rounds, 'live matches the board preview');
        assert.match(cue, /Bat \(Sweep\) \(area, reduced\)/u);
        assert.ok(tailOf(sent.request).includes(cue), 'the narrator receives that exact cue');
        assert.equal(boardSession(host.ctx.chatMetadata)?.setup.aoe, 1);
        const acts = first.rounds[0].lines.filter(line => line.kind === 'act');
        assert.deepEqual(acts.map(line => line.reduced === true), [false, true]);
        assert.equal((await host.sdk.reread(2)).ok, true);
        assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, first.rounds, 'Re-read keeps the rounds');
        assert.equal(rollReceipt(host, 2).summary, cue);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'rebuild keeps the live state');
        await host.store.flush();
        const saved = structuredClone(host.st.saves.at(-1)), meta = structuredClone(host.ctx.chatMetadata);
        await host.st.loadChat(saved, 'reload-aoe');
        host.ctx.chatMetadata = meta;
        assert.equal(JSON.stringify(host.head()), live, 'reload keeps the live state');
        assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, first.rounds);
    } finally { host.close(); restore(); }
});

// The newer area rule (setup `areaAll: 1`): no main group, every standing group takes the full effect.
function direct2(table, group) {
    const base = readSheet(stateOf([['Mother', 1, 1, 4], ['Rats', 12, 1, 4], ['Bat', 1, 1, 4]]));
    const sheet = { ...base, foes: splitFoes(base.foes, { carried: { values: { 21: 8 }, counts: { 2: 12 } } }) };
    const built = exchangePlan(sheet, SWEEP(group), {}, 1, { members: true, aoe: true, areaAll: true });
    assert.equal(built.error, undefined, built.error);
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const rolled = rollStandard(built.plan, prepared, dice(table), rules, { flow: 2, fix: true, then: true, board: true, memberRolls: hooks });
    return { built, lines: rolled.rounds[0].lines.filter(line => line.kind === 'act') };
}

test('areaAll: plan.js accepts an area action with no group and the engine hits every standing group fully', () => {
    const { built, lines } = direct2({ init0: [20], act0: [20, 1] }, undefined);
    assert.equal(built.plan.acts[0].group, undefined, 'no group is asked for');
    assert.equal(built.plan.acts[0].areaAll, true);
    assert.equal(lines.length, 3, 'one line for each group');
    assert.equal(lines.some(line => line.reduced === true), false, 'no group takes less');
    assert.equal(lines.some(line => line.aoeNoTarget), false);
    assert.equal(new Set(lines.map(line => `${line.pc.die}/${line.foe.die}/${line.outcome}`)).size, 1, 'one roll');
    // The same blocks as a main-group hit: the pack takes the full area blocks, a lone group a plain decisive hit.
    assert.deepEqual(lines.map(line => line.damage.blocks), [2, 4, 2]);
    // A group passed anyway is ignored (an old Auto pick or a stale tap).
    assert.deepEqual(direct2({ init0: [20], act0: [20, 1] }, 3).lines.map(line => line.damage.blocks), [2, 4, 2]);
});

test('areaAll: without the mark the plan still asks for a group and keeps the reduced rule', () => {
    const base = readSheet(stateOf([['Mother', 1, 1, 4], ['Bat', 1, 1, 4]]));
    const sheet = { ...base, foes: splitFoes(base.foes) };
    assert.match(exchangePlan(sheet, SWEEP(undefined), {}, 1, { members: true, aoe: true }).error, /Choose a group/u);
    assert.equal(exchangePlan(sheet, SWEEP(undefined), {}, 1, { members: true, aoe: true, areaAll: true }).error, undefined);
});

test('areaAll: a new fight is marked, the live host rolls every group alike and Re-read keeps the bytes', async () => {
    const restore = seedCrypto(77);
    const { host } = await setup({ blocks: blocks([['Mother', 1, 1, 4], ['Bat', 1, 1, 4]]), board: true });
    try {
        const sid = host.store.carrierSid(host.store.headIndex());
        assert.equal(openBoard(host.ctx.chatMetadata, host.head(), { sid, rules }).error, undefined);
        assert.equal(boardSession(host.ctx.chatMetadata).setup.areaAll, 1);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true }]);
        assert.equal(staged.error, undefined, staged.error);
        await host.send('Go.', 'One.');
        const first = rollReceipt(host, 2).data.v2.result, cue = rollReceipt(host, 2).summary;
        assert.deepEqual(first.rounds, staged.preview.result.rounds);
        assert.doesNotMatch(cue, /reduced/u);
        assert.equal(first.rounds[0].lines.filter(line => line.kind === 'act').some(line => line.reduced), false);
        assert.equal((await host.sdk.reread(2)).ok, true);
        assert.equal(JSON.stringify(rollReceipt(host, 2).data.v2.result), JSON.stringify(first), 'Re-read: the same bytes');
        assert.equal(rollReceipt(host, 2).summary, cue);
    } finally { host.close(); restore(); }
});
