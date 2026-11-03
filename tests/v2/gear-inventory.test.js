// Gear in fights, inventory side (`story-block.gear`, off by default; docs/v2/GEAR.md): bonuses by rarity (a pack item may set its
// own 0…6), the slot and rarity a story-made item gets from the line's words and name (numbers on the line are ignored, the
// story's rarity stops at epic), the carry capacity that answers `items.carry` (10 + 2 × STR, only while the feature is on, so
// the encumbered condition can fire), and the wear API (`gear.wear`) that breaks a piece and takes its bonus away. Replay
// equals live after a swipe, a Re-read, a delete, a rebuild and a reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONDITION, GEAR, KIND_CARRY, capacityFor, carryPicture, condMark, condWord, itemCarryOf, kindCarry, stepUp, slotWordOf, stepDown, travelsWith, valueByCond, gearBudget, gearRarityOf, gearSlotOf, statsFor, statsOf, withinBudget, defaultStat } from '../../src/v2/domains/gear.js';
import { validateInventory } from '../../src/v2/domains/inventory.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { itemDef } from '../../src/v2/packs/content.js';
import { createHost } from '../../testkit/index.js';
import { page, settle } from './lean-rpg/view/page.js';
import { createCoreModule } from '../../src/v2/domains/index.js';
import { createHarness, line } from './domains/helpers/fake-ctx.js';
import { core, def, stack, stocked } from './domains/fixtures.js';
import { pack } from './packs/helpers/fixtures.js';

const ON = { extra: { feature: id => id === 'story-block.gear' || id === 'story-block.rpg' } };
const OFF = { extra: { feature: () => false } };
const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const tail = host => host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).at(-1)?.value ?? '';
const defsOf = host => host.head().domains.inventory.defs;
const defNamed = (host, name) => Object.values(defsOf(host)).find(item => item.name === name);

// A rules module of the kind part 2 will be: it wears the piece in a slot from a story line (`~ hit weapon tear`).
const FIGHT = {
    id: 'zz-fight', name: 'zz fight', version: '0.0.0',
    capture: {
        kinds: { hit: { grammar: '~ hit <slot> <steps>' } },
        apply(ctx, change) {
            const [slot, steps] = change.name.split(' ');
            return ctx.call('gear.wear', { owner: 'party', slot, steps: Number(steps ?? 1) });
        },
    },
};

async function fresh(t, { gear = true, modules = [FIGHT] } = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules, settings: gear ? { features: { 'story-block.gear': true, 'story-block.rpg': true } } : {} });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

const wear = (host, name) => host.sdk.query('inventory.items').find(item => item.name === name);
const equip = async (host, name) => {
    const out = await host.sdk.command('inventory.equip', { stack: wear(host, name).stack });
    assert.equal(out.ok, true, out.message);
};

test('the stat budget is by rarity (0, 1, 2, 3, 4); a pack item may set its own 0…6; the story never does', () => {
    assert.deepEqual(['common', 'uncommon', 'rare', 'epic', 'legendary'].map(rarity => gearBudget({ id: 'story/x', rarity })), [0, 1, 2, 3, 4]);
    assert.equal(gearBudget({ id: 'pack.p/sword', rarity: 'common', bonus: 6 }), 6, 'a pack item\'s own bonus');
    assert.equal(gearBudget({ id: 'pack.p/sword', rarity: 'rare', bonus: 0 }), 0, 'even 0');
    assert.equal(gearBudget({ id: 'pack.p/sword', rarity: 'rare', bonus: 7 }), 2, 'out of range: the rarity\'s');
    assert.equal(gearBudget({ id: 'story/sword', rarity: 'rare', bonus: 6 }), 2, 'a story def\'s bonus is not read');
    assert.deepEqual(GEAR.budget, { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 });
    // The validator holds a def's bonus to 0…6.
    const module = core();
    const state = stocked(module);
    state.domains.inventory.defs['pack.fantasy/iron-sword'].bonus = 6;
    assert.deepEqual(validateInventory(state.domains.inventory), []);
    state.domains.inventory.defs['pack.fantasy/iron-sword'].bonus = 7;
    assert.match(validateInventory(state.domains.inventory).join(' '), /gear bonus of 7; it is a whole number from 0 to 6/);
    state.domains.inventory.defs['pack.fantasy/iron-sword'].bonus = 1.5;
    assert.equal(validateInventory(state.domains.inventory).length, 1);
});

test('a pack item\'s bonus is validated (0…6) and comes through as its def\'s; the story-made copy of a pack item loses it', () => {
    const ok = validatePack(pack({ content: { items: [{ name: 'Sunblade', kind: 'equipment', slot: 'weapon', rarity: 'rare', bonus: 5 }] } }));
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.equal(ok.pack.content.items[0].bonus, 5);
    assert.equal(itemDef({ ...ok.pack.content.items[0], id: 'pack.x/sunblade' }).bonus, 5);
    for (const bonus of [7, -1, 1.5, '2']) {
        const bad = validatePack(pack({ content: { items: [{ name: 'Sunblade', kind: 'equipment', slot: 'weapon', bonus }] } }));
        assert.equal(bad.ok, false, `bonus ${bonus}`);
        assert.ok(bad.errors.some(error => /bonus must be a whole number from 0 to 6/.test(error.message)));
    }
    assert.equal(validatePack(pack({ content: { items: [{ name: 'Sunblade', kind: 'equipment', slot: 'weapon' }] } })).ok, true, 'optional');
});

test('the slot comes from the line\'s kind word, else the name; the rarity from rarity: or quality: words', () => {
    const slot = (kind, name) => gearSlotOf(kind, name);
    for (const [name, want] of [['Iron Sword', 'weapon'], ['Hand Axe', 'weapon'], ['Short Bow', 'weapon'], ['Dagger', 'weapon'], ['Boar Spear', 'weapon'], ['Oak Staff', 'weapon'],
        ['Chain Mail', 'body'], ['Leather Jerkin', 'body'], ['Plate', 'body'], ['Bronze Cuirass', 'body'], ['Grey Robe', 'body'],
        ['Oak Shield', 'off-hand'], ['Buckler', 'off-hand'], ['Iron Helmet', 'head'], ['Wool Cap', 'head'], ['Rain Hood', 'head'], ['Green Cloak', 'cloak'], ['Short Cape', 'cloak'],
        ['Old Mantle', 'cloak'], ['Walking Boots', 'feet'], ['Sandals', 'feet'], ['Jade Ring', 'accessory'], ['Silver Amulet', 'accessory'], ['Pendant', 'accessory'], ['Leather Belt', 'accessory'], ['Travel Pack', null], ['Leather Satchel', null], ['Sack Bag', null], ['Two Swords', 'weapon'], ['Steel Blade', 'weapon'], ['War Hammer', 'weapon'], ['Oak Wand', 'weapon']]) {
        assert.equal(slot(null, name), want, name);
    }
    assert.equal(slot(null, 'Rope'), null);
    assert.equal(slot(null, 'Swordfish stew'), null, 'whole words only');
    assert.equal(slot('weapon', 'Rope'), 'weapon', 'the kind word wins');
    assert.equal(slot('Armor', 'Iron Sword'), 'body', 'US spelling, and over the name');
    assert.equal(slot('off-hand', 'Rope'), 'off-hand');
    assert.equal(slot('accessory-2', 'Rope'), 'accessory-2');
    assert.equal(slotWordOf('Shield'), 'off-hand');
    assert.equal(slot('potion', 'Iron Sword'), 'weapon', 'a kind that is no slot is passed over');
    const rarity = word => gearRarityOf(word);
    assert.deepEqual(['crude', 'common', 'fine', 'sturdy', 'rare', 'masterwork', 'epic', 'heroic', 'legendary', 'fabled'].map(rarity),
        ['common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic', 'epic', 'legendary', 'legendary']);
    assert.equal(rarity('a fine blade'), 'uncommon');
    assert.equal(rarity('shiny'), null);
    assert.equal(rarity('+3'), null);
});

