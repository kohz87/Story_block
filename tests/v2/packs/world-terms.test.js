// The reader's world words and a world's numbers (live test, 2026-10-22): the rank ladder the reader
// types in Story Block's settings (Terms: Rank ladder), read wherever ranks are read (packs.content);
// the carry capacity a pack's item adds (`carry`), which the story's words never set; and a place's
// market (settlement types and environment tags in a pack, `market:` lines in a lorebook entry).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { itemDef } from '../../../src/v2/packs/content.js';
import { createPacksPart, marketsOf } from '../../../src/v2/packs/index.js';
import { firstPackRanks, rankLine, readerRanks } from '../../../src/v2/packs/ranks.js';
import { marketEntries, readMarketLine } from '../../../src/v2/packs/lorebook.js';
import { CONTENT_KINDS, OPTIONAL_KINDS, RANKS_LIMITS } from '../../../src/v2/packs/limits.js';
import { createCoreModule } from '../../../src/v2/domains/index.js';
import { linesToList, listToLines } from '../../../src/v2/host-ui.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack } from './helpers/fixtures.js';
import { createHarness, line } from '../domains/helpers/fake-ctx.js';
import { stocked } from '../domains/fixtures.js';

const SOUL = ['Soul Class I', 'Soul Class II', 'Soul Class III', 'Soul Class IV', 'Soul Class V', 'Soul Class VI', 'Soul Class VII', 'Soul Class VIII', 'Soul Class IX'];
const LETTERS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
const rows = list => list.map(rank => ({ rank }));
const PACK_LADDER = [
    { id: 'F', title: 'Registered', levels: [1, 10], reward: [50, 400], pack: 'guild' },
    { id: 'E', title: 'Journeyman', levels: [11, 20], reward: [800, 3000], pack: 'guild' },
];

function ok(value) {
    const result = validatePack(value);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
}

function refused(value, path) {
    const result = validatePack(value);
    assert.equal(result.ok, false, `${path} should be refused`);
    const hit = result.errors.find(error => error.path === path);
    assert.ok(hit, `no error at ${path}: ${JSON.stringify(result.errors)}`);
    assert.ok(hit.message.length > 20, 'a sentence the reader can act on');
}

// ---------- the rank ladder ----------

