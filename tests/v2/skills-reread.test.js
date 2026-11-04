// Skills blocks and the Re-read (SK-FIX222): a Re-read of a reply made before the extra skill slots and the signature mark (the chats in tests/v2/fixtures/skills-2210-*.json
// were written by Story Block 2.21.0) builds what that reply built, so every later change of the block still applies; a Re-read of a 2.22 join seeds what the join seeded
// (the pencil on the reply changes nothing); a block grows only when a learn line would otherwise have no slot; and the follow-ups of the review (Ask mode, character
// files after a level drop, the tail's room, the refusal words).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { LEAN_RPG_TEMPLATES } from '../../src/v2/lean-rpg/templates.js';
import { skillSlots } from '../../src/v2/skill-slots.js';
import { partyLines } from '../../src/v2/lean-rpg/view/changes-lines.js';
import { joinCard, joinDraft, joinOffers } from '../../src/v2/lean-rpg/join.js';
import { buildDefinitions, draftSlots, readDraft, withImport, withSet, withSkill, withSkillPatch, withoutSkill } from '../../src/v2/lean-rpg/view/wizard-data.js';
import { buildCharacterFile, parseCharacterFile } from '../../src/v2/lean-rpg/charfile.js';
import { summaryOf, tailRoom } from '../../src/v2/data-modules/part.js';
import { DM_LIMITS } from '../../src/v2/data-modules/schema.js';
import { estimateTokens } from '../../src/v2/prompt.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const SKILLS = [
    { name: 'Tide Step', about: 'Light footwork on a rocking deck.', stat: 'agi', rank: 'adept' },
    { name: 'Ferry Spark', about: 'A small lantern-flash of magic.', stat: 'int', uses: 'mana' },
    { name: 'Rope Haul', about: 'Hauls a line hand over hand.', stat: 'str', uses: 'stamina', rank: 'expert' },
];
const person = (extra = {}) => ({ id: 'mara', name: 'Mara', aliases: [], about: 'Runs the night ferry.', look: 'Wiry.', start: { place: 'Docks', goal: 'Keep the ferry running.' }, ...extra });
const rawPack = list => ({ id: 'mini', version: '1.0.0', requires: { storyBlock: '^2' }, content: { cast: list } });
const settingsFor = (list, { join = 'auto', formula = 'classic' } = {}) => {
    const raw = rawPack(list);
    const built = validatePack(raw);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    return { features: { 'story-block.rpg': true }, modules: { 'story-block': { rpgJoin: join, rpgFormula: formula } },
        packs: [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }] };
};
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
// A chat written by 2.21.0, opened here. `skills`: the pack now gives Mara signature skills (it did not when the chat was written).
async function opened(t, name, { skills = false, formula = 'classic' } = {}) {
    t.mock.method(console, 'warn', () => {});
    const saved = fixture(name);
    const host = await createHost({ st: { chatMetadata: saved.metadata ?? {} }, settings: settingsFor([person(skills ? { skills: SKILLS } : {})], { formula }) });
    t.after(() => host.close());
    await host.st.loadChat(saved.chat);
    return { host, saved };
}
const dm = host => host.head().domains.dataModules;
const fieldsOf = (host, slug) => dm(host).instances[`pack.chat/${slug}`]?.chat.fields;
const pinOf = (host, slug) => dm(host).active[`pack.chat/${slug}`]?.hash;
const told = host => host.turn.problems().map(problem => problem.message);
const snapshot = (host, slug) => JSON.stringify([fieldsOf(host, slug), pinOf(host, slug)]);
const receiptsAt = (host, index) => host.ctx.chat[index].extra.storySuite.receipts;

// ---- B1, B2: a reply made before the extra slots, read again ------------------------------------------------------------------------------------

