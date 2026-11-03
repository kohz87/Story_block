// The party roster (Story Block 2.18.1, docs/v2/GEAR.md "The roster"): the RPG answers `party.actors` and `party.pc` from its Character blocks, so each
// member of the party is an actor who can own and wear things. The id is the block's (stable over a rename, a rebuild and a reload); a module that
// answers `party.actors` itself wins; a 2.18.0 chat replays as it was written; a real `+ party` / `- party` hands out, binds, stows and restores signature gear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { createFakeModel } from '../../testkit/model.js';
import { createRegistry } from '../../src/v2/registry.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { LEAN_RPG_TEMPLATES } from '../../src/v2/lean-rpg/templates.js';
import { actorIdOf, rosterOf, rosterQueries } from '../../src/v2/lean-rpg/roster.js';
import { gearMatches, planGear } from '../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../src/v2/lean-rpg/index.js';
import { hashJson } from '../../src/v2/replay.js';
import { reply as dmReply, success } from './data-modules/helpers.js';
import { pack } from './packs/helpers/fixtures.js';
import { character, sheetDomain } from './lean-rpg/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const plain = value => JSON.parse(JSON.stringify(value));
const OWNER = /^ac_[0-9a-z]{8}$/;

const ITEMS = [
    { name: 'Cane Sword', kind: 'equipment', slot: 'weapon', rarity: 'uncommon' },
    { name: 'Oak Buckler', kind: 'equipment', slot: 'shield', rarity: 'common' },
];
const MARA = { id: 'mara', name: 'Mara', aliases: [], about: 'Runs the night ferry.', look: 'Wiry.', start: { place: 'Docks', goal: 'Keep the ferry running.' }, gear: ['Cane Sword', 'Oak Buckler'] };
const PLAN = 'pace: all\nact Ren | target: Mud Crawlers\nfoe Mud Crawlers | target: Ren | defend: AGI';
const SET = '+ dm foes — why | kind: set-slot-1 | name: Mud Crawlers | count: 6 | level: 60';

const definitionOf = (name, slug = null, who = null) => {
    const definition = structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
    if (slug) { definition.slug = slug; definition.name = who; definition.state.who.default = who; }
    return definition;
};
const define = async (host, definition) => success(await host.sdk.command('dm.define', { definition }));

async function world(t, { user, gear = true, rpg = true, modules = [], withPack = true, model = null } = {}) {
    t.mock.method(console, 'warn', () => {});
    const raw = pack({ content: { items: ITEMS, cast: [MARA] } });
    const built = validatePack(raw);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const host = await createHost({
        modules, ...(user ? { st: { user } } : {}), ...(model ? { callModel: createFakeModel(Array(40).fill(model)) } : {}),
        settings: { features: { ...(gear ? { 'story-block.gear': true } : {}), 'story-block.rpg': rpg }, modules: { 'story-block': { rpgJoin: 'auto', rpgFormula: 'classic' } },
            ...(withPack ? { packs: [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }] } : {}) },
    });
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    return host;
}
const rows = host => host.sdk.query('inventory.items');
const row = (host, name) => rows(host).find(item => item.name === name);

// ---- the roster is answered from the Character blocks ----------------------------------------------------------------------------------------

test('party.actors: one actor per Character block, the id the block\'s; party.pc is the reader\'s own', { skip }, async t => {
    const host = await world(t, { user: 'Ren', withPack: false });
    assert.equal(host.sdk.query('party.actors'), null, 'no Character yet: no answer');
    assert.equal(host.sdk.query('party.pc'), null);
    await define(host, definitionOf('Character'));
    await define(host, definitionOf('Character', 'ren', 'Ren'));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra' } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/ren', fields: { who: 'Ren' } }));
    const astra = actorIdOf('pack.chat/character'), ren = actorIdOf('pack.chat/ren');
    assert.match(astra, OWNER);
    assert.notEqual(astra, ren);
    assert.deepEqual(host.sdk.query('party.actors'), [{ id: astra, name: 'Astra' }, { id: ren, name: 'Ren', pc: true }], 'Ren is the persona: the reader');
    assert.deepEqual(host.sdk.query('party.pc'), { id: ren });
});

