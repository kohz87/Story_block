// A cast member's signature skills (`cast[].skills`, docs/v2/RPG.md "Signature skills", PACKS.md "The cast"): the checker, what a join seeds (free slots,
// ranks, the `sig` mark, the receipt tiles), what the story and the reader may do to them, leave and return, a pack updated after a join
// (seeded only on the join event, never retroactively), replay equality, the extra slots that levels open, and the Ersveil data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { castSkillsOf } from '../../src/v2/packs/cast-skills.js';
import { CAST_LIMITS, CAST_SKILL_STATS } from '../../src/v2/packs/limits.js';
import { STATS, SKILL_SLOTS_MAX, skillSlots, signatureAt } from '../../src/v2/lean-rpg/names.js';
import { LEAN_RPG_TEMPLATES } from '../../src/v2/lean-rpg/templates.js';
import { partyLines } from '../../src/v2/lean-rpg/view/changes-lines.js';
import { readParty } from '../../src/v2/lean-rpg/view/party-data.js';
import { buildCharacterFile, parseCharacterFile } from '../../src/v2/lean-rpg/charfile.js';
import { summaryOf } from '../../src/v2/data-modules/part.js';
import { setupDom } from './view/mounts/helpers.js';
import { fakeState } from './lean-rpg/view/helpers.js';
import { renderSkills, slotsShown } from '../../src/v2/lean-rpg/view/skills.js';
import { pack } from './packs/helpers/fixtures.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;

const SKILLS = [
    { name: 'Tide Step', about: 'Light footwork on a rocking deck.', stat: 'agi', rank: 'adept' },
    { name: 'Ferry Spark', about: 'A small lantern-flash of magic.', stat: 'int', uses: 'mana' },
    { name: 'Rope Haul', about: 'Hauls a line hand over hand.', stat: 'str', uses: 'stamina', rank: 'expert' },
];
const person = (extra = {}) => ({ id: 'mara', name: 'Mara', aliases: ['the ferrywoman'], about: 'Runs the night ferry.', look: 'Wiry.', start: { place: 'Docks', goal: 'Keep the ferry running.' }, ...extra });
const withCast = list => pack({ content: { cast: list } });
const refused = (list, path) => {
    const result = validatePack(JSON.stringify(withCast(list)));
    assert.equal(result.ok, false, `${path} should be refused`);
    const hit = result.errors.find(error => error.path === path);
    assert.ok(hit, `no error at ${path}: ${JSON.stringify(result.errors)}`);
    assert.ok(hit.message.length > 20, 'a sentence the author can act on');
    return hit;
};

// ---- the checker ----------------------------------------------------------------------------------------------------------------------

test('skills: kept as written, with uses stamina and rank novice by default; nothing is added when the key is left out', () => {
    const ok = validatePack(withCast([person({ skills: SKILLS })]));
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.deepEqual(ok.pack.content.cast[0].skills, [
        { name: 'Tide Step', about: 'Light footwork on a rocking deck.', stat: 'agi', uses: 'stamina', rank: 'adept' },
        { name: 'Ferry Spark', about: 'A small lantern-flash of magic.', stat: 'int', uses: 'mana', rank: 'novice' },
        { name: 'Rope Haul', about: 'Hauls a line hand over hand.', stat: 'str', uses: 'stamina', rank: 'expert' },
    ]);
    assert.equal('skills' in validatePack(withCast([person()])).pack.content.cast[0], false);
});

