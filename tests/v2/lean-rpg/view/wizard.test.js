// The New character wizard (src/v2/lean-rpg/view/wizard.js and wizard-data.js, mockup 41-wizard): the draft and its budget, the skill rules,
// the skill sets, the two definitions Create makes, and the dialog on the real page: steps, stats, skills, review, Create as two
// defines, rollback, one You, and live = reload = rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDataModules } from '../../../../src/v2/data-modules/check.js';
import { CREATION, STATS } from '../../../../src/v2/lean-rpg/index.js';
import { LEAN_RPG_TEMPLATES, SKILL_SETS } from '../../../../src/v2/lean-rpg/templates.js';
import { createWizardScreen, WIZARD_SCREEN_ID, WIZARD_WIDGET } from '../../../../src/v2/lean-rpg/view/wizard.js';
import { adeptCount, blockNames, buildDefinitions, hasRoom, mayStartAdept, newDraft, pointsLeft, problemsOf, readDraft, setLine, skillSetsOf, statsLine, withSet, withSkill,
    withSkillPatch, withoutSkill } from '../../../../src/v2/lean-rpg/view/wizard-data.js';
import { reload } from '../../data-modules/helpers.js';
import { begin, fieldsOf, makeBlocks, page, party, settle } from './page.js';

const PACK = JSON.parse(readFileSync(new URL('../fixtures/skill-sets-pack.json', import.meta.url), 'utf8'));
const CHECK = { packId: 'chat', capabilities: ['data-modules-v1', 'story-director'] };
const FIGHTER = SKILL_SETS[0];

// ---- the data: draft, budget, skills, sets, problems, definitions --------------------------------------------------------------

test('a new draft: the persona\'s name, You unless there is one already, every stat at 10 and 6 points to spend', () => {
    assert.deepEqual(newDraft({ persona: 'Wessel' }), { name: 'Wessel', kind: 'you', about: '', stats: Object.fromEntries(STATS.map(stat => [stat, 10])), skills: [], set: '' });
    assert.equal(newDraft({ persona: 'Wessel', hasYou: true }).kind, 'companion');
    assert.equal(newDraft().name, '');
    assert.equal(pointsLeft(newDraft()), 6);
});

test('the budget: a stat above 10 costs a point a step, below it gives one back, 8 to 15, and a draft is made whole when read', () => {
    const draft = newDraft({ persona: 'Wessel' });
    assert.equal(pointsLeft({ ...draft, stats: { ...draft.stats, str: 14, vit: 12 } }), 0, '+4 and +2');
    assert.equal(pointsLeft({ ...draft, stats: { ...draft.stats, str: 15, vit: 8, agi: 8 } }), 6 - 5 + 2 + 2, 'two stats at 8 free four points');
    const odd = readDraft({ name: `  ${'x'.repeat(60)}  `, kind: 'boss', about: 'y'.repeat(300), stats: { str: 99, vit: 1, agi: 12.5, dex: 'ten' }, skills: 'many', set: 7 });
    assert.deepEqual([odd.name.length, odd.kind, odd.about.length, odd.set], [40, 'you', 240, '']);
    assert.deepEqual([odd.stats.str, odd.stats.vit, odd.stats.agi, odd.stats.dex, odd.stats.luk], [15, 8, 10, 10, 10], 'clamped to 8 to 15, a bad value is the start');
    assert.deepEqual(odd.skills, []);
    assert.deepEqual(readDraft(null).stats, newDraft().stats);
    assert.equal(statsLine(newDraft()), 'STR 10 · VIT 10 · AGI 10 · DEX 10 · INT 10 · LUK 10 · CHA 10');
});

test('at most five skills and at most one at Adept, however the draft got there', () => {
    let draft = newDraft({ persona: 'Wessel' });
    for (let n = 0; n < 8; n += 1) draft = withSkill(draft);
    assert.equal(draft.skills.length, 5, 'add stops at five');
    draft = withSkillPatch(draft, 0, { start: 1 });
    assert.deepEqual([adeptCount(draft), draft.skills[0].start, mayStartAdept(draft, 0), mayStartAdept(draft, 1)], [1, 1, true, false]);
    draft = withSkillPatch(draft, 1, { start: 1 });
    assert.deepEqual(draft.skills.map(skill => skill.start), [1, 0, 0, 0, 0], 'a second Adept is refused');
    draft = withSkillPatch(draft, 0, { start: 0 });
    draft = withSkillPatch(draft, 1, { start: 1 });
    assert.deepEqual(draft.skills.map(skill => skill.start), [0, 1, 0, 0, 0], 'it moves once the first lets go');
    assert.equal(adeptCount(withoutSkill(draft, 1)), 0);
    const forced = readDraft({ skills: Array.from({ length: 7 }, (_, n) => ({ name: `S${n}`, about: 'a', stat: 'str', uses: 'mana', start: 1 })) });
    assert.deepEqual([forced.skills.length, adeptCount(forced), forced.skills[0].uses], [5, 1, 'mana'], 'a hand-made draft is made whole');
    assert.deepEqual(withSkillPatch(draft, 9, { name: 'x' }), draft, 'no such skill: nothing changes');
});

