// Stage 49: a reply's exchanges run until something happens (resolve.js FLOW_VERSION), and a won fight pays the party its XP by code (fight.js).
//   - rolls: a decisive result no longer ends the reply; the rolls stop on won, lost, heavy, the cap, the budget or the careful pace, Standard and Classic;
//   - past rolls: a payload with no `flow` stops exactly as it did (Re-read keeps the record);
//   - XP: won by the dice and by the narrator's own foe lines, once per fight, to every party member who has not Left, never twice with the narrator's XP
//     line, a rise at 100, and swipe, Re-read, middle delete, rebuild and reload all agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { createFakeModel } from '../../../testkit/model.js';
import { FIGHT, FIGHT_XP, FIGHT_XP_HELD, FLOW_VERSION, LEAN_RPG_FEATURE, LIMITS, PRESETS, RESOLVE, STANDARD_FORMULA, FORMULA_SETTING, fightOf, memberXp, DEFAULT_SETTINGS, scaleXp, xpRateFrom, xpRateOf, prepare, readSheet, rollPrepared } from '../../../src/v2/lean-rpg/index.js';
import { fightLines } from '../../../src/v2/lean-rpg/view/changes-lines.js';
import { LEAN_RPG_TEMPLATES, STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { reply, success } from '../data-modules/helpers.js';
import { cueOf, character, foeBlock, levelFoeBlock, rollReceipt, setup, sheetDomain, skillBlock } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

// ---- the rolls, direct --------------------------------------------------------------------------------------------------

// Wessel (STR 10, 6 blocks), a foe group of rats: scripted dice by kind and place in the plan.
const party = ({ foes = [['Sluice Rats', 6, 2, 4]], wessel = {}, ren = null } = {}) => ({
    wessel: { role: 'character', fields: character('Wessel', { health: 6, str: 10, vit: 10, agi: 10, dex: 6, int: 5, luk: 9, cha: 5, soul: 2, level: 2, ...wessel }) },
    'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Iron Breath', 2, 'str']]) },
    ...(ren ? { ren: { role: 'character', fields: character('Ren', { health: 5, str: 5, vit: 5, agi: 8, dex: 10, int: 16, luk: 9, cha: 5, soul: 2, level: 2, ...ren }) } } : {}),
    foes: { role: 'foes', fields: foeBlock(foes) },
});
const sheetOf = blocks => readSheet({ domains: { dataModules: sheetDomain(blocks) } });
const dice = (table = {}, fallback = 10) => Object.assign((kind, at) => {
    const list = [...(table[`${kind}${at}`] ?? [])];
    return () => (list.length ? list.shift() : fallback);
}, { positional: true });
const std = (over = {}) => ({ ...STANDARD_FORMULA, ...over });
const planOf = (over = {}) => ({ formula: 'standard', pace: 'all', acts: [], foes: [], checks: [], ...over });
const hit = { who: 'Wessel', skill: 'Iron Breath', target: 'Sluice Rats' };
const roll = (plan, { blocks = party(), rules = std(), source = dice(), flow = FLOW_VERSION } = {}) => rollPrepared(plan, prepare(plan, sheetOf(blocks), rules, { flow }), source, rules, { flow });
// Classic (the narrator sets the bars; the rolls keep a count of their own to know when to stop): Wessel STR 14, rats class I.
const classic = (plan, { blocks, source = dice(), rules = PRESETS.standard, flow = FLOW_VERSION } = {}) => {
    const sheet = sheetOf(blocks ?? { ...party({ foes: [['Sluice Rats', 6, 1, 5]] }), wessel: { role: 'character', fields: character('Wessel') } });
    return rollPrepared(plan, prepare(plan, sheet, rules, { flow }), source, rules, { flow });
};
const cplan = (over = {}) => ({ pace: 'all', acts: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats' }], foes: [], checks: [], ...over });

test('Standard: a decisive hit no longer ends the reply; the rolls go on until the foes are Down (won)', () => {
    // Round 1: a natural 20 takes 2 of the 4 blocks; rounds 2 and 3 take one each.
    const result = roll(planOf({ acts: [hit] }), { source: dice({ act0: [20, 10] }) });
    assert.deepEqual(result.rounds.map(round => round.decisive), [true, false, false]);
    assert.equal(result.stop, 'won');
    assert.deepEqual(result.hurts.filter(item => item.field === 'hurt1').map(({ from, to }) => [from, to]), [[4, 0]]);
    assert.match(result.text, /Round 3 ends the rolls: every foe is Down: the fight is won\./);
    assert.match(result.text, /Code gives the party its XP for it: write no XP line for this fight/);
    // The roll made before the flow stops at that decisive round, as it did.
    const earlier = roll(planOf({ acts: [hit] }), { source: dice({ act0: [20, 10] }), flow: 1 });
    assert.deepEqual([earlier.rounds.length, earlier.stop], [1, 'decisive']);
});

test('Classic: a decisive result no longer ends the reply; a hit takes 1 stage, a decisive one 2, and the rolls stop when the foes are Down', () => {
    const result = classic(cplan(), { source: dice({ act0: [20, 10] }) });
    assert.deepEqual(result.rounds.map(round => round.decisive), [true, false, false, false]);
    assert.equal(result.stop, 'won');
    assert.equal(result.rounds.length, 4, '5 stages: 2 + 1 + 1 + 1');
    assert.match(result.text, /Round 4 ends the rolls: every foe is Down/);
    assert.deepEqual(result.summary.acts.map(act => act.outcomes.length), [4]);
    const earlier = classic(cplan(), { source: dice({ act0: [20, 10] }), flow: 1 });
    assert.deepEqual([earlier.rounds.length, earlier.stop], [1, 'decisive']);
});

test('lost: every party member is Down (Standard and Classic)', () => {
    const alone = { wessel: party().wessel, 'wessel-skills': party()['wessel-skills'], foes: party({ foes: [['Sluice Rats', 6, 6, 8]] }).foes };
    // The foe's natural 20 is a decisive hit: 2 blocks a round, from 6 blocks, so Wessel is Down in round 3 (and heavy in round 1: the first stop that happens is lost only when no one stands).
    const foe = { slot: 1, target: 'Wessel' };
    const hurt = { wessel: { ...alone.wessel, fields: { ...alone.wessel.fields, health: 1 } } };
    const result = roll(planOf({ foes: [foe] }), { blocks: { ...alone, ...hurt, foes: alone.foes }, source: dice({ foe0: [1, 20] }) });
    assert.equal(result.stop, 'lost');
    assert.equal(result.rounds.length, 1, 'Wessel, the only one, is Down in round 1');
    assert.match(result.text, /everyone on your side is Down/);
    const cl = classic({ pace: 'all', acts: [], foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }], checks: [] }, {
        blocks: { wessel: { role: 'character', fields: character('Wessel', { health: 1 }) }, foes: party({ foes: [['Sluice Rats', 6, 6, 5]] }).foes }, source: dice({ foe0: [1, 20] }) });
    assert.equal(cl.stop, 'lost');
    assert.equal(cl.rounds.length, 1);
});