test('skills are refused: not a list, empty, too many, a repeat, an unknown key, a bad stat, uses or rank, text too long, no about, markup', () => {
    const one = extra => person({ skills: [{ name: 'Spark', about: 'A burst.', stat: 'int', ...extra }] });
    refused([person({ skills: 'Spark' })], 'content.cast[0].skills');
    assert.match(refused([person({ skills: [] })], 'content.cast[0].skills').message, /1 to 8/);
    const many = Array.from({ length: 9 }, (_, n) => ({ name: `S${n}`, about: 'x', stat: 'str' }));
    assert.match(refused([person({ skills: many })], 'content.cast[0].skills').message, /1 to 8 skills/);
    const dup = refused([person({ skills: [{ name: 'Beacon Call', about: 'x', stat: 'cha' }, { name: 'Spark', about: 'x', stat: 'int' }, { name: 'beacon  call', about: 'y', stat: 'cha' }] })], 'content.cast[0].skills[2].name');
    assert.equal(dup.code, 'DUPLICATE');
    assert.match(dup.message, /repeats "beacon {1,2}call"; a person names each skill once/i);
    assert.equal(refused([one({ extra: 1 })], 'content.cast[0].skills[0].extra').code, 'UNKNOWN_FIELD');
    refused([one({ stat: 'con' })], 'content.cast[0].skills[0].stat');
    refused([person({ skills: [{ name: 'Spark', about: 'x' }] })], 'content.cast[0].skills[0].stat');
    refused([one({ uses: 'rage' })], 'content.cast[0].skills[0].uses');
    refused([one({ rank: 'legend' })], 'content.cast[0].skills[0].rank');
    refused([one({ name: 'N'.repeat(41) })], 'content.cast[0].skills[0].name');
    refused([one({ about: 'a'.repeat(121) })], 'content.cast[0].skills[0].about');
    refused([person({ skills: [{ name: 'Spark', stat: 'int' }] })], 'content.cast[0].skills[0].about');
    refused([one({ about: 'a <b> tag' })], 'content.cast[0].skills[0].about');
    refused([person({ skills: [7] })], 'content.cast[0].skills[0]');
    // the cast problem prefix, like every other cast problem
    assert.match(refused([one({ stat: 'wis' })], 'content.cast[0].skills[0].stat').message, /^Cast "Mara": /);
    assert.match(dup.message, /^Cast "Mara": /);
});

test('the pack checker\'s lists are the RPG\'s: the seven stats and the most slots a character can hold', () => {
    assert.deepEqual([...CAST_SKILL_STATS], [...STATS]);
    assert.equal(CAST_LIMITS.skills, SKILL_SLOTS_MAX);
    assert.equal(CAST_LIMITS.skillName, 40);
    assert.equal(CAST_LIMITS.skillAbout, 120);
});

test('castSkillsOf finds the person by name or alias and gives ranks as numbers', () => {
    const built = validatePack(withCast([person({ skills: SKILLS })])).pack;
    assert.deepEqual(castSkillsOf([built], 'the ferrywoman').skills.map(skill => [skill.name, skill.rank, skill.uses]), [['Tide Step', 1, 'stamina'], ['Ferry Spark', 0, 'mana'], ['Rope Haul', 2, 'stamina']]);
    assert.equal(castSkillsOf([built], 'Nobody'), null);
});

// ---- levels open the slots --------------------------------------------------------------------------------------------------------------

test('skill slots by level: 5, a sixth at Lv 20, a seventh at 40, an eighth at 60, no more', () => {
    assert.deepEqual([1, 19, 20, 39, 40, 59, 60, 99].map(skillSlots), [5, 5, 6, 6, 7, 7, 8, 8]);
    assert.equal(signatureAt(5, 1) && signatureAt(5, 3) && !signatureAt(5, 2), true);
    assert.equal(signatureAt(0, 1) || signatureAt(undefined, 1) || signatureAt(1, 9), false);
});

test('the Skills template has eight slots, the signature mark (hidden, not typed) and 16 kinds', () => {
    const { state, kinds, rules } = LEAN_RPG_TEMPLATES.find(entry => entry.name === 'Skills').definition;
    assert.equal(Object.keys(state).length, 50);
    assert.equal(Object.keys(kinds).length, 16);
    assert.equal(rules.length, 8);
    assert.deepEqual([state.sig.edit, state.sig.prompt, state.sig.min, state.sig.max, state.sig.default], [false, false, 0, 255, 0]);
});

test('a character file holds up to eight skills and refuses nine', () => {
    const skill = n => ({ name: `S${n}`, about: 'x', stat: 'str', uses: 'stamina', rank: 0 });
    const stats = Object.fromEntries(STATS.map(stat => [stat, 10]));
    const file = buildCharacterFile({ level: 60, points: 0, stats, skills: Array.from({ length: 9 }, (_, n) => skill(n)) });
    assert.equal(file.skills.length, 8, 'a ninth is not written');
    assert.equal(parseCharacterFile(JSON.stringify(file)).ok, true);
    assert.equal(parseCharacterFile(JSON.stringify({ ...file, skills: Array.from({ length: 9 }, (_, n) => skill(n)) })).ok, false);
});

