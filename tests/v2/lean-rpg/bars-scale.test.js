// The doubled bars ("scale 2"): the size formula, the pinned template, the two skill rules of a marked fight (a single-target skill hits for 2 and 3, an area skill
// costs 2), Auto and the board's refusal at 1 left, the badly-hurt stop as a share of the bar, and the old pin: a character with no mark keeps today's sizes, damage
// and costs, and nothing in its fight carries the mark.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_TEMPLATES, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { BAR_MAX, BAR_START, scaledCharacter } from '../../../src/v2/lean-rpg/templates-bars.js';
import { STANDARD_NUMBERS, STAT_KEYS, blocksFor } from '../../../src/v2/lean-rpg/formula.js';
import { STAGES } from '../../../src/v2/lean-rpg/names.js';
import { growthOf, spreadWord, wordToBlocks } from '../../../src/v2/lean-rpg/blocks.js';
import { readSheet } from '../../../src/v2/lean-rpg/read.js';
import { applyGear } from '../../../src/v2/lean-rpg/gear.js';
import { rosterOf } from '../../../src/v2/lean-rpg/standard/roster.js';
import { STANDARD_FORMULA } from '../../../src/v2/lean-rpg/rules.js';
import { prepareStandard, rollStandard } from '../../../src/v2/lean-rpg/standard.js';
import { memberRolls } from '../../../src/v2/lean-rpg/board/member-rolls.js';
import { splitFoes } from '../../../src/v2/lean-rpg/board/members.js';
import { actionSkills, exchangePlan } from '../../../src/v2/lean-rpg/board/plan.js';
import { autoPicks, autoStop, hurtHeroes } from '../../../src/v2/lean-rpg/board/auto.js';
import { playBoard } from '../../../src/v2/lean-rpg/board/engine.js';
import { boardGuard } from '../../../src/v2/lean-rpg/board/commit.js';
import { openBoard } from '../../../src/v2/lean-rpg/board/session.js';
import { boardChoices } from '../../../src/v2/lean-rpg/board/view-data.js';
import { settledNote } from '../../../src/v2/lean-rpg/board/note.js';
import { barText } from '../../../src/v2/lean-rpg/board/view-bars.js';
import { growthText } from '../../../src/v2/lean-rpg/view/party-data.js';
import { buildDefinitions, newDraft } from '../../../src/v2/lean-rpg/view/wizard-data.js';
import { joinScale } from '../../../src/v2/lean-rpg/join.js';
import { validateDataModules, DM_LIMITS as L } from '../../../src/v2/data-modules/check.js';
import { character, levelFoeBlock, sheetDomain, skillBlock } from './helpers.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const NEW = STANDARD_TEMPLATES[0].definition, OLD = characterV1For();
const CHECK = { packId: 'chat', capabilities: ['data-modules-v1', 'story-director'] };
const dice = (table = {}, fallback = 10) => (kind, at) => { const list = [...(table[`${kind}${at}`] ?? [])]; return () => (list.length ? list.shift() : fallback); };
const SKILLS = [['Cut', 3, 'str', 'stamina', 'cut one foe'], ['Sweep', 3, 'str', 'stamina', 'sweep every foe']];
// One Astra with `definition` (the new template or the old one), her stats 5 / 10 / 5 unless given, a level-1 rat the size of 4 blocks.
const stateOf = (definition, over = {}, foes = [['Rat', 1, 1, 4]], skills = SKILLS) => ({ domains: { dataModules: sheetDomain({
    hero: { role: 'character', definition, fields: character('Astra', { str: 20, dex: 20, vit: 5, agi: 10, int: 5, health: 10, stamina: 12, mana: 10, ...over }) },
    skills: { role: 'skills', fields: skillBlock('Astra', skills) },
    foes: { role: 'foes', fields: levelFoeBlock(foes) },
}) } });