test('heavy: a party member who lost 2 Health blocks (Standard) or 2 stages (Classic) in this reply, or went Down, ends the rolls', () => {
    const foe = { slot: 1, target: 'Wessel' };
    const strong = party({ foes: [['Sluice Rats', 6, 6, 8]], ren: {} });
    // A decisive foe hit takes 2 blocks at once.
    const decisive = roll(planOf({ acts: [hit], foes: [foe] }), { blocks: strong, source: dice({ foe0: [1, 20] }) });
    assert.equal(decisive.stop, 'heavy');
    assert.equal(decisive.rounds.length, 1);
    // Two plain hits (a block each) in two rounds: the second makes it heavy.
    const plain = roll(planOf({ acts: [hit], foes: [foe] }), { blocks: strong, source: dice({ foe0: [2, 20, 10, 10, 2, 20, 2, 20, 2, 20] }) });
    assert.ok(plain.rounds.length >= 1 && plain.rounds.length <= 8);
    const lost = (round) => round.lines.filter(line => line.kind === 'foe' && line.damage).reduce((total, line) => total + line.damage.blocks, 0);
    assert.equal(plain.stop, 'heavy');
    assert.ok(plain.rounds.reduce((total, round) => total + lost(round), 0) >= 2);
    assert.ok(plain.rounds.slice(0, -1).reduce((total, round) => total + lost(round), 0) < 2, 'it stopped at the first round that made it two');
    // Classic
    const cl = classic({ pace: 'all', acts: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats' }], foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }], checks: [] },
        { blocks: { wessel: { role: 'character', fields: character('Wessel') }, 'wessel-skills': party()['wessel-skills'], foes: party({ foes: [['Sluice Rats', 6, 6, 5]] }).foes }, source: dice({ foe0: [1, 20] }) });
    assert.equal(cl.stop, 'heavy');
    assert.equal(cl.rounds.length, 1);
});

test('cap: the rules\' most exchanges per reply ends the rolls; careful still rolls one exchange', () => {
    const big = party({ foes: [['Sluice Rats', 6, 6, 8]] });
    const capped = roll(planOf({ acts: [hit] }), { blocks: big, rules: std({ roundCap: 3 }) });
    assert.deepEqual([capped.rounds.length, capped.stop], [3, 'cap']);
    const normal = roll(planOf({ pace: 'normal', acts: [hit] }), { blocks: big, rules: std({ roundCap: 8 }) });
    assert.deepEqual([normal.rounds.length, normal.stop], [8, 'cap'], 'the normal pace is no longer five: the cap decides');
    const careful = roll(planOf({ pace: 'careful', acts: [hit] }), { blocks: big, rules: std({ roundCap: 8 }) });
    assert.deepEqual([careful.rounds.length, careful.stop], [1, 'pace']);
    const cl = classic(cplan({ pace: 'careful' }));
    assert.deepEqual([cl.rounds.length, cl.stop], [1, 'pace']);
    assert.equal(PRESETS.standard.roundCap, LIMITS.roundCapDefault);
    assert.equal(LIMITS.roundCapDefault, 8);
});

test('budget: the cue that no longer fits is cut to fewer rounds, never fewer than one, and says so', () => {
    const names = ['Adalbert the Unwavering', 'Brunhilde of the Marches', 'Cornelius Featherstone', 'Dorothea Nightingale', 'Everard Longstride', 'Fenella of the Reeds'];
    const blocks = party({ foes: [['Sluice Rat Vanguard of the Lower Drain', 20, 9, 5], ['Sluice Rat Chieftain of the Lower Drain', 2, 9, 5], ['Sluice Rat Sappers of the Lower Drain', 3, 9, 5], ['Sluice Rat Archers of the Lower Drain', 3, 9, 5]] });
    for (const name of names) blocks[name] = { role: 'character', fields: character(name, { health: 5 }) };
    const acts = names.map(who => ({ who, stat: 'str', target: 'Sluice Rat Vanguard of the Lower Drain' }));
    const foes = [1, 2, 3, 4].map(slot => ({ slot, target: names[slot], defend: 'agi' }));
    const result = classic({ pace: 'all', acts, foes, checks: [] }, { blocks, source: dice({}, 20) });
    assert.ok(result.rounds.length >= 1 && result.rounds.length < 8, `${result.rounds.length} rounds`);
    assert.equal(result.stop, 'budget');
    assert.match(result.text, /is the last rolled/);
});

test('the USER\'s case: four crawlers, Hurt, against Astra: no stop on "Decisive block"; the fight runs to won', () => {
    const blocks = {
        astra: { role: 'character', fields: character('Astra', { health: 6, str: 10, vit: 10, agi: 10, dex: 6, int: 5, luk: 9, cha: 5, soul: 2, level: 2 }) },
        'astra-skills': { role: 'skills', fields: skillBlock('Astra', [['Iron Breath', 2, 'str']]) },
        foes: { role: 'foes', fields: foeBlock([['Crawlers', 4, 1, 3]]) },
    };
    const plan = planOf({ acts: [{ who: 'Astra', skill: 'Iron Breath', target: 'Crawlers' }], foes: [{ slot: 1, target: 'Astra' }] });
    // Astra defends with a natural 20 each time (a Decisive block): the old rule ended the reply on the first.
    const foe = Array.from({ length: 16 }, (_, n) => (n % 2 === 0 ? 20 : 5));
    const now = roll(plan, { blocks, source: dice({ foe0: foe }) });
    assert.equal(now.rounds[0].lines.find(line => line.kind === 'foe').decisive, true, 'round 1 holds a Decisive block');
    assert.ok(now.rounds.length > 1 && now.rounds.length <= 8, `${now.rounds.length} rounds`);
    assert.equal(now.stop, 'won');
    const before = roll(plan, { blocks, source: dice({ foe0: foe }), flow: 1 });
    assert.deepEqual([before.rounds.length, before.stop], [1, 'decisive'], 'the roll made before stops there, as it did');
});

// ---- past rolls ---------------------------------------------------------------------------------------------------------

const blocksStd = () => party({ foes: [['Sluice Rats', 6, 2, 4]], ren: {} });
const ANSWER = ['pace: all', 'act Wessel | skill: Iron Breath | type: physical | target: Sluice Rats', 'foe Sluice Rats | target: Wessel'].join('\n');
const ONE_SIDED = ['pace: all', 'act Wessel | skill: Iron Breath | type: physical | target: Sluice Rats'].join('\n');
const fieldsOf = (host, slug) => host.head().domains.dataModules.instances[`pack.chat/${slug}`].chat.fields;
const resultOf = (host, index) => rollReceipt(host, index).data.v2.result;
function same(host, label = 'a rebuild') {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${label} gives the live story`);
}
async function reloads(host) {
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live story');
    assert.deepEqual(host.store.problems(), []);
}

test('a payload with no flow (a roll made before) keeps its stop rule and its record; a Re-read, a rebuild and a reload give it back byte for byte', { skip }, async () => {
    const { host } = await setup({ blocks: blocksStd(), answers: [ANSWER], settings: { [FORMULA_SETTING]: 'standard' }, flowless: true });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const receipt = rollReceipt(host, 2);
    assert.equal('flow' in receipt.replan.payload, false);
    assert.equal('flow' in receipt.data.v2.result, false);
    assert.ok(['decisive', 'over', 'pace', 'cap', 'budget'].includes(receipt.data.v2.result.stop), receipt.data.v2.result.stop);
    const kept = JSON.stringify(receipt.data.v2.result), head = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(JSON.stringify(resultOf(host, 2)), kept);
    assert.equal(JSON.stringify(host.head()), head);
    same(host);
    await reloads(host);
    host.close();
});

test('a new roll carries the flow: Re-read, swipe, middle delete, rebuild and reload agree, and the stop is one of the new words', { skip }, async () => {
    const { host } = await setup({ blocks: blocksStd(), answers: [ANSWER], settings: { [FORMULA_SETTING]: 'standard' } });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const first = rollReceipt(host, 2);
    assert.equal(first.replan.payload.flow, FLOW_VERSION);
    assert.equal(first.data.v2.result.flow, FLOW_VERSION);
    assert.ok(['won', 'lost', 'heavy', 'cap', 'budget', 'pace'].includes(first.data.v2.result.stop), first.data.v2.result.stop);
    const kept = JSON.stringify(first.data.v2.result);
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(JSON.stringify(resultOf(host, 2)), kept);
    await host.send('Again.', 'The rats come on.');
    await host.swipe('A different telling.');
    assert.equal(resultOf(host, 4).flow, FLOW_VERSION);
    await host.st.deleteMessage(2);
    same(host);
    await reloads(host);
    host.close();
});

// ---- XP: by the dice -----------------------------------------------------------------------------------------------------

const xpOf = (host, slug) => fieldsOf(host, slug).xp;
const fightReceipts = (host, index) => host.ctx.chat[index].extra.storySuite.receipts.filter(receipt => receipt.type === FIGHT);

test('a fight won by the dice pays every party member who has not Left, once; the cue tells the narrator; swipe, Re-read, delete, rebuild and reload agree', { skip }, async () => {
    // One group of a single block against Wessel alone in the plan; nobody attacks, so the first hit that lands wins it (eight exchanges to land one).
    const weak = party({ foes: [['Sluice Rats', 6, 1, 1]], ren: {} });
    weak.foes.fields = levelFoeBlock([['Sluice Rats', 6, 1, 1]]);
    weak.ren.fields.health = 0;                      // Ren is Down: paid all the same
    weak.left = { role: 'character', fields: character('Orsolya', { left: true }) };
    const { host } = await setup({ blocks: weak, answers: [ONE_SIDED], settings: { [FORMULA_SETTING]: 'standard' } });
    const { request } = await host.send('I hit the lead rat.', 'The rats are beaten.');
    const result = resultOf(host, 2);
    assert.equal(result.stop, 'won');
    assert.equal(fieldsOf(host, 'foes').hurt1, 0);
    assert.equal(FIGHT_XP.min, 1);
    assert.deepEqual([xpOf(host, 'wessel'), xpOf(host, 'ren'), xpOf(host, 'left')], [10, 10, 0], 'level 2 against six level 1: 12 × 90 %, rounded down; Wessel and the Down Ren are paid, Orsolya who Left is not');
    const [step, ...others] = fightReceipts(host, 2);
    assert.equal(others.length, 0, 'one step');
    assert.deepEqual(step.data.v2.result.fight.awards.map(award => [award.who, award.xp]), [['Ren', 10], ['Wessel', 10]]);
    assert.equal(step.data.v2.result.fight.lv, 1, 'the record carries the level version');
    assert.deepEqual(step.data.v2.result.fight.groups.map(group => [group.name, group.count, group.level]), [['Sluice Rats', 6, 1]]);
    assert.ok(step.replan && step.afterCapture === true);
    assert.deepEqual(fightLines(host.ctx.chat[2].extra.storySuite).map(line => line.text), ['Ren +10 XP (fight won)', 'Wessel +10 XP (fight won)']);
    assert.match(cueOf(rollReceipt(host, 2)), /Code gives the party its XP for it: write no XP line for this fight/);
    assert.ok(JSON.stringify(request.chat).includes('write no XP line for this fight'), 'the cue told is the cue stored');
    same(host);
    await reloads(host);
    // Re-read keeps it; the next reply (no fight left standing) pays nothing more.
    const head = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(JSON.stringify(host.head()), head);
    await host.send('I look around.', 'Quiet.');
    assert.deepEqual([xpOf(host, 'wessel'), xpOf(host, 'ren')], [10, 10], 'a fight is rewarded once');
    // A swipe of the winning reply rolls anew and pays again from nothing; a delete takes the XP with the reply.
    await host.swipe('Another telling of the lull.');
    assert.deepEqual([xpOf(host, 'wessel'), xpOf(host, 'ren')], [10, 10]);
    same(host);
    await host.st.deleteMessage(2);
    assert.deepEqual([xpOf(host, 'wessel'), xpOf(host, 'ren')], [0, 0], 'deleting the reply takes the XP with it');
    same(host);
    await reloads(host);
    host.close();
});

test('each member\'s XP: count × max(1, ceil(foe level / 10)) × 2, times 100 % + 10 % a level of gap held to 0..200 %, summed and rounded down, held to 1..60, nothing at 0', () => {
    const group = (count, level) => ({ count, level });
    assert.deepEqual([FIGHT_XP.perBand, FIGHT_XP.perLevels, FIGHT_XP.gapPercent, FIGHT_XP.maxPercent, FIGHT_XP.min, FIGHT_XP.max], [2, 10, 10, 200, 1, 60]);
    // The table for one foe of level 30 (base 1 × 3 × 2 = 6), members from 10 levels below it to 10 above it.
    assert.deepEqual([-10, -5, -3, -1, 0, 1, 3, 5, 10].map(gap => [gap, memberXp([group(1, 30)], 30 + gap)]), [[-10, 12], [-5, 9], [-3, 7], [-1, 6], [0, 6], [1, 5], [3, 4], [5, 3], [10, 0]],
        'a member 10 levels below the foe gets 200 %, level for level 100 %, 10 levels above nothing');
    const six = [group(6, 1)];                    // base 12
    assert.equal(memberXp(six, 1), 12, 'same level: the base');
    assert.equal(memberXp(six, 2), 10, 'one level above the foe: 90 % of 12 = 10.8, rounded down');
    assert.equal(memberXp(six, 6), 6, 'five above: 50 %');
    assert.equal(memberXp(six, 10), 1, 'nine above: 10 % of 12 = 1.2, rounded down to 1');
    assert.equal(memberXp(six, 11), 0, 'ten above: nothing');
    assert.equal(memberXp(six, 99), 0, 'far above: nothing');
    assert.equal(memberXp([group(6, 11)], 1), 48, 'ten below an 11-level foe (base 6 × 2 × 2 = 24): 200 %');
    assert.equal(memberXp([group(1, 10)], 8), 2, 'two below a level 10 foe: base 2 × 120 % = 2.4: 2');
    assert.equal(memberXp([group(1, 11)], 9), 4, 'level 11 is the second band of ten: base 4, 120 % = 4.8: 4');
    // the band is never below 1 and steps at 11, 21, … ; the percent is held at both ends
    assert.deepEqual([1, 10, 11, 20, 21, 99].map(level => memberXp([group(1, level)], level)), [2, 2, 4, 4, 6, 20]);
    // a group that rounds to 0 alone still counts in the total (the sum is rounded, not each group)
    assert.equal(memberXp([group(1, 1)], 5), 1, '2 × 60 % = 1.2: 1');
    assert.equal(memberXp([group(1, 1)], 11), 0, '2 × 0 % = nothing');
    assert.equal(memberXp([group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1)], 10), 1, 'nine groups of 0.2 make 1.8: 1');
    assert.equal(memberXp([group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1), group(1, 1)], 10), 2, 'ten groups of 0.2 make 2.0: 2 (a single one makes 0)');
    // mixed groups against a level 5 member: 2 foes of level 3 (base 4, 80 % = 3.2), 1 of level 1 (base 2, 60 % = 1.2), 1 of level 12 (base 4, 170 % = 6.8)
    assert.equal(memberXp([group(2, 3), group(1, 1), group(1, 12)], 5), 11, '11.2: the sum is rounded down once');
    assert.equal(memberXp([group(1, 99), group(20, 99)], 99), 60, 'at most 60');
    // two members of different levels get different amounts from the same fight
    assert.deepEqual([memberXp(six, 1), memberXp(six, 2)], [12, 10]);
    const sheet = counts => readSheet({ domains: { dataModules: sheetDomain({ c: party().wessel, foes: { role: 'foes', fields: levelFoeBlock(counts.map(([count, level]) => ['Group', count, level, 0])) } }) } });
    assert.equal(fightOf(sheet([[3, 2]]), [1]).won, true);
    assert.equal(fightOf(sheet([[3, 2]]), []).won, false, 'a fight that began with no standing group is not won now');
});

// ---- XP: by the narrator's foe lines, on the real block engine ------------------------------------------------------------

async function world(t, { answers = ['none'], party = ['Astra'], xp = 0, rate } = {}) {
    const model = createFakeModel(answers);
    const host = await createHost({ callModel: model, settings: { modules: { 'story-block': { rpgFormula: 'classic', ...(rate === undefined ? {} : { rpgXpRate: rate }) } } } });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('Begin.', 'Opening.');
    const definitionOf = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
    for (const who of party) {
        const definition = definitionOf('Character');
        if (who !== party[0]) { definition.slug = who.toLowerCase(); definition.name = who; }
        success(await host.sdk.command('dm.define', { definition }));
        success(await host.sdk.command('dm.set', { module: `pack.chat/${definition.slug}`, fields: { who, level: 2, xp } }));
    }
    success(await host.sdk.command('dm.define', { definition: definitionOf('Foes') }));
    return { host, model };
}
const slugOf = who => (who === 'Astra' ? 'character' : who.toLowerCase());
const SLOT = '+ dm foes — why | kind: set-slot-1 | name: Mud Crawlers | count: 6 | level: 1';
const DOWN = '~ dm foes — why | kind: hurt-1 | to: 0';
const XP = amount => `+ dm character — why | kind: add-xp | amount: ${amount}`;
const fields = (host, who) => host.head().domains.dataModules.instances[`pack.chat/${slugOf(who)}`].chat.fields;

test('a fight won by the narrator\'s own foe lines pays the party once; Astra (level 2) against six level 1 crawlers gets 10', { skip }, async t => {
    const { host } = await world(t, { party: ['Astra', 'Ren'] });
    await host.send('A swarm.', reply(SLOT));
    assert.equal(fields(host, 'Astra').xp, 0, 'a fight that is only begun pays nothing');
    await host.send('I strike.', reply('~ dm foes — why | kind: hurt-1 | to: 2'));
    assert.equal(fields(host, 'Astra').xp, 0, 'hurt, not Down');
    await host.send('I finish them.', reply(DOWN));
    assert.deepEqual([fields(host, 'Astra').xp, fields(host, 'Ren').xp], [10, 10]);
    assert.deepEqual(fightLines(host.ctx.chat[8].extra.storySuite).map(line => line.text), ['Astra +10 XP (fight won)', 'Ren +10 XP (fight won)']);
    // The beaten group stays on the block: the next reply pays nothing.
    await host.send('We rest.', reply('+ dm character — why | kind: add-xp | amount: 0'));
    assert.deepEqual([fields(host, 'Astra').xp, fields(host, 'Ren').xp], [10, 10]);
    // A new group in another slot is a new fight, paid for its own groups only.
    await host.send('A hound.', reply('+ dm foes — why | kind: set-slot-2 | name: Silt Hound | count: 1 | level: 2'));
    assert.equal(fields(host, 'Astra').xp, 10);
    await host.send('I kill it.', reply('~ dm foes — why | kind: hurt-2 | to: 0'));
    assert.equal(fields(host, 'Astra').xp, 12);
    assert.deepEqual(host.store.problems(), []);
    same(host);
    await reloads(host);
});

test('the narrator\'s XP line in the reply that won the fight is not used, in either order, with one Problems line; in another reply it stands', { skip }, async t => {
    for (const lines of [[DOWN, XP(50)], [XP(50), DOWN]]) {
        const { host } = await world(t);
        await host.send('A swarm.', reply(SLOT));
        await host.send('I finish them.', reply(...lines));
        assert.equal(fields(host, 'Astra').xp, 10, `${lines[0]} first: the code's 10, not 60`);
        assert.equal(fields(host, 'Astra').level, 2);
        assert.deepEqual(host.turn.problems().filter(problem => problem.message === FIGHT_XP_HELD).map(problem => problem.code), ['LIMITED'], 'one Problems line');
        // In another reply the narrator's XP line is the narrator's.
        await host.send('A kindness.', reply(XP(30)));
        assert.equal(fields(host, 'Astra').xp, 40);
        same(host);
        await reloads(host);
        host.close();
    }
});