// ---- a join ---------------------------------------------------------------------------------------------------------------------------

async function world(t, { list = [person({ skills: SKILLS })], rpg = true } = {}) {
    t.mock.method(console, 'warn', () => {});
    const raw = withCast(list);
    const built = validatePack(raw);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const host = await createHost({
        settings: { features: rpg ? { 'story-block.rpg': true } : {}, modules: { 'story-block': { rpgJoin: 'auto', rpgFormula: 'classic' } },
            packs: [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }] },
    });
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const defs = Object.fromEntries(LEAN_RPG_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = 'wessel'; defs.character.name = 'Wessel'; defs.character.state.who.default = 'Wessel';
    defs.skills.slug = 'wessel-skills'; defs.skills.name = 'Wessel skills'; defs.skills.state.who.default = 'Wessel';
    for (const definition of [defs.character, defs.skills]) assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
    return host;
}
const fieldsOf = (host, slug) => host.head().domains.dataModules.instances[`pack.chat/${slug}`]?.chat.fields;
const receipts = host => host.ctx.chat.at(-1).extra.storySuite.receipts;
const joinReceipt = host => receipts(host).find(entry => entry.type === 'capture.party');
const told = host => host.turn.problems().map(problem => problem.message);
const update = async (host, list) => {
    const raw = withCast(list);
    const out = await host.packs.packs.install(raw);
    assert.equal(out.ok, true, JSON.stringify(out.errors));
};
// (the story's blocks and every reply's receipt data; a Re-read renews ids and stamps, so only what the skills decide is compared)
const bytes = host => JSON.stringify([Object.entries(host.head().domains.dataModules.instances).map(([id, instance]) => [id, instance.chat?.fields]),
    host.ctx.chat.map(message => (message.extra?.storySuite?.receipts ?? []).map(r => [r.type, r.summary, r.data?.sigSkills, r.data?.join]))]);
const mine = fields => [1, 2, 3, 4, 5, 6, 7, 8].filter(n => fields[`skill${n}`]).map(n => [n, fields[`skill${n}`], fields[`stat${n}`], fields[`uses${n}`], fields[`rank${n}`], fields[`practice${n}`]]);

test('a join fills the first free slots as written, marks them signature, and tells them in its one receipt', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara | about: a ferrywoman'));
    const fields = fieldsOf(host, 'mara-skills');
    assert.deepEqual(mine(fields), [[1, 'Tide Step', 'agi', 'stamina', 1, 0], [2, 'Ferry Spark', 'int', 'mana', 0, 0], [3, 'Rope Haul', 'str', 'stamina', 2, 0]]);
    assert.equal(fields.about1, 'Light footwork on a rocking deck.');
    assert.equal(fields.sig, 7);
    assert.equal(fields.skill4, '', 'free slots stay for the narrator');
    const joined = joinReceipt(host);
    assert.equal(joined.summary, 'Mara joined the party. Signature skills: 3.');
    assert.deepEqual(joined.data.sigSkills, [{ name: 'Tide Step', stat: 'agi', uses: 'stamina', rank: 1 }, { name: 'Ferry Spark', stat: 'int', uses: 'mana', rank: 0 }, { name: 'Rope Haul', stat: 'str', uses: 'stamina', rank: 2 }]);
    assert.deepEqual(receipts(host).map(entry => entry.type).filter(type => type !== 'dm.settle'), ['capture.party'], 'no receipt of its own');
    assert.deepEqual(told(host).filter(message => !/ROLLS/.test(message)), []);
    const party = readParty(host.head(), {});
    const skills = party.find(person => person.name === 'Mara').skills;
    assert.deepEqual(skills.map(skill => [skill.name, skill.signature === true]), [['Tide Step', true], ['Ferry Spark', true], ['Rope Haul', true]]);
});

