// Hand-set gear, the starting kit (`story-block.gear`, docs/v2/GEAR.md "Your own gear"): "+ Add item" and the Edit of a piece the reader added set Kind, Slot,
// Rarity and a Bonus (up to 2 stats, held to the rarity's points) and put the piece on, but Rarity and Bonus only while the chat is at its first message (no message
// from the reader yet). The commands hold every rule themselves, not only the form. Gear off: unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { pack } from './packs/helpers/fixtures.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const ACTORS = { id: 'zz-party', version: '0.0.0', queries: { 'party.actors': () => [{ id: 'ac_astra001', name: 'Astra', pc: true }, { id: 'ac_harrak01', name: 'Harrak' }], 'party.pc': () => ({ id: 'ac_astra001' }) } };
const ITEMS = [{ name: 'Rain-Veil Hood', kind: 'equipment', slot: 'head', rarity: 'rare' }];

async function world(t, { gear = true, packs = false } = {}) {
    t.mock.method(console, 'warn', () => {});
    const settings = { features: gear ? { 'story-block.gear': true, 'story-block.rpg': true } : {} };
    if (packs) {
        const raw = pack({ content: { items: ITEMS } });
        const built = validatePack(raw);
        assert.equal(built.ok, true, JSON.stringify(built.errors));
        settings.packs = [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }];
    }
    const host = await createHost({ modules: [ACTORS], settings });
    t.after(() => host.close());
    return host;
}
const add = (host, payload) => host.sdk.command('inventory.add', { qty: 1, ...payload });
const rowOf = (host, name) => host.sdk.query('inventory.items').find(item => item.name === name);
const defOf = (host, name) => Object.values(host.head().domains.inventory.defs).find(item => item.name === name);
const refused = async (promise, pattern) => {
    const out = await promise;
    assert.equal(out.ok, false, 'should be refused');
    assert.match(out.message ?? out.error?.message ?? JSON.stringify(out), pattern);
    return out;
};
const kit = host => host.sdk.query('gear.view')?.kit;
const READER = 'ac_astra001';

test('the starting kit is open while the chat has no message from the reader, and gear.view says so', { skip }, async t => {
    const host = await world(t);
    assert.deepEqual(kit(host), { open: true });
    await host.send('Hello.', 'The road.');
    assert.deepEqual(kit(host), { open: false });
});

test('kit open: Kind, Slot, Rarity and a Bonus within the budget are kept on the new piece, which is marked as the reader\'s', { skip }, async t => {
    const host = await world(t);
    const out = await add(host, { name: 'Wolfskin Cap', kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 1, AGI: 1 } });
    assert.equal(out.ok, true, out.message);
    const def = defOf(host, 'Wolfskin Cap');
    assert.deepEqual([def.kind, def.slot, def.rarity, def.stats, def.hand, def.stack], ['equipment', 'head', 'rare', { VIT: 1, AGI: 1 }, true, false]);
    const view = host.sdk.query('gear.view');
    assert.deepEqual(view.rows[rowOf(host, 'Wolfskin Cap').stack].stats, { VIT: 1, AGI: 1 });
    assert.equal(view.rows[rowOf(host, 'Wolfskin Cap').stack].hand, true);
});

test('a bonus over the rarity\'s budget is refused by the command, with the form\'s sentence, and nothing is added', { skip }, async t => {
    const host = await world(t);
    await refused(add(host, { name: 'Greedy Cap', kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 2, AGI: 1 } }), /^A rare piece gives at most 2 points\.$/);
    await refused(add(host, { name: 'Greedy Cap', kind: 'equipment', slot: 'head', rarity: 'uncommon', stats: { VIT: 2 } }), /^An uncommon piece gives at most 1 point\.$/);
    await refused(add(host, { name: 'Greedy Cap', kind: 'equipment', slot: 'head', stats: { VIT: 1 } }), /^A common piece gives no bonus\.$/);
    assert.equal(rowOf(host, 'Greedy Cap'), undefined);
    assert.equal(defOf(host, 'Greedy Cap'), undefined);
});