test('the ids are stable over a rename, a rebuild and a reload; the name follows the block', { skip }, async t => {
    const host = await world(t, { user: 'Astra', withPack: false });
    await define(host, definitionOf('Character'));
    await define(host, definitionOf('Character', 'ren', 'Ren'));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra' } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/ren', fields: { who: 'Ren' } }));
    const ids = () => host.sdk.query('party.actors').map(actor => actor.id);
    const first = ids();
    success(await host.sdk.command('dm.set', { module: 'pack.chat/ren', fields: { who: 'Ren Holt' } }));
    assert.deepEqual(ids(), first, 'a rename');
    assert.deepEqual(host.sdk.query('party.actors').map(actor => actor.name), ['Astra', 'Ren Holt']);
    host.store.rebuild();
    assert.deepEqual(ids(), first, 'a rebuild');
    await host.st.loadChat(plain(host.ctx.chat));
    assert.deepEqual(ids(), first, 'a reload');
    assert.deepEqual(host.sdk.query('party.pc'), { id: first[0] }, 'Astra is the persona');
});

test('the reader is the Character named like the persona (a first name that means only them counts), or the only one; with several and none named so, nobody', () => {
    const state = names => ({ domains: { dataModules: sheetDomain(Object.fromEntries(names.map((name, at) => [`b${at}`, { role: 'character', fields: character(name) }]))) } });
    assert.equal(rosterOf(state(['Ash', 'Ren Holt']), 'ren holt').pc, actorIdOf('pack.chat/b1'));
    assert.equal(rosterOf(state(['Ash', 'Ren Holt']), 'Ren').pc, actorIdOf('pack.chat/b1'), 'a first name that means one Character');
    assert.equal(rosterOf(state(['Ash', 'Ren Holt', 'Ren Ashby']), 'Ren').pc, null, 'two Rens: not guessed');
    assert.equal(rosterOf(state(['Ash', 'Ren Holt']), '').pc, null, 'several and none named so: nobody');
    assert.equal(rosterOf(state(['Ash', 'Ren Holt']), 'Nobody').actors.some(actor => actor.pc), false);
    assert.equal(rosterOf({ domains: {} }, 'Ren').pc, null);
    assert.deepEqual(rosterOf(state(['Ash']), 'x').actors, [{ id: actorIdOf('pack.chat/b0'), name: 'Ash', pc: true }]);
});

test('a companion who left the party is no longer on the roster', { skip }, async t => {
    const host = await world(t, { user: 'Wessel' });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    await host.send('Mara walks in.', reply('+ party Mara'));
    const mara = actorIdOf('pack.chat/mara');
    assert.deepEqual(host.sdk.query('party.actors').map(actor => actor.id).sort(), [mara, actorIdOf('pack.chat/wessel')].sort());
    await host.send('She goes.', reply('- party Mara'));
    assert.deepEqual(host.sdk.query('party.actors').map(actor => actor.id), [actorIdOf('pack.chat/wessel')]);
});

test('nothing answers party.actors or party.pc with the RPG off, or with Gear in fights off', { skip }, async t => {
    const host = await world(t, { user: 'Wessel', withPack: false });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    assert.deepEqual(host.sdk.query('party.actors').map(actor => actor.name), ['Wessel'], 'RPG on, gear on: answered');
    host.features.set('story-block.gear', false);
    assert.equal(host.sdk.query('party.actors'), null, 'gear off');
    assert.equal(host.sdk.query('party.pc'), null);
    host.features.set('story-block.gear', true);
    host.features.set('story-block.rpg', false);
    assert.equal(host.sdk.query('party.actors'), null);
    assert.equal(host.sdk.query('party.pc'), null);
});

// ---- a module that answers party.actors itself keeps priority --------------------------------------------------------------------------------

test('a module that answers party.actors wins, whichever registers first; a second fallback is refused as a second owner is', () => {
    const own = { id: 'story-block', version: '1.0.0', features: [{ id: 'story-block.rpg', label: 'RPG' }], queries: rosterQueries() };
    const old = () => ({ id: 'rpg-battle', version: '1.0.0', queries: { 'party.actors': () => [{ id: 'ac_old00001', name: 'Old' }], 'party.pc': () => ({ id: 'ac_old00001' }) } });
    for (const order of [[own, old()], [old(), own]]) {
        const registry = createRegistry();
        for (const def of order) registry.register(def);
        assert.deepEqual(registry.query('party.actors')({}, {}, {}), [{ id: 'ac_old00001', name: 'Old' }], order.map(def => def.id).join(' then '));
        assert.equal(registry.queryOwner('party.actors'), 'rpg-battle');
    }
    const alone = createRegistry();
    alone.register(own);
    assert.equal(typeof alone.query('party.actors'), 'function', 'alone, the fallback answers');
    assert.equal(alone.queryOwner('party.actors'), null, 'and owns nothing');
    assert.throws(() => alone.register({ id: 'twin', version: '1.0.0', features: [{ id: 'twin.rpg', label: 'RPG' }], queries: Object.fromEntries(Object.entries(rosterQueries()).map(([name, fn]) => [name, Object.assign(() => null, { fallback: true, feature: 'twin.rpg' })])) }), /already belongs to "story-block"/);
});

