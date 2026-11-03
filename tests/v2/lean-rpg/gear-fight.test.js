// Gear in fights, part 2b (`story-block.gear`): the worn pieces' stat bonus and the encumbered penalty in the rolls (both formulas, turn order, odds), the
// record that carries them, wear on decisive hits and misses, `ruin` breaking a piece, the log and cue lines, the legendary mark, and that a roll made
// without gear (or with the switch off) is exactly what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { createFakeModel } from '../../../testkit/model.js';
import { LEAN_RPG_TEMPLATES, STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { reply, success } from '../data-modules/helpers.js';
import { PRESETS, STANDARD_FORMULA, DICE_VERSION, FLOW_VERSION, LV_VERSION, leanRpgGuard, readSheet, resolve } from '../../../src/v2/lean-rpg/index.js';
import { cueOfResult, cueTokens, entriesWithCue, fitCue, wearLine } from '../../../src/v2/lean-rpg/cue.js';
import { ENCUMBERED, STAT_MAX, applyGear, earnedLegend, gearOf, gearValid, isDecisive, noteGear, planGear } from '../../../src/v2/lean-rpg/gear.js';
import { readResolve } from '../../../src/v2/lean-rpg/view/battle-log.js';
import { oddsView } from '../../../src/v2/lean-rpg/view/settings-data.js';
import { atLimit, condWord, loadLevel } from '../../../src/v2/domains/gear.js';
import { hashJson } from '../../../src/v2/replay.js';
import { rng, roll } from '../../../src/v2/rng.js';
import { character, levelFoeBlock, sheetDomain, skillBlock } from './helpers.js';

const blocks = (over = {}, foe = ['Sluice Rats', 6, 40, 5]) => ({
    wessel: { role: 'character', fields: character('Wessel', { str: 14, vit: 12, agi: 12, dex: 10, level: 5, ...over }) },
    'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Iron Breath', 1, 'str']]) },
    foes: { role: 'foes', fields: levelFoeBlock([foe]) },
});
const sheetOf = b => readSheet({ domains: { dataModules: sheetDomain(b) } });
const RULES = { classic: { ...PRESETS.standard, levelDivisor: 5 }, standard: { ...STANDARD_FORMULA, levelDivisor: 5 } };
const PLAN = { pace: 'all', acts: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats' }], foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }], checks: [] };
const GEAR = { v: 1, who: { wessel: { own: ['party'], add: { str: 2, vit: 1 }, items: [{ name: 'Cane Sword', stats: { str: 2 } }, { name: 'Iron Cap', stats: { vit: 1 } }] } } };

// A stand-in inventory: what Wessel wears (owner `party`), each piece with a condition; `gear.wear` goes one condition word down. Given a gear record
// (`record`, the shape a roll keeps) it answers what that record was worked out from: the bonus, the pieces that give it and the load. (Pinned change, R1: the
// roll's payload carries only the mark, so `rpg.resolve` asks the inventory for these instead of being handed the record.)
function inventory(pieces = { weapon: ['Cane Sword', 100], body: ['Boiled Leather Jerkin', 100] }, record = null) {
    const worn = Object.fromEntries(Object.entries(pieces).map(([place, [name, cond]]) => [place, { name, cond }]));
    const calls = [], entry = record ? Object.values(record.who)[0] : null;
    const statsOf = name => Object.fromEntries(Object.entries(entry?.items?.find(item => item.name === name)?.stats ?? {}).map(([stat, n]) => [stat.toUpperCase(), n]));
    const slots = () => {
        const out = Object.fromEntries(Object.entries(worn).map(([place, piece]) => [place, { name: piece.name, cond: piece.cond, broken: piece.cond === 0, stats: statsOf(piece.name) }]));
        for (const item of entry?.items ?? []) if (!Object.values(out).some(piece => piece.name === item.name)) out[`extra-${item.name}`] = { name: item.name, cond: 100, broken: false, stats: statsOf(item.name) };
        return out;
    };
    return {
        calls, worn,
        query: (name, args) => (name === 'inventory.gear' ? { on: true, owner: args.owner, slots: args.owner === 'party' ? slots() : {},
            statBonus: args.owner === 'party' ? Object.fromEntries(Object.entries(entry?.add ?? {}).map(([stat, n]) => [stat.toUpperCase(), n])) : {},
            carry: { encumbered: Boolean(entry?.enc), penalty: entry?.enc ?? 0 } } : null),
        call(type, payload) {
            calls.push([type, payload]);
            const place = payload.slot === 'defence' ? (worn.body ? 'body' : 'off-hand') : payload.slot, piece = worn[place];
            const before = piece.cond;
            piece.cond = before >= 70 ? 69 : before >= 40 ? 39 : 0;
            return { data: { before, now: piece.cond } };
        },
    };
}

function run({ b = blocks(), plan = PLAN, rules = RULES.classic, gear, seed = 1, inv = inventory(undefined, gear) } = {}) {
    const domain = sheetDomain(b), random = rng(seed);
    const ctx = { cause: 'system', caller: null, module: 'story-block', epoch: 1, source: {}, fail: (code, message) => { throw new Error(`${code}: ${message}`); },
        read: () => domain, draft: () => structuredClone(domain), claim: () => true, rng: random, roll: expression => roll(random, expression), hash: hashJson,
        replayGuard(guard, recorded) { ctx.guard = { guard, recorded }; }, query: inv.query, call: inv.call };
    const payload = { key: '1-abc', plan, rules, dice: DICE_VERSION, flow: FLOW_VERSION, lv: LV_VERSION, ...(gear ? { gear: { v: 1 } } : {}) };
    const out = resolve(ctx, payload);
    return { out, ctx, result: out.data.v2.result, text: out.summary || cueOfResult(out.data.v2.result), inv, payload };
}
const seedWhere = (found, options) => { for (let seed = 1; seed <= 400; seed += 1) { const made = run({ ...options, seed, inv: inventory(undefined, options.gear) }); if (found(made)) return seed; } return null; };

test('applyGear: stat + the pieces\' bonus held to 30, then AGI and DEX less the encumbered penalty (never under 1); the block\'s own stats are kept as `base`', () => {
    const sheet = sheetOf(blocks({ str: 14, agi: 12, dex: 2, vit: 29 }));
    const worn = applyGear(sheet, { v: 1, who: { wessel: { own: ['party'], add: { str: 3, vit: 4, dex: 1 }, enc: ENCUMBERED } } });
    const [now] = worn.characters;
    assert.deepEqual([now.stats.str, now.stats.vit, now.stats.agi, now.stats.dex], [17, STAT_MAX, 10, 1], 'STR +3; VIT 29 + 4 held to 30; AGI 12 - 2; DEX 2 + 1 - 2 = 1');
    assert.equal(STAT_MAX, 30);
    assert.equal(now.base.str, 14);
    assert.equal(applyGear(sheet, undefined), sheet, 'no gear: the sheet itself');
    assert.deepEqual(applyGear(sheet, { v: 1, who: {} }).characters[0].stats, sheet.characters[0].stats);
    assert.equal(sheet.characters[0].stats.str, 14, 'the sheet is not changed');
});

test('a gear record is read only when whole; a damaged one is rolled without gear', () => {
    assert.equal(gearValid(GEAR), true);
    assert.equal(gearOf(GEAR), GEAR);
    for (const bad of [null, [], { v: 2, who: {} }, { v: 1 }, { v: 1, who: { a: { own: [], add: { foo: 1 } } } }, { v: 1, who: { a: { own: [], enc: 2 } } }, { v: 1, who: { a: {} } }, { v: 1, who: {}, extra: 1 }]) assert.equal(gearValid(bad), false, JSON.stringify(bad));
    assert.equal(gearOf({ v: 1 }), undefined);
});

test('planGear: the worn pieces\' bonus (broken ones give none), the party actor of a member and `party` for the lead, and the load', () => {
    const sheet = sheetOf({ ...blocks(), ren: { role: 'character', fields: character('Ren') } });
    const answers = {
        party: { on: true, slots: { weapon: { name: 'Cane Sword', stats: { DEX: 2 }, broken: false }, body: { name: 'Jerkin', stats: {}, broken: true } }, statBonus: { STR: 0, DEX: 2 }, carry: { encumbered: false, penalty: 0 } },
        ac_ren: { on: true, slots: { 'off-hand': { name: 'Oak Buckler', stats: { VIT: 1 }, broken: false } }, statBonus: { VIT: 1 }, carry: { encumbered: true, penalty: -2 } },
    };
    const query = (name, args) => { if (name === 'party.actors') return [{ id: 'ac_ren', name: 'Ren' }]; if (name === 'inventory.gear') return answers[args.owner] ?? null; throw new Error('no'); };
    const plan = planGear(sheet, query);
    // (the sheet reads blocks in id order: Ren first, so Ren is the lead)
    assert.deepEqual(plan.who.ren.items, [{ name: 'Oak Buckler', stats: { vit: 1 } }, { name: 'Cane Sword', stats: { dex: 2 } }], 'the actor\'s pieces, then the party\'s');
    assert.deepEqual(plan.who.ren.own, ['ac_ren', 'party']);
    assert.deepEqual(plan.who.ren.add, { vit: 1, dex: 2 });
    assert.equal(plan.who.ren.enc, -2);
    assert.deepEqual(plan.who.wessel, { own: [] }, 'not the lead, no actor: nothing');
    assert.equal(planGear(sheet, () => null), null, 'the inventory answers nothing (gear off): no record');
    assert.equal(planGear(sheet, undefined), null);
    assert.equal(gearValid(plan), true);
});

test('a roll with gear: the bonus is in the stat the roll reads (Classic), the record carries it, the line names the gear, and the guard keeps it', () => {
    const plain = run({ seed: 7 }), geared = run({ seed: 7, gear: GEAR });
    const act = result => result.rounds[0].lines.find(line => line.kind === 'act');
    assert.equal(act(plain.result).pc.statBonus, 7, 'STR 14: half');
    assert.equal(act(geared.result).pc.statBonus, 8, 'STR 14 + 2: half of 16');
    assert.deepEqual(act(geared.result).pc.gear, [{ name: 'Cane Sword', stat: 'str', n: 2 }]);
    assert.deepEqual(geared.result.gear, GEAR, 'the record is in the result');
    assert.deepEqual(geared.ctx.guard.recorded.gear, GEAR, 'and in what the guard is given');
    assert.equal(act(geared.result).pc.die, act(plain.result).pc.die, 'the same dice');
    // the foe's line is the defender's: AGI here (no gear on AGI), VIT bonus is not used by AGI
    assert.equal(geared.result.rounds[0].lines.find(line => line.kind === 'foe').pc.gear, undefined);
    // the receipt's cue is what the record gives back
    assert.equal(cueOfResult(geared.result), geared.text);
});

test('a roll with gear, Standard: both stats of the pair read the effective stat, the record says which gear it was, turn order reads AGI', () => {
    const b = blocks({ dex: 10, str: 10, agi: 10 });
    const gear = { v: 1, who: { wessel: { own: ['party'], add: { str: 4, agi: 4 }, items: [{ name: 'Cane Sword', stats: { str: 4 } }, { name: 'Boots', stats: { agi: 4 } }] } } };
    const plan = { formula: 'standard', pace: 'all', acts: [{ who: 'Wessel', skill: 'Iron Breath', type: 'physical', target: 'Sluice Rats' }], foes: [], checks: [] };
    const plain = run({ b, plan, rules: RULES.standard, seed: 3 }), geared = run({ b, plan, rules: RULES.standard, seed: 3, gear });
    const line = result => result.rounds[0].lines.find(entry => entry.kind === 'act');
    assert.equal(line(plain.result).pc.mainValue, 10);
    assert.equal(line(geared.result).pc.mainValue, 14, 'STR 10 + 4');
    assert.deepEqual(line(geared.result).pc.gear, [{ name: 'Cane Sword', stat: 'str', n: 4 }]);
    const own = result => result.order.find(entry => entry.party);
    assert.equal(own(geared.result).agi, 14, 'the turn order reads the effective AGI');
    assert.equal(own(plain.result).agi, 10);
    assert.equal(own(geared.result).bonus, own(plain.result).bonus + 2, 'AGI/2 grows by 2');
    assert.equal(cueOfResult(geared.result), geared.text);
});

test('encumbered: AGI and DEX less 2 in the roll, recorded like the bonus, named in the line', () => {
    const gear = { v: 1, who: { wessel: { own: ['party'], enc: ENCUMBERED } } };
    const plan = { pace: 'all', acts: [], foes: [], checks: [{ who: 'Wessel', stat: 'dex', difficulty: 'hard' }] };
    const plain = run({ plan, seed: 4 }), heavy = run({ plan, seed: 4, gear });
    assert.equal(plain.result.checks[0].pc.statBonus, 5, 'DEX 10');
    assert.equal(heavy.result.checks[0].pc.statBonus, 4, 'DEX 8');
    assert.deepEqual(heavy.result.checks[0].pc.gear, [{ name: 'Encumbered', stat: 'dex', n: -2 }]);
    assert.equal(heavy.result.gear.who.wessel.enc, -2);
    // STR is not touched
    assert.equal(run({ plan: { ...plan, checks: [{ who: 'Wessel', stat: 'str', difficulty: 'hard' }] }, seed: 4, gear }).result.checks[0].pc.gear, undefined);
});

test('from 100 %: at the capacity is encumbered, under it is not; the Carry card bands are red from 100 % and yellow from 80 % (74 of 74)', () => {
    assert.deepEqual([atLimit(74, 74), atLimit(73, 74), atLimit(75, 74), atLimit(0, 0), atLimit(1, 0)], [true, false, true, false, true]);
    assert.deepEqual([loadLevel(74, 74), loadLevel(73, 74), loadLevel(60, 74), loadLevel(59, 74), loadLevel(75, 74)], ['over', 'heavy', 'heavy', 'normal', 'over']);
});

test('gear off (no `gear` in the payload) is the roll as it was: no gear, wear or legend in the record, nothing asked of the inventory', () => {
    const inv = inventory(), asked = [];
    const guarded = { ...inv, query: (...args) => { asked.push(args); return inv.query(...args); }, call: (...args) => { asked.push(args); return inv.call(...args); } };
    for (const rules of [RULES.classic, RULES.standard]) {
        const made = run({ rules, seed: 11, inv: guarded, plan: rules === RULES.standard ? { ...PLAN, formula: 'standard' } : PLAN });
        assert.deepEqual(Object.keys(made.result).filter(key => ['gear', 'wear', 'legend'].includes(key)), []);
        assert.equal(made.ctx.guard.recorded.gear, undefined);
        assert.equal('gear' in made.ctx.guard.guard.predicate, false);
        assert.equal(JSON.stringify(made.result).includes('"gear"'), false);
        assert.equal(cueOfResult(made.result), made.text);
        assert.equal(made.out.summary, '');
    }
    assert.deepEqual(asked, [], 'the roll never asks the inventory');
});

test('wear: a decisive hit taken wears the body armour one step, a decisive miss the weapon; in the record, the cue and the log; none once broken', () => {
    const wearing = made => made.result.wear?.some(event => event.item === 'Boiled Leather Jerkin') && made.result.wear?.some(event => event.item === 'Cane Sword');
    const seed = seedWhere(wearing, { gear: GEAR });
    assert.ok(seed, 'some seed has both a decisive hit taken and a decisive miss');
    const made = run({ gear: GEAR, seed });
    const hit = made.result.wear.find(event => event.item === 'Boiled Leather Jerkin');
    assert.deepEqual([hit.from, hit.to, hit.who], ['good', 'worn', 'Wessel']);
    assert.ok(made.result.wear.every(event => Number.isInteger(event.n)));
    // (pinned change, G3: the call says `recorded: true`, so the roll's own record decides, not today's switch)
    assert.deepEqual(made.inv.calls[0], ['gear.wear', { owner: 'party', slot: made.inv.calls[0][1].slot, steps: 1, recorded: true }]);
    assert.ok(made.inv.calls.every(([type, payload]) => type === 'gear.wear' && payload.steps === 1));
    // the lines the wear came from really were decisive
    const lines = made.result.rounds.flatMap(round => round.lines);
    assert.ok(lines.some(line => line.kind === 'foe' && line.outcome === 'fail' && isDecisive(line, made.result.rules)));
    // the cue tells it, and is rebuilt from the record byte for byte
    assert.ok(made.text.includes(`: ${wearLine(hit)}.`));
    assert.equal(cueOfResult(made.result), made.text);
    // the log shows the roll's gear and a wear line in its round
    const log = readResolve(made.result);
    assert.ok(log.rounds.some(round => round.wear?.includes('Boiled Leather Jerkin is worn (Worn)')));
    assert.ok(lines.some(line => line.pc.gear), 'a line names the gear');
    // a broken piece wears no further
    const broken = run({ gear: GEAR, seed, inv: inventory({ weapon: ['Cane Sword', 0], body: ['Boiled Leather Jerkin', 0] }, GEAR) });
    assert.equal(broken.result.wear, undefined);
    assert.deepEqual(broken.inv.calls, []);
    // no piece worn: no wear
    assert.equal(run({ gear: GEAR, seed, inv: inventory({}, GEAR) }).result.wear, undefined);
});

test('wear words: "worn (Torn)", and a piece that breaks says so', () => {
    assert.equal(wearLine({ item: 'Boiled Leather Jerkin', to: 'torn' }), 'Boiled Leather Jerkin is worn (Torn)');
    assert.equal(wearLine({ item: 'Oak Buckler', to: 'broken' }), 'Oak Buckler breaks (Broken)');
    assert.deepEqual([100, 69, 39, 0].map(condWord), ['good', 'worn', 'torn', 'broken']);
});

test('the log\'s roll line names the gear: "Astra uses Iaijutsu (Cane Sword +2 DEX)", and a pre-gear record draws as before', () => {
    const line = { kind: 'act', outcome: 'success', skill: 'Iaijutsu', pc: { who: 'Astra', die: 10, stat: 'dex', statBonus: 6, classValue: 5, classBonus: 1, rank: 1, edge: 0, total: 18,
        gear: [{ name: 'Cane Sword', stat: 'dex', n: 2 }, { name: 'Encumbered', stat: 'agi', n: -2 }] }, foe: { slot: 1, name: 'Crawlers', die: 5, base: 4, classValue: 1, classBonus: 0, total: 9 } };
    const read = readResolve({ v: 1, rounds: [{ n: 1, lines: [line] }], checks: [], lv: 1 });
    assert.equal(read.rounds[0].lines[0].gear, 'Cane Sword +2 DEX, Encumbered −2 AGI');
    assert.match(read.rounds[0].lines[0].breakdown, /· Cane Sword \+2 DEX, Encumbered −2 AGI$/);
    const { gear: _gear, ...bare } = line.pc;
    const before = readResolve({ v: 1, rounds: [{ n: 1, lines: [{ ...line, pc: bare }] }], checks: [], lv: 1 });
    assert.equal('gear' in before.rounds[0].lines[0], false);
});

test('the roll that carries a gear record is guarded by it: a record that was changed, dropped or invented is refused', () => {
    const made = run({ gear: GEAR, seed: 2 });
    const { guard, recorded } = made.ctx.guard;
    const state = { domains: { dataModules: sheetDomain(blocks()) } };
    const check = rec => leanRpgGuard({ state, hash: hashJson }, { guard, source: made.ctx.source, recorded: rec });
    const plain = made.ctx.guard;
    assert.equal(typeof plain.recorded.gear, 'object');
    assert.equal(check({ ...recorded, gear: { ...GEAR, who: { wessel: { ...GEAR.who.wessel, add: { str: 9 } } } } }).ok, false, 'changed');
    const { gear: _dropped, ...without } = recorded;
    assert.equal(check(without).ok, false, 'dropped');
    assert.equal(check({ ...recorded, gear: { v: 1, who: { wessel: { own: 7 } } } }).ok, false, 'damaged');
    // a roll made before has none, and a record that invents one is refused
    const old = run({ seed: 2 }).ctx.guard;
    assert.equal(leanRpgGuard({ state, hash: hashJson }, { guard: old.guard, source: made.ctx.source, recorded: { ...old.recorded, gear: GEAR } }).ok, false, 'invented');
});

test('legend: a won fight against a group 10 or more levels above the party\'s highest marks the roll; nothing else does', () => {
    const sheet = sheetOf(blocks({ level: 5 }));
    const dice = (stop, level) => ({ stop, rounds: [{ n: 1, lines: [{ foe: { classValue: level } }] }] });
    assert.equal(earnedLegend(dice('won', 15), sheet, true), true, '15 is 10 above 5');
    assert.equal(earnedLegend(dice('won', 14), sheet, true), false);
    assert.equal(earnedLegend(dice('heavy', 40), sheet, true), false, 'not won');
    assert.equal(earnedLegend(dice('won', 40), sheet, false), false, 'a roll before levels has none to compare');
});

test('the odds in Settings are for the stats the character rolls with', () => {
    const state = { domains: { dataModules: sheetDomain(blocks({ str: 8, dex: 8 })) } };
    const rules = RULES.classic;
    const bare = oddsView(state, 'Wessel', rules), geared = oddsView(state, 'Wessel', rules, { v: 1, who: { wessel: { own: ['party'], add: { str: 4, dex: 4 } } } });
    assert.ok(geared.now.success >= bare.now.success);
    assert.notDeepEqual(geared.now, bare.now);
    assert.deepEqual(oddsView(state, 'Wessel', rules, null), bare, 'no gear: as before');
});

test('noteGear writes each line\'s gear once and leaves a line with none alone', () => {
    const lines = [{ pc: { who: 'Wessel', stat: 'str' } }, { pc: { who: 'Wessel', stat: 'agi' } }, { pc: { who: 'Ren', stat: 'str' } }];
    noteGear(lines, GEAR);
    assert.deepEqual(lines[0].pc.gear, [{ name: 'Cane Sword', stat: 'str', n: 2 }]);
    assert.equal('gear' in lines[1].pc, false);
    assert.equal('gear' in lines[2].pc, false);
});

// ---- on the real host: the inventory, the block engine and the replay --------------------------------------------------------------------------------

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const PLAN_TEXT = 'pace: all\nact Astra | target: Mud Crawlers\nfoe Mud Crawlers | target: Astra | defend: AGI';
const SET = '+ dm foes — why | kind: set-slot-1 | name: Mud Crawlers | count: 6 | level: 60';
const GEAR_LINES = ['+ item Cane Sword | kind: weapon | rarity: rare | DEX: +2 | equipped: weapon', '+ item Jerkin | kind: armour | rarity: uncommon | VIT: +1 | equipped: body'];

async function world(t, { gear = true, standard = false, fields = { level: 5 }, foeLevel = 60 } = {}) {
    const plan = standard ? PLAN_TEXT.replace('act Astra |', 'act Astra | type: physical |') : PLAN_TEXT;
    const templates = standard ? STANDARD_TEMPLATES : LEAN_RPG_TEMPLATES;
    const host = await createHost({ callModel: createFakeModel(Array(40).fill(plan)), settings: { features: gear ? { 'story-block.gear': true } : {}, modules: { 'story-block': { rpgFormula: standard ? 'standard' : 'classic' } } } });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Foes']) success(await host.sdk.command('dm.define', { definition: structuredClone(templates.find(entry => entry.name === name).definition) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', ...fields } }));
    await host.send('Set.', reply(SET.replace('level: 60', `level: ${foeLevel}`), ...GEAR_LINES));
    return host;
}
const resultOf = host => host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve')?.data?.v2?.result;
const slotsOf = host => host.sdk.query('inventory.gear', { owner: 'party' })?.slots;
const stable = host => JSON.stringify(host.head());
function rebuilt(host) {
    const live = stable(host);
    host.store.rebuild();
    assert.equal(stable(host), live, 'a rebuild gives the live story');
}
async function reloaded(host) {
    const live = stable(host);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(stable(host), live, 'a reload gives the live story');
    assert.deepEqual(host.store.problems(), []);
}

