// Ersveil 1.0.0, the example pack of Story Block 2.5.1 and 2.5.2 with RPG Battle's rules, is the test fixture
// fixtures/ersveil-1.0.0.json since 2.5.3 (the example is now the open-world Ersveil 2.0.0, ersveil-pack.test.js). It still
// passes the authoring-kit checker and Story Block's own validator with RPG Battle's capability, and keeps the rows its
// tests (rules-parity, rules-scope, kit) lean on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkPack, report } from '../../../authoring-kit/check.mjs';
import { validatePack } from '../../../src/v2/packs/validate.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const FILE = 'tests/v2/packs/fixtures/ersveil-1.0.0.json';
const packText = readFileSync(new URL('./fixtures/ersveil-1.0.0.json', import.meta.url), 'utf8');
const pack = () => JSON.parse(packText);
const RB = ['scene', 'inventory', 'rb-rules-v2', 'data-modules-v1'];

test('the Ersveil 1.0.0 fixture passes the authoring-kit checker, in code and on the command line', () => {
    const result = checkPack(packText);
    assert.equal(result.ok, true, report(FILE, result));
    const printed = execFileSync(process.execPath, ['authoring-kit/check.mjs', FILE], { cwd: root, encoding: 'utf8' });
    assert.ok(printed.startsWith(`OK ${FILE}\n`), printed);
});

test('Story Block\'s own validator accepts the fixture with RPG Battle\'s rules capability, and refuses it without it or on a host older than 2.5', () => {
    const good = validatePack(pack(), { capabilities: RB });
    assert.equal(good.ok, true, JSON.stringify(good.errors));
    const noRules = validatePack(pack(), { capabilities: RB.filter(name => name !== 'rb-rules-v2') });
    assert.equal(noRules.ok, false, 'a rules pack needs rb-rules-v2');
    const old = validatePack(pack(), { capabilities: RB, hostVersion: '2.4.0' });
    assert.equal(old.ok, false);
    assert.ok(old.errors.some(error => error.code === 'HOST_VERSION'));
});

test('the fixture is Ersveil 1.0.0 with its rules: 13 class lines from one start, items, foes, quests and shops', () => {
    const value = pack();
    assert.equal(value.id, 'ersveil');
    assert.equal(value.version, '1.0.0');
    assert.deepEqual(value.requires.capabilities, RB);
    const counts = Object.fromEntries(Object.entries(value.content).map(([kind, list]) => [kind, list.length]));
    assert.deepEqual(counts, {
        places: 320, routes: 350, markets: 31, terms: 1, ranks: 7, races: 10, talents: 8, items: 124, creatures: 69, crafts: 2,
        recipes: 21, quests: 54, shops: 20, events: 7, meterPresets: 2, dataModules: 3, rules: 1,
    });
    const rules = value.content.rules[0];
    assert.deepEqual(rules.promotionMastery, [3, 5, 5]);
    assert.equal(rules.classes.length, 40);
    assert.equal(rules.skills.length, 120);
    assert.equal(rules.classes.filter(entry => entry.tier === 1 && entry.parent === 'awakened').length, 13);
    assert.equal(value.content.quests.filter(quest => quest.open).length, 49);
    assert.equal(rules.trainers.filter(trainer => trainer.open).length, 13);
});

test('the fixture, once installed with RPG Battle\'s capability, reads back as the 2.5.1 example did', async () => {
    const { createInstalled } = await import('../../../src/v2/packs/installed.js');
    const { addsLine } = await import('../../../src/v2/packs/panel.js');
    const store = {};
    const installed = createInstalled({ settings: { read: () => store, save: async () => {} }, capabilities: () => RB });
    const result = await installed.install(packText, { source: 'file', origin: 'ersveil-1.0.0.json' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(addsLine(installed.list()[0]),
        '124 items, 69 creatures, 20 shops, 21 recipes, 7 events, 54 quests, 10 races, 8 talents, 320 places, 350 routes, 1 term set, 7 ranks, 2 crafts, 2 meter presets, 31 markets, 1 rules set, start state, 4 coins, a money scale, a calendar, 84 weather tables');
});