test('the fallback stands behind an owner that is held back, or answers null or an empty list (an old RPG Battle in a chat that is not its own)', () => {
    const own = () => ({ id: 'story-block', version: '1.0.0', features: [{ id: 'story-block.rpg', label: 'RPG' }], queries: rosterQueries() });
    const mine = { domains: { dataModules: sheetDomain({ ash: { role: 'character', fields: character('Ash') } }) } };
    const old = answer => ({ id: 'rpg-battle', version: '1.0.0', queries: { 'party.actors': () => answer } });
    for (const order of ['own first', 'old first']) {
        for (const answer of [[], null]) {
            const registry = createRegistry({ warn: () => {} });
            const defs = order === 'own first' ? [own(), old(answer)] : [old(answer), own()];
            for (const def of defs) registry.register(def);
            assert.deepEqual(registry.query('party.actors')(mine, {}, {}).map(actor => actor.name), ['Ash'], `${order}: the owner answers ${JSON.stringify(answer)}`);
        }
        const registry = createRegistry({ warn: () => {} });
        for (const def of order === 'own first' ? [own(), old([{ id: 'ac_old00001', name: 'Old' }])] : [old([{ id: 'ac_old00001', name: 'Old' }]), own()]) registry.register(def);
        assert.deepEqual(registry.query('party.actors')(mine, {}, {}).map(actor => actor.name), ['Old'], `${order}: an answer stands`);
        assert.equal(registry.setEnabled('rpg-battle', false), true);
        assert.deepEqual(registry.query('party.actors')(mine, {}, {}).map(actor => actor.name), ['Ash'], `${order}: switched off, the fallback answers`);
    }
});

test('through the host: an old module\'s roster is the one asked, and its actors get the join\'s gear', { skip }, async t => {
    const OLD = { id: 'zz-party', version: '0.0.0', queries: { 'party.actors': () => [{ id: 'ac_mara0001', name: 'Mara' }] } };
    const host = await world(t, { user: 'Wessel', modules: [OLD] });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    assert.deepEqual(host.sdk.query('party.actors'), [{ id: 'ac_mara0001', name: 'Mara' }]);
    await host.send('Mara walks in.', reply('+ party Mara'));
    assert.equal(row(host, 'Cane Sword').owner, 'ac_mara0001');
    assert.deepEqual(row(host, 'Cane Sword').bound, { who: 'Mara' });
});

// ---- signature gear through a real + party / - party -----------------------------------------------------------------------------------------

test('+ party hands out the signature gear to the joiner\'s own actor: granted, worn, bound; - party stows it; + party brings it back once', { skip }, async t => {
    const host = await world(t, { user: 'Wessel' });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    const mara = actorIdOf('pack.chat/mara');
    await host.send('Mara walks in.', reply('+ party Mara'));
    assert.equal(rows(host).length, 2);
    for (const name of ['Cane Sword', 'Oak Buckler']) {
        assert.equal(row(host, name).owner, mara, name);
        assert.deepEqual(row(host, name).bound, { who: 'Mara' });
    }
    assert.equal(row(host, 'Cane Sword').equipped, 'weapon');
    assert.equal(host.head().domains.inventory.stacks[row(host, 'Cane Sword').stack].bound, mara);
    assert.match(host.ctx.chat.at(-1).extra.storySuite.receipts.find(entry => entry.type === 'capture.party').summary, /Gear: Cane Sword, Oak Buckler\./);
    assert.doesNotMatch(JSON.stringify(host.turn.problems()), /no party roster/);
    // their own slot card
    assert.equal(host.sdk.query('gear.view', { owner: mara }).slots.weapon.name, 'Cane Sword');
    assert.equal(host.sdk.query('gear.view', { who: 'Mara' }).owner, mara, 'the Party card finds the member by name');
    assert.equal(host.sdk.query('inventory.gear', { owner: mara }).slots.weapon.name, 'Cane Sword');
    await host.send('She goes.', reply('- party Mara'));
    assert.deepEqual(rows(host), [], 'stowed with her');
    assert.deepEqual(Object.keys(host.head().domains.inventory.kept), [mara]);
    await host.send('She is back.', reply('+ party Mara'));
    assert.equal(rows(host).length, 2, 'once');
    assert.equal(row(host, 'Cane Sword').owner, mara);
    assert.equal(row(host, 'Cane Sword').equipped, 'weapon');
});

