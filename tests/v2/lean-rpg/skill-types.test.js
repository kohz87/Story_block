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
import { buildDefinitions, combatSlots, draftSlots, newDraft, readDraft, withImport, withSet, withSkill, withSkillPatch } from '../../../src/v2/lean-rpg/view/wizard-data.js';
import { buildCharacterFile, parseCharacterFile } from '../../../src/v2/lean-rpg/charfile.js';
import { joinCard, joinDraft, joinOffers } from '../../../src/v2/lean-rpg/join.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { castSkillsOf } from '../../../src/v2/packs/cast-skills.js';
import { UTILITY_SLOTS, SKILL_FIELDS_MAX } from '../../../src/v2/skill-slots.js';
import { summaryOf } from '../../../src/v2/data-modules/part/prompt.js';
import { reply, success, view, rebuilt, reload } from '../data-modules/helpers.js';
import { fakeState } from './view/helpers.js';
import { readParty } from '../../../src/v2/lean-rpg/view/party-data.js';
import { tailRoom } from '../../../src/v2/data-modules/part/prompt.js';
import { pack } from '../packs/helpers/fixtures.js';

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

test('the board: a utility skill that heals is refused as a support action too', () => {
    const mend = { slot: 9, name: 'Mend', about: 'Heals a wounded friend.', stat: 'int', uses: 'mana', rank: 0, type: 'utility' };
    const actor = { who: 'Astra', key: 'astra', module: 'a', alive: true, health: 5, stamina: 4, mana: 4, stats: { str: 10, int: 12 }, skills: [mend] };
    const sheetOf = { characters: [actor], foes: [{ slot: 1, filled: true, hurt: 3, name: 'Wolf', count: 1 }] };
    const plan = exchangePlan(sheetOf, [{ who: 'Astra', kind: 'skill', skill: 'Mend', target: 'Astra', support: true }], {}, 1, { bars: true });
    assert.match(plan.error, /cannot be used on that target/, "refused before it can be a support action");
    const combat = exchangePlan({ ...sheetOf, characters: [{ ...actor, skills: [{ ...mend, type: undefined }] }] }, [{ who: 'Astra', kind: 'skill', skill: 'Mend', target: 'Astra', support: true }], {}, 1, { bars: true });
    assert.equal(combat.error, undefined, 'the same skill as a combat skill still heals');
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

test('the wizard preserves imported combat skills without counting imported utility skills as combat room', () => {
    const skill = (n, type) => ({ name: `S${n}`, about: 'x', stat: 'str', uses: 'stamina', rank: 0, ...(type ? { type } : {}) });
    const stats = Object.fromEntries(['str', 'vit', 'agi', 'dex', 'int', 'luk', 'cha'].map(stat => [stat, 8]));
    for (const count of [5, 8]) {
        const file = { level: 1, points: 0, stats, skills: [...Array.from({ length: count }, (_, n) => skill(n)), ...Array.from({ length: 3 }, (_, n) => skill(n + 20, 'utility'))] };
        const draft = readDraft(withImport(newDraft({ persona: 'Astra' }), file).draft);
        assert.equal(combatSlots(draft), count);
        assert.equal(draftSlots(draft), count + 3);
        assert.equal(withSkill(draft), draft, 'neither pool can grow');
        assert.equal(Object.keys(buildDefinitions(draft).skills.state).length, 79, 'the full import fits its definition');
    }
    const raw = readDraft({ skills: Array.from({ length: 6 }, (_, n) => skill(n, 'utility')) });
    assert.deepEqual(raw.skills.map(skill => skill.type), ['utility', 'utility', 'utility'], 'extra utility skills are not silently turned into combat skills');
});

test('an untyped Skills block keeps its old definition budgets and ignores fields beyond slot eight', () => {
    const old = skillsV2For();
    const valid = structuredClone(old);
    for (let n = 1; n <= 6; n += 1) valid.state[`extra${n}`] = { type: 'bool', default: false };
    const check = definition => validateDataModules([definition], { packId: 'chat', capabilities: ['data-modules-v1'] });
    assert.equal(check(valid).ok, true, '56 fields remain allowed');
    valid.state.extra7 = { type: 'bool', default: false };
    assert.ok(check(valid).errors.some(error => error.code === 'DM_BUDGET' && error.path.endsWith('.state')));
    const kinds = structuredClone(old);
    kinds.kinds.extra = structuredClone(kinds.kinds['learn-1']);
    assert.ok(check(kinds).errors.some(error => error.code === 'DM_BUDGET' && error.path.endsWith('.kinds')));
    old.state.skill9 = { type: 'text', max: 40, default: 'Not a skill' };
    const person = structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Character').definition);
    person.state.who.default = 'Astra'; old.state.who.default = 'Astra';
    old.state.skill1.default = 'Cut';
    const state = fakeState([{ definition: person }, { definition: old }]);
    assert.deepEqual(readSheet(state).characters[0].skills.map(skill => skill.name), ['Cut']);
    assert.deepEqual(readParty(state, {})[0].skills.map(skill => skill.name), ['Cut']);
    assert.doesNotMatch(summaryOf(state, 'pack.chat/skills'), /Not a skill/u);
    const fields = state.domains.dataModules.instances['pack.chat/skills'].chat.fields;
    assert.equal(tailRoom(old, true, fields), 300);
});

test('an unrelated old block with an optional type label does not acquire a combat argument', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const definition = { slug: 'custom', name: 'Custom', schema: 1, stateVersion: 1, scope: 'chat',
        state: { count: { type: 'int', min: 0, max: 10, default: 0 } },
        kinds: { use: { op: '~', labels: { type: { type: 'enum', values: ['small', 'large'], optional: true } }, effects: [{ op: 'add', path: ['count'], value: 1, bounds: 'clamp' }] } } };
    success(await host.sdk.command('dm.define', { definition }));
    await host.send('Do it.', reply('~ dm custom — done | kind: use'));
    const span = host.ctx.chat.at(-1).extra.storySuite.spans.find(entry => entry.guard?.predicate?.kind === 'dm.act');
    assert.ok(span);
    assert.equal(Object.hasOwn(span.recorded.decision.args, 'type'), false);
    rebuilt(host);
});

// Pack cast skills keep their type in joins, the edit-first wizard, and returns.
const castPerson = skills => ({ id: 'mara', name: 'Mara', aliases: ['the ferrywoman'], about: 'Runs the ferry.', look: 'Wiry.', start: { place: 'Docks', goal: 'Keep the ferry running.' }, ...(skills ? { skills } : {}) });
const castPack = skills => pack({ content: { cast: [castPerson(skills)] } });
const castSkill = (name, type) => ({ name, about: 'Something.', stat: 'cha', ...(type ? { type } : {}) });
const castFields = host => host.head().domains.dataModules.instances['pack.chat/mara-skills'].chat.fields;
const castReceipt = host => host.ctx.chat.at(-1).extra.storySuite.receipts.find(entry => entry.type === 'capture.party');
const castTypes = fields => Array.from({ length: 11 }, (_, i) => i + 1).filter(n => fields[`skill${n}`]).map(n => [fields[`skill${n}`], fields[`type${n}`]]);
const castBytes = host => JSON.stringify([castFields(host), host.ctx.chat.map(message => (message.extra?.storySuite?.receipts ?? []).map(r => [r.type, r.summary, r.data?.join, r.data?.sigSkills, r.data?.sigSkillsPlanned]))]);
const castWarnings = host => host.turn.problems().filter(problem => problem.code === 'LIMITED').map(problem => problem.message);
async function castWorld(t, skills, join = 'auto') {
    t.mock.method(console, 'warn', () => {});
    const raw = castPack(skills), checked = validatePack(raw);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    const host = await createHost({ settings: { features: { 'story-block.rpg': true }, modules: { 'story-block': { rpgJoin: join, rpgRolls: 'off' } },
        packs: [{ id: checked.pack.id, version: checked.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }] } });
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    for (const role of ['character', 'skills']) {
        const definition = structuredClone(STANDARD_TEMPLATES.find(entry => entry.definition.role === role).definition);
        definition.slug = role === 'character' ? 'wessel' : 'wessel-skills';
        definition.name = definition.slug; definition.state.who.default = 'Wessel';
        success(await host.sdk.command('dm.define', { definition }));
    }
    return host;
}
async function updateCast(host, skills) { success(await host.packs.packs.install(castPack(skills))); }

test('cast skill types are validated and absent type leaves the old pack and rows unchanged', () => {
    const mixed = [castSkill('Cut', 'combat'), castSkill('Talk', 'utility'), castSkill('Haul')];
    const result = validatePack(castPack(mixed));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.pack.content.cast[0].skills.map(skill => skill.type), ['combat', 'utility', undefined]);
    assert.equal(Object.hasOwn(result.pack.content.cast[0].skills[2], 'type'), false);
    assert.deepEqual(castSkillsOf([result.pack], 'the ferrywoman').skills.map(skill => skill.type), [undefined, 'utility', undefined]);
    assert.deepEqual(validatePack(castPack([castSkill('Haul')])).pack.content.cast[0].skills,
        [{ name: 'Haul', about: 'Something.', stat: 'cha', uses: 'stamina', rank: 'novice' }]);
    for (const bad of ['support', 'Utility', '', 3, null]) {
        const invalid = castPack([{ ...castSkill('Cut'), type: bad }]);
        const error = validatePack(invalid).errors.find(entry => entry.path === 'content.cast[0].skills[0].type');
        assert.match(error?.message ?? '', /combat or utility/);
    }
});

