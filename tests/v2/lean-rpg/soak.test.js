// VIT soak (src/v2/lean-rpg/soak.js): on a party member's defence in a marked fight a hit lands only past 2 + S, S = min(5, floor(effective VIT / 4)); a decisive
// hit always lands; gear counts and a broken piece does not; foes get none; the mark (setup, result, predicate, guard); an old marked fight replays as it was;
// rebuild == live == Re-read == reload; the Party card's growth line; the battle log's and the narrator's words.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_TEMPLATES, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { STANDARD_FORMULA } from '../../../src/v2/lean-rpg/rules.js';
import { readSheet } from '../../../src/v2/lean-rpg/read.js';
import { applyGear, planGear } from '../../../src/v2/lean-rpg/gear.js';
import { prepareStandard, rollStandard } from '../../../src/v2/lean-rpg/standard.js';
import { memberRolls } from '../../../src/v2/lean-rpg/board/member-rolls.js';
import { splitFoes } from '../../../src/v2/lean-rpg/board/members.js';
import { exchangePlan } from '../../../src/v2/lean-rpg/board/plan.js';
import { playBoard } from '../../../src/v2/lean-rpg/board/engine.js';
import { boardGuard } from '../../../src/v2/lean-rpg/board/commit.js';
import { openBoard, stageExchange } from '../../../src/v2/lean-rpg/board/session.js';
import { settledNote } from '../../../src/v2/lean-rpg/board/note.js';
import { autoStop, hurtHeroes } from '../../../src/v2/lean-rpg/board/auto.js';
import { growthOf } from '../../../src/v2/lean-rpg/blocks.js';
import { growthText } from '../../../src/v2/lean-rpg/view/party-data.js';
import { buildPanel, panelModel, readResolve } from '../../../src/v2/lean-rpg/view/battle-log.js';
import { cueTokens } from '../../../src/v2/lean-rpg/cue.js';
import { LIMITS } from '../../../src/v2/lean-rpg/names.js';
import { SOAK_MAX, soakGrowth, soakOf } from '../../../src/v2/lean-rpg/soak.js';
import { setupDom } from '../view/mounts/helpers.js';
import { prng, seedCrypto } from '../qa/helpers/seeded.js';
import { character, levelFoeBlock, rollReceipt, setup, sheetDomain, skillBlock } from './helpers.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const NEW = STANDARD_TEMPLATES[0].definition, OLD = characterV1For();
const markedCharacter = (who, over) => ({ ...Object.fromEntries(Object.entries(NEW.state).filter(([, field]) => Object.hasOwn(field, 'default')).map(([key, field]) => [key, structuredClone(field.default)])), ...character(who, over) });
const PLAIN = [['Cut', 3, 'str', 'stamina', 'cut one foe']], SKILLS = [...PLAIN, ['Shadow Step', 3, 'agi', 'stamina', 'dodge a blow']];
const stateOf = (over = {}, definition = NEW, level = 1, skills = PLAIN) => ({ domains: { dataModules: sheetDomain({
    hero: { role: 'character', definition, fields: character('Astra', { str: 10, dex: 10, vit: 12, agi: 10, int: 5, health: 10, stamina: 12, mana: 10, ...over }) },
    skills: { role: 'skills', fields: skillBlock('Astra', skills) },
    foes: { role: 'foes', fields: levelFoeBlock([['Rat', 1, level, 4]]) },
}) } });
// The foe's attack on Astra, rolled with the given dice (her die, the foe's die); `gear` is a gear record, `soak` the fight's mark.
function defenceRoll(state, pcDie, foeDie, { soak = true, gear = null, rollRules = rules, againstMagic = false } = {}) {
    const base = applyGear(readSheet(state), gear), sheet = { ...base, foes: splitFoes(base.foes, {}) };
    const actions = sheet.characters.map(actor => ({ who: actor.who, kind: 'attack', target: sheet.foes[0].slot }));
    const built = exchangePlan(sheet, actions, {}, 1, { members: true, aoe: true, bars: true });
    assert.equal(built.error, undefined, built.error);
    if (againstMagic) for (const foe of built.plan.foes) foe.againstMagic = true;
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rollRules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const source = kind => { const list = kind === 'foe' ? [pcDie, foeDie] : kind === 'act' ? [2, 19] : []; return () => (list.length ? list.shift() : 10); };
    return rollStandard(built.plan, prepared, source, rollRules, { flow: 2, fix: true, then: true, board: true, scaled: true, soak, memberRolls: hooks });
}
const defend = (state, pcDie, foeDie, options) => defenceRoll(state, pcDie, foeDie, options).rounds[0].lines.find(line => line.kind === 'foe');
const margin = line => line.foe.total - line.pc.total;