test('a fight with a bonus, a wear step and a break: the record, the bonus going with the broken piece, and live = rebuild = reload = Re-read = middle delete', { skip }, async t => {
    const host = await world(t);
    const steps = [], order = ['good', 'worn', 'torn', 'broken'];
    let n = 0;
    while (slotsOf(host).body.cond > 0 && n < 14) {
        const before = slotsOf(host).body.cond;
        await host.send(`I strike ${n}.`, 'The fight.');
        n += 1;
        const result = resultOf(host), body = slotsOf(host).body.cond;
        assert.deepEqual(result.gear.who.astra.add, { vit: 1, dex: 2 }, 'the bonus recorded is what was worn when the roll was made');
        for (const event of result.wear ?? []) { steps.push(`${event.from} > ${event.to}`); assert.equal(order.indexOf(event.to) - order.indexOf(event.from), 1, 'one step'); }
        assert.ok(body <= before);
        assert.equal(body < before, (result.wear ?? []).some(event => event.item === 'Jerkin'), 'the wear in the record is the wear in the inventory');
    }
    assert.equal(slotsOf(host).body.cond, 0, 'worn down to broken');
    assert.deepEqual(steps, ['good > worn', 'worn > torn', 'torn > broken']);
    // the broken piece gives nothing: the next roll's record has no VIT bonus, and its stored roll above still says what it was
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).statBonus.VIT, 0);
    await host.send('Again.', 'The fight goes on.');
    assert.deepEqual(resultOf(host).gear.who.astra.add, { dex: 2 });
    assert.equal(resultOf(host).wear, undefined, 'a broken piece wears no further');
    const first = host.ctx.chat.map(message => message.extra?.storySuite?.receipts?.find(receipt => receipt.type === 'rpg.resolve')).find(Boolean);
    assert.deepEqual(first.data.v2.result.gear.who.astra.add, { vit: 1, dex: 2 }, 'a stored roll keeps its bonus');
    rebuilt(host);
    await reloaded(host);
    // Re-read keeps it
    const before = stable(host);
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.equal(stable(host), before);
    // a swipe rolls anew; the worn state follows the reply that is there
    await host.swipe('Another telling.');
    rebuilt(host);
    // a middle delete takes that reply's wear with it, and everything after agrees
    const at = host.ctx.chat.findIndex(message => message.extra?.storySuite?.receipts?.some(receipt => receipt.type === 'rpg.resolve' && receipt.data?.v2?.result?.wear));
    await host.st.deleteMessage(at);
    rebuilt(host);
    await reloaded(host);
    assert.deepEqual(host.store.problems(), []);
});

