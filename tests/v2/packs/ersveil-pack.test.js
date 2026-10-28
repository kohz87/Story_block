// The example pack (examples/packs/ersveil, Ersveil 2.0.0, the open world) and its lorebook (ersveil-lore.json): the pack
// passes the authoring-kit checker and Story Block's own validator without RPG Battle and carries the shape
// docs/v2/ERSVEIL.md describes; the lorebook is a SillyTavern World Info book of 171 entries with unique uids. (The former
// example packs are fixtures: Ersveil 1.0.0 with RPG Battle's rules, ersveil-rules-fixture.test.js, and Bluewatch 1.6.0,
// ersveil.test.js and its neighbours.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkPack, report } from '../../../authoring-kit/check.mjs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { findPackEntries } from '../../../src/v2/packs/lorebook.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packPath = new URL('../../../examples/packs/ersveil/pack.json', import.meta.url);
const lorePath = new URL('../../../examples/packs/ersveil/ersveil-lore.json', import.meta.url);
const packText = readFileSync(packPath, 'utf8');
const pack = () => JSON.parse(packText);

const OPEN = ['scene', 'inventory', 'data-modules-v1'];

test('the example folder holds exactly the pack and its lorebook, and the old example packs are fixtures', () => {
    assert.ok(existsSync(packPath) && existsSync(lorePath));
    assert.deepEqual(readdirSync(new URL('../../../examples/packs/ersveil/', import.meta.url)).sort(), ['ersveil-lore.json', 'pack.json']);
    assert.equal(existsSync(new URL('../../../examples/packs/ersveil-bluewatch/', import.meta.url)), false);
    assert.ok(existsSync(new URL('./fixtures/ersveil-bluewatch-1.6.0.json', import.meta.url)), 'Bluewatch 1.6.0 is kept as a fixture');
    assert.ok(existsSync(new URL('./fixtures/ersveil-1.0.0.json', import.meta.url)), 'Ersveil 1.0.0 with its rules is kept as a fixture');
});

test('examples/packs/ersveil/pack.json passes the authoring-kit checker, in code and on the command line', () => {
    const result = checkPack(packText);
    assert.equal(result.ok, true, report('examples/packs/ersveil/pack.json', result));
    const printed = execFileSync(process.execPath, ['authoring-kit/check.mjs', 'examples/packs/ersveil/pack.json'], { cwd: root, encoding: 'utf8' });
    assert.match(printed, /^OK examples\/packs\/ersveil\/pack\.json\n/);
});

test('Story Block\'s own validator accepts the pack without RPG Battle (scene, inventory, data modules), and refuses it on a host older than 2.5', () => {
    const good = validatePack(pack(), { capabilities: OPEN });
    assert.equal(good.ok, true, JSON.stringify(good.errors));
    const old = validatePack(pack(), { capabilities: OPEN, hostVersion: '2.4.0' });
    assert.equal(old.ok, false);
    assert.ok(old.errors.some(error => error.code === 'HOST_VERSION'));
    // Without the data-modules capability it is refused for that alone.
    const bare = validatePack(pack(), { capabilities: ['scene', 'inventory'] });
    assert.equal(bare.ok, false);
});

test('the pack is Ersveil 2.0.0, the open world: the map, the calendar, the weather, events and data modules, and none of RPG Battle\'s rules', () => {
    const value = pack();
    assert.equal(value.id, 'ersveil');
    assert.equal(value.version, '2.0.0');
    assert.equal(value.name, 'Ersveil (open world)');
    assert.match(value.description, /Story Block and Story Director, no RPG Battle needed/);
    assert.equal(value.requires.storyBlock, '^2.5');
    assert.deepEqual(value.requires.capabilities, OPEN);
    const counts = Object.fromEntries(Object.entries(value.content).map(([kind, list]) => [kind, list.length]));
    assert.deepEqual(counts, { places: 320, routes: 350, events: 7, dataModules: 3 });
    assert.equal(value.economy, undefined, 'no money scale: prices are the story\'s');
    assert.ok(value.content.places.every(place => place.market === undefined), 'no market types: there are no market records to name');
    assert.equal(value.weather.tables.length, 84);
    assert.deepEqual(value.currency.coins.map(coin => [coin.name, coin.value]), [['copper', 1], ['bronze', 1], ['silver', 10], ['gold', 100]]);
    assert.equal(value.start.scene.place.name, 'Bluewatch Village / Guild Office');
    assert.deepEqual(value.start.inventory, { money: 40 }, 'four silver and no pack items');
    assert.deepEqual(value.calendar.start, { year: 611, month: 'Goldwane', day: 12, hour: 6, minute: 40 });
    assert.deepEqual(value.content.dataModules.map(module => module.slug), ['standing', 'fame', 'guild-membership']);
    // The map, the calendar, the weather, the events and the data modules are the 1.0.0 fixture's, unchanged but for the places' market types.
    const before = JSON.parse(readFileSync(new URL('./fixtures/ersveil-1.0.0.json', import.meta.url), 'utf8'));
    for (const key of ['currency', 'calendar', 'weather']) assert.deepEqual(value[key], before[key], key);
    for (const kind of ['routes', 'events', 'dataModules']) assert.deepEqual(value.content[kind], before.content[kind], kind);
    assert.deepEqual(value.content.places, before.content.places.map(({ market, ...rest }) => rest));
});