test('renamed while present (P8): the gear stays hers, the chip and the leave use the new name; the id is the block\'s', { skip }, async t => {
    const host = await world(t, { user: 'Wessel' });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    await host.send('Mara walks in.', reply('+ party Mara'));
    const mara = actorIdOf('pack.chat/mara');
    success(await host.sdk.command('dm.set', { module: 'pack.chat/mara', fields: { who: 'Mara Vell' } }));
    assert.equal(row(host, 'Cane Sword').owner, mara);
    assert.deepEqual(host.sdk.query('inventory.items').find(item => item.name === 'Cane Sword').bound, { who: 'Mara Vell' });
    assert.equal(host.sdk.query('gear.view', { who: 'Mara Vell' }).owner, mara);
    await host.send('She goes.', reply('- party Mara Vell'));
    assert.deepEqual(rows(host), []);
    await host.send('She is back.', reply('+ party Mara Vell'));
    assert.equal(rows(host).length, 2);
    assert.equal(row(host, 'Cane Sword').owner, mara);
});

test('the Edit form: "Equipped by" lists the members; a piece moves to a member and the chip names them', { skip }, async t => {
    const host = await world(t, { user: 'Wessel' });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('A cap.', reply('+ item Iron Cap | kind: head | rarity: common'));
    const spear = row(host, 'Iron Cap');
    const view = host.sdk.query('gear.view', {});
    assert.deepEqual(view.owners, [{ value: 'party', label: 'Wessel' }, { value: actorIdOf('pack.chat/mara'), label: 'Mara' }]);
    success(await host.sdk.command('item.equip', { stack: spear.stack, owner: actorIdOf('pack.chat/mara'), slot: 'head', transfer: true }));
    assert.equal(host.sdk.query('gear.view', {}).rows[spear.stack].by, 'Mara', '"Equipped · Mara"');
});

test('gear off: a join is as in 2.17.0 (no gear, no bound, no kept)', { skip }, async t => {
    const host = await world(t, { user: 'Wessel', gear: false });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    await host.send('Mara walks in.', reply('+ party Mara'));
    assert.deepEqual(rows(host), []);
    assert.doesNotMatch(JSON.stringify(host.head().domains.inventory), /bound|kept/);
    assert.doesNotMatch(host.ctx.chat.at(-1).extra.storySuite.receipts.find(entry => entry.type === 'capture.party').summary, /Gear/);
    await host.send('She goes.', reply('- party Mara'));
    assert.deepEqual(rows(host), []);
});

// ---- a companion owns and wears their own gear; the bonus goes to their rolls --------------------------------------------------------------

test('a companion wears their own piece: their roll has its bonus, the reader\'s has not; live = rebuild = reload', { skip }, async t => {
    const host = await world(t, { user: 'Astra', withPack: false, model: PLAN });
    await define(host, definitionOf('Character'));
    await define(host, definitionOf('Foes'));
    await define(host, definitionOf('Character', 'ren', 'Ren'));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 5 } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/ren', fields: { who: 'Ren', level: 5 } }));
    await host.send('Set.', dmReply(SET));
    await host.send('A blade.', reply('+ item Cane Sword | kind: weapon | rarity: rare | DEX: +2'));
    const ren = actorIdOf('pack.chat/ren'), astra = actorIdOf('pack.chat/character');
    success(await host.sdk.command('item.equip', { stack: row(host, 'Cane Sword').stack, owner: ren, slot: 'weapon', transfer: true }));
    assert.equal(row(host, 'Cane Sword').owner, ren);
    await host.send('Ren strikes.', 'The fight.');
    const result = host.ctx.chat.at(-1).extra.storySuite.receipts.find(entry => entry.type === 'rpg.resolve').data.v2.result;
    assert.deepEqual(result.gear.who.ren.own, [ren]);
    assert.deepEqual(result.gear.who.ren.add, { dex: 2 }, 'Ren\'s roll has the blade');
    assert.deepEqual(result.gear.who.astra.own, [astra, 'party'], 'the reader\'s pieces are the party bag\'s');
    assert.equal(result.gear.who.astra.add, undefined, 'and she wears none');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild');
    await host.st.loadChat(plain(host.ctx.chat));
    assert.equal(JSON.stringify(host.head()), live, 'reload');
    assert.deepEqual(host.store.problems(), []);
});