test('XP reaching 100 raises the level by the block\'s own rule and carries the rest (back to 0 XP, 1 point)', { skip }, async t => {
    const { host } = await world(t, { xp: 95 });
    await host.send('A swarm.', reply(SLOT));
    await host.send('I finish them.', reply(DOWN));
    const astra = fields(host, 'Astra');
    assert.deepEqual([astra.level, astra.xp, astra.points], [3, 0, 1]);
    same(host);
    // A swipe takes the XP and the rise with it.
    await host.swipe(reply('~ dm foes — why | kind: hurt-1 | to: 3'));
    const swiped = fields(host, 'Astra');
    assert.deepEqual([swiped.level, swiped.xp, swiped.points], [2, 95, 0]);
    same(host);
});

test('Re-read, middle delete, rebuild and reload agree for a fight won over several replies', { skip }, async t => {
    const { host } = await world(t, { party: ['Astra', 'Ren'] });
    await host.send('A swarm.', reply(SLOT));
    await host.send('I strike.', reply('~ dm foes — why | kind: hurt-1 | to: 2'));
    await host.send('I finish them.', reply(DOWN));
    assert.equal(fields(host, 'Astra').xp, 10);
    const head = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(8)).ok, true);
    assert.equal(JSON.stringify(host.head()), head, 'a Re-read gives the same story');
    same(host);
    // Deleting the reply that began the fight leaves nothing to win: the XP goes with it, and the rest still agrees with a rebuild and a reload.
    await host.st.deleteMessage(4);
    assert.equal(fields(host, 'Astra').xp, 0);
    // (the later foe lines no longer apply on a story with no crawlers: the replay says so, which is not the XP step's doing)
    assert.ok(host.store.problems().every(problem => problem.code === 'REPLAY_PREREQUISITE'), JSON.stringify(host.store.problems().map(problem => problem.code)));
    assert.equal(host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === FIGHT).length, 0, 'the step went with the story it was planned on');
    same(host);
    const after = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), after, 'a reload gives the live story');
});