test('a skill set puts its skills in at Novice, up to five, and remembers which it was', () => {
    const draft = withSet(newDraft({ persona: 'Wessel' }), FIGHTER);
    assert.deepEqual(draft.skills.map(skill => [skill.name, skill.stat, skill.uses, skill.start]), [['Short blade', 'agi', 'stamina', 0], ['Iron Breath', 'vit', 'stamina', 0], ['Shield work', 'str', 'stamina', 0]]);
    assert.equal(draft.set, 'guild-fighter');
    const big = withSet(draft, { id: 'big', skills: Array.from({ length: 9 }, (_, n) => ({ name: `S${n}`, about: 'a', stat: 'int', uses: 'mana' })) });
    assert.equal(big.skills.length, 5);
    assert.equal(setLine(SKILL_SETS[2]), 'Spark (INT, mana) · Ward (INT, mana) · Lore (INT)');
});

test('the sets on offer: the five built in, then each pack\'s, with where they are from', () => {
    const alone = skillSetsOf();
    assert.deepEqual(alone.map(set => [set.name, set.source]), SKILL_SETS.map(set => [set.name, 'Built in']));
    const sets = skillSetsOf({ packSets: [{ id: 'pack.ersveil/seal', pack: 'ersveil', slug: 'seal', name: 'Sealwarden recruit', about: 'Ersveil.', skills: [{ name: 'Spear', about: 'a', stat: 'str', uses: 'stamina' }] }, { nonsense: true }], packNames: { ersveil: 'Ersveil' } });
    assert.equal(sets.length, 6);
    assert.deepEqual([sets[5].id, sets[5].name, sets[5].source, sets[5].builtIn], ['pack.ersveil/seal', 'Sealwarden recruit', 'From the Ersveil pack', false]);
    assert.equal(skillSetsOf({ packSets: [{ id: 'x', pack: 'p', name: 'N', skills: [] }] }).at(-1).source, 'From the p pack', 'no name known: the pack id');
});

