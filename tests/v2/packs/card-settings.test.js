// sdk.registerCardSettings (packs/card-settings.js) and Story Block's own owner: only differences are listed, an unregistered owner is a
// missing extension, and applying persists the setting exactly as the settings screens do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { createCardSettings } from '../../../src/v2/packs/card-settings.js';

const nsd = (state = { portraitPromptFormat: 'hybrid', scanEvery: 4 }) => ({
    owner: 'npc-state-delta',
    label: 'NPC State Delta',
    keys: {
        portraitPromptFormat: { label: 'NSD portraits', valueText: v => (v === 'natural' ? 'Natural' : 'Structured hybrid'), valid: v => ['natural', 'hybrid'].includes(v) },
        scanEvery: { label: 'Scan every', valueText: v => `${v} replies`, valid: v => Number.isInteger(v) && v >= 1 && v <= 20 },
    },
    read: key => state[key],
    apply: async values => { Object.assign(state, values); return { applied: Object.keys(values) }; },
});

test('Story Block registers its own owner (RPG, Gear, XP rate) and the sdk lets another owner register; only differences are listed', async t => {
    const host = await createHost({ core: true, lazyRpg: false });
    t.after(() => host.close());
    const cs = host.cardSettings;
    assert.equal(cs.has('story-block'), true);
    const state = { portraitPromptFormat: 'hybrid', scanEvery: 4 };
    const off = host.sdk.registerCardSettings(nsd(state));
    assert.equal(typeof off, 'function');
    const card = { 'story-block.rpg': true, 'story-block.gear': true, 'story-block.rpgXpRate': 150, 'npc-state-delta.portraitPromptFormat': 'natural' };
    assert.deepEqual(cs.plan(card).items.map(item => item.text), ['RPG on', 'Gear on', 'XP rate 150%', 'NSD portraits Natural']);
    host.features.set('story-block.rpg', true);
    assert.deepEqual(cs.plan(card).items.map(item => item.text), ['Gear on', 'XP rate 150%', 'NSD portraits Natural'], 'the RPG is on already');
    assert.deepEqual(cs.plan({ 'story-block.rpgXpRate': 100, 'story-block.rpg': 'yes' }).items, [], '100 is the current rate; "yes" is not a boolean');
    off();
    assert.deepEqual(cs.plan(card).missing, ['npc-state-delta'], 'an owner that is not registered is a missing extension');
});

test('applying Story Block\'s own settings persists them exactly as the settings screens do (feature store and the settings\' set), and saves', async t => {
    const host = await createHost({ core: true, lazyRpg: false });
    t.after(() => host.close());
    const cs = host.cardSettings;
    const before = host.st.settingsSaves;
    const { items } = cs.plan({ 'story-block.rpg': true, 'story-block.gear': true, 'story-block.rpgXpRate': 150 });
    const done = await cs.apply(items);
    assert.deepEqual(done.applied.map(item => item.key), ['rpg', 'gear', 'rpgXpRate']);
    assert.deepEqual(done.failed, []);
    assert.ok(host.st.settingsSaves > before, 'saveSettingsDebounced ran');
    const stored = host.ctx.extensionSettings.storySuite;
    assert.equal(stored.features['story-block.rpg'], true);
    assert.equal(stored.features['story-block.gear'], true);
    assert.equal(stored.modules['story-block'].rpgXpRate, 150);
    assert.equal(host.registry.featureOn('story-block.rpg'), true);
    assert.equal(host.settings('story-block').rpgXpRate, 150);
    // the same values set the way the screens set them give the same stored bytes
    const other = await createHost({ core: true, lazyRpg: false });
    t.after(() => other.close());
    other.features.set('story-block.rpg', true);
    other.features.set('story-block.gear', true);
    other.settings.set('story-block', 'rpgXpRate', 150);
    assert.deepEqual(JSON.stringify(other.ctx.extensionSettings.storySuite.features), JSON.stringify(stored.features));
    assert.deepEqual(other.ctx.extensionSettings.storySuite.modules['story-block'], stored.modules['story-block']);
    // and a card that now matches lists nothing
    assert.deepEqual(cs.plan({ 'story-block.rpg': true, 'story-block.gear': true, 'story-block.rpgXpRate': 150 }).items, []);
});

test('the public api does not carry registerCardSettings; the internal sdk does', async t => {
    const host = await createHost({ core: true });
    t.after(() => host.close());
    assert.equal(typeof host.sdk.registerCardSettings, 'function');
    assert.equal(host.api.registerCardSettings, undefined);
    assert.equal(Object.keys(host.api).some(key => /card/i.test(key)), false);
});

test('the plan lists differences only, drops an unregistered owner\'s keys and skips a value the owner says is not valid', () => {
    const registry = createCardSettings();
    const state = { portraitPromptFormat: 'hybrid', scanEvery: 4 };
    registry.register(nsd(state));
    const values = { 'npc-state-delta.portraitPromptFormat': 'natural', 'npc-state-delta.scanEvery': 4, 'story-block.rpg': true };
    const plan = registry.plan(values);
    assert.deepEqual(plan.items.map(item => item.text), ['NSD portraits Natural'], 'scanEvery is already 4: left out');
    assert.deepEqual(plan.missing, ['story-block'], 'story-block is not registered in this registry: its key is dropped');
    const bad = registry.plan({ 'npc-state-delta.scanEvery': 99, 'npc-state-delta.nope': 1 });
    assert.deepEqual(bad.items, []);
    assert.equal(bad.lines.length, 2);
    assert.match(bad.lines[0], /scanEvery skipped: NPC State Delta does not accept that value/);
    assert.match(bad.lines[1], /nope skipped: NPC State Delta does not list it/);
});

test('apply hands each owner its own values once, counts only what the owner says it applied, and survives an owner that throws', async () => {
    const registry = createCardSettings();
    const state = { portraitPromptFormat: 'hybrid', scanEvery: 4 };
    let calls = 0;
    const spec = nsd(state);
    registry.register({ ...spec, apply: async values => { calls += 1; return spec.apply(values); } });
    registry.register({ owner: 'story-block', label: 'Story Block', keys: { rpg: { label: 'RPG', valueText: v => (v ? 'on' : 'off'), valid: v => typeof v === 'boolean' } }, read: () => false, apply: async () => { throw new Error('boom'); } });
    const { items } = registry.plan({ 'npc-state-delta.portraitPromptFormat': 'natural', 'npc-state-delta.scanEvery': 8, 'story-block.rpg': true });
    const done = await registry.apply(items);
    assert.equal(calls, 1);
    assert.deepEqual(state, { portraitPromptFormat: 'natural', scanEvery: 8 });
    assert.deepEqual(done.applied.map(item => item.id), ['npc-state-delta.portraitPromptFormat', 'npc-state-delta.scanEvery']);
    assert.match(done.failed[0].message, /could not apply it \(boom\)/);
});

test('unregister removes the owner, and a newer registration of the same owner is not removed by the older unregister', () => {
    const registry = createCardSettings();
    const off = registry.register(nsd());
    assert.equal(registry.has('npc-state-delta'), true);
    const second = registry.register(nsd());
    off();
    assert.equal(registry.has('npc-state-delta'), true, 'the newer one stays');
    second();
    assert.equal(registry.has('npc-state-delta'), false);
    assert.throws(() => registry.register({ owner: 'Bad Owner' }), /registerCardSettings/);
});