test('the size formula table: scale 2 is 2 x (4 + stat/5) for all three bars, scale 1 is what it always was', () => {
    for (const stat of [1, 4, 5, 9, 10, 14, 15, 19, 20]) {
        const stats = { vit: stat, agi: stat, int: stat }, k = Math.floor(stat / 5);
        assert.deepEqual(blocksFor(stats, 2), { health: 2 * (4 + k), stamina: 2 * (4 + k), mana: 2 * (4 + k) }, `scale 2, stat ${stat}`);
        assert.deepEqual(blocksFor(stats), { health: 4 + k, stamina: 3 + k, mana: 3 + k }, `scale 1, stat ${stat}`);
        assert.deepEqual(blocksFor(stats, 1), blocksFor(stats), 'scale 1 is the default');
    }
});

test('Astra (VIT 5, AGI 10, INT 5) has 10 / 12 / 10 on the new template and 5 / 5 / 4 on the old pin, which carries no mark', () => {
    const fresh = readSheet(stateOf(NEW)).characters[0], old = readSheet(stateOf(OLD, { health: 5, stamina: 5, mana: 4 })).characters[0];
    assert.deepEqual([fresh.size, fresh.scale], [{ health: 10, stamina: 12, mana: 10 }, 2]);
    assert.deepEqual(old.size, { health: 5, stamina: 5, mana: 4 });
    assert.equal(Object.hasOwn(old, 'scale'), false, 'no key at all on an old pin (the sheet is hashed by the witness)');
});

test('the pin\'s maximum is the largest new size, worked out from the formula, and fits the checker\'s stage limit', () => {
    const top = blocksFor(Object.fromEntries(STAT_KEYS.map(key => [key, STANDARD_NUMBERS.statMax])), 2);
    assert.deepEqual({ ...BAR_MAX }, top);
    for (const bar of ['health', 'stamina', 'mana']) {
        assert.equal(NEW.state[bar].max, top[bar]);
        assert.equal(NEW.state[`${bar}-blocks`].max, top[bar]);
        assert.equal(NEW.state[bar].default, BAR_START[bar]);
        assert.ok(top[bar] < L.scaledStages, `${bar}: ${top[bar]} fits ${L.scaledStages} stages`);
    }
    assert.equal(L.scaledStages, Math.max(...Object.values(top)) + 1, 'the limit is exactly the largest size and empty');
    assert.equal(validateDataModules([structuredClone(NEW)], CHECK).ok, true);
    for (const bar of ['health', 'stamina', 'mana']) assert.equal(OLD.state[bar].scale, undefined, 'the frozen old definition has no mark');
});

test('the checker takes the scale mark only as 2 on a health, stamina or mana bar, and holds an unmarked bar to 10 stages', () => {
    const bad = change => { const definition = structuredClone(NEW); change(definition); return validateDataModules([definition], CHECK).ok; };
    assert.equal(bad(definition => { definition.state.health.scale = 3; }), false);
    assert.equal(bad(definition => { definition.state.str.scale = 2; }), false);
    assert.equal(bad(definition => { delete definition.state.health.scale; }), false, 'a max of 16 without the mark is over the 10-stage limit');
    assert.equal(bad(definition => { definition.state.stamina.max = 8; delete definition.state.stamina.scale; }), false, 'a partly marked character cannot mark a fight');
    assert.equal(bad(definition => { definition.state.hurt1 = { type: 'int', min: 0, max: 16, default: 10, blocks: 'health', scale: 2 }; }), false, 'foe-style fields cannot use the larger allowance');
    assert.equal(bad(definition => { definition.role = 'foes'; }), false, 'other roles cannot claim character scales');
    assert.equal(bad(definition => { delete definition.role; }), false, 'blocks without a role cannot claim character scales');
    assert.equal(bad(definition => { definition.state.health.blocks = 'mana'; }), false, 'the field and bar must agree');
});