test('what holds Create up, in plain words', () => {
    const ok = { ...newDraft({ persona: 'Wessel' }), skills: [{ name: 'Spark', about: 'A burst.', stat: 'int', uses: 'mana', start: 0 }] };
    const world = { persona: 'Wessel', names: ['Ren'], room: true, hasYou: false };
    assert.deepEqual(problemsOf(ok, world), []);
    assert.deepEqual(problemsOf({ ...ok, name: '' }, world), ['Give the character a name.']);
    assert.deepEqual(problemsOf({ ...ok, name: 'REN', kind: 'companion' }, world), ['A character called REN is already in this story.'], 'the same name, folded');
    assert.deepEqual(problemsOf({ ...ok, skills: [{ ...ok.skills[0], name: '' }] }, world), ['Every skill needs a name.']);
    assert.deepEqual(problemsOf({ ...ok, skills: [ok.skills[0], { ...ok.skills[0], name: 'spark' }] }, world), ['Two skills are called spark.']);
    assert.deepEqual(problemsOf({ ...ok, skills: [{ ...ok.skills[0], about: '' }] }, world), ['Spark needs a line about what it does.']);
    assert.deepEqual(problemsOf(ok, { ...world, room: false }), ['This story has no room for two more blocks (at most 8). Remove one from Blocks first.']);
    assert.deepEqual(problemsOf(ok, { ...world, hasYou: true }), ['You already have a character in this story.']);
    assert.match(problemsOf({ ...ok, name: 'Wess' }, world)[0], /You are shown as the character named like your persona \(Wessel\)/);
    assert.match(problemsOf({ ...ok, kind: 'companion' }, world)[0], /A companion cannot have your persona's name \(Wessel\)/);
    assert.deepEqual(problemsOf({ ...ok, name: 'Wess' }, { ...world, persona: '' }), [], 'no persona name known: nothing to hold the name to');
});

test('Create\'s two definitions come from the templates with the wizard\'s values as the field defaults, and the checker takes both', () => {
    const base = withSet(newDraft({ persona: 'Wessel' }), FIGHTER);
    const draft = { ...base, about: 'A drill-yard washout.', stats: { ...base.stats, str: 14, vit: 12, agi: 11, int: 8 }, skills: base.skills.map((skill, at) => (at === 0 ? { ...skill, start: 1 } : skill)) };
    assert.equal(pointsLeft(draft), 6 - 4 - 2 - 1 + 2, 'STR +4, VIT +2, AGI +1, INT -2');
    const { character, skills } = buildDefinitions(draft, { used: [] });
    assert.deepEqual([character.slug, character.name, character.role, skills.slug, skills.name, skills.role], ['wessel', 'Wessel', 'character', 'wessel-skills', 'Wessel\'s skills', 'skills']);
    assert.deepEqual(blockNames('Wessel'), { character: 'Wessel', skills: 'Wessel\'s skills' });
    const state = character.state;
    assert.deepEqual([state.who.default, state.about.default, state.str.default, state.vit.default, state.agi.default, state.dex.default, state.int.default], ['Wessel', 'A drill-yard washout.', 14, 12, 11, 10, 8]);
    assert.deepEqual([state.points.default, state.soul.default, state.xp.default, state.health.default, state.mana.default, state.stamina.default, state.alive.default], [1, 1, 0, 5, 4, 4, true], 'full bars, Soul I, 0 XP and the unspent point');
    const sk = skills.state;
    assert.deepEqual([sk.who.default, sk.skill1.default, sk.about1.default, sk.stat1.default, sk.uses1.default, sk.rank1.default, sk.practice1.default], ['Wessel', 'Short blade', FIGHTER.skills[0].about, 'agi', 'stamina', 1, 0], 'the Adept one starts at rank 1');
    assert.deepEqual([sk.rank2.default, sk.rank3.default, sk.skill4.default, sk.rank4.default], [0, 0, '', 0]);
    assert.equal(sk.rank1.edit, false, 'rank stays a field only play can move');
    assert.equal(sk.practice1.edit, false);
    for (const definition of [character, skills]) {
        const checked = validateDataModules([definition], CHECK);
        assert.equal(checked.ok, true, `${definition.slug}: ${JSON.stringify(checked.errors)}`);
    }
    // The templates themselves are untouched, and a second character gets slugs of its own.
    assert.equal(LEAN_RPG_TEMPLATES[0].definition.state.who.default, '');
    const second = buildDefinitions({ ...draft, name: 'Wessel' }, { used: ['pack.chat/wessel', 'pack.chat/wessel-skills'] });
    assert.deepEqual([second.character.slug, second.skills.slug], ['wessel-2', 'wessel-skills-2']);
    assert.deepEqual([second.character.name, second.skills.name], ['Wessel', 'Wessel\'s skills']);
});

test('room for two more blocks: a story holds at most eight of its own', () => {
    const state = count => ({ domains: { dataModules: { active: Object.fromEntries(Array.from({ length: count }, (_, n) => [`pack.chat/b${n}`, { hash: `h${n}` }])), pins: Object.fromEntries(Array.from({ length: count }, (_, n) => [`h${n}`, { packId: 'chat' }])) } } });
    assert.equal(hasRoom(state(6)), true);
    assert.equal(hasRoom(state(7)), false);
    assert.equal(hasRoom(null), true, 'no story yet');
});

test('the screen: a wide dialog with four steps, Who, Stats, Skills, Review, each the wizard widget', () => {
    const screen = createWizardScreen();
    assert.equal(screen.id, WIZARD_SCREEN_ID);
    assert.deepEqual([screen.mounts, screen.width, screen.title], [['dialog'], 'wide', 'New character']);
    assert.deepEqual(screen.steps.map(step => [step.id, step.title]), [['who', 'Who'], ['stats', 'Stats'], ['skills', 'Skills'], ['review', 'Review']]);
    for (const step of screen.steps) assert.match(step.template, new RegExp(`name="${WIZARD_WIDGET}" data-props='\\{"step":"${step.id}"\\}'`));
    assert.equal(WIZARD_WIDGET, 'rpg.wizard');
});

// ---- the dialog on the real page -------------------------------------------------------------------------------------------------

const wizardOf = dialog => dialog.root.querySelector('.ss-w-rpg-wizard');
const click = (root, text) => root.querySelectorAll('button').find(node => node.textContent === text)?.click();
const type = (node, value) => { node.value = value; node.dispatch('input'); };
async function openFrom(ctx, { empty = false } = {}) {
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    party(ctx.doc).querySelector(empty ? '.rpg-create' : '.rpg-new').click();
    await settle();
    return ctx.ui.mounts.dialog.current();
}
const goTo = async (dialog, step) => { dialog.goTo(['who', 'stats', 'skills', 'review'].indexOf(step)); await settle(); return wizardOf(dialog); };
const names = host => Object.keys(host.head().domains.dataModules?.active ?? {}).sort();

test('"Create your character" in the empty state and "+ New character" in the header both open the wide dialog', async t => {
    const empty = await page(t, { persona: 'Wessel' });
    await begin(empty.host);
    const first = await openFrom(empty, { empty: true });
    assert.ok(first, 'the empty state has the button');
    assert.equal(first.screenId, WIZARD_SCREEN_ID);
    assert.ok(first.root.classList.contains('ss-dialog-wide'));
    assert.equal(first.root.querySelector('.ss-dialog-title').textContent, 'New character');
    assert.deepEqual(first.root.querySelectorAll('.ss-dialog-step').map(node => node.textContent), ['Who', 'Stats', 'Skills', 'Review']);
    assert.equal(first.root.querySelector('.ss-dialog-step[aria-current="step"]').textContent, 'Who');
    assert.ok(!party(empty.doc).querySelector('.rpg-new'), 'no header button while there is nobody (the empty state has its own)');
    first.close();

    const some = await page(t, { persona: 'Wessel' });
    await begin(some.host);
    await makeBlocks(some.host, { who: 'Ren' });
    await some.host.send('Go.', 'The quay.');
    const second = await openFrom(some);
    assert.ok(second, '"+ New character" in the header');
    assert.equal(party(some.doc).querySelector('.rpg-new').textContent, '+ New character');
    second.close();
    assert.equal(some.ui.mounts.dialog.current(), null);
});

test('Who: the persona\'s name, You or A companion, who they are with its count; Back and Next keep what was typed', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    const dialog = await openFrom(ctx, { empty: true });
    const who = wizardOf(dialog);
    assert.equal(who.querySelector('[data-wiz="name"]').value, 'Wessel');
    assert.match(who.textContent, /From your persona\. You can change it here\./);
    assert.deepEqual(who.querySelectorAll('.rpg-wiz-seg button').map(node => [node.textContent, node.getAttribute('aria-pressed')]), [['You', 'true'], ['A companion', 'false']]);
    assert.equal(who.querySelector('.rpg-wiz-sum .rpg-wiz-name').textContent, 'Wessel');
    assert.match(who.querySelector('.rpg-wiz-sub').textContent, /^You · Soul Class I$/);
    assert.equal(who.querySelector('.rpg-wiz-push').textContent, 'Points left: 6');
    const about = who.querySelector('[data-wiz="about"]');
    assert.equal(about.getAttribute('maxlength'), '240');
    type(about, 'A drill-yard washout from Bluewatch.');
    assert.equal(who.querySelector('.rpg-wiz-count').textContent, '36 / 240');
    type(who.querySelector('[data-wiz="name"]'), 'Wess');
    assert.equal(who.querySelector('.rpg-wiz-sum .rpg-wiz-name').textContent, 'Wess', 'the summary row follows');
    const stats = await goTo(dialog, 'stats');
    assert.ok(stats);
    const again = await goTo(dialog, 'who');
    assert.equal(again.querySelector('[data-wiz="name"]').value, 'Wess');
    assert.equal(again.querySelector('[data-wiz="about"]').value, 'A drill-yard washout from Bluewatch.');
    click(again, 'A companion');
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-sub').textContent, 'Companion · Soul Class I');
    assert.equal(wizardOf(dialog).querySelector('[data-wiz="name"]').value, 'Wess');
    click(wizardOf(dialog), 'You');
    assert.equal(wizardOf(dialog).querySelector('[data-wiz="name"]').value, 'Wessel', 'You takes the persona\'s name');
    dialog.close();
});