test('a bonus names at most 2 different stats, each a whole number of at least 1, from the seven', { skip }, async t => {
    const host = await world(t);
    const base = { name: 'Odd Ring', kind: 'equipment', slot: 'accessory-1', rarity: 'legendary' };
    await refused(add(host, { ...base, stats: { STR: 1, DEX: 1, INT: 1 } }), /at most 2 different stats/);
    await refused(add(host, { ...base, stats: { WIS: 1 } }), /at most 2 different stats/);
    await refused(add(host, { ...base, stats: { STR: 0 } }), /at most 2 different stats/);
    await refused(add(host, { ...base, stats: { STR: 1.5 } }), /at most 2 different stats/);
    assert.equal((await add(host, { ...base, stats: { STR: 2, INT: 2 } })).ok, true, 'a legendary piece may give 4 points over 2 stats');
});

test('after the first message Rarity above Common and any Bonus are refused by the command; Kind, Slot and Equip on still work', { skip }, async t => {
    const host = await world(t);
    await host.send('Hello.', 'The road.');
    await refused(add(host, { name: 'Late Cap', kind: 'equipment', slot: 'head', rarity: 'rare' }), /^Rarity and bonuses come from the story after the first message\.$/);
    await refused(add(host, { name: 'Late Cap', kind: 'equipment', slot: 'head', stats: { VIT: 1 } }), /after the first message/);
    assert.equal(defOf(host, 'Late Cap'), undefined);
    const out = await add(host, { name: 'Forgotten Coat', kind: 'equipment', slot: 'body', rarity: 'common', equip: READER });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual([defOf(host, 'Forgotten Coat').rarity, defOf(host, 'Forgotten Coat').stats], ['common', {}]);
    assert.equal(rowOf(host, 'Forgotten Coat').equipped, 'body');
});

test('a greeting swipe keeps the kit open; the first message from the reader closes it', { skip }, async t => {
    const host = await world(t);
    await host.swipe('Another greeting.');
    assert.deepEqual(kit(host), { open: true });
    assert.equal((await add(host, { name: 'Wolfskin Cap', kind: 'equipment', slot: 'head', rarity: 'epic', stats: { VIT: 3 } })).ok, true);
    await host.send('Hello.', 'The road.');
    assert.deepEqual(kit(host), { open: false });
    await refused(add(host, { name: 'Other Cap', kind: 'equipment', slot: 'head', rarity: 'epic' }), /after the first message/);
});

test('deleting every message from the reader on reopens the kit (a restart); a piece set up before stays as it was', { skip }, async t => {
    const host = await world(t);
    assert.equal((await add(host, { name: 'Wolfskin Cap', kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 1 } })).ok, true);
    await host.send('Hello.', 'The road.');
    await host.send('Onward.', 'The hills.');
    assert.deepEqual(kit(host), { open: false });
    const length = host.ctx.chat.length;
    for (let at = length - 1; at >= 1; at -= 1) await host.st.deleteMessage(at);
    assert.equal(host.ctx.chat.length, 1);
    assert.deepEqual(kit(host), { open: true });
    assert.equal(defOf(host, 'Wolfskin Cap').rarity, 'rare');
    assert.equal((await add(host, { name: 'Second Cap', kind: 'equipment', slot: 'head', rarity: 'rare', stats: { AGI: 2 } })).ok, true);
});