test('the step is not tied to the feature: a reply that has it keeps it when the RPG is switched off, and no new fight is paid while it is off', { skip }, async t => {
    const { host } = await world(t);
    await host.send('A swarm.', reply(SLOT));
    await host.send('I finish them.', reply(DOWN));
    assert.equal(fields(host, 'Astra').xp, 10);
    host.features.set(LEAN_RPG_FEATURE, false);
    assert.equal((await host.turn.reread(4)).ok, true);
    assert.equal(fields(host, 'Astra').xp, 10, 'the step kept on the reply stands');
    await host.send('A second swarm.', reply('+ dm foes — why | kind: set-slot-2 | name: Others | count: 2 | level: 5'));
    await host.send('Done.', reply('~ dm foes — why | kind: hurt-2 | to: 0'));
    assert.equal(fields(host, 'Astra').xp, 10, 'off means off: nothing new is paid');
});

test('deleting an earlier reply that gave XP plans the fight\'s step again on the new numbers; swipe of the winning reply takes the XP back', { skip }, async t => {
    const { host } = await world(t);
    await host.send('A kindness.', reply(XP(30)));
    await host.send('A swarm.', reply(SLOT));
    await host.send('I finish them.', reply(DOWN));
    assert.equal(fields(host, 'Astra').xp, 40);
    await host.st.deleteMessage(4);
    assert.equal(fields(host, 'Astra').xp, 10, 'the kindness is gone; the fight still pays its 10');
    assert.deepEqual(host.turn.problems().filter(problem => problem.code === 'FAILED'), []);
    same(host);
    const after = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), after, 'a reload gives the live story');
    await host.swipe(reply('~ dm foes — why | kind: hurt-1 | to: 3'));
    assert.equal(fields(host, 'Astra').xp, 0, 'the swiped telling did not win it');
    same(host);
});