test('the pack, once installed without RPG Battle, reads back as 320 places, 350 routes and the rest ERSVEIL.md quotes', async () => {
    const { createInstalled } = await import('../../../src/v2/packs/installed.js');
    const { addsLine } = await import('../../../src/v2/packs/panel.js');
    const store = {};
    const installed = createInstalled({ settings: { read: () => store, save: async () => {} }, capabilities: () => OPEN });
    const result = await installed.install(packText, { source: 'file', origin: 'pack.json' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.name, 'Ersveil (open world)');
    assert.equal(addsLine(installed.list()[0]), '7 events, 320 places, 350 routes, start state, 4 coins, a calendar, 84 weather tables');
});

test('ersveil-lore.json is a SillyTavern World Info book of 171 entries with unique uids', () => {
    const book = JSON.parse(readFileSync(lorePath, 'utf8'));
    assert.equal(book.name, 'Ersveil Lore');
    assert.ok(book.entries && typeof book.entries === 'object' && !Array.isArray(book.entries), 'entries is an object keyed by uid, as SillyTavern exports it');
    const entries = Object.values(book.entries);
    assert.equal(entries.length, 171);
    const uids = entries.map(entry => entry.uid);
    assert.ok(uids.every(uid => Number.isInteger(uid)));
    assert.equal(new Set(uids).size, 171, 'every uid is unique');
    for (const [key, entry] of Object.entries(book.entries)) {
        assert.equal(String(entry.uid), key, `entry ${key}: the key is the uid`);
        assert.ok(Array.isArray(entry.key), `entry ${key} lists its trigger words`);
        assert.equal(typeof entry.content, 'string', `entry ${key} has content`);
        assert.ok(entry.content.trim().length > 0 || entry.constant === true, `entry ${key} is not empty`);
        assert.equal(typeof entry.comment, 'string');
    }
    // It is lore for the narrator, not a pack carried in a lorebook entry: nothing in it is tagged [storysuite:pack].
    assert.deepEqual(findPackEntries(entries.map(entry => ({ book: book.name, uid: entry.uid, title: entry.comment, content: entry.content }))), []);
});

test('the lorebook is written for the open world: no RPG Battle wording, classes, Soul Class, Guild letters and peoples kept as lore, no item or shop lists', () => {
    const book = JSON.parse(readFileSync(lorePath, 'utf8'));
    const entries = Object.values(book.entries);
    const all = entries.map(entry => entry.content).join('\n');
    for (const word of [/RPG Battle/, /Party sheet/, /character screen/, /markets, prices/]) assert.doesNotMatch(all, word);
    const byTitle = title => entries.find(entry => entry.comment === title)?.content ?? '';
    assert.match(byTitle('[CORE] Authority and Generation'), /Open world: the pack lists no items, shops, prices, foes or jobs/);
    assert.match(byTitle('[CORE] Classification'), /Soul Class \(I-IX\)/);
    assert.match(byTitle('Adventurer Guild'), /F Registered, E Journeyman, D Proven, C Veteran, B Elite, A Paragon, S Legend/);
    const callings = byTitle('Callings: the Thirteen Lines');
    assert.equal(callings.split('\n').filter(line => line.startsWith('- ')).length, 13, 'the thirteen class lines, as lore');
    assert.ok(callings.length < 1600, 'one lean entry');
    assert.match(byTitle('Peoples of Ersveil'), /Ten sapient peoples/);
});