for (const [formula, name] of [['classic', 'skills-2210-join-then-learns.json'], ['standard', 'skills-2210-join-then-learns-standard.json']]) {
    test(`B1 (${formula}): a Re-read of a join made before the extra slots keeps the block, its pin and the skills learned later`, { skip }, async t => {
        const { host, saved } = await opened(t, name, { skills: true, formula });
        const before = snapshot(host, 'mara-skills');
        assert.equal(JSON.stringify(fieldsOf(host, 'mara-skills')), JSON.stringify(saved.fields), 'the chat loads as it was written');
        assert.equal(fieldsOf(host, 'mara-skills').skill3, 'Net Throw');
        assert.equal('sig' in fieldsOf(host, 'mara-skills'), false, 'five slots, no signature mark');
        for (const at of [4, 6, 12]) {
            const result = await host.turn.reread(at);
            assert.equal(result.ok, true, `Re-read of ${at}`);
            assert.equal(snapshot(host, 'mara-skills'), before, `fields and pin after the Re-read of ${at}`);
            assert.deepEqual(host.store.problems(), [], `no store problems after ${at}`);
            assert.deepEqual(told(host).filter(message => !/ROLLS|rolled/.test(message)), [], `nothing told after ${at}`);
        }
        const join = receiptsAt(host, 4).find(entry => entry.data?.join?.op === 'added');
        assert.ok(join, 'the join is still a join');
        assert.equal('sigSkills' in join.data, false, 'the pack has skills now, but a join made before them seeds nothing');
        // and the block goes on: a learn line after the Re-read still applies
        await host.send('More.', reply('~ dm mara-skills — taught | kind: learn-4 | name: Oar Sweep | about: Sweeps. | stat: str | uses: stamina'));
        assert.equal(fieldsOf(host, 'mara-skills').skill4, 'Oar Sweep');
        assert.deepEqual(host.store.problems(), []);
    });
}

test('B2: a Re-read of a join or a return that also had learn lines keeps the learn receipts and invents no signature skills', { skip }, async t => {
    const { host } = await opened(t, 'skills-2210-join-learn-same-reply.json', { skills: true });
    const before = snapshot(host, 'mara-skills');
    assert.equal(fieldsOf(host, 'mara-skills').skill1, 'Rope Haul');
    assert.equal(fieldsOf(host, 'mara-skills').skill3, 'Net Throw');
    for (const at of [4, 10]) {
        assert.equal((await host.turn.reread(at)).ok, true, `Re-read of ${at}`);
        const records = receiptsAt(host, at);
        assert.equal(records.some(entry => 'sigSkills' in (entry.data ?? {})), false, `no signature tiles on ${at}`);
        assert.equal(records.some(entry => /Signature skills/.test(entry.summary ?? '')), false, `no signature words on ${at}`);
        assert.equal(snapshot(host, 'mara-skills'), before, `the block after ${at}`);
        assert.deepEqual(host.store.problems(), [], `store ${at}`);
        assert.deepEqual(told(host).filter(message => /signature/i.test(message)), [], `no refused learn line on ${at}`);
    }
    assert.equal(receiptsAt(host, 4).filter(entry => /learn-/.test(entry.summary ?? '')).length, 2, 'both learn lines of the join reply kept their receipts');
    assert.equal(receiptsAt(host, 10).filter(entry => /learn-3/.test(entry.summary ?? '')).length, 1, 'the learn line of the return reply too');
    assert.equal('sig' in fieldsOf(host, 'mara-skills'), false);
});

// ---- B3: the pencil on a join reply ----------------------------------------------------------------------------------------------------------------

async function world(t, { list = [person({ skills: SKILLS })], join = 'auto' } = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: settingsFor(list, { join }) });
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const defs = Object.fromEntries(LEAN_RPG_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = 'wessel'; defs.character.name = 'Wessel'; defs.character.state.who.default = 'Wessel';
    defs.skills.slug = 'wessel-skills'; defs.skills.name = 'Wessel skills'; defs.skills.state.who.default = 'Wessel';
    for (const definition of [defs.character, defs.skills]) assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
    return host;
}