test('a member whose XP comes to 0 gets none and no receipt line; another member, nearer the foe level, is paid from the same fight', { skip }, async t => {
    const { host } = await world(t, { party: ['Astra', 'Ren'] });
    success(await host.sdk.command('dm.set', { module: 'pack.chat/ren', fields: { level: 85 } }));
    await host.send('A swarm.', reply(SLOT.replace('count: 6', 'count: 1')));
    await host.send('I finish them.', reply(DOWN));
    assert.deepEqual([fields(host, 'Astra').xp, fields(host, 'Ren').xp], [1, 0], 'one level 1 crawler (base 2): level 2 gets 90 % = 1, level 9 gets 20 % = 0.4: nothing');
    assert.deepEqual(fightLines(host.ctx.chat[6].extra.storySuite).map(line => line.text), ['Astra +1 XP (fight won)']);
    same(host);
});

// ---- a fight opened and won in the same reply -------------------------------------------------------------------------------

const AMBUSH = 'Mud-scale crawlers boil out of the silt. I ambush them.';
const OPENING = ['pace: normal', 'foe Mud-Scale Crawlers | new | count: 6 | level: 1', 'act Astra | stat: STR | target: Mud-Scale Crawlers', 'foe Mud-Scale Crawlers | target: Astra | defend: AGI'].join('\n');