test('gear cannot increase a scaled bar beyond its pinned maximum', () => {
    const sheet = readSheet(stateOf(NEW, { vit: 20, agi: 20, int: 20, health: 16, stamina: 16, mana: 16 }));
    const dressed = applyGear(sheet, { who: { astra: { add: { vit: 10, agi: 10, int: 10 } } } });
    assert.equal(dressed.characters[0].stats.vit, 30);
    const roster = rosterOf(dressed, () => 16);
    assert.deepEqual([roster.characters[0].size, ...roster.resources.map(bar => bar.size)], [16, 16, 16]);
});

test('the story\'s stage words keep their share of the bar at the new sizes (words only, never numbers)', () => {
    assert.deepEqual([0, 2, 5, 9, 10].map(value => spreadWord(STAGES.health, value, 10)), ['Down', 'Badly wounded', 'Hurt', 'Scratched', 'Unhurt']);
    assert.deepEqual([0, 6, 12].map(value => spreadWord(STAGES.stamina, value, 12)).length, 3);
    // "Hurt" is the 3rd of 5 steps: 3/5 of the bar either way
    assert.deepEqual([wordToBlocks(3, 5, 6), wordToBlocks(3, 10, 6), wordToBlocks(5, 10, 6), wordToBlocks(0, 10, 6)], [3, 6, 10, 0]);
});

test('the template\'s set-health line turns a word into the same share of the bigger bar, and Rest fills to the new size', () => {
    const effect = NEW.kinds['set-health'].effects[0].value, size = vit => 2 * (4 + Math.floor(vit / 5));
    const run = (word, vit) => Math.floor((Math.floor(word * 2 * (4 + Math.floor(vit / 5)) * 1) + 2) / 5);
    assert.equal(JSON.stringify(effect).includes('"mul",["arg","to"],2'), true, 'the 2 is on the word, one level shallower');
    assert.deepEqual([3, 5].map(word => run(word, 5)), [6, 10]);
    assert.deepEqual(NEW.kinds['button-rest'].effects.map(step => JSON.stringify(step.value)), [JSON.stringify(['mul', 2, ['floorDiv', ['add', ['get', ['agi']], 20], 5]]), JSON.stringify(['mul', 2, ['floorDiv', ['add', ['get', ['int']], 20], 5]])]);
    assert.equal(size(5), 10);
    assert.deepEqual(NEW.rules.map(rule => rule.id), ['health-grow', 'health-bar', 'stamina-grow', 'stamina-bar', 'mana-grow', 'mana-bar', 'level-up', 'xp-cap']);
});

// ---- a marked fight: the skills ---------------------------------------------------------------------------------------------------

function roll(state, actions, table, { bars = true } = {}) {
    const base = readSheet(state), sheet = { ...base, foes: splitFoes(base.foes, {}) };
    const built = exchangePlan(sheet, actions, {}, 1, { members: true, aoe: true, bars });
    assert.equal(built.error, undefined, built.error);
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const rolled = rollStandard(built.plan, prepared, dice(table), rules, { flow: 2, fix: true, then: true, board: true, scaled: bars, memberRolls: hooks });
    return rolled.rounds[0].lines.filter(line => line.kind === 'act');
}

test('a single-target skill hits for 2 (3 when decisive), a plain attack for 1 (2), an area skill as before; an old fight is 1 and 2 for all', () => {
    const seen = { skill: new Set(), plain: new Set(), area: new Set(), old: new Set() };
    for (const pc of [3, 9, 14, 19, 20]) for (const foe of [1, 6, 10, 20]) {
        const table = { init0: [20], act0: [pc, foe] };
        const one = roll(stateOf(NEW), [{ who: 'Astra', kind: 'skill', skill: 'Cut', target: 1 }], table)[0];
        const plain = roll(stateOf(NEW), [{ who: 'Astra', kind: 'attack', target: 1 }], table)[0];
        const area = roll(stateOf(NEW), [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 }], table)[0];
        const old = roll(stateOf(OLD, { health: 5, stamina: 5, mana: 4 }), [{ who: 'Astra', kind: 'skill', skill: 'Cut', target: 1 }], table, { bars: false })[0];
        for (const [name, line, plus] of [['skill', one, 1], ['plain', plain, 0], ['area', area, 0], ['old', old, 0]]) {
            if (!line.damage) continue;
            assert.equal(line.damage.blocks, (line.decisive ? 2 : 1) + plus, `${name}: pc ${pc} foe ${foe}`);
            seen[name].add(line.decisive);
        }
    }
    for (const name of Object.keys(seen)) assert.deepEqual([...seen[name]].sort(), [false, true], `${name}: both a plain and a decisive hit were seen`);
    const pack = roll(stateOf(NEW, {}, [['Rats', 6, 1, 4]]), [{ who: 'Astra', kind: 'skill', skill: 'Cut', target: 11 }], { init0: [20], act0: [20, 1] })[0];
    assert.equal(pack.damage.blocks, 3, 'the single-target skill also deals 3 to a pack on a decisive hit');
});