test('S is floor(VIT / 4) up to 5, and the card\'s next step is the VIT that adds one', () => {
    assert.deepEqual([0, 3, 4, 7, 8, 12, 16, 19, 20, 30].map(soakOf), [0, 0, 1, 1, 2, 3, 4, 4, 5, 5]);
    assert.deepEqual(soakGrowth(12), { s: 3, next: 16 });
    assert.deepEqual(soakGrowth(3), { s: 0, next: 4 });
    assert.deepEqual(soakGrowth(20), { s: SOAK_MAX, next: null });
    assert.equal(soakOf(undefined), 0);
});

test('a hit lands only past 2 + S: exactly 2 + S ahead does no damage, one more lands; the cap holds; a decisive hit always lands, at its usual damage', () => {
    const seen = new Set();
    for (const vit of [1, 4, 8, 12, 16, 20, 28]) {
        const s = soakOf(vit);
        for (const level of [1, 10, 20, 40]) for (let pc = 1; pc <= 20; pc += 1) for (let foe = 1; foe <= 20; foe += 1) {
            const line = defend(stateOf({ vit }, NEW, level), pc, foe);
            const lead = margin(line), fails = line.outcome === 'fail', decisive = foe === 20 || pc === 1 || lead >= rules.decisiveMargin;
            if (fails) assert.equal(line.decisive, decisive, "the decisive call is unchanged");
            if (!fails) { assert.equal(line.damage, undefined); assert.equal(line.soaked, undefined); continue; }
            if (decisive) { assert.equal(line.damage.blocks, 2, `VIT ${vit} ${pc}/${foe}: a decisive hit lands for 2`); assert.equal(line.soaked, undefined); seen.add(`${s}:decisive`); continue; }
            if (lead <= 2 + s && s > 0) { assert.equal(line.damage, undefined, `VIT ${vit} ${pc}/${foe}: margin ${lead} is soaked`); assert.equal(line.soaked, s); seen.add(`${s}:soaked:${lead === 2 + s ? 'edge' : 'inside'}`); }
            else { assert.equal(line.damage.blocks, 1, `VIT ${vit} ${pc}/${foe}: margin ${lead} lands`); assert.equal(line.soaked, undefined); if (s > 0 && lead === 3 + s) seen.add(`${s}:lands-just-past`); }
        }
    }
    for (const s of [1, 2, 3, 4, 5]) assert.ok(seen.has(`${s}:soaked:edge`), `the edge 2 + ${s} was seen`);
    for (const s of [1, 2, 3, 4]) assert.ok(seen.has(`${s}:lands-just-past`), `one more than 2 + ${s} was seen landing`);
    assert.ok(seen.has('5:decisive'), 'at the cap, 8 ahead is decisive and lands');
});

test('a hit the mark does not cover is as before: no mark, no soak at any VIT', () => {
    for (let pc = 1; pc <= 20; pc += 1) for (let foe = 1; foe <= 20; foe += 1) {
        const line = defend(stateOf({ vit: 20 }), pc, foe, { soak: false });
        assert.equal(line.soaked, undefined);
        assert.equal(Boolean(line.damage), line.outcome === 'fail');
    }
});