test('planGear: a Character\'s actor is the one with the block\'s id; the lead is party.pc; a roll made by 2.18.0 (its `lead` name) still finds the reader', () => {
    const sheet = readSheet({ domains: { dataModules: sheetDomain({ wessel: { role: 'character', fields: character('Wessel') }, astra: { role: 'character', fields: character('Astra') } }) } });
    const a = actorIdOf('pack.chat/astra'), w = actorIdOf('pack.chat/wessel');
    const bag = owner => ({ on: true, owner, slots: owner === a ? { weapon: { name: 'Blade', stats: { DEX: 2 }, broken: false } } : {}, statBonus: {}, carry: { encumbered: false, penalty: 0 } });
    const query = pc => (name, args) => (name === 'party.actors' ? [{ id: a, name: 'Astra' }, { id: w, name: 'Wessel' }] : name === 'party.pc' ? pc : name === 'inventory.gear' ? bag(args.owner) : null);
    assert.deepEqual(planGear(sheet, query({ id: w })).who.wessel.own, [w, 'party']);
    assert.deepEqual(planGear(sheet, query({ id: w })).who.astra.own, [a]);
    assert.deepEqual(planGear(sheet, query({ id: a })).who.astra.own, [a, 'party'], 'party.pc decides');
    assert.deepEqual(planGear(sheet, query(null), 'Astra').who.astra.own, [a, 'party'], 'no party.pc: the name the roll carried');
    assert.deepEqual(planGear(sheet, query(null), '').who.astra.own, [a, 'party'], 'nothing names the reader: the first block (astra sorts before wessel)');
    assert.deepEqual(planGear(sheet, query({ id: a })).who.astra.items, [{ name: 'Blade', stats: { dex: 2 } }]);
});

test('the guard: an owner that is another Character\'s actor does not match the roll (F1); a 2.18.0 record of `party` alone still does', () => {
    const state = { domains: { inventory: { defs: {}, stacks: {} }, dataModules: sheetDomain({ wessel: { role: 'character', fields: character('Wessel') }, astra: { role: 'character', fields: character('Astra') } }) } };
    const a = actorIdOf('pack.chat/astra'), w = actorIdOf('pack.chat/wessel');
    const record = who => ({ v: 1, who });
    assert.equal(gearMatches(state, record({ astra: { own: [a, 'party'] }, wessel: { own: [w] } }), hashJson), true);
    assert.equal(gearMatches(state, record({ astra: { own: [w] } }), hashJson), false, 'Wessel\'s actor under Astra');
    assert.equal(gearMatches(state, record({ wessel: { own: [a, 'party'] } }), hashJson), false);
    assert.equal(gearMatches(state, record({ astra: { own: ['party'] } }), hashJson), true, 'a record made before the roster');
    assert.equal(gearMatches(state, record({ astra: { own: ['ac_old00001'] } }), hashJson), true, 'an owner of a roster of another make cannot be told here');
});

// ---- a chat made by 2.18.0 replays as written -----------------------------------------------------------------------------------------------