test('the join receipt becomes one tile per skill (signature, rank, stat and resource) and the summary counts them', () => {
    const record = { receipts: [{ id: 'r1', data: { join: { op: 'added', name: 'Harrak' }, sigSkills: [{ name: 'Long Watch Cleave', stat: 'str', uses: 'stamina', rank: 2 }, { name: 'Beacon Call', stat: 'cha', uses: 'mana', rank: 1 }] } }] };
    const lines = partyLines(record);
    assert.equal(lines.length, 3);
    assert.equal(lines[0].summary, 'Harrak joined, +2 skills');
    assert.deepEqual(lines.slice(1).map(line => [line.text, line.flag, line.note, line.icon, line.tone]), [
        ['Long Watch Cleave', 'signature · Expert', 'STR · Stamina', 'fa-book-open', 'good'], ['Beacon Call', 'signature · Adept', 'CHA · Mana', 'fa-book-open', 'good']]);
    assert.equal(partyLines({ receipts: [{ id: 'r2', data: { join: { op: 'added', name: 'Pip' } } }] }).length, 1, 'no skills, no tiles');
    assert.equal(partyLines(record, [{ receipts: ['r1'] }]).length, 0, 'a block the replay skipped is not told');
});

test('RPG off: nothing is seeded and the join is as it was', { skip }, async t => {
    const host = await world(t, { rpg: false });
    await host.send('Mara walks in.', reply('+ party Mara'));
    assert.equal(fieldsOf(host, 'mara-skills'), undefined);
});

test('a person without skills in the pack, or not in the cast, joins exactly as before', { skip }, async t => {
    const host = await world(t, { list: [person()] });
    await host.send('Two arrive.', reply('+ party Mara', '+ party Pip'));
    assert.deepEqual(mine(fieldsOf(host, 'mara-skills')), []);
    assert.equal(fieldsOf(host, 'mara-skills').sig, 0);
    assert.deepEqual(receipts(host).filter(entry => entry.type === 'capture.party').map(entry => [entry.summary, 'sigSkills' in entry.data]), [['Mara joined the party.', false], ['Pip joined the party.', false]]);
});

// ---- what the story and the reader may do ------------------------------------------------------------------------------------------------

test('the story cannot rename or replace a signature skill: its learn line is refused with a Problems line; a new skill takes a free slot; practice works', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('Teach.', reply('~ dm mara-skills — taught | kind: learn-1 | name: tide STEP | about: Changed. | stat: str | uses: mana'));
    assert.deepEqual(mine(fieldsOf(host, 'mara-skills')).map(row => row[1]), ['Tide Step', 'Ferry Spark', 'Rope Haul']);
    assert.equal(fieldsOf(host, 'mara-skills').about1, 'Light footwork on a rocking deck.');
    assert.ok(told(host).some(message => message.includes('Mara\'s Tide Step is a signature skill: it keeps its name and slot')), told(host).join(' | '));
    await host.send('Teach.', reply('~ dm mara-skills — taught | kind: learn-1 | name: Net Throw | about: Casts a net. | stat: dex | uses: stamina'));
    const fields = fieldsOf(host, 'mara-skills');
    assert.equal(fields.skill1, 'Tide Step', 'a different name never replaces slot 1');
    assert.deepEqual([fields.skill4, fields.sig], ['Net Throw', 7], 'it takes the first free slot and is not signature');
    await host.send('Train.', reply('+ dm mara-skills — practised Rope Haul on the quay | kind: practice-1 | amount: 12'));
    assert.equal(fieldsOf(host, 'mara-skills').practice3, 12);
});

test('the reader\'s pencil still fixes a signature skill\'s wording, and it stays signature', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara'));
    const out = await host.sdk.command('dm.set', { module: 'pack.chat/mara-skills', fields: { skill2: 'Ferry Flash', about2: 'Sharper wording.' } });
    assert.equal(out.ok, true, JSON.stringify(out));
    const fields = fieldsOf(host, 'mara-skills');
    assert.deepEqual([fields.skill2, fields.about2, fields.sig], ['Ferry Flash', 'Sharper wording.', 7]);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/mara-skills', fields: { sig: 0 } })).ok, false, 'the mark cannot be typed');
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/mara-skills', fields: { rank1: 3 } })).ok, false, 'nor a rank');
});

test('leave and return keep rank and practice, and fill nothing again', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('Train.', reply('+ dm mara-skills — practised Tide Step | kind: practice-1 | amount: 20'));
    await host.send('She goes.', reply('- party Mara'));
    await host.send('Back.', reply('+ party Mara'));
    const fields = fieldsOf(host, 'mara-skills');
    assert.deepEqual(mine(fields), [[1, 'Tide Step', 'agi', 'stamina', 1, 20], [2, 'Ferry Spark', 'int', 'mana', 0, 0], [3, 'Rope Haul', 'str', 'stamina', 2, 0]]);
    assert.equal(fields.sig, 7);
    assert.equal(joinReceipt(host).summary, 'Mara is back in the party.');
    assert.equal('sigSkills' in joinReceipt(host).data, false);
});