test('a skill costs 1, an area skill costs 2, a plain attack nothing; an old fight\'s area skill costs 1', () => {
    const table = { init0: [20], act0: [20, 1] };
    const cost = (state, action, bars = true) => roll(state, [action], table, { bars })[0].cost;
    assert.deepEqual([cost(stateOf(NEW), { who: 'Astra', kind: 'skill', skill: 'Cut', target: 1 })].map(c => [c.blocks, c.from, c.to]), [[1, 12, 11]]);
    assert.deepEqual([cost(stateOf(NEW), { who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 })].map(c => [c.blocks, c.from, c.to]), [[2, 12, 10]]);
    assert.equal(cost(stateOf(NEW), { who: 'Astra', kind: 'attack', target: 1 }), undefined);
    assert.equal(cost(stateOf(OLD, { stamina: 5 }), { who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 }, false).blocks, 1);
});

test('an area skill with 1 left cannot be chosen: the plan refuses it, the board lists it with a reason, a single-target use is still open', () => {
    const sheet = readSheet(stateOf(NEW, { stamina: 1 }));
    const area = [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 }];
    assert.match(exchangePlan({ ...sheet, foes: splitFoes(sheet.foes, {}) }, area, {}, 1, { members: true, aoe: true, bars: true }).error, /^Not enough Stamina for an area skill \(it costs 2\)\.$/);
    assert.equal(exchangePlan({ ...sheet, foes: splitFoes(sheet.foes, {}) }, area, {}, 1, { members: true, aoe: true, bars: false }).error, undefined, 'an old fight takes it with 1 left');
    const [cut, sweep] = actionSkills(sheet.characters[0], {}, { bars: true });
    assert.deepEqual([cut.reason, cut.areaReason, sweep.areaReason], ['', '', 'Not enough Stamina (an area skill costs 2)']);
    const empty = actionSkills(readSheet(stateOf(NEW, { stamina: 0 })).characters[0], {}, { bars: true });
    assert.deepEqual(empty.map(item => [item.reason, item.areaReason]), [['Stamina is Empty', 'Stamina is Empty'], ['Stamina is Empty', 'Stamina is Empty']]);
    const choices = boardChoices(stateOf(NEW, { stamina: 1 }), { bars: 2, flags: {} }).choices.filter(choice => choice.action.skill === 'Sweep');
    assert.deepEqual(choices.map(choice => choice.reason), ['Not enough Stamina (an area skill costs 2)']);
    assert.equal(boardChoices(stateOf(NEW, { stamina: 2 }), { bars: 2, flags: {} }).choices.find(choice => choice.action.skill === 'Sweep').reason, '');
});