test('zero extra soak still protects the fixed margin with custom cost rules; decisive and wider cost margins keep their priority', () => {
    for (const costMargin of [0, 1]) {
        const custom = { ...rules, costMargin, decisiveMargin: 15 }, seen = new Set();
        for (let pc = 2; pc < 20; pc += 1) for (let foe = 2; foe < 20; foe += 1) {
            const line = defend(stateOf({ vit: 1 }), pc, foe, { rollRules: custom });
            const lead = margin(line);
            if (line.outcome !== 'fail' || lead > 3) continue;
            if (lead <= 2) { assert.equal(line.soaked, 0); assert.equal(line.damage, undefined); seen.add(lead); }
            else { assert.equal(line.soaked, undefined); assert.equal(line.damage.blocks, 1); seen.add(3); }
        }
        assert.deepEqual([...seen].sort(), Array.from({ length: 3 - costMargin }, (_, n) => n + costMargin + 1));
    }
    const smallDecisive = { ...rules, costMargin: 0, decisiveMargin: 4 };
    const wideCost = { ...rules, costMargin: 5, decisiveMargin: 15 };
    const find = (custom, lead) => {
        for (let pc = 2; pc < 20; pc += 1) for (let foe = 2; foe < 20; foe += 1) {
            const line = defend(stateOf({ vit: 20 }), pc, foe, { rollRules: custom });
            if (margin(line) === lead) return line;
        }
        assert.fail(`no roll with margin ${lead}`);
    };
    assert.equal(find(smallDecisive, 4).damage.blocks, 2);
    const cost = find(wideCost, 5);
    assert.equal(cost.outcome, 'cost');
    assert.equal(cost.soaked, undefined);
    assert.equal(cost.damage, undefined);
});

test('a soaked failed defence cannot hurt, take a hero Down, or stop Auto as badly hurt', () => {
    const state = stateOf({ vit: 20, health: 1 });
    let found;
    for (let pc = 2; pc < 20 && !found; pc += 1) for (let foe = 2; foe < 20 && !found; foe += 1) {
        const rolled = defenceRoll(state, pc, foe);
        if (rolled.rounds[0].lines.some(line => Number.isInteger(line.soaked))) found = rolled;
    }
    assert.ok(found);
    assert.equal(found.rounds[0].lines.find(line => line.kind === 'foe').outcome, 'fail');
    assert.equal(found.hurts.some(hurt => hurt.id === 'c:astra'), false);
    assert.notEqual(found.stop, 'heavy');
    assert.notEqual(found.stop, 'lost');
    const boardResult = { ...found, bars: 2, stop: 'open' };
    assert.deepEqual(hurtHeroes(boardResult), []);
    assert.equal(autoStop(boardResult, { cap: 8, done: 1 }), null);
});

test('effective VIT counts worn gear, and a broken piece gives nothing', () => {
    // VIT 10 is S 2; a worn +2 makes 12, S 3: a hit 5 ahead is soaked with the piece, lands without it.
    const state = stateOf({ vit: 10 }), sheet = readSheet(state);
    const query = broken => (name, args) => { if (name === 'party.actors') return []; if (name === 'inventory.gear') return args.owner === 'party'
        ? { on: true, slots: { body: { name: 'Mail', stats: { VIT: 2 }, broken } }, statBonus: broken ? {} : { VIT: 2 }, carry: { encumbered: false, penalty: 0 } } : null; throw new Error('no'); };
    const worn = planGear(sheet, query(false)), cracked = planGear(sheet, query(true));
    assert.equal(worn.who.astra.add.vit, 2);

    const find = gear => { for (let foe = 2; foe <= 19; foe += 1) for (let pc = 2; pc <= 19; pc += 1) { const line = defend(state, pc, foe, { gear }); if (margin(line) === 5) return line; } return null; };
    const withMail = find(worn), without = find(cracked), bare = find(null);
    assert.equal(withMail.soaked, 3, 'S 3 from VIT 12');
    assert.equal(withMail.damage, undefined);
    assert.equal(without.soaked, undefined, 'the broken piece adds nothing: S 2, 5 ahead lands');
    assert.equal(without.damage.blocks, 1);
    assert.equal(bare.damage.blocks, 1);
});