test('B3: the pencil on the join reply, a later learn, then a Re-read of the join: the pin, the pencilled words and the later skill all stay', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara'));
    const joinAt = host.ctx.chat.length - 1;
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/mara-skills', fields: { skill2: 'Ferry Flash', about2: 'Sharper wording.' } })).ok, true);
    await host.send('Teach.', reply('~ dm mara-skills — taught | kind: learn-4 | name: Net Throw | about: Casts a net. | stat: dex | uses: stamina'));
    const live = snapshot(host, 'mara-skills');
    assert.equal(fieldsOf(host, 'mara-skills').skill4, 'Net Throw');
    assert.equal((await host.turn.reread(joinAt)).ok, true);
    assert.equal(snapshot(host, 'mara-skills'), live);
    assert.deepEqual(host.store.problems(), []);
    const join = receiptsAt(host, joinAt).find(entry => entry.data?.join?.op === 'added');
    assert.deepEqual(join.data.sigSkills.map(skill => skill.name), ['Tide Step', 'Ferry Spark', 'Rope Haul'], 'the join seeded what the pack gave, not the pencilled name');
});

// ---- B4: growth only when a learn line would have no slot -----------------------------------------------------------------------------------------

test('B4: a Re-read of a learn reply for a Lv 30 character on a five-slot block changes nothing, and the block does not grow while a slot is free', { skip }, async t => {
    const { host } = await opened(t, 'skills-2210-lv30-learns.json');
    const before = snapshot(host, 'wessel-skills');
    assert.equal(fieldsOf(host, 'wessel-skills').skill2, 'Tide Step');
    for (const at of [4, 6]) {
        assert.equal((await host.turn.reread(at)).ok, true, `Re-read of ${at}`);
        assert.equal(snapshot(host, 'wessel-skills'), before, `after ${at}`);
        assert.deepEqual(host.store.problems(), [], `store ${at}`);
    }
    const pin = pinOf(host, 'wessel-skills');
    await host.send('Learn.', reply('~ dm wessel-skills — taught | kind: learn-3 | name: Net Throw | about: Casts a net. | stat: dex | uses: stamina'));
    assert.equal(pinOf(host, 'wessel-skills'), pin, 'a free slot: the block stays as it is');
    // a line that names a slot the block lacks goes to the free one
    await host.send('Learn.', reply('~ dm wessel-skills — taught | kind: learn-6 | name: Oar Sweep | about: Sweeps. | stat: str | uses: stamina'));
    assert.equal(fieldsOf(host, 'wessel-skills').skill4, 'Oar Sweep');
    assert.equal(pinOf(host, 'wessel-skills'), pin);
    // an update of a skill it holds, a line that is refused for another reason, and an unknown kind leave it alone too
    await host.send('Learn.', reply('~ dm wessel-skills — taught | kind: learn-1 | name: Rope Haul | about: Better words. | stat: str | uses: stamina'));
    await host.send('Learn.', reply('~ dm wessel-skills — taught | kind: learn-2 | name: Odd | about: x. | stat: wis | uses: stamina'));
    assert.equal(pinOf(host, 'wessel-skills'), pin);
    // the fifth fills the block; the sixth has no slot, so the block is extended (Lv 30 opens a sixth) and the line is kept
    await host.send('Learn.', reply('~ dm wessel-skills — taught | kind: learn-5 | name: Keel Drag | about: Drags. | stat: vit | uses: stamina'));
    assert.equal(pinOf(host, 'wessel-skills'), pin);
    await host.send('Learn.', reply('~ dm wessel-skills — taught | kind: learn-6 | name: Wave Read | about: Reads. | stat: int | uses: mana'));
    const growthAt = host.ctx.chat.length - 1;
    assert.notEqual(pinOf(host, 'wessel-skills'), pin, 'the block grew');
    assert.equal(fieldsOf(host, 'wessel-skills').skill6, 'Wave Read');
    const grown = snapshot(host, 'wessel-skills');
    // a Re-read of the reply that grew it grows it again (the reply as it stands holds the grown pin); one before it does not
    assert.equal((await host.turn.reread(growthAt)).ok, true);
    assert.equal(snapshot(host, 'wessel-skills'), grown);
    assert.equal((await host.turn.reread(6)).ok, true);
    assert.equal(snapshot(host, 'wessel-skills'), grown);
    assert.deepEqual(host.store.problems(), []);
});

// ---- F1: Ask mode ---------------------------------------------------------------------------------------------------------------------------------