test('a cast join keeps combat and utility types through rebuild, reload and Re-read', async t => {
    const host = await castWorld(t, [castSkill('Cut', 'combat'), castSkill('Talk', 'utility'), castSkill('Haul')]);
    await host.send('Mara arrives.', reply('+ party Mara'));
    assert.deepEqual(castTypes(castFields(host)), [['Cut', 'combat'], ['Talk', 'utility'], ['Haul', 'combat']]);
    assert.equal(castFields(host).sig, 7);
    assert.deepEqual(castReceipt(host).data.sigSkills.map(skill => skill.type), [undefined, 'utility', undefined]);
    const live = castBytes(host);
    host.store.rebuild(); assert.equal(castBytes(host), live);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat))); assert.equal(castBytes(host), live);
    success(await host.turn.reread(host.ctx.chat.length - 1)); assert.equal(castBytes(host), live);
});

test('a fourth utility skill is omitted from the join and receipt and Re-read gives the same result', async t => {
    const skills = [castSkill('Cut'), ...['A', 'B', 'C', 'D'].map(name => castSkill(name, 'utility'))];
    const host = await castWorld(t, skills);
    await host.send('Mara arrives.', reply('+ party Mara'));
    assert.deepEqual(castTypes(castFields(host)), [['Cut', 'combat'], ['A', 'utility'], ['B', 'utility'], ['C', 'utility']]);
    assert.deepEqual(castReceipt(host).data.sigSkills.map(skill => skill.name), ['Cut', 'A', 'B', 'C']);
    assert.equal(castReceipt(host).summary, 'Mara joined the party. Signature skills: 4.');
    const live = castBytes(host);
    await updateCast(host, [castSkill('Different', 'utility')]);
    success(await host.turn.reread(host.ctx.chat.length - 1));
    assert.equal(castBytes(host), live);
});

