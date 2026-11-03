// Levels (2.17.0, stage 51 LV-A): the Character block's level / XP / cap and its rise rule, the roll term floor(level / divisor) on both formulas,
// the Custom divisor, the planner's party list, the Level cap setting, and that a roll made before levels replays exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { DEFAULT_SETTINGS, EARLIER_RULES, LEVEL, LV_VERSION, STANDARD, STANDARD_FORMULA, classTerm, hasLevels, levelBonus, levelCapFor, levelOfClass, normalizeRules,
    oddsSubject, prepare, readSheet, rollPrepared, rulesFromSettings, subjectOdds } from '../../../src/v2/lean-rpg/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { buildDefinitions, newDraft } from '../../../src/v2/lean-rpg/view/wizard-data.js';
import { readParty } from '../../../src/v2/lean-rpg/view/party-data.js';
import { reply, success, view, rebuilt } from '../data-modules/helpers.js';
import { sheetText } from '../../../src/v2/lean-rpg/precall.js';
import { STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { fakeState } from './view/helpers.js';
import { hostAvailable } from '../../../testkit/index.js';
import { PARTY, character, rollReceipt, setup, sheetDomain } from './helpers.js';

const templates = formula => LEAN_RPG_TEMPLATES.filter(entry => entry.name === 'Character').map(entry => structuredClone(entry.definition));
const definition = () => templates()[0];
const line = (slug, kind, extra = '') => `+ dm ${slug} — why | kind: ${kind}${extra}`;
const sheet = (host, slug) => view(host, `pack.chat/${slug}`).chat;
async function story(t, mutate = () => {}) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const def = definition();
    mutate(def);
    success(await host.sdk.command('dm.define', { definition: def }));
    return host;
}
const xp = (host, amount) => host.send('Fight.', reply(line('character', 'add-xp', ` | amount: ${amount}`)));
const seen = host => { const c = sheet(host, 'character'); return [c.level, c.xp, c.points]; };

test('the templates have Level, XP and Level cap and no Soul Class; every other count is in names.js LEVEL', () => {
    for (const entry of LEAN_RPG_TEMPLATES.filter(entry => entry.name === 'Character')) {
        const { state, rules } = entry.definition;
        assert.equal(state.soul, undefined);
        assert.deepEqual([state.level.label, state.level.min, state.level.max, state.level.default], ['Level', 1, 99, 1]);
        assert.deepEqual([state.xp.label, state.xp.min, state.xp.max, state.xp.default], ['XP', 0, LEVEL.xpMax, 0], 'XP above 100 is kept for the rise');
        assert.deepEqual([state.cap.label, state.cap.min, state.cap.max, state.cap.default], ['Level cap', 1, 99, 99]);
        assert.ok(rules.some(rule => rule.id === 'level-up'));
        assert.ok(!rules.some(rule => rule.id === 'class-up'));
    }
    assert.deepEqual(LEVEL, { min: 1, max: 99, xpPerLevel: 100, xpMax: 9999, pointEvery: 3, divisor: 5, minDivisor: 3, maxDivisor: 8 });
    assert.equal(levelBonus(40), Math.floor(40 / LEVEL.divisor), 'formula.js has the same default divisor as names.js');
});

test('level-up: 100 XP raises the level by one and starts XP again; a swipe takes it back', async t => {
    const host = await story(t);
    await xp(host, 60);
    assert.deepEqual(seen(host), [1, 60, 0]);
    await xp(host, 50);
    assert.deepEqual(seen(host), [2, 10, 0], 'level 2, the 10 XP over 100 carried, no point yet');
    await host.swipe(reply(line('character', 'add-xp', ' | amount: 10')));
    assert.deepEqual(seen(host), [1, 70, 0]);
    rebuilt(host);
});

test('level-up: XP past 100 is carried, and as many levels rise as the XP covers, one point for each multiple of 3 crossed', async t => {
    const host = await story(t, def => { def.state.xp.default = 95; });
    await xp(host, 40);
    assert.deepEqual(seen(host), [2, 35, 0], '95 + 40: one level and 35 left, not 0');
    const many = await story(t, def => { def.state.xp.default = 450; def.state.level.default = 2; });
    await xp(many, 0);
    assert.deepEqual(seen(many), [6, 50, 2], '450 XP at level 2: four levels in one step (3, 4, 5, 6), 50 left, a point for 3 and for 6');
    rebuilt(many);
    const high = await story(t, def => { def.state.level.default = 98; def.state.cap.default = 99; def.state.xp.default = 250; });
    await xp(high, 0);
    assert.deepEqual(seen(high), [99, 100, 1], 'one level to the cap (99 is a multiple of 3: a point), the XP past the cap is not kept');
    rebuilt(high);
});