test('lead and companion defences use their own effective VIT, including broken gear', () => {
    const state = { domains: { dataModules: sheetDomain({
        hero: { role: 'character', definition: NEW, fields: character('Astra', { vit: 10, health: 12 }) },
        companion: { role: 'character', definition: NEW, fields: character('Ren', { vit: 10, health: 12 }) },
        foes: { role: 'foes', fields: levelFoeBlock([['Rat', 2, 1, 4]]) },
    }) } };
    const query = broken => (name, args) => {
        if (name === 'party.actors') return [{ id: 'ren-owner', name: 'Ren' }];
        if (name !== 'inventory.gear') return null;
        if (args.owner === 'party') return { on: true, statBonus: { VIT: 2 }, slots: {}, carry: {} };
        if (args.owner === 'ren-owner') return { on: true, statBonus: broken ? {} : { VIT: 6 }, slots: { body: { name: 'Coat', stats: { VIT: 3 }, broken }, head: { name: 'Cap', stats: { VIT: 3 }, broken } }, carry: {} };
        return null;
    };
    for (const broken of [false, true]) {
        const gear = planGear(readSheet(state), query(broken), 'Astra');
        const sheet = applyGear(readSheet(state), gear);
        assert.deepEqual(Object.fromEntries(sheet.characters.map(actor => [actor.key, actor.stats.vit])), { ren: broken ? 10 : 16, astra: 12 });
        for (const [who, expected] of [['Astra', 3], ['Ren', broken ? 2 : 4]]) {
            let line;
            for (let pc = 2; pc < 20 && !line; pc += 1) for (let foe = 2; foe < 20 && !line; foe += 1) {
                const rolled = defenceRoll(state, pc, foe, { gear });
                line = rolled.rounds[0].lines.find(item => item.kind === 'foe' && item.pc.who === who && Number.isInteger(item.soaked));
            }
            assert.ok(line, `${who} has a soaked defence`);
            assert.equal(line.soaked, expected);
            assert.equal(line.damage, undefined);
        }
    }
});

test('a soaked defence with a skill still pays the skill\'s cost, as any defence does', () => {
    let found = null;
    for (let foe = 2; foe <= 19; foe += 1) for (let pc = 2; pc <= 19 && !found; pc += 1) { const line = defend(stateOf({ vit: 20 }, NEW, 1, SKILLS), pc, foe); if (line.soaked) found = line; }
    assert.ok(found, 'a soaked defence with the skill');
    assert.equal(found.damage, undefined);
    assert.equal(found.cost?.blocks, 1, 'one Stamina block');
    assert.equal(found.skill, 'Shadow Step');
});

test('soak covers ordinary and magic defences with or without a skill', () => {
    for (const againstMagic of [false, true]) for (const skills of [PLAIN, SKILLS]) {
        let found;
        for (let pc = 2; pc < 20 && !found; pc += 1) for (let foe = 2; foe < 20 && !found; foe += 1) {
            const line = defend(stateOf({ vit: 20 }, NEW, 1, skills), pc, foe, { againstMagic });
            if (Number.isInteger(line.soaked)) found = line;
        }
        assert.ok(found, `magic ${againstMagic}, skill ${skills === SKILLS}`);
        assert.equal(found.soaked, 5);
        assert.equal(found.damage, undefined);
        assert.equal(Boolean(found.skill), skills === SKILLS);
        if (skills === SKILLS) assert.equal(found.cost.blocks, 1);
    }
});

test('foes get no soak: the party\'s hits on a foe are unchanged by the mark', () => {
    const act = soak => {
        const base = readSheet(stateOf({ vit: 20 })), sheet = { ...base, foes: splitFoes(base.foes, {}) };
        const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'attack', target: 1 }], {}, 1, { members: true, aoe: true, bars: true });
        const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
        const out = [];
        for (let pc = 1; pc <= 20; pc += 1) for (let foe = 1; foe <= 20; foe += 1) {
            const source = kind => { const list = kind === 'act' ? [pc, foe] : []; return () => (list.length ? list.shift() : 10); };
            out.push(rollStandard(built.plan, prepared, source, rules, { flow: 2, fix: true, then: true, board: true, scaled: true, soak, memberRolls: hooks }).rounds[0].lines.find(line => line.kind === 'act'));
        }
        return out;
    };
    assert.deepEqual(act(true), act(false));
});

