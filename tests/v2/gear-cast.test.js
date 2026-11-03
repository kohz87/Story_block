// A cast member's signature gear (`story-block.gear`, docs/v2/GEAR.md "Signature gear", PACKS.md "The cast"): the `gear` field and
// its refusals, what a join brings (items owned by the person and put on, in the join's one receipt), the same join with gear off,
// a second join without duplicates, replay equality, and the narrator's "Gear:" line (query `packs.castGear`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { LEAN_RPG_TEMPLATES } from '../../src/v2/lean-rpg/templates.js';
import { pack } from './packs/helpers/fixtures.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;

const ITEMS = [
    { name: 'Cane Sword', kind: 'equipment', slot: 'weapon', rarity: 'uncommon' },
    { name: 'Oak Buckler', kind: 'equipment', slot: 'shield', rarity: 'common' },
    { name: 'Ferry Coat', kind: 'equipment', slot: 'armour', rarity: 'common' },
    { name: 'Tin Ring', kind: 'equipment', slot: 'accessory', rarity: 'common' },
    { name: 'Lucky Charm', kind: 'equipment', slot: 'accessory', rarity: 'common' },
    { name: 'Bone Amulet', kind: 'equipment', slot: 'accessory', rarity: 'common' },
    { name: 'Rusty Spear', kind: 'equipment', slot: 'weapon', rarity: 'common' },
    { name: 'Ship Biscuit', kind: 'consumable' },
    { name: 'Pebble', kind: 'equipment' },
];
const person = (extra = {}) => ({ id: 'mara', name: 'Mara', aliases: ['the ferrywoman'], about: 'Runs the night ferry.', look: 'Wiry.', start: { place: 'Docks', goal: 'Keep the ferry running.' }, ...extra });
const withCast = list => pack({ content: { items: ITEMS, cast: list } });
const refused = (list, path) => {
    const result = validatePack(JSON.stringify(withCast(list)));
    assert.equal(result.ok, false, `${path} should be refused`);
    const hit = result.errors.find(error => error.path === path);
    assert.ok(hit, `no error at ${path}: ${JSON.stringify(result.errors)}`);
    assert.ok(hit.message.length > 20, 'a sentence the reader can act on');
    return hit;
};

test('gear: names and slugs are kept as item ids; two accessories are fine; nothing is added when it is left out', () => {
    const ok = validatePack(withCast([person({ gear: ['Cane Sword', 'oak-buckler', 'Ferry Coat', 'Tin Ring', 'lucky-charm'] })]));
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.deepEqual(ok.pack.content.cast[0].gear, ['pack.mini/cane-sword', 'pack.mini/oak-buckler', 'pack.mini/ferry-coat', 'pack.mini/tin-ring', 'pack.mini/lucky-charm']);
    const bare = validatePack(withCast([person()]));
    assert.equal('gear' in bare.pack.content.cast[0], false);
    assert.equal('gear' in validatePack(withCast([person({ gear: [] })])).pack.content.cast[0], false, 'an empty list is nothing');
});

test('gear is refused: an unknown item, a non-equipment item, no slot, a slot clash, three accessories, a repeat, more than six, not a list', () => {
    assert.match(refused([person({ gear: ['Dragon Egg'] })], 'content.cast[0].gear[0]').message, /Dragon Egg/);
    assert.equal(refused([person({ gear: ['Dragon Egg'] })], 'content.cast[0].gear[0]').code, 'UNKNOWN_REF');
    assert.match(refused([person({ gear: ['Ship Biscuit'] })], 'content.cast[0].gear[0]').message, /not equipment/);
    assert.match(refused([person({ gear: ['Pebble'] })], 'content.cast[0].gear[0]').message, /not equipment with a gear slot/);
    assert.match(refused([person({ gear: ['Cane Sword', 'Rusty Spear'] })], 'content.cast[0].gear[1]').message, /both take the weapon slot/);
    assert.match(refused([person({ gear: ['Tin Ring', 'Lucky Charm', 'Bone Amulet'] })], 'content.cast[0].gear[2]').message, /accessory/);
    assert.equal(refused([person({ gear: ['Cane Sword', 'cane-sword'] })], 'content.cast[0].gear[1]').code, 'DUPLICATE');
    assert.match(refused([person({ gear: ['Cane Sword', 'Oak Buckler', 'Ferry Coat', 'Tin Ring', 'Lucky Charm', 'Bone Amulet', 'Rusty Spear'] })], 'content.cast[0].gear').message, /at most 6/);
    refused([person({ gear: 'Cane Sword' })], 'content.cast[0].gear');
    refused([person({ gear: [7] })], 'content.cast[0].gear[0]');
});

