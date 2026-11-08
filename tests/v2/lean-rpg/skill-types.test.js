// Combat and utility skills (balance batch, lane C): a Skills block made from the new template has eleven slots and a `type` on each; combat has the level's slots (5, +1 per 20
// levels, max 8) and utility three of its own; the board's list, Auto and the defence ignore utility skills; the narrator still reads them; a block with no `type1` field (every
// older chat) is all combat and keeps its eight slots byte for byte; replay == live (rebuild, reload).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { STANDARD_TEMPLATES, grownSkills, skillsV1For, skillsV2For } from '../../../src/v2/lean-rpg/templates.js';
import { validateDataModules } from '../../../src/v2/data-modules/check.js';
import { readSheet } from '../../../src/v2/lean-rpg/read.js';
import { skillFlags } from '../../../src/v2/lean-rpg/board/flags.js';
import { actionSkills, exchangePlan } from '../../../src/v2/lean-rpg/board/plan.js';
import { bestDefence } from '../../../src/v2/lean-rpg/board/rules.js';
import { buildDefinitions, combatSlots, draftSlots, newDraft, readDraft, withSkill, withSkillPatch } from '../../../src/v2/lean-rpg/view/wizard-data.js';
import { buildCharacterFile, parseCharacterFile } from '../../../src/v2/lean-rpg/charfile.js';
import { UTILITY_SLOTS, SKILL_FIELDS_MAX } from '../../../src/v2/skill-slots.js';
import { summaryOf } from '../../../src/v2/data-modules/part/prompt.js';
import { reply, success, view, rebuilt, reload } from '../data-modules/helpers.js';

const typedDefinition = () => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Skills').definition);
const line = (n, name, type, why = 'learned') => `~ dm skills — ${why} | kind: learn-${n} | name: ${name} | about: Something. | stat: dex | uses: mana${type ? ` | type: ${type}` : ''}`;
const sheet = host => view(host, 'pack.chat/skills').chat;
async function story(t, definition = typedDefinition()) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const person = structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Character').definition);
    person.state.who.default = 'Astra';
    definition.state.who.default = 'Astra';
    success(await host.sdk.command('dm.define', { definition: person }));
    success(await host.sdk.command('dm.define', { definition }));
    return host;
}
const told = host => host.turn.problems().map(problem => problem.message);

test('the template: eleven slots with a type on each, 79 fields and 22 kinds, inside the Skills limits; the earlier template is untouched', () => {
    const typed = typedDefinition(), old = skillsV2For();
    assert.equal(Object.keys(typed.state).length, 79);
    assert.equal(Object.keys(typed.kinds).length, 22);
    assert.deepEqual(typed.state.type3, { type: 'enum', values: ['combat', 'utility'], default: 'combat', label: 'Used for 3' });
    assert.equal(typed.state.sig.max, 2 ** SKILL_FIELDS_MAX - 1);
    assert.equal(typed.kinds['learn-11'].effects.at(-1).path[0], 'type11');
    assert.equal(typed.kinds['learn-1'].labels.type.optional, true);
    assert.equal(validateDataModules([typed], { packId: 'chat', capabilities: ['data-modules-v1'] }).ok, true);
    assert.equal(Object.keys(old.state).length, 50, 'eight slots of six fields, who and sig');
    assert.equal(Object.hasOwn(old.state, 'type1'), false);
    assert.equal(Object.keys(old.kinds).length, 16);
    assert.equal(grownSkills(typed), null, 'a typed block is never "grown"');
    assert.equal(grownSkills(old), null);
    assert.ok(Object.keys(skillsV1For().state).length < 50);
});

test('a utility learn goes to the utility pool: three of them, and combat keeps its five', async t => {
    const host = await story(t);
    for (const [n, name] of [[1, 'One'], [2, 'Two'], [3, 'Three']]) await host.send('Learn.', reply(line(n, name, 'utility')));
    assert.deepEqual([1, 2, 3].map(n => sheet(host)[`type${n}`]), ['utility', 'utility', 'utility']);
    await host.send('Learn.', reply(line(4, 'Four', 'utility')));
    assert.equal(sheet(host).skill4, '', 'the fourth utility skill is refused');
    assert.ok(told(host).some(text => text.includes('No free utility skill slot for Four')));
    for (const [n, name] of [[1, 'Cut'], [1, 'Slash'], [1, 'Stab'], [1, 'Block'], [1, 'Bash']]) await host.send('Learn.', reply(line(n, name)));
    assert.deepEqual([4, 5, 6, 7, 8].map(n => sheet(host)[`skill${n}`]), ['Cut', 'Slash', 'Stab', 'Block', 'Bash'], 'combat skills fill the next slots, type left out = combat');
    await host.send('Learn.', reply(line(1, 'Sixth')));
    assert.equal(sheet(host).skill9, '', 'a sixth combat skill is refused at Lv 1, utility room or not');
    assert.ok(told(host).some(text => text.includes('No free skill slot for Sixth')));
    rebuilt(host);
    const before = JSON.stringify(sheet(host));
    await reload(host);
    assert.equal(JSON.stringify(sheet(host)), before, 'reload = live');
});

