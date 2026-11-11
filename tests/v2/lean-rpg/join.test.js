// Companions who join (mockup section 8; src/v2/lean-rpg/join.js, data-modules/part.js): the setting (Ask, Automatically, Off), the narrator's
// `+ party` line in the grammar, what a line makes (a Character and an empty Skills block, stats 5, the best stat 9 and a point for every third level, Soul Class as written
// but never above the party's highest, bars full), the plain refusals, Ask's card (Add to party, Edit first, No), `- party` (Left, kept) and
// that a swipe, a delete, a Re-read, a rebuild and a reload all treat it like any other line of the reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { STANDARD } from '../../../src/v2/lean-rpg/rules.js';
import { levelOfClass } from '../../../src/v2/lean-rpg/formula.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { PARTY_ACTIVE, PARTY_MAX, JOINS, JOIN_SETTING, LEAN_RPG_FEATURE } from '../../../src/v2/lean-rpg/names.js';
import { definition as filler, pack as dmPack } from '../data-modules/helpers.js';
import { DM_OLD_ROOM } from '../../../src/v2/data-modules/schema.js';
import { JOIN_ADD, JOIN_BENCH, JOIN_NO, benchable, checkJoin, joinCard, joinDefinitions, joinDraft, joinGrammar, joinMode, joinOffers, partyCap, partyOf, readJoin, soulOf } from '../../../src/v2/lean-rpg/join.js';
import { STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { rpgLib, setRpgLib } from '../../../src/v2/rpg-lazy.js';
import * as leanRpg from '../../../src/v2/lean-rpg/index.js';
import { partyLines } from '../../../src/v2/lean-rpg/view/changes-lines.js';
import { fakeState, characterDefinition, skillsDefinition } from './view/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MARA = '+ party Mara | about: a hedge-witch from Kvildal | class: IV | best: int';
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// A host with the RPG on and Wessel (Soul Class III) already in the party, made from the real templates.
// `eight`: every reply is captured with the `partyRoom` mark only (the party limit of 8), as replies written before `partyFour` were.
async function world({ mode = 'auto', feature = true, wessel = true, eight = false } = {}) {
    const host = await createHost({ settings: { modules: { 'story-block': { rpgJoin: mode } } } });
    if (eight) { const marks = host.store.setRuleMarks; host.store.setRuleMarks = (index, names) => { names.splice(names.indexOf('partyFour'), 1); return marks(index, names); }; }
    if (feature) host.features.set(CORE_FEATURE.leanRpg, true);
    await host.send('Begin.', 'Opening.');
    if (wessel) await make(host, 'Wessel', 3);
    return host;
}
async function make(host, who, soul = 1) {
    const defs = Object.fromEntries(STANDARD_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = who.toLowerCase(); defs.character.name = who; defs.character.state.who.default = who; defs.character.state.level.default = levelOfClass(soul);
    defs.skills.slug = `${who.toLowerCase()}-skills`; defs.skills.name = `${who}'s skills`; defs.skills.state.who.default = who;
    assert.equal((await host.sdk.command('dm.define', { definition: defs.character })).ok, true);
    // (as the wizard does: the Skills block follows its Character, so it replays only with it)
    assert.equal((await host.sdk.command('dm.define', { definition: defs.skills, after: `pack.chat/${defs.character.slug}` })).ok, true);
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

test('what a joining companion is made of: stats 5, the best one 9 and a point for every third level, no points left, Soul Class as given (capped by the party), an empty Skills block', () => {
    const draft = joinDraft({ name: 'Mara', about: 'a hedge-witch', soul: 4, best: 'int' }, STANDARD);
    assert.deepEqual([draft.kind, draft.name, draft.about, draft.level, draft.stats.int, draft.stats.str], ['companion', 'Mara', 'a hedge-witch', 35, 15, 5]);
    assert.equal(joinDraft({ name: 'Mara', best: 'wits' }, STANDARD).stats.int, 5, 'a best that is no stat raises nothing');
    const made = joinDefinitions({ name: 'Mara', about: 'a hedge-witch', soul: 4, best: 'int' }, { used: ['pack.chat/wessel'], soul: 3, rules: STANDARD });
    const state = made.character.state;
    assert.deepEqual([made.character.slug, made.character.role, state.int.default, state.vit.default, state.points.default, state.level.default, state.health.default, state.mana.default, state.stamina.default, state.left.default], ['mara', 'character', 13, 5, 0, 25, 10, 12, 10, false]);
    assert.equal(made.skills.role, 'skills');
    assert.equal(made.skills.state.who.default, 'Mara');
    for (let n = 1; n <= 5; n += 1) assert.equal(made.skills.state[`skill${n}`].default, '', `skill ${n} is empty`);
    assert.equal(joinDefinitions({ name: 'Mara', about: '', soul: 1, best: '' }, { used: ['pack.chat/mara'], rules: STANDARD }).character.slug, 'mara-2', 'a free slug');
});

test('checkJoin: the name is taken, the party is full (8 active; an old reply counts those who left), there is no room for two blocks, someone who left comes back, class is capped', () => {
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
    assert.match(checkJoin(eight, request('Mara')).why, /^the party is full \(8 active\); someone must leave first$/);
    assert.match(checkJoin(eight, request('Mara'), DM_OLD_ROOM).why, /^the party is full \(8 characters, counting those who left\)$/, 'a reply from before the mark counts those who left');
    // The party limit counts members who are in it: eight sheets with one who left is seven active, so one more joins; the one who left comes back only when there is a spot.
    const seven = fakeState([...Array.from({ length: 7 }, (_, n) => character(`c${n}`, `C${n}`)), character('gone', 'Gone', { left: true })]);
    assert.equal(checkJoin(seven, request('Mara')).ok, true);
    assert.equal(checkJoin(seven, request('Mara'), DM_OLD_ROOM).ok, false, 'the old count: eight sheets');
    assert.equal(checkJoin(seven, request('Gone')).returning?.name, 'Gone');
    const full = fakeState([...Array.from({ length: 8 }, (_, n) => character(`c${n}`, `C${n}`)), character('gone', 'Gone', { left: true })]);
    assert.match(checkJoin(full, request('Gone')).why, /^the party is full \(8 active\); someone must leave first$/, 'a return with 8 active is refused');
    assert.equal(checkJoin(full, request('Gone'), DM_OLD_ROOM).returning?.name, 'Gone', 'an old reply still lets them back');
    const crowded = fakeState([...Array.from({ length: 4 }, (_, n) => character(`c${n}`, `C${n}`)), ...Array.from({ length: 4 }, (_, n) => ({ definition: { ...skillsDefinition(`s${n}`, `C${n}`), role: 'skills' }, fields: {} }))]);
    assert.match(checkJoin(crowded, request('Mara'), DM_OLD_ROOM).why, /^the story has no room for two more blocks \(at most 8\)/);
    assert.equal(checkJoin(crowded, request('Mara')).ok, true, 'the room is 20 own blocks now');
    const wide = fakeState([...Array.from({ length: 9 }, (_, n) => character(`c${n}`, `C${n}`)), ...Array.from({ length: 9 }, (_, n) => ({ definition: { ...skillsDefinition(`s${n}`, `C${n}`), role: 'skills' }, fields: {} }))]);
    assert.match(checkJoin(wide, request('Mara')).why, /^the party is full/, 'nine active: the party limit comes first');
    const filled = fakeState([...Array.from({ length: 4 }, (_, n) => character(`c${n}`, `C${n}`)), ...Array.from({ length: 16 }, (_, n) => ({ definition: { ...skillsDefinition(`s${n}`, `C${n}`), role: 'skills' }, fields: {} }))]);
    assert.match(checkJoin(filled, request('Mara')).why, /^the story has no room for two more blocks \(at most 20\)/);
});

// ---- Automatically ------------------------------------------------------------------------------------------------------------------

test('Automatically: a + party line makes the Character and an empty Skills block at once, as one action, listed in "Changed this reply"', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Mara walks in.', reply(MARA));
    assert.deepEqual(blocks(host), ['pack.chat/mara', 'pack.chat/mara-skills', 'pack.chat/wessel', 'pack.chat/wessel-skills']);
    const mara = fields(host, 'mara');
    assert.deepEqual([mara.who, mara.about, mara.str, mara.vit, mara.agi, mara.dex, mara.int, mara.luk, mara.cha], ['Mara', 'a hedge-witch from Kvildal', 5, 5, 5, 9, 13, 5, 5]);
    assert.deepEqual([mara.level, mara.points, mara.xp, mara.health, mara.mana, mara.stamina, mara.alive, mara.left], [25, 0, 0, 10, 12, 10, true, false], 'class IV asked, the party\'s highest is III; bars full (the doubled sizes)');
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

test('a joining class never goes above the party\'s highest, and class I is the default (it stands for level 5, as an old class-I block reads)', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Two arrive.', reply('+ party Pip', '+ party Dov | class: IX | best: str', '+ party Ilse | class: II | best: dex'));
    assert.deepEqual(['pip', 'dov', 'ilse'].map(slug => fields(host, slug)?.level), [5, 25, 15]);
    assert.equal(fields(host, 'dov').str, 13);
    assert.equal(fields(host, 'pip').int, 5, 'no best named: nothing raised');
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

    // No room (a reply from before the partyRoom mark keeps the old eight): Wessel's two blocks and six more fill the story's eight.
    for (const who of ['Ren', 'Ilse', 'Dov']) await make(host, who);
    assert.equal(blocks(host).length, 8);
    const marker = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('One too many.', reply(MARA));
    host.store.setRuleMarks = marker;
    assert.equal(blocks(host).length, 8);
    assert.match(problems(host).at(-1), /Party: the story has no room for two more blocks \(at most 8\); remove one from Blocks first; nothing applied\./);

    // The reply's own actions are used up: the line is refused with the block engine's plain sentence.
    const fresh = await world({ eight: true });
    t.after(() => fresh.close());
    await fresh.send('Crowd.', reply(...Array.from({ length: 12 }, (_, n) => `+ party P${n}`)));
    assert.equal(partyOf(fresh.head()).length < 12, true, 'some were refused');
    assert.equal(problems(fresh).some(message => /^"\+ party P\d+" was not used: /.test(message)), true);
    assert.equal(partyOf(fresh.head()).length <= PARTY_MAX, true);
    await rebuilt(fresh, 'a crowded reply');
});

test('partyRoom: a marked reply has room for the 3rd to 7th companion, within the bytes; the party stops at 8 active and someone must leave for another', { skip }, async t => {
    const host = await world({ eight: true });
    t.after(() => host.close());
    for (const who of ['Mara', 'Ren', 'Ilse', 'Dov', 'Pip', 'Kit', 'Lou']) await host.send(`${who} comes.`, reply(`+ party ${who}`));
    assert.equal(partyOf(host.head()).length, 8, 'Wessel and seven companions');
    assert.equal(blocks(host).length, 16, 'past the old eight blocks');
    assert.equal(new TextEncoder().encode(JSON.stringify(host.head().domains.dataModules.pins)).length < 262144, true, 'seven companions fit the pin bytes (a pair is about 29 KB)');
    await host.send('One more.', reply('+ party Ann'));
    assert.equal(partyOf(host.head()).length, 8);
    assert.match(problems(host).at(-1), /the party is full \(8 active\); someone must leave first/);
    await host.send('Ren goes.', reply('- party Ren'));
    await host.send('Ann comes.', reply('+ party Ann'));
    assert.deepEqual([partyOf(host.head()).length, partyOf(host.head()).filter(person => person.left).map(person => person.name)], [9, ['Ren']], 'nine sheets, eight active, one left');
    await host.send('Ren is back.', reply('+ party Ren'));
    assert.match(problems(host).at(-1), /the party is full \(8 active\); someone must leave first/, 'a return with 8 active is refused');
    assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, true);
    await rebuilt(host, 'a full party');
});

test('partyRoom: the block cap is 20 of the story\'s own blocks; a reply from before the mark keeps 8 on Re-read, so an old refused join stays refused', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Mara comes.', reply('+ party Mara'));
    await host.send('Ren comes.', reply('+ party Ren'));
    for (let n = 0; n < 14; n++) assert.equal((await host.sdk.command('dm.define', { definition: { ...filler(), slug: `filler-${n}`, name: `Filler ${n}`, kinds: {} } })).ok, true);
    assert.equal(blocks(host).length, 20);
    await host.send('Ilse comes.', reply('+ party Ilse'));
    assert.match(problems(host).at(-1), /Party: the story has no room for two more blocks \(at most 20\); remove one from Blocks first; nothing applied\./);
    // An old reply (no mark) in a story of 8: its join stays refused when run again, though the story now has room.
    const old = await world();
    t.after(() => old.close());
    for (const who of ['Ren', 'Ilse', 'Dov']) await make(old, who);
    const marker = old.store.setRuleMarks;
    old.store.setRuleMarks = () => { throw new Error('old reply'); };
    await old.send('One too many.', reply(MARA));
    old.store.setRuleMarks = marker;
    const at = old.ctx.chat.length - 1;
    assert.equal(old.ctx.chat[at].extra.storySuite.rules, undefined);
    const before = JSON.stringify(old.head());
    assert.equal((await old.turn.reread(at)).ok, true);
    assert.equal(JSON.stringify(old.head()), before, 'a Re-read keeps it refused');
    await rebuilt(old, 'an old refused join');
});

// Eight active (Wessel and seven companions) with the replies that follow: each marked join and return records the party it relied on.
const active = host => partyOf(host.head()).filter(person => !person.left).length;
// (`size` 4: the reader's own actions keep the limit of 4, so their tests use a full party of four; 8: replies captured with only the `partyRoom` mark)
async function packed(size = 8) {
    const host = await world({ eight: size === 8 });
    for (const who of ['Mara', 'Ren', 'Ilse', 'Dov', 'Pip', 'Kit', 'Lou'].slice(0, size - 1)) await host.send(`${who} comes.`, reply(`+ party ${who}`));
    assert.equal(active(host), size);
    return host;
}
const lastAt = host => host.ctx.chat.length - 1;
async function settled(host, label) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${label}: a rebuild gives the live story`);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, `${label}: a reload gives the live story`);
    assert.equal(active(host) <= PARTY_MAX, true, `${label}: never more than ${PARTY_MAX} active`);
}

test('a marked join records the party it relied on: deleting the earlier leave (or taking its line out and Re-reading it) that made room fails the join\'s guard, and a Re-read decides it again (8 active at most)', { skip }, async t => {
    for (const how of ['delete', 'edit']) {
        const host = await packed();
        t.after(() => host.close());
        await host.send('Ren goes.', reply('- party Ren'));
        const leave = lastAt(host);
        await host.send('Ann comes.', reply('+ party Ann'));
        const join = lastAt(host);
        assert.deepEqual([active(host), partyOf(host.head()).length], [8, 9], 'Ann took the place Ren left');
        if (how === 'delete') await host.st.deleteMessage(leave);
        else { host.ctx.chat[leave].mes = 'Ren stays.'; assert.equal((await host.turn.reread(leave)).ok, true); }   // (the leave line taken out of the reply, then Re-read)
        await settled(host, `after a ${how}`);
        assert.equal(partyOf(host.head()).some(person => person.name === 'Ann' && !person.left) && active(host) > PARTY_MAX, false);
        const at = host.ctx.chat.findIndex(message => /\+ party Ann/.test(message.mes ?? ''));
        assert.ok(at >= 0 && at < join + 1);
        assert.equal((await host.turn.reread(at)).ok, true);
        assert.equal(active(host), 8, 'the Re-read decides it on the party as it is: Ann is refused, still 8');
        assert.equal(partyOf(host.head()).some(person => person.name === 'Ann'), false);
        assert.match(problems(host).at(-1), /the party is full \(8 active\); someone must leave first/);
        await settled(host, `after the Re-read (${how})`);
    }
});

test('a marked return records the party it relied on: deleting the earlier leave behind a return fails its guard, and a Re-read decides it again', { skip }, async t => {
    const host = await packed();
    t.after(() => host.close());
    await host.send('Ren goes.', reply('- party Ren'));
    await host.send('Kit goes.', reply('- party Kit'));
    const second = lastAt(host);
    await host.send('Ann comes.', reply('+ party Ann'));
    await host.send('Ren is back.', reply('+ party Ren'));
    assert.deepEqual([active(host), partyOf(host.head()).filter(person => person.left).map(person => person.name)], [8, ['Kit']]);
    await host.st.deleteMessage(second);
    await settled(host, 'after deleting an earlier leave');
    // (the RETURN, the last `+ party Ren`: the first one is the original join)
    const back = host.ctx.chat.findLastIndex(message => /\+ party Ren/.test(message.mes ?? ''));
    assert.equal(back, lastAt(host));
    // (Ann's join had room without Kit's leave, so it stays; only the return, which needed that leave, is skipped: Ren is still away)
    assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, true, 'the return fails its guard: Ren is still away');
    assert.equal(partyOf(host.head()).some(person => person.name === 'Ann'), true);
    assert.equal((await host.turn.reread(back)).ok, true);
    assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, true, 'a Re-read decides the return on the party as it is: eight are active, so Ren stays away');
    assert.equal(active(host), 8);
    await settled(host, 'after the Re-read');
});

// Four active (the reader's own limit) with Ask on: the companions are made as the wizard and template make them (dm.define), the reader's Add to party is dm.join.
async function packedAsk(size = 4) {
    const host = await world({ mode: 'ask', eight: size === 8 });
    for (const who of ['Mara', 'Ren', 'Ilse', 'Dov', 'Pip', 'Kit', 'Lou'].slice(0, size - 1)) await make(host, who);
    assert.equal(active(host), size);
    return host;
}
const templateCharacter = () => {
    const definition = structuredClone(STANDARD_TEMPLATES.find(entry => entry.definition.role === 'character').definition);
    delete definition.id; delete definition.pack;
    return Object.assign(definition, { slug: 'template-hero', name: 'Template hero' });
};

test('every way in records the party: Add to party, the wizard (New character, Edit first) and the template make a member who is skipped when the earlier leave that made room goes', { skip }, async t => {
    for (const route of ['add', 'wizard', 'template']) {
        const host = await packedAsk();
        t.after(() => host.close());
        await host.send('Ren goes.', reply('- party Ren'));
        const leave = lastAt(host);
        assert.equal(active(host), 3);
        if (route === 'add') {
            await host.send('Ann walks in.', reply('+ party Ann | about: a tinker | class: I | best: int'));
            const added = await host.sdk.command(JOIN_ADD, host.sdk.query('rpg.joins', {})[0]);
            assert.equal(added.ok, true, added.message);
        } else if (route === 'wizard') {
            await host.send('Quiet.', 'Quiet.');
            await make(host, 'Ann');
        } else {
            await host.send('Quiet.', 'Quiet.');
            assert.equal((await host.sdk.command('dm.define', { definition: templateCharacter() })).ok, true);
        }
        assert.equal(active(host), 4, `${route}: took the place Ren left`);
        await host.st.deleteMessage(leave);
        await settled(host, `${route}: after deleting the leave`);
        assert.equal(active(host), 4, `${route}: Ren is active again and the new member is skipped, not a ninth`);
        assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, false);
        assert.equal(partyOf(host.head()).some(person => person.name === 'Ann' || person.module === 'pack.chat/template-hero'), false, `${route}: not made`);
        assert.equal((await host.turn.reread(lastAt(host))).ok, true);
        await settled(host, `${route}: after a Re-read`);
    }
});

test('a Character made by the template or the wizard with 4 active is refused with the party-full sentence; the same at 3 is made', { skip }, async t => {
    const host = await packedAsk();
    t.after(() => host.close());
    for (const definition of [templateCharacter(), (() => { const d = templateCharacter(); d.slug = 'ann'; d.name = 'Ann'; d.state.who.default = 'Ann'; return d; })()]) {
        const refused = await host.sdk.command('dm.define', { definition });
        assert.equal(refused.ok, false);
        assert.match(refused.message, /the party is full \(4 active\); someone must leave first/);
    }
    assert.equal(active(host), 4);
    await host.send('Ren goes.', reply('- party Ren'));
    assert.equal((await host.sdk.command('dm.define', { definition: templateCharacter() })).ok, true);
    assert.equal(active(host), 4);
});

test('the reader\'s Add to party keeps the limit of 4 even on an offer from a reply with only the partyRoom mark: refused with the party-full sentence', { skip }, async t => {
    const host = await world({ mode: 'ask', eight: true });
    t.after(() => host.close());
    for (const who of ['Mara', 'Ren', 'Ilse']) await make(host, who);
    assert.equal(active(host), 4);
    await host.send('Ann walks in.', reply('+ party Ann | about: a tinker | class: I | best: int'));
    const offer = host.sdk.query('rpg.joins', {})[0];
    assert.equal(offer.four, undefined, 'an eight-limit reply: the ordinary Ask card');
    const refused = await host.sdk.command(JOIN_ADD, offer);
    assert.equal(refused.ok, false);
    assert.match(refused.message, /the party is full \(4 active\); someone must leave first/);
    assert.equal(partyOf(host.head()).some(person => person.name === 'Ann'), false);
});

test('a join captured before the mark replays with the old room (8 own blocks): the removal it relied on going makes it skipped, as Re-read refuses it', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    for (const who of ['Ren', 'Ilse']) await make(host, who);
    assert.equal((await host.sdk.command('dm.define', { definition: { ...filler(), slug: 'filler-0', name: 'Filler 0', kinds: {} } })).ok, true);
    assert.equal(blocks(host).length, 7);
    await host.send('Quiet.', 'Quiet.');
    const removal = lastAt(host);
    assert.equal((await host.sdk.command('dm.remove', { module: 'pack.chat/filler-0' })).ok, true);
    const marker = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Mara comes.', reply(MARA));
    host.store.setRuleMarks = marker;
    const join = lastAt(host);
    assert.equal(host.ctx.chat[join].extra.storySuite.rules, undefined);
    assert.equal(blocks(host).length, 8, 'six and two');
    await host.st.deleteMessage(removal);
    await settled(host, 'after deleting the removal');
    assert.equal(blocks(host).length, 7, 'the old guard keeps 8: the join is skipped, not a ninth block');
    assert.equal(partyOf(host.head()).some(person => person.name === 'Mara'), false);
    const at = host.ctx.chat.findIndex(message => /\+ party Mara/.test(message.mes ?? ''));
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(blocks(host).length, 7, 'and a Re-read refuses it the same way');
    await settled(host, 'after the Re-read');
});

test('the pin bytes refuse a join on a marked reply, and the old 16 pins refuse one on a reply from before the mark', { skip }, async t => {
    // Bytes: ten pairs would be about 290 KB against the 262144 cap, so with companions leaving to make room one of the joins is refused for the bytes.
    const host = await packed();
    t.after(() => host.close());
    const names = ['Ann', 'Bo', 'Cy', 'Di'];
    let refused = null;
    for (const [n, who] of names.entries()) {
        await host.send(`${['Mara', 'Ren', 'Ilse', 'Dov'][n]} goes.`, reply(`- party ${['Mara', 'Ren', 'Ilse', 'Dov'][n]}`));
        await host.send(`${who} comes.`, reply(`+ party ${who}`));
        refused = problems(host).find(message => /Retained pin budget exhausted/.test(message));
        if (refused) break;
    }
    assert.match(refused ?? '', /Retained pin budget exhausted/, 'a join was refused for the pin bytes');
    assert.equal(new TextEncoder().encode(JSON.stringify(host.head().domains.dataModules.pins)).length <= 262144, true);
    // The old pin limit: 15 pins (13 from a pack, two of the story's own) leave no room for two more under 16; the new room is 28.
    const state = count => ({ domains: { dataModules: { active: Object.fromEntries(Array.from({ length: count }, (_, n) => [`m${n}`, { hash: `h${n}` }])), pins: Object.fromEntries(Array.from({ length: count }, (_, n) => [`h${n}`, { packId: n < 2 ? 'chat' : 'pack' }])) } } });
    const request = { op: '+', name: 'Mara', about: '', soul: 1, best: '' };
    assert.match(checkJoin(state(15), request, DM_OLD_ROOM).why, /no room for two more blocks/, 'old: 15 pins + 2 is over 16');
    assert.equal(checkJoin(state(14), request, DM_OLD_ROOM).ok, true, 'old: 14 + 2 fits 16');
    assert.equal(checkJoin(state(15), request).ok, true, 'marked: 28 pins');
    assert.match(checkJoin(state(27), request).why, /no room for two more blocks \(at most 20\)/, 'marked: 27 + 2 is over 28');
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

test('a Re-read keeps the old pin of a first companion even when the prefix has no characters', { skip }, async t => {
    const host = await world({ wessel: false });
    t.after(() => { setRpgLib(leanRpg); host.close(); });
    // Permit a historical first-join line through the current grammar gate and capture it with the old scale.
    // The gate reads the live head; planning reads a prefix object without meta, so the first-join setup stays real.
    setRpgLib({ ...leanRpg, joinScale: () => 1, partyOf: state => {
        const party = leanRpg.partyOf(state);
        return !party.length && state?.meta ? [{ name: 'Gate' }] : party;
    } });
    // (a historical first join: captured before the partyRoom mark, so it records no party)
    const marker = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    try { await host.send('Mara walks in.', reply(MARA)); } finally { setRpgLib(leanRpg); host.store.setRuleMarks = marker; }
    const at = host.ctx.chat.length - 1, domain = host.head().domains.dataModules;
    const before = structuredClone(domain.active['pack.chat/mara']);
    assert.ok(before, 'the old first join made a character');
    assert.equal(domain.pins[before.hash].definition.state.health.scale, undefined);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(host.head().domains.dataModules.active['pack.chat/mara'], before, 'the same pinned definition and generation remain');
    await rebuilt(host, 'after a Re-read of the first old companion');
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
    assert.deepEqual(receipt.data.join, { op: 'offer', name: 'Mara', about: 'a hedge-witch from Kvildal', soul: 4, best: 'int', four: true }, 'a reply under the partyFour mark says so');
    assert.equal(receipt.guarded, undefined, 'no block: nothing to replay');
    const offers = host.sdk.query('rpg.joins', {});
    assert.deepEqual(offers, [{ name: 'Mara', about: 'a hedge-witch from Kvildal', soul: 4, best: 'int', four: true }]);
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
    assert.deepEqual([fields(host, 'mara').level, fields(host, 'mara').int, fields(host, 'mara').points], [25, 13, 0]);
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
    assert.equal(fields(host, 'mara').level, 15, 'the sheet is the one they left with');
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
    const old = STANDARD_TEMPLATES.find(entry => entry.definition.role === 'character');
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
// (The reply that holds the reader's own Wessel blocks, message 2, is left alone: deleting it takes those blocks away, which is the
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

test('when the blocks a companion joined are gone (the reply that made them was deleted), the join is skipped with its reason, not failed; a Re-read of that reply keeps them', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    await host.send('Ilse walks in.', reply('+ party Ilse'));
    assert.equal(blocks(host).includes('pack.chat/ilse'), true);
    assert.equal((await host.turn.reread(2)).ok, true, 'message 2 holds the reader\'s Wessel blocks');
    assert.deepEqual(blocks(host), ['pack.chat/ilse', 'pack.chat/ilse-skills', 'pack.chat/wessel', 'pack.chat/wessel-skills'], 'a Re-read keeps the reader\'s own blocks and the join');
    await rebuilt(host, 'after a Re-read of the reply that made the blocks');
    await host.st.deleteMessage(2);
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

test('partyLeft: a Re-read keeps a leave its first run made after the persona is renamed to that companion; a reply saved without the mark is refused as before', { skip }, async t => {
    const host = await world({ mode: 'ask' });
    t.after(() => host.close());
    await make(host, 'Mara', 2);
    await make(host, 'Ilse', 2);
    await host.send('They part.', reply('- party Mara'));
    const marked = host.store.headIndex();
    await host.send('Again.', reply('- party Ilse'));
    const old = host.store.headIndex();
    assert.equal(host.ctx.chat[marked].extra.storySuite.rules.includes('partyLeft'), true);
    delete host.ctx.chat[old].extra.storySuite.rules; // as a reply saved before the rule was
    host.store.rebuild();
    assert.deepEqual([fields(host, 'mara').left, fields(host, 'ilse').left], [true, true]);
    host.ctx.name1 = 'Mara';
    assert.equal((await host.turn.reread(marked)).ok, true);
    assert.equal(fields(host, 'mara').left, true, 'the marked reply still makes Mara leave');
    host.ctx.name1 = 'Ilse';
    assert.equal((await host.turn.reread(old)).ok, true);
    assert.equal(fields(host, 'ilse').left, false, 'the unmarked reply is refused: Ilse is the persona now');
    assert.ok(problems(host).some(message => /Ilse is you/.test(message)));
    assert.equal(host.ctx.chat[old].extra.storySuite.rules, undefined);
    await rebuilt(host, 'after the Re-reads');
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

test('2.17.0: a companion made by a party line or Add to party has the same level-up rule as any new character: a point for every multiple of 3 the rise crosses (was: 3 points with each Soul Class rise)', () => {
    const { character } = joinDefinitions({ name: 'Mara', about: '', soul: 1, best: '' });
    const rule = character.rules.find(item => item.id === 'level-up');
    assert.equal(character.rules.some(item => item.id === 'class-up'), false);
    assert.deepEqual(rule.then.find(effect => effect.path[0] === 'points'), { op: 'add', path: ['points'], value: ['sub', ['floorDiv', ['add', ['get', ['level']], ['get', ['rise']]], 3], ['floorDiv', ['get', ['level']], 3]], bounds: 'clamp' });
});

test('wizard characters replay with the RPG off: two made without a roll, join or note stay after a rebuild and a cold reload, the RPG off and then on', { skip }, async t => {
    const host = await world({ feature: false, wessel: false });
    t.after(() => host.close());
    setRpgLib(null);
    await make(host, 'Ann');
    await make(host, 'Bob');
    assert.equal(rpgLib(), null, 'the RPG library was never loaded');
    const both = ['pack.chat/ann', 'pack.chat/ann-skills', 'pack.chat/bob', 'pack.chat/bob-skills'];
    assert.deepEqual(blocks(host), both);
    await settled(host, 'RPG off');
    assert.equal(rpgLib(), null, 'a cold reload did not need the library');
    assert.deepEqual(blocks(host), both, 'both are still there');
    host.features.set(CORE_FEATURE.leanRpg, true);
    await settled(host, 'RPG on');
    assert.deepEqual(blocks(host), both, 'the same with the RPG on');
});

test('a standard Character pinned from a pack keeps the 4-active limit and records the party: refused at four, and with the earlier leave deleted it is skipped, not a fifth', { skip }, async t => {
    const hero = templateCharacter();
    delete hero.slug; hero.slug = 'pinned-hero'; hero.name = 'Pinned hero';
    const host = await packedAsk();
    t.after(() => host.close());
    const installed = await host.packs.packs.install(dmPack([hero]));
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    const offer = () => host.sdk.query('dataModules.offers').find(entry => entry.module.endsWith('/pinned-hero'));
    const pinIt = () => host.sdk.command('dm.pin', { module: offer().module, hash: offer().hash, packHash: offer().packHash, subjects: [] });
    const refused = await pinIt();
    assert.equal(refused.ok, false);
    assert.match(refused.message, /the party is full \(4 active\); someone must leave first/);
    await host.send('Ren goes.', reply('- party Ren'));
    const leave = lastAt(host);
    const pinned = await pinIt();
    assert.equal(pinned.ok, true, pinned.message);
    assert.equal(active(host), 4);
    await host.st.deleteMessage(leave);
    await settled(host, 'after deleting the leave');
    assert.equal(active(host), 4, 'Ren is active again and the pin is skipped, not a fifth');
});

// ---- the witness is only "was there room" (fewer than 8 active before) --------------------------------------------------------------------

test('deleting an unrelated earlier member below the cap keeps the later members (rebuild, reload, Re-read); at the cap the later join is still skipped', { skip }, async t => {
    const host = await world({ eight: true });
    t.after(() => host.close());
    const at = {};
    for (const who of ['Ann', 'Bob', 'Cy']) { await host.send(`${who} arrives.`, 'Quiet.'); await make(host, who); at[who] = lastAt(host); }
    assert.equal(active(host), 4);
    await host.st.deleteMessage(at.Ann);
    await settled(host, 'after deleting Ann\'s creation');
    assert.deepEqual(blocks(host), ['pack.chat/bob', 'pack.chat/bob-skills', 'pack.chat/cy', 'pack.chat/cy-skills', 'pack.chat/wessel', 'pack.chat/wessel-skills']);
    assert.equal(active(host), 3);
    assert.equal((await host.turn.reread(lastAt(host))).ok, true);
    await settled(host, 'after a Re-read');
    assert.equal(blocks(host).includes('pack.chat/cy'), true);
    // At the cap: eight active, then the earlier leave that made room for a later member goes: that member is skipped (covered by the routes test); here a story join too.
    const full = await packed();
    t.after(() => full.close());
    await full.send('Ren goes.', reply('- party Ren'));
    const leave = lastAt(full);
    await full.send('Ann comes.', reply('+ party Ann'));
    await full.st.deleteMessage(leave);
    await settled(full, 'at the cap');
    assert.equal(partyOf(full.head()).some(person => person.name === 'Ann'), false);
});

test('a wizard Character skipped on replay takes its Skills block with it, and the same person can be made again', { skip }, async t => {
    const host = await packedAsk();
    t.after(() => host.close());
    await host.send('Ren goes.', reply('- party Ren'));
    const leave = lastAt(host);
    await make(host, 'Ann');
    assert.equal(active(host), 4);
    await host.st.deleteMessage(leave);
    await settled(host, 'after deleting the leave');
    assert.equal(blocks(host).some(id => id.includes('ann')), false, 'neither the Character nor an orphan Skills block');
    const refused = await host.sdk.command('dm.define', { definition: { ...structuredClone(host.head().domains.dataModules.pins[host.head().domains.dataModules.active['pack.chat/ren-skills'].hash].definition), slug: 'x-skills', name: 'X' }, after: 'pack.chat/nobody' });
    assert.equal(refused.ok, false, 'a Skills block can only follow a Character of this chat');
    await host.send('Ren goes again.', reply('- party Ren'));
    await make(host, 'Ann');
    assert.equal(active(host), 4);
    assert.equal(blocks(host).filter(id => id.includes('ann')).length, 2);
    assert.equal(fields(host, 'ann-skills')?.who, 'Ann');
    await settled(host, 'after making Ann again');
    assert.equal(blocks(host).filter(id => id.includes('ann')).length, 2);
});

test('setting a Character\'s Left to false by hand is a return: refused at four active, and witnessed: with an earlier leave deleted it is skipped, not a fifth', { skip }, async t => {
    const host = await packed(4);
    t.after(() => host.close());
    const moduleOf = who => partyOf(host.head()).find(person => person.name === who).module;
    const back = who => host.sdk.command('dm.set', { module: moduleOf(who), field: 'left', value: false });
    await host.send('Ren goes.', reply('- party Ren'));
    await host.send('Ann comes.', reply('+ party Ann'));
    assert.equal(active(host), 4);
    const refused = await back('Ren');
    assert.equal(refused.ok, false);
    assert.match(refused.message, /the party is full \(4 active\); someone must leave first/);
    await host.send('Mara goes.', reply('- party Mara'));
    await host.send('Ilse goes.', reply('- party Ilse'));
    const ilse = lastAt(host);
    await host.send('Quiet.', 'Quiet.');   // (the hand returns go in a reply of their own, after the leave)
    assert.equal(active(host), 2);
    assert.equal((await back('Ren')).ok, true);
    assert.equal((await back('Mara')).ok, true, 'a second hand return, with room');
    assert.equal(active(host), 4);
    await settled(host, 'live');
    await host.st.deleteMessage(ilse);
    await settled(host, 'after deleting an earlier leave');
    assert.equal(active(host), 4, 'Ilse never left, so Mara\'s hand return would be a fifth: skipped');
    assert.equal(partyOf(host.head()).find(person => person.name === 'Mara').left, true);
    assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, false, 'Ren\'s return still had room');
});

test('an old reply (before the mark) at 16 pins: it replays, a rebuild and a reload keep it, a Re-read decides it the old way, and one more old join is refused', { skip }, async t => {
    const host = await world();
    t.after(() => host.close());
    const many = Array.from({ length: 12 }, (_, n) => ({ ...filler(), slug: `f${n}`, name: `F${n}`, kinds: {} }));
    assert.equal((await host.packs.packs.install(dmPack(many))).ok, true);
    for (const offer of host.sdk.query('dataModules.offers')) assert.equal((await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash, subjects: [] })).ok, true);
    assert.equal(blocks(host).length, 14);
    const marker = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Mara comes.', reply(MARA));
    const join = lastAt(host);
    await host.send('Ren comes.', reply('+ party Ren'));
    host.store.setRuleMarks = marker;
    assert.equal(blocks(host).length, 16, 'the old 16 pins');
    assert.equal(partyOf(host.head()).some(person => person.name === 'Ren'), false, 'the second old join was refused');
    await settled(host, 'old 16');
    assert.equal(blocks(host).length, 16);
    assert.equal((await host.turn.reread(join)).ok, true);
    assert.equal(blocks(host).length, 16, 'a Re-read keeps the old room');
    await settled(host, 'old 16 after a Re-read');
});

// ---- a full party asks who to bench (partyFour: 4 active, the reader's character included) -------------------------------------------------

const TORKA = '+ party Torka Bloodsong | about: an orc with an axe | class: II | best: str';
// Wessel (the reader's, the first block) and three companions: four active under the `partyFour` mark.
async function four({ mode = 'auto' } = {}) {
    const host = await world({ mode });
    for (const who of ['Mara', 'Ren', 'Ilse']) await host.send(`${who} comes.`, reply(`+ party ${who}`));
    assert.equal(active(host), 4);
    return host;
}
const joinCardOf = host => host.registry.cardEntries().find(entry => entry.id === 'story-block/rpg-join').fn(host.head(), null, { index: host.ctx.chat.length - 1, head: true, query: (name, args) => host.sdk.query(name, args) });
const names = host => partyOf(host.head()).filter(person => !person.left).map(person => person.name);

test('partyFour: the active limit is 4 on a reply with the new mark, 8 on a reply with only partyRoom, and checkJoin says a full party is `full`', () => {
    const character = (slug, who, fields = {}) => ({ definition: { ...characterDefinition(slug, who), role: 'character', state: { left: { type: 'bool' } } }, fields: { who, ...fields } });
    const request = name => ({ op: '+', name, about: '', soul: 1, best: '' });
    const members = n => fakeState(Array.from({ length: n }, (_, at) => character(`m${at}`, `M${at}`)));
    assert.equal(PARTY_ACTIVE, 4);
    assert.deepEqual(checkJoin(members(4), request('New'), undefined, PARTY_ACTIVE), { ok: false, full: true, why: 'the party is full (4 active); someone must leave first' });
    assert.equal(checkJoin(members(3), request('New'), undefined, PARTY_ACTIVE).ok, true);
    assert.equal(checkJoin(members(4), request('New')).ok, true, 'the limit of 8 stays the default (a reply with only partyRoom)');
    assert.equal(checkJoin(members(8), request('New')).full, true);
    const gone = fakeState([...Array.from({ length: 4 }, (_, at) => character(`m${at}`, `M${at}`)), character('ren', 'Ren', { left: true })]);
    assert.deepEqual(checkJoin(gone, request('Ren'), undefined, PARTY_ACTIVE), { ok: false, full: true, back: true, why: 'the party is full (4 active); someone must leave first' }, 'a return meets the limit too');
    // the reader's character is never offered: the one named like the persona, else the first block
    assert.deepEqual(benchable(members(4), name => name === 'M2').map(entry => entry.name), ['M0', 'M1', 'M3']);
    assert.deepEqual(benchable(members(4)).map(entry => entry.name), ['M1', 'M2', 'M3'], 'nobody named: the first block is the reader\'s');
});

test('A long name in the bench card keeps its level', () => {
    const character = (slug, who) => ({ definition: { ...characterDefinition(slug, who), role: 'character', state: { left: { type: 'bool' } } }, fields: { who } });
    const long = 'Sir Bartholomew Featherstonehaugh-Wetherby the Third of Ersveil';
    assert.equal([...long].length >= 60, true);
    const state = fakeState([character('m0', 'M0'), character('m1', long), character('m2', 'Kel'), character('m3', 'M3')]);
    const card = joinCard([{ name: 'New', about: '', soul: 1, best: '', full: true }], state);
    const labels = card.actions.map(action => action.label);
    assert.match(labels[0], /^Sir Bartholomew.*… · Lv \d+$/);
    assert.equal([...labels[0]].length <= 32, true);
    assert.match(labels[1], /^Kel · Lv \d+$/, 'a short name is unchanged');
    // a name of astral characters (emoji) counts by code points in both places: it keeps " · Lv N"
    const emoji = fakeState([character('m0', 'M0'), character('m1', '🐉'.repeat(25)), character('m2', 'Kel'), character('m3', 'M3')]);
    const emojiLabel = joinCard([{ name: 'New', about: '', soul: 1, best: '', full: true }], emoji).actions[0].label;
    assert.match(emojiLabel, / · Lv \d+$/, 'an emoji name keeps its level');
    assert.equal([...emojiLabel].length <= 32, true);
    // a huge label is cut before it is spread into code points, and still comes out at 32
    const huge = joinCard([{ name: '🐉'.repeat(5000), about: '', soul: 1, best: '', full: true }], emoji).actions[0].label;
    assert.equal([...huge].length <= 32, true);
    // 5 active: the card keeps room for Not now
    const five = fakeState(['m0', 'm1', 'm2', 'm3', 'm4'].map(slug => character(slug, slug.toUpperCase())));
    const many = joinCard([{ name: 'New', about: '', soul: 1, best: '', full: true }], five).actions;
    assert.equal(many.length, 4);
    assert.equal(many.at(-1).command, JOIN_NO);
});

test('partyFour: a new reply is marked partyFour and partyRoom, and the 5th member of a story is not made but offered; a reply with only partyRoom still takes the 5th', { skip }, async t => {
    const host = await four();
    t.after(() => host.close());
    assert.deepEqual(host.ctx.chat.at(-1).extra.storySuite.rules.filter(name => name.startsWith('party')), ['partyFour', 'partyRoom']);
    await host.send('Torka walks in.', reply(TORKA));
    assert.deepEqual(names(host), ['Wessel', 'Mara', 'Ren', 'Ilse'], 'not made');
    assert.deepEqual(problems(host), [], 'and not refused silently: no Problems line');
    const receipt = lastReceipts(host).find(entry => entry.type === 'capture.party');
    assert.deepEqual(receipt.data.join, { op: 'offer', name: 'Torka Bloodsong', about: 'an orc with an axe', soul: 2, best: 'str', full: true, four: true }, 'the reply\'s own receipt keeps the request');
    const old = await world({ eight: true });
    t.after(() => old.close());
    for (const who of ['Mara', 'Ren', 'Ilse', 'Dov']) await old.send(`${who} comes.`, reply(`+ party ${who}`));
    assert.equal(active(old), 5, 'under partyRoom only the limit is 8');
    await rebuilt(host, 'a full party offer');
});

test('a full party shows the bench card: one button per active companion with their level, never the reader, and Not now', { skip }, async t => {
    const host = await four();
    t.after(() => host.close());
    await host.send('Torka walks in.', reply(TORKA));
    const card = joinCardOf(host);
    assert.equal(card.title, 'The party is full (4 active)');
    assert.equal(card.text, 'Bench one to let Torka Bloodsong in. They keep their level, XP, skills and gear, and can come back.');
    const levels = Object.fromEntries(partyOf(host.head()).map(person => [person.name, person.level]));
    assert.deepEqual(card.actions.map(action => action.label), [`Mara · Lv ${levels.Mara}`, `Ren · Lv ${levels.Ren}`, `Ilse · Lv ${levels.Ilse}`, 'Not now'], 'Wessel is the reader\'s: never offered');
    assert.deepEqual(card.actions.map(action => action.command), [JOIN_BENCH, JOIN_BENCH, JOIN_BENCH, JOIN_NO]);
    assert.equal(card.actions[0].payload.bench, 'Mara');
    assert.equal(card.actions[0].payload.name, 'Torka Bloodsong');
    assert.deepEqual(host.sdk.query('rpg.joins', {}).map(offer => [offer.name, offer.full]), [['Torka Bloodsong', true]]);
    const refused = await host.sdk.command(JOIN_BENCH, { ...card.actions[0].payload, bench: 'Wessel' });
    assert.equal(refused.ok, false, 'the reader\'s own character cannot be benched');
    assert.deepEqual(names(host), ['Wessel', 'Mara', 'Ren', 'Ilse']);
});

test('tapping a name benches that member (marked left, kept) and joins the newcomer in one action; the card then says so; a rebuild and a reload agree', { skip }, async t => {
    const host = await four();
    t.after(() => host.close());
    await host.send('Torka walks in.', reply(TORKA));
    const done = await host.sdk.command(JOIN_BENCH, joinCardOf(host).actions[1].payload);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(names(host), ['Wessel', 'Mara', 'Ilse', 'Torka Bloodsong']);
    assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, true, 'Ren is kept, marked left');
    assert.equal(active(host), 4);
    assert.equal(joinCardOf(host).text, 'Ren left the party (benched) · Torka Bloodsong joined.');
    assert.deepEqual(joinCardOf(host).actions, []);
    await settled(host, 'after the bench choice');
});

test('Not now keeps the card: the newcomer is not joined and the bench buttons are still there later', { skip }, async t => {
    const host = await four();
    t.after(() => host.close());
    await host.send('Torka walks in.', reply(TORKA));
    assert.equal((await host.sdk.command(JOIN_NO, { name: 'Torka Bloodsong' })).ok, true);
    assert.deepEqual(names(host), ['Wessel', 'Mara', 'Ren', 'Ilse']);
    const card = joinCardOf(host);
    assert.equal(card.text, 'Torka Bloodsong did not join. You can still bench someone here later.');
    assert.deepEqual(card.actions.map(action => action.command), [JOIN_BENCH, JOIN_BENCH, JOIN_BENCH]);
    const done = await host.sdk.command(JOIN_BENCH, card.actions[2].payload);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(names(host), ['Wessel', 'Mara', 'Ren', 'Torka Bloodsong']);
    await settled(host, 'bench after Not now');
});

test('a return to a full party asks too: benching a member brings the one who left back', { skip }, async t => {
    const host = await four();
    t.after(() => host.close());
    await host.send('Ren goes.', reply('- party Ren'));
    await host.send('Kit joins.', reply('+ party Kit'));
    assert.equal(active(host), 4);
    await host.send('Ren is back.', reply('+ party Ren'));
    assert.deepEqual(host.sdk.query('rpg.joins', {}).map(entry => [entry.name, entry.full, entry.back]), [['Ren', true, true]]);
    assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, true, 'still away');
    const done = await host.sdk.command(JOIN_BENCH, joinCardOf(host).actions[0].payload);
    assert.equal(done.ok, true, done.message);
    assert.match(joinCardOf(host).text, /^\S+ left the party \(benched\) · Ren joined\.$/);
    assert.equal(partyOf(host.head()).find(person => person.name === 'Ren').left, false, 'Ren is back');
    assert.equal(active(host), 4);
    await settled(host, 'a return by bench');
});

test('the bench action replays like other reader actions: a rebuild and a reload agree, and deleting the earlier reply that filled the party skips it, leaving the newcomer\'s offer to be added', { skip }, async t => {
    const host = await four();
    t.after(() => host.close());
    const joined = host.ctx.chat.length - 1;   // Ilse's reply (the party's 4th)
    await host.send('Torka walks in.', reply(TORKA));
    const done = await host.sdk.command(JOIN_BENCH, joinCardOf(host).actions[0].payload);
    assert.equal(done.ok, true, done.message);
    await settled(host, 'the bench action');
    await host.st.deleteMessage(joined);
    await settled(host, 'after deleting the reply that filled the party');
    assert.equal(names(host).includes('Torka Bloodsong'), false, 'the bench action relied on a full party: it is skipped, not applied to a party with room');
    assert.equal(partyOf(host.head()).find(person => person.name === 'Mara')?.left, false, 'Mara was not benched');
    const card = joinCardOf(host);
    assert.equal(card.title, 'Torka Bloodsong joins the party', 'with room again the offer is an ordinary Ask card');
    assert.equal(card.actions[0].command, JOIN_ADD);
    const stale = await host.sdk.command(JOIN_BENCH, { name: 'Torka Bloodsong', bench: 'Mara' });
    assert.equal(stale.ok, false, 'a stale bench button: there is room now, nobody steps out');
    assert.match(stale.message, /room now/);
});