test('a story + item line gets its slot and rarity from words only; numbers are ignored; legendary is held to epic', () => {
    const h = createHarness([core()]);
    const add = (name, labels, opts = ON) => {
        const out = h.capture(line('+', 'item', name, labels), opts);
        assert.equal(out.ok, true, out.message);
        return Object.values(h.state.domains.inventory.defs).find(item => item.name === name);
    };
    const sword = add('Iron Sword', { rarity: 'rare', atk: '9', bonus: '6', carry: '99', value: '500' });
    assert.deepEqual([sword.slot, sword.kind, sword.rarity, sword.stack, sword.bonus, sword.carry, sword.atk], ['weapon', 'equipment', 'rare', false, undefined, undefined, undefined]);
    assert.equal(gearBudget(sword), 2);
    assert.deepEqual(sword.stats, { DEX: 2 }, 'a sword raises DEX by its whole budget');
    const shield = add('Oak Shield', { quality: 'fine' });
    assert.deepEqual([shield.slot, shield.rarity], ['off-hand', 'uncommon']);
    const mail = add('Chain Mail', { rarity: 'legendary' });
    assert.deepEqual([mail.slot, mail.rarity], ['body', 'epic'], 'held to epic: the story alone does not make a legend');
    const kind = add('Heirloom', { kind: 'armor', rarity: 'crude' });
    assert.deepEqual([kind.slot, kind.rarity], ['body', 'common']);
    const plain = add('Rope', { rarity: 'rare' });
    assert.deepEqual([plain.slot, plain.kind, plain.rarity], [null, 'goods', 'rare'], 'a rarity without a slot is still a rarity');
    const bag = add('Travel Pack', {});
    assert.deepEqual([bag.slot, bag.kind, bag.carry], [null, 'goods', undefined], 'a bag is no slot, and the story never gives it a capacity');
    assert.deepEqual(h.query('inventory.definitions', { ids: [sword.id] })[0].rarity, 'rare');
    // A module's own grant keeps the rarity it gives (a quest reward may be legendary).
    const granted = h.run('inventory.grant', { def: { name: 'Sun Crown', rarity: 'legendary' }, qty: 1 }, { caller: 'zz-quest', cause: 'story', ...ON });
    assert.equal(granted.ok, true, granted.message);
    assert.equal(Object.values(h.state.domains.inventory.defs).find(item => item.name === 'Sun Crown').rarity, 'legendary');
});

test('with the feature off a story item is exactly as before: no slot, goods, the default rarity', () => {
    const h = createHarness([core()]);
    for (const opts of [OFF, {}]) {
        const name = `Iron Sword ${opts === OFF ? 1 : 2}`;
        assert.equal(h.capture(line('+', 'item', name, { rarity: 'epic', kind: 'weapon' }), opts).ok, true);
        const made = Object.values(h.state.domains.inventory.defs).find(item => item.name === name);
        assert.deepEqual([made.slot, made.kind, made.rarity, made.stack, Object.hasOwn(made, 'bonus')], [null, 'goods', 'common', true, false], name);
    }
    assert.equal(h.run('gear.wear', { owner: 'party', slot: 'weapon', step: 'tear' }, { cause: 'system', ...OFF }).code, 'REFUSED');
});

test('inventory.gear: the worn pieces with their stats and condition; a broken piece gives nothing; wear goes down the condition words', async t => {
    const host = await fresh(t);
    await host.send('Loot.', reply('Gear.', ['+ item Iron Sword | rarity: rare', '+ item Oak Shield | quality: fine', '+ item Chain Mail | rarity: epic', '+ item Rope']));
    const empty = Object.fromEntries(['weapon', 'body', 'off-hand', 'head', 'cloak', 'feet', 'accessory-1', 'accessory-2'].map(place => [place, null]));
    const zero = { STR: 0, VIT: 0, AGI: 0, DEX: 0, INT: 0, LUK: 0, CHA: 0 };
    assert.deepEqual(host.sdk.query('inventory.gear', { owner: 'party' }), { on: true, owner: 'party', slots: empty, statBonus: zero, carry: { load: 4, capacity: 30, encumbered: false, penalty: 0, sources: [{ name: 'The reader', carry: 30 }] } });
    for (const name of ['Iron Sword', 'Oak Shield', 'Chain Mail']) await equip(host, name);
    const gear = () => host.sdk.query('inventory.gear', { owner: 'party' });
    const slot = place => gear().slots[place];
    assert.deepEqual([slot('weapon'), slot('off-hand'), slot('body')], [
        { name: 'Iron Sword', stats: { DEX: 2 }, cond: 100, broken: false }, { name: 'Oak Shield', stats: { VIT: 1 }, cond: 100, broken: false }, { name: 'Chain Mail', stats: { VIT: 3 }, cond: 100, broken: false }]);
    assert.deepEqual(gear().statBonus, { ...zero, DEX: 2, VIT: 4 }, 'summed over what is worn');
    assert.deepEqual(host.sdk.query('inventory.statBonus', { owner: 'party' }), gear().statBonus);
    await host.send('Fight.', reply('A hard blow.', ['~ hit weapon 1']));
    assert.deepEqual(slot('weapon'), { name: 'Iron Sword', stats: { DEX: 2 }, cond: 69, broken: false }, 'worn still gives its stats');
    assert.equal(host.sdk.receipts().at(-1).receipt.summary, 'Iron Sword wears (100 → 69).');
    assert.equal(host.sdk.receipts().at(-1).receipt.data.steps, 1);
    const stackId = wear(host, 'Iron Sword').stack;
    assert.equal(host.sdk.query('inventory.condition', { stack: stackId }).cond, 69, 'the same condition events inventory.wear writes');
    await host.send('More.', reply('Again.', ['~ hit weapon 1']));
    assert.equal(slot('weapon').cond, 39, 'worn → torn');
    await host.send('Last.', reply('It snaps.', ['~ hit weapon 1']));
    assert.deepEqual(slot('weapon'), { name: 'Iron Sword', stats: {}, cond: 0, broken: true }, 'broken: no stats');
    assert.deepEqual(gear().statBonus, { ...zero, VIT: 4 });
    assert.equal(host.sdk.receipts().at(-1).receipt.summary, 'Iron Sword breaks.');
    await host.send('Again.', reply('Splinters.', ['~ hit weapon 1']));
    assert.equal(host.sdk.receipts().at(-1).receipt.summary, 'Iron Sword is already broken.');
    assert.deepEqual([slot('off-hand').stats, slot('body').stats], [{ VIT: 1 }, { VIT: 3 }], 'the other pieces are as they were');
    // Two steps at once; the defence slot is the body armour, else the off-hand.
    await host.send('Smash.', reply('Crack.', ['~ hit defence 2']));
    assert.deepEqual([slot('body').cond, slot('off-hand').cond], [39, 100], 'good → worn → torn');
    await host.sdk.command('inventory.unequip', { stack: wear(host, 'Chain Mail').stack });
    await host.send('Bash.', reply('Dent.', ['~ hit defence 1']));
    assert.equal(slot('off-hand').cond, 69, 'no body armour: the off-hand');
    // A wrong steps or slot is refused (the line fails, nothing moves).
    for (const bad of ['~ hit weapon 9', '~ hit helm 1']) {
        const before = JSON.stringify(gear());
        await host.send('Bad.', reply('No.', [bad]));
        assert.equal(JSON.stringify(gear()), before, bad);
        assert.ok(host.turn.problems().length > 0, bad);
    }
    // Not from a button or a story line of its own.
    assert.equal((await host.sdk.command('gear.wear', { owner: 'party', slot: 'off-hand', steps: 1 })).ok, false);
    assert.equal(slot('off-hand').cond, 69);
    assert.deepEqual([100, 69, 39, 0].map(cond => stepDown(cond)), [69, 39, 0, 0]);
});

