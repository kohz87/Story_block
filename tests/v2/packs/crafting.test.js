// Crafting data in packs (MODULES §F102): a recipe's optional craft fields (craft, dc, station, stat,
// known, teaches), the `crafts` content kind that changes the craft → stat mapping, and the
// `packs.crafts` query (the default table with the enabled packs' crafts laid over it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { contentOf, craftsOf } from '../../../src/v2/packs/content.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { CONTENT_KINDS, CRAFTS_LIMITS, DEFAULT_CRAFTS, OPTIONAL_KINDS, STATIONS } from '../../../src/v2/packs/limits.js';
import { countsLine } from '../../../src/v2/packs/panel.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack } from './helpers/fixtures.js';

const ITEMS = [{ name: 'Iron Ingot', kind: 'material', value: 10 }, { name: 'Iron Sword', kind: 'equipment', value: 40 }];
const recipe = (extra = {}) => ({ name: 'Iron Sword', makes: 'iron-sword', materials: [{ item: 'iron-ingot', qty: 2 }], ...extra });
const withRecipe = (extra, content = {}) => pack({ content: { items: ITEMS, recipes: [recipe(extra)], ...content } });
const withCrafts = (crafts, recipes = []) => pack({ content: { items: ITEMS, crafts, recipes } });

function ok(value) {
    const result = validatePack(value);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
}

// Through JSON, as a file gives it: a field set to undefined is a field left out.
function refused(value, code, path) {
    const result = validatePack(JSON.stringify(value));
    assert.equal(result.ok, false, `${path} should be refused`);
    const hit = result.errors.find(error => error.path === path);
    assert.ok(hit, `no error at ${path}: ${JSON.stringify(result.errors)}`);
    assert.equal(hit.code, code, hit.message);
    assert.ok(hit.message.length > 20, 'a sentence the reader can act on');
    return hit;
}

test('the default craft table: smithing STR+DEX, alchemy INT, leather DEX, cooking VIT, enchanting INT+LUK', () => {
    assert.deepEqual(DEFAULT_CRAFTS.map(craft => [craft.craft, craft.stats.join('+')]), [
        ['smithing', 'STR+DEX'], ['alchemy', 'INT'], ['leather', 'DEX'], ['cooking', 'VIT'], ['enchanting', 'INT+LUK'],
    ]);
    assert.deepEqual(STATIONS, ['forge', 'alchemy-table', 'campfire', 'inn', 'workbench']);
    for (const craft of DEFAULT_CRAFTS) for (const station of craft.stations) assert.ok(STATIONS.includes(station), `${craft.craft}: ${station}`);
    assert.ok(Object.isFrozen(DEFAULT_CRAFTS) && Object.isFrozen(DEFAULT_CRAFTS[0].stats), 'nobody changes the defaults by holding them');
    assert.deepEqual(craftsOf([]), DEFAULT_CRAFTS.map(craft => ({ ...craft, stats: [...craft.stats], stations: [...craft.stations], pack: null })));
});

test('a recipe keeps its craft fields as given, and a recipe without them normalizes as before', () => {
    const plain = ok(withRecipe({})).content.recipes[0];
    for (const field of ['craft', 'dc', 'station', 'stat', 'known', 'teaches']) assert.equal(field in plain, false, field);
    const full = ok(withRecipe({ craft: 'smithing', dc: 12, station: 'forge', stat: 'STR+DEX', known: false, teaches: '  Hollis   at the Gate Forge ', minutes: 240, crafter: 'anyone' })).content.recipes[0];
    assert.deepEqual(
        { craft: full.craft, dc: full.dc, station: full.station, stat: full.stat, known: full.known, teaches: full.teaches, minutes: full.minutes, crafter: full.crafter },
        { craft: 'smithing', dc: 12, station: 'forge', stat: 'STR+DEX', known: false, teaches: 'Hollis at the Gate Forge', minutes: 240, crafter: 'anyone' },
    );
    for (const craft of ['smithing', 'alchemy', 'leather', 'cooking', 'enchanting']) assert.equal(ok(withRecipe({ craft })).content.recipes[0].craft, craft);
    for (const station of [...STATIONS, 'salt-yard']) assert.equal(ok(withRecipe({ station })).content.recipes[0].station, station, 'any slug is a station');
    for (const stat of ['INT', 'STR+DEX', 'INT+LUK+CHA']) assert.equal(ok(withRecipe({ stat })).content.recipes[0].stat, stat);
    assert.equal(ok(withRecipe({ known: true })).content.recipes[0].known, true);
    for (const dc of [5, 40]) assert.equal(ok(withRecipe({ dc })).content.recipes[0].dc, dc, 'the ends of 5–40');
});

