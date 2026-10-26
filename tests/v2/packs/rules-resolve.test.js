// `packs.rules({ resolve: true })` (docs/v2/PACKS.md, "rules (a rules pack)"): for each enabled rules pack the checked, detached
// pin a rules module freezes: the resolved ruleset, rulesHash, packHash, the pack's id and version, the progression constants and the
// complete item definitions. A module never resolves a manifest itself; asking without `resolve` is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_VERSION } from '../../../src/v2/packs/validate.js';
import * as R from '../../../src/v2/packs/rules-v2.js';
import { createInstalled } from '../../../src/v2/packs/installed.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { smallRulesPack } from './rules-v2/fixtures/smallRulesPack.js';

const MODULES = ['story-director', 'rpg-battle', 'story-block', 'scene', 'inventory'];
const ask = (part, args) => part.queries['packs.rules']({}, args);
async function world(packs = [smallRulesPack()]) {
    const settings = fakeSettings();
    const { part, packs: installed } = createPacksPart({ settings, capabilities: () => MODULES });
    for (const pack of packs) assert.equal((await installed.install(JSON.stringify(pack), { source: 'file', origin: 'rules.json' })).ok, true);
    return { part, installed };
}

test('without resolve the answer is what it always was: no pin', async () => {
    const { part } = await world();
    const [entry] = ask(part, {});
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'manifest', 'name', 'pack', 'version']);
    assert.equal(ask(part, { resolve: false })[0].pin, undefined);
});

test('resolve gives the checker\'s own pin: hashes, pack id and version, progression, constants hash, item definitions', async () => {
    const { part } = await world();
    const [entry] = ask(part, { resolve: true });
    const checked = R.validateRulesPack(smallRulesPack(), { hostVersion: HOST_VERSION });
    assert.equal(checked.ok, true);
    const pin = entry.pin;
    assert.deepEqual(Object.keys(pin).sort(), ['constantsHash', 'defs', 'packHash', 'packKey', 'packVersion', 'progression', 'resolved', 'rulesHash']);
    assert.equal(pin.rulesHash, checked.rulesHash);
    assert.equal(pin.packHash, checked.packHash);
    assert.deepEqual([pin.packKey, pin.packVersion], ['fixture', '2.0.0']);
    assert.deepEqual(pin.resolved, checked.resolved);
    assert.deepEqual(pin.progression, R.RULES_V2_PROGRESSION);
    assert.equal(pin.constantsHash, R.sha256(JSON.stringify(R.canonicalizeJson(checked.resolved.constants))));
    assert.deepEqual(pin.defs, {}, 'a pack with no items has no definitions');
    assert.deepEqual(ask(part, { pack: 'fixture', resolve: true })[0].pin, pin, 'the pack argument narrows without changing the pin');
});

test('the pin is a detached copy: changing an answer changes neither the next answer nor the installed pack', async () => {
    const { part, installed } = await world();
    const first = ask(part, { resolve: true })[0].pin;
    first.resolved.constants = null;
    first.rulesHash = 'x';
    const second = ask(part, { resolve: true })[0].pin;
    assert.notEqual(second.resolved.constants, null);
    assert.match(second.rulesHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(installed.rules('fixture'), second);
});

test('a disabled pack, a pack that is not installed and a pack with no rules give no pin', async () => {
    const plain = { id: 'plain', version: '1.0.0', requires: { storyBlock: '^2' }, content: { items: [] } };
    const { part, installed } = await world([smallRulesPack(), plain]);
    assert.equal(installed.rules('plain'), null);
    assert.equal(installed.rules('nope'), null);
    assert.deepEqual(ask(part, { resolve: true }).map(entry => entry.pack), ['fixture']);
    await installed.setEnabled('fixture', false);
    assert.equal(installed.rules('fixture'), null);
    assert.deepEqual(ask(part, { resolve: true }), []);
});

test('the same version installed again with other content has another pin; the hashes say which part changed', async () => {
    const { part, installed } = await world();
    const before = ask(part, { resolve: true })[0].pin;
    const described = smallRulesPack();
    described.description = 'Only the description changed.';
    assert.equal((await installed.install(JSON.stringify(described), { source: 'file', origin: 'rules.json' })).ok, true);
    const text = ask(part, { resolve: true })[0].pin;
    assert.equal(text.rulesHash, before.rulesHash, 'the rules are the same');
    assert.notEqual(text.packHash, before.packHash, 'the pack is not');
    const changed = smallRulesPack();
    changed.content.rules[0].classes[0].name = 'Renamed class';
    assert.equal((await installed.install(JSON.stringify(changed), { source: 'file', origin: 'rules.json' })).ok, true);
    const rules = ask(part, { resolve: true })[0].pin;
    assert.notEqual(rules.rulesHash, before.rulesHash);
    assert.equal(rules.packVersion, before.packVersion);
});

test('item definitions come with the pin, by definition ID, as packs.itemDefs gives them', async () => {
    const pack = smallRulesPack();
    pack.content.items = [{ slug: 'rope', name: 'Rope', kind: 'goods', value: 3 }];
    pack.content.rules[0].itemRules = [{ def: 'rope', allowedSlots: [], hands: 0, requires: {}, weight: 100 }];
    const { part } = await world([pack]);
    const [entry] = ask(part, { resolve: true });
    assert.deepEqual(Object.keys(entry.pin.defs), ['pack.fixture/rope']);
    assert.deepEqual(Object.values(entry.pin.defs), part.queries['packs.itemDefs']({}, {}));
});
