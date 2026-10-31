// Companions who join (mockup section 8; src/v2/lean-rpg/join.js, data-modules/part.js): the setting (Ask, Automatically, Off), the narrator's
// `+ party` line in the grammar, what a line makes (a Character and an empty Skills block, stats 10, the best stat 14, Soul Class as written
// but never above the party's highest, bars full), the plain refusals, Ask's card (Add to party, Edit first, No), `- party` (Left, kept) and
// that a swipe, a delete, a Re-read, a rebuild and a reload all treat it like any other line of the reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { PARTY_MAX, JOINS, JOIN_SETTING, LEAN_RPG_FEATURE } from '../../../src/v2/lean-rpg/names.js';
import { JOIN_ADD, JOIN_NO, checkJoin, joinCard, joinDefinitions, joinDraft, joinGrammar, joinMode, joinOffers, partyCap, partyOf, readJoin, soulOf } from '../../../src/v2/lean-rpg/join.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { partyLines } from '../../../src/v2/lean-rpg/view/changes-lines.js';
import { fakeState, characterDefinition, skillsDefinition } from './view/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MARA = '+ party Mara | about: a hedge-witch from Kvildal | class: IV | best: int';
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// A host with the RPG on and Wessel (Soul Class III) already in the party, made from the real templates.
async function world({ mode = 'auto', feature = true, wessel = true } = {}) {
    const host = await createHost({ settings: { modules: { 'story-block': { rpgJoin: mode } } } });
    if (feature) host.features.set(CORE_FEATURE.leanRpg, true);
    await host.send('Begin.', 'Opening.');
    if (wessel) await make(host, 'Wessel', 3);
    return host;
}
async function make(host, who, soul = 1) {
    const defs = Object.fromEntries(LEAN_RPG_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = who.toLowerCase(); defs.character.name = who; defs.character.state.who.default = who; defs.character.state.soul.default = soul;
    defs.skills.slug = `${who.toLowerCase()}-skills`; defs.skills.name = `${who}'s skills`; defs.skills.state.who.default = who;
    for (const definition of [defs.character, defs.skills]) assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
}
const blocks = host => Object.keys(host.head().domains.dataModules?.active ?? {}).sort();
const fields = (host, slug) => host.sdk.query('dataModules.view', { module: `pack.chat/${slug}` })?.chat;
const problems = host => host.turn.problems().filter(item => item.code !== 'ROLLS_SKIPPED').map(item => item.message);
const statics = host => host.registry.contexts().map(context => context.static ?? '').join('\n');
const grammar = host => host.registry.contexts().flatMap(context => context.kinds).filter(entry => entry.kind === 'party').map(entry => entry.grammar);
const lastReceipts = host => host.ctx.chat.at(-1).extra.storySuite.receipts;
async function rebuilt(host, label) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${label}: a rebuild gives the live story`);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, `${label}: a reload gives the live story`);
    assert.deepEqual(host.store.problems(), [], `${label}: nothing left inactive`);
}

// ---- the line, read ------------------------------------------------------------------------------------------------------------------

test('the party line is read: name, about (240, whole characters), class I to IX or 1 to 9, best one of the seven stats; plain errors for the rest', () => {
    const line = { op: '+', name: 'Mara', text: '', labels: { about: 'a hedge-witch', class: 'iv', best: 'INT' } };
    assert.deepEqual(readJoin(line), { op: '+', name: 'Mara', about: 'a hedge-witch', soul: 4, best: 'int' });
    assert.deepEqual(readJoin({ op: '+', name: ' Mara  Vell ', labels: {} }), { op: '+', name: 'Mara Vell', about: '', soul: 1, best: '' }, 'class and best are optional');
    assert.equal(readJoin({ op: '+', name: 'Mara', labels: { class: '7' } }).soul, 7);
    assert.equal(readJoin({ op: '-', name: 'Mara' }).op, '-');
    assert.match(readJoin({ op: '+', name: 'Mara', labels: { class: 'X' } }).error, /class must be a Soul Class from I to IX/);
    assert.match(readJoin({ op: '+', name: 'Mara', labels: { best: 'wits' } }).error, /best must be one of str, vit, agi, dex, int, luk, cha/);
    assert.match(readJoin({ op: '!', name: 'Mara', labels: {} }).error, /not a party line/);
    assert.match(readJoin({ op: '+', name: '', labels: {} }).error, /needs a name/);
    assert.match(readJoin({ op: '+', name: 'M'.repeat(41), labels: {} }).error, /at most 40 characters/);
    const long = readJoin({ op: '+', name: 'Mara', labels: { about: `${'a'.repeat(239)}\u{1F600}${'b'.repeat(20)}` } }).about;
    assert.equal([...long].length, 240, 'the first 240 characters');
    assert.equal(long.endsWith('\u{1F600}'), true, 'cut between characters, never inside one');
    assert.deepEqual(['I', 'ix', '1', '9', '0', '10', 'x', ''].map(soulOf), [1, 9, 1, 9, 0, 0, 0, 0]);
});

test('the setting: Ask by default, then Automatically or Off; anything else is Ask', () => {
    assert.deepEqual(JOINS, ['ask', 'auto', 'off']);
    assert.deepEqual([undefined, 'ask', 'auto', 'off', 'sometimes', null].map(value => joinMode({ [JOIN_SETTING]: value })), ['ask', 'ask', 'auto', 'off', 'ask', 'ask']);
    assert.equal(joinMode(undefined), 'ask');
    assert.equal(PARTY_MAX, 8);
    assert.match(joinGrammar(), /^\+ party Mara \| about: .* \| class: I \| best: int .*- party Mara when they leave$/);
    assert.equal(joinGrammar().includes('\n'), false, 'one line, as every kind\'s');
});

test('what a joining companion is made of: stats 10, the best one 14, no points, Soul Class as given (capped by the party), an empty Skills block', () => {
    const draft = joinDraft({ name: 'Mara', about: 'a hedge-witch', soul: 4, best: 'int' });
    assert.deepEqual([draft.kind, draft.name, draft.about, draft.soul, draft.stats.int, draft.stats.str], ['companion', 'Mara', 'a hedge-witch', 4, 14, 10]);
    assert.equal(joinDraft({ name: 'Mara', best: 'wits' }).stats.int, 10, 'a best that is no stat raises nothing');
    const made = joinDefinitions({ name: 'Mara', about: 'a hedge-witch', soul: 4, best: 'int' }, { used: ['pack.chat/wessel'], soul: 3 });
    const state = made.character.state;
    assert.deepEqual([made.character.slug, made.character.role, state.int.default, state.vit.default, state.points.default, state.soul.default, state.health.default, state.mana.default, state.stamina.default, state.left.default], ['mara', 'character', 14, 10, 0, 3, 5, 4, 4, false]);
    assert.equal(made.skills.role, 'skills');
    assert.equal(made.skills.state.who.default, 'Mara');
    for (let n = 1; n <= 5; n += 1) assert.equal(made.skills.state[`skill${n}`].default, '', `skill ${n} is empty`);
    assert.equal(joinDefinitions({ name: 'Mara', about: '', soul: 1, best: '' }, { used: ['pack.chat/mara'] }).character.slug, 'mara-2', 'a free slug');
});

test('checkJoin: the name is taken, the party is full (8, those who left count), there is no room for two blocks, someone who left comes back, class is capped', () => {
    const character = (slug, who, fields = {}) => ({ definition: { ...characterDefinition(slug, who), role: 'character' }, fields: { who, ...fields } });
    const state = fakeState([character('wessel', 'Wessel', { soul: 3 }), character('ren', 'Ren', { soul: 2 })]);
    const request = (name, soul = 1) => ({ op: '+', name, about: '', soul, best: '' });
    assert.deepEqual(checkJoin(state, request('Mara', 9)), { ok: true, soul: 3 }, 'never above the party\'s highest');
    assert.deepEqual(checkJoin(state, request('Mara', 2)), { ok: true, soul: 2 });
    assert.deepEqual(checkJoin(state, request('Mara')), { ok: true, soul: 1 });
    assert.match(checkJoin(state, request('  ren ')).why, /^Ren is already in the party\.$/, 'a name matches the way names always do');
    assert.deepEqual([partyOf(state).map(person => person.name), partyCap(partyOf(state)), partyCap([])], [['Wessel', 'Ren'], 3, 1]);
    const left = fakeState([character('wessel', 'Wessel', { soul: 3 }), character('ren', 'Ren', { soul: 2, left: true })]);
    assert.equal(checkJoin(left, request('Ren')).returning?.name, 'Ren');
    assert.equal(partyCap(partyOf(left)), 3);
    assert.equal(partyCap(partyOf(fakeState([character('ren', 'Ren', { soul: 5, left: true }), character('wessel', 'Wessel', { soul: 2 })]))), 2, 'who left does not set the cap');
    const eight = fakeState(Array.from({ length: 8 }, (_, n) => character(`c${n}`, `C${n}`)));
    assert.match(checkJoin(eight, request('Mara')).why, /^the party is full \(8 characters, counting those who left\)$/);
    const crowded = fakeState([...Array.from({ length: 4 }, (_, n) => character(`c${n}`, `C${n}`)), ...Array.from({ length: 4 }, (_, n) => ({ definition: { ...skillsDefinition(`s${n}`, `C${n}`), role: 'skills' }, fields: {} }))]);
    assert.match(checkJoin(crowded, request('Mara')).why, /^the story has no room for two more blocks \(at most 8\)/);
});

// ---- Automatically ------------------------------------------------------------------------------------------------------------------

test('Automatically: a + party line makes the Character and an empty Skills block at once, as one action, listed in "Changed this reply"', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Mara walks in.', reply(MARA));
    assert.deepEqual(blocks(host), ['pack.chat/mara', 'pack.chat/mara-skills', 'pack.chat/wessel', 'pack.chat/wessel-skills']);
    const mara = fields(host, 'mara');
    assert.deepEqual([mara.who, mara.about, mara.str, mara.vit, mara.agi, mara.dex, mara.int, mara.luk, mara.cha], ['Mara', 'a hedge-witch from Kvildal', 10, 10, 10, 10, 14, 10, 10]);
    assert.deepEqual([mara.soul, mara.points, mara.xp, mara.health, mara.mana, mara.stamina, mara.alive, mara.left], [3, 0, 0, 5, 4, 4, true, false], 'class IV asked, the party\'s highest is III; bars full');
    const skills = fields(host, 'mara-skills');
    assert.deepEqual([skills.who, skills.skill1, skills.rank1, skills.practice1, skills.skill5], ['Mara', '', 0, 0, '']);
    const receipt = lastReceipts(host).find(entry => entry.type === 'capture.party');
    assert.equal(receipt.summary, 'Mara joined the party.');
    assert.deepEqual(receipt.data.join, { op: 'added', name: 'Mara' });
    assert.equal(receipt.guarded, true, 'a guarded block: it replays like every other block');
    assert.equal(host.head().domains.dataModules.perReply[Object.keys(host.head().domains.dataModules.perReply).at(-1)].roots >= 1, true);
    assert.deepEqual(problems(host), []);
    assert.deepEqual(partyLines(host.ctx.chat.at(-1).extra.storySuite).map(line => [line.text, line.summary]), [['Mara joined the party', 'Mara joined']]);
    await rebuilt(host, 'after a join');
});

test('a joining class never goes above the party\'s highest, and class I is the default', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Two arrive.', reply('+ party Pip', '+ party Dov | class: IX | best: str', '+ party Ilse | class: II | best: dex'));
    assert.deepEqual(['pip', 'dov', 'ilse'].map(slug => fields(host, slug)?.soul), [1, 3, 2]);
    assert.equal(fields(host, 'dov').str, 14);
    assert.equal(fields(host, 'pip').int, 10, 'no best named: nothing raised');
    await rebuilt(host, 'three joins');
});

test('refused plainly, one Problems line each and nothing made: the name is taken, a bad class, a bad best stat, no room, a full reply', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Dupes.', reply('+ party Wessel', '+ party wessel | class: I', '+ party Mara | class: XI', '+ party Mara | best: wits'));
    assert.deepEqual(blocks(host), ['pack.chat/wessel', 'pack.chat/wessel-skills'], 'nothing made');
    const told = problems(host);
    assert.equal(told.length, 4);
    assert.match(told[0], /Party: Wessel is already in the party; nothing applied\./);
    assert.match(told[2], /class must be a Soul Class from I to IX/);
    assert.match(told[3], /best must be one of/);

    // No room: Wessel's two blocks and six more fill the story's eight.
    for (const who of ['Ren', 'Ilse', 'Dov']) await make(host, who);
    assert.equal(blocks(host).length, 8);
    await host.send('One too many.', reply(MARA));
    assert.equal(blocks(host).length, 8);
    assert.match(problems(host).at(-1), /Party: the story has no room for two more blocks \(at most 8\); remove one from Blocks first; nothing applied\./);

    // The reply's own actions are used up: the line is refused with the block engine's plain sentence.
    const fresh = await world();
    t.after(() => fresh.close());
    await fresh.send('Crowd.', reply(...Array.from({ length: 12 }, (_, n) => `+ party P${n}`)));
    assert.equal(partyOf(fresh.head()).length < 12, true, 'some were refused');
    assert.equal(problems(fresh).some(message => /^"\+ party P\d+" was not used: /.test(message)), true);
    assert.equal(partyOf(fresh.head()).length <= PARTY_MAX, true);
    await rebuilt(fresh, 'a crowded reply');
});

test('a swipe takes the companion back; a Re-read and a rebuild and a reload keep it; deleting the reply takes it away', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Mara walks in.', reply(MARA));
    const at = host.ctx.chat.length - 1;
    assert.equal(blocks(host).includes('pack.chat/mara'), true);
    const done = await host.turn.reread(at);
    assert.equal(done.ok, true);
    assert.equal(blocks(host).includes('pack.chat/mara'), true, 'a Re-read makes it the same way');
    assert.deepEqual(partyOf(host.head()).map(person => person.name), ['Wessel', 'Mara']);
    await rebuilt(host, 'after a Re-read');
    await host.swipe('Nobody comes.');
    assert.deepEqual(blocks(host), ['pack.chat/wessel', 'pack.chat/wessel-skills'], 'a swipe takes it back');
    await rebuilt(host, 'after a swipe');
    await host.send('Mara again.', reply(MARA));
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(blocks(host).includes('pack.chat/mara'), false, 'deleting the reply takes it away');
    await rebuilt(host, 'after a delete');
});

// ---- Off, and the grammar ----------------------------------------------------------------------------------------------------------

test('the grammar: the + party line is there while the RPG is on, a character exists and the setting is not Off; never otherwise', { skip }, async t => {
    const asked = await world({ mode: 'ask' });
    const auto = await world({ mode: 'auto' });
    const off = await world({ mode: 'off' });
    const rpgOff = await world({ feature: false });
    const empty = await world({ wessel: false });
    t.after(() => [asked, auto, off, rpgOff, empty].forEach(host => host.close()));
    assert.deepEqual(grammar(asked), [joinGrammar()]);
    assert.deepEqual(grammar(auto), [joinGrammar()]);
    assert.deepEqual(grammar(off), [], 'Off: no party lines in the grammar');
    assert.deepEqual(grammar(rpgOff), [], 'the RPG off: not told');
    assert.deepEqual(grammar(empty), [], 'no character yet: nothing to join');
    assert.equal(statics(off).includes('+ party'), false);
    // Off: a line of it is not used and nothing is made.
    await off.send('Mara.', reply(MARA));
    assert.deepEqual(blocks(off), ['pack.chat/wessel', 'pack.chat/wessel-skills']);
    // The RPG off: the same, with the quiet "feature off" note.
    await rpgOff.send('Mara.', reply(MARA));
    assert.deepEqual(blocks(rpgOff), ['pack.chat/wessel', 'pack.chat/wessel-skills']);
    const quiet = rpgOff.turn.problems().find(item => /party/.test(item.line ?? item.message ?? ''));
    assert.equal(quiet?.quiet === true || /feature off/.test(quiet?.message ?? ''), true);
    assert.equal(rpgOff.sdk.query('rpg.joins', {}), null, 'and the query answers nothing');
});

// ---- Ask: the card ------------------------------------------------------------------------------------------------------------------

test('Ask: the line makes nothing; the reply\'s card offers Add to party, Edit first and No', { skip }, async t => {
    const host = await world({ mode: 'ask' });
    t.after(() => host.close());
    await host.send('Mara walks in.', reply(MARA));
    assert.deepEqual(blocks(host), ['pack.chat/wessel', 'pack.chat/wessel-skills'], 'nothing is made by the line');
    const receipt = lastReceipts(host).find(entry => entry.type === 'capture.party');
    assert.deepEqual(receipt.data.join, { op: 'offer', name: 'Mara', about: 'a hedge-witch from Kvildal', soul: 4, best: 'int' });
    assert.equal(receipt.guarded, undefined, 'no block: nothing to replay');
    const offers = host.sdk.query('rpg.joins', {});
    assert.deepEqual(offers, [{ name: 'Mara', about: 'a hedge-witch from Kvildal', soul: 4, best: 'int' }]);
    const card = host.registry.cardEntries().find(entry => entry.id === 'story-block/rpg-join').fn(host.head(), null, { index: host.ctx.chat.length - 1, head: true, query: (name, args) => host.sdk.query(name, args) });
    assert.equal(card.title, 'Mara joins the party');
    assert.equal(card.text, 'a hedge-witch from Kvildal');
    assert.deepEqual(card.actions.map(action => [action.label, action.command ?? action.open]), [['Add to party', 'dm.join'], ['Edit first', 'story-block/new-character'], ['No', 'rpg.joinNo']]);
    assert.deepEqual(card.actions[1].payload, { name: 'Mara', about: 'a hedge-witch from Kvildal', soul: 4, best: 'int' });
    assert.equal(joinCard([]), null);
    assert.deepEqual([JOIN_ADD, JOIN_NO], ['dm.join', 'rpg.joinNo']);
    await rebuilt(host, 'an offer');
});

test('Ask: Add to party makes the companion as Automatically does; the card goes; a swipe takes the offer away', { skip }, async t => {
    const host = await world({ mode: 'ask' });
    t.after(() => host.close());
    await host.send('Mara walks in.', reply(MARA));
    const added = await host.sdk.command(JOIN_ADD, host.sdk.query('rpg.joins', {})[0]);
    assert.equal(added.ok, true, added.message);
    assert.deepEqual(blocks(host), ['pack.chat/mara', 'pack.chat/mara-skills', 'pack.chat/wessel', 'pack.chat/wessel-skills']);
    assert.deepEqual([fields(host, 'mara').soul, fields(host, 'mara').int, fields(host, 'mara').points], [3, 14, 0]);
    assert.deepEqual(host.sdk.query('rpg.joins', {}), [], 'answered: the card goes');
    assert.deepEqual(partyLines(host.ctx.chat.at(-1).extra.storySuite).map(line => line.text), ['Mara joined the party']);
    const again = await host.sdk.command(JOIN_ADD, { name: 'Mara', about: '', soul: 1, best: '' });
    assert.equal(again.ok, false);
    assert.match(again.message, /Mara is already in the party/);
    await rebuilt(host, 'after Add to party');
    await host.swipe('Nobody comes.');
    assert.deepEqual(blocks(host), ['pack.chat/wessel', 'pack.chat/wessel-skills'], 'the swipe takes the click\'s blocks with the reply');
    assert.deepEqual(host.sdk.query('rpg.joins', {}), [], 'and the offer');
    await rebuilt(host, 'after the swipe');
});

test('Ask: No dismisses the card and makes nothing; a second offer for the same name shows once; Add refuses a bad payload', { skip }, async t => {
    const host = await world({ mode: 'ask' });
    t.after(() => host.close());
    await host.send('Two come.', reply(MARA, '+ party Mara | about: again', '+ party Ilse | class: II'));
    assert.deepEqual(host.sdk.query('rpg.joins', {}).map(offer => offer.name), ['Mara', 'Ilse']);
    const no = await host.sdk.command(JOIN_NO, { name: 'mara' });
    assert.equal(no.ok, true);
    assert.deepEqual(host.sdk.query('rpg.joins', {}).map(offer => offer.name), ['Ilse'], 'the first answered, the next one shows');
    assert.deepEqual(blocks(host), ['pack.chat/wessel', 'pack.chat/wessel-skills']);
    assert.equal((await host.sdk.command(JOIN_NO, { name: '' })).ok, false);
    assert.equal((await host.sdk.command(JOIN_ADD, { name: 'X', soul: 12 })).ok, false, 'a class out of range is refused');
    await rebuilt(host, 'after No');
    // Only the newest reply carries offers.
    await host.send('On.', 'Nothing more.');
    assert.deepEqual(host.sdk.query('rpg.joins', {}), []);
    // The reader's commands are the reader's: not a story line, and gated by the feature.
    host.features.set(LEAN_RPG_FEATURE, false);
    assert.equal((await host.sdk.command(JOIN_ADD, { name: 'Zed' })).ok, false);
    assert.equal((await host.sdk.command(JOIN_NO, { name: 'Zed' })).ok, false);
    assert.deepEqual(joinOffers([], 0), []);
});

// ---- leaving ------------------------------------------------------------------------------------------------------------------------

test('- party Name marks the companion as Left (kept, never deleted), out of the rolls; a later + party brings them back', { skip }, async t => {
    const host = await world({ mode: 'ask' });
    t.after(() => host.close());
    await make(host, 'Mara', 2);
    await host.send('Mara leaves.', reply('- party Mara'));
    assert.equal(fields(host, 'mara').left, true);
    assert.deepEqual(blocks(host), ['pack.chat/mara', 'pack.chat/mara-skills', 'pack.chat/wessel', 'pack.chat/wessel-skills'], 'kept');
    assert.deepEqual(problems(host), []);
    assert.equal(lastReceipts(host).find(entry => entry.type === 'capture.party').summary, 'Mara left the party.');
    assert.deepEqual(partyLines(host.ctx.chat.at(-1).extra.storySuite).map(line => line.text), ['Mara left the party']);
    // Not on the sheet the dice are rolled for, and the narrator is told she left.
    const { readSheet } = await import('../../../src/v2/lean-rpg/read.js');
    assert.deepEqual(readSheet(host.head()).characters.map(character => character.who), ['Wessel']);
    const { request } = await host.send('Who is here?', 'Only Wessel.');
    assert.match(request.chat.map(message => message.content).join('\n'), /Mara — .*left true/);
    await rebuilt(host, 'after leaving');
    // Left twice or never in the party: refused plainly.
    await host.send('Again.', reply('- party Mara', '- party Nobody'));
    assert.equal(problems(host).slice(-2).every(message => /is not in the party; nothing applied\./.test(message)), true);
    // A later + party of the same name brings them back, whatever Ask says: they are the same person.
    await host.send('Mara returns.', reply('+ party Mara | class: IX'));
    assert.equal(fields(host, 'mara').left, false);
    assert.equal(fields(host, 'mara').soul, 2, 'the sheet is the one they left with');
    assert.deepEqual(blocks(host).length, 4, 'nothing new made');
    assert.equal(lastReceipts(host).find(entry => entry.type === 'capture.party').summary, 'Mara is back in the party.');
    assert.deepEqual(host.sdk.query('rpg.joins', {}), [], 'and no card');
    await rebuilt(host, 'after returning');
    // A swipe takes the leaving back.
    await host.send('Leaves again.', reply('- party Mara'));
    await host.swipe('Stays.');
    assert.equal(fields(host, 'mara').left, false);
    await rebuilt(host, 'after a swipe');
});

test('a sheet made before Left existed cannot be marked as left, and says so', { skip }, async t => {
    const host = await world({ mode: 'auto' });
    t.after(() => host.close());
    const old = LEAN_RPG_TEMPLATES.find(entry => entry.definition.role === 'character');
    const definition = structuredClone(old.definition);
    delete definition.state.left;
    definition.slug = 'ren'; definition.name = 'Ren'; definition.state.who.default = 'Ren';
    assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
    await host.send('Ren leaves.', reply('- party Ren'));
    assert.match(problems(host).at(-1), /Ren's sheet was made before Left existed, so it cannot be marked as left/);
    assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, false);
});

// ---- the story's own lines are the only way in ---------------------------------------------------------------------------------------

test('party lines are the story\'s: a reader\'s command cannot write one, and the other ops are refused', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    const direct = await host.sdk.command('capture.party', { op: '+', name: 'Mara', labels: {} });
    assert.equal(direct.ok, false, 'capture commands are internal');
    await host.send('Odd.', reply('~ party Mara', '! party Mara'));
    assert.equal(problems(host).filter(message => /not a party line/.test(message)).length, 2);
    assert.deepEqual(blocks(host), ['pack.chat/wessel', 'pack.chat/wessel-skills']);
});

// ---- the fuzz: joins, leaves, swipes, Re-reads and deletes, in a seeded order ------------------------------------------------------------

function prng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const NAMES = ['Mara', 'Ilse', 'Dov', 'Pip', 'Wessel'];
// (The reply that holds the reader's own Wessel blocks, message 2, is left alone: Re-reading or deleting it takes those blocks away, which is the
// block engine's business and not the party line's; the test after this one says what a join does when that happens.)

for (const seed of [1, 2, 3, 4, 5, 6]) {
    test(`party lines through swipes, Re-reads, deletes, reloads: rebuild = live, seed ${seed}`, { skip }, async t => {
        const random = prng(seed * 104729);
        const pick = list => list[Math.floor(random() * list.length)];
        const host = await world({ mode: seed % 2 ? 'auto' : 'ask' });
        t.after(() => host.close());
        const trail = [];
        for (let step = 0; step < 24; step += 1) {
            const chat = host.ctx.chat;
            const lastIsReply = chat.length > 1 && !chat.at(-1).is_user;
            const roll = random();
            let label;
            if (roll < 0.4) {
                label = 'send';
                const line = random() < 0.35 ? `- party ${pick(NAMES)}` : `+ party ${pick(NAMES)} | about: someone | class: ${pick(['I', 'III', 'IX', 'XI'])} | best: ${pick(['str', 'int', 'wits'])}`;
                await host.send(`Move ${step}.`, reply(line));
            } else if (roll < 0.55 && lastIsReply) { label = 'swipe'; await host.swipe(random() < 0.5 ? `Quiet ${step}.` : reply(`+ party ${pick(NAMES)}`)); }
            else if (roll < 0.68) {
                label = 'reread';
                const target = pick(chat.map((message, index) => ({ message, index })).filter(({ message, index }) => index > 2 && !message.is_user));
                if (target) assert.equal((await host.turn.reread(target.index)).ok, true);
            } else if (roll < 0.8) {
                label = 'delete';
                const target = pick(chat.map((message, index) => ({ message, index })).filter(({ message, index }) => index > 2 && !message.is_user));
                if (target) await host.st.deleteMessage(target.index);
            } else if (roll < 0.9 && host.sdk.query('rpg.joins', {})?.length) {
                label = 'add';
                await host.sdk.command(JOIN_ADD, host.sdk.query('rpg.joins', {})[0]);
            } else label = 'reload';
            trail.push(label);
            await rebuilt(host, `seed ${seed} step ${step} (${trail.join(' > ')})`);
            const party = partyOf(host.head());
            assert.equal(new Set(party.map(person => person.name.toLowerCase())).size, party.length, 'one block to a name');
            assert.equal(party.length <= PARTY_MAX, true);
            assert.equal(party.every(person => person.soul <= Math.max(3, ...party.map(other => other.soul))), true);
        }
    });
}

test('when the blocks a companion joined are gone (the reply that made them was Re-read), the join is skipped with its reason, not failed', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Ilse walks in.', reply('+ party Ilse'));
    assert.equal(blocks(host).includes('pack.chat/ilse'), true);
    assert.equal((await host.turn.reread(2)).ok, true, 'message 2 holds the reader\'s Wessel blocks');
    assert.equal(blocks(host).length, 0);
    const skipped = host.store.problems();
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].message, /The blocks this story had when the companion joined are gone; Re-read this action\./);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
});

// ---- 2.9.1 ---------------------------------------------------------------------------------------------------------------------------

test('2.9.1: a - party line that names the player\'s own character is refused with one plain Problems line; companions can still leave', { skip }, async t => {
    const host = await world({ mode: 'ask' });
    t.after(() => host.close());
    host.ctx.name1 = 'Wessel';
    await make(host, 'Mara', 2);
    await host.send('They argue.', reply('- party Wessel', '- party mara'));
    assert.equal(fields(host, 'wessel').left, false, 'the player\'s own character stays');
    assert.equal(fields(host, 'mara').left, true, 'a companion leaves as before');
    const refused = problems(host).filter(message => /Wessel is you/.test(message));
    assert.equal(refused.length, 1);
    assert.match(refused[0], /Wessel is you, so they cannot leave the party; a "- party" line is for companions only/);
    assert.equal(problems(host).length, 1, 'nothing else was said');
    await rebuilt(host, 'after a refused leave');
    // The name is matched the way the Party tab does (case and spacing); with no persona name known nothing is held back.
    await host.send('Again.', reply('- party  WESSEL '));
    assert.equal(fields(host, 'wessel').left, false);
    host.ctx.name1 = '';
    await host.send('And again.', reply('- party Wessel'));
    assert.equal(fields(host, 'wessel').left, true, 'no persona name: the line works as it did');
});

test('2.9.1: the first character a story gets through Add to party also brings the Combat rules and Foes blocks it lacks, in the same action', { skip }, async t => {
    const host = await world({ mode: 'ask', wessel: false });
    t.after(() => host.close());
    assert.deepEqual(blocks(host), []);
    const added = await host.sdk.command(JOIN_ADD, { name: 'Mara', about: 'a hedge-witch', soul: 1, best: 'int' });
    assert.equal(added.ok, true, added.message);
    assert.deepEqual(blocks(host), ['pack.chat/combat-rules', 'pack.chat/foes', 'pack.chat/mara', 'pack.chat/mara-skills']);
    const perReply = host.head().domains.dataModules.perReply;
    assert.equal(perReply[Object.keys(perReply).at(-1)].roots, 1, 'one action');
    const made = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type.startsWith('dm.'));
    assert.deepEqual(made.map(receipt => receipt.type), ['dm.join']);
    await rebuilt(host, 'after the first join');
    // A later companion brings nothing extra.
    const second = await host.sdk.command(JOIN_ADD, { name: 'Ren', about: '', soul: 1, best: '' });
    assert.equal(second.ok, true, second.message);
    assert.deepEqual(blocks(host), ['pack.chat/combat-rules', 'pack.chat/foes', 'pack.chat/mara', 'pack.chat/mara-skills', 'pack.chat/ren', 'pack.chat/ren-skills']);
    await host.swipe('Nobody comes.');
    assert.deepEqual(blocks(host), [], 'a swipe takes all of it');
    await rebuilt(host, 'after the swipe');
});

test('2.9.1: a companion made by a party line or Add to party has the same class-up rule as any new character: 3 points with each rise', () => {
    const { character } = joinDefinitions({ name: 'Mara', about: '', soul: 1, best: '' });
    const rule = character.rules.find(item => item.id === 'class-up');
    assert.deepEqual(rule.then.find(effect => effect.path[0] === 'points'), { op: 'add', path: ['points'], value: 3, bounds: 'clamp' });
});