test('a fight opened by the pre-call and won in the same reply is paid once; a swipe that opens it and does not win pays nothing; Re-read, rebuild and reload agree', { skip }, async t => {
    const { host } = await world(t, { answers: [OPENING, OPENING, 'none'] });
    await host.send(AMBUSH, reply(DOWN));
    assert.equal(host.head().domains.dataModules.instances['pack.chat/foes'].chat.fields.count1, 6, 'the pre-call opened the crawlers');
    assert.equal(fields(host, 'Astra').xp, 10, 'level 2 against six level 1 crawlers');
    assert.equal(host.ctx.chat[4].extra.storySuite.receipts.filter(receipt => receipt.type === FIGHT).length, 1);
    assert.deepEqual(fightLines(host.ctx.chat[4].extra.storySuite).map(line => line.text), ['Astra +10 XP (fight won)']);
    same(host);
    const head = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(4)).ok, true);
    assert.equal(JSON.stringify(host.head()), head, 'a Re-read gives the same story');
    await reloads(host);
    await host.swipe(reply('~ dm foes — why | kind: hurt-1 | to: 3'));
    assert.equal(host.head().domains.dataModules.instances['pack.chat/foes'].chat.fields.count1, 6, 'the swipe opened the crawlers again');
    assert.equal(fields(host, 'Astra').xp, 0, 'opened, hurt, not won');
    assert.equal(host.ctx.chat[4].extra.storySuite.receipts.filter(receipt => receipt.type === FIGHT).length, 0);
    same(host);
    await host.send('I finish them.', reply(DOWN));
    assert.equal(fields(host, 'Astra').xp, 10, 'won in the next reply: paid then');
    same(host);
});