test('gear.wear is the system\'s or a module\'s call, only while the feature is on, and only for a piece worn in the slot', () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.defs['pack.fantasy/iron-sword'].slot = 'weapon';
    state.domains.inventory.stacks.it_sword001.equipped = 'weapon';
    const h = createHarness([module], { state });
    const ask = { owner: 'party', slot: 'weapon', steps: 1 };
    for (const cause of ['ui', 'story']) assert.equal(h.run('gear.wear', ask, { cause, ...ON }).code, 'REFUSED', cause);
    assert.equal(h.run('gear.wear', ask, { cause: 'system', ...OFF }).code, 'REFUSED', 'feature off');
    assert.equal(h.run('gear.wear', ask, { cause: 'system', extra: { feature: id => id === 'story-block.gear' } }).code, 'REFUSED', 'the RPG off');
    assert.equal(h.run('gear.wear', { ...ask, slot: 'off-hand' }, { cause: 'system', ...ON }).code, 'NOT_FOUND');
    assert.equal(h.run('gear.wear', { ...ask, slot: 'ring' }, { cause: 'system', ...ON }).code, 'INVALID');
    assert.equal(h.run('gear.wear', { ...ask, steps: 0 }, { cause: 'system', ...ON }).code, 'INVALID');
    const out = h.run('gear.wear', ask, { cause: 'system', ...ON });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(out.result.data, { owner: 'party', slot: 'weapon', stack: 'it_sword001', def: 'pack.fantasy/iron-sword', steps: 1, amount: 31, before: 100, now: 69, broken: false });
    assert.equal(h.run('gear.wear', { ...ask, steps: 2 }, { caller: 'zz-fight', cause: 'story', ...ON }).ok, true, 'a module\'s call');
    assert.equal(h.query('inventory.condition', { stack: 'it_sword001' }).cond, 0);
    assert.equal(h.run('gear.wear', { ...ask, slot: 'armour' }, { cause: 'system', ...ON }).code, 'NOT_FOUND', 'armour is the body slot');
});

test('carry: 10 + 2 × STR, bags add their pack capacity; over it the party is encumbered (only with the feature on)', async t => {
    assert.equal(capacityFor(10), 30);
    assert.equal(capacityFor(1), 12);
    assert.equal(capacityFor(20), 50);
    assert.equal(capacityFor(99), 50, 'STR is held to 1…20');
    assert.equal(capacityFor(null), 30, 'a missing STR counts as the default 10');
    const host = await fresh(t);
    await host.send('Stones.', reply('Heavy.', ['+ item Stone | qty: 30']));
    assert.deepEqual(host.sdk.query('inventory.encumbrance'), { on: true, encumbered: false, party: false, who: [], load: 30, capacity: 30, penalty: 0, stats: ['AGI', 'DEX'] });
    await host.send('One more.', reply('Too much.', ['+ item Brick | qty: 2']));
    const last = host.sdk.receipts().at(-1).receipt;
    assert.match(last.summary, /^The party gains Brick ×2\. The party now carries more than it can and is encumbered/);
    assert.equal(last.data.encumbered, true);
    assert.deepEqual(host.sdk.query('inventory.encumbrance'), { on: true, encumbered: true, party: true, who: [], load: 32, capacity: 30, penalty: -2, stats: ['AGI', 'DEX'] });
    assert.deepEqual(host.sdk.query('inventory.gear', { owner: 'party' }).carry, { load: 32, capacity: 30, encumbered: true, penalty: -2, sources: [{ name: 'The reader', carry: 30 }] });
    await host.send('On.', reply('The road.', ['+ coin 1']));
    assert.match(tail(host), /^Encumbered \(carrying more than they can\): the party \(32\/30\); AGI and DEX checks -2 until something is put down\.$/m);
    // The reader's own take past the limit is refused, as with any carry module.
    await host.send('Look.', reply('A crate.', ['? loot Feather']));
    const sid = host.store.carrierSid(host.store.headIndex());
    const refused = await host.sdk.command('inventory.lootTake', { sid, pick: [0] });
    assert.deepEqual([refused.ok, refused.code], [false, 'REFUSED']);
    assert.match(refused.message, /party cannot carry that: 32 of 30 carried/);
    await host.send('Drop.', reply('Lighter.', ['- item Brick | qty: 2']));
    assert.equal(host.sdk.query('inventory.encumbrance').encumbered, false);
});

test('carry: a bag adds its carry while owned; a person has their own; coins weigh nothing; a carry module that answers items.carry is the one asked', () => {
    const module = createCoreModule({ hooks: () => [], settings: () => ({}), extras: { gearOn: () => true } });
    const state = stocked(module);
    const inv = state.domains.inventory;
    inv.defs['pack.fantasy/satchel'] = def('pack.fantasy/satchel', 'Deep Satchel', { kind: 'goods', carry: 20 });
    inv.stacks.it_bag00001 = stack('it_bag00001', 'pack.fantasy/satchel', 1);
    inv.defs['story/ducats'] = def('story/ducats', 'Ducats', { kind: 'money' });
    inv.stacks.it_ren00001 = stack('it_ren00001', 'story/rope', 4, { owner: 'ac_ren00001' });
    const h = createHarness([module], { state });
    const carry = () => h.query('gear.carry', {});
    // The party: 10 + 2 × 10 for the one reader, the worn bag counts only while worn.
    assert.equal(carry().capacity, 30 + 30 + 20, 'the reader\'s 30, Ren\'s 30, the bag\'s 20: a bag adds its carry while owned');
    assert.deepEqual(carry().bonuses, [{ stack: 'it_bag00001', carry: 20 }], 'the Inventory shows the bag\'s +20 as before');
    assert.equal(carry().capacity, 80);
    assert.deepEqual(carry().people, [{ id: 'ac_ren00001', name: 'ac_ren00001', load: 4, capacity: 30 }]);
    assert.equal(carry().load, 3 + 1 + 1 + 2 + 1 + 1 + 1 + 4, 'rope 3, sword, dagger, potions 2 + 1, lantern, bag, Ren\'s rope 4');
    // Fits: the party up to its capacity, a person up to their own.
    const fits = (owner, qty) => h.query('gear.carry', { owner, add: [{ defId: 'story/rope', qty }] });
    const room = carry().capacity - carry().load;
    assert.deepEqual([fits('party', room).ok, fits('party', room + 1).ok], [true, false]);
    assert.match(fits('party', room + 1).message, /^The party cannot carry that: \d+ of 80 carried\.$/);
    assert.deepEqual([fits('ac_ren00001', 26).ok, fits('ac_ren00001', 27).ok], [true, false]);
    assert.match(fits('ac_ren00001', 27).message, /^ac_ren00001 cannot carry that: 4 of 30 carried\.$/);
    assert.equal(h.query('gear.carry', { owner: 'party', move: true, add: [{ defId: 'story/rope', qty: 500 }] }).ok, true, 'a hand-over inside the party keeps the load');
    // A money def adds no weight; the feature off: nothing answers.
    assert.equal(h.query('gear.carry', { owner: 'party', add: [{ defId: 'story/ducats', qty: 5000 }] }).ok, true);
    const off = createHarness([createCoreModule({ hooks: () => [], settings: () => ({}) })], { state });
    assert.equal(off.query('gear.carry', {}), null);
    assert.equal(off.query('inventory.gear', { owner: 'party' }), null);
});