test('the reader\'s ladder: one rank a line, lowest first, short ids the story can write', () => {
    const soul = readerRanks(rows(SOUL));
    assert.deepEqual(soul.map(rank => rank.id), ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']);
    assert.deepEqual(soul.map(rank => rank.title), SOUL);
    assert.ok(soul.every(rank => rank.pack === null && rank.reader === true && !rank.levels && !rank.reward));
    assert.deepEqual(readerRanks(rows(LETTERS)).map(rank => [rank.id, rank.title]), LETTERS.map(id => [id, id]));
    // A last word two ranks share, or a long one, is not an id: the place is.
    assert.deepEqual(readerRanks(rows(['Iron Plate', 'Gold Plate', 'Grand Champion-of-Ages'])).map(rank => rank.id), ['R1', 'R2', 'R3']);
    assert.deepEqual(readerRanks([]), []);
    assert.deepEqual(readerRanks(null), []);
    assert.deepEqual(readerRanks(rows(['', '  '])), []);
});

test('a line may give the first level of its rank; the levels are kept only when every line rises', () => {
    assert.deepEqual(rankLine('Soul Class II: 11'), { title: 'Soul Class II', from: 11 });
    assert.deepEqual(rankLine('Rank | <b>F</b>'), { title: 'Rank b F /b', from: null }, 'what separates fields in a block is cleaned out');
    const banded = readerRanks(rows(['Soul Class I: 1', 'Soul Class II: 11', 'Soul Class III: 21']));
    assert.deepEqual(banded.map(rank => rank.levels), [[1, 10], [11, 20], [21, 999]]);
    assert.ok(readerRanks(rows(['A: 1', 'B: 20', 'C: 10'])).every(rank => !rank.levels), 'levels that fall are not kept');
    assert.ok(readerRanks(rows(['A: 1', 'B'])).every(rank => !rank.levels), 'levels for some lines only are not kept');
    assert.equal(readerRanks(rows(Array.from({ length: 20 }, (_, n) => `Circle ${n + 1}`))).length, RANKS_LIMITS.records);
    assert.equal(readerRanks(rows(['F', 'f', 'E'])).length, 2, 'a rank named twice is one rank');
    assert.ok(readerRanks(rows(['x'.repeat(60)]))[0].title.length <= RANKS_LIMITS.title);
});

test('renaming a pack\'s ladder keeps the pack\'s numbers at each place, so quests pay the same', () => {
    const renamed = readerRanks(rows(['Copper', 'Silver', 'Gold']), PACK_LADDER);
    assert.deepEqual(renamed, [
        { id: 'Copper', title: 'Copper', levels: [1, 10], reward: [50, 400], pack: null, reader: true },
        { id: 'Silver', title: 'Silver', levels: [11, 20], reward: [800, 3000], pack: null, reader: true },
        { id: 'Gold', title: 'Gold', pack: null, reader: true },
    ]);
    // The reader's own first levels win over the pack's; the rewards stay the pack's.
    assert.deepEqual(readerRanks(rows(['Copper: 1', 'Silver: 6']), PACK_LADDER).map(rank => [rank.levels, rank.reward]), [[[1, 5], [50, 400]], [[6, 999], [800, 3000]]]);
    assert.deepEqual(firstPackRanks([...PACK_LADDER, { id: 'X', pack: 'other' }]).map(rank => rank.id), ['F', 'E']);
});

test('the setting is a text list, one rank a line, under Terms; a colon in a line stays in it', () => {
    const module = createCoreModule({ settings: () => ({}) });
    const field = module.settings.schema.ranks;
    assert.equal(field.type, 'list');
    assert.equal(field.form, 'lines');
    assert.equal(field.group, 'Terms');
    assert.deepEqual(module.settings.defaults.ranks, []);
    const read = linesToList(field, 'Soul Class I\nSoul Class II: 11\n\nSSS');
    assert.equal(read.ok, true);
    assert.deepEqual(read.items, [{ rank: 'Soul Class I' }, { rank: 'Soul Class II: 11' }, { rank: 'SSS' }]);
    assert.equal(listToLines(field, read.items), 'Soul Class I\nSoul Class II: 11\nSSS');
});

async function coreWith(settings, packs = []) {
    const part = createPacksPart({ settings: fakeSettings() });
    for (const one of packs) assert.equal((await part.packs.install(one)).ok, true);
    return createCoreModule({ settings: () => settings, packs: part });
}

test('packs.content answers ranks with the reader\'s ladder, over the pack\'s; one pack\'s own stays its own', async () => {
    const guild = pack({ id: 'guild', content: { ranks: PACK_LADDER.map(({ pack: _pack, ...rank }) => rank) } });
    const set = await coreWith({ ranks: rows(SOUL) }, [guild]);
    const asked = set.queries['packs.content']({}, { kind: 'ranks' });
    assert.deepEqual(asked.map(rank => rank.title), SOUL);
    assert.deepEqual(asked[0].reward, [50, 400], 'the pack\'s numbers at the place');
    assert.deepEqual(set.queries['packs.content']({}, { kind: 'ranks', pack: 'guild' }).map(rank => rank.id), ['F', 'E']);
    assert.ok(set.queries['packs.content']({}, { kind: 'items' }).length === 0, 'other kinds are as they were');
    // Empty: the pack's ladder; no pack either: none (each module's built-in one).
    const empty = await coreWith({ ranks: [] }, [guild]);
    assert.deepEqual(empty.queries['packs.content']({}, { kind: 'ranks' }).map(rank => rank.id), ['F', 'E']);
    assert.deepEqual((await coreWith({})).queries['packs.content']({}, { kind: 'ranks' }), []);
    // Alone (no quest module, no pack): the reader's ladder carries no reward, so the coin budget is by level.
    const alone = await coreWith({ ranks: rows(LETTERS) });
    const h = createHarness([alone], { state: stocked(alone) });
    assert.equal(h.query('inventory.storyBudget').budget, 1000);
    // With the pack, the renamed ladder keeps its rewards: the budget is the pack's F top.
    const renamed = await coreWith({ ranks: rows(SOUL) }, [guild]);
    assert.equal(createHarness([renamed], { state: stocked(renamed) }).query('inventory.storyBudget').budget, 400);
});

// ---------- carry capacity ----------

test('an item may add carry capacity: a whole number from 1 to 1000, kept on its def', () => {
    const items = [{ name: 'Pack Mule', carry: 80 }, { name: 'Spatial Ring', kind: 'equipment', slot: 'accessory', carry: 100 }, { name: 'Rope' }];
    const checked = ok(pack({ content: { items } }));
    assert.deepEqual(checked.content.items.map(item => item.carry), [80, 100, undefined]);
    assert.equal(itemDef(checked.content.items[0]).carry, 80);
    assert.equal('carry' in itemDef(checked.content.items[2]), false);
    for (const carry of [0, -5, 1.5, 1001, '100', null]) refused(pack({ content: { items: [{ name: 'Cart', carry }] } }), 'content.items[0].carry');
});

function carrying(packItems) {
    const module = createCoreModule({
        hooks: name => (name === 'item.resolve' ? [written => packItems.find(item => item.name.toLowerCase() === String(written).toLowerCase()) ?? null]
            // A hook that tries to give everything carry: code keeps it off what the story made.
            : name === 'item.define' ? [() => ({ carry: 999 })] : []),
        settings: () => ({}),
    });
    return createHarness([module], { state: stocked(module) });
}

test('the story never sets carry capacity: a pack\'s item keeps its own, a story-made thing has none', () => {
    const mule = { id: 'pack.ersveil/pack-mule', name: 'Pack Mule', kind: 'goods', rarity: 'common', value: 800, stack: false, slot: null, stats: {}, effect: {}, tags: [], note: '', carry: 80 };
    const h = carrying([mule]);
    assert.equal(h.capture(line('+', 'item', 'Pack Mule')).ok, true);
    assert.equal(h.state.domains.inventory.defs['pack.ersveil/pack-mule'].carry, 80);
    const made = h.capture(line('+', 'item', 'Bag of Holding', { note: 'carry +500, holds a house' }));
    assert.equal(made.ok, true, made.message);
    assert.equal('carry' in h.state.domains.inventory.defs['story/bag-of-holding'], false);
    // A module's full def: a pack's keeps its carry, any other loses it.
    assert.equal(h.run('inventory.grant', { def: { id: 'pack.ersveil/cart', name: 'Cart', carry: 200 } }, { cause: 'system' }).ok, true);
    assert.equal(h.state.domains.inventory.defs['pack.ersveil/cart'].carry, 200);
    assert.equal(h.run('inventory.grant', { def: { name: 'Wagon', carry: 200 } }, { cause: 'system' }).ok, true);
    assert.equal('carry' in h.state.domains.inventory.defs['story/wagon'], false);
});

test('the inventory validator holds carry to a whole number from 1 to 1000; the Inventory rows show it', () => {
    const module = createCoreModule({ settings: () => ({}) });
    const state = stocked(module);
    const inv = state.domains.inventory;
    inv.defs['pack.fantasy/iron-sword'].carry = 0;
    assert.ok(module.domains.inventory.validate(inv).some(error => /carry capacity of 0/.test(error)));
    inv.defs['pack.fantasy/iron-sword'].carry = 30;
    assert.deepEqual(module.domains.inventory.validate(inv), []);
    const h = createHarness([module], { state });
    assert.equal(h.query('inventory.items').find(item => item.stack === 'it_sword001').carry, 30);
    assert.equal('carry' in h.query('inventory.items').find(item => item.stack === 'it_rope0001'), false);
    // A carry module's word wins (items.carry → bonuses by stack: the reader's own carry items too).
    const carry = { id: 'carry', queries: { 'items.carry': () => ({ on: true, bonuses: [{ stack: 'it_rope0001', carry: 15 }] }) } };
    const both = createHarness([module, carry], { state });
    const listed = both.query('inventory.items');
    assert.equal(listed.find(item => item.stack === 'it_rope0001').carry, 15);
    assert.equal('carry' in listed.find(item => item.stack === 'it_sword001'), false);
});

// ---------- markets ----------

test('markets is a content kind of settlement types and environment tags, every field checked', () => {
    assert.ok(CONTENT_KINDS.includes('markets') && OPTIONAL_KINDS.includes('markets'));
    assert.equal('markets' in ok(pack()).content, false);
    const markets = [
        { type: 'lock-town', buy: 1.05, sell: 0.95, stock: [4, 6], note: 'toll towns' },
        { tag: 'coastal', prices: { fish: 0.7, all: 1 } },
    ];
    assert.deepEqual(ok(pack({ content: { markets } })).content.markets, [
        { type: 'lock-town', buy: 1.05, sell: 0.95, stock: [4, 6], note: 'toll towns', pack: 'mini' },
        { tag: 'coastal', prices: { fish: 0.7, all: 1 }, pack: 'mini' },
    ]);
    const bad = record => pack({ content: { markets: [record] } });
    refused(bad({ type: 'Town' }), 'content.markets[0].type');
    refused(bad({ type: 'town', tag: 'coastal' }), 'content.markets[0].tag');
    refused(bad({}), 'content.markets[0].type');
    refused(bad({ type: 'town', buy: 5 }), 'content.markets[0].buy');
    refused(bad({ type: 'town', sell: 0.1 }), 'content.markets[0].sell');
    refused(bad({ type: 'town', stock: [6, 4] }), 'content.markets[0].stock');
    refused(bad({ type: 'town', prices: { fish: 0.8 } }), 'content.markets[0].prices');
    refused(bad({ tag: 'coastal', buy: 1 }), 'content.markets[0].buy');
    refused(bad({ tag: 'coastal', prices: { Fish: 0.8 } }), 'content.markets[0].prices');
    refused(bad({ tag: 'coastal', prices: { fish: 9 } }), 'content.markets[0].prices');
    refused(bad({ tag: 'coastal', price: {} }), 'content.markets[0].price');
    refused(pack({ content: { markets: [{ type: 'town' }, { type: 'town' }] } }), 'content.markets[1].type');
    // A place names its settlement type and environment tags.
    const place = { name: 'Saltcliff', x: 1, y: 2, market: 'town', tags: ['coastal', 'port'] };
    assert.deepEqual(ok(pack({ content: { places: [place] } })).content.places[0].tags, ['coastal', 'port']);
    refused(pack({ content: { places: [{ ...place, market: 'Big Town' }] } }), 'content.places[0].market');
    refused(pack({ content: { places: [{ ...place, tags: 'coastal' }] } }), 'content.places[0].tags');
});

test('a lorebook entry\'s market line: type; tags; buy and sell, read plainly, never from the story', () => {
    assert.deepEqual(readMarketLine('Saltcliff is a fishing town.\nmarket: town; coastal, port\nMore lore.'), { type: 'town', tags: ['coastal', 'port'] });
    assert.deepEqual(readMarketLine('Market: Village; River; buy 0.9, sell 0.85'), { type: 'village', tags: ['river'], buy: 0.9, sell: 0.85 });
    assert.deepEqual(readMarketLine('market: capital'), { type: 'capital', tags: [] });
    assert.deepEqual(readMarketLine('market: city; ; buy 9'), { type: 'city', tags: [] }, 'a factor out of range is left out');
    assert.equal(readMarketLine('market: ; coastal'), null);
    assert.equal(readMarketLine('The market is busy.'), null);
    const entries = [
        { book: 'World', uid: 3, title: 'Saltcliff', keys: ['Saltcliff', 'the Cliff'], content: 'market: town; coastal' },
        { book: 'World', uid: 4, title: '', keys: ['Dunmere'], content: 'market: hamlet; farmland' },
        { book: 'World', uid: 5, title: 'Saltcliff', keys: [], content: 'market: city' },
        { book: 'World', uid: 6, title: 'Ossa', keys: [], content: 'A peddler.' },
        { book: 'World', uid: 7, title: '[storysuite:pack]', keys: [], content: 'market: town' },
    ];
    assert.deepEqual(marketEntries(entries), [
        { place: 'Saltcliff', aliases: ['the Cliff'], type: 'town', tags: ['coastal'], origin: 'lorebook:World#3' },
        { place: 'Dunmere', aliases: [], type: 'hamlet', tags: ['farmland'], origin: 'lorebook:World#4' },
    ]);
});

test('packs.markets: the lorebook\'s places first, then the packs\' own; types and tags the first pack\'s', async () => {
    const lore = [{ book: 'World', uid: 1, title: 'Saltcliff', keys: [], content: 'market: city; coastal' }];
    const part = createPacksPart({ settings: fakeSettings(), readLorebook: async () => ({ character: 'Mara', entries: lore, problem: '' }) });
    const one = pack({ id: 'one', content: { markets: [{ type: 'town', buy: 1.1 }], places: [{ name: 'Saltcliff', x: 0, y: 0, market: 'town' }, { name: 'Dunmere', x: 1, y: 1, market: 'hamlet', tags: ['farmland'] }, { name: 'Moor', x: 2, y: 2 }] } });
    const two = pack({ id: 'two', content: { markets: [{ type: 'town', buy: 2 }, { tag: 'farmland', prices: { grain: 0.7 } }] } });
    for (const each of [one, two]) assert.equal((await part.packs.install(each)).ok, true);
    const before = part.part.queries['packs.markets']();
    assert.deepEqual(before.places.map(place => [place.place, place.type, place.from]), [['Saltcliff', 'town', 'pack'], ['Dunmere', 'hamlet', 'pack']]);
    assert.equal(await part.refreshLore(), 1);
    const after = part.part.queries['packs.markets']();
    assert.deepEqual(after.places.map(place => [place.place, place.type, place.from]), [['Saltcliff', 'city', 'lorebook'], ['Dunmere', 'hamlet', 'pack']]);
    assert.deepEqual(after.types, [{ type: 'town', buy: 1.1, pack: 'one' }]);
    assert.deepEqual(after.tags, [{ tag: 'farmland', prices: { grain: 0.7 }, pack: 'two' }]);
    // A lorebook that cannot be read leaves the packs' own.
    const broken = createPacksPart({ settings: fakeSettings(), readLorebook: async () => { throw new Error('offline'); } });
    assert.equal(await broken.refreshLore(), 0);
    assert.deepEqual(marketsOf([], []), { types: [], tags: [], places: [] });
});