test('an untyped cast join keeps its fields, pin and receipt when the pack later gives that skill a type', async t => {
    const host = await castWorld(t, [castSkill('Cut'), castSkill('Talk')]);
    await host.send('Mara arrives.', reply('+ party Mara'));
    assert.deepEqual(castTypes(castFields(host)), [['Cut', 'combat'], ['Talk', 'combat']]);
    assert.deepEqual(castReceipt(host).data.sigSkills, [
        { name: 'Cut', about: 'Something.', stat: 'cha', uses: 'stamina', rank: 0 },
        { name: 'Talk', about: 'Something.', stat: 'cha', uses: 'stamina', rank: 0 },
    ]);
    const live = castBytes(host), pin = host.head().domains.dataModules.active['pack.chat/mara-skills'].hash;
    await updateCast(host, [castSkill('Cut'), castSkill('Talk', 'utility')]);
    success(await host.turn.reread(host.ctx.chat.length - 1));
    assert.equal(castBytes(host), live);
    assert.equal(host.head().domains.dataModules.active['pack.chat/mara-skills'].hash, pin);
});

test('edit first preserves utility signatures and a set fills the combat room without replacing them', async t => {
    const host = await castWorld(t, [castSkill('Cut'), castSkill('Talk', 'utility'), castSkill('Hide', 'utility')], 'ask');
    await host.send('Mara waits.', reply('+ party Mara'));
    const offer = castReceipt(host).data.join;
    const card = joinCard(joinOffers([{ index: host.ctx.chat.length - 1, receipt: { data: { join: offer } } }], host.ctx.chat.length - 1, []));
    const draft = joinDraft(card.actions.find(action => action.id === 'edit').payload);
    assert.deepEqual(draft.skills.map(skill => [skill.name, skill.type, skill.sig]), [['Cut', undefined, true], ['Talk', 'utility', true], ['Hide', 'utility', true]]);
    const set = withSet(draft, { id: 'set', skills: Array.from({ length: 5 }, (_, n) => castSkill(`Set ${n}`)) });
    assert.equal(set.skills.filter(skill => skill.type === 'utility').length, 2);
    assert.equal(set.skills.filter(skill => skill.type !== 'utility').length, 5);
    const made = buildDefinitions(readDraft(set));
    assert.deepEqual([made.skills.state.type2.default, made.skills.state.type3.default], ['utility', 'utility']);
});