test('off by default: the same replies give the same receipts, defs and prompt tails as a host that never heard of gear', async t => {
    const lines = ['+ item Iron Sword | rarity: rare', '+ item Stone | qty: 45', '+ coin 12'];
    const a = await fresh(t, { gear: false, modules: [] });
    const b = await createHost({ modules: [], settings: { features: { 'story-block.gear': false } } });
    t.after(() => b.close());
    await b.send('Hello.', 'The road.');
    for (const host of [a, b]) await host.send('Loot.', reply('Gear.', lines));
    assert.deepEqual(a.sdk.receipts().map(entry => entry.receipt.summary), b.sdk.receipts().map(entry => entry.receipt.summary));
    const shape = host => { const inv = host.head().domains.inventory; return [inv.defs, Object.values(inv.stacks).map(item => [item.def, item.qty, item.equipped]), inv.wallets]; };
    assert.deepEqual(shape(a), shape(b));
    const sword = defNamed(a, 'Iron Sword');
    assert.deepEqual([sword.slot, sword.kind, sword.rarity], [null, 'goods', 'common']);
    assert.equal(a.sdk.query('inventory.encumbrance').encumbered, false);
    assert.equal(a.sdk.query('inventory.gear', { owner: 'party' }), null, 'off: the gear query answers nothing');
    assert.doesNotMatch(a.sdk.receipts().map(entry => entry.receipt.summary).join('\n'), /encumbered/);
    await a.send('On.', reply('Road.', ['+ coin 1']));
    assert.doesNotMatch(tail(a), /Encumbered/);
    assert.equal((await a.sdk.command('gear.wear', { owner: 'party', slot: 'weapon', step: 'tear' })).ok, false);
});

test('replay equals live after a swipe, a Re-read, a delete, a rebuild and a reload', async t => {
    const host = await fresh(t);
    await host.send('Loot.', reply('Gear.', ['+ item Iron Sword | rarity: rare', '+ item Stone | qty: 10']));
    await equip(host, 'Iron Sword');
    await host.send('Fight.', reply('A blow.', ['~ hit weapon 1']));
    await host.send('Haul.', reply('A load.', ['+ item Brick | qty: 25']));
    const stable = inv => ({ ...inv, stacks: Object.fromEntries(Object.entries(inv.stacks).map(([id, item]) => [id, { ...item, from: undefined }])) });
    const view = () => JSON.stringify([stable(host.head().domains.inventory), host.sdk.query('inventory.gear', { owner: 'party' }), host.sdk.query('inventory.encumbrance')]);
    const live = view();
    assert.equal(host.sdk.query('inventory.encumbrance').encumbered, true);
    host.store.rebuild();
    assert.equal(view(), live, 'a rebuild equals live');
    const loaded = await createHost({ modules: [FIGHT], st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.equal(JSON.stringify([stable(loaded.head().domains.inventory), loaded.sdk.query('inventory.gear', { owner: 'party' })]), JSON.stringify([stable(host.head().domains.inventory), host.sdk.query('inventory.gear', { owner: 'party' })]), 'a reload equals live');
    // A Re-read of the head reply as it stands changes nothing.
    const at = host.ctx.chat.length - 1;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(view(), live, 'a Re-read equals live');
    // A swipe takes the heavy load away (and with it the encumbrance); the wear of the earlier reply stays.
    await host.swipe(reply('Nothing after all.', ['+ coin 1']));
    assert.equal(host.sdk.query('inventory.encumbrance').encumbered, false);
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.cond, 69);
    // Deleting the fight's reply takes its wear back; a rebuild agrees.
    await host.st.deleteMessage(host.ctx.chat.findIndex(message => /A blow/.test(message.mes)));
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.cond, 100);
    assert.deepEqual(host.store.problems(), []);
    const after = view();
    host.store.rebuild();
    assert.equal(view(), after, 'a rebuild equals live after the delete');
});

test('a def renamed from a pack item loses the pack\'s bonus; the story-made copy takes the rarity\'s', () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.defs['pack.fantasy/dagger'].bonus = 5;
    state.domains.inventory.defs['pack.fantasy/dagger'].rarity = 'rare';
    const h = createHarness([module], { state });
    assert.equal(gearBudget(state.domains.inventory.defs['pack.fantasy/dagger']), 5);
    assert.equal(h.run('inventory.edit', { stack: 'it_dagg0001', name: 'Rusty Knife' }).ok, true);
    const copy = Object.values(h.state.domains.inventory.defs).find(item => item.name === 'Rusty Knife');
    assert.deepEqual([copy.id.startsWith('story/'), copy.bonus, gearBudget(copy)], [true, undefined, 2]);
    assert.deepEqual(statsFor(state.domains.inventory.defs['pack.fantasy/dagger']), { DEX: 5 }, 'a pack item\'s budget of 5 on the dagger\'s stat');
});

test('the shared bag has the RPG characters\' capacities added up (10 + 2 × STR each)', () => {
    const sheet = (who, str) => ({ hash: `h-${who}`, definition: { role: 'character', name: who, scope: 'chat', state: {} }, fields: { who, str } });
    const blocks = [sheet('Mira', 14), sheet('Tolk', 3)];
    const state = { domains: {
        inventory: { defs: {}, stacks: {}, wallets: {}, aliases: {} },
        dataModules: {
            active: Object.fromEntries(blocks.map(block => [block.fields.who, { hash: block.hash }])),
            pins: Object.fromEntries(blocks.map(block => [block.hash, { definition: block.definition }])),
            instances: Object.fromEntries(blocks.map(block => [block.fields.who, { chat: { fields: block.fields } }])),
        },
    } };
    const picture = carryPicture(state, { carryOf: () => null });
    assert.equal(picture.capacity, (10 + 2 * 14) + (10 + 2 * 3), 'Mira 38 + Tolk 16');
    assert.equal(carryPicture({ domains: { inventory: state.domains.inventory } }, { carryOf: () => null }).capacity, 30, 'no sheet: one reader of STR 10');
});

const gearCore = () => createCoreModule({ hooks: () => [], settings: () => ({}), extras: { gearOn: () => true } });

test('condition words: Good is unmarked, Worn, Torn and Broken show after the name in the Equipped line and the Carried list (gear on only)', async t => {
    assert.deepEqual([100, 70, 69, 40, 39, 1, 0].map(condWord), ['good', 'good', 'worn', 'worn', 'torn', 'torn', 'broken']);
    assert.deepEqual([100, 50, 10, 0].map(condMark), ['', 'worn', 'torn', 'broken']);
    const host = await fresh(t);
    await host.send('Loot.', reply('Gear.', ['+ item Cane Sword | rarity: fine', '+ item Oak Buckler', '+ item Spare Axe']));
    await equip(host, 'Cane Sword');
    await equip(host, 'Oak Buckler');
    await host.send('Go.', reply('On.', ['+ coin 1']));
    assert.match(tail(host), /^Equipped: Cane Sword \[weapon\], Oak Buckler \[off-hand\]$/m, 'Good: unmarked');
    await host.send('Hit.', reply('Blow.', ['~ hit weapon 1']));
    await host.send('Go.', reply('On.', ['+ coin 1']));
    assert.match(tail(host), /^Equipped: Cane Sword \(worn\) \[weapon\], Oak Buckler \[off-hand\]$/m);
    await host.send('Hit.', reply('Blow.', ['~ hit weapon 1', '~ hit off-hand 2']));
    await host.send('Go.', reply('On.', ['+ coin 1']));
    assert.match(tail(host), /^Equipped: Cane Sword \(torn\) \[weapon\], Oak Buckler \(torn\) \[off-hand\]$/m);
    await host.send('Hit.', reply('Blow.', ['~ hit weapon 1']));
    await host.send('Go.', reply('On.', ['+ coin 1']));
    assert.match(tail(host), /Cane Sword \(broken\) \[weapon\]/);
    // A carried piece shows it too (the pieces in the pack are worn out of the way first).
    await host.sdk.command('inventory.unequip', { stack: wear(host, 'Cane Sword').stack });
    await host.send('Go.', reply('On.', ['+ coin 1']));
    assert.match(tail(host), /^Carried: Cane Sword \(broken\), Spare Axe$/m);
    // Off: the same wear leaves the words out and the lines as they were.
    const off = await fresh(t, { gear: false, modules: [] });
    await off.send('Loot.', reply('Gear.', ['+ item Cane Sword']));
    await off.sdk.command('inventory.equip', { stack: wear(off, 'Cane Sword').stack, slot: 'weapon' });
    await off.sdk.command('inventory.wear', { stack: wear(off, 'Cane Sword').stack, amount: 100 }).catch(() => null);
    await off.send('Go.', reply('On.', ['+ coin 1']));
    assert.doesNotMatch(tail(off), /\((?:worn|torn|broken)\)/);
});