test('Stats: steppers under 6 points, a stat down to 8 frees a point and up to 15, with the radar and the summary row following', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    const dialog = await openFrom(ctx, { empty: true });
    let stats = await goTo(dialog, 'stats');
    const step = (stat, dir) => wizardOf(dialog).querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-${dir}`);
    const value = stat => wizardOf(dialog).querySelector(`.rpg-stat-step[data-stat="${stat}"] input`)?.value ?? wizardOf(dialog).querySelector(`.rpg-stat-step[data-stat="${stat}"]`).textContent;
    assert.deepEqual(stats.querySelectorAll('.rpg-stat-step').map(node => node.getAttribute('data-stat')), [...STATS]);
    assert.ok(stats.querySelector('.rpg-radar .ss-w-radar'), 'the radar');
    for (let n = 0; n < 5; n += 1) step('str', 'inc').click();
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 1');
    assert.match(wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent, /STR 15/, 'the summary row');
    assert.equal(step('str', 'inc').disabled, true, 'STR stops at 15');
    assert.equal(step('vit', 'inc').disabled, false, 'one point left');
    step('vit', 'inc').click();
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 0');
    assert.equal(step('agi', 'inc').disabled, true, 'no points left');
    step('dex', 'dec').click();
    step('dex', 'dec').click();
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 2', 'DEX 8 frees two');
    assert.equal(step('dex', 'dec').disabled, true, 'nothing goes below 8');
    assert.match(wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent, /STR 15 · VIT 11 · AGI 10 · DEX 8/);
    // Back and forth keeps them; Reset puts every stat back at 10.
    stats = await goTo(dialog, 'skills');
    stats = await goTo(dialog, 'stats');
    assert.match(stats.querySelector('.rpg-wiz-sum').textContent, /STR 15 · VIT 11 · AGI 10 · DEX 8/);
    click(stats, 'Reset');
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 6');
    assert.match(wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent, /STR 10 · VIT 10 · AGI 10 · DEX 10/);
    assert.match(wizardOf(dialog).textContent, /Every stat starts at 10\. Spend 6 points; a stat can go down to 8 to free a point and up to 15 now\./);
    dialog.close();
});

test('Skills: the five built-in sets and a pack\'s, rows with Stat, Uses and Starts at, one Adept at most, up to five, remove, never a rank to type', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    assert.equal((await ctx.host.packs.packs.install(PACK)).ok, true);
    await begin(ctx.host);
    const dialog = await openFrom(ctx, { empty: true });
    let skills = await goTo(dialog, 'skills');
    const cards = () => wizardOf(dialog).querySelectorAll('.rpg-wiz-card');
    assert.deepEqual(cards().map(card => card.querySelector('b').textContent), ['Guild fighter', 'River scout', 'Hedge mage', 'Field medic', 'Silver tongue', 'Sealwarden recruit']);
    assert.deepEqual(cards().map(card => card.querySelector('.rpg-wiz-card-src').textContent), ['Built in', 'Built in', 'Built in', 'Built in', 'Built in', 'From the Ersveil pack']);
    assert.equal(cards()[2].querySelector('.rpg-wiz-card-skills').textContent, 'Spark (INT, mana) · Ward (INT, mana) · Lore (INT)');
    assert.equal(cards()[5].querySelector('.rpg-wiz-card-skills').textContent, 'Spear (STR) · Ward-reading (INT, mana) · Gatecraft (VIT)');
    assert.deepEqual(cards().map(card => card.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false', 'false', 'false']);
    assert.match(skills.textContent, /Up to 5 skills, each with what it does, the stat it rolls with and what it uses\. One may start at Adept, the rest are Novice\./);
    cards()[0].click();
    skills = wizardOf(dialog);
    assert.deepEqual(cards().map(card => card.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false', 'false']);
    assert.equal(cards()[0].querySelector('.rpg-wiz-tag').textContent, 'Used');
    const rows = () => wizardOf(dialog).querySelectorAll('.rpg-wiz-row[data-skill]');
    assert.equal(rows().length, 3);
    assert.deepEqual(rows().map(row => row.querySelector('[data-field="name"]').value), ['Short blade', 'Iron Breath', 'Shield work']);
    assert.equal(rows()[0].querySelector('[data-field="about"]').value, FIGHTER.skills[0].about);
    assert.deepEqual(rows().map(row => [row.querySelector('[data-field="stat"]').value, row.querySelector('[data-field="uses"]').value, row.querySelector('[data-field="start"]').value]),
        [['agi', 'stamina', '0'], ['vit', 'stamina', '0'], ['str', 'stamina', '0']]);
    assert.deepEqual(rows()[0].querySelector('[data-field="stat"]').querySelectorAll('option').map(node => node.textContent), ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA']);
    assert.deepEqual(rows()[0].querySelector('[data-field="uses"]').querySelectorAll('option').map(node => node.textContent), ['Stamina', 'Mana']);
    assert.deepEqual(rows()[0].querySelector('[data-field="start"]').querySelectorAll('option').map(node => node.textContent), ['Novice', 'Adept']);
    assert.equal(wizardOf(dialog).querySelectorAll('input, select, textarea').filter(node => /rank|practice/i.test(`${node.getAttribute('data-field')} ${node.getAttribute('aria-label')}`)).length, 0, 'rank and practice are never typed');
    // Edit a row, change its stat and resource: the summary row follows.
    type(rows()[0].querySelector('[data-field="name"]'), 'Blade work');
    rows()[1].querySelector('[data-field="stat"]').value = 'int';
    rows()[1].querySelector('[data-field="stat"]').dispatch('change');
    rows()[1].querySelector('[data-field="uses"]').value = 'mana';
    rows()[1].querySelector('[data-field="uses"]').dispatch('change');
    assert.match(wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent, /Blade work, Iron Breath, Shield work/);
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, '3 of 5 skills');
    // One Adept: the others' Adept option is off once one is taken.
    rows()[0].querySelector('[data-field="start"]').value = '1';
    rows()[0].querySelector('[data-field="start"]').dispatch('change');
    const adept = row => row.querySelector('[data-field="start"]').querySelectorAll('option').find(node => node.textContent === 'Adept');
    assert.deepEqual(rows().map(row => adept(row).hasAttribute('disabled')), [false, true, true], 'only the Adept one may keep Adept');
    assert.equal(rows()[0].querySelector('[data-field="start"]').value, '1');
    rows()[1].querySelector('[data-field="start"]').value = '1';
    rows()[1].querySelector('[data-field="start"]').dispatch('change');
    assert.deepEqual(rows().map(row => row.querySelector('[data-field="start"]').value), ['1', '0', '0'], 'a second Adept is refused');
    // Add up to five, then no more; remove frees the slot (and the Adept).
    click(wizardOf(dialog), '+ Add a skill');
    click(wizardOf(dialog), '+ Add a skill');
    assert.equal(rows().length, 5);
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-add-button').disabled, true);
    assert.match(wizardOf(dialog).querySelector('.rpg-wiz-add .rpg-wiz-note').textContent, /^All slots are used\./);
    rows()[0].querySelector('.rpg-wiz-x').click();
    assert.equal(rows().length, 4);
    assert.deepEqual(rows().map(row => adept(row).hasAttribute('disabled')), [false, false, false, false], 'the Adept one is gone: Adept is free again');
    assert.match(wizardOf(dialog).querySelector('.rpg-wiz-add .rpg-wiz-note').textContent, /^1 slot left\./);
    // A pack set replaces the rows.
    cards()[5].click();
    assert.deepEqual(rows().map(row => row.querySelector('[data-field="name"]').value), ['Spear', 'Ward-reading', 'Gatecraft']);
    assert.equal(rows()[1].querySelector('[data-field="uses"]').value, 'mana');
    assert.equal(cards()[5].querySelector('.rpg-wiz-tag').textContent, 'Used');
    dialog.close();
});

test('Review shows everything and what is in the way; Create waits for a name and for every skill to say what it does', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    const dialog = await openFrom(ctx, { empty: true });
    let skills = await goTo(dialog, 'skills');
    click(skills, '+ Add a skill');
    type(wizardOf(dialog).querySelector('.rpg-wiz-row[data-skill] [data-field="name"]'), 'Spark');
    let review = await goTo(dialog, 'review');
    assert.match(review.textContent, /Wessel · You/);
    assert.match(review.textContent, /Makes two blocks: "Wessel" and "Wessel's skills"\./);
    assert.match(review.textContent, /6 unspent points go to Spend points on the Party tab\./);
    assert.match(review.textContent, /Spark · STR · Stamina · starts at Novice/);
    const create = () => wizardOf(dialog).querySelector('.rpg-wiz-create');
    assert.equal(create().disabled, true);
    assert.deepEqual(wizardOf(dialog).querySelectorAll('.rpg-wiz-problems li').map(node => node.textContent), ['Fix this first:', 'Spark needs a line about what it does.']);
    skills = await goTo(dialog, 'skills');
    type(skills.querySelector('.rpg-wiz-row[data-skill] [data-field="about"]'), 'A small burst.');
    review = await goTo(dialog, 'review');
    assert.equal(create().disabled, false);
    assert.ok(wizardOf(dialog).querySelector('.rpg-wiz-problems').hidden);
    dialog.close();
});

test('Create makes the two blocks with one dm.define each, the wizard\'s values as defaults, and no dm.set; rank only moves through play', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    const { host, doc, ui } = ctx;
    assert.equal((await host.packs.packs.install(PACK)).ok, true);
    await begin(host);
    const before = names(host);
    const dialog = await openFrom(ctx, { empty: true });
    type(wizardOf(dialog).querySelector('[data-wiz="about"]'), 'A drill-yard washout from Bluewatch.');
    await goTo(dialog, 'stats');
    for (const [stat, times] of [['str', 4], ['vit', 2]]) for (let n = 0; n < times; n += 1) wizardOf(dialog).querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-inc`).click();
    await goTo(dialog, 'skills');
    wizardOf(dialog).querySelectorAll('.rpg-wiz-card')[0].click();
    const first = wizardOf(dialog).querySelector('.rpg-wiz-row[data-skill="0"] [data-field="start"]');
    first.value = '1';
    first.dispatch('change');
    await goTo(dialog, 'review');
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.equal(ui.mounts.dialog.current(), null, 'created: the dialog closes');
    assert.deepEqual(names(host), [...before, 'pack.chat/wessel', 'pack.chat/wessel-skills'].sort());
    const made = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type.startsWith('dm.'));
    assert.deepEqual(made.map(receipt => receipt.type), ['dm.define', 'dm.define'], 'two defines and nothing else: no dm.set');
    const character = fieldsOf(host, 'pack.chat/wessel'), skills = fieldsOf(host, 'pack.chat/wessel-skills');
    assert.deepEqual([character.who, character.about, character.str, character.vit, character.points, character.soul, character.xp, character.health, character.mana, character.stamina, character.alive],
        ['Wessel', 'A drill-yard washout from Bluewatch.', 14, 12, 0, 1, 0, 5, 4, 4, true]);
    assert.deepEqual([skills.who, skills.skill1, skills.stat1, skills.uses1, skills.rank1, skills.practice1, skills.skill2, skills.rank2, skills.skill4, skills.rank4],
        ['Wessel', 'Short blade', 'agi', 'stamina', 1, 0, 'Iron Breath', 0, '', 0]);
    const domain = host.head().domains.dataModules;
    const definition = domain.pins[domain.active['pack.chat/wessel-skills'].hash].definition;
    assert.equal(definition.role, 'skills');
    assert.equal(definition.state.rank1.edit, false);
    const refused = await host.sdk.command('dm.set', { module: 'pack.chat/wessel-skills', field: 'rank2', value: 3 });
    assert.equal(refused.ok, false, 'a rank cannot be typed in afterwards either');
    // The Party tab draws the new character as you, with the skills, and the Skills view reads them.
    await settle();
    const card = party(doc).querySelector('.rpg-card[data-character="Wessel"]');
    assert.ok(card);
    assert.equal(card.querySelector('.rpg-sub').textContent, 'you');
    assert.match(card.textContent, /Short blade \(Adept\) · Iron Breath \(Novice\) · Shield work \(Novice\)/);
    assert.ok(!card.textContent.includes('points to spend'), 'every point was spent');
    card.querySelector('.rpg-skills-open').click();
    assert.match(party(doc).querySelector('.rpg-skill[data-slot="1"] .rpg-skill-roll').textContent, /Rolls with it: d20 \+8 = AGI 10 → \+5 · Adept \+1 · Soul Class I \+2/);
    await reload(host);
});

