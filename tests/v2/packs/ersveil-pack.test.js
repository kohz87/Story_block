// The example pack (examples/packs/ersveil, Ersveil 1.0.0) and its lorebook (ersveil-lore.json): the pack passes the
// authoring-kit checker and Story Block's own validator and carries the shape docs/v2/ERSVEIL.md describes; the lorebook
// is a SillyTavern World Info book of 170 entries with unique uids. (The former example pack, Bluewatch 1.6.0, is the
// fixture fixtures/ersveil-bluewatch-1.6.0.json; ersveil.test.js and its neighbours test that.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkPack, report } from '../../../authoring-kit/check.mjs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { findPackEntries } from '../../../src/v2/packs/lorebook.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packPath = new URL('../../../examples/packs/ersveil/pack.json', import.meta.url);
const lorePath = new URL('../../../examples/packs/ersveil/ersveil-lore.json', import.meta.url);
const packText = readFileSync(packPath, 'utf8');
const pack = () => JSON.parse(packText);

test('the example folder holds exactly the pack and its lorebook, and the old Bluewatch pack is not an example any more', () => {
    assert.ok(existsSync(packPath) && existsSync(lorePath));
    assert.equal(existsSync(new URL('../../../examples/packs/ersveil-bluewatch/', import.meta.url)), false);
    assert.ok(existsSync(new URL('./fixtures/ersveil-bluewatch-1.6.0.json', import.meta.url)), 'Bluewatch 1.6.0 is kept as a fixture');
});

test('examples/packs/ersveil/pack.json passes the authoring-kit checker, in code and on the command line', () => {
    const result = checkPack(packText);
    assert.equal(result.ok, true, report('examples/packs/ersveil/pack.json', result));
    const printed = execFileSync(process.execPath, ['authoring-kit/check.mjs', 'examples/packs/ersveil/pack.json'], { cwd: root, encoding: 'utf8' });
    assert.match(printed, /^OK examples\/packs\/ersveil\/pack\.json\n/);
});

test('Story Block\'s own validator accepts the pack with the suite\'s capabilities, and refuses it on a host older than 2.5', () => {
    const capabilities = ['scene', 'inventory', 'rb-rules-v2', 'data-modules-v1'];
    const good = validatePack(pack(), { capabilities });
    assert.equal(good.ok, true, JSON.stringify(good.errors));
    const old = validatePack(pack(), { capabilities, hostVersion: '2.4.0' });
    assert.equal(old.ok, false);
    assert.ok(old.errors.some(error => error.code === 'HOST_VERSION'));
});

test('the pack is Ersveil 1.0.0 with the contents ERSVEIL.md lists', () => {
    const value = pack();
    assert.equal(value.id, 'ersveil');
    assert.equal(value.version, '1.0.0');
    assert.equal(value.requires.storyBlock, '^2.5');
    assert.deepEqual(value.requires.capabilities, ['scene', 'inventory', 'rb-rules-v2', 'data-modules-v1']);
    const counts = Object.fromEntries(Object.entries(value.content).map(([kind, list]) => [kind, list.length]));
    assert.deepEqual(counts, {
        places: 320, routes: 350, markets: 31, terms: 1, ranks: 7, races: 10, talents: 8, items: 124, creatures: 69, crafts: 2,
        recipes: 21, quests: 54, shops: 20, events: 7, meterPresets: 2, dataModules: 3, rules: 1,
    });
    assert.equal(value.weather.tables.length, 84);
    assert.equal(value.presets, undefined, 'no ready-made characters');
    assert.equal(value.content.presets, undefined);
    assert.deepEqual(value.currency.coins.map(coin => [coin.name, coin.value]), [['copper', 1], ['bronze', 1], ['silver', 10], ['gold', 100]]);
    assert.equal(value.start.scene.place.name, 'Bluewatch Village / Guild Office');
    assert.equal(value.start.inventory.money, 40, 'four silver');
    assert.deepEqual(value.calendar.start, { year: 611, month: 'Goldwane', day: 12, hour: 6, minute: 40 });
    const rules = value.content.rules[0];
    assert.deepEqual(rules.promotionMastery, [3, 5, 5]);
    assert.equal(rules.classes.length, 40);
    assert.equal(rules.skills.length, 120);
    assert.deepEqual(rules.classes.filter(entry => entry.tier === 0).map(entry => entry.slug), ['awakened']);
    assert.equal(rules.classes.filter(entry => entry.tier === 1 && entry.parent === 'awakened').length, 13, 'thirteen lines from the shared start');
    assert.deepEqual(value.content.dataModules.map(module => module.slug), ['standing', 'fame', 'guild-membership']);
    assert.equal(value.content.quests.filter(quest => quest.open).length, 49);
    assert.equal(rules.trainers.filter(trainer => trainer.open).length, 13);
});

test('the pack, once installed, reads back as 124 items, 69 creatures and the rest ERSVEIL.md quotes', async () => {
    const { createInstalled } = await import('../../../src/v2/packs/installed.js');
    const { addsLine } = await import('../../../src/v2/packs/panel.js');
    const store = {};
    const installed = createInstalled({ settings: { read: () => store, save: async () => {} }, capabilities: () => ['scene', 'inventory', 'rb-rules-v2', 'data-modules-v1'] });
    const result = await installed.install(packText, { source: 'file', origin: 'pack.json' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.name, 'Ersveil');
    assert.equal(addsLine(installed.list()[0]),
        '124 items, 69 creatures, 20 shops, 21 recipes, 7 events, 54 quests, 10 races, 8 talents, 320 places, 350 routes, 1 term set, 7 ranks, 2 crafts, 2 meter presets, 31 markets, 1 rules set, start state, 4 coins, a money scale, a calendar, 84 weather tables');
});

test('ersveil-lore.json is a SillyTavern World Info book of 170 entries with unique uids', () => {
    const book = JSON.parse(readFileSync(lorePath, 'utf8'));
    assert.equal(book.name, 'Ersveil Lore');
    assert.ok(book.entries && typeof book.entries === 'object' && !Array.isArray(book.entries), 'entries is an object keyed by uid, as SillyTavern exports it');
    const entries = Object.values(book.entries);
    assert.equal(entries.length, 170);
    const uids = entries.map(entry => entry.uid);
    assert.ok(uids.every(uid => Number.isInteger(uid)));
    assert.equal(new Set(uids).size, 170, 'every uid is unique');
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
