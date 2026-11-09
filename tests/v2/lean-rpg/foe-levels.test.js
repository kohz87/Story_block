// Foes by level (Levels release): a foe group has a level 1..99 instead of a Soul Class. Where a level comes from (the line, a rank's band, the party's
// average), that it is drawn from the reply's seed (a swipe draws anew, a Re-read keeps it), the roll term floor(level / divisor), a Standard group's
// Health 4 + floor(level / 30), the clamps, and that a roll made before the Levels rules replays as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_FEATURE, readSheet, validatePlan } from '../../../src/v2/lean-rpg/index.js';
import { openFoes, openErrors, vetOpen } from '../../../src/v2/lean-rpg/open.js';
import { divisorOf } from '../../../src/v2/lean-rpg/rules.js';
import { FOE_LEVEL, LV_VERSION, averageLevel, bandOfRank, classOfLevel, foeBlocksByLevel, foeLabel, foeRandom, levelBonus, foeLevelCap, levelOf, levelOfClass, partyLevels, pickLevel, settleOpen } from '../../../src/v2/lean-rpg/foes.js';
import { sizeOf } from '../../../src/v2/lean-rpg/blocks.js';
import { STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { success, reply } from '../data-modules/helpers.js';
import { PARTY, foeBlock, levelFoeBlock, rollReceipt, setup } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MESSAGE = 'Mud-scale crawlers boil out of the silt. I strike at them.';
const ATTACK = ['act Wessel | skill: Iron Breath | target: Mud-Scale Crawlers', 'foe Mud-Scale Crawlers | target: Wessel | defend: AGI'];
const opens = (...extra) => ['pace: normal', `foe Mud-Scale Crawlers | new | count: 3${extra.length ? ` | ${extra.join(' | ')}` : ''}`, ...ATTACK].join('\n');
// A Foes block of the Levels rules with every slot empty.
const empty = () => {
    const blocks = PARTY();
    const fields = { ...foeBlock([]) };
    for (const n of [1, 2, 3, 4]) { delete fields[`class${n}`]; Object.assign(fields, { [`count${n}`]: 0, [`level${n}`]: 1, [`hurt${n}`]: 5 }); }
    blocks.foes.fields = fields;
    return blocks;
};
const fieldsOf = host => host.head().domains.dataModules.instances['pack.chat/foes'].chat.fields;
const RANKS = [[1, 9, 'F'], [10, 19, 'E'], [20, 29, 'D'], [80, 99, 'SSS']];
const rankAt = level => { const hit = RANKS.find(([from, to]) => level >= from && level <= to); return hit ? { name: hit[2] } : null; };
const sheetOf = blocks => readSheet({ domains: { dataModules: (() => {
    const domain = { pins: {}, active: {}, instances: {}, perReply: {} };
    Object.entries(blocks).forEach(([slug, block], n) => {
        const id = `pack.chat/${slug}`;
        domain.pins[`h${n}`] = { definition: { id, slug, name: slug, role: block.role, schema: 1, scope: 'chat' }, packId: 'chat', interpreter: 1 };
        domain.active[id] = { hash: `h${n}`, generation: 1, subjects: ['chat'] };
        domain.instances[id] = { chat: { fields: block.fields, timers: {}, offers: {}, settled: {} } };
    });
    return domain;
})() } });

test('the roll term is floor(level / divisor), 5 unless the rules say another; Standard Health is 4 + floor(level / 30)', () => {
    assert.deepEqual([1, 4, 5, 14, 15, 99].map(level => levelBonus(level)), [0, 0, 1, 2, 3, 19]);
    assert.deepEqual([14, 15, 99].map(level => levelBonus(level, 3)), [4, 5, 33]);
    assert.deepEqual([14, 99].map(level => levelBonus(level, 8)), [1, 12]);
    assert.equal(levelBonus(14, 0), 2, 'a divisor that is not 1 or more is the default');
    assert.equal(divisorOf(4), 4);
    assert.equal(divisorOf(12.5), null);
    assert.equal(divisorOf(undefined), null);
    assert.deepEqual([1, 29, 30, 59, 60, 89, 90, 99].map(foeBlocksByLevel), [4, 4, 5, 5, 6, 6, 7, 7]);
    assert.equal(LV_VERSION, 1);
});

test('a level is held to 1..99; a Soul Class of the earlier rules stands for 10 x class - 5 and back', () => {
    assert.deepEqual([0, -3, 1, 50, 99, 150, '14', ' 7 ', 'x', 2.5, null].map(levelOf), [1, 1, 1, 50, 99, 99, 14, 7, null, null, null]);
    assert.deepEqual([1, 2, 5, 9, 0, 10, null].map(levelOfClass), [5, 15, 45, 85, null, null, null]);
    assert.deepEqual([5, 15, 45, 85, 1, 99].map(classOfLevel), [1, 2, 5, 9, 1, 9]);
});

test('pickLevel: the level given wins; a rank gives a level inside its band; neither gives one within 2 of the party\'s average, held to 1..99', () => {
    const always = value => () => value;
    assert.equal(pickLevel({ level: 40 }, 10, always(0.5)), 40);
    assert.equal(pickLevel({ level: 400 }, 10, always(0.5)), 99, 'held to 99');
    assert.equal(pickLevel({ level: 0 }, 10, always(0.5)), 1, 'held to 1');
    assert.equal(pickLevel({ from: 10, to: 19 }, 50, always(0)), 10);
    assert.equal(pickLevel({ from: 10, to: 19 }, 50, always(0.999)), 19);
    assert.equal(pickLevel({ from: 20, to: 20 }, 50, always(0.7)), 20);
    assert.equal(pickLevel({ level: 12, from: 10, to: 19 }, 50, always(0)), 12, 'a level beats a band');
    assert.deepEqual([0, 0.2, 0.4, 0.6, 0.8, 0.999].map(value => pickLevel({}, 30, always(value))), [28, 29, 30, 31, 32, 32]);
    assert.deepEqual([0, 0.2, 0.4, 0.6, 0.8, 0.999].map(value => pickLevel({}, 1, always(value))), [1, 1, 1, 2, 3, 3], 'never below 1');
    assert.deepEqual([0, 0.2, 0.4, 0.6, 0.8, 0.999].map(value => pickLevel({}, 99, always(value))), [97, 98, 99, 99, 99, 99], 'never above 99');
    assert.equal(pickLevel({}, undefined, always(0)), 1, 'no party level: around level 1');
    // Many seeds: always inside the window, and every level of it comes up.
    const seen = new Set();
    for (let base = 0; base < 400; base += 1) { const level = pickLevel({}, 30, foeRandom(base * 7919, 0)); assert.ok(level >= 28 && level <= 32, String(level)); seen.add(level); }
    assert.deepEqual([...seen].sort((a, b) => a - b), [28, 29, 30, 31, 32]);
});

test('the party\'s average level: a Character block\'s level, else the level its Soul Class stands for; the dead are not counted', () => {
    assert.equal(averageLevel([10, 20]), 15);
    assert.equal(averageLevel([10, 11]), 11, 'rounded to the nearest');
    assert.equal(averageLevel([]), 1);
    assert.equal(averageLevel([0, null, 40]), 40, 'what is not a level is passed over');
    const sheet = sheetOf(PARTY());
    assert.deepEqual(partyLevels(sheet), [15, 15], 'Soul Class II is level 15');
    assert.deepEqual(partyLevels({ characters: [{ level: 33 }, { soul: 3 }, { level: 90, alive: false }] }), [33, 25]);
});

test('the same seed and place give the same level, another seed another (settleOpen)', () => {
    const open = [{ name: 'A', count: 1 }, { name: 'B', count: 2, from: 20, to: 29 }, { name: 'C', count: 1, level: 61 }];
    const once = settleOpen(open, 40, 123456);
    assert.deepEqual(settleOpen(open, 40, 123456), once, 'Re-read: the same seed');
    assert.equal(once[2].level, 61);
    assert.ok(once[0].level >= 38 && once[0].level <= 42 && once[1].level >= 20 && once[1].level <= 29);
    const levels = new Set();
    for (let base = 1; base < 60; base += 1) levels.add(settleOpen(open, 40, base * 104729).map(entry => entry.level).join());
    assert.ok(levels.size > 5, 'a swipe (a new seed) draws anew');
});

test('bandOfRank finds a rank\'s band through the rank query; no query, a throwing one or an unknown name is no band', () => {
    assert.deepEqual(bandOfRank('E', rankAt), { from: 10, to: 19 });
    assert.deepEqual(bandOfRank(' d ', rankAt), { from: 20, to: 29 }, 'without case');
    assert.deepEqual(bandOfRank('F', rankAt), { from: 1, to: 9 });
    assert.equal(bandOfRank('S', rankAt), null);
    assert.equal(bandOfRank('E', null), null);
    assert.equal(bandOfRank('E', () => { throw new Error('no such query'); }), null);
    assert.equal(bandOfRank('', rankAt), null);
    assert.equal(foeLabel(14, rankAt), 'Rank E · Lv 14');
    assert.equal(foeLabel(40, rankAt), 'Lv 40');
    assert.equal(foeLabel(14), 'Lv 14');
});

test('vetOpen: level as written, a rank\'s band, an old class as its level, or nothing left to be drawn; counts held; held to the party\'s highest + 20', () => {
    const sheet = sheetOf(PARTY());
    const text = ['goblins and rats and wolves and ogres and drakes and imps'];
    const vetted = vetOpen([
        { name: 'Goblins', count: '5', level: '14' }, { name: 'Wolves', count: '2', level: 'Lv 99' }, { name: 'Ogres', count: '1', rank: 'E' },
        { name: 'Drakes', count: '1', rank: 'Q' }, { name: 'Imps', count: '0', class: 'III' }, { name: 'Dragons', count: '1', level: '3' },
    ], sheet, text, { rankAt });
    assert.deepEqual(vetted.open.slice(0, 4), [
        { name: 'Goblins', count: 5, level: 14 }, { name: 'Wolves', count: 2, level: 35 }, { name: 'Ogres', count: 1, rank: 'E', from: 10, to: 19 }, { name: 'Drakes', count: 1 },
    ], 'an unknown rank is passed over: its level is drawn');
    assert.equal(vetted.open.length, 4, 'four slots at most');
    // The cap on a NEW foe: the party's highest level + 20, at least 1.
    const party14 = { characters: [{ level: 14 }, { level: 9 }], foes: [] };
    assert.deepEqual(vetOpen([{ name: 'Wolves', level: '99' }], party14, text).open, [{ name: 'Wolves', count: 1, level: 34 }], 'level 99 against a party of 14: 34');
    assert.deepEqual(vetOpen([{ name: 'Wolves', rank: 'SSS' }], party14, text, { rankAt }).open, [{ name: 'Wolves', count: 1, level: 34 }], 'a rank wholly above the cap: the cap');
    assert.deepEqual(vetOpen([{ name: 'Wolves', rank: 'D' }], party14, text, { rankAt }).open, [{ name: 'Wolves', count: 1, rank: 'D', from: 20, to: 29 }], 'a band that crosses the cap is cut at it');
    assert.deepEqual(vetOpen([{ name: 'Wolves', level: '99' }], { characters: [], foes: [] }, text).open, [{ name: 'Wolves', count: 1, level: 21 }], 'no party: level 1 + 20');
    assert.equal(foeLevelCap([95]), 99, 'at most 99');
    assert.deepEqual(vetOpen([{ name: 'Imps', count: '0', class: 'III' }], sheet, text).open, [{ name: 'Imps', count: 1, level: 25 }], 'class III is level 25');
    assert.deepEqual(vetOpen([{ name: 'Ogres', count: '1', rank: 'E' }], sheet, text).open, [{ name: 'Ogres', count: 1 }], 'no rank query: no band');
    assert.deepEqual(vetted.refused.map(entry => entry.name), ['Dragons'], 'a name neither text holds is refused');
    assert.deepEqual(vetOpen([{ name: 'Dragons', level: '3' }], sheet, ['nothing here']).refused.map(entry => entry.name), ['Dragons']);
});

test('a plan\'s open list: level, rank with its band, nothing, or an old class; anything else is refused', () => {
    const ok = open => validatePlan({ pace: 'normal', open }).ok;
    assert.equal(ok([{ name: 'A', count: 2, level: 14 }]), true);
    assert.equal(ok([{ name: 'A', count: 2 }]), true);
    assert.equal(ok([{ name: 'A', count: 2, rank: 'E', from: 10, to: 19 }]), true);
    assert.equal(ok([{ name: 'A', count: 2, class: 3 }]), true, 'a plan from before');
    assert.equal(ok([{ name: 'A', count: 2, level: 0 }]), false);
    assert.equal(ok([{ name: 'A', count: 2, level: 100 }]), false);
    assert.equal(ok([{ name: 'A', count: 2, level: 14, rank: 'E', from: 10, to: 19 }]), false, 'a level and a band');
    assert.equal(ok([{ name: 'A', count: 2, rank: 'E' }]), false, 'a rank needs its band');
    assert.equal(ok([{ name: 'A', count: 2, from: 10, to: 19 }]), false);
    assert.equal(ok([{ name: 'A', count: 2, rank: 'E', from: 20, to: 19 }]), false);
    assert.equal(ok([{ name: 'A', count: 2, rank: 'a very long rank name', from: 1, to: 9 }]), false);
    assert.equal(ok([{ name: 'A', count: 2, class: 3, level: 25 }]), false);
    assert.ok(openErrors([{ name: 'A', count: 2, level: 7, extra: 1 }]).length);
});

test('the Foes templates: level1..4 from 1 to 99 (default 1), no Soul Class; the set-slot kind takes a level; Standard Health follows 4 + level/30', () => {
    for (const templates of [STANDARD_TEMPLATES]) {
        const { state, kinds, prompt } = templates.find(entry => entry.name === 'Foes').definition;
        for (const n of [1, 2, 3, 4]) {
            assert.deepEqual([state[`level${n}`].min, state[`level${n}`].max, state[`level${n}`].default, state[`level${n}`].names], [1, 99, 1, undefined]);
            assert.equal(state[`class${n}`], undefined);
            assert.deepEqual(Object.keys(kinds[`set-slot-${n}`].labels), ['name', 'count', 'level']);
        }
        assert.ok(prompt.length <= 1200 && /level from 1 to 99/.test(prompt) && !/Soul Class/.test(prompt));
    }
    const standard = STANDARD_TEMPLATES.find(entry => entry.name === 'Foes').definition;
    assert.deepEqual(standard.kinds['set-slot-1'].effects.at(-1), { op: 'set', path: ['hurt1'], value: ['add', 4, ['floorDiv', ['arg', 'level'], 30]] });
    for (const [level, blocks] of [[1, 4], [29, 4], [30, 5], [60, 6], [99, 7]]) assert.equal(sizeOf({ type: 'int', blocks: 'foe' }, { level1: level }, 'hurt1'), blocks, `level ${level}`);
    assert.equal(sizeOf({ type: 'int', blocks: 'foe' }, { class1: 4 }, 'hurt1'), 5, 'a block of the earlier rules: 4 + class/3');
});

test('the sheet gives a group its level; a block of the earlier rules gets the level of its class, and a levelled group a class for the earlier XP table', () => {
    const levelled = empty();
    levelled.foes.fields = { ...levelled.foes.fields, foe1: 'Hound', count1: 2, level1: 35 };
    const [hound] = sheetOf(levelled).foes;
    assert.deepEqual([hound.level, hound.levelled, hound.class], [35, true, 4]);
    const old = sheetOf(PARTY()).foes[0];
    assert.deepEqual([old.level, old.levelled, old.class], [5, undefined, 1]);
});

test('a level the plan gives is kept: the slot holds it, the roll adds floor(level / 5), the record carries the mark and the level', { skip }, async () => {
    const { host, problems } = await setup({ blocks: empty(), answers: [opens('level: 20')] });
    await host.send(MESSAGE, 'The silt churns.');
    assert.deepEqual(problems, []);
    assert.deepEqual([fieldsOf(host).foe1, fieldsOf(host).count1, fieldsOf(host).level1], ['Mud-Scale Crawlers', 3, 20]);
    const result = rollReceipt(host, 2).data.v2.result;
    assert.equal(result.lv, LV_VERSION);
    assert.deepEqual(result.opened, [{ slot: 1, module: 'pack.chat/foes', name: 'Mud-Scale Crawlers', count: 3, level: 20 }]);
    const foe = result.rounds[0].lines.find(line => line.foe).foe;
    assert.deepEqual([foe.classValue, foe.classBonus, foe.total - foe.die], [20, 4, 4 + 4]);
    host.close();
});

test('a level over 99 or under 1 in the planner\'s line is held; an old "class: III" is level 25', { skip }, async () => {
    const high = await setup({ blocks: empty(), answers: [opens('level: 400')] });
    await high.host.send(MESSAGE, 'The silt churns.');
    assert.equal(fieldsOf(high.host).level1, 35, 'held to the party\'s highest (15) + 20');
    high.host.close();
    const low = await setup({ blocks: empty(), answers: [opens('level: 0')] });
    await low.host.send(MESSAGE, 'The silt churns.');
    assert.equal(fieldsOf(low.host).level1, 1);
    low.host.close();
    const old = await setup({ blocks: empty(), answers: [opens('class: III')] });
    await old.host.send(MESSAGE, 'The silt churns.');
    assert.equal(fieldsOf(old.host).level1, 25);
    old.host.close();
});

test('a rank gives a level inside its band (the rank query names the ranks); with no query the rank is passed over and the level is drawn near the party', { skip }, async () => {
    const queries = { 'rpg.rank': (_state, args) => rankAt(args.level) };
    const ranked = await setup({ blocks: empty(), answers: [opens('rank: E')], queries });
    await ranked.host.send(MESSAGE, 'The silt churns.');
    const level = fieldsOf(ranked.host).level1;
    assert.ok(level >= 10 && level <= 19, `Rank E is 10..19, got ${level}`);
    const open = rollReceipt(ranked.host, 2).data.v2.result.opened[0];
    assert.equal(open.level, level);
    ranked.host.close();
    const plain = await setup({ blocks: empty(), answers: [opens('rank: E')] });
    await plain.host.send(MESSAGE, 'The silt churns.');
    const near = fieldsOf(plain.host).level1;
    assert.ok(near >= 13 && near <= 17, `the party averages 15, got ${near}`);
    plain.host.close();
});

test('no level and no rank: a level within 2 of the party\'s average (Soul Class II is level 15), the same on a Re-read, rebuild and reload', { skip }, async () => {
    const { host } = await setup({ blocks: empty(), answers: [opens()] });
    await host.send(MESSAGE, 'The silt churns.');
    const first = rollReceipt(host, 2);
    const level = fieldsOf(host).level1;
    assert.ok(level >= 13 && level <= 17, `got ${level}`);
    assert.equal(first.data.v2.result.opened[0].level, level);
    const before = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.deepEqual(rollReceipt(host, 2).data.v2.result, first.data.v2.result, 'the same dice and the same level');
    assert.equal(JSON.stringify(host.head()), before);
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), before, 'a rebuild agrees');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), before, 'a reload agrees');
    assert.deepEqual(host.store.problems(), []);
    host.close();
});

