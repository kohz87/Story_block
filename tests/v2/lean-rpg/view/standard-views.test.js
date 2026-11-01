// The Standard stat formula on the screens I own: Settings → RPG (the Stat formula card, Standard's Difficulty and Custom numbers, the odds bar,
// the Combat text and the planner's prompt) and the New character wizard's Stats step (start 5, 10 points, 3 to 10, the bar line), and the
// pure pieces behind them (growth.js, wizard-data.js creation numbers, join.js companions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATS } from '../../../../src/v2/lean-rpg/index.js';
import { DIFFICULTY_SETTING, FORMULA_SETTING, STANDARD_FORMULA, STANDARD_PRESETS, STANDARD_SETTING, CUSTOM_SETTING, formulaOf, rulesFromSettings } from '../../../../src/v2/lean-rpg/rules.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { COMBAT_PROMPT_STANDARD, STANDARD_TEMPLATES, templatesFor } from '../../../../src/v2/lean-rpg/templates.js';
import { RPG_STRINGS } from '../../../../src/v2/lean-rpg/strings.js';
import { PRECALL_HEAD, PRECALL_HEAD_STANDARD } from '../../../../src/v2/lean-rpg/precall.js';
import { growthOf } from '../../../../src/v2/lean-rpg/blocks.js';
import { growthText } from '../../../../src/v2/lean-rpg/view/party-data.js';
import { joinDefinitions, joinDraft } from '../../../../src/v2/lean-rpg/join.js';
import { companionStats, blocksFor } from '../../../../src/v2/lean-rpg/formula.js';
import { COMBAT_DEFAULT, COMBAT_DEFAULT_STANDARD, COMBAT_MAX, combatBlock, combatDefault, combatTemplate, customOf, oddsView } from '../../../../src/v2/lean-rpg/view/settings-data.js';
import { buildDefinitions, creationOf, newDraft, pointsLeft, readDraft, startStats, statBounds } from '../../../../src/v2/lean-rpg/view/wizard-data.js';
import { begin, makeBlocks, page, party, settle } from './page.js';
import { characterDefinition, fakeState, roleOf, skillsDefinition } from './helpers.js';

const MOD = 'story-block';
const combat = () => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === 'Combat rules').definition);

async function open(t, { formula = 'standard' } = {}) {
    const ctx = await page(t, { feature: true, persona: 'Wessel', formula });
    await begin(ctx.host);
    // Wessel as the mockup has him: AGI 10, DEX 6, Soul Class II, Expert Iaijutsu on AGI.
    await makeBlocks(ctx.host, { who: 'Wessel', character: { str: 10, vit: 10, agi: 10, dex: 6, int: 5, soul: 2 }, skills: { skill1: 'Iaijutsu', stat1: 'agi', rank1: 2 } });
    assert.equal((await ctx.host.sdk.command('dm.define', { definition: combat() })).ok, true);
    const win = ctx.ui.openSettings();
    win.select('rpg');
    await settle();
    const root = ctx.doc.querySelector('[data-ss-section="rpg"]');
    const card = name => root.querySelector(`[data-card="${name}"]`);
    return { ...ctx, win, root, card, stored: () => ctx.host.settings(MOD) };
}
const typeInto = (node, value) => { node.value = value; node.dispatch('change'); };

// ---- Settings → RPG ---------------------------------------------------------------------------------------------------