test('value by condition: Good 100%, Worn 75%, Torn 50%, Broken 20% on the price inventory.items gives, with gear on only', () => {
    assert.deepEqual(CONDITION.good.factor, 1);
    assert.deepEqual([100, 60, 20, 0].map(cond => valueByCond(50, cond)), [50, 38, 25, 10]);
    const module = gearCore();
    const state = stocked(module);
    const h = createHarness([module], { state });
    const price = () => h.query('inventory.items', {}).find(item => item.stack === 'it_sword001');
    assert.deepEqual([price().value, price().baseValue], [50, 50]);
    h.run('inventory.wear', { stack: 'it_sword001', amount: 40 }, { caller: 'zz', cause: 'story' });
    assert.deepEqual([price().value, price().baseValue], [38, 50], 'Worn');
    h.run('inventory.wear', { stack: 'it_sword001', amount: 30 }, { caller: 'zz', cause: 'story' });
    assert.equal(price().value, 25, 'Torn');
    h.run('inventory.wear', { stack: 'it_sword001', amount: 30 }, { caller: 'zz', cause: 'story' });
    assert.equal(price().value, 10, 'Broken');
    assert.equal(h.query('inventory.find', { name: 'Iron Sword' }).stacks[0].value, 10, 'inventory.find reads the same');
    // Off: the def\'s own value, no extra field.
    const plain = createHarness([core()], { state: h.state });
    const row = plain.query('inventory.items', {}).find(item => item.stack === 'it_sword001');
    assert.deepEqual([row.value, Object.hasOwn(row, 'baseValue')], [50, false]);
});

test('mounts and carts add their carry while they travel with the party', () => {
    assert.deepEqual(['horse', 'Pony', 'mule', 'donkey', 'pack animal', 'cart', 'barrow', 'hand-cart', 'Hand Cart', 'wagon', 'boat', 'ox', ''].map(kindCarry), [20, 20, 40, 40, 40, 60, 60, 60, 60, 150, 100, 20, 20]);
    assert.deepEqual(KIND_CARRY, { horse: 20, pony: 20, mule: 40, donkey: 40, cart: 60, barrow: 60, wagon: 150, boat: 100 });
    assert.equal(travelsWith('', 'Stray Oar'), true);
    assert.equal(travelsWith('ridden by Wessel', 'Stray Oar'), true);
    assert.equal(travelsWith('at the Stray Oar', 'Stray Oar'), true);
    assert.equal(travelsWith('stabled at the Stray Oar', 'Mill Road'), false);
    const module = gearCore();
    const state = stocked(module);
    state.domains.scene.place = { name: 'Mill Road', kind: '', region: '' };
    const mount = (name, kind, extra = {}) => ({ name, kind, count: 1, pace: 30, condition: '', where: '', ...extra });
    state.domains.scene.mounts = {
        'm:grey': mount('Grey', 'horse'), 'm:burr': mount('Burr', 'mule', { count: 2 }), 'm:cart': mount('Old Cart', 'cart', { carry: 90 }),
        'm:left': mount('Skiff', 'boat', { where: 'moored at Eel Wharf' }),
    };
    const h = createHarness([module], { state });
    const gear = () => h.query('inventory.gear', { owner: 'party' }).carry;
    // The reader (30) + Grey 20 + Burr 2 × 40 + the cart's own 90; the boat was left elsewhere.
    assert.equal(h.query('gear.carry', {}).capacity, 30 + 30 + 20 + 80 + 90, 'Ren\'s 30 is a person of their own');
    assert.deepEqual(gear().sources, [{ name: 'The reader', carry: 30 }, { name: 'Grey', carry: 20 }, { name: 'Burr', carry: 80 }, { name: 'Old Cart', carry: 90 }]);
    assert.equal(gear().capacity, 30 + 20 + 80 + 90);
    state.domains.scene.mounts['m:left'].where = '';
    h.state = state;
    assert.equal(gear().capacity, 30 + 20 + 80 + 90 + 100, 'the boat joined the party');
    // Without the Mounts rows nothing is added.
    delete state.domains.scene.mounts;
    h.state = state;
    assert.equal(gear().capacity, 30);
    // Off: nothing answers.
    assert.equal(createHarness([core()], { state }).query('gear.carry', {}), null);
});

test('a mount row\'s own carry is the reader\'s pencil: 1…1000, empty clears it', async t => {
    const host = await fresh(t);
    await host.send('Saddle.', reply('Yard.', ['+ mount Grey | kind: horse']));
    const row = () => host.sdk.query('mounts.list')[0];
    const edit = carry => host.sdk.command('mounts.edit', { mount: 'Grey', carry });
    assert.equal(row().carry, undefined);
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).carry.capacity, 50, 'the reader 30 + a horse 20');
    assert.equal((await edit('45')).ok, true);
    assert.equal(row().carry, 45);
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).carry.capacity, 75);
    assert.equal((await edit('1001')).ok, false);
    assert.equal((await edit('x')).ok, false);
    assert.equal((await edit('')).ok, true);
    assert.equal(row().carry, undefined, 'cleared: the kind\'s usual again');
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).carry.capacity, 50);
    host.store.rebuild();
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).carry.capacity, 50);
});

test('a cart, barrow, wagon or sledge the story names (a rented hand-cart) adds its kind\'s carry while owned, with gear on only', () => {
    assert.deepEqual(['Hand Cart', 'Rented hand-cart', 'Ox Wagon', 'Wheelbarrow', 'Sledge', 'Cartographer\'s Map', 'Rope'].map(itemCarryOf), [60, 60, 150, 60, 60, null, null]);
    const h = createHarness([gearCore()]);
    assert.equal(h.capture(line('+', 'item', 'Rented Hand Cart', {}), ON).ok, true);
    const cart = Object.values(h.state.domains.inventory.defs).find(item => item.name === 'Rented Hand Cart');
    assert.equal(cart.carry, 60);
    assert.deepEqual(validateInventory(h.state.domains.inventory), []);
    assert.equal(h.query('gear.carry', {}).capacity, 30 + 60);
    assert.deepEqual(h.query('gear.carry', {}).bonuses.map(entry => entry.carry), [60]);
    assert.equal(h.query('inventory.items', {})[0].carry, 60, 'the Inventory shows its +60');
    assert.equal(h.capture(line('+', 'item', 'Ox Wagon', {}), ON).ok, true);
    assert.equal(h.query('gear.carry', {}).capacity, 30 + 60 + 150);
    const off = createHarness([core()]);
    assert.equal(off.capture(line('+', 'item', 'Rented Hand Cart', {}), OFF).ok, true);
    assert.equal(Object.values(off.state.domains.inventory.defs)[0].carry, undefined, 'off: the story never gives a capacity');
});

