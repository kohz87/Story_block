// The Ersveil pack's value scale (PACKS.md "Value guide", ERSVEIL.md §8): one mark is the old copper,
// everyday goods and gear keep the lore's prices, and the consumables a fight uses are on the play scale,
// a fraction of an F-rank job. Also its crafting data (recipes, crafts) and its meter presets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { craftsOf } from '../../../src/v2/packs/content.js';

const text = readFileSync(new URL('../../../examples/packs/ersveil-bluewatch/pack.json', import.meta.url), 'utf8');

function checked() {
    const result = validatePack(text);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
}

const pack = checked();
const items = new Map(pack.content.items.map(item => [item.id, item]));
const byName = name => pack.content.items.find(item => item.name === name);
const F = pack.content.ranks.find(rank => rank.id === 'F');

// The lore's prices ("Prices: …" and "Mana Stones and Monster Cores" entries of the World lorebook), in
// marks (1 copper = 1 mark, 1 silver = 10, 1 gold = 100), for every item the lore prices.
const LORE = {
    'Knife': [40, 100], 'Coarse Bread': [1, 2], 'Hot Meal': [5, 10], 'Common Ale': [2, 4], 'Trail Rations': [8, 16],
    'Torch': [1, 3], 'Lamp Oil': [2, 5], 'Flint and Steel': [4, 10], 'Hemp Rope': [20, 60], 'Waterskin': [10, 30],
    'Bedroll': [30, 60], 'Wool Blanket': [40, 100], 'Backpack': [60, 140], 'Completion Salts': [10, 20], 'Bandage': [2, 5],
    'Cleansing Spirits': [5, 15], 'Spear': [100, 240], 'Hatchet': [200, 500], 'Iron-bound Buckler': [200, 500],
    'Gambeson': [400, 1000], 'Iron Cap': [400, 4000], 'Fur-lined Cloak': [60, 160], 'Patched Oilcloth Coat': [40, 160],
    'Wolf-pelt Mantle': [60, 800], 'Crag Wolf Pelt': [10, 100], 'Small Monster Core': [10, 100], 'River Drake Scale': [100, 500],
};
// Priced on the play scale instead: the lore asks 1–60 gold for these, five to forty F jobs for one.
const PLAY_SCALE = ['Healing Salve', 'Common Antidote', 'Minor Healing Draught', 'Mana Draught'];
// No lore price: the pack's own numbers (ERSVEIL.md §9).
const OWN = ['Cane-Blade', 'Whetstone', 'Leech-salt Pouch', 'Burlap Sack', 'Coarse Salt', 'Crag Wolf Fang', 'Rat Tail', 'Live Leech', 'Bluecap Moss', 'Iron Filings'];

test('a minor healing draught is a fraction of an F-rank job', () => {
    const draught = byName('Minor Healing Draught');
    assert.deepEqual(F.reward, [50, 400]);
    assert.ok(draught.value <= F.reward[0], `${draught.value} marks: no more than the poorest F job (${F.reward[0]})`);
    assert.ok(draught.value * 4 <= F.reward[1], `${draught.value} marks: a quarter of the best F job at most`);
    const price = pack.content.shops.flatMap(shop => shop.stock).find(line => line.item === draught.id).price;
    assert.ok(price <= F.reward[0], `Bluewatch asks ${price}: the poorest F job still pays for one`);
    for (const quest of pack.content.quests) {
        const reward = Number(/^(\d+) marks$/.exec(quest.reward)[1]);
        assert.ok(reward >= F.reward[0] && reward <= F.reward[1], `${quest.name} pays inside the F range`);
        assert.ok(reward / draught.value >= 1.5, `${quest.name} buys more than one draught`);
    }
});

test('every item is on one scale: the lore\'s prices, the play scale, or the pack\'s own', () => {
    for (const item of pack.content.items) {
        const where = [item.name in LORE, PLAY_SCALE.includes(item.name), OWN.includes(item.name)].filter(Boolean).length;
        assert.equal(where, 1, `${item.name} is listed once (add a new item to one of the lists)`);
        if (item.name in LORE) {
            const [low, high] = LORE[item.name];
            assert.ok(item.value >= low && item.value <= high, `${item.name}: ${item.value} marks, the lore says ${low}–${high}`);
        }
        assert.ok(item.value <= 1000, `${item.name}: nothing in a starter pack is worth more than a few F jobs`);
    }
    // The play scale keeps the lore's order (salve 1–3 gold, antidote 6–20, minor potion 10–30, mana potion 20–60).
    const values = PLAY_SCALE.map(name => byName(name).value);
    assert.deepEqual([...values].sort((a, b) => a - b), values);
    for (const name of PLAY_SCALE) assert.ok(byName(name).value <= F.reward[0], `${name} is a fraction of an F job`);
    for (const item of pack.content.items.filter(entry => entry.kind === 'consumable')) assert.ok(item.value <= F.reward[0], `${item.name}: a consumable costs no more than the poorest F job`);
});