test('an area skill whose pool a defence drained to 1 in the same exchange is rolled without the skill, never paid with 1', () => {
    const state = stateOf(NEW, { stamina: 2 }, [['Rat', 1, 1, 4]], [...SKILLS, ['Dodge', 3, 'agi', 'stamina', 'dodge attacks']]);
    const base = readSheet(state), sheet = { ...base, foes: splitFoes(base.foes, {}) };
    const built = exchangePlan(sheet, [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 }], {}, 1, { members: true, aoe: true, bars: true });
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const lines = rollStandard(built.plan, prepared, dice({ init0: [1], init16: [20], foe0: [5, 15], act0: [20, 1] }), rules, { flow: 2, fix: true, then: true, board: true, scaled: true, memberRolls: hooks }).rounds[0].lines;
    assert.deepEqual([lines[0].kind, lines[0].skill, lines[0].cost.blocks, lines[0].cost.to], ['foe', 'Dodge', 1, 1]);
    const line = lines.find(item => item.kind === 'act');
    assert.equal(line.skill, null);
    assert.equal(line.cost, undefined);
    assert.equal(line.without, 'Sweep');
});

test('Auto never picks an area skill it cannot pay (1 left in a marked fight), and does when it can', () => {
    const pick = (state, setup) => autoPicks({ state, setup: { seed: 1, offset: 0, rules, members: 1, aoe: 1, ...setup } }, rules)[0];
    const strong = over => stateOf(NEW, over, [['Rats', 6, 1, 4]], [SKILLS[1]]);
    assert.equal(pick(strong({ stamina: 2 }), { bars: 2 }).area, true, 'with 2 it sweeps a pack');
    const one = pick(strong({ stamina: 1 }), { bars: 2 });
    assert.notEqual(one.area, true, 'with 1 it does not');
    const old = pick(stateOf(OLD, { stamina: 1, health: 5 }, [['Rats', 6, 1, 4]], [SKILLS[1]]), {});
    assert.equal(old.area, true, 'an old fight pays an area skill with 1');
});