test('level-up: a point to spend with every third level (3, 6, 9 ...) and none between', async t => {
    const host = await story(t);
    const points = [];
    for (let n = 0; n < 7; n += 1) { await xp(host, 100); points.push(seen(host)); }
    assert.deepEqual(points, [[2, 0, 0], [3, 0, 1], [4, 0, 1], [5, 0, 1], [6, 0, 2], [7, 0, 2], [8, 0, 2]]);
    rebuilt(host);
});

test('level-up: a rise onto a multiple of three gives its point whatever the starting level, and the points hold at their 60', async t => {
    const host = await story(t, def => { def.state.level.default = 89; def.state.points.default = 59; });
    await xp(host, 100);
    assert.deepEqual(seen(host), [90, 0, 60], '90 is a multiple of 3: 59 + 1');
    await xp(host, 100);
    await xp(host, 100);
    await xp(host, 100);
    assert.deepEqual(seen(host), [93, 0, 60], 'clamped at 60');
    rebuilt(host);
});

test('level-up: at the cap there is no rise, XP holds at 100 and no point; the cap is the block\'s own field', async t => {
    const host = await story(t, def => { def.state.level.default = 4; def.state.cap.default = 5; });
    await xp(host, 100);
    assert.deepEqual(seen(host), [5, 0, 0]);
    await xp(host, 100);
    assert.deepEqual(seen(host), [5, 100, 0], 'level == cap: XP holds at 100');
    await xp(host, 40);
    assert.deepEqual(seen(host), [5, 100, 0]);
    rebuilt(host);
    const top = await story(t, def => { def.state.level.default = 99; def.state.points.default = 3; });
    await xp(top, 100);
    assert.deepEqual(seen(top), [99, 100, 3], 'level 99 (cap 99): the same');
});

test('the Standard and Classic templates carry the same rule', () => {
    const all = LEAN_RPG_TEMPLATES.filter(entry => entry.definition.role === 'character').map(entry => JSON.stringify(entry.definition.rules.find(rule => rule.id === 'level-up')));
    assert.ok(all.length >= 1);
    assert.ok(all.every(text => text === all[0]));
});

// ---- the roll term ---------------------------------------------------------------------------------------------------------------