test('Create costs the reply\'s budget twice: two roots, and a second character after it still fits', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    for (const [who, persona] of [['Wessel', true], ['Ren', false]]) {
        const dialog = await openFrom(ctx, { empty: who === 'Wessel' });
        if (!persona) { click(wizardOf(dialog), 'A companion'); type(wizardOf(dialog).querySelector('[data-wiz="name"]'), who); }
        await goTo(dialog, 'review');
        wizardOf(dialog).querySelector('.rpg-wiz-create').click();
        await settle();
    }
    assert.deepEqual(names(ctx.host), ['pack.chat/ren', 'pack.chat/ren-skills', 'pack.chat/wessel', 'pack.chat/wessel-skills']);
    const perReply = Object.values(ctx.host.head().domains.dataModules.perReply)[0];
    assert.equal(perReply.roots, 4, 'two defines each');
});

test('nothing half made: if the second define fails the first block is taken back, and the reader is told in plain words', async t => {
    let fail = 'skills';
    const calls = [];
    const wrap = async (type, payload, options, run) => {
        calls.push([type, payload.definition?.slug ?? payload.module]);
        if (type === 'dm.define' && payload.definition.slug.endsWith('-skills') && fail === 'skills') return { ok: false, code: 'DM_SCHEMA', message: 'Wessel\'s skills: A block with this name is already active; nothing applied.' };
        if (type === 'dm.remove' && fail === 'both') return { ok: false, message: 'Nope.' };
        if (type === 'dm.define' && payload.definition.slug.endsWith('-skills') && fail === 'both') return { ok: false, message: 'No skills today.' };
        if (type === 'dm.define' && fail === 'first') return { ok: false, message: 'No characters today.' };
        return run(type, payload, options);
    };
    const ctx = await page(t, { persona: 'Wessel', wrap });
    await begin(ctx.host);
    const before = names(ctx.host);
    let dialog = await openFrom(ctx, { empty: true });
    await goTo(dialog, 'review');
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.deepEqual(calls.map(call => call[0]), ['dm.define', 'dm.define', 'dm.remove']);
    assert.deepEqual(calls[2], ['dm.remove', 'pack.chat/wessel'], 'the first block is removed again');
    assert.deepEqual(names(ctx.host), before, 'nothing half made');
    assert.ok(ctx.ui.mounts.dialog.current(), 'the dialog stays open so nothing typed is lost');
    assert.match(wizardOf(ctx.ui.mounts.dialog.current()).querySelector('.rpg-wiz-status').textContent, /^Could not make the skills: Wessel's skills: .*Nothing was created\.$/);
    assert.equal(wizardOf(ctx.ui.mounts.dialog.current()).querySelector('.rpg-wiz-create').disabled, false, 'and Create can be tried again');
    ctx.ui.mounts.dialog.closeAll();

    // The first define fails: nothing to take back.
    fail = 'first';
    calls.length = 0;
    dialog = await openFrom(ctx, { empty: true });
    await goTo(dialog, 'review');
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.deepEqual(calls.map(call => call[0]), ['dm.define']);
    assert.match(wizardOf(ctx.ui.mounts.dialog.current()).querySelector('.rpg-wiz-status').textContent, /^Could not make the character: No characters today\.$/);
    assert.deepEqual(names(ctx.host), before);
    ctx.ui.mounts.dialog.closeAll();

    // The skills fail and the first block cannot be removed: the reader is told which block to remove.
    fail = 'both';
    calls.length = 0;
    dialog = await openFrom(ctx, { empty: true });
    await goTo(dialog, 'review');
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.match(wizardOf(ctx.ui.mounts.dialog.current()).querySelector('.rpg-wiz-status').textContent, /Could not make the skills \(No skills today\.\) and could not take the character back\. Remove "Wessel" from Blocks\./);
    ctx.ui.mounts.dialog.closeAll();
});

test('one You to a story: with a character named like the persona already there, You is off and the wizard starts as a companion', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    await makeBlocks(ctx.host, { who: 'Wessel' });
    await ctx.host.send('Go.', 'The quay.');
    const dialog = await openFrom(ctx);
    const who = wizardOf(dialog);
    const you = who.querySelector('.rpg-wiz-seg button[data-kind="you"]');
    assert.equal(you.disabled, true);
    assert.equal(who.querySelector('.rpg-wiz-seg button[data-kind="companion"]').getAttribute('aria-pressed'), 'true');
    assert.equal(who.querySelector('[data-wiz="name"]').value, '', 'the persona\'s name is not a companion\'s');
    assert.match(who.textContent, /You already have a character in this story\./);
    you.click();
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-seg button[data-kind="companion"]').getAttribute('aria-pressed'), 'true', 'a disabled You does nothing');
    type(wizardOf(dialog).querySelector('[data-wiz="name"]'), 'Wessel');
    const review = await goTo(dialog, 'review');
    assert.ok(review.querySelector('.rpg-wiz-create').disabled);
    const problems = review.querySelectorAll('.rpg-wiz-problems li').map(node => node.textContent).join(' ');
    assert.match(problems, /A character called Wessel is already in this story\./);
    dialog.close();
});

