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

async function world(t, { gear = true, packs = false, items = ITEMS } = {}) {
    t.mock.method(console, 'warn', () => {});
    const settings = { features: gear ? { 'story-block.gear': true, 'story-block.rpg': true } : {} };
    if (packs) {
        const raw = pack({ content: { items } });
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

test('the kit stays shut while the story has moved on: deleting only the reader\'s message keeps a reply, a speaking narrator or member closes it, deleting the reply too opens it', { skip }, async t => {
    const host = await world(t);
    await host.send('Hello.', reply('+ item Ash-grey Longsword | kind: equipment | rarity: rare | slot: weapon | STR +2'));
    assert.deepEqual(kit(host), { open: false });
    await host.st.deleteMessage(1);
    assert.equal(host.ctx.chat.length, 2);
    assert.deepEqual(kit(host), { open: false });
    await refused(add(host, { name: 'Crown of Deletion', kind: 'equipment', slot: 'head', rarity: 'legendary', stats: { STR: 2, DEX: 2 } }), /after the first message/);
    assert.equal(defOf(host, 'Crown of Deletion'), undefined);
    await host.st.deleteMessage(1);
    assert.equal(host.ctx.chat.length, 1);
    assert.deepEqual(kit(host), { open: true });
    assert.equal((await add(host, { name: 'Crown of Deletion', kind: 'equipment', slot: 'head', rarity: 'legendary', stats: { STR: 2, DEX: 2 } })).ok, true);
    // a narrator or member that speaks with no message from the reader (group auto mode) also ends the kit
    const group = await world(t);
    await group.st.generate('normal', { reply: 'A second voice speaks.' });
    assert.deepEqual(kit(group), { open: false });
    await refused(add(group, { name: 'Late Crown', kind: 'equipment', slot: 'head', rarity: 'legendary' }), /after the first message/);
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

test('a saved character\'s gear (starting: true) comes as written while the kit is open (slot and bonus kept); after it, Common with no bonus and a Problems line says so', { skip }, async t => {
    const host = await world(t);
    const first = await add(host, { name: 'Family Blade', kind: 'equipment', rarity: 'epic', slot: 'weapon', stats: { STR: 2, DEX: 1 }, starting: true });
    assert.equal(first.ok, true, first.message);
    assert.deepEqual([defOf(host, 'Family Blade').rarity, defOf(host, 'Family Blade').slot, defOf(host, 'Family Blade').stats], ['epic', 'weapon', { STR: 2, DEX: 1 }]);
    await host.send('Hello.', 'The road.');
    const out = await add(host, { name: 'Late Blade', kind: 'equipment', rarity: 'epic', slot: 'weapon', stats: { STR: 2 }, starting: true });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual([defOf(host, 'Late Blade').kind, defOf(host, 'Late Blade').rarity, defOf(host, 'Late Blade').stats], ['equipment', 'common', {}]);
    assert.match(JSON.stringify(host.turn.problems()), /Late Blade came in as a Common piece with no bonus/);
});

test('after the kit, "+ Add item" with the name of a story or pack piece makes the reader\'s own Common piece, never a copy of its rarity or bonus; a hand piece still stacks', { skip }, async t => {
    const host = await world(t);
    await host.send('Hello.', reply('+ item Ash-grey Longsword | kind: equipment | rarity: rare | slot: weapon | STR +2'));
    const out = await add(host, { name: 'Ash-grey Longsword', qty: 2, kind: 'equipment', equip: READER });
    assert.equal(out.ok, true, out.message);
    assert.equal(defOf(host, 'Ash-grey Longsword').rarity, 'rare');
    const own = defOf(host, 'Your Ash-grey Longsword');
    assert.deepEqual([own.kind, own.slot, own.rarity, own.stats, own.hand], ['equipment', 'weapon', 'common', {}, true]);
    assert.equal(host.sdk.query('inventory.items').filter(item => item.name === 'Ash-grey Longsword').length, 1);
    const again = await add(host, { name: 'Your Ash-grey Longsword', kind: 'equipment' });
    assert.equal(again.ok, true, again.message);
    assert.equal(Object.values(host.head().domains.inventory.defs).filter(def => def.name.includes('Ash-grey')).length, 2);
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

test('a saved character keeps a hand-set piece exactly: the file carries its slot and bonus, and importing it back gives the same piece', { skip }, async t => {
    const { itemsForFile, parseCharacterFile, buildCharacterFile, fileText } = await import('../../src/v2/lean-rpg/charfile.js');
    const host = await world(t);
    await add(host, { name: 'Wolfskin Cap', kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 1, AGI: 1 } });
    await add(host, { name: 'Lucky Bone', kind: 'equipment', slot: 'accessory-2', rarity: 'common' });
    const items = itemsForFile(host.sdk.query('inventory.items'));
    const stats = { str: 10, vit: 10, agi: 10, dex: 10, int: 10, luk: 10, cha: 10 };
    const parsed = parseCharacterFile(fileText(buildCharacterFile({ level: 1, points: 0, stats, items })));
    assert.equal(parsed.ok, true, parsed.message);
    assert.deepEqual(parsed.file.items.find(item => item.name === 'Wolfskin Cap'), { name: 'Wolfskin Cap', qty: 1, kind: 'equipment', rarity: 'rare', slot: 'head', stats: { VIT: 1, AGI: 1 } });
    const fresh = await world(t);
    for (const item of parsed.file.items) assert.equal((await add(fresh, { ...item, starting: true })).ok, true);
    assert.deepEqual([defOf(fresh, 'Wolfskin Cap').slot, defOf(fresh, 'Wolfskin Cap').stats, defOf(fresh, 'Wolfskin Cap').rarity], ['head', { VIT: 1, AGI: 1 }, 'rare']);
    assert.equal(defOf(fresh, 'Lucky Bone').slot, 'accessory');
    assert.equal(defOf(fresh, 'Wolfskin Cap').hand, true);
});

test('after the kit, a pack piece not held yet (equipment or above Common) added by name makes the reader\'s own Common "Your <name>" with no bonus, worn; the same by a starting: true import', { skip }, async t => {
    const items = [...ITEMS, { name: 'Storm Hood', kind: 'equipment', slot: 'head', rarity: 'epic', stats: { VIT: 2 } }];
    const host = await world(t, { packs: true, items });
    await host.send('Hello.', 'The road.');
    const out = await add(host, { name: 'Rain-Veil Hood', equip: READER });
    assert.equal(out.ok, true, out.message);
    const own = defOf(host, 'Your Rain-Veil Hood');
    assert.deepEqual([own.kind, own.slot, own.rarity, own.stats, own.hand], ['equipment', 'head', 'common', {}, true]);
    assert.equal(defOf(host, 'Rain-Veil Hood'), undefined);
    assert.equal(rowOf(host, 'Your Rain-Veil Hood').equipped, 'head');
    const two = await add(host, { name: 'Storm Hood', qty: 2 });
    assert.equal(two.ok, true, two.message);
    const storm = defOf(host, 'Your Storm Hood');
    assert.deepEqual([storm.rarity, storm.stats, defOf(host, 'Storm Hood')], ['common', {}, undefined]);
    assert.equal(host.sdk.query('inventory.items').filter(item => item.name === 'Your Storm Hood').reduce((n, item) => n + item.qty, 0), 2);
    const late = await add(host, { name: 'Storm Hood', kind: 'equipment', slot: 'head', starting: true });
    assert.equal(late.ok, true, late.message);
    assert.equal(defOf(host, 'Storm Hood'), undefined);
    assert.deepEqual([storm.rarity, defOf(host, 'Your Storm Hood').stats], ['common', {}]);
    const fresh = await world(t, { packs: true, items });
    await fresh.send('Hello.', 'The road.');
    const imp = await add(fresh, { name: 'Rain-Veil Hood', starting: true });
    assert.equal(imp.ok, true, imp.message);
    assert.equal(defOf(fresh, 'Rain-Veil Hood'), undefined);
    const mine = defOf(fresh, 'Your Rain-Veil Hood');
    assert.deepEqual([mine.rarity, mine.stats], ['common', {}]);
});

test('the kit is open while the chat holds only greetings: a group chat with two member greetings opens it; a reader message or a Story Block reply closes it; deleting only your own messages after replies keeps it closed', { skip }, async t => {
    const host = await world(t);
    host.ctx.chat.splice(0, host.ctx.chat.length, { name: 'A', is_user: false, mes: 'First greeting.' }, { name: 'B', is_user: false, mes: 'Second greeting.' });
    assert.deepEqual(kit(host), { open: true });
    for (const [name, stat] of [['Group Cap', 'VIT'], ['Group Ring', 'AGI']]) {
        const made = await add(host, { name, kind: 'equipment', slot: name.endsWith('Cap') ? 'head' : 'accessory', rarity: 'rare', stats: { [stat]: 1 } });
        assert.equal(made.ok, true, made.message);
        assert.deepEqual(kit(host), { open: true });
    }
    await host.st.generate('normal', { reply: 'A voice answers.' });
    assert.deepEqual(kit(host), { open: false });
    const closed = await world(t);
    await closed.send('Hello.', reply('+ item Ash-grey Longsword | kind: equipment | rarity: rare | slot: weapon | STR +2'));
    assert.deepEqual(kit(closed), { open: false });
    await closed.st.deleteMessage(1);
    assert.deepEqual(kit(closed), { open: false });
});

test('a captured reply keeps the kit closed even when the only record on it is a reader edit: plain reply, AI-only plain reply, and a "+ 3 silver" reply, each with a reader add, then deleting your own message', { skip }, async t => {
    for (const text of ['The road.', reply('+ 3 silver')]) {
        const host = await world(t);
        await host.send('Hello.', text);
        assert.equal((await add(host, { name: 'Trail Bread' })).ok, true);
        assert.deepEqual(kit(host), { open: false });
        await host.st.deleteMessage(1);
        assert.equal(host.ctx.chat.length, 2);
        assert.deepEqual(kit(host), { open: false });
        await refused(add(host, { name: 'Crown', kind: 'equipment', slot: 'head', rarity: 'legendary', stats: { STR: 2, DEX: 2 } }), /after the first message/);
    }
    const alone = await world(t);
    await alone.st.generate('normal', { reply: 'A voice answers.' });
    assert.deepEqual(kit(alone), { open: false });
    assert.equal((await add(alone, { name: 'Trail Bread' })).ok, true);
    assert.deepEqual(kit(alone), { open: false });
});

test('a chat written before the reply mark (records without it) stays closed once a non-head message holds a record', { skip }, async t => {
    const host = await world(t);
    await host.send('Hello.', 'The road.');
    assert.equal((await add(host, { name: 'Trail Bread' })).ok, true);
    for (const message of host.ctx.chat) {
        const records = [message.extra?.storySuite, ...(message.swipe_info ?? []).map(info => info?.extra?.storySuite)];
        for (const record of records) if (record) { delete record.reply; delete record.mv; }
    }
    await host.st.deleteMessage(1);
    assert.deepEqual(kit(host), { open: false });
});

test('swiping a reply after deleting your message keeps the kit closed; swiping the opening greeting keeps it open', { skip }, async t => {
    const host = await world(t);
    await host.send('Hello.', reply('+ item Ash-grey Longsword | kind: equipment | rarity: rare | slot: weapon | STR +2'));
    await host.st.deleteMessage(1);
    assert.deepEqual(kit(host), { open: false });
    await host.swipe(reply('+ 2 silver'));
    assert.deepEqual(kit(host), { open: false });
    const plain = await world(t);
    await plain.st.generate('normal', { reply: 'A voice answers.' });
    await plain.swipe('Another voice.');
    assert.deepEqual(kit(plain), { open: false });
    const greet = await world(t);
    await greet.swipe('Another greeting.');
    assert.deepEqual(kit(greet), { open: true });
});