test('F1: a Re-read of the offer reply keeps the offered skills', { skip }, async t => {
    const host = await world(t, { join: 'ask' });
    await host.send('Mara waits.', reply('+ party Mara | about: a ferrywoman'));
    const at = host.ctx.chat.length - 1;
    const offered = () => receiptsAt(host, at).find(entry => entry.data?.join?.op === 'offer').data.join;
    assert.deepEqual(offered().skills.map(skill => skill.name), ['Tide Step', 'Ferry Spark', 'Rope Haul']);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(offered().skills.map(skill => skill.name), ['Tide Step', 'Ferry Spark', 'Rope Haul'], 'still offered after the Re-read');
    assert.deepEqual(offered().skills.map(skill => skill.rank), [1, 0, 2]);
});

test('F1: Edit first keeps signature skills as written (the pencil\'s rules) and the Skills block it makes writes the join\'s tiles', { skip }, async t => {
    const host = await world(t, { join: 'ask' });
    await host.send('Mara waits.', reply('+ party Mara | about: a ferrywoman'));
    const at = host.ctx.chat.length - 1;
    const offer = receiptsAt(host, at).find(entry => entry.data?.join?.op === 'offer').data.join;
    const card = joinCard(joinOffers([{ index: at, receipt: { data: { join: offer } } }], at, []));
    let draft = joinDraft(card.actions.find(action => action.id === 'edit').payload);
    // stat, resource and rank cannot be changed, a skill cannot be taken out; the name and what it does can be fixed
    const changed = withSkillPatch(draft, 0, { stat: 'str', uses: 'mana', start: 1, rank: 3, name: 'Tide Dance', about: 'Better words.' });
    assert.deepEqual([changed.skills[0].stat, changed.skills[0].uses, changed.skills[0].rank, changed.skills[0].sig], ['agi', 'stamina', 1, true]);
    assert.deepEqual([changed.skills[0].name, changed.skills[0].about], ['Tide Dance', 'Better words.']);
    assert.equal(withoutSkill(draft, 0).skills.length, 3, 'a signature skill stays');
    assert.equal(withSet(draft, { id: 'x', skills: [{ name: 'Spark', stat: 'int', about: 'a', uses: 'mana' }] }).skills.map(skill => skill.name).join(), 'Tide Step,Ferry Spark,Rope Haul,Spark', 'a skill set goes after them');
    draft = withSkill(draft);
    assert.equal(draft.skills.length, 4, 'free slots stay for others');
    assert.equal(withoutSkill(draft, 3).skills.length, 3, 'a skill of the reader\'s own can be taken out');
    // Create: the two defines of the wizard
    const made = buildDefinitions(readDraft({ ...draft, skills: draft.skills.slice(0, 3), name: 'Mara' }), {});
    for (const definition of [made.character, made.skills]) assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
    assert.equal(fieldsOf(host, made.skills.slug).sig, 7);
    const record = host.ctx.chat.at(-1).extra.storySuite;
    const tiles = partyLines(record);
    assert.deepEqual(tiles.slice(1).map(line => [line.text, line.flag]), [['Tide Step', 'signature · Adept'], ['Ferry Spark', 'signature · Novice'], ['Rope Haul', 'signature · Expert']]);
    assert.match(tiles[0].summary, /Mara joined, \+3 skills/);
});

// ---- F2: character files after a level drop ---------------------------------------------------------------------------------------------------------

test('F2: a character file keeps up to eight skills when its level has dropped below the slots they fill', () => {
    const eight = Array.from({ length: 8 }, (_, n) => ({ name: `Skill ${n + 1}`, about: 'x', stat: 'str', uses: 'stamina', rank: n % 4 }));
    const file = parseCharacterFile(JSON.stringify(buildCharacterFile({ level: 30, soul: 4, points: 0, stats: { str: 10, vit: 10, agi: 10, dex: 10, int: 10, luk: 10, cha: 10 }, skills: eight })));
    assert.equal(file.ok, true, JSON.stringify(file));
    assert.equal(file.file.skills.length, 8);
    assert.equal(skillSlots(30), 6, 'the level opens six');
    const { draft } = withImport(readDraft({ name: 'Wessel', kind: 'companion' }), file.file);
    assert.equal(draft.skills.length, 8, 'no cut to the current slots');
    assert.equal(readDraft(draft).skills.length, 8, 'a draft read again keeps them');
    assert.equal(draftSlots(readDraft(draft)), 8);
    assert.equal(withSkill(readDraft(draft)).skills.length, 8, 'but no new one is added');
    const made = buildDefinitions(readDraft(draft), {});
    assert.equal(made.skills.state.skill8.default, 'Skill 8');
    assert.equal(made.skills.state.rank7.default, 2);
    // a draft that holds fewer keeps the level's room
    assert.equal(draftSlots(readDraft({ name: 'Wessel', level: 30, skills: [] })), 6);
});