test('event payouts are tips, not jobs', () => {
    const paid = pack.content.events.flatMap(event => event.then).filter(step => step.command === 'wallet.receive');
    assert.ok(paid.length > 0);
    for (const step of paid) assert.ok(step.payload.amount <= F.reward[0], `${step.payload.amount} marks`);
});

test('shops ask the value or the frontier markup on it, never less and never more than three times', () => {
    for (const shop of pack.content.shops) {
        for (const line of shop.stock) {
            if (line.price === undefined) continue;
            const value = items.get(line.item).value;
            assert.ok(line.price >= value && line.price <= value * 3, `${shop.name}: ${items.get(line.item).name} at ${line.price} (value ${value})`);
        }
    }
});

test('crafting makes things worth at most twice what goes in', () => {
    for (const recipe of pack.content.recipes) {
        const cost = recipe.materials.reduce((sum, line) => sum + items.get(line.item).value * line.qty, 0) + (recipe.fee ?? 0);
        const made = items.get(recipe.makes).value * recipe.qty;
        assert.ok(made <= cost * 2, `${recipe.name}: makes ${made} from ${cost}`);
    }
});

test('the recipes carry their craft data, basics known from the start, the rest taught', () => {
    const table = new Map(craftsOf([pack]).map(craft => [craft.craft, craft]));
    assert.deepEqual(table.get('alchemy'), { craft: 'alchemy', title: 'Alchemy', stats: ['INT', 'DEX'], stations: ['alchemy-table'], note: pack.content.crafts[0].note, pack: 'ersveil-bluewatch' }, 'Ersveil alchemy is a craft of the hands too');
    assert.equal(table.get('fieldcraft').stations.length, 0, 'fieldcraft is done anywhere');
    const known = pack.content.recipes.filter(recipe => recipe.known === true);
    assert.deepEqual(known.map(recipe => recipe.name), ['Leech-salt Pouch', 'Pitch Torches', 'Camp Stew', 'Healing Salve']);
    for (const recipe of pack.content.recipes) {
        const craft = table.get(recipe.craft);
        assert.ok(craft, `${recipe.name} names a craft`);
        assert.ok(Number.isInteger(recipe.dc), `${recipe.name} has a dc`);
        if (craft.stations.length) assert.ok(craft.stations.includes(recipe.station), `${recipe.name} is made where ${craft.title.toLowerCase()} is worked`);
        if (recipe.known) assert.equal(recipe.teaches, undefined, `${recipe.name} is known, so nobody teaches it`);
        else assert.ok(recipe.teaches, `${recipe.name} is learned from someone`);
        if (recipe.known) assert.ok(recipe.dc <= 10, `${recipe.name}: a basic recipe is an easy check`);
    }
});

test('the meter presets start inside a band and every stage can be reached', () => {
    assert.deepEqual(pack.content.meterPresets.map(entry => entry.title), ['Frontier Regard', 'Road Companion']);
    for (const entry of pack.content.meterPresets) {
        for (const meter of entry.meters) {
            assert.ok(meter.bands[0].at <= meter.start, `${entry.title}: ${meter.name} starts with a word`);
            if (meter.drift) assert.ok(meter.drift.toward >= meter.min && meter.drift.toward <= meter.max);
        }
        // NPC State Delta's rule: `at` 0 or more is met at or above it, a negative `at` at or below it.
        const met = (need, value) => (need.at >= 0 ? value >= need.at : value <= need.at);
        const start = need => entry.meters.find(meter => meter.id === need.meter).start;
        for (const stage of entry.stages) {
            assert.ok(!stage.needs.every(need => met(need, start(need))), `${entry.title}: ${stage.name} is not reached at the start`);
            assert.ok(stage.needs.every(need => { const meter = entry.meters.find(other => other.id === need.meter); return met(need, need.at >= 0 ? meter.max : meter.min); }), `${entry.title}: ${stage.name} can be reached`);
        }
    }
});