test('read as the sheet: only a utility skill carries a type; the narrator still reads it', async t => {
    const host = await story(t);
    await host.send('Learn.', reply(line(1, 'Obscure', 'utility'), line(2, 'Iaijutsu')));
    const astra = readSheet(host.head()).characters.find(person => person.who === 'Astra');
    assert.deepEqual(astra.skills.map(skill => [skill.name, skill.type ?? 'combat', skill.slot]), [['Obscure', 'utility', 1], ['Iaijutsu', 'combat', 2]]);
    assert.equal(Object.hasOwn(astra.skills[1], 'type'), false, 'a combat skill reads as it always did');
    assert.deepEqual(actionSkills(astra).map(entry => entry.skill.name), ['Iaijutsu'], 'the board lists the combat skill only');
    const told = summaryOf(host.head(), 'pack.chat/skills');
    assert.match(told, /Obscure/u, 'the narrator\'s skill list keeps the utility skill');
    assert.match(told, /utility/u);
});

test('the board: a utility skill is never listed, never chosen, never a defence, never healing for Auto', () => {
    const cut = { slot: 1, name: 'Iaijutsu', about: 'A draw cut.', stat: 'dex', uses: 'stamina', rank: 0 };
    const obscure = { slot: 9, name: 'Obscure', about: 'Hide from sight and dodge.', stat: 'dex', uses: 'mana', rank: 0, type: 'utility' };
    const actor = { who: 'Astra', key: 'astra', module: 'a', alive: true, health: 5, stamina: 4, mana: 4, stats: { str: 10, dex: 12, agi: 12 }, skills: [cut, obscure] };
    assert.deepEqual(skillFlags(obscure, { target: true, defence: true }), { target: false, area: false, defence: false }, 'explicit flags cannot bring it back');
    assert.deepEqual(actionSkills(actor).map(entry => entry.skill.name), ['Iaijutsu']);
    assert.equal(bestDefence({ ...actor, skills: [obscure] }), null);
    const sheetOf = { characters: [actor], foes: [{ slot: 1, filled: true, hurt: 3, name: 'Wolf', count: 1 }] };
    assert.match(exchangePlan(sheetOf, [{ who: 'Astra', kind: 'skill', skill: 'Obscure', target: 1 }]).error, /cannot be used/);
    assert.equal(exchangePlan(sheetOf, [{ who: 'Astra', kind: 'skill', skill: 'Iaijutsu', target: 1 }]).error, undefined);
});

test('an old block (no type field): eight slots, all combat, learn-9 refused, nothing is added, the hash is the one it had', async t => {
    const host = await story(t, skillsV2For());
    await host.send('Learn.', reply(line(9, 'Ninth', 'utility')));
    assert.equal(Object.hasOwn(sheet(host), 'skill9'), false);
    assert.equal(Object.hasOwn(sheet(host), 'type1'), false);
    await host.send('Learn.', reply(line(1, 'Iaijutsu')));
    assert.equal(sheet(host).skill1, 'Iaijutsu');
    assert.equal(Object.hasOwn(sheet(host), 'type1'), false);
    const astra = readSheet(host.head()).characters.find(person => person.who === 'Astra');
    assert.equal(Object.hasOwn(astra.skills[0], 'type'), false);
});

test('the wizard: a draft holds the level\'s combat skills and three utility ones; a full pool refuses the switch; buildDefinitions writes the types', () => {
    let draft = readDraft(newDraft({ persona: 'Astra' }));
    assert.equal(draftSlots(draft), 8);
    assert.equal(combatSlots(draft), 5);
    for (let at = 0; at < 8; at += 1) draft = withSkill({ ...draft, skills: draft.skills.map(skill => ({ ...skill, name: skill.name || 'x' })) });
    assert.equal(draft.skills.length, 8);
    assert.equal(draft.skills.filter(skill => skill.type === 'utility').length, 3, 'the blank skills after the fifth are utility');
    draft = { ...draft, skills: draft.skills.map((skill, at) => ({ ...skill, name: `Skill ${at + 1}` })) };
    assert.equal(withSkillPatch(draft, 0, { type: 'utility' }), draft, 'utility is full: refused');
    const swapped = withSkillPatch(draft, 7, { type: 'combat' });
    assert.equal(swapped, draft, 'combat is full too');
    const loose = readDraft({ ...draft, skills: draft.skills.map(skill => ({ ...skill, type: 'utility' })) });
    assert.equal(loose.skills.filter(skill => skill.type === 'utility').length, 3, 'a draft with every skill utility keeps three');
    const made = buildDefinitions(draft, { used: [] });
    assert.equal(made.skills.state.type6.default, 'utility');
    assert.equal(made.skills.state.type1.default, 'combat');
    assert.equal(made.skills.state.skill8.default, 'Skill 8');
    assert.equal(validateDataModules([made.character, made.skills], { packId: 'chat', capabilities: ['data-modules-v1'] }).ok, true);
    const earlier = buildDefinitions(readDraft(newDraft({ persona: 'Astra' })), { used: [], typed: false });
    assert.equal(Object.hasOwn(earlier.skills.state, 'type1'), false, 'an older chat\'s companion is built on the eight slots');
});

test('a character file keeps the type and carries up to eleven skills', () => {
    const file = buildCharacterFile({ level: 1, points: 0, stats: { str: 8, vit: 8, agi: 8, dex: 8, int: 8, luk: 8, cha: 8 }, skills: [
        { name: 'Cut', about: 'x', stat: 'str', uses: 'stamina', rank: 0 }, { name: 'Obscure', about: 'y', stat: 'dex', uses: 'mana', rank: 1, type: 'utility' }] });
    assert.deepEqual(file.skills.map(skill => skill.type), [undefined, 'utility']);
    const read = parseCharacterFile(JSON.stringify(file));
    assert.equal(read.ok, true);
    assert.deepEqual(read.file.skills.map(skill => skill.type), [undefined, 'utility']);
    assert.ok(UTILITY_SLOTS === 3);
});