test('Equip on: the reader or a party member wears it in the slot; a second accessory goes to Accessory 2', { skip }, async t => {
    const host = await world(t);
    assert.equal((await add(host, { name: 'Lucky Bone Ring', kind: 'equipment', slot: 'accessory-1', equip: READER })).ok, true);
    assert.equal(rowOf(host, 'Lucky Bone Ring').equipped, 'accessory-1');
    const second = await add(host, { name: 'Silver Band', kind: 'equipment', slot: 'accessory-1', equip: READER });
    assert.equal(second.ok, true, second.message);
    assert.equal(rowOf(host, 'Silver Band').equipped, 'accessory-2', 'the first place is taken');
    assert.equal(rowOf(host, 'Lucky Bone Ring').equipped, 'accessory-1', 'the first piece stays');
    const harrak = await add(host, { name: 'Harrak\'s Cloak', kind: 'equipment', slot: 'cloak', equip: 'ac_harrak01' });
    assert.equal(harrak.ok, true, harrak.message);
    const cloak = rowOf(host, 'Harrak\'s Cloak');
    assert.deepEqual([cloak.owner, cloak.equipped], ['ac_harrak01', 'cloak']);
});

test('Equip on needs equipment and a slot; a refusal adds nothing', { skip }, async t => {
    const host = await world(t);
    await refused(add(host, { name: 'Bread', kind: 'goods', equip: READER }), /equipment/);
    await refused(add(host, { name: 'Shapeless Thing', kind: 'equipment', equip: READER }), /Choose a slot/);
    await refused(add(host, { name: 'Odd Hat', kind: 'equipment', slot: 'crown', equip: READER }), /The slot is one of/);
    await refused(add(host, { name: 'Ghost Hat', kind: 'equipment', slot: 'head', equip: 'ac_nobody01' }), /not in the party/);
    for (const name of ['Bread', 'Shapeless Thing', 'Odd Hat', 'Ghost Hat']) assert.equal(defOf(host, name), undefined, name);
});

test('Kind other than Equipment carries no slot or bonus, whatever the name says (a "Ring" chosen as Goods is goods)', { skip }, async t => {
    const host = await world(t);
    assert.equal((await add(host, { name: 'Lucky Bone Ring', kind: 'goods' })).ok, true);
    const def = defOf(host, 'Lucky Bone Ring');
    assert.deepEqual([def.kind, def.slot, def.stats, def.stack], ['goods', null, {}, true]);
    await refused(add(host, { name: 'Salve', kind: 'consumable', slot: 'head' }), /for equipment/);
    await refused(add(host, { name: 'Salve', kind: 'consumable', stats: { STR: 1 }, rarity: 'rare' }), /for equipment/);
});

test('a pack item keeps its own kind, slot and rarity; it can still be equipped from the add', { skip }, async t => {
    const host = await world(t, { packs: true });
    const out = await add(host, { name: 'Rain-Veil Hood', kind: 'goods', equip: READER });
    assert.equal(out.ok, true, out.message);
    const def = Object.values(host.head().domains.inventory.defs).find(item => item.name === 'Rain-Veil Hood');
    assert.deepEqual([def.kind, def.rarity, def.hand], ['equipment', 'rare', undefined]);
    assert.equal(rowOf(host, 'Rain-Veil Hood').equipped, 'head');
});

test('Edit: Kind, Slot, Rarity and Bonus of a piece the reader added change while the kit is open', { skip }, async t => {
    const host = await world(t);
    await add(host, { name: 'Lucky Bone Ring', kind: 'equipment', slot: 'accessory-1', equip: READER });
    const stack = rowOf(host, 'Lucky Bone Ring').stack;
    const out = await host.sdk.command('inventory.edit', { stack, group: true, rarity: 'rare', stats: { LUK: 2 }, slot: 'accessory-2' });
    assert.equal(out.ok, true, out.message);
    const def = defOf(host, 'Lucky Bone Ring');
    assert.deepEqual([def.rarity, def.stats, def.slot], ['rare', { LUK: 2 }, 'accessory']);
    await refused(host.sdk.command('inventory.edit', { stack, group: true, stats: { LUK: 3 } }), /^A rare piece gives at most 2 points\.$/);
    await refused(host.sdk.command('inventory.edit', { stack, group: true, rarity: 'common' }), /^A common piece gives no bonus\.$/);
    assert.deepEqual(defOf(host, 'Lucky Bone Ring').stats, { LUK: 2 });
});