test('a swipe is a new seed: the level is drawn anew, within the same window', { skip }, async () => {
    const seen = new Set();
    for (let round = 0; round < 6; round += 1) {
        const { host } = await setup({ blocks: empty(), answers: [opens(), opens()] });
        await host.send(MESSAGE, 'The silt churns.');
        seen.add(fieldsOf(host).level1);
        await host.swipe('A second telling.');
        const level = fieldsOf(host).level1;
        assert.ok(level >= 13 && level <= 17, `got ${level}`);
        seen.add(level);
        host.close();
    }
    assert.ok(seen.size >= 2, `levels drawn: ${[...seen]}`);
});

test('the replay guard asks again on the levels the roll recorded: damaged levels or a damaged mark are refused', { skip }, async () => {
    const { host } = await setup({ blocks: empty(), answers: [opens()] });
    await host.send(MESSAGE, 'The silt churns.');
    const { leanRpgGuard } = await import('../../../src/v2/lean-rpg/index.js');
    const { hashJson } = await import('../../../src/v2/replay.js');
    const span = host.ctx.chat[2].extra.storySuite.spans.find(entry => entry.guard?.predicate?.kind === 'rpg.resolve');
    const before = host.store.before(2);
    const ask = (guard, recorded) => leanRpgGuard({ state: before, hash: hashJson }, { guard, source: span.source, recorded });
    assert.deepEqual(ask(span.guard, span.recorded), { ok: true });
    assert.equal(span.recorded.lv, LV_VERSION);
    assert.equal(span.recorded.levels.length, 1);
    const moved = { ...span.recorded, levels: [span.recorded.levels[0] === 30 ? 31 : 30] };
    assert.equal(ask(span.guard, moved).ok, false, 'another level than the one rolled');
    assert.equal(ask(span.guard, { ...span.recorded, levels: undefined }).ok, false, 'no levels for an opened fight');
    const { lv: _lv, ...noMark } = span.recorded;
    assert.equal(ask(span.guard, noMark).ok, false, 'a mark removed');
    host.close();
});