test('a returning utility signature uses a free slot beyond eight and survives a pack update and Re-read', async t => {
    const host = await castWorld(t, Array.from({ length: 8 }, (_, n) => castSkill(`Combat ${n}`)));
    await host.send('Mara arrives.', reply('+ party Mara'));
    await host.send('She leaves.', reply('- party Mara'));
    await updateCast(host, [castSkill('Talk', 'utility')]);
    await host.send('She returns.', reply('+ party Mara'));
    assert.deepEqual([castFields(host).skill9, castFields(host).type9, castFields(host).sig], ['Talk', 'utility', 511]);
    assert.deepEqual(castReceipt(host).data.sigSkills.map(skill => [skill.name, skill.type]), [['Talk', 'utility']]);
    const live = castBytes(host);
    await updateCast(host, [castSkill('Different')]);
    success(await host.turn.reread(host.ctx.chat.length - 1));
    assert.equal(castBytes(host), live);
});

test('a full utility pool skips the new signature and preserves its warning on Re-read', async t => {
    for (const alsoCombat of [false, true]) await t.test(alsoCombat ? 'another skill fits' : 'nothing fits', async sub => {
        const first = ['A', 'B', 'C'].map(name => castSkill(name, 'utility'));
        const host = await castWorld(sub, first);
        await host.send('Mara arrives.', reply('+ party Mara'));
        await host.send('She leaves.', reply('- party Mara'));
        await updateCast(host, [...first, castSkill('D', 'utility'), ...(alsoCombat ? [castSkill('Cut')] : [])]);
        await host.send('She returns.', reply('+ party Mara'));
        assert.deepEqual(castTypes(castFields(host)), [...first.map(skill => [skill.name, 'utility']), ...(alsoCombat ? [['Cut', 'combat']] : [])]);
        assert.deepEqual((castReceipt(host).data.sigSkills ?? []).map(skill => skill.name), alsoCombat ? ['Cut'] : []);
        assert.deepEqual(castReceipt(host).data.sigSkillsPlanned.map(skill => skill.name), alsoCombat ? ['D', 'Cut'] : ['D']);
        assert.deepEqual(castWarnings(host), ["Mara's D has no free utility skill slot."]);
        const live = castBytes(host), warnings = castWarnings(host);
        host.store.rebuild(); assert.equal(castBytes(host), live); assert.deepEqual(castWarnings(host), warnings);
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat))); assert.equal(castBytes(host), live);
        await updateCast(host, [castSkill('Different')]);
        const reread = success(await host.turn.reread(host.ctx.chat.length - 1));
        assert.equal(castBytes(host), live);
        assert.deepEqual(reread.problems.filter(problem => problem.code === 'LIMITED').map(problem => problem.message), warnings);
    });
});