// ---- F3: the tail's room -------------------------------------------------------------------------------------------------------------------------------

test('F3: the tail reserves room only for skills held past five, and the documents give the measured number', { skip }, async t => {
    const empty = LEAN_RPG_TEMPLATES.find(entry => entry.definition.role === 'skills').definition;
    assert.equal(tailRoom(empty, true, {}), DM_LIMITS.roleTailTokens, 'eight slots, none filled');
    assert.equal(tailRoom(empty, true, { skill1: 'A', skill2: 'B', skill3: 'C', skill4: 'D', skill5: 'E' }), DM_LIMITS.roleTailTokens, 'five held');
    assert.equal(tailRoom(empty, true, { skill1: 'A', skill2: 'B', skill3: 'C', skill4: 'D', skill5: 'E', skill6: 'F', skill8: 'H' }), DM_LIMITS.roleTailTokens + 2 * DM_LIMITS.skillTailTokens);
    assert.equal(tailRoom(empty, false, { skill6: 'F' }), DM_LIMITS.tailTokens, 'the RPG off: an ordinary block');
    // measured: the longest line one skill makes (40-character name, 120 of text, Master) against a block with one skill fewer
    const host = await world(t);
    const make = async count => {
        const definition = structuredClone(empty);
        definition.slug = `long${count}`; definition.name = `Long ${count}`; definition.state.who.default = 'Long';
        for (let n = 1; n <= count; n += 1) { definition.state[`skill${n}`].default = 'N'.repeat(40); definition.state[`about${n}`].default = 'a'.repeat(120); definition.state[`rank${n}`].default = 3; }
        assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
        return estimateTokens(summaryOf(host.head(), `pack.chat/long${count}`));
    };
    const [five, eight] = [await make(5), await make(8)];
    assert.equal(Math.ceil((eight - five) / 3), DM_LIMITS.skillTailTokens, 'the reserve is the measured cost of one skill');
    for (const file of ['../../CHANGELOG.md', '../../docs/v2/RPG.md']) {
        assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), new RegExp(`${DM_LIMITS.skillTailTokens} tokens`), file);
    }
});

// ---- F4, F7: words ---------------------------------------------------------------------------------------------------------------------------------------

test('F4: after a level drop with all eight slots full, the refusal says so and does not promise a slot at Lv 40', { skip }, async t => {
    const host = await world(t);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/wessel', fields: { level: 60 } })).ok, true);
    for (let n = 1; n <= 8; n += 1) await host.send('Learn.', reply(`~ dm wessel-skills — taught | kind: learn-${n} | name: Skill ${n} | about: x. | stat: str | uses: stamina`));
    assert.equal(fieldsOf(host, 'wessel-skills').skill8, 'Skill 8');
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/wessel', fields: { level: 30 } })).ok, true);
    await host.send('Learn.', reply('~ dm wessel-skills — taught | kind: learn-1 | name: Nine | about: x. | stat: str | uses: stamina'));
    const message = told(host).find(text => text.includes('No free skill slot for Nine'));
    assert.ok(message, told(host).join(' | '));
    assert.doesNotMatch(message, /next slot opens/i);
    assert.match(message, /All eight skill slots hold a skill/);
});