test('Edit after the first message: Rarity and Bonus are read-only on a hand-added piece; Kind, Slot, name, count and note still change', { skip }, async t => {
    const host = await world(t);
    await add(host, { name: 'Wolfskin Cap', kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 1, AGI: 1 } });
    await host.send('Hello.', 'The road.');
    const stack = rowOf(host, 'Wolfskin Cap').stack;
    await refused(host.sdk.command('inventory.edit', { stack, group: true, rarity: 'epic' }), /after the first message/);
    await refused(host.sdk.command('inventory.edit', { stack, group: true, stats: { VIT: 2 } }), /after the first message/);
    await refused(host.sdk.command('inventory.edit', { stack, group: true, rarity: 'common' }), /after the first message/);
    assert.deepEqual([defOf(host, 'Wolfskin Cap').rarity, defOf(host, 'Wolfskin Cap').stats], ['rare', { VIT: 1, AGI: 1 }]);
    // (the same words as they stand are no change)
    assert.equal((await host.sdk.command('inventory.edit', { stack, group: true, rarity: 'rare', stats: { VIT: 1, AGI: 1 }, note: 'wolf hide' })).ok, true);
    assert.equal((await host.sdk.command('inventory.edit', { stack, group: true, slot: 'cloak' })).ok, true);
    assert.equal(defOf(host, 'Wolfskin Cap').slot, 'cloak');
});

test('kind can change on a hand-added piece; Equipment later is Common with no Bonus, and leaving Equipment takes it off', { skip }, async t => {
    const host = await world(t);
    await add(host, { name: 'Wolfskin Cap', kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 2 }, equip: READER });
    await add(host, { name: 'Trinket', kind: 'goods', qty: 3 });
    await host.send('Hello.', 'The road.');
    // equipment -> goods: slot, bonus and the worn place go; the rarity word stays
    const cap = rowOf(host, 'Wolfskin Cap').stack;
    assert.equal((await host.sdk.command('inventory.edit', { stack: cap, group: true, kind: 'goods' })).ok, true);
    assert.deepEqual([defOf(host, 'Wolfskin Cap').kind, defOf(host, 'Wolfskin Cap').slot, defOf(host, 'Wolfskin Cap').stats, defOf(host, 'Wolfskin Cap').stack], ['goods', null, {}, true]);
    assert.equal(rowOf(host, 'Wolfskin Cap').equipped, null);
    // goods -> equipment later: Common, no bonus; a Count above 1 becomes separate pieces
    const trinket = rowOf(host, 'Trinket').stack;
    const out = await host.sdk.command('inventory.edit', { stack: trinket, group: true, kind: 'equipment', slot: 'accessory-1' });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual([defOf(host, 'Trinket').kind, defOf(host, 'Trinket').rarity, defOf(host, 'Trinket').stats, defOf(host, 'Trinket').stack], ['equipment', 'common', {}, false]);
    assert.equal(host.sdk.query('inventory.items').filter(item => item.name === 'Trinket').length, 3);
    // ... and a rare one is refused after the first message
    await refused(host.sdk.command('inventory.edit', { stack: cap, group: true, kind: 'equipment', rarity: 'rare' }), /after the first message/);
});

test('kind becoming Equipment while the kit is open may take the rarity and bonus asked', { skip }, async t => {
    const host = await world(t);
    await add(host, { name: 'Trinket', kind: 'goods' });
    const out = await host.sdk.command('inventory.edit', { stack: rowOf(host, 'Trinket').stack, group: true, kind: 'equipment', slot: 'accessory-1', rarity: 'uncommon', stats: { LUK: 1 } });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual([defOf(host, 'Trinket').rarity, defOf(host, 'Trinket').stats], ['uncommon', { LUK: 1 }]);
});