test('equipping something later never moves a roll that was made', { skip }, async t => {
    const host = await world(t);
    await host.send('I strike.', 'The fight.');
    const made = JSON.stringify(resultOf(host));
    const stack = host.sdk.query('inventory.items').find(item => item.name === 'Cane Sword').stack;
    await host.sdk.command('inventory.unequip', { stack });
    assert.equal(JSON.stringify(resultOf(host)), made);
    rebuilt(host);
    await reloaded(host);
});

test('gear off: no gear in the payload or the record, no wear, the same roll', { skip }, async t => {
    const host = await world(t, { gear: false });
    await host.send('I strike.', 'The fight.');
    const result = resultOf(host);
    assert.ok(result);
    assert.deepEqual(Object.keys(result).filter(key => ['gear', 'wear', 'legend'].includes(key)), []);
    assert.equal(JSON.stringify(result).includes('"gear"'), false);
    const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(entry => entry.type === 'rpg.resolve');
    assert.equal('gear' in receipt.replan.payload, false);
    rebuilt(host);
});

test('ruin: with gear on one ruin breaks the piece; scuff and tear are as they were; with gear off a ruin is as it was (100 to 60)', { skip }, async t => {
    for (const gear of [true, false]) {
        const host = await world(t, { gear });
        const stack = () => host.sdk.query('inventory.items').find(item => item.name === 'Cane Sword').stack;
        const cond = () => host.sdk.query('inventory.condition', { stack: stack() }).cond;
        await host.send('A scuff.', reply('~ item Cane Sword — nicked | wear: scuff'));
        assert.equal(cond(), 95, 'a scuff: as before');
        await host.send('A ruin.', reply('~ item Cane Sword — shattered | wear: ruin'));
        assert.equal(cond(), gear ? 0 : 55, gear ? 'ruin: broken in one step' : 'off: 95 - 40, as it was');
        rebuilt(host);
    }
});