test('a new fight is marked `soak: 1` with `bars: 2` (setup, result, predicate); a mixed party and an old pin are not', () => {
    const state = stateOf(), opened = openBoard({}, state, { sid: 's1', rules });
    assert.deepEqual([opened.session.setup.bars, opened.session.setup.soak], [2, 1]);
    const played = playBoard(state, opened.session.setup, [{ actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }]);
    assert.deepEqual([played.result.bars, played.result.soak], [2, 1]);
    const mixed = { domains: { dataModules: sheetDomain({
        a: { role: 'character', definition: NEW, fields: character('Astra', { vit: 5, agi: 10, int: 5, health: 10, stamina: 12, mana: 10 }) },
        b: { role: 'character', definition: OLD, fields: character('Ren') }, foes: { role: 'foes', fields: levelFoeBlock([['Rat', 1, 1, 4]]) } }) } };
    const open = openBoard({}, mixed, { sid: 's1', rules }).session.setup;
    assert.deepEqual([Object.hasOwn(open, 'bars'), Object.hasOwn(open, 'soak')], [false, false]);
    const old = openBoard({}, stateOf({ health: 5, stamina: 5, mana: 4 }, OLD), { sid: 's1', rules });
    assert.equal(Object.hasOwn(old.session.setup, 'soak'), false);
    assert.equal(JSON.stringify(playBoard(stateOf({ health: 5, stamina: 5, mana: 4 }, OLD), old.session.setup, [{ actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }]).result).includes('soak'), false);
    // a soak mark without the bars mark, or any other value, is a damaged setup
    assert.match(playBoard(state, { ...opened.session.setup, soak: 2 }, []).error, /damaged/);
    const { bars: _b, ...noBars } = opened.session.setup;
    assert.match(playBoard(state, noBars, []).error, /damaged/);
});

test('the guard needs the predicate to carry the mark the record has, and the shape refuses a soak with no bars mark', () => {
    const state = stateOf(), opened = openBoard({}, state, { sid: 's1', rules });
    const hash = value => JSON.stringify(value);
    const board = { id: 'x', anchor: 'a', groups: [1], setup: { ...opened.session.setup }, exchanges: [] };
    const guard = (predicate, recorded) => boardGuard({ state, hash }, { guard: { version: 2, rulesHash: null, predicate, inputHash: '' }, source: '', recorded });
    const base = { kind: 'rpg.resolve', board: 1, key: 'b:x', setup: hash(board), rules: hash(rules), practice: 1, bars: 2 };
    assert.equal(guard(base, { key: 'b:x', board, practice: 1 }).reason, 'The saved fight is damaged.', 'a soak mark the predicate does not carry');
    assert.notEqual(guard({ ...base, soak: 1 }, { key: 'b:x', board, practice: 1 }).reason, 'The saved fight is damaged.');
    const bare = { ...board, setup: { ...board.setup } };
    delete bare.setup.soak;
    assert.equal(guard({ ...base, soak: 1, setup: hash(bare) }, { key: 'b:x', board: bare, practice: 1 }).reason, 'The saved fight is damaged.', 'a predicate mark the record does not have');
    const lone = { ...board, setup: { ...board.setup } };
    delete lone.setup.bars;
    assert.equal(guard({ ...base, bars: undefined, soak: 1, setup: hash(lone) }, { key: 'b:x', board: lone, practice: 1 }).reason, 'The saved fight is damaged.');
});

test('an old fight on a marked pin (bars: 2, no soak) replays with no soak: the very lines of a roll made with no soak', () => {
    const state = stateOf({ vit: 20 }), opened = openBoard({}, state, { sid: 's1', rules });
    const { soak: _s, ...old } = opened.session.setup;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const exchanges = [{ actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }, { actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }];
        const played = playBoard(state, { ...old, seed }, exchanges);
        assert.equal(played.error, undefined, played.error);
        assert.equal(JSON.stringify(played.result).includes('soak'), false, 'no soak anywhere in the record');
        for (const round of played.result.rounds) for (const line of round.lines) if (line.kind === 'foe') assert.equal(Boolean(line.damage), line.outcome === 'fail', 'every failed defence lands, as before');
    }
});