test('a companion cannot take the persona\'s name, and You must have it; no persona name known: any name goes', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    const dialog = await openFrom(ctx, { empty: true });
    click(wizardOf(dialog), 'A companion');
    type(wizardOf(dialog).querySelector('[data-wiz="name"]'), 'Wessel');
    let review = await goTo(dialog, 'review');
    assert.match(review.querySelectorAll('.rpg-wiz-problems li').map(node => node.textContent).join(' '), /A companion cannot have your persona's name \(Wessel\)/);
    assert.ok(review.querySelector('.rpg-wiz-create').disabled);
    await goTo(dialog, 'who');
    type(wizardOf(dialog).querySelector('[data-wiz="name"]'), 'Ren');
    review = await goTo(dialog, 'review');
    assert.equal(review.querySelector('.rpg-wiz-create').disabled, false);
    dialog.close();

    const bare = await page(t, { persona: '' });
    await begin(bare.host);
    const second = await openFrom(bare, { empty: true });
    type(wizardOf(second).querySelector('[data-wiz="name"]'), 'Pip');
    review = await goTo(second, 'review');
    assert.equal(review.querySelector('.rpg-wiz-create').disabled, false);
    second.close();
});

test('no room for two more blocks: the Review says so and Create stays off', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    for (const who of ['Ren', 'Tamsin', 'Mira']) await makeBlocks(ctx.host, { who });
    const foes = structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === 'Foes').definition);
    assert.equal((await ctx.host.sdk.command('dm.define', { definition: foes })).ok, true);
    await ctx.host.send('Go.', 'The quay.');
    assert.equal(hasRoom(ctx.host.head()), false);
    const dialog = await openFrom(ctx);
    const review = await goTo(dialog, 'review');
    assert.match(review.textContent, /This story has no room for two more blocks \(at most 8\)\. Remove one from Blocks first\./);
    assert.ok(review.querySelector('.rpg-wiz-create').disabled);
    dialog.close();
});