test('every bad craft field is refused with its own sentence', () => {
    const at = field => `content.recipes[0].${field}`;
    for (const craft of ['', 'Alchemy', 'black smithing', 7, null]) refused(withRecipe({ craft }), 'BAD_RECORD', at('craft'));
    refused(withRecipe({ craft: 'weaving' }), 'UNKNOWN_REF', at('craft'));
    for (const dc of [4, 41, 12.5, '12', null, -5]) refused(withRecipe({ dc }), 'BAD_RECORD', at('dc'));
    for (const station of ['', 'Forge', 'alchemy table', 3, ['forge']]) refused(withRecipe({ station }), 'BAD_RECORD', at('station'));
    for (const stat of ['', 'str', 'STR+', 'STR DEX', 'STR+DEX+INT+LUK', 'S', 7, ['STR']]) refused(withRecipe({ stat }), 'BAD_RECORD', at('stat'));
    refused(withRecipe({ stat: 'STR+STR' }), 'BAD_RECORD', at('stat'));
    for (const known of ['yes', 1, null]) refused(withRecipe({ known }), 'BAD_RECORD', at('known'));
    for (const teaches of ['', '   ', 7, 'x'.repeat(121)]) refused(withRecipe({ teaches }), 'BAD_RECORD', at('teaches'));
    // A refused recipe is not half kept: the pack is refused as a whole.
    assert.equal(validatePack(withRecipe({ dc: 99 })).pack, undefined);
});

test('crafts is a content kind added after the first format; a pack declares new crafts or changes a default', () => {
    assert.ok(CONTENT_KINDS.includes('crafts') && OPTIONAL_KINDS.includes('crafts'));
    assert.equal('crafts' in ok(pack()).content, false, 'an older pack normalizes as it always did');
    const made = ok(withCrafts([
        { id: 'alchemy', title: 'Alchemy', stats: ['INT', 'DEX'], stations: ['alchemy-table'], note: 'A craft, not spellcasting.' },
        { id: 'fieldcraft', title: '  Field   craft ', stats: ['DEX'] },
    ], [recipe({ craft: 'fieldcraft' }), { ...recipe({ craft: 'alchemy' }), name: 'Second' }]));
    assert.deepEqual(made.content.crafts, [
        { title: 'Alchemy', stats: ['INT', 'DEX'], stations: ['alchemy-table'], note: 'A craft, not spellcasting.', id: 'pack.mini/alchemy', slug: 'alchemy', pack: 'mini' },
        { title: 'Field craft', stats: ['DEX'], stations: [], id: 'pack.mini/fieldcraft', slug: 'fieldcraft', pack: 'mini' },
    ]);
    assert.equal(made.content.recipes[0].craft, 'fieldcraft', 'a recipe may name a craft its pack declares');
    refused(pack({ content: { items: ITEMS, recipes: [recipe({ craft: 'fieldcraft' })] } }), 'UNKNOWN_REF', 'content.recipes[0].craft');
    const twelve = Array.from({ length: CRAFTS_LIMITS.records }, (_, index) => ({ id: `craft-${index}`, title: `Craft ${index}`, stats: ['INT'] }));
    assert.equal(ok(withCrafts(twelve)).content.crafts.length, 12);
});

