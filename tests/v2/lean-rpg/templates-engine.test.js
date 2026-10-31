// The RPG templates as the block engine runs them: made with dm.define as the chooser does, then played by
// story lines. Class and rank rise by their rules, the death latch ends the story only for a character already
// Down, the end card follows, and live = reload = rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES, SKILL_SETS } from '../../../src/v2/lean-rpg/templates.js';
import { LEAN_RPG_FEATURE } from '../../../src/v2/lean-rpg/index.js';
import { summaryOf } from '../../../src/v2/data-modules/part.js';
import { DM_LIMITS } from '../../../src/v2/data-modules/schema.js';
import { estimateTokens } from '../../../src/v2/assist/common.js';
import { reply, success, view, rebuilt } from '../data-modules/helpers.js';

const definition = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
// A line's sign is its kind's op: `+` for the add kinds (add-xp, practice-N), `~` for the set kinds.
const line = (slug, kind, extra = '') => `${/^(add-|practice-)/.test(kind) ? '+' : '~'} dm ${slug} — why | kind: ${kind}${extra}`;
const sheet = (host, slug) => view(host, `pack.chat/${slug}`).chat;
async function story(t, ...names) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    for (const name of names) success(await host.sdk.command('dm.define', { definition: definition(name) }));
    return host;
}

test('every template is made by dm.define, as the chooser makes it', async t => {
    const host = await story(t, 'Character', 'Skills', 'Foes', 'Combat rules');
    for (const slug of ['character', 'skills', 'foes', 'combat-rules']) assert.ok(sheet(host, slug), slug);
    assert.equal(sheet(host, 'character').soul, 1);
});

test('Character: 100 XP raises the Soul Class by one and starts XP again; a swipe takes it back', async t => {
    const host = await story(t, 'Character');
    await host.send('Fight.', reply(line('character', 'add-xp', ' | amount: 60')));
    await host.send('Fight on.', reply(line('character', 'add-xp', ' | amount: 50')));
    assert.deepEqual([sheet(host, 'character').soul, sheet(host, 'character').xp], [2, 0]);
    await host.swipe(reply(line('character', 'add-xp', ' | amount: 10')));
    assert.deepEqual([sheet(host, 'character').soul, sheet(host, 'character').xp], [1, 70]);
    rebuilt(host);
});

test('Character: the death latch, by stage name, and the end card', async t => {
    const host = await story(t, 'Character');
    await host.send('Hit.', reply(line('character', 'set-health', ' | to: Down')));
    assert.deepEqual([sheet(host, 'character').health, sheet(host, 'character').alive], [0, true], 'Down, not dead');
    await host.send('Hit again.', reply(line('character', 'set-health', ' | to: Down')));
    assert.equal(sheet(host, 'character').alive, false, 'already Down and still Down: the story ends');
    rebuilt(host);
    await host.swipe(reply(line('character', 'set-health', ' | to: Hurt')));
    assert.deepEqual([sheet(host, 'character').health, sheet(host, 'character').alive], [3, true]);
});

const LEARN = ' | name: Iron Breath | about: Drill-yard breathing. | stat: vit | uses: stamina';

test('Skills: a learn line sets the name, what it does, the stat and the resource; the skill is practised to 100 and rises a rank; an unnamed one is refused', async t => {
    const host = await story(t, 'Skills');
    await host.send('Train.', reply(line('skills', 'practice-2', ' | amount: 10')));
    assert.equal(sheet(host, 'skills').practice2, 0, 'refused: no skill in slot 2');
    await host.send('Learn.', reply(line('skills', 'learn-1', LEARN)));
    assert.deepEqual([sheet(host, 'skills').skill1, sheet(host, 'skills').about1, sheet(host, 'skills').stat1, sheet(host, 'skills').uses1], ['Iron Breath', 'Drill-yard breathing.', 'vit', 'stamina']);
    for (let i = 0; i < 5; i++) await host.send('Train.', reply(line('skills', 'practice-1', ' | amount: 20')));
    assert.deepEqual([sheet(host, 'skills').skill1, sheet(host, 'skills').rank1, sheet(host, 'skills').practice1], ['Iron Breath', 1, 0]);
    rebuilt(host);
});