test('F7: a refused line on an old block names only the learn kinds the block has, and does not extend it', { skip }, async t => {
    const { host } = await opened(t, 'skills-2210-lv30-learns.json');
    const pin = pinOf(host, 'wessel-skills');
    await host.send('Bad.', reply('~ dm wessel-skills — taught | kind: learn-9 | name: Odd | about: x. | stat: str | uses: stamina'));
    const message = told(host).find(text => text.includes('kind must be'));
    assert.ok(message, told(host).join(' | '));
    assert.match(message, /learn-5/);
    assert.doesNotMatch(message, /learn-6|learn-7|learn-8/);
    assert.equal(pinOf(host, 'wessel-skills'), pin);
    // fill the block, then a line that grows it and is then refused (a stat that is no stat) names the kinds the block had
    for (const [n, name] of [[3, 'C'], [4, 'D'], [5, 'E']]) await host.send('Learn.', reply(`~ dm wessel-skills — taught | kind: learn-${n} | name: ${name} | about: x. | stat: str | uses: stamina`));
    await host.send('Bad.', reply('~ dm wessel-skills — taught | kind: learn-6 | name: Odd | about: x. | stat: wis | uses: stamina'));
    assert.equal(pinOf(host, 'wessel-skills'), pin, 'a refused line takes its growth back');
    assert.ok(told(host).length > 0);
    assert.deepEqual(host.store.problems(), []);
});

// ---- R1, R2: the follow-ups of the re-check -------------------------------------------------------------------------------------------------------

const RETURN_SKILLS = [{ name: 'Tide Step', about: 'Footwork.', stat: 'agi', rank: 'adept' }, { name: 'Ferry Spark', about: 'Magic.', stat: 'int', uses: 'mana' }];
for (const later of ['learn', 'practice']) {
    test(`R1: the pencil on a return reply, a later ${later}, then a Re-read of the return: no store problems, and the receipt keeps the seeded names`, { skip }, async t => {
        const host = await world(t, { list: [person()] });
        await host.send('In.', reply('+ party Mara'));
        await host.send('Out.', reply('- party Mara'));
        assert.equal((await host.packs.packs.install(rawPack([person({ skills: RETURN_SKILLS })]))).ok, true);
        await host.send('Back.', reply('+ party Mara'));
        const backAt = host.ctx.chat.length - 1;
        const seeded = receiptsAt(host, backAt).find(entry => entry.data?.sigSkills)?.data.sigSkills;
        assert.deepEqual(seeded.map(skill => [skill.name, skill.about]), [['Tide Step', 'Footwork.'], ['Ferry Spark', 'Magic.']], 'the receipt records what was seeded, with its words');
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/mara-skills', fields: { skill1: 'Tide Dance', about1: 'Her words.' } })).ok, true);
        await host.send('Next.', reply(later === 'learn' ? '~ dm mara-skills — taught | kind: learn-3 | name: Net Throw | about: Casts a net. | stat: dex | uses: stamina'
            : '+ dm mara-skills — practised Ferry Spark | kind: practice-2 | amount: 15'));
        const live = snapshot(host, 'mara-skills');
        assert.equal((await host.turn.reread(backAt)).ok, true);
        assert.equal(snapshot(host, 'mara-skills'), live);
        assert.deepEqual(host.store.problems(), []);
        assert.deepEqual(receiptsAt(host, backAt).find(entry => entry.data?.sigSkills)?.data.sigSkills, seeded, 'the receipt keeps the seeded names');
        host.store.rebuild();
        assert.equal(snapshot(host, 'mara-skills'), live);
    });
}

test('R2: a Re-read does not send a learn-6 line to a free lower slot unless the reply, as it stood, held that skill there', { skip }, async t => {
    const { host } = await opened(t, 'skills-2210-lv30-learns.json');
    // a reply of 2.21 whose learn-6 was refused (the block had five slots): its words say learn-6 and it holds no Oar Sweep
    const at = 6;
    host.ctx.chat[at].mes = host.ctx.chat[at].mes.replace('kind: learn-2 | name: Tide Step | about: Footwork.', 'kind: learn-6 | name: Oar Sweep | about: Sweeps.');
    assert.match(host.ctx.chat[at].mes, /learn-6/);
    assert.equal((await host.turn.reread(at)).ok, true);
    const fields = fieldsOf(host, 'wessel-skills');
    assert.equal(Object.keys(fields).some(key => /^skill\d$/.test(key) && fields[key] === 'Oar Sweep'), false, 'the line stays refused');
    assert.ok(told(host).some(text => text.includes('kind must be')), told(host).join(' | '));
});