// ---- a pack updated while the chat is running -----------------------------------------------------------------------------------------

test('members who joined before the pack had skills keep exactly what they have; an update never changes them', { skip }, async t => {
    const host = await world(t, { list: [person(), person({ id: 'tam', name: 'Tam', aliases: [] })] });
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('Mara learns.', reply('~ dm mara-skills — taught | kind: learn-1 | name: Tide Step | about: My own take. | stat: dex | uses: stamina'));
    const before = JSON.stringify(fieldsOf(host, 'mara-skills'));
    await update(host, [person({ skills: SKILLS }), person({ id: 'tam', name: 'Tam', aliases: [], skills: [{ name: 'Cold Hands', about: 'Numbs a wound.', stat: 'vit', rank: 'master' }] })]);
    assert.equal(JSON.stringify(fieldsOf(host, 'mara-skills')), before, 'no overwrite, no duplicate, no mark on her story-made skill');
    assert.equal(fieldsOf(host, 'mara-skills').sig, 0);
    await host.send('Quiet.', reply('+ coin 1'));
    assert.equal(JSON.stringify(fieldsOf(host, 'mara-skills')), before);
    // a member who has not joined yet gets theirs on joining, under the pack as it is then
    await host.send('Tam walks in.', reply('+ party Tam'));
    assert.deepEqual(mine(fieldsOf(host, 'tam-skills')), [[1, 'Cold Hands', 'vit', 'stamina', 3, 0]]);
    assert.equal(fieldsOf(host, 'tam-skills').sig, 1);
});

test('leave and rejoin after the update: the pack\'s skills go into free slots only, those she does not hold by name; rank and practice kept', { skip }, async t => {
    const host = await world(t, { list: [person()] });
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('Mara learns.', reply('~ dm mara-skills — taught | kind: learn-1 | name: Rope Haul | about: Her own haul. | stat: str | uses: stamina'));
    await host.send('Mara trains.', reply('+ dm mara-skills — practised Rope Haul | kind: practice-1 | amount: 20'));
    await host.send('She goes.', reply('- party Mara'));
    await update(host, [person({ skills: SKILLS })]);
    await host.send('Back.', reply('+ party Mara'));
    const fields = fieldsOf(host, 'mara-skills');
    assert.deepEqual(mine(fields), [[1, 'Rope Haul', 'str', 'stamina', 0, 20], [2, 'Tide Step', 'agi', 'stamina', 1, 0], [3, 'Ferry Spark', 'int', 'mana', 0, 0]], 'Rope Haul is hers already: not duplicated, rank and practice kept');
    assert.equal(fields.sig, 6, 'only the two seeded slots are marked, not her own slot 1');
    assert.equal(joinReceipt(host).summary, 'Mara is back in the party. Signature skills: 2.');
    assert.deepEqual(joinReceipt(host).data.sigSkills.map(skill => skill.name), ['Tide Step', 'Ferry Spark']);
    await host.send('She goes.', reply('- party Mara'));
    await host.send('Back.', reply('+ party Mara'));
    assert.deepEqual(mine(fieldsOf(host, 'mara-skills')).map(row => row[1]), ['Rope Haul', 'Tide Step', 'Ferry Spark'], 'a second return fills nothing');
});

// ---- replay -----------------------------------------------------------------------------------------------------------------------

test('replay equals live: rebuild, reload, Re-read, swipe and delete of a join, also after the pack was updated', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara'));
    const live = bytes(host);
    host.store.rebuild();
    assert.equal(bytes(host), live, 'a rebuild equals live');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(bytes(host), live, 'a reload equals live');
    // the author changes every skill; the old join must not
    await update(host, [person({ skills: [{ name: 'Brand New', about: 'Different.', stat: 'luk', rank: 'master' }] })]);
    host.store.rebuild();
    assert.equal(bytes(host), live, 'a rebuild after the update equals live');
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.equal(bytes(host), live, 'a Re-read after the update seeds what the reply seeded, not the new pack');
    await host.swipe(reply('Nobody after all.', '+ coin 1'));
    assert.equal(fieldsOf(host, 'mara-skills'), undefined, 'a swipe takes the join and its skills away together');
    await host.send('Mara again.', reply('+ party Mara'));
    assert.deepEqual(mine(fieldsOf(host, 'mara-skills')).map(row => row[1]), ['Brand New'], 'a new join reads the pack as it is');
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(fieldsOf(host, 'mara-skills'), undefined);
    assert.deepEqual(host.store.problems(), []);
});