test('a fight the narrator opens with its own set-slot line and wins in the same reply is paid once', { skip }, async t => {
    const { host } = await world(t);
    await host.send('A swarm, dead at once.', reply(SLOT, DOWN));
    assert.equal(fields(host, 'Astra').xp, 10);
    same(host);
    await host.send('We rest.', reply(XP(0)));
    assert.equal(fields(host, 'Astra').xp, 10, 'the beaten group does not pay again');
});

test('Standard dice: a fight opened by the pre-call and won by the dice in the same reply is paid', { skip }, async t => {
    const answer = ['foe Mud-Scale Crawlers | new | count: 2 | level: 1', 'act Astra | type: physical | target: Mud-Scale Crawlers'].join('\n');
    const model = createFakeModel([answer]);
    const host = await createHost({ callModel: model });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('Begin.', 'Opening.');
    for (const entry of STANDARD_TEMPLATES.slice(0, 3)) success(await host.sdk.command('dm.define', { definition: structuredClone(entry.definition) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 2, str: 20, dex: 20 } }));
    await host.send(AMBUSH, 'The crawlers are beaten.');
    const result = rollReceipt(host, 4).data.v2.result;
    assert.equal(result.stop, 'won');
    assert.equal(fields(host, 'Astra').xp, 3, '2 × 1 × 2 = 4, level 2 against level 1: 90 % = 3.6, rounded down');
    same(host);
});