test('every bad craft is refused with its own sentence', () => {
    const one = craft => withCrafts([craft]);
    const good = { id: 'fieldcraft', title: 'Fieldcraft', stats: ['DEX'] };
    refused(withCrafts('alchemy'), 'BAD_CONTENT', 'content.crafts');
    refused(withCrafts(Array.from({ length: 13 }, (_, index) => ({ ...good, id: `c-${index}` }))), 'BAD_CONTENT', 'content.crafts');
    for (const id of [undefined, '', 'Field Craft', 7]) refused(one({ ...good, id }), 'BAD_RECORD', 'content.crafts[0].id');
    refused(withCrafts([good, good]), 'DUPLICATE', 'content.crafts[1]');
    for (const title of [undefined, '', '  ', 7, 'x'.repeat(31), 'Craft: one', 'a|b']) refused(one({ ...good, title }), 'BAD_RECORD', 'content.crafts[0].title');
    for (const stats of [undefined, [], ['dex'], ['DEX', 'DEX'], ['STR', 'DEX', 'INT', 'LUK'], 'DEX', [7]]) refused(one({ ...good, stats }), 'BAD_RECORD', 'content.crafts[0].stats');
    for (const stations of ['forge', ['Forge'], ['forge', 'forge'], Array.from({ length: 9 }, (_, index) => `s-${index}`), [7]]) refused(one({ ...good, stations }), 'BAD_RECORD', 'content.crafts[0].stations');
    for (const note of [7, 'x'.repeat(201)]) refused(one({ ...good, note }), 'BAD_RECORD', 'content.crafts[0].note');
    refused(one({ ...good, dc: 10 }), 'UNKNOWN_FIELD', 'content.crafts[0].dc');
});

test('packs.crafts lays the enabled packs\' crafts over the defaults; the earlier pack wins a shared id', async () => {
    const first = ok(pack({ id: 'first', content: { crafts: [{ id: 'alchemy', title: 'Alchemy', stats: ['INT', 'DEX'], stations: ['alchemy-table'] }, { id: 'fieldcraft', title: 'Fieldcraft', stats: ['DEX'] }] } }));
    const second = ok(pack({ id: 'second', content: { crafts: [{ id: 'fieldcraft', title: 'Bushcraft', stats: ['VIT'] }, { id: 'smithing', title: 'Smithing', stats: ['STR'], stations: ['forge'] }] } }));
    const table = craftsOf([first, second]);
    assert.deepEqual(table.map(craft => [craft.craft, craft.stats.join('+'), craft.pack]), [
        ['smithing', 'STR', 'second'], ['alchemy', 'INT+DEX', 'first'], ['leather', 'DEX', null], ['cooking', 'VIT', null], ['enchanting', 'INT+LUK', null], ['fieldcraft', 'DEX', 'first'],
    ], 'a default replaced in place, a new craft after the defaults');
    table[0].stats.push('LUK');
    assert.deepEqual(craftsOf([first, second])[0].stats, ['STR'], 'copies, not the packs\' own lists');
    assert.equal(contentOf([first, second], 'crafts').length, 4, 'packs.content lists every pack\'s records');

    const settings = fakeSettings();
    const { part, packs } = createPacksPart({ settings });
    assert.deepEqual(part.queries['packs.crafts']().map(craft => craft.craft), ['smithing', 'alchemy', 'leather', 'cooking', 'enchanting'], 'no packs: the defaults');
    await packs.install(JSON.stringify(pack({ id: 'first', content: { crafts: [{ id: 'alchemy', title: 'Alchemy', stats: ['INT', 'DEX'] }] } })));
    assert.deepEqual(part.queries['packs.crafts']().find(craft => craft.craft === 'alchemy'), { craft: 'alchemy', title: 'Alchemy', stats: ['INT', 'DEX'], stations: [], pack: 'first' });
});

test('the packs list counts crafts', () => {
    assert.equal(countsLine({ items: 2, recipes: 1, crafts: 2, meterPresets: 1 }, false), '2 items, 1 recipe, 2 crafts, 1 meter preset');
});