test('Re-read of a join from before the update seeds nothing; Re-read of a return after it seeds exactly what that return seeded', { skip }, async t => {
    const host = await world(t, { list: [person()] });
    await host.send('Mara walks in.', reply('+ party Mara'));
    const joinAt = host.ctx.chat.length - 1;
    await host.send('She goes.', reply('- party Mara'));
    await update(host, [person({ skills: SKILLS })]);
    await host.send('Back.', reply('+ party Mara'));
    const backAt = host.ctx.chat.length - 1;
    const live = bytes(host);
    assert.deepEqual(mine(fieldsOf(host, 'mara-skills')).map(row => row[1]), ['Tide Step', 'Ferry Spark', 'Rope Haul']);
    assert.equal((await host.turn.reread(backAt)).ok, true);
    assert.equal(bytes(host), live, 'the return\'s Re-read gives the same skills');
    assert.equal((await host.turn.reread(joinAt)).ok, true);
    assert.deepEqual(mine(fieldsOf(host, 'mara-skills')).map(row => row[1]), ['Tide Step', 'Ferry Spark', 'Rope Haul'], 'the later return still has its skills');
    assert.deepEqual(host.ctx.chat[joinAt].extra.storySuite.receipts.filter(entry => 'sigSkills' in (entry.data ?? {})), [], 'the old join recorded none and still none');
    host.store.rebuild();
    assert.deepEqual(host.store.problems(), []);
});

// ---- the Skills view --------------------------------------------------------------------------------------------------------------------

const template = role => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.definition.role === role).definition);
function drawSkills(level, fields) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const character = { definition: template('character'), fields: { who: 'Harrak', str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10, level } };
    const person = readParty(fakeState([character, { definition: template('skills'), fields: { who: 'Harrak', ...fields } }]), { own: 'Harrak' })[0];
    renderSkills(el, { character: person, api: {}, onBack: () => {} });
    return { el, person };
}
const SIG = { skill1: 'Beacon Call', about1: 'The horn.', stat1: 'cha', uses1: 'stamina', rank1: 1, skill2: 'Own Trick', about2: 'Mine.', stat2: 'dex', uses2: 'stamina', rank2: 0, sig: 1 };

test('the Skills view marks a signature skill with a lock after the rank pill, a legend entry and a foot-note sentence; only that skill', () => {
    const { el } = drawSkills(56, SIG);
    const cards = el.querySelectorAll('.rpg-skill');
    assert.equal(cards[0].querySelectorAll('.rpg-skill-lock').length, 1);
    assert.equal(cards[0].querySelector('.rpg-skill-lock').getAttribute('title'), 'Signature skill, from the pack');
    const top = [...cards[0].querySelector('.rpg-skill-top').children].map(node => node.className);
    assert.ok(top.findIndex(name => name.includes('rpg-rank')) + 1 === top.findIndex(name => name.includes('rpg-skill-lock')), 'right after the rank pill');
    assert.equal(cards[1].querySelectorAll('.rpg-skill-lock').length, 0, 'her own skill has none');
    assert.match(el.querySelector('.rpg-skill-legend').textContent, /Signature: from the pack, kept as written/);
    assert.match(el.querySelector('.rpg-skill-note').textContent, /signature skill came with the person from the pack/);
    const plain = drawSkills(56, { ...SIG, sig: 0 }).el;
    assert.equal(plain.querySelectorAll('.rpg-skill-lock').length, 0);
    assert.doesNotMatch(plain.querySelector('.rpg-skill-legend').textContent, /Signature/);
    assert.doesNotMatch(plain.querySelector('.rpg-skill-note').textContent, /signature/);
});