test('the gear switch lives in Settings → RPG, off the Features list, and counts only while the RPG is on', async t => {
    const ctx = await page(t, { feature: true });
    const host = ctx.host;
    assert.equal(host.sdk.feature('story-block.gear'), false);
    assert.equal(host.sdk.features().some(feature => feature.id === 'story-block.gear'), true, 'still a feature');
    const win = ctx.ui.openSettings();
    win.select('features');
    await settle();
    assert.equal(ctx.doc.querySelector('[data-feature="story-block.gear"]'), null, 'not in the Features list');
    win.select('rpg');
    await settle();
    const card = ctx.doc.querySelector('[data-ss-section="rpg"] [data-card="gear"]');
    assert.equal(card.querySelector('.rpg-set-title').textContent, 'Gear in fights');
    assert.equal(card.querySelector('[aria-pressed="true"]').textContent, 'Off');
    card.querySelector('.rpg-chip[data-value="on"]').click();
    await settle();
    assert.equal(host.sdk.feature('story-block.gear'), true);
    assert.equal(ctx.doc.querySelector('[data-ss-section="rpg"] [data-card="gear"] [aria-pressed="true"]').textContent, 'On');
    // With the RPG off the gear answers nothing, whatever is stored.
    host.features.set('story-block.rpg', false);
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }), null);
});

test('with the RPG off gear is inert even if its switch is on', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { features: { 'story-block.gear': true } } });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Loot.', reply('Gear.', ['+ item Iron Sword | rarity: rare', '+ item Stone | qty: 60']));
    assert.equal(defNamed(host, 'Iron Sword').slot, null);
    assert.equal(host.sdk.query('inventory.encumbrance').encumbered, false);
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }), null);
});

test('the narrator\'s equipped: word puts a new item on, rarity: and slot: words take effect, one item per slot per owner', async t => {
    const host = await fresh(t);
    await host.send('Loot.', reply('Gear.', ['+ item Iron Sword | rarity: rare | equipped: weapon', '+ item Hunting Knife | slot: weapon | equipped: weapon', '+ item Wool Cap | equipped: head', '+ item Jade Ring | equipped: accessory', '+ item Onyx Ring | equipped: accessory', '+ item Amber Ring | equipped: accessory', '+ item Rope | equipped: yes', '+ item Oak Shield | equipped: sword']));
    const rows = host.sdk.query('inventory.items');
    const on = name => rows.find(item => item.name === name);
    assert.deepEqual([on('Iron Sword').equipped, on('Iron Sword').rarity], [null, 'rare'], 'put away by the knife: one item per slot');
    assert.deepEqual([on('Hunting Knife').equipped, on('Hunting Knife').equippedBy, on('Hunting Knife').slot], ['weapon', 'party', 'weapon']);
    assert.equal(on('Wool Cap').equipped, 'head');
    assert.deepEqual([on('Jade Ring').equipped, on('Onyx Ring').equipped, on('Amber Ring').equipped], [null, 'accessory-2', 'accessory-1'], 'two accessory places; the third took the first');
    assert.equal(on('Rope').equipped, null, 'goods are not worn');
    assert.equal(on('Oak Shield').equipped, null, 'a word that is no slot, or does not fit, is passed over');
    assert.equal(Object.hasOwn(on('Rope'), 'equippedBy'), false, 'only what is worn');
    // Head, cloak, feet and accessories are shown and give no bonus yet.
    const gear = host.sdk.query('inventory.gear', { owner: 'party' });
    assert.deepEqual(gear.slots.weapon, { name: 'Hunting Knife', stats: {}, cond: 100, broken: false }, 'a common piece gives nothing');
    assert.deepEqual(gear.slots.head, { name: 'Wool Cap', stats: {}, cond: 100, broken: false });
    assert.equal(gear.slots['accessory-1'].name, 'Amber Ring');
    assert.equal(gear.slots['accessory-2'].name, 'Onyx Ring');
    assert.equal(gear.slots.cloak, null);
    // The reader's command: item.equip { stack, owner, slot }.
    const sword = on('Iron Sword').stack;
    assert.equal((await host.sdk.command('item.equip', { stack: sword, owner: 'party', slot: 'weapon' })).ok, true);
    assert.equal(host.sdk.query('inventory.items').find(item => item.name === 'Hunting Knife').equipped, null, 'the knife is put away');
    assert.deepEqual(host.sdk.query('inventory.gear', { owner: 'party' }).statBonus.DEX, 2);
    const refuse = async payload => (await host.sdk.command('item.equip', payload)).ok;
    assert.equal(await refuse({ stack: sword, slot: 'head' }), false, 'a sword does not fit the head');
    assert.equal(await refuse({ stack: sword, owner: 'ac_other001', slot: 'weapon' }), false, 'not that owner\'s');
    assert.equal(await refuse({ stack: sword, slot: 'nowhere' }), false);
    assert.equal((await host.sdk.command('item.equip', { stack: on('Jade Ring').stack, slot: 'accessory-2' })).ok, true);
    assert.equal(host.sdk.query('inventory.items').find(item => item.name === 'Onyx Ring').equipped, null);
    // Replay: a rebuild keeps all of it.
    const live = JSON.stringify(host.sdk.query('inventory.items').map(({ stack, ...row }) => row));
    host.store.rebuild();
    assert.equal(JSON.stringify(host.sdk.query('inventory.items').map(({ stack, ...row }) => row)), live);
});

test('off: equipped:, slot: and rarity: words change nothing and the rows have no equippedBy; item.equip is refused', async t => {
    const host = await fresh(t, { gear: false, modules: [] });
    await host.send('Loot.', reply('Gear.', ['+ item Iron Sword | rarity: rare | equipped: weapon']));
    const row = host.sdk.query('inventory.items')[0];
    assert.deepEqual([row.rarity, row.equipped, Object.hasOwn(row, 'equippedBy')], ['common', null, false]);
    assert.equal((await host.sdk.command('item.equip', { stack: row.stack, slot: 'weapon' })).ok, false);
});

test('stats: the narrator\'s named stats are held to the budget; with none named the kind or name picks; every slot gives them; a pack lists its own', async () => {
    assert.deepEqual(statsOf({ dex: 2, STR: '3', cha: -1, luk: 1.5, foo: 4 }), { DEX: 2 });
    assert.deepEqual(withinBudget({ STR: 2, DEX: 2, CHA: 1 }, 3), { STR: 2, DEX: 1 }, 'in the order of the seven stats, cut at the budget');
    assert.deepEqual(withinBudget({ STR: 1, VIT: 1, AGI: 1 }, 4), { STR: 1, VIT: 1 }, 'and at most two different stats');
    assert.deepEqual(withinBudget({ STR: 2 }, 0), {});
    const pick = (name, slot) => defaultStat(name, slot);
    assert.deepEqual(['Steel Blade', 'Iron Sword', 'Hunting Bow', 'Dagger', 'Hand Axe', 'War Hammer', 'Heavy Club', 'Boar Spear', 'Oak Staff', 'Wand', 'Old Tome', 'Chain Mail', 'Oak Shield', 'Iron Helm', 'Walking Boots', 'Green Cloak', 'Jade Ring', 'Silver Amulet', 'Pendant'].map(name => pick(name, null)),
        ['DEX', 'DEX', 'DEX', 'DEX', 'STR', 'STR', 'STR', 'STR', 'INT', 'INT', 'INT', 'VIT', 'VIT', 'VIT', 'AGI', 'AGI', 'LUK', 'LUK', 'LUK']);
    assert.deepEqual(['weapon', 'body', 'off-hand', 'head', 'cloak', 'feet', 'accessory'].map(slot => pick('Thing', slot)), ['STR', 'VIT', 'VIT', 'VIT', 'AGI', 'AGI', 'LUK'], 'the slot\'s default');
    const h = createHarness([core()]);
    const add = (name, labels) => { assert.equal(h.capture(line('+', 'item', name, labels), ON).ok, true); return Object.values(h.state.domains.inventory.defs).find(item => item.name === name); };
    assert.deepEqual(add('Cane Sword', { rarity: 'rare', dex: '+2' }).stats, { DEX: 2 });
    assert.deepEqual(add('Hexed Hammer', { rarity: 'rare', str: '2', int: '2' }).stats, { STR: 2 }, 'held to a budget of 2');
    assert.deepEqual(add('Split Axe', { rarity: 'epic', str: '1', agi: '1', cha: '9' }).stats, { STR: 1, AGI: 1 }, 'at most two stats');
    assert.deepEqual(add('Plain Dirk', { dex: '3' }).stats, {}, 'a common piece has no budget');
    assert.deepEqual(add('Iron Helm', { rarity: 'uncommon' }).stats, { VIT: 1 });
    assert.deepEqual(add('Silk Cloak', { rarity: 'fine' }).stats, { AGI: 1 });
    assert.deepEqual(add('Jade Ring', { rarity: 'rare' }).stats, { LUK: 2 });
    assert.deepEqual(add('Plain Belt', { rarity: 'rare' }).stats, { LUK: 2 }, 'a belt is an accessory: the slot\'s own');
    assert.equal(add('Rope', { rarity: 'rare', dex: '2' }).stats && Object.keys(add('Rope', {}).stats).length, 0, 'no slot, no stats');
    // A pack lists its own stats, held to the rarity's budget unless the pack sets a budget of its own.
    const rare = { id: 'pack.p/blade', name: 'Sun Blade', kind: 'equipment', slot: 'weapon', rarity: 'rare' };
    assert.deepEqual(statsFor({ ...rare, stats: { DEX: 2 } }), { DEX: 2 });
    assert.deepEqual(statsFor({ ...rare, stats: { DEX: 5 } }), { DEX: 2 }, 'held to the rarity budget');
    assert.deepEqual(statsFor({ ...rare, stats: { DEX: 5 }, bonus: 5 }), { DEX: 5 }, 'unless the pack sets its own budget');
    assert.deepEqual(statsFor({ ...rare }), { DEX: 2 }, 'none listed: the name\'s pick');
    assert.deepEqual(statsFor({ ...rare, rarity: 'common' }), {});
    assert.equal(GEAR.effectiveMax, 30);
});