test('marked board heals keep their one- and two-block values, cost one and are available to Auto', () => {
    const state = stateOf(NEW, { health: 4, mana: 1 }, [['Rat', 1, 1, 4]], [['Mend', 3, 'int', 'mana', 'heal an ally']]);
    const base = readSheet(state), sheet = { ...base, foes: splitFoes(base.foes, {}) };
    const picks = autoPicks({ state, setup: { seed: 1, offset: 0, rules, members: 1, aoe: 1, bars: 2 } }, rules);
    assert.deepEqual(picks[0], { who: 'Astra', kind: 'skill', skill: 'Mend', target: 'Astra', support: true, difficulty: 'normal' });
    assert.ok(boardChoices(state, { bars: 2, flags: {} }).choices.some(choice => choice.action.support && choice.action.target === 'Astra'));
    const built = exchangePlan(sheet, picks, {}, 1, { members: true, aoe: true, bars: true });
    assert.equal(built.error, undefined, built.error);
    for (const [die, amount] of [[6, 1], [20, 2]]) {
        const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
        const result = rollStandard(built.plan, prepared, dice({ init0: [20], act0: [die, 10] }), rules, { flow: 2, fix: true, then: true, board: true, scaled: true, memberRolls: hooks });
        const line = result.rounds[0].lines.find(item => item.support);
        assert.equal(line.damage.blocks, -amount);
        assert.equal(line.cost.blocks, 1);
        assert.match(settledNote(result), /Astra heals Astra \(Mend\)/);
    }
    const hooks = memberRolls(built.plan), prepared = prepareStandard(built.plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    prepared.roster.resources.find(bar => bar.id === 'c:astra:mana').value = 0;
    const drained = rollStandard(built.plan, prepared, dice({ init0: [20], act0: [20, 10] }), rules, { flow: 2, fix: true, then: true, board: true, scaled: true, memberRolls: hooks });
    assert.equal(drained.rounds[0].lines.some(line => line.support), false, 'a defence cannot leave a free heal');
    assert.ok(drained.rounds[0].idle.some(line => line.why === 'no-resource'));
    const areaHeal = stateOf(NEW, { health: 4, mana: 1 }, [['Rat', 1, 1, 4]], [['Heal all foes', 3, 'int', 'mana', 'heal every foe']]);
    assert.notEqual(autoPicks({ state: areaHeal, setup: { seed: 1, offset: 0, rules, members: 1, bars: 2 } }, rules)[0].support, true);
});

// ---- the old pin, byte for byte -----------------------------------------------------------------------------------------------------

test('an old pin: the fight opens with no mark, plays with 1 / 2 hits and 1-cost area skills, and equals a sheet with no Standard definition at all', () => {
    const meta = {}, state = stateOf(OLD, { health: 5, stamina: 5, mana: 4 });
    const opened = openBoard(meta, state, { sid: 's1', rules });
    assert.equal(Object.hasOwn(opened.session.setup, 'bars'), false);
    const actions = [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 }];
    const played = playBoard(state, { ...opened.session.setup, seed: 9 }, [{ actions }, { actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }]);
    assert.equal(played.error, undefined, played.error);
    assert.equal(Object.hasOwn(played.result, 'bars'), false);
    assert.equal(JSON.stringify(played.result).includes('"bars"'), false, 'no bars key anywhere in the result');
    const bare = { domains: { dataModules: sheetDomain({
        hero: { role: 'character', fields: character('Astra', { str: 20, dex: 20, vit: 5, agi: 10, int: 5, health: 5, stamina: 5, mana: 4 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', SKILLS) }, foes: { role: 'foes', fields: levelFoeBlock([['Rat', 1, 1, 4]]) } }) } };
    assert.deepEqual(playBoard(bare, { ...opened.session.setup, seed: 9 }, [{ actions }, { actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }]).result, played.result, 'the same record as before the scale existed');
});

test('a new pin marks the fight (setup, result), a mixed party does not, and the guard needs the mark to agree', () => {
    const meta = {}, state = stateOf(NEW), opened = openBoard(meta, state, { sid: 's1', rules });
    assert.equal(opened.session.setup.bars, 2);
    const played = playBoard(state, opened.session.setup, [{ actions: [{ who: 'Astra', kind: 'skill', skill: 'Cut', target: 1 }] }]);
    assert.equal(played.result.bars, 2);
    const mixed = { domains: { dataModules: sheetDomain({
        a: { role: 'character', definition: NEW, fields: character('Astra', { vit: 5, agi: 10, int: 5, health: 10, stamina: 12, mana: 10 }) },
        b: { role: 'character', definition: OLD, fields: character('Ren') }, foes: { role: 'foes', fields: levelFoeBlock([['Rat', 1, 1, 4]]) } }) } };
    assert.equal(Object.hasOwn(openBoard({}, mixed, { sid: 's1', rules }).session.setup, 'bars'), false);
    assert.match(playBoard(mixed, { ...opened.session.setup }, []).error, /The sheet changed after the fight was rolled/);
    const hash = value => JSON.stringify(value);
    const board = { id: 'x', anchor: 'a', groups: [1], setup: { ...opened.session.setup }, exchanges: [] };
    const guard = (predicate, recorded) => boardGuard({ state, hash }, { guard: { version: 2, rulesHash: null, predicate, inputHash: '' }, source: '', recorded });
    const predicate = { kind: 'rpg.resolve', board: 1, key: 'b:x', setup: hash(board), rules: hash(rules), practice: 1 };
    assert.equal(guard(predicate, { key: 'b:x', board, practice: 1 }).reason, 'The saved fight is damaged.', 'a mark in the record the predicate does not carry is refused');
});

// ---- Auto's badly-hurt stop ----------------------------------------------------------------------------------------------------------

test('Auto stops on a hero losing a fifth of the bar in a marked fight (2 of 10, 3 of 12), and as before on 2 blocks in an old one', () => {
    const lost = (blocks, size) => ({ rounds: [{ lines: [{ pc: { who: 'Astra' }, damage: { id: 'c:astra', kind: 'char', blocks, from: size, to: size - blocks, size } }] }] });
    const marked = result => ({ ...result, bars: 2 });
    assert.deepEqual([hurtHeroes(marked(lost(1, 10))), hurtHeroes(marked(lost(2, 10)))], [[], ['Astra']]);
    assert.deepEqual([hurtHeroes(marked(lost(2, 12))), hurtHeroes(marked(lost(3, 12)))], [[], ['Astra']]);
    assert.deepEqual([hurtHeroes(lost(1, 5)), hurtHeroes(lost(2, 5)), hurtHeroes(lost(2, 8))], [[], ['Astra'], ['Astra']], 'unmarked: 2 or more');
    assert.equal(autoStop(marked(lost(2, 10))), 'hurt');
});

// ---- the sheet's text ---------------------------------------------------------------------------------------------------------------------

test('the Party card\'s growth line and the wizard follow the new numbers, and a new character is built with the mark', () => {
    const stats = { str: 5, vit: 5, agi: 10, dex: 5, int: 5, luk: 5, cha: 5 };
    assert.match(growthText(growthOf(stats, { scale: 2 })), /^Health 10 blocks \(VIT 5, next at 10\) · Stamina 12 \(AGI 10, next at 15\) · Mana 10 \(INT 5, next at 10\)/);
    assert.match(growthText(growthOf(stats)), /^Health 5 blocks \(VIT 5, next at 10\) · Stamina 5 \(AGI 10/);
    const draft = newDraft({ persona: 'Astra' });
    assert.equal(buildDefinitions(draft, { used: [] }).character.state.health.scale, 2);
    assert.equal(buildDefinitions(draft, { used: [], scale: 1 }).character.state.health.scale, undefined, 'a companion of an old chat is made on the old definition');
    assert.deepEqual(buildDefinitions(draft, { used: [], scale: 1 }).character, { ...buildDefinitions(draft, { used: [], scale: 1 }).character, state: buildDefinitions(draft, { used: [], scale: 1 }).character.state });
    assert.equal(barText('Hurt', 5, 10), 'Hurt · 5/10');
});

test('a joining companion takes the scale of the chat: an old party stays old, an empty or new one is new', () => {
    const only = definition => ({ domains: { dataModules: sheetDomain({ a: { role: 'character', definition, fields: character('Astra') } }) } });
    assert.equal(joinScale(only(OLD)), 1);
    assert.equal(joinScale(only(NEW)), 2);
    assert.equal(joinScale({ domains: { dataModules: sheetDomain({}) } }), 2);
    assert.equal(joinScale(stateOf(undefined)), 1, 'a stage-field party is old');
    const empty = { domains: { dataModules: sheetDomain({}) } };
    assert.equal(joinScale(empty, only(OLD), 'pack.chat/a'), 1, 'a Re-read keeps the first old pin');
    assert.equal(joinScale(empty, only(NEW), 'pack.chat/a'), 2, 'a Re-read keeps the first new pin');
    assert.equal(joinScale(empty, only(OLD), 'pack.chat/missing'), 2, 'a newly added line uses the prefix');
    const left = { domains: { dataModules: sheetDomain({ a: { role: 'character', definition: OLD, fields: character('Astra', { left: true }) } }) } };
    assert.equal(joinScale(left), 1, 'a departed old character still fixes the companion scale');
    assert.equal(joinScale(empty, left, 'pack.chat/a'), 1, 'a Re-read still finds a joined character who left');
});

test('scaledCharacter turns only the size expressions: the same kinds, the same level rules', () => {
    const again = scaledCharacter(OLD, { health: ['add', 4, ['floorDiv', ['get', ['vit']], 5]], stamina: ['add', 3, ['floorDiv', ['get', ['agi']], 5]], mana: ['add', 3, ['floorDiv', ['get', ['int']], 5]] });
    assert.deepEqual(again, NEW);
    assert.deepEqual(NEW.kinds['add-xp'], OLD.kinds['add-xp']);
    assert.deepEqual(NEW.rules.filter(rule => ['level-up', 'xp-cap'].includes(rule.id)), OLD.rules.filter(rule => ['level-up', 'xp-cap'].includes(rule.id)));
});