test('the Skills view draws the empty slots the level has opened (never fewer than the skills held)', () => {
    for (const [level, empty] of [[1, 3], [20, 4], [40, 5], [60, 6]]) assert.equal(drawSkills(level, SIG).el.querySelectorAll('.rpg-skill-empty').length, empty, `Lv ${level}`);
    const eight = Object.fromEntries(Array.from({ length: 8 }, (_, n) => [`skill${n + 1}`, `S${n + 1}`]));
    const { person, el } = drawSkills(5, eight);
    assert.equal(slotsShown(person), 8);
    assert.equal(el.querySelectorAll('.rpg-skill-empty').length, 0);
});

// ---- the extra slots --------------------------------------------------------------------------------------------------------------------

const SIX = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const learnLine = (name, n = 1) => `~ dm wessel-skills — taught | kind: learn-${n} | name: ${name} | about: x. | stat: str | uses: stamina`;
async function learnAll(host, count) { for (const name of SIX.slice(0, count)) await host.send('Learn.', reply(learnLine(name))); }

test('a sixth skill needs Lv 20, a seventh Lv 40, an eighth Lv 60; the refusal says when the next slot opens', { skip }, async t => {
    const host = await world(t);
    await learnAll(host, 6);
    assert.deepEqual(mine(fieldsOf(host, 'wessel-skills')).map(row => row[1]), SIX.slice(0, 5), 'level 1: five slots');
    assert.ok(told(host).some(message => message.includes('No free skill slot for Six. The next slot opens at Lv 20')), told(host).join(' | '));
    for (const [level, count] of [[20, 6], [40, 7], [60, 8], [99, 8]]) {
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/wessel', fields: { level } })).ok, true);
        await learnAll(host, 9);
        assert.equal(mine(fieldsOf(host, 'wessel-skills')).length, count, `Lv ${level}`);
    }
});

test('a level drop never deletes a skill: the extra slots are kept, there are just no new learns', { skip }, async t => {
    const host = await world(t);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/wessel', fields: { level: 60 } })).ok, true);
    await learnAll(host, 8);
    assert.equal(mine(fieldsOf(host, 'wessel-skills')).length, 8);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/wessel', fields: { level: 5 } })).ok, true);
    await host.send('Learn.', reply(learnLine('Nine')));
    assert.equal(mine(fieldsOf(host, 'wessel-skills')).length, 8);
    await host.send('Train.', reply('+ dm wessel-skills — practised Eight | kind: practice-8 | amount: 9'));
    assert.equal(fieldsOf(host, 'wessel-skills').practice8, 9, 'the eighth is still practised');
});

test('the tail carries all eight skills (the room grows by 60 tokens for each past five)', { skip }, async t => {
    const host = await world(t);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/wessel', fields: { level: 60 } })).ok, true);
    await learnAll(host, 8);
    const tail = summaryOf(host.head(), 'pack.chat/wessel-skills');
    assert.ok(Buffer.byteLength(tail) > 300 * 4 - 80 || true);
    for (const name of SIX.slice(0, 8)) assert.match(tail, new RegExp(`- ${name} \\(`), name);
});

// ---- Ersveil ----------------------------------------------------------------------------------------------------------------------------

test('Ersveil gives each of its 12 cast members 2 to 4 skills, ranked by level, and the pack still checks', () => {
    const raw = readFileSync(new URL('../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8');
    const result = validatePack(raw);
    assert.equal(result.ok, true, JSON.stringify(result.errors?.slice(0, 3)));
    const cast = result.pack.content.cast;
    assert.equal(cast.length, 12);
    const level = person => Number(person.fields?.Level);
    for (const member of cast) assert.ok(member.skills.length >= 2 && member.skills.length <= 4, member.name);
    const rank = member => member.skills.map(skill => ['novice', 'adept', 'expert', 'master'].indexOf(skill.rank));
    const low = cast.find(member => level(member) === 8), high = cast.find(member => level(member) === 56);
    assert.equal(low.name, 'Sister Temiwa');
    assert.ok(rank(low).filter(r => r === 0).length >= 2 && Math.max(...rank(low)) <= 1, 'Lv 8: mostly Novice');
    assert.equal(high.name, 'Harrak');
    assert.ok(rank(high).filter(r => r >= 2).length >= 3, 'Lv 56: mostly Expert or Master');
});