test('a 2.18.0 chat (no roster: gear on the party bag, a join that gave nothing) replays unchanged, then goes on with owners where they were', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/roster-2180-chat.json', import.meta.url), 'utf8'));
    const raw = pack({ content: { items: ITEMS, cast: [{ ...MARA }] } });
    const built = validatePack(raw);
    const host = await createHost({ callModel: createFakeModel(Array(20).fill('pace: all\nact Astra | target: Mud Crawlers\nfoe Mud Crawlers | target: Astra | defend: AGI')),
        settings: { features: { 'story-block.gear': true, 'story-block.rpg': true }, modules: { 'story-block': { rpgFormula: 'classic', rpgJoin: 'auto' } },
            packs: [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }] } });
    t.after(() => host.close());
    await host.st.loadChat(plain(fixture.chat));
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual(plain(host.head()), fixture.head, 'the state is what 2.18.0 made');
    assert.deepEqual(rows(host).map(item => `${item.name}:${item.owner}:${item.equipped}`), ['Cane Sword:party:weapon', 'Jerkin:party:body'], 'nothing moved to anyone');
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), fixture.head, 'a cold rebuild');
    // the rolls it made keep their gear: the records say `party`, and the guard still matches them
    const results = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(entry => entry.type === 'rpg.resolve').map(entry => entry.data.v2.result);
    assert.ok(results.length >= 2);
    for (const result of results) assert.deepEqual(result.gear?.who?.astra?.own, ['party']);
    // the roster is there now: Astra (Mara left); her gear is still the party bag's
    assert.deepEqual(host.sdk.query('party.actors').map(actor => actor.name), ['Astra']);
    // the first new action: Mara returns and her signature gear is handed out, hers
    await host.send('Mara is back.', reply('+ party Mara'));
    assert.equal(rows(host).find(item => item.name === 'Cane Sword' && !item.bound).owner, 'party', 'the party\'s own blade is not hers');
    const hers = rows(host).filter(item => item.bound);
    assert.deepEqual(hers.map(item => item.owner), [actorIdOf('pack.chat/mara'), actorIdOf('pack.chat/mara')]);
    assert.deepEqual(host.store.problems(), []);
});

test('RPG on, gear off: the 2.18.0 chat renders and replays exactly as 233b131 did (no roster, no members, no pickers); a join gives no gear', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/roster-2180-chat.json', import.meta.url), 'utf8'));
    const expect = JSON.parse(readFileSync(new URL('./fixtures/roster-2180-gear-off.json', import.meta.url), 'utf8'));
    const raw = pack({ content: { items: ITEMS, cast: [{ ...MARA }] } });
    const built = validatePack(raw);
    const host = await createHost({ callModel: createFakeModel(Array(20).fill('x')),
        settings: { features: { 'story-block.rpg': true }, modules: { 'story-block': { rpgFormula: 'classic', rpgJoin: 'auto' } },
            packs: [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }] } });
    t.after(() => host.close());
    await host.st.loadChat(plain(fixture.chat));
    const seen = () => ({ head: plain(host.head()), equipment: plain(host.sdk.query('inventory.equipment')), items: plain(host.sdk.query('inventory.items')), gearView: host.sdk.query('gear.view', {}) });
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual(seen(), { head: expect.head, equipment: expect.equipment, items: expect.items, gearView: expect.gearView });
    assert.equal(host.sdk.query('party.actors'), null);
    assert.deepEqual(host.sdk.query('inventory.equipment').members, [], 'no members, so no pickers and no Give to a member');
    host.store.rebuild();
    assert.deepEqual(seen().head, expect.head, 'a cold rebuild');
    await host.send('Mara is back.', reply('+ party Mara'));
    assert.doesNotMatch(JSON.stringify(host.head().domains.inventory), /bound|kept/);
    assert.equal(host.sdk.query('inventory.items').length, expect.items.length, 'no gear handed out');
});

// ---- a Character who is removed leaves nothing filed under their actor ---------------------------------------------------------------------------