test('a fight staged before the update is sent and replayed without gaining soak', async () => {
    const restore = seedCrypto(519);
    const blocks = { hero: { role: 'character', definition: structuredClone(NEW), fields: markedCharacter('Astra', { vit: 20, health: 16, stamina: 12, mana: 10 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', SKILLS) }, foes: { role: 'foes', fields: levelFoeBlock([['Rat', 1, 40, 8]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        await host.send('Earlier.', 'The rat approaches.');
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        const opened = openBoard(meta, host.head(), { sid, rules });
        delete opened.session.setup.soak;
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
        assert.equal(staged.error, undefined, staged.error);
        const expected = structuredClone(staged.preview.result);
        await host.send('Strike.', 'The fight.');
        const at = host.ctx.chat.length - 1, receipt = rollReceipt(host, at);
        assert.equal(receipt.replan.payload.board.setup.bars, 2);
        assert.equal(Object.hasOwn(receipt.replan.payload.board.setup, 'soak'), false);
        assert.deepEqual(receipt.data.v2.result.rounds, expected.rounds);
        assert.deepEqual(receipt.data.v2.result.hurts, expected.hurts);
        assert.equal(Object.hasOwn(receipt.data.v2.result, 'soak'), false);
        const live = JSON.stringify(host.head()), bytes = JSON.stringify(receipt.data.v2.result);
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal((await host.sdk.reread(at)).ok, true);
        assert.equal(JSON.stringify(rollReceipt(host, at).data.v2.result), bytes);
        await host.store.flush();
        const saved = structuredClone(host.st.saves.at(-1)), savedMeta = structuredClone(meta);
        await host.st.loadChat(saved, 'old-staged-soak');
        host.ctx.chatMetadata = savedMeta;
        assert.equal(JSON.stringify(rollReceipt(host, at).data.v2.result), bytes);
    } finally { host.close(); restore(); }
});

const sheetOf = host => JSON.stringify(host.head().domains.dataModules.instances);

async function play(seed) {
    const restore = seedCrypto(seed), random = prng(seed);
    const blocks = { hero: { role: 'character', definition: structuredClone(NEW), fields: markedCharacter('Astra', { str: 10, dex: 10, vit: 20, agi: 10, int: 5, health: 16, stamina: 12, mana: 10 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', SKILLS) }, foes: { role: 'foes', fields: levelFoeBlock([['Cellar Rat', 1, 40, 8]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        await host.send('Older.', 'An older reply.');
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        const opened = openBoard(meta, host.head(), { sid, rules });
        assert.equal(opened.error, undefined, opened.error);
        for (let n = random.int(2, 4); n > 0; n -= 1) {
            const staged = stageExchange(meta, host.head(), [{ who: 'Astra', ...random.pick([{ kind: 'attack', target: 1 }, { kind: 'skill', skill: 'Cut', target: 1 }]) }]);
            if (staged.error || staged.preview.result.stop !== 'open') break;
        }
        await host.send('Strike.', 'The fight.');
        const at = host.ctx.chat.length - 1, record = rollReceipt(host, at).data.v2.result;
        const live = JSON.stringify(host.head()), sheet = sheetOf(host);
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, `seed ${seed}: rebuild`);
        assert.equal((await host.sdk.reread(at)).ok, true);
        assert.equal(sheetOf(host), sheet, `seed ${seed}: Re-read`);
        await host.store.flush();
        const saved = structuredClone(host.st.saves.at(-1)), savedMeta = structuredClone(meta);
        await host.st.loadChat(saved, `soak-${seed}`);
        host.ctx.chatMetadata = savedMeta;
        assert.equal(sheetOf(host), sheet, `seed ${seed}: reload`);
        assert.deepEqual(rollReceipt(host, at).data.v2.result.rounds, record.rounds, `seed ${seed}: the rounds are the ones played`);
        return record;
    } finally { host.close(); restore(); }
}

test('a soak fight replays: rebuild == live == Re-read == reload, and the record carries the mark and a soaked line', async () => {
    let soaked = 0;
    for (const seed of [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412]) {
        const record = await play(seed);
        assert.equal(record.soak, 1);
        for (const round of record.rounds) for (const line of round.lines) if (line.soaked) { soaked += 1; assert.equal(line.damage, undefined); }
    }
    assert.ok(soaked > 0, 'the seeds soaked at least one hit');
});

const soakedLine = { kind: 'foe', type: 'defence', skill: 'Shadow Step', outcome: 'fail', decisive: false, soaked: 3,
    pc: { who: 'Astra', stat: 'agi', die: 10, total: 14, mainValue: 10, secondValue: 12, statBonus: 11, classBonus: 0, rank: 3, edge: 0 }, foe: { name: 'Rat', slot: 1, die: 14, total: 18, base: 5, classBonus: 0 }, cost: { id: 'c:astra:stamina', kind: 'char', name: 'Astra', blocks: 1, from: 12, to: 11, size: 12 } };

test('the narrator\'s note says the blow glances off, with no number, and the log draws "Glanced off"', () => {
    const result = { bars: 2, soak: 1, rounds: [{ n: 1, decisive: false, lines: [soakedLine] }], opening: [], stop: 'open', hurts: [] };
    const note = settledNote(result);
    assert.match(note, /Rat attacks Astra: blow glances off \(Shadow Step\)/);
    assert.doesNotMatch(note.split('Exchange 1:')[1].split('|')[0], /soak|\b3\b/u, 'no soak number in the line told');
    assert.doesNotMatch(note, /Astra's defence \(Shadow Step\): fail/);
    const plain = settledNote({ ...result, rounds: [{ n: 1, decisive: false, lines: [{ ...soakedLine, soaked: undefined }] }] }, null);
    assert.match(plain, /defence \(Shadow Step\): fail/);
    const model = readResolve({ v: 1, key: 'k', rules, flow: 2, rounds: result.rounds, stop: 'open', hurts: [], bars: 2, soak: 1 });
    const line = model.rounds[0].lines[0];
    assert.equal(line.soaked, true);
    assert.equal(line.outcome, 'fail', 'the recorded outcome stays');
    for (const s of [0, 3]) {
        const zeroOrMore = { ...result, rounds: [{ n: 1, lines: [{ ...soakedLine, soaked: s }] }] };
        assert.match(settledNote(zeroOrMore), /blow glances off/);
        const resolved = readResolve({ v: 1, key: 'k', rules, flow: 2, ...zeroOrMore });
        const panel = buildPanel(setupDom(), panelModel({ resolve: resolved, state: { domains: {} }, roleOf: () => null }));
        assert.match(panel.querySelector('.rpg-act-text').textContent, /Glanced off/);
        assert.ok(panel.querySelector('.rpg-out').classList.contains('rpg-out-cost'));
    }
});

test('a normal eight-exchange board note with soaked defences stays within the roll cue budget', () => {
    const rounds = Array.from({ length: 8 }, (_, at) => ({ n: at + 1, lines: [soakedLine] }));
    const note = settledNote({ rounds, opening: [], stop: 'open' });
    assert.equal((note.match(/blow glances off/gu) ?? []).length, 8);
    assert.ok(cueTokens(note) <= LIMITS.cueTokens);
});

test('even a long board note spends no more space on soaked lines than on failed defences', () => {
    for (const who of ['A', 'Astra']) for (const skill of [null, 'Shadow Step']) {
        const line = { ...soakedLine, skill, pc: { ...soakedLine.pc, who } };
        const rounds = Array.from({ length: 99 }, (_, at) => ({ n: at + 1, lines: [line] }));
        const glance = settledNote({ rounds, stop: 'open' });
        const fails = settledNote({ rounds: rounds.map(round => ({ ...round, lines: [{ ...line, soaked: undefined }] })), stop: 'open' });
        assert.ok(glance.length <= fails.length);
        assert.equal((glance.match(/blow glances off/gu) ?? []).length, 99);
    }
});

test('the Party card\'s growth line gains "Soak +3 (next at VIT 16)" from the effective VIT, and only for the doubled bars', () => {
    const stats = { str: 5, vit: 12, agi: 10, dex: 5, int: 5, luk: 5, cha: 5 };
    const growth = growthOf(stats, { scale: 2 });
    assert.match(growthText(growth, 12), /Edge −2\.\.\+3 \(next at LUK 7\) · Soak \+3 \(next at VIT 16\)$/);
    assert.equal(growthText(growth, 12).replace(/ · Soak.*$/u, ''), growthText(growth), 'nothing else on the line moves');
    assert.match(growthText(growth, 14), /Soak \+3 \(next at VIT 16\)$/, 'with gear: VIT 12 and +2');
    assert.match(growthText(growth, 16), /Soak \+4 \(next at VIT 20\)$/);
    assert.match(growthText(growth, 20), /Soak \+5$/);
    assert.match(growthText(growth, 3), /Soak \+0 \(next at VIT 4\)$/);
    assert.doesNotMatch(growthText(growth), /Soak/, 'an old pin has none');
});