test('closing the dialog drops the draft: the next one starts fresh', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    let dialog = await openFrom(ctx, { empty: true });
    type(wizardOf(dialog).querySelector('[data-wiz="about"]'), 'Something.');
    dialog.close();
    dialog = await openFrom(ctx, { empty: true });
    assert.equal(wizardOf(dialog).querySelector('[data-wiz="about"]').value, '');
    assert.equal(ctx.ui.mounts.dialog.current(), dialog);
    dialog.close();
});

test('feature off: no wizard screen, no button, nothing of it loaded', async t => {
    const ctx = await page(t, { feature: false });
    await begin(ctx.host);
    assert.equal(ctx.loads.length, 0);
    assert.equal(ctx.ui.screens.resolve(WIZARD_SCREEN_ID), null);
    assert.equal(ctx.ui.mounts.dialog.open(WIZARD_SCREEN_ID), null, 'a dialog for a screen that is not there opens nothing');
    ctx.host.features.set('story-block.rpg', true);
    await settle();
    assert.ok(ctx.ui.screens.resolve(WIZARD_SCREEN_ID));
    ctx.host.features.set('story-block.rpg', false);
    assert.equal(ctx.ui.screens.resolve(WIZARD_SCREEN_ID), null, 'switched off: the screen is gone again');
});