test('every slot gives its stats through inventory.gear, and a broken piece takes its stats away', async t => {
    const host = await fresh(t);
    await host.send('Loot.', reply('Gear.', ['+ item Oak Staff | rarity: rare | equipped: weapon', '+ item Iron Helm | rarity: uncommon | equipped: head', '+ item Silk Cloak | rarity: uncommon | equipped: cloak', '+ item Walking Boots | rarity: uncommon | equipped: feet', '+ item Jade Ring | rarity: epic | equipped: accessory', '+ item Travel Pack']));
    const bonus = () => host.sdk.query('inventory.statBonus', { owner: 'party' });
    assert.deepEqual(bonus(), { STR: 0, VIT: 1, AGI: 2, DEX: 0, INT: 2, LUK: 3, CHA: 0 });
    await host.send('Smash.', reply('Crash.', ['~ hit weapon 3']));
    assert.equal(bonus().INT, 0, 'broken: no stats');
    assert.equal(host.sdk.query('inventory.items').find(item => item.name === 'Travel Pack').equipped, null, 'a bag is worn nowhere');
});

test('repair in the story: mend is one condition word up, restore is back to Good; a broken piece gets its stats back; the prompt words follow', async t => {
    assert.deepEqual([0, 39, 69, 100].map(cond => stepUp(cond)), [39, 69, 100, 100]);
    assert.equal(stepUp(0, true), 100);
    const host = await fresh(t);
    await host.send('Loot.', reply('Gear.', ['+ item Cane Sword | rarity: rare | equipped: weapon']));
    const gear = () => host.sdk.query('inventory.gear', { owner: 'party' });
    const sword = () => wear(host, 'Cane Sword').stack;
    const condNow = () => host.sdk.query('inventory.condition', { stack: sword() }).cond;
    const next = async text => { await host.send('Go.', reply('On.', [text])); await host.send('Go.', reply('On.', ['+ coin 1'])); };
    await host.send('Hit.', reply('Blows.', ['~ hit weapon 3']));
    assert.deepEqual([condNow(), gear().statBonus.DEX], [0, 0], 'broken: no stats');
    await next('~ item Cane Sword — the smith reground it | repair: mend');
    assert.equal(host.sdk.receipts().at(-2).receipt.summary, 'Cane Sword is mended (0 → 39/100).');
    assert.deepEqual([condNow(), gear().statBonus.DEX], [39, 2], 'torn: its stats are back');
    assert.match(tail(host), /^Equipped: Cane Sword \(torn\) \[weapon\]$/m);
    await next('~ item Cane Sword | repair: patched');
    assert.match(tail(host), /^Equipped: Cane Sword \(worn\) \[weapon\]$/m);
    await next('~ item Cane Sword | repair: mended');
    assert.equal(condNow(), 100);
    assert.match(tail(host), /^Equipped: Cane Sword \[weapon\]$/m, 'Good: unmarked again');
    await host.send('Hit.', reply('Blows.', ['~ hit weapon 3']));
    await next('~ item Cane Sword — reforged | repair: restore');
    assert.deepEqual([condNow(), gear().slots.weapon.broken], [100, false], 'restore goes straight back to Good');
    // Twice in one reply: the second is refused (once per piece per reply); a word that means nothing is refused.
    await host.send('Hit.', reply('Blows.', ['~ hit weapon 2']));
    await host.send('Smith.', reply('Work.', ['~ item Cane Sword | repair: mend', '~ item Cane Sword | repair: mend']));
    assert.equal(condNow(), 69, 'one step, once');
    await host.send('Smith.', reply('Work.', ['~ item Cane Sword | repair: shiny']));
    assert.equal(condNow(), 69);
    // Replay: a swipe takes the repair back with its reply; a rebuild and a reload agree.
    const view = () => JSON.stringify([condNow(), gear().statBonus]);
    await host.send('Smith.', reply('Work.', ['~ item Cane Sword | repair: restore']));
    assert.equal(condNow(), 100);
    const live = view();
    host.store.rebuild();
    assert.equal(view(), live, 'a rebuild equals live');
    const loaded = await createHost({ modules: [FIGHT], st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.equal(JSON.stringify(loaded.sdk.query('inventory.gear', { owner: 'party' }).statBonus), JSON.stringify(gear().statBonus));
    await host.swipe(reply('No smith after all.', ['+ coin 1']));
    assert.equal(condNow(), 69, 'the swipe took the repair back');
});

test('off: the repair word does nothing (as before) and the wear word still works', async t => {
    const host = await fresh(t, { gear: false, modules: [] });
    await host.send('Loot.', reply('Gear.', ['+ item Cane Sword']));
    await host.send('Rust.', reply('Rust.', ['~ item Cane Sword — rusted | wear: ruin']));
    const stack = wear(host, 'Cane Sword').stack;
    const before = host.sdk.query('inventory.condition', { stack }).cond;
    await host.send('Smith.', reply('Work.', ['~ item Cane Sword — mended | repair: restore']));
    assert.equal(host.sdk.query('inventory.condition', { stack }).cond, before);
});

test('any stat on any item: a blade with AGI and DEX, held to the budget and two stats; a default only when none is named', () => {
    const h = createHarness([gearCore()]);
    const add = (name, labels) => { assert.equal(h.capture(line('+', 'item', name, labels, 'forged by a master in Auvoth'), ON).ok, true); return Object.values(h.state.domains.inventory.defs).find(item => item.name === name); };
    assert.deepEqual(add('Shadowsteel Blade', { rarity: 'rare', agi: '+1', dex: '+1' }).stats, { AGI: 1, DEX: 1 }, 'a blade with AGI is fine');
    assert.deepEqual(add('Heavy Blade', { rarity: 'rare', str: '+5' }).stats, { STR: 2 }, 'held to the budget of 2');
    assert.deepEqual(add('Odd Blade', { rarity: 'legendary', str: '1', agi: '1', dex: '1', int: '1' }).stats, { STR: 1, AGI: 1 }, 'epic here (3), two stats');
    assert.deepEqual(add('Bare Blade', { rarity: 'rare' }).stats, { DEX: 2 }, 'none named: the default, the whole budget');
    assert.deepEqual(add('Wool Hood', { rarity: 'uncommon', cha: '1' }).stats, { CHA: 1 }, 'any item');
});

test('rarity limits: legendary only when the same reply earned it, else epic with one Problems line', () => {
    const problems = [];
    const earned = { id: 'zz-earned', name: 'earned', version: '0.0.0', queries: { 'story.legendaryEarned': () => true } };
    const make = (modules, placeName) => {
        const module = createCoreModule({ hooks: () => [], settings: () => ({}), problem: entry => problems.push(entry), extras: { gearOn: () => true } });
        const state = stocked(module);
        if (placeName) state.domains.scene.place = { name: placeName, kind: '', region: '' };
        return createHarness([module, ...modules], { state });
    };
    const rarityOf = (h, name) => Object.values(h.state.domains.inventory.defs).find(item => item.name === name).rarity;
    const give = (h, name, rarity) => assert.equal(h.capture(line('+', 'item', name, { rarity }), ON).ok, true);
    // Without anything that earned it: epic, and one line says so.
    const plain = make([], null);
    give(plain, 'Sun Blade', 'legendary');
    give(plain, 'Moon Blade', 'epic');
    assert.deepEqual([rarityOf(plain, 'Sun Blade'), rarityOf(plain, 'Moon Blade')], ['epic', 'epic']);
    assert.equal(problems.length, 1, 'one Problems line, for the held one only');
    assert.match(problems[0].message, /Sun Blade was written legendary; the story's items reach epic here \(legendary needs a quest completed or a hard fight won in the same reply\)\./);
    // Earned: legendary stays.
    const won = make([earned], null);
    give(won, 'Sun Blade', 'legendary');
    assert.equal(rarityOf(won, 'Sun Blade'), 'legendary');
    assert.equal(problems.length, 1);
    // The pack's place is validated.
    const place = loot => ({ name: 'Mill Road', x: 1, y: 2, ...(loot === undefined ? {} : { loot }) });
    const check = loot => validatePack(pack({ content: { places: [place(loot)] } }));
    assert.equal(check({ maxRarity: 'rare' }).ok, true, JSON.stringify(check({ maxRarity: 'rare' }).errors));
    assert.deepEqual(check({ maxRarity: 'rare' }).pack.content.places[0].loot, { maxRarity: 'rare' });
    assert.equal(check(undefined).ok, true);
    for (const bad of [{ maxRarity: 'mythic' }, {}, { maxRarity: 'rare', extra: 1 }, 'rare']) assert.equal(check(bad).ok, false, JSON.stringify(bad));
});

test('a place\'s loot.maxRarity lowers the ceiling for the area, by name or alias; other places have none', async t => {
    const places = [
        { name: 'Mill Road', aliases: ['the road'], x: 1, y: 2, loot: { maxRarity: 'uncommon' } },
        { name: 'Vault', x: 3, y: 4 },
    ];
    const raw = pack({ content: { places } });
    const built = validatePack(raw);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { features: { 'story-block.gear': true, 'story-block.rpg': true }, packs: [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }] } });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['~ place Mill Road']));
    const rarity = name => defNamed(host, name).rarity;
    await host.send('Loot.', reply('Gear.', ['+ item Sun Blade | rarity: epic', '+ item Plain Sword | rarity: common']));
    assert.deepEqual([rarity('Sun Blade'), rarity('Plain Sword')], ['uncommon', 'common'], 'the area\'s ceiling');
    assert.match(host.turn.problems().map(problem => problem.message).join(' '), /Sun Blade was written epic; the story's items reach uncommon here/);
    await host.send('Go.', reply('The vault.', ['~ place Vault']));
    await host.send('Loot.', reply('Gear.', ['+ item Moon Blade | rarity: epic']));
    assert.equal(rarity('Moon Blade'), 'epic', 'no loot field: no extra limit');
    await host.send('Back.', reply('Home.', ['~ place the road']));
    await host.send('Loot.', reply('Gear.', ['+ item Star Blade | rarity: rare']));
    assert.equal(rarity('Star Blade'), 'uncommon', 'found by alias');
});