test('a roll made before the Levels rules (no lv) replays and rolls exactly as it did: the foe adds 3 x class (a record with no formula replays as Standard)', { skip }, async () => {
    const { host } = await setup({ answers: [['pace: normal', 'act Wessel | skill: Iron Breath | target: Sluice Rats', 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n')], levelless: true });
    await host.send('I strike the rats.', 'They scatter.');
    const result = rollReceipt(host, 2).data.v2.result;
    assert.equal(result.lv, undefined);
    const foe = result.rounds[0].lines.find(line => line.foe).foe;
    assert.deepEqual([foe.classValue, foe.classBonus], [1, 3], 'class I, replayed as Standard: 3 x 1');
    const before = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.deepEqual(rollReceipt(host, 2).data.v2.result, result);
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), before);
    assert.deepEqual(host.store.problems(), []);
    host.close();
});

test('a group on a block of the earlier rules rolls by the level its class stands for from a roll of the Levels rules', { skip }, async () => {
    const { host } = await setup({ answers: [['pace: normal', 'act Wessel | skill: Iron Breath | target: Sluice Rats', 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n')] });
    await host.send('I strike the rats.', 'They scatter.');
    const result = rollReceipt(host, 2).data.v2.result;
    assert.equal(result.lv, LV_VERSION);
    const foe = result.rounds[0].lines.find(line => line.foe).foe;
    assert.deepEqual([foe.classValue, foe.classBonus], [5, 1], 'class I is level 5: +1');
    host.close();
});

test('openFoes puts a level on the block, whichever rules its definition has', () => {
    const blocks = empty();
    const domain = (() => {
        const made = sheetOf(blocks); // just to be sure the fixture reads
        assert.equal(made.foes.length, 4);
        const d = { pins: {}, active: {}, instances: {}, perReply: {} };
        d.pins.h = { definition: { id: 'pack.chat/foes', slug: 'foes', name: 'foes', role: 'foes', schema: 1, scope: 'chat' }, packId: 'chat', interpreter: 1 };
        d.active['pack.chat/foes'] = { hash: 'h', generation: 1, subjects: ['chat'] };
        d.instances['pack.chat/foes'] = { chat: { fields: structuredClone(blocks.foes.fields), timers: {}, offers: {}, settled: {} } };
        return d;
    })();
    const placed = openFoes(domain, [{ name: 'Wolves', count: 2, level: 61 }]);
    assert.deepEqual(placed, [{ slot: 1, module: 'pack.chat/foes', name: 'Wolves', count: 2, level: 61 }]);
    assert.deepEqual([domain.instances['pack.chat/foes'].chat.fields.foe1, domain.instances['pack.chat/foes'].chat.fields.level1], ['Wolves', 61]);
});

// ---- real blocks ------------------------------------------------------------------------------------------------------------------

async function world(t, { answers, templates, settings = {}, party = true, soul = 9 } = {}) {
    const model = async () => (answers.length > 1 ? answers.shift() : answers[0] ?? 'none');
    const host = await createHost({ callModel: model, settings: { modules: { 'story-block': settings } } });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    host.features.set('story-block.fight-board', false);
    await host.send('Begin.', 'Opening.');
    if (party) {
        const character = structuredClone(templates.find(entry => entry.name === 'Character').definition);
        character.slug = 'wessel'; character.name = 'Wessel'; character.state.who.default = 'Wessel';
        const skills = structuredClone(templates.find(entry => entry.name === 'Skills').definition);
        skills.slug = 'wessel-skills'; skills.state.who.default = 'Wessel'; skills.state.skill1.default = 'Iron Breath'; skills.state.stat1.default = 'str';
        success(await host.sdk.command('dm.define', { definition: character }));
        success(await host.sdk.command('dm.define', { definition: skills }));
        success(await host.sdk.command('dm.set', { module: 'pack.chat/wessel', fields: { level: soul === 9 ? 85 : soul === 2 ? 15 : soul } }));   // (Soul Class 9 is level 85: a new foe may be up to 99, the party's 85 + 20 held to 99)
    }
    success(await host.sdk.command('dm.define', { definition: structuredClone(templates.find(entry => entry.name === 'Foes').definition) }));
    return host;
}
const sheetNow = host => readSheet(host.head());

test('the narrator\'s set-slot line: a level is kept; neither level nor rank draws one near the party; a rank draws inside its band; Standard Health follows the level', { skip }, async t => {
    const host = await world(t, { answers: ['none'], templates: STANDARD_TEMPLATES });
    await host.send('A drake.', reply('+ dm foes — why | kind: set-slot-1 | name: Weir-drake | count: 1 | level: 65'));
    let [drake] = sheetNow(host).foes;
    assert.deepEqual([drake.level, drake.size, drake.hurt], [65, 6, 6], '4 + floor(65 / 30) blocks, arriving full');
    // Wessel is level... his Soul Class (the block still has one) stands for a level; the draw is within 2 of it.
    const around = averageLevel(partyLevels(sheetNow(host)));
    await host.send('A rat.', reply('+ dm foes — why | kind: set-slot-2 | name: Sluice Rat | count: 2'));
    const rat = sheetNow(host).foes[1];
    assert.ok(rat.level >= Math.max(1, around - 2) && rat.level <= around + 2, `drawn near ${around}: ${rat.level}`);
    assert.equal(rat.size, 4 + Math.floor(rat.level / 30));
    await host.send('A hound.', reply('+ dm foes — why | kind: set-slot-3 | name: Silt Hound | count: 1 | level: 29'));
    assert.deepEqual([sheetNow(host).foes[2].level, sheetNow(host).foes[2].size], [29, 4]);
    await host.send('An ogre.', reply('+ dm foes — why | kind: set-slot-4 | name: Ogre | count: 1 | level: 30'));
    assert.deepEqual([sheetNow(host).foes[3].level, sheetNow(host).foes[3].size], [30, 5]);
    assert.deepEqual(host.store.problems(), []);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild keeps the drawn level');
    [drake] = sheetNow(host).foes;
    assert.equal(drake.level, 65);
});

test('the narrator\'s set-slot line with a rank: the level is drawn inside the rank\'s band; a rank no one names, or a level out of range, is refused or held', { skip }, async t => {
    const host = await world(t, { answers: ['none'], templates: STANDARD_TEMPLATES });
    // (The rank query is LV-C's; with none a line with a rank is read as "neither": a draw near the party. The band itself is tested above and in the planner's path.)
    await host.send('A hound.', reply('+ dm foes — why | kind: set-slot-1 | name: Silt Hound | count: 1 | rank: E'));
    const around = averageLevel(partyLevels(sheetNow(host)));
    const hound = sheetNow(host).foes[0];
    assert.ok(hound.level >= Math.max(1, around - 2) && hound.level <= around + 2, `no rank query: near the party, got ${hound.level}`);
    await host.send('Another.', reply('+ dm foes — why | kind: set-slot-2 | name: Giant | count: 1 | level: 150'));
    assert.deepEqual([sheetNow(host).foes[1].filled, sheetNow(host).foes[1].level], [true, 99], 'a level over 99 is held to 99, then to the cap: the party\'s highest 85 + 20, at most 99');
});

test('the narrator\'s line for a group already there updates its level, Classic and Standard', { skip }, async t => {
    for (const templates of [STANDARD_TEMPLATES]) {
        const host = await world(t, { answers: ['none'], templates });
        await host.send('A drake.', reply('+ dm foes — why | kind: set-slot-1 | name: Weir-drake | count: 1 | level: 20'));
        await host.send('More.', reply('+ dm foes — why | kind: set-slot-2 | name: weir-drake | count: 3 | level: 44'));
        const [drake, second] = sheetNow(host).foes;
        assert.deepEqual([drake.count, drake.level, second.filled], [3, 44, false], 'one group, updated');
    }
});

test('F1: a group named again with no level and no rank keeps the level it has; with a level or a rank it takes that', { skip }, async t => {
    const host = await world(t, { answers: ['none'], templates: STANDARD_TEMPLATES });
    await host.send('A drake.', reply('+ dm foes — why | kind: set-slot-1 | name: Weir-drake | count: 1 | level: 20'));
    await host.send('Two now.', reply('+ dm foes — why | kind: set-slot-2 | name: weir-drake | count: 2'));
    const [drake] = sheetNow(host).foes;
    assert.deepEqual([drake.count, drake.level], [2, 20], 'the count moved, the level did not');
    await host.send('Grown.', reply('+ dm foes — why | kind: set-slot-2 | name: Weir-drake | count: 2 | level: 25'));
    assert.equal(sheetNow(host).foes[0].level, 25);
    host.store.rebuild();
    assert.equal(sheetNow(host).foes[0].level, 25, 'live = rebuild');
});

test('a Standard fight on a level 62 group: the foe adds floor(level / 5) to its roll and to its turn-order roll', { skip }, async () => {
    const answer = ['pace: all', 'act Wessel | skill: Iron Breath | type: physical | target: Warlord', 'foe Warlord | target: Wessel'].join('\n');
    const blocks = { ...PARTY(), foes: { role: 'foes', fields: levelFoeBlock([['Warlord', 1, 62, 6]]) } };
    const { host } = await setup({ blocks, answers: [answer] });
    await host.send('I strike.', 'Steel rings.');
    const result = rollReceipt(host, 2).data.v2.result;
    assert.equal(result.lv, LV_VERSION);
    const foe = result.rounds[0].lines.find(line => line.foe).foe;
    assert.deepEqual([foe.classValue, foe.classBonus], [62, 12]);
    // The foe's turn-order roll is d20 + floor(level / 5) (no AGI term for a foe).
    const lead = result.order.find(entry => !entry.party);
    assert.deepEqual([lead.bonus, lead.total - lead.die], [12, 12]);
    host.close();
});

test('the narrator\'s set-slot line holds a new foe\'s level to the party\'s highest + 20 (Soul Class II is level 15: 35)', { skip }, async t => {
    const host = await world(t, { answers: ['none'], templates: STANDARD_TEMPLATES, soul: 2 });
    await host.send('A dragon.', reply('+ dm foes — why | kind: set-slot-1 | name: Dragon | count: 1 | level: 99'));
    assert.equal(sheetNow(host).foes[0].level, 35);
    await host.send('An imp.', reply('+ dm foes — why | kind: set-slot-2 | name: Imp | count: 1 | level: 7'));
    assert.equal(sheetNow(host).foes[1].level, 7, 'under the cap: as written');
});