test('a pack item\'s and the story\'s items refuse the hand-set words with their reasons; a story piece the reader\'s name matches is the story\'s', { skip }, async t => {
    const host = await world(t, { packs: true });
    await add(host, { name: 'Rain-Veil Hood' });
    await host.send('Hello.', reply('+ item Cane Sword | rarity: rare | equipped: weapon'));
    const hood = rowOf(host, 'Rain-Veil Hood').stack, sword = rowOf(host, 'Cane Sword').stack;
    await refused(host.sdk.command('inventory.edit', { stack: hood, group: true, kind: 'goods' }), /^Kind, slot and rarity come from the pack\.$/);
    await refused(host.sdk.command('inventory.edit', { stack: sword, group: true, rarity: 'common' }), /^Kind, slot and rarity come from the story\.$/);
    // adding what the story gave does not make it the reader's
    await add(host, { name: 'Cane Sword' });
    await refused(host.sdk.command('inventory.edit', { stack: rowOf(host, 'Cane Sword').stack, group: true, kind: 'goods' }), /from the story/);
    assert.notEqual(defOf(host, 'Cane Sword').hand, true);
});

test('unknown kind, rarity or stats are refused as malformed', { skip }, async t => {
    const host = await world(t);
    await refused(add(host, { name: 'X', kind: 'weapon' }), /The kind of an item is one of/);
    await refused(add(host, { name: 'X', kind: 'equipment', rarity: 'mythic' }), /The rarity of an item is one of/);
    await refused(add(host, { name: 'X', kind: 'equipment', stats: 'VIT' }), /at most 2 different stats/);
    await add(host, { name: 'Y', kind: 'goods' });
    await refused(host.sdk.command('inventory.edit', { stack: rowOf(host, 'Y').stack, group: true, kind: 'weapon' }), /The kind of an item is one of/);
});

test('a saved character\'s starting things (starting: true) keep the kind and rarity the file gave, after the first message too', { skip }, async t => {
    const host = await world(t);
    await host.send('Hello.', 'The road.');
    const out = await add(host, { name: 'Family Blade', kind: 'equipment', rarity: 'epic', starting: true });
    assert.equal(out.ok, true, out.message);
    assert.equal(defOf(host, 'Family Blade').rarity, 'epic');
});

test('gear off: "+ Add item" is today\'s (name, count, note, and kind and rarity as before); the gear words are refused and nothing is marked', { skip }, async t => {
    const host = await world(t, { gear: false });
    assert.equal(host.sdk.query('gear.view'), null);
    const out = await add(host, { name: 'Wolfskin Cap', note: 'wolf hide' });
    assert.equal(out.ok, true, out.message);
    assert.equal(defOf(host, 'Wolfskin Cap').hand, undefined, 'the def is exactly as before');
    await refused(add(host, { name: 'Late Cap', slot: 'head' }), /Gear in fights is not switched on/);
    await refused(add(host, { name: 'Late Cap', equip: READER }), /Gear in fights is not switched on/);
    await refused(host.sdk.command('inventory.edit', { stack: rowOf(host, 'Wolfskin Cap').stack, group: true, kind: 'goods' }), /Gear in fights is not switched on/);
    assert.equal(defOf(host, 'Late Cap'), undefined);
});

test('replay equals live: the state the add left is what a rebuild of the chat gives, and a swipe of the reply after it changes nothing', { skip }, async t => {
    const host = await world(t);
    await add(host, { name: 'Wolfskin Cap', kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 1, AGI: 1 }, equip: READER });
    await host.send('Hello.', 'The road.');
    const before = JSON.stringify(host.head().domains.inventory.defs);
    await host.swipe('Another road.');
    assert.equal(JSON.stringify(host.head().domains.inventory.defs), before);
    assert.equal(rowOf(host, 'Wolfskin Cap').equipped, 'head');
    await host.turn.onChatChanged();
    assert.equal(JSON.stringify(host.head().domains.inventory.defs), before, 'after a reload of the chat');
    assert.deepEqual(kit(host), { open: false });
});