test('Skills: a learn line with a stat or resource that is not one of the words is refused; rank and practice cannot be typed in by the reader', async t => {
    const host = await story(t, 'Skills');
    await host.send('Learn.', reply(line('skills', 'learn-1', ' | name: Rage | about: Anger. | stat: wis | uses: stamina')));
    assert.equal(sheet(host, 'skills').skill1, '', 'wis is not a stat: nothing applied');
    for (const field of ['rank1', 'practice1']) {
        const refused = await host.sdk.command('dm.set', { module: 'pack.chat/skills', field, value: 2 });
        assert.equal(refused.ok, false, field);
        assert.match(refused.message, /locked|cannot|can't|read/i, field);
    }
    const fields = await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { skill1: 'Iron Breath', about1: 'Drill breathing.', stat1: 'vit', uses1: 'mana' } });
    assert.equal(fields.ok, true, 'the name, the description, the stat and the resource are the reader\'s to edit');
    assert.deepEqual([sheet(host, 'skills').skill1, sheet(host, 'skills').stat1, sheet(host, 'skills').uses1, sheet(host, 'skills').rank1], ['Iron Breath', 'vit', 'mana', 0]);
    const mixed = await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { skill1: 'Changed', rank1: 3 } });
    assert.equal(mixed.ok, false, 'one locked field refuses the whole edit');
    assert.equal(sheet(host, 'skills').skill1, 'Iron Breath');
    rebuilt(host);
});

test('the rolls read a sheet made from the templates: the character by its Who, its skills by theirs', async t => {
    const { readSheet } = await import('../../../src/v2/lean-rpg/read.js');
    const host = await story(t, 'Character', 'Skills');
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', field: 'who', value: 'Wessel' }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/skills', field: 'who', value: 'Wessel' }));
    await host.send('Learn.', reply(line('skills', 'learn-1', LEARN)));
    const sheet = readSheet(host.head());
    assert.deepEqual(sheet.problems, []);
    assert.equal(sheet.characters.length, 1);
    assert.equal(sheet.characters[0].who, 'Wessel');
    assert.deepEqual(sheet.characters[0].skills[0], { slot: 1, name: 'Iron Breath', about: 'Drill-yard breathing.', rank: 0, practice: 0, stat: 'vit', uses: 'stamina' });
});

test('the story reads all of a full sheet in the tail: five skills with what each does, and who a character is', async t => {
    const host = await story(t);
    const character = definition('Character'), skills = definition('Skills');
    character.state.who.default = 'Wessel';
    character.state.about.default = 'A drill-yard washout from Bluewatch who signed on with the Guild anyway. Broad-shouldered, quiet, owes the barge crews a favour. Afraid of deep water, though nobody knows. Keeps a ledger.';
    skills.state.who.default = 'Wessel';
    const full = [...SKILL_SETS[0].skills, ...SKILL_SETS[1].skills.slice(0, 2)];
    full.forEach((skill, at) => {
        skills.state[`skill${at + 1}`].default = skill.name;
        skills.state[`about${at + 1}`].default = skill.about;
        skills.state[`stat${at + 1}`].default = skill.stat;
        skills.state[`uses${at + 1}`].default = skill.uses;
    });
    for (const made of [character, skills]) success(await host.sdk.command('dm.define', { definition: made }));
    const state = host.head();
    const sheetLine = summaryOf(state, 'pack.chat/character'), skillsLine = summaryOf(state, 'pack.chat/skills');
    assert.match(sheetLine, /^Wessel — about "A drill-yard washout[^"]*Keeps a ledger\."/);
    assert.match(sheetLine, /STR 10 VIT 10 AGI 10 DEX 10 INT 10 LUK 10 CHA 10; soul I\.$/, 'the whole sheet: every stat and the Soul Class; a full bar, no points, no XP, alive are the defaults and left out');
    const lines = skillsLine.split('\n');
    assert.equal(lines[0], 'Wessel skills:');
    assert.deepEqual(lines.slice(1), full.map(skill => `- ${skill.name} (Novice, ${skill.stat}, ${skill.uses}): ${skill.about}`), 'one line per skill, the rank by its name, what it does in full');
    assert.doesNotMatch(skillsLine, /skill\d|about\d|practice/, 'no field keys, no practice');
    assert.ok(estimateTokens(skillsLine) <= DM_LIMITS.roleTailTokens, `${estimateTokens(skillsLine)} tokens`);
    // A block with no role keeps the 100 tokens it always had.
    const long = 'x'.repeat(240);
    const plain = { slug: 'plain', name: 'Plain', schema: 1, stateVersion: 1, scope: 'chat', kinds: {},
        state: { a: { type: 'text', max: 240, default: long }, b: { type: 'text', max: 240, default: long } } };
    success(await host.sdk.command('dm.define', { definition: plain }));
    const cut = summaryOf(host.head(), 'pack.chat/plain');
    assert.ok(estimateTokens(cut) <= DM_LIMITS.tailTokens, `${estimateTokens(cut)} tokens`);
    assert.ok(cut.length < 2 * 240, 'cut at its old size');
    const roled = { ...plain, slug: 'roled', name: 'Roled', role: 'rules' };
    success(await host.sdk.command('dm.define', { definition: roled }));
    assert.ok(summaryOf(host.head(), 'pack.chat/roled').length > cut.length, 'a block with a role has more room');
});