// ---- the XP rate (rpgXpRate) ----------------------------------------------------------------------------------------------------

test('scaleXp and xpRateOf: floor(gain × rate / 100), at least 1 for a gain of 1 or more, 0 stays 0; the rate is 50..300 on a step of 25', () => {
    assert.deepEqual([50, 100, 300].map(rate => scaleXp(10, rate)), [5, 10, 30]);
    assert.deepEqual([50, 75, 100, 125, 300].map(rate => scaleXp(1, rate)), [1, 1, 1, 1, 3]);
    assert.equal(scaleXp(3, 50), 1, '1.5 floors to 1');
    assert.equal(scaleXp(0, 300), 0);
    assert.equal(scaleXp(7), 7, 'no rate is 100');
    assert.equal(scaleXp(7, 60), 7, 'a rate off the step is 100');
    assert.deepEqual([49, 50, 60, 75, 300, 301, '100', null, 1.5].map(xpRateOf), [null, 50, null, 75, 300, null, null, null, null]);
    assert.deepEqual([undefined, 100, 50, 300, 10, 999, 60, 'x'].map(rate => xpRateFrom({ rpgXpRate: rate })), [100, 100, 50, 300, 50, 300, 50, 100]);
    assert.equal(DEFAULT_SETTINGS.rpgXpRate, 100);
    assert.equal(xpRateFrom(null), 100);
});

for (const rate of [50, 100, 300]) {
    test(`XP rate ${rate}: the fight's XP and the narrator's XP line are scaled, and a later change of the setting moves no reply already made`, { skip }, async t => {
        const { host } = await world(t, { rate });
        await host.send('A swarm.', reply(SLOT));
        await host.send('I finish them.', reply(DOWN));
        const fight = Math.max(1, Math.floor(10 * rate / 100));
        assert.equal(fields(host, 'Astra').xp, fight, `the fight's 10 at ${rate} %`);
        const step = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).find(receipt => receipt.type === FIGHT);
        assert.equal(step.data.v2.result.fight.rate, rate === 100 ? undefined : rate, 'the rate is recorded unless it is 100');
        await host.send('A kindness.', reply(XP(10)));
        assert.equal(fields(host, 'Astra').xp, fight + Math.floor(10 * rate / 100), `the narrator's 10 at ${rate} %`);
        const after = fields(host, 'Astra').xp;
        // The setting changes: nothing already made moves (a rebuild, a reload), and the next reply uses the new rate.
        host.settings.set('story-block', 'rpgXpRate', rate === 300 ? 50 : 300);
        same(host);
        await reloads(host);
        assert.equal(fields(host, 'Astra').xp, after);
        await host.send('Another kindness.', reply(XP(10)));
        assert.equal(fields(host, 'Astra').xp, after + (rate === 300 ? 5 : 30));
        same(host);
    });
}

test('XP rate: a gain of 1 stays 1 at 50 %, a gain of 0 stays 0 at 300 %, and the rate is not used with the RPG off', { skip }, async t => {
    const { host } = await world(t, { rate: 50 });
    await host.send('A nod.', reply(XP(1)));
    assert.equal(fields(host, 'Astra').xp, 1);
    await host.send('Nothing.', reply(XP(0)));
    assert.equal(fields(host, 'Astra').xp, 1);
    host.features.set(LEAN_RPG_FEATURE, false);
    await host.send('Off.', reply(XP(10)));
    assert.equal(fields(host, 'Astra').xp, 11, 'off means off: the narrator\'s line is taken as written');
});