test('the Stat formula card is first: Standard or Classic, the roll table of the one in force and its four numbers, and a pick is stored', async t => {
    const { root, card, stored } = await open(t);
    assert.equal(root.querySelectorAll('.rpg-set-card')[0].getAttribute('data-card'), 'formula');
    assert.deepEqual(card('formula').querySelectorAll('.rpg-chip').map(node => node.textContent), ['Standard', 'Classic']);
    assert.equal(card('formula').querySelector('[aria-pressed="true"]').textContent, 'Standard');
    assert.deepEqual(card('formula').querySelectorAll('.rpg-formula-table th').map(node => node.textContent), ['Physical', 'Magic', 'Defence', 'Social', 'Checks', 'Turn order']);
    assert.match(card('formula').querySelector('.rpg-formula-table').textContent, /Magic\s*class \+ \(INT or the skill's stat \+ DEX\/2\)\/2 \+ rank \+ edge/, 'no INT×2');
    assert.doesNotMatch(card('formula').textContent, /INT×2|INT x 2/);
    assert.deepEqual(card('formula').querySelectorAll('.rpg-formula-num').map(node => [node.querySelector('b').textContent, node.querySelector('span').textContent]), [
        ['5', 'Stats start at'], ['10', 'Points at creation'], ['4', 'Points per Soul Class'], ['4 + 3×class', 'Foe\'s base'],
    ]);
    assert.match(card('formula').textContent, /Class is 2 × Soul Class\. Luck steps at LUK 8/);
    card('formula').querySelector('.rpg-chip[data-value="classic"]').click();
    await settle();
    assert.equal(stored().rpgFormula, 'classic');
    assert.equal(card('formula').querySelector('[aria-pressed="true"]').textContent, 'Classic');
    assert.deepEqual(card('formula').querySelectorAll('.rpg-formula-table th').map(node => node.textContent), ['Every roll']);
    assert.deepEqual(card('formula').querySelectorAll('.rpg-formula-num b').map(node => node.textContent), ['10', '6', '3', '5 + 2×class']);
    card('formula').querySelector('.rpg-chip[data-value="standard"]').click();
    assert.equal(stored().rpgFormula, 'standard');
});

test('Standard\'s Difficulty: Gentle, Standard and Harsh move the foe\'s base (2, 4, 6) in the numbers shown, the odds follow, and the others are compared', async t => {
    const { card, stored } = await open(t);
    const oddsText = () => card('difficulty').querySelector('.rpg-odds-legend').textContent;
    assert.equal(card('difficulty').querySelector('[aria-pressed="true"]').textContent, 'Standard');
    // Wessel: pair(AGI 10, DEX 6) = 6, Class II 4, Expert 2: +12 against a Class II foe, 4 + 3 × 2 = 10 at Standard.
    assert.equal(card('difficulty').querySelector('.rpg-odds-title').textContent, 'Wessel (AGI 10 with DEX 6, Soul Class II, Expert) against a Class II foe');
    const standard = oddsText();
    assert.match(card('difficulty').querySelector('.rpg-odds-compare').textContent, /^For comparison, same fight: Gentle \d+ \/ \d+ \/ \d+ · Harsh \d+ \/ \d+ \/ \d+\.$/);
    card('difficulty').querySelector('.rpg-chip[data-value="harsh"]').click();
    await settle();
    assert.equal(stored().rpgDifficulty, 'harsh');
    assert.notEqual(oddsText(), standard);
    assert.equal(card('formula').querySelectorAll('.rpg-formula-num b')[3].textContent, '6 + 3×class', 'the numbers follow the difficulty');
    // The odds bar is the engine's own: the exact chances of that fight.
    const view = oddsView(host => host, 'Wessel', STANDARD_PRESETS.harsh);
    assert.equal(view, null, 'no state, no odds');
});

test('Custom shows Standard\'s thirteen numbers, each held to its range, kept apart from Classic\'s', async t => {
    const { card, stored, root } = await open(t);
    card('difficulty').querySelector('.rpg-chip[data-value="custom"]').click();
    await settle();
    const inputs = () => card('difficulty').querySelectorAll('[data-rule]');
    assert.deepEqual(inputs().map(node => node.getAttribute('data-rule')), ['foeBase', 'foeClassWeight', 'classWeight', 'costMargin', 'decisiveMargin', 'roundCap', 'quickStartMargin',
        'startStat', 'createPoints', 'createMin', 'createMax', 'pointsPerSoul', 'statMax']);
    assert.deepEqual(stored().rpgStandard, { ...STANDARD_FORMULA }, 'started from the numbers in force');
    assert.equal(stored().rpgCustom, undefined, 'Classic\'s Custom numbers are not touched');
    const input = key => card('difficulty').querySelector(`[data-rule="${key}"]`);
    typeInto(input('foeBase'), '9');
    typeInto(input('quickStartMargin'), '99');
    typeInto(input('pointsPerSoul'), '-4');
    typeInto(input('startStat'), 'many');
    await settle();
    assert.deepEqual([stored().rpgStandard.foeBase, stored().rpgStandard.quickStartMargin, stored().rpgStandard.pointsPerSoul, stored().rpgStandard.startStat], [9, 30, 0, 5]);
    assert.equal(input('quickStartMargin').value, '30', 'held to its range');
    assert.deepEqual(rulesFromSettings(stored()).foeBase, 9);
    assert.equal(card('formula').querySelectorAll('.rpg-formula-num b')[3].textContent, '9 + 3×class');
    assert.equal(root.querySelectorAll('[data-rule]').length, 13);
});

test('the Combat text is the Standard one for a Standard chat (reset, and the block a Standard chat is given); Classic keeps its own', async t => {
    const { card, host } = await open(t);
    assert.equal(combatBlock(host.head(), {})?.prompt !== COMBAT_DEFAULT_STANDARD, true);
    card('combat').querySelector('[data-act="combat-reset"]').click();
    await settle(); await settle();
    assert.equal(combatBlock(host.head(), {})?.prompt, COMBAT_DEFAULT_STANDARD);
    assert.ok([...COMBAT_DEFAULT_STANDARD].length <= COMBAT_MAX, 'fits the 1200 characters a block may hold');
    assert.match(COMBAT_DEFAULT_STANDARD, /attacks, spells, defence, talk and checks each pair a main stat with half of a second one/);
    assert.match(COMBAT_DEFAULT_STANDARD, /code moves Health for rolled hits and heals: never set those/);
    assert.equal(combatDefault('classic'), COMBAT_DEFAULT);
    assert.equal(combatDefault('standard'), COMBAT_DEFAULT_STANDARD);
    assert.equal(combatTemplate(LEAN_RPG_TEMPLATES, 'standard').prompt, COMBAT_PROMPT_STANDARD);
    assert.equal(combatTemplate(LEAN_RPG_TEMPLATES, 'standard').stateVersion, 2, 'the Standard template');
    assert.notEqual(combatTemplate(LEAN_RPG_TEMPLATES, 'classic').prompt, COMBAT_PROMPT_STANDARD);
    assert.equal(combatTemplate(LEAN_RPG_TEMPLATES).prompt, combatTemplate(LEAN_RPG_TEMPLATES, 'classic').prompt, 'Classic unless asked');
});

test('the planner\'s full prompt on the page is the formula\'s own', async t => {
    const standard = await open(t);
    const pre = card => card('planner').querySelector('.rpg-set-pre').textContent;
    assert.ok(pre(standard.card).startsWith(PRECALL_HEAD_STANDARD));
    assert.match(pre(standard.card), /Wessel \(class II\): STR 10 VIT 10 AGI 10 DEX 6 INT 5 LUK 10 CHA 10; Health /);
    const classic = await open(t, { formula: 'classic' });
    assert.ok(pre(classic.card).startsWith(PRECALL_HEAD));
});

test('the settings give Standard\'s numbers for the formula in force and Classic\'s for Classic; the odds view is the formula\'s', () => {
    const values = { [DIFFICULTY_SETTING]: 'harsh' };
    assert.equal(formulaOf(values), 'standard');
    assert.deepEqual(customOf(values), STANDARD_PRESETS.harsh);
    assert.deepEqual(customOf({ ...values, [STANDARD_SETTING]: { foeBase: 11 } }), { ...STANDARD_FORMULA, foeBase: 11 });
    assert.deepEqual(customOf({ ...values, [FORMULA_SETTING]: 'classic', [CUSTOM_SETTING]: { foeBase: 12 } }).foeBase, 12);
    const wessel = { definition: { ...characterDefinition('wessel', 'Wessel'), role: 'character' }, fields: { who: 'Wessel', str: 12, dex: 10, soul: 1 } };
    const skills = { definition: { ...skillsDefinition('wessel-skills', 'Wessel'), role: 'skills' }, fields: { who: 'Wessel', skill1: 'Iron Breath', rank1: 1 } };
    const view = oddsView(fakeState([wessel, skills]), 'Wessel', STANDARD_FORMULA);
    assert.equal(view.label.startsWith('Wessel (STR 12 with DEX 10, Soul Class I, Adept)'), true);
    assert.deepEqual(view.compare.map(item => item.name), ['gentle', 'harsh']);
    assert.equal(oddsView(fakeState([wessel]), 'Wessel', STANDARD_FORMULA).label, 'Wessel (STR 12 with DEX 10, Soul Class I, no skill) against a Class I foe');
});

// ---- the bar line, creation and companions ----------------------------------------------------------------------------------

test('growth (blocks.js, the one line the Party card, the wizard and Spend points share): a block every 5 points of VIT, AGI and INT, luck steps at 8, 13, 16 and 19', () => {
    const text = (stats, max) => growthText(growthOf(stats, { statMax: max }));
    const stats = { str: 5, vit: 10, agi: 14, dex: 5, int: 5, luk: 12, cha: 5 };
    assert.equal(text(stats), 'Health 6 blocks (VIT 10, next at 15) · Stamina 5 (AGI 14, next at 15) · Mana 4 (INT 5, next at 10) · Luck 0 (next at LUK 13)');
    const start = Object.fromEntries(STATS.map(stat => [stat, 5]));
    assert.equal(text(start), 'Health 5 blocks (VIT 5, next at 10) · Stamina 4 (AGI 5, next at 10) · Mana 4 (INT 5, next at 10) · Luck −1 (next at LUK 8)');
    assert.equal(text({ ...start, vit: 20, luk: 19 }), 'Health 8 blocks (VIT 20) · Stamina 4 (AGI 5, next at 10) · Mana 4 (INT 5, next at 10) · Luck +3');
    assert.deepEqual([5, 7, 8, 12, 13, 15, 16, 18, 19, 20].map(luk => growthOf({ ...start, luk }).luck.next), [8, 8, 13, 13, 16, 16, 19, 19, null, null]);
    assert.equal(growthOf({ ...start, vit: 15 }, { statMax: 15 }).health.next, null, 'the stat maximum caps it');
});

test('creation under Standard: stats start at 5, 10 points, 3 to 10; Classic\'s draft is exactly as it was', () => {
    const draft = newDraft({ persona: 'Tamsin', rules: STANDARD_FORMULA });
    assert.deepEqual(draft.stats, Object.fromEntries(STATS.map(stat => [stat, 5])));
    assert.equal(draft.creation.standard, true);
    assert.equal(pointsLeft(draft), 10);
    assert.deepEqual([statBounds(draft, 'str'), pointsLeft({ ...draft, stats: { ...draft.stats, str: 10, dex: 10 } })], [[3, 10], 0]);
    assert.equal(pointsLeft({ ...draft, stats: { ...draft.stats, str: 3, vit: 3 } }), 14, 'down to 3 frees a point a step');
    const whole = readDraft({ ...draft, stats: { ...draft.stats, str: 99, vit: 1 } });
    assert.deepEqual([whole.stats.str, whole.stats.vit], [10, 3], 'held to the creation range');
    assert.deepEqual(startStats(draft), draft.stats);
    // The numbers come from the rules in force; a damaged `creation` is dropped.
    const custom = newDraft({ rules: { ...STANDARD_FORMULA, startStat: 6, createPoints: 8, createMin: 4, createMax: 9 } });
    assert.deepEqual([custom.stats.str, pointsLeft(custom), statBounds(custom, 'str')], [6, 8, [4, 9]]);
    assert.equal('creation' in readDraft({ ...draft, creation: { ...draft.creation, start: 'x' } }), false);
    assert.equal('creation' in newDraft({ persona: 'x' }), false, 'Classic has none');
    assert.equal('creation' in readDraft(newDraft({ persona: 'x', rules: { foeBase: 5 } })), false);
    assert.equal(creationOf(STANDARD_FORMULA).statMax, 20);
});

test('a new Standard character starts with its bars full: Health, Stamina and Mana at what its stats give, within what the block holds', () => {
    const draft = { ...newDraft({ persona: 'Tamsin', rules: STANDARD_FORMULA }), name: 'Tamsin' };
    const stats = { ...draft.stats, vit: 10, agi: 10, int: 10, str: 8 };
    const { character } = buildDefinitions({ ...draft, stats }, { used: [] });
    const blocks = blocksFor(stats);
    // (Classic's stock fields hold at most 5, 4 and 4 stages; a Standard template's hold 8, 7 and 7. Either way the default fits the field.)
    for (const key of ['health', 'stamina', 'mana']) assert.equal(character.state[key].default, Math.min(blocks[key], character.state[key].max), key);
    const classic = buildDefinitions({ ...newDraft({ persona: 'Tamsin' }), name: 'Tamsin' }, { used: [] }).character;
    assert.deepEqual([classic.state.health.default, classic.state.mana.default, classic.state.stamina.default], [5, 4, 4], 'Classic: as before');
});

test('a companion the story adds on the Standard scale: every stat 5, the best 9, then the points of each Soul Class; Classic\'s 10 and 14 as before', () => {
    const request = { name: 'Mara', about: 'a hedge-witch', soul: 3, best: 'int' };
    const draft = joinDraft(request, STANDARD_FORMULA);
    assert.deepEqual(draft.stats, companionStats('int', 3, STANDARD_FORMULA));
    assert.equal(draft.stats.int > 9 && draft.stats.dex > 5, true);
    assert.equal(pointsLeft(draft), 0, 'what they cost is their budget');
    assert.equal(draft.soul, 3);
    const made = joinDefinitions(request, { used: [], soul: 3, rules: STANDARD_FORMULA });
    assert.deepEqual(STATS.map(stat => made.character.state[stat].default), STATS.map(stat => draft.stats[stat]));
    assert.equal(made.character.state.points.default, 0);
    assert.equal(made.character.state.soul.default, 3);
    const classic = joinDefinitions(request, { used: [], soul: 3 });
    assert.deepEqual(STATS.map(stat => classic.character.state[stat].default), [10, 10, 10, 10, 14, 10, 10]);
    assert.deepEqual(joinDraft(request).stats, joinDraft(request, { foeBase: 5 }).stats, 'rules with no formula are Classic');
});

// ---- the wizard's Stats step, on the real page ------------------------------------------------------------------------------

test('Stats under Standard: steppers from 5, 10 points to spend, 3 to 10, and the bar line follows them', async t => {
    const ctx = await page(t, { persona: 'Wessel', formula: 'standard' });
    await begin(ctx.host);
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    party(ctx.doc).querySelector('.rpg-create').click();
    await settle();
    const dialog = ctx.ui.mounts.dialog.current();
    dialog.goTo(1);
    await settle();
    const root = () => dialog.root.querySelector('.ss-w-rpg-wizard');
    const step = (stat, dir) => root().querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-${dir}`);
    assert.equal(root().querySelector('.rpg-wiz-push').textContent, 'Points left: 10');
    assert.match(root().querySelector('.rpg-wiz-sum').textContent, /STR 5 · VIT 5 · AGI 5 · DEX 5 · INT 5 · LUK 5 · CHA 5/);
    assert.match(root().textContent, /Every stat starts at 5\. Spend 10 points; a stat can go down to 3 to free a point and up to 10 now\. Each Soul Class rise gives 4 more, and XP rises on its own\./);
    const line = () => root().querySelector('[data-wiz="growth"]').textContent;
    assert.equal(line(), 'Health 5 blocks (VIT 5, next at 10) · Stamina 4 (AGI 5, next at 10) · Mana 4 (INT 5, next at 10) · Luck −1 (next at LUK 8)');
    for (let n = 0; n < 5; n += 1) step('vit', 'inc').click();
    assert.equal(step('vit', 'inc').disabled, true, 'VIT stops at 10');
    assert.equal(line(), 'Health 6 blocks (VIT 10, next at 15) · Stamina 4 (AGI 5, next at 10) · Mana 4 (INT 5, next at 10) · Luck −1 (next at LUK 8)');
    assert.equal(root().querySelector('.rpg-wiz-push').textContent, 'Points left: 5');
    for (let n = 0; n < 3; n += 1) step('luk', 'inc').click();
    assert.match(line(), /Luck 0 \(next at LUK 13\)$/);
    assert.equal(root().querySelector('.rpg-wiz-push').textContent, 'Points left: 2');
    step('str', 'dec').click(); step('str', 'dec').click(); step('str', 'dec').click();
    assert.equal(step('str', 'dec').disabled, true, 'nothing goes below 3');
    assert.equal(root().querySelector('.rpg-wiz-push').textContent, 'Points left: 4', 'STR 3 frees two');
    dialog.close();
});

test('Create under Standard writes the stats and full bars as the new blocks\' defaults; under Classic nothing changed', async t => {
    const ctx = await page(t, { persona: 'Wessel', formula: 'standard' });
    await begin(ctx.host);
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    party(ctx.doc).querySelector('.rpg-create').click();
    await settle();
    const dialog = ctx.ui.mounts.dialog.current();
    const root = () => dialog.root.querySelector('.ss-w-rpg-wizard');
    root().querySelector('[data-wiz="about"]').value = 'A ferry hand.';
    root().querySelector('[data-wiz="about"]').dispatch('input');
    dialog.goTo(1);
    await settle();
    for (let n = 0; n < 5; n += 1) root().querySelector('.rpg-stat-step[data-stat="vit"] .ss-w-stepper-inc').click();
    for (let n = 0; n < 5; n += 1) root().querySelector('.rpg-stat-step[data-stat="str"] .ss-w-stepper-inc').click();
    dialog.goTo(3);
    await settle();
    const create = root().querySelectorAll('button').find(node => /^Create/.test(node.textContent));
    create.click();
    await settle(); await settle();
    const fields = ctx.host.sdk.query('dataModules.view', { module: 'pack.chat/wessel' }).chat;
    assert.deepEqual([fields.str, fields.vit, fields.agi, fields.points], [10, 10, 5, 0]);
    // A Standard chat is made from the Standard templates: Health is 4 + VIT/5 = 6 blocks, full, and the hidden size fields start there too.
    assert.deepEqual([fields.health, fields['health-blocks'], fields.stamina, fields['stamina-blocks'], fields.mana, fields['mana-blocks']], [6, 6, 4, 4, 4, 4]);
    const definition = ctx.host.head().domains.dataModules.pins[ctx.host.head().domains.dataModules.active['pack.chat/wessel'].hash].definition;
    assert.equal(definition.state.health.blocks, 'health', 'the Standard Character block');
});

// ---- Spend points and the Skills view ----------------------------------------------------------------------------------------

import { setupDom } from '../../view/mounts/helpers.js';
import { renderDistribute } from '../../../../src/v2/lean-rpg/view/distribute.js';
import { renderSkills, rollOf } from '../../../../src/v2/lean-rpg/view/skills.js';
import { readParty } from '../../../../src/v2/lean-rpg/view/party-data.js';
import { FORMULA } from '../../../../src/v2/lean-rpg/names.js';

const hero = (fields = {}) => ({ definition: characterDefinition('wessel', 'Wessel'), fields: { who: 'Wessel', str: 10, vit: 9, agi: 10, dex: 6, int: 5, luk: 7, cha: 5, points: 4, soul: 2, xp: 40, health: 3, mana: 4, stamina: 1, ...fields } });
const heroSkills = () => ({ definition: { ...skillsDefinition('wessel-skills', 'Wessel'), role: 'skills' }, fields: { who: 'Wessel', skill1: 'Iaijutsu', stat1: 'agi', uses1: 'stamina', rank1: 2, skill2: 'Spark', stat2: 'int', uses2: 'mana', rank2: 0 } });
const stepIn = (root, stat, dir) => root.querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-${dir}`);

test('Spend points under Standard adds the line of what the next points buy, and it follows the steppers; Classic has none', () => {
    const doc = setupDom(), host = doc.createElement('div');
    doc.body.appendChild(host);
    const state = fakeState([hero()]);
    const handle = renderDistribute(host, { character: readParty(state, { own: 'Wessel', roleOf })[0], doc, rules: () => STANDARD_FORMULA });
    const root = host.querySelector('.rpg-sheet'), line = () => root.querySelector('[data-rpg="growth"]').textContent;
    assert.equal(line(), 'Health 5 blocks (VIT 9, next at 10) · Stamina 5 (AGI 10, next at 15) · Mana 4 (INT 5, next at 10) · Luck −1 (next at LUK 8)');
    stepIn(root, 'vit', 'inc').click();
    stepIn(root, 'luk', 'inc').click();
    assert.equal(line(), 'Health 6 blocks (VIT 10, next at 15) · Stamina 5 (AGI 10, next at 15) · Mana 4 (INT 5, next at 10) · Luck 0 (next at LUK 13)');
    handle.reset();
    assert.match(line(), /^Health 5 blocks/);
    handle.destroy();
    const classic = renderDistribute(host, { character: readParty(state, { own: 'Wessel', roleOf })[0], doc });
    assert.equal(host.querySelector('[data-rpg="growth"]'), null);
    const withRules = renderDistribute(host, { character: readParty(state, { own: 'Wessel', roleOf })[0], doc, rules: () => ({ foeBase: 5 }) });
    assert.equal(host.querySelectorAll('[data-rpg="growth"]').length, 0, 'rules with no formula are Classic');
    classic.destroy(); withRules.destroy();
});

test('the roll a skill shows under Standard is the pair: the skill\'s stat with half of DEX, halved, plus rank and Soul Class', () => {
    const state = fakeState([hero(), heroSkills()]);
    const wessel = readParty(state, { own: 'Wessel', roleOf })[0];
    const [iaijutsu, spark] = wessel.skills;
    // AGI 10 and DEX 6: (10 + 3)/2 = 6 → +6; Expert +2; Soul Class II +4: d20 +12. Spark: (INT 5 + DEX 3)/2 = 4, Novice 0, +4: d20 +8.
    assert.deepEqual(rollOf(iaijutsu, wessel, STANDARD_FORMULA), { total: 12, stat: 'AGI', value: 10, half: 6, rank: 2, bonus: 4, second: 'DEX', secondValue: 6 });
    assert.equal(rollOf(spark, wessel, STANDARD_FORMULA).total, 8);
    assert.equal(rollOf(iaijutsu, wessel, FORMULA).second, undefined, 'Classic has no second stat');
    const doc = setupDom(), host = doc.createElement('div');
    doc.body.appendChild(host);
    const view = renderSkills(host, { character: wessel, doc, rules: () => STANDARD_FORMULA });
    const lines = host.querySelectorAll('.rpg-skill-roll').map(node => node.textContent);
    assert.equal(lines[0], 'Rolls with it: d20 +12 = (AGI 10 + DEX 6/2)/2 → +6 · Expert +2 · Soul Class II +4');
    assert.equal(lines[1], 'Rolls with it: d20 +8 = (INT 5 + DEX 6/2)/2 → +4 · Novice +0 · Soul Class II +4');
    view.destroy?.();
});