test('the tail leaves out empty slots and defaults, and says only what is there: a hurt character, two skills, the foes in the fight', async t => {
    const host = await story(t, 'Character', 'Skills', 'Foes', 'Combat rules');
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Wessel', health: 3, stamina: 1, points: 2, soul: 2, xp: 40, str: 14 } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { who: 'Wessel', skill2: 'Iron Breath', about2: 'Drill-yard breathing.', stat2: 'vit', uses2: 'stamina' } }));
    let state = host.head();
    assert.equal(summaryOf(state, 'pack.chat/character'), 'Wessel — health Hurt; stamina Spent; STR 14 VIT 10 AGI 10 DEX 10 INT 10 LUK 10 CHA 10; points 2; soul II; xp 40.');
    assert.equal(summaryOf(state, 'pack.chat/skills'), 'Wessel skills:\n- Iron Breath (Novice, vit, stamina): Drill-yard breathing.', 'the empty slots are not there');
    assert.equal(summaryOf(state, 'pack.chat/foes'), '', 'no foe, no line');
    assert.equal(summaryOf(state, 'pack.chat/combat-rules'), '', 'a block with no fields has nothing to tell');
    success(await host.sdk.command('dm.set', { module: 'pack.chat/foes', fields: { foe1: 'Sluice Rat A', count1: 1, foe2: 'Rat Swarm', count2: 3, class2: 2, hurt2: 2 } }));
    state = host.head();
    assert.equal(summaryOf(state, 'pack.chat/foes'), 'Foes: Sluice Rat A (Class I); Rat Swarm ×3 (Class II, Wounded).', 'a group of one needs no count, an unhurt one no health');
    await host.send('Hit.', reply(line('character', 'set-health', ' | to: Down')));
    assert.match(summaryOf(host.head(), 'pack.chat/character'), /health Down; /);
    await host.send('Hit again.', reply(line('character', 'set-health', ' | to: Down')));
    assert.match(summaryOf(host.head(), 'pack.chat/character'), /; alive false\.$/, 'a fallen character is told');
    // the prompt really carries these lines, none of the others (a role block is written compact while the RPG is on; with it off it is told like any block)
    host.features.set(LEAN_RPG_FEATURE, true);
    const sent = (await host.send('Next.', 'On.')).request;
    assert.ok(JSON.stringify(sent).includes('Iron Breath (Novice, vit, stamina)'));
    assert.ok(!JSON.stringify(sent).includes('skill1'));
});

test('a party of three with five skills each, a full Foes block and the Combat rules sends well under what it did', async t => {
    const host = await story(t);
    const about = 'A drill-yard washout from Bluewatch who signed on with the Guild anyway. Broad-shouldered, quiet, owes the barge crews a favour. Afraid of deep water, though nobody knows.';
    const set = async (slug, fields) => {
        const all = Object.entries(fields);
        while (all.length) success(await host.sdk.command('dm.set', { module: `pack.chat/${slug}`, fields: Object.fromEntries(all.splice(0, 16)) }));
    };
    for (const [at, who] of ['Wessel', 'Ren', 'Tamsin'].entries()) {
        const sheet = definition('Character'), skills = definition('Skills');
        Object.assign(sheet, { slug: `character-${at}`, name: who });
        Object.assign(skills, { slug: `skills-${at}`, name: `${who} skills` });
        for (const made of [sheet, skills]) success(await host.sdk.command('dm.define', { definition: made }));
        await set(`character-${at}`, { who, about, health: 3, mana: 2, stamina: 2, points: 2, soul: 2, xp: 40, str: 14 });
        const pool = [...SKILL_SETS[at].skills, ...SKILL_SETS[at + 1].skills.slice(0, 2)];
        await set(`skills-${at}`, { who, ...Object.fromEntries(pool.flatMap((skill, slot) => [[`skill${slot + 1}`, skill.name], [`about${slot + 1}`, skill.about], [`stat${slot + 1}`, skill.stat], [`uses${slot + 1}`, skill.uses]])) });
    }
    for (const name of ['Foes', 'Combat rules']) success(await host.sdk.command('dm.define', { definition: definition(name) }));
    await set('foes', { foe1: 'Sluice Rat A', count1: 1, foe2: 'Sluice Rat B', count2: 1, hurt2: 4, foe3: 'Sluice Rat C', count3: 1, hurt3: 2, foe4: 'Rat Swarm', count4: 3, hurt4: 3 });
    const state = host.head();
    const tokens = Object.keys(state.domains.dataModules.active).map(module => estimateTokens(summaryOf(state, module)));
    const total = tokens.reduce((sum, count) => sum + count, 0);
    // The same party was 880 tokens before the tail was written compact; the rest of what these lines hold is what the story reads.
    assert.ok(total <= 650, `${total} tokens`);
    assert.ok(tokens.every(count => count <= DM_LIMITS.roleTailTokens));
});