test('the stylesheet: the summary row, the template cards in three columns, rows that stack on a phone, theme tokens only', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-wiz-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.rpg-wiz-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.7fr\) 78px 104px 104px 36px/);
    const phone = css.slice(css.indexOf('@media (max-width: 600px) {\n    .rpg-wiz-grid'));
    assert.match(phone, /\.rpg-wiz-grid \{ grid-template-columns: 1fr; \}/);
    assert.match(phone, /\.rpg-wiz-row \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) 36px;/);
    assert.match(phone, /\.rpg-wiz-row \.rpg-wiz-n \{ grid-column: 1 \/ 4; \}/);
    assert.match(phone, /\.rpg-wiz-row \.rpg-wiz-d \{ grid-column: 1 \/ -1; \}/);
    assert.match(phone, /\.rpg-wiz-headrow \{ display: none; \}/);
    assert.doesNotMatch(css, /position:\s*fixed/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(css, /\brgba?\(/);
    assert.equal(CREATION.skills, 5);
});

// ---- fix round 4, B9: Create asks the reply for room first -------------------------------------------------------------------------

// A reply with `used` block actions on it: the Character and Skills blocks (two defines) and then sets of one field.
async function usedReply(t, used) {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    await makeBlocks(ctx.host);
    for (let n = 0; n < used - 2; n += 1) {
        const set = await ctx.host.sdk.command('dm.set', { module: 'pack.chat/wessel', field: 'str', value: 12 + (n % 2) });
        assert.equal(set.ok, true, set.message);
    }
    assert.equal(Object.values(ctx.host.head().domains.dataModules.perReply)[0].roots, used);
    return ctx;
}
async function companion(ctx, name) {
    const dialog = await openFrom(ctx);
    click(wizardOf(dialog), 'A companion');
    type(wizardOf(dialog).querySelector('[data-wiz="name"]'), name);
    await goTo(dialog, 'review');
    return dialog;
}

test('B9: with 31 of the reply\'s 32 block actions used, Create says so plainly and makes nothing (no half-made character)', async t => {
    const ctx = await usedReply(t, 31);
    const before = names(ctx.host);
    const dialog = await companion(ctx, 'Ren');
    const shown = wizardOf(dialog).querySelectorAll('.rpg-wiz-problems li').map(node => node.textContent);
    assert.deepEqual(shown, ['Fix this first:', 'This reply has already used 31 of its 32 block actions, and a new character needs 3. Send your next message, then try again.']);
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-create').disabled, true);
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.deepEqual(names(ctx.host), before, 'nothing was made, not even the Character');
    assert.equal(Object.values(ctx.host.head().domains.dataModules.perReply)[0].roots, 31, 'and no action was spent');
    dialog.close();
});

test('B9: the edge: 29 used leaves exactly the three Create may need, 30 does not; a new reply has room again', async t => {
    const tight = await usedReply(t, 30);
    let dialog = await companion(tight, 'Ren');
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-create').disabled, true, '30 used');
    dialog.close();
    const edge = await usedReply(t, 29);
    dialog = await companion(edge, 'Ren');
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-create').disabled, false, '29 used');
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.ok(names(edge.host).includes('pack.chat/ren') && names(edge.host).includes('pack.chat/ren-skills'));
    // A new reply is a fresh count.
    await tight.host.send('Onward.', 'The next reply.');
    dialog = await companion(tight, 'Ren');
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-create').disabled, false, 'the next reply');
    dialog.close();
});

test('B9: problemsOf says it when the free actions are fewer than three, and only then', () => {
    const ok = { ...newDraft({ persona: 'Wessel' }) };
    const world = { persona: 'Wessel', names: [], room: true, hasYou: false };
    assert.deepEqual(problemsOf(ok, { ...world, free: 3 }), []);
    assert.equal(problemsOf(ok, { ...world, free: 2 }).length, 1);
    assert.deepEqual(problemsOf(ok, world), [], 'without the count nothing is asked');
});