// GR-P2a: the narrator's item words (kind, rarity, stats, equipped, wear, repair) in the static grammar, gear on only.
const staticOf = host => host.st.promptLog.filter(entry => entry.key === 'story_suite_static' && entry.value).at(-1)?.value ?? '';
const ITEM_LINE = '+ item Name | qty: 1 | note: short detail (- item Name | qty: 1 when used up or lost; ~ item Name | note: … when it changes)';

test('gear on: the item grammar names the gear words (one short line) and stays byte-identical reply to reply', async t => {
    const host = await fresh(t);
    const first = staticOf(host);
    const line = first.split('\n').find(text => text.startsWith('+ item Name'));
    assert.ok(line, 'the item grammar line');
    const added = line.slice(ITEM_LINE.length);
    assert.ok(added.length <= 300, `the gear words take ${added.length} characters`);
    for (const word of ['kind: weapon|armour|shield|head|cloak|feet|accessory|bag', 'rarity: common|uncommon|rare|epic|legendary', 'DEX: +1', 'at most 2', 'equipped: slot', 'wear: scuff|tear|ruin', 'repair: mend|restore']) assert.ok(added.includes(word), word);
    await host.send('Loot.', reply('Gear.', ['+ item Iron Sword | rarity: rare | equipped: weapon']));
    await host.send('Again.', reply('More.', ['+ item Rope']));
    assert.equal(staticOf(host), first, 'the same bytes after two more replies');
});

test('gear off (or the RPG off): the item grammar line is the old one, and the static bytes carry no gear word', async t => {
    for (const settings of [{}, { features: { 'story-block.gear': true } }]) {
        t.mock.method(console, 'warn', () => {});
        const host = await createHost({ modules: [], settings });
        t.after(() => host.close());
        await host.send('Hello.', 'The road.');
        const text = staticOf(host);
        assert.ok(text.split('\n').includes(ITEM_LINE), 'the old line, byte for byte');
        assert.doesNotMatch(text, /rarity:|equipped: slot|repair: mend|accessory\|bag/);
        const before = text;
        await host.send('Loot.', reply('Gear.', ['+ item Rope']));
        assert.equal(staticOf(host), before);
    }
});

test('a reply written with the grammar\'s words applies slot, rarity, stats, equipped, wear and repair', async t => {
    const host = await fresh(t);
    await host.send('Loot.', reply('Gear.', ['+ item Plain Thing | kind: weapon | rarity: rare | DEX: +1 | AGI: +1 | equipped: weapon', '+ item Fur Mantle | kind: cloak | rarity: uncommon | AGI: +1 | equipped: cloak']));
    const blade = defNamed(host, 'Plain Thing');
    assert.deepEqual([blade.slot, blade.rarity], ['weapon', 'rare']);
    const gear = host.sdk.query('inventory.gear', { owner: 'party' });
    assert.deepEqual([gear.slots.weapon.name, gear.slots.cloak.name], ['Plain Thing', 'Fur Mantle']);
    assert.deepEqual(gear.statBonus, { STR: 0, VIT: 0, AGI: 2, DEX: 1, INT: 0, LUK: 0, CHA: 0 });
    await host.send('Fight.', reply('Torn.', ['~ item Plain Thing — struck | wear: ruin']));
    await host.send('Fight.', reply('Torn.', ['~ item Plain Thing — struck again | wear: ruin']));
    await host.send('Fight.', reply('Torn.', ['~ item Plain Thing — struck again | wear: ruin']));
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.broken, true, 'three ruins break it');
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).statBonus.DEX, 0, 'broken gives nothing');
    await host.send('Smith.', reply('Mended.', ['~ item Plain Thing — reforged | repair: restore']));
    const after = host.sdk.query('inventory.gear', { owner: 'party' });
    assert.equal(after.slots.weapon.broken, false);
    assert.equal(after.statBonus.DEX, 1, 'the stats are back');
});