// The host draws each roll's seed from the crypto source (rng.js seed), so this test's fights were won or lost by chance (about one run in twenty-five lost
// the one it needs). Here the source is a fixed stream: the same seeds every run, so the same dice. Everything else about the host is the real one.
function fixedSeeds(t, start = 1) {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    let n = start;
    const fake = { getRandomValues(array) { for (let at = 0; at < array.length; at += 1) { n = (Math.imul(n ^ (n >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; array[at] = n; } return array; } };
    Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
    t.after(() => { if (real) Object.defineProperty(globalThis, 'crypto', real); else delete globalThis.crypto; });
}

test('the legendary mark: the narrator\'s legendary line is held to epic, unless the same reply\'s roll won a fight against a group 10 levels above the party', { skip }, async t => {
    fixedSeeds(t);
    const host = await world(t, { standard: true, fields: { level: 1, str: 20, dex: 20, vit: 20, agi: 20 }, foeLevel: 3 });
    const rarity = n => host.sdk.query('inventory.definitions').find(def => def.name === `Blade ${n}`).rarity;
    const group = level => `+ dm foes — why | kind: set-slot-1 | name: Mud Crawlers | count: 1 | level: ${level}`;
    const fresh = '~ dm foes — why | kind: hurt-1 | to: 4';
    // (each reply fights the group the reply before set; level 10 is 9 above the party's level 1, level 11 is 10 above)
    await host.send('Set.', reply(group(10)));
    await host.send('Nine above.', reply(group(11), fresh, '+ item Blade 1 | kind: weapon | rarity: legendary'));
    assert.deepEqual([resultOf(host).stop, resultOf(host).legend, rarity(1)], ['won', undefined, 'epic'], 'a won fight 9 levels above: not enough');
    await host.send('Ten above.', reply(group(11), fresh, '+ item Blade 2 | kind: weapon | rarity: legendary'));
    assert.deepEqual([resultOf(host).stop, resultOf(host).legend, rarity(2)], ['won', 1, 'legendary'], 'won 10 levels above: the line stands');
    await host.send('Quiet.', reply('+ item Blade 3 | kind: weapon | rarity: legendary'));
    assert.equal(rarity(3), 'legendary', 'this reply still fought the group the one before set');
    await host.send('Quiet.', reply('+ item Blade 4 | kind: weapon | rarity: legendary'));
    // (pinned change, G4: once earned it lasts, so a later reply with no fight keeps the legendary line; it used to be held again)
    assert.equal(rarity(4), 'legendary', 'earned once: it lasts');
    rebuilt(host);
    await reloaded(host);
});

test('G6: the wear lines count inside the cue budget (fitCue wearOf), and the cue a reader gets (receipts) has them', () => {
    const wearing = made => made.result.wear?.length >= 1 && made.result.rounds.length >= 2;
    const seed = seedWhere(wearing, { gear: GEAR, rules: RULES.classic });
    assert.ok(seed, 'a seed with wear');
    const made = run({ gear: GEAR, seed });
    const parts = { checks: made.result.checks, rounds: made.result.rounds, refused: [], decisive: false };
    const wearOf = rounds => made.result.wear.filter(event => rounds.some(round => round.n === event.n));
    const total = rounds => cueTokens(fitCue({ ...parts, rounds }, 100000).text);
    // a budget that fits the told rounds without their wear but not with it: fewer rounds are told, and what is told fits
    const plain = fitCue(parts, 100000);
    const roomy = cueTokens(plain.text) - 1;
    const without = fitCue(parts, roomy + 40);
    const withWear = fitCue({ ...parts, wearOf }, roomy + 40);
    assert.ok(withWear.count <= without.count);
    const told = withWear.text;
    assert.ok(cueTokens(told) <= roomy + 40 || withWear.shape === 3, 'the cue with its wear lines is inside the budget');
    for (const event of wearOf(made.result.rounds.slice(0, withWear.count))) assert.ok(told.includes(wearLine(event)), 'the wear line is in the fitted cue');
    void total;
    // the cue readers get from the receipt tells the wear as well
    const receipt = { type: 'rpg.resolve', summary: '', data: { v2: { result: made.result } } };
    const [entry] = entriesWithCue([{ index: 1, receipt }]);
    assert.ok(entry.receipt.summary.includes(wearLine(made.result.wear[0])));
    assert.equal(entry.receipt.summary, made.text, 'byte for byte what the roll told');
});

test('G3: a re-planned roll wears by its stored record, so switching gear off never removes the wear an old roll made', { skip }, async t => {
    const host = await world(t);
    let n = 0;
    while (!resultOf(host)?.wear && n < 14) { await host.send(`I strike ${n}.`, 'The fight.'); n += 1; }
    const made = resultOf(host);
    assert.ok(made?.wear?.length, 'a roll that wore something');
    const worn = JSON.stringify(slotsOf(host));
    host.features.set('story-block.gear', false);
    const before = stable(host);
    host.store.rebuild();
    assert.equal(stable(host), before, 'gear off, rebuilt: the same story');
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    // (a Re-read writes the wear again under a new receipt id, so the story is compared by what it says: the pieces and the record)
    host.features.set('story-block.gear', true);
    assert.equal(JSON.stringify(slotsOf(host)), worn, 'gear off, Re-read: the pieces are as worn as before');
    host.features.set('story-block.gear', false);
    assert.deepEqual(resultOf(host).wear, made.wear);
    host.features.set('story-block.gear', true);
    assert.equal(JSON.stringify(slotsOf(host)), worn, 'and the pieces are as worn as they were');
});