const sheetOf = (fields = {}) => readSheet({ domains: { dataModules: sheetDomain({ ...PARTY(), wessel: { role: 'character', fields: character('Wessel', fields) } }) } });
const plan = { pace: 'normal', acts: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats' }], foes: [], checks: [] };
const bonusOf = (fields, rules) => prepare(plan, sheetOf(fields), rules).acts[0].pc;

test('Classic: the roll adds floor(level / 5) in place of 2 × Soul Class', () => {
    const rules = { ...STANDARD, levelDivisor: 5 };
    for (const [level, expected] of [[1, 0], [4, 0], [5, 1], [14, 2], [40, 8], [99, 19]]) {
        const pc = bonusOf({ level, soul: 9 }, rules);
        assert.deepEqual([pc.classValue, pc.classBonus], [level, expected], `level ${level}`);
    }
    const old = bonusOf({ level: 40, soul: 2 }, STANDARD);
    assert.deepEqual([old.classValue, old.classBonus], [2, 4], 'numbers with no divisor: the Soul Class, as before');
});

test('Standard: the same term, and the turn order uses it too', () => {
    const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
    const std = fields => prepare({ pace: 'normal', acts: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats', type: 'physical' }], foes: [], checks: [] }, sheetOf(fields), rules).acts[0].pc;
    assert.deepEqual([std({ level: 25 }).classValue, std({ level: 25 }).classBonus], [25, 5]);
    assert.equal(std({ level: 24 }).classBonus, 4);
    assert.equal(std({ level: 99 }).classBonus, 19);
});

test('Custom divisor 3 to 8: floor(level / divisor); a value outside it is not kept, and a level is held to 1..99', () => {
    for (const [divisor, level, expected] of [[3, 14, 4], [4, 14, 3], [8, 14, 1], [8, 7, 0], [3, 99, 33], [5, 14, 2]]) {
        assert.equal(levelBonus(level, divisor), expected, `${level}/${divisor}`);
        assert.equal(bonusOf({ level }, { ...STANDARD, levelDivisor: divisor }).classBonus, expected);
    }
    assert.equal(levelBonus(40, 2), 8, 'a divisor of 2 reads as 5');
    assert.equal(levelBonus(40, 9), 8);
    assert.equal(levelBonus(500, 5), 19);
    assert.equal(levelBonus(0, 5), 0);
    assert.equal(normalizeRules({ ...STANDARD, levelDivisor: 2 }).levelDivisor, undefined);
    assert.equal(normalizeRules({ ...STANDARD, levelDivisor: 7 }).levelDivisor, 7);
    assert.equal(normalizeRules({ ...STANDARD_FORMULA, levelDivisor: 4 }).levelDivisor, 4);
    assert.equal(hasLevels(normalizeRules(STANDARD)), false);
});

test('rulesFromSettings: every new roll carries the divisor, 5 unless the Custom numbers say 3 to 8', () => {
    assert.equal(rulesFromSettings({}).levelDivisor, 5);
    assert.equal(rulesFromSettings({ rpgDifficulty: 'harsh' }).levelDivisor, 5);
    assert.equal(rulesFromSettings({ rpgDifficulty: 'custom', rpgStandard: { levelDivisor: 3 } }).levelDivisor, 3);
    assert.equal(rulesFromSettings({ rpgDifficulty: 'custom', rpgFormula: 'classic', rpgCustom: { levelDivisor: 8 } }).levelDivisor, 8);
    assert.equal(rulesFromSettings({ rpgDifficulty: 'custom', rpgStandard: { levelDivisor: 12 } }).levelDivisor, 5, 'out of range: 5');
    assert.equal(rulesFromSettings({ rpgDifficulty: 'gentle', rpgStandard: { levelDivisor: 3 } }).levelDivisor, 5, 'only Custom reads it');
});

test('the odds in Settings use the level too', () => {
    const subject = oddsSubject(sheetOf({ level: 30, str: 14, soul: 1 }), 'Wessel', { rankNames: ['Novice'], soulNames: [], fold: text => text.toLowerCase(), standard: false });
    assert.equal(subject.level, 30);
    const levelled = subjectOdds({ ...STANDARD, levelDivisor: 5 }, subject);
    const earlier = subjectOdds(STANDARD, subject);
    assert.equal(levelled.bonus, earlier.bonus + 6 - 2 * 1, 'floor(30 / 5) in place of 2 × Soul Class I');
    assert.ok(levelled.success > 0 && levelled.success + levelled.cost + levelled.fail >= 99);
});

test('a block made before levels (Soul Class, no level) reads at the level its class stands for; its old roll terms are unchanged', () => {
    const old = sheetOf({ soul: 3, level: undefined }).characters.find(entry => entry.who === 'Wessel');
    assert.equal(old.level, levelOfClass(3));
    assert.equal(old.level, 25);
    assert.equal(old.soul, 3);
    assert.equal(old.levelled, undefined);
});

// ---- a roll made before levels replays exactly ---------------------------------------------------------------------------------------

test('a roll with no level mark: the payload\'s numbers have no divisor, the Soul Class term, and rollPrepared gives the same lines', () => {
    const prepared = prepare(plan, sheetOf({ soul: 2, level: 77 }), EARLIER_RULES);
    const dice = (...values) => () => values.shift();
    const rolled = rollPrepared(plan, prepared, dice(14, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10), EARLIER_RULES);
    const [first] = rolled.rounds[0].lines;
    assert.deepEqual([first.pc.classValue, first.pc.classBonus], [2, 4]);
    assert.equal(LV_VERSION, 1);
});

test('the Level cap setting: a default of 99, a schema row, pack first then setting then 99', () => {
    assert.equal(DEFAULT_SETTINGS.rpgLevelCap, 99);
    assert.equal(levelCapFor({}), 99);
    assert.equal(levelCapFor({ rpgLevelCap: 40 }), 40);
    assert.equal(levelCapFor({ rpgLevelCap: 40 }, 60), 60);
    assert.equal(levelCapFor({ rpgLevelCap: 400 }), 99);
    assert.equal(levelCapFor({ rpgLevelCap: 0 }, 100), 99);
});

test('the part registers the setting with its schema (int 1..99)', async t => {
    const { createLeanRpgPart } = await import('../../../src/v2/lean-rpg/index.js');
    const part = createLeanRpgPart({ callModel: async () => '', chat: () => [], chatId: () => 'c', metadata: () => null, problem: () => {}, moduleId: 'story-block' });
    assert.equal(part.settings.defaults.rpgLevelCap, 99);
    assert.deepEqual([part.settings.schema.rpgLevelCap.type, part.settings.schema.rpgLevelCap.min, part.settings.schema.rpgLevelCap.max], ['int', 1, 99]);
});

// ---- New character defaults -------------------------------------------------------------------------------------------------------------

test('a new character starts at level 1 with the story\'s cap; a companion who arrives with a class starts at the level it stands for, never above the cap', () => {
    const draft = newDraft({ persona: '', hasYou: false });
    const mine = buildDefinitions({ ...draft, name: 'Astra' }, { cap: 40 });
    assert.deepEqual([mine.character.state.level.default, mine.character.state.cap.default], [1, 40]);
    const plain = buildDefinitions({ ...draft, name: 'Astra' });
    assert.deepEqual([plain.character.state.level.default, plain.character.state.cap.default], [1, 99]);
    const joined = buildDefinitions({ ...draft, name: 'Ren', soul: 3 }, { cap: 20 });
    assert.deepEqual([joined.character.state.level.default, joined.character.state.cap.default], [20, 20]);
    const free = buildDefinitions({ ...draft, name: 'Ren', soul: 3 });
    assert.equal(free.character.state.level.default, 25);
});

test('the Party tab prints the level where it printed the Soul Class: label "Level", the number as its word; an earlier block keeps its class', () => {
    const levelled = { definition: { ...structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Character').definition), slug: 'astra' }, fields: { who: 'Astra', level: 14, xp: 30 } };
    const earlier = { definition: { ...structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Character').definition), slug: 'ren' }, fields: { who: 'Ren', soul: 3 } };
    delete earlier.definition.state.level;
    earlier.definition.state.soul = { type: 'int', min: 1, max: 9, default: 1, label: 'Soul Class', names: { 1: 'I', 2: 'II', 3: 'III' } };
    const [astra, ren] = readParty(fakeState([levelled, earlier]), { own: 'Astra', roleOf: definition => definition.role ?? null });
    assert.deepEqual([astra.soulLabel, astra.soulName, astra.level, astra.levelled], ['Level', '14', 14, true]);
    assert.deepEqual([ren.soulLabel, ren.soulName, ren.soul, ren.level, ren.levelled], ['Soul Class', 'III', 3, 25, undefined]);
});

test('the planner\'s party list says "Astra (Lv 14)" for a block with a level and keeps the Soul Class words for an earlier block', () => {
    const blocks = { ...PARTY(), astra: { role: 'character', fields: character('Astra', { level: 14, soul: undefined }) } };
    const domain = sheetDomain(blocks);
    domain.pins.h5.definition.state = { level: { type: 'int', min: 1, max: 99, default: 1, label: 'Level' } };
    const text = sheetText(readSheet({ domains: { dataModules: domain } }));
    assert.match(text, /^Astra \(Lv 14\): STR 14/m);
    assert.match(text, /^Wessel \(class II\): STR 14/m);
});

// ---- the version mark through the real turn: a new roll says `lv: 1`, an old one has none and replays as it was ---------------------------------

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const levelled = () => { const blocks = PARTY(); blocks.wessel.fields = character('Wessel', { soul: 2, level: 40 }); return blocks; };

const sameStory = async host => {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live story');
    assert.deepEqual(host.store.problems(), []);
};

test('a new roll carries lv: 1 and the divisor in its numbers, rolls with floor(level / 5), and a Re-read, a rebuild and a reload keep it', { skip }, async () => {
    const { host } = await setup({ blocks: levelled() });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const receipt = rollReceipt(host, 2);
    const result = receipt.data.v2.result;
    assert.equal(result.lv, LV_VERSION);
    assert.equal(result.rules.levelDivisor, 5);
    assert.equal(receipt.replan.payload.lv, LV_VERSION);
    const pc = result.rounds[0].lines.find(entry => entry.kind === 'act').pc;
    assert.deepEqual([pc.classValue, pc.classBonus], [40, 8], 'level 40 (the Soul Class 2 field is not the term any more): +8');
    const before = JSON.stringify(result);
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(JSON.stringify(rollReceipt(host, 2).data.v2.result), before, 'a Re-read keeps the roll');
    await sameStory(host);
    host.close();
});

test('a roll made before levels (no lv, numbers with no divisor) replays exactly as it was: the Soul Class term, through a Re-read, a rebuild and a reload', { skip }, async () => {
    const { host } = await setup({ blocks: levelled(), lvless: true });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const result = rollReceipt(host, 2).data.v2.result;
    assert.equal(result.lv, undefined);
    assert.equal('levelDivisor' in result.rules, false);
    const pc = result.rounds[0].lines.find(entry => entry.kind === 'act').pc;
    assert.deepEqual([pc.classValue, pc.classBonus], [2, 4], 'Soul Class 2: 2 × 2, whatever the level is');
    const before = JSON.stringify(result);
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(JSON.stringify(rollReceipt(host, 2).data.v2.result), before);
    await sameStory(host);
    host.close();
});

test('the roll line on a skill card follows the level: floor(level / divisor) under levelled numbers, 2 × Soul Class under earlier ones', async () => {
    const { rollOf } = await import('../../../src/v2/lean-rpg/view/skills.js');
    const hero = { soul: 2, level: 40, stats: [{ key: 'str', label: 'STR', value: 14 }] };
    const skill = { stat: 'str', rank: 1, uses: 'stamina' };
    assert.equal(rollOf(skill, hero, { ...STANDARD, levelDivisor: 5 }).bonus, 8);
    assert.equal(rollOf(skill, hero, { ...STANDARD, levelDivisor: 3 }).bonus, 13);
    assert.equal(rollOf(skill, hero, STANDARD).bonus, 4, 'numbers with no divisor: the Soul Class term');
});

test('the battle log names the term "Level 40" for a block with a Level field, and keeps "Class II" / the renamed word for an earlier block', async () => {
    const { characterReading } = await import('../../../src/v2/lean-rpg/soul.js');
    const level = characterReading({ state: { level: { type: 'int', label: 'Level' } } });
    assert.deepEqual([level.label, level.word(40), level.word(3)], ['Level', '40', '3']);
    const earlier = characterReading({ state: { soul: { type: 'int', label: 'Soul Class', names: { 3: 'III' } } } });
    assert.deepEqual([earlier.label, earlier.word(3)], ['Soul Class', 'III']);
    assert.deepEqual([characterReading(undefined).label, characterReading(undefined).word(2)], ['Soul Class', 'II']);
});

test('B13: the pack\'s level cap (its ranks record) is the cap of a new character; the setting is the fallback, then 99', async () => {
    const { packLevelsOf } = await import('../../../src/v2/lean-rpg/levels.js');
    const records = [{ slug: 'formula', formula: 'standard' }, { slug: 'ranks', ranks: [{ name: 'F', from: 1, to: 40 }], levelCap: 40 }];
    const fromPack = packLevelsOf(records).levelCap;
    assert.equal(fromPack, 40);
    assert.equal(levelCapFor({ rpgLevelCap: 60 }, fromPack), 40, 'the pack comes first');
    assert.equal(levelCapFor({ rpgLevelCap: 60 }, packLevelsOf([{ slug: 'ranks', ranks: [{ name: 'F', from: 1, to: 40 }] }]).levelCap), 60, 'a pack with no cap: the setting');
    assert.equal(levelCapFor({}, undefined), 99);
    const made = buildDefinitions({ ...newDraft({ persona: '', hasYou: false }), name: 'Astra', level: 70 }, { cap: levelCapFor({}, fromPack) });
    assert.deepEqual([made.character.state.level.default, made.character.state.cap.default], [40, 40], 'a character made under the pack starts no higher than its cap');
});