test('dm.remove of a Character: their pieces (worn, bound, set aside) go to the party bag, plain; a block made again under the same name inherits nothing; it replays', { skip }, async t => {
    const host = await world(t, { user: 'Wessel' });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    await define(host, definitionOf('Character', 'ren', 'Ren'));
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('A cap.', reply('+ item Iron Cap | kind: head | rarity: common'));
    const ren = actorIdOf('pack.chat/ren'), mara = actorIdOf('pack.chat/mara');
    success(await host.sdk.command('item.equip', { stack: row(host, 'Iron Cap').stack, owner: ren, slot: 'head', transfer: true }));
    await host.send('The blade is nicked.', reply('~ item Cane Sword | wear: tear'));
    const cond = row(host, 'Cane Sword').cond;
    await host.send('Mara goes.', reply('- party Mara'));
    assert.ok(host.head().domains.inventory.kept[mara], 'her bound pieces are set aside');
    // Ren is removed: the cap goes to the bag, off; Mara is removed: what was set aside is given to the bag, plain
    success(await host.sdk.command('dm.remove', { module: 'pack.chat/ren' }));
    success(await host.sdk.command('dm.remove', { module: 'pack.chat/mara' }));
    const mine = () => rows(host).map(item => `${item.name}:${item.owner}:${item.equipped ?? '-'}:${item.bound ? 'bound' : 'plain'}`).sort();
    assert.deepEqual(mine(), ['Cane Sword:party:-:plain', 'Iron Cap:party:-:plain', 'Oak Buckler:party:-:plain']);
    assert.equal(row(host, 'Cane Sword').cond, cond, 'the wear is kept');
    assert.equal(host.head().domains.inventory.kept, undefined, 'nothing set aside is left');
    assert.doesNotMatch(JSON.stringify(host.head().domains.inventory.stacks), /ac_/);
    // a block made again under the same name has nothing
    await define(host, definitionOf('Character', 'ren', 'Ren'));
    assert.equal(host.sdk.query('gear.view', { owner: ren }).slots.head, null);
    assert.deepEqual(rows(host).filter(item => item.owner === ren), []);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild');
    await host.st.loadChat(plain(host.ctx.chat));
    assert.equal(JSON.stringify(host.head()), live, 'reload');
    assert.deepEqual(host.store.problems(), []);
});

test('dm.remove of a Character who held nothing changes nothing else (no release step)', { skip }, async t => {
    const host = await world(t, { user: 'Wessel', withPack: false });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    await define(host, definitionOf('Character', 'ren', 'Ren'));
    success(await host.sdk.command('dm.remove', { module: 'pack.chat/ren' }));
    assert.deepEqual(host.sdk.query('party.actors').map(actor => actor.name), ['Wessel']);
});

// ---- the reader when the persona names no one --------------------------------------------------------------------------------------------------

test('a persona that matches no Character, with several: party.pc is null, and the screens keep the persona\'s name for the bag', { skip }, async t => {
    const host = await world(t, { user: 'Player' });
    await define(host, definitionOf('Character', 'wessel', 'Wessel'));
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('A cap.', reply('+ item Iron Cap | kind: head | rarity: common'));
    const cap = row(host, 'Iron Cap');
    success(await host.sdk.command('item.equip', { stack: cap.stack, owner: 'party', slot: 'head' }));
    assert.equal(host.sdk.query('party.pc'), null);
    assert.equal(host.sdk.query('party.actors').some(actor => actor.pc), false);
    const view = host.sdk.query('gear.view', {});
    assert.equal(view.owners[0].label, 'Player', 'the label is the persona\'s');
    assert.equal(view.rows[cap.stack].by, 'Player');
});

// ---- a roll that carries a gear record is worked out by what was, not by today's switch -------------------------------------------------------

test('a Re-read after Gear in fights is switched off keeps the companion\'s gear (party.actors / party.pc are asked recorded, as inventory.gear is)', { skip }, async t => {
    const host = await world(t, { user: 'Astra', withPack: false, model: PLAN });
    await define(host, definitionOf('Character'));
    await define(host, definitionOf('Foes'));
    await define(host, definitionOf('Character', 'ren', 'Ren'));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 5 } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/ren', fields: { who: 'Ren', level: 5 } }));
    await host.send('Set.', dmReply(SET));
    await host.send('A blade.', reply('+ item Cane Sword | kind: weapon | rarity: rare | DEX: +2'));
    const ren = actorIdOf('pack.chat/ren');
    success(await host.sdk.command('item.equip', { stack: row(host, 'Cane Sword').stack, owner: ren, slot: 'weapon', transfer: true }));
    await host.send('Ren strikes.', 'The fight.');
    const at = host.ctx.chat.length - 1;
    const resultOf = () => host.ctx.chat[at].extra.storySuite.receipts.find(entry => entry.type === 'rpg.resolve').data.v2.result;
    assert.deepEqual(resultOf().gear.who.ren.own, [ren]);
    const before = resultOf().gear;
    host.features.set('story-block.gear', false);
    assert.equal(host.sdk.query('party.actors'), null, 'asked now: nothing');
    assert.equal(success(await host.turn.reread(at)) !== null, true);
    assert.deepEqual(resultOf().gear, before, 'the roll is worked out as it was made');
});