// ---- a join ---------------------------------------------------------------------------------------------------------------------------

const ACTORS = { id: 'zz-party', version: '0.0.0', queries: { 'party.actors': () => [{ id: 'ac_mara0001', name: 'Mara' }, { id: 'ac_wessel01', name: 'Wessel' }] } };
const GEAR = ['Cane Sword', 'Oak Buckler', 'Tin Ring'];

async function world(t, { gear = true, actors = true, list = [person({ gear: GEAR })] } = {}) {
    t.mock.method(console, 'warn', () => {});
    const raw = withCast(list);
    const built = validatePack(raw);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const host = await createHost({
        modules: actors ? [ACTORS] : [],
        settings: { features: gear ? { 'story-block.gear': true, 'story-block.rpg': true } : { 'story-block.rpg': true }, modules: { 'story-block': { rpgJoin: 'auto', rpgFormula: 'classic' } },
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
const rows = host => host.sdk.query('inventory.items');
const receipts = host => host.ctx.chat.at(-1).extra.storySuite.receipts;
const receipt = host => receipts(host).find(entry => entry.type === 'capture.party');
// (a stack's `from` names the reply that made it, which a Re-read renews)
const stable = inv => ({ ...inv, stacks: Object.fromEntries(Object.entries(inv.stacks).map(([id, item]) => [id, { ...item, from: undefined }])) });
const bytes = host => JSON.stringify([stable(host.head().domains.inventory), host.head().domains.dataModules?.active, host.sdk.query('inventory.items').map(row => ({ ...row, from: undefined }))]);

test('gear on: the join adds the signature gear to the person, put on in its slots, Good, in the join\'s own receipt', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara | about: a ferrywoman'));
    const worn = Object.fromEntries(rows(host).filter(row => row.owner === 'ac_mara0001').map(row => [row.name, row.equipped]));
    assert.deepEqual(worn, { 'Cane Sword': 'weapon', 'Oak Buckler': 'off-hand', 'Tin Ring': 'accessory-1' });
    assert.deepEqual(rows(host).filter(row => row.owner !== 'ac_mara0001'), [], 'no one else got them');
    assert.equal(host.sdk.query('inventory.gear', { owner: 'ac_mara0001' }).slots.weapon.cond, 100, 'condition Good');
    const joined = receipt(host);
    assert.equal(joined.summary, 'Mara joined the party. Gear: Cane Sword, Oak Buckler, Tin Ring.');
    assert.deepEqual(joined.data.gear, { owner: 'ac_mara0001', items: GEAR });
    assert.deepEqual(receipts(host).map(entry => entry.type).filter(type => type !== 'dm.settle'), ['capture.party'], 'no receipt of its own');
    assert.deepEqual(host.turn.problems().filter(item => item.code !== 'ROLLS_SKIPPED'), []);
});

test('gear off: the same join is as it was without the field (same receipts, same state)', { skip }, async t => {
    const off = await world(t, { gear: false });
    const bare = await world(t, { gear: false, list: [person()] });
    await off.send('Mara walks in.', reply('+ party Mara | about: a ferrywoman'));
    await bare.send('Mara walks in.', reply('+ party Mara | about: a ferrywoman'));
    assert.deepEqual(rows(off), []);
    assert.equal(receipt(off).summary, 'Mara joined the party.');
    assert.equal('gear' in receipt(off).data, false);
    const strip = host => JSON.stringify(receipts(host).map(({ type, module, cause, summary, narrate, data, rev, guarded, line }) => ({ type, module, cause, summary, narrate, join: data.join, keys: Object.keys(data), rev, guarded, line })));
    assert.equal(strip(off), strip(bare), 'byte-identical receipts');
    assert.equal(bytes(off), bytes(bare));
});

test('a person whose pack lists no gear, or who is not in the cast, joins exactly as before even with gear on', { skip }, async t => {
    const host = await world(t, { list: [person()] });
    await host.send('Two arrive.', reply('+ party Mara', '+ party Pip'));
    assert.deepEqual(rows(host), []);
    assert.deepEqual(receipts(host).filter(entry => entry.type === 'capture.party').map(entry => entry.summary), ['Mara joined the party.', 'Pip joined the party.']);
});

test('an alias finds the person; without a party actor nothing is given (pinned change, 3 Nov: it used to be put on in the party\'s bag)', { skip }, async t => {
    const host = await world(t, { actors: false, list: [person({ gear: GEAR }), person({ id: 'tam', name: 'Tam', aliases: [], gear: ['Rusty Spear', 'Oak Buckler'] })] });
    await host.send('Both.', reply('+ party the ferrywoman', '+ party Tam'));
    const worn = Object.fromEntries(rows(host).filter(row => row.owner === 'party').map(row => [row.name, row.equipped ?? null]));
    assert.deepEqual(worn, {});
});

test('leaving and coming back does not duplicate what they still own', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('She goes.', reply('- party Mara'));
    assert.equal(rows(host).length, 3, 'leaving keeps their things');
    await host.send('She is back.', reply('+ party Mara'));
    assert.equal(rows(host).length, 3, 'nothing doubled');
    assert.equal(receipt(host).summary, 'Mara is back in the party.');
    assert.equal('gear' in receipt(host).data, false);
});

test('coming back brings only the piece they no longer own', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara'));
    await host.send('She goes.', reply('- party Mara'));
    const sword = rows(host).find(row => row.name === 'Cane Sword');
    assert.equal((await host.sdk.command('inventory.drop', { stack: sword.stack })).ok, true, 'she sold it');
    assert.equal(rows(host).length, 2);
    await host.send('She is back.', reply('+ party Mara'));
    assert.deepEqual(rows(host).map(row => row.name).sort(), ['Cane Sword', 'Oak Buckler', 'Tin Ring']);
    assert.equal(rows(host).find(row => row.name === 'Cane Sword').equipped, 'weapon');
    assert.equal(receipt(host).summary, 'Mara is back in the party. Gear: Cane Sword.');
});

test('replay equals live: a rebuild, a reload, a Re-read, a swipe and a delete', { skip }, async t => {
    const host = await world(t);
    await host.send('Mara walks in.', reply('+ party Mara'));
    const live = bytes(host);
    assert.equal(rows(host).length, 3);
    host.store.rebuild();
    assert.equal(bytes(host), live, 'a rebuild equals live');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(bytes(host), live, 'a reload equals live');
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.equal(bytes(host), live, 'a Re-read equals live');
    await host.swipe(reply('Nobody after all.', ['+ coin 1']));
    assert.deepEqual(rows(host), [], 'a swipe takes the join and its gear away together');
    assert.equal(host.head().domains.dataModules.active['pack.chat/mara'], undefined);
    await host.send('Mara again.', reply('+ party Mara'));
    assert.equal(rows(host).length, 3);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.deepEqual(rows(host), [], 'a delete takes them away too');
    assert.deepEqual(host.store.problems(), []);
    host.store.rebuild();
    assert.deepEqual(rows(host), []);
});

// ---- the narrator's line -----------------------------------------------------------------------------------------------------------

test('packs.castGear: the "Gear:" line while the person is not in the party, only with gear on; null otherwise', { skip }, async t => {
    const host = await world(t);
    assert.deepEqual(host.sdk.query('packs.castGear', { name: 'Mara' }), {
        name: 'Mara', line: 'Gear: Cane Sword, Oak Buckler, Tin Ring',
        items: [{ id: 'pack.mini/cane-sword', name: 'Cane Sword', slot: 'weapon' }, { id: 'pack.mini/oak-buckler', name: 'Oak Buckler', slot: 'off-hand' }, { id: 'pack.mini/tin-ring', name: 'Tin Ring', slot: 'accessory' }],
    });
    assert.equal(host.sdk.query('packs.castGear', { name: 'the ferrywoman' }).name, 'Mara', 'by alias');
    assert.equal(host.sdk.query('packs.castGear', { name: 'Nobody' }), null);
    await host.send('Mara walks in.', reply('+ party Mara'));
    assert.equal(host.sdk.query('packs.castGear', { name: 'Mara' }), null, 'in the party: the sheet shows it');
    await host.send('She goes.', reply('- party Mara'));
    assert.equal(host.sdk.query('packs.castGear', { name: 'Mara' })?.line, 'Gear: Cane Sword, Oak Buckler, Tin Ring', 'out again');
});

test('packs.castGear is null with gear off, and the static prompt carries no gear either way (byte-identical)', { skip }, async t => {
    const off = await world(t, { gear: false });
    assert.equal(off.sdk.query('packs.castGear', { name: 'Mara' }), null);
    const bare = await world(t, { gear: false, list: [person()] });
    const statics = host => host.registry.contexts().map(context => context.static ?? '').join('\n');
    assert.equal(statics(off), statics(bare));
    assert.doesNotMatch(statics(off), /Gear:/);
});
