// "How much to track" (features.js presets, registry.withFeatures, prompt.js staticTextWith): the preset a set of switches
// matches is derived and never stored (a match, else Custom), picking one sets the switches it speaks for through the
// ordinary setter, a feature with `presets: false` is never touched, an older module's features follow their default in
// every preset, Story Block's own table is as the brief says, and the fixed prompt can be counted per preset without
// switching anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { createRegistry, definitionProblems, definitionWarnings } from '../../src/v2/registry.js';
import { CORE_FEATURE, PRESET_NAMES, applyPreset, createFeatureStore, presetSwitches, presetValue, selectedPreset } from '../../src/v2/features.js';
import { estimateTokens, staticTextWith } from '../../src/v2/prompt.js';

// A module with every kind of entry: both keys, one key, outside presets, and (no `presets` at all) a plain default.
function tracker() {
    return {
        id: 'tr',
        name: 'Tracker',
        version: '0.0.1',
        features: [
            { id: 'tr.both', label: 'Both', default: true, presets: { lean: false, full: true } },
            { id: 'tr.lean-only', label: 'Lean only', default: true, presets: { lean: false } },
            { id: 'tr.full-only', label: 'Full only', default: false, presets: { full: true } },
            { id: 'tr.mine', label: 'Mine', default: true, presets: false },
            { id: 'tr.plain', label: 'Plain', default: false },
        ],
        capture: { kinds: { note: { grammar: '+ note Name', feature: 'tr.both' } }, apply: () => ({ summary: 'ok', narrate: false }) },
        context: { static: () => 'Tracker keeps notes.', parts: [{ static: () => 'Extra line for full.', feature: 'tr.full-only' }] },
    };
}
function store(settings = {}, modules = [tracker()]) {
    // Wired as runtime.js wires it: the registry reads the reader's choices through the store.
    let features = null;
    const registry = createRegistry({ featureValue: id => features?.stored(id) });
    for (const module of modules) registry.register(module);
    const root = { storySuite: { features: { ...settings } } };
    const saved = [];
    const told = [];
    features = createFeatureStore({ root: () => root, registry, save: () => saved.push(1), onChange: change => told.push(change) });
    return { registry, features, root, saved, told };
}
const states = features => Object.fromEntries(features.list().map(feature => [feature.id, feature.on]));

test('presetValue: standard is the default, lean and full their own key else the default, presets:false has none', () => {
    const [both, leanOnly, fullOnly, mine, plain] = tracker().features;
    assert.deepEqual(PRESET_NAMES, ['lean', 'standard', 'full']);
    assert.deepEqual(PRESET_NAMES.map(name => presetValue(both, name)), [false, true, true]);
    assert.deepEqual(PRESET_NAMES.map(name => presetValue(leanOnly, name)), [false, true, true], 'full says nothing: the default');
    assert.deepEqual(PRESET_NAMES.map(name => presetValue(fullOnly, name)), [false, false, true], 'lean says nothing: the default');
    assert.deepEqual(PRESET_NAMES.map(name => presetValue(mine, name)), [null, null, null]);
    assert.deepEqual(PRESET_NAMES.map(name => presetValue(plain, name)), [false, false, false], 'an older module: its default in all three');
    assert.deepEqual(PRESET_NAMES.map(name => presetValue({ id: 'x.y', default: undefined }, name)), [true, true, true], 'no default given: on');
});

test('derivation: the preset whose table every in-preset feature matches, else none (Custom); nothing is stored', () => {
    const { features, root, saved } = store();
    assert.equal(selectedPreset(features.list()), 'standard', 'the defaults');
    assert.equal(features.applyPreset('lean').name, 'lean');
    assert.equal(selectedPreset(features.list()), 'lean');
    features.applyPreset('full');
    assert.equal(selectedPreset(features.list()), 'full');
    // One switch away from Full is Custom: no tile.
    features.set('tr.both', false);
    assert.equal(selectedPreset(features.list()), null);
    // Back to the table: Full again, with nothing remembered of Custom in between.
    features.set('tr.both', true);
    assert.equal(selectedPreset(features.list()), 'full');
    // A feature outside presets does not count either way.
    features.set('tr.mine', false);
    assert.equal(selectedPreset(features.list()), 'full');
    features.set('tr.mine', true);
    assert.equal(selectedPreset(features.list()), 'full');
    // Only feature ids are stored: no preset name anywhere.
    assert.deepEqual(Object.keys(root.storySuite).sort(), ['features']);
    assert.ok(Object.keys(root.storySuite.features).every(id => id.startsWith('tr.')), JSON.stringify(root.storySuite));
    assert.ok(saved.length > 0);
    assert.equal(selectedPreset([]), null);
    assert.equal(selectedPreset(null), null);
});

test('derivation: an unavailable feature is neither compared nor set (it cannot be switched), and an older module follows its default', () => {
    const needy = { id: 'nd', name: 'Needy', version: '0.0.1', features: [{ id: 'nd.roll', label: 'Roll', default: false, presets: { full: true }, needs: { kinds: ['check'] } }] };
    const { features } = store({}, [tracker(), needy]);
    assert.equal(features.list().find(feature => feature.id === 'nd.roll').available, false);
    const done = features.applyPreset('full');
    assert.deepEqual(done.changed, ['tr.full-only'], 'tr.both is already on');
    assert.equal(selectedPreset(features.list()), 'full', 'Full holds although the roll cannot be on');
    assert.equal(features.stored('nd.roll'), undefined, 'its stored choice is untouched');
    assert.deepEqual([...presetSwitches(features.list(), 'full').keys()].sort(), ['tr.both', 'tr.full-only', 'tr.lean-only', 'tr.plain']);
});

test('picking sets every in-preset feature through the setter; presets:false and a stored choice outside presets stay as they are', () => {
    const { features, root, told } = store({ 'tr.mine': false });
    const before = { ...root.storySuite.features };
    const lean = features.applyPreset('lean');
    assert.deepEqual(states(features), { 'tr.both': false, 'tr.lean-only': false, 'tr.full-only': false, 'tr.mine': false, 'tr.plain': false });
    assert.deepEqual(lean.changed.sort(), ['tr.both', 'tr.lean-only'], 'only what was not already as the preset says');
    assert.equal(lean.prompt, true, 'tr.both owns a capture kind: the fixed prompt changes');
    assert.equal(root.storySuite.features['tr.mine'], before['tr.mine'], 'presets:false: not written');
    assert.deepEqual(told.map(change => [change.id, change.on, change.prompt]), [['tr.both', false, true], ['tr.lean-only', false, false]], 'each told as any switch is');

    const full = features.applyPreset('full');
    assert.deepEqual(states(features), { 'tr.both': true, 'tr.lean-only': true, 'tr.full-only': true, 'tr.mine': false, 'tr.plain': false });
    assert.equal(full.prompt, true);
    const standard = features.applyPreset('standard');
    assert.deepEqual(states(features), { 'tr.both': true, 'tr.lean-only': true, 'tr.full-only': false, 'tr.mine': false, 'tr.plain': false });
    assert.deepEqual(standard.changed, ['tr.full-only']);
    // Picking what already holds changes and tells nothing.
    told.length = 0;
    const again = features.applyPreset('standard');
    assert.deepEqual(again, { name: 'standard', changed: [], prompt: false });
    assert.deepEqual(told, []);
    assert.equal(features.applyPreset('wild'), null);
    assert.equal(applyPreset(null, 'lean'), null);
});

test('a switch that does not change the fixed prompt is not reported as a prompt change', () => {
    const quiet = { id: 'qt', name: 'Quiet', version: '0.0.1', features: [{ id: 'qt.tab', label: 'Tab', default: true, presets: { lean: false } }] };
    const { features } = store({}, [quiet]);
    assert.deepEqual(features.applyPreset('lean'), { name: 'lean', changed: ['qt.tab'], prompt: false });
});

test('the definition: presets is false or { lean?, full? } of booleans; another key is warned and ignored', () => {
    const base = { id: 'pp', name: 'P', version: '0.0.1' };
    const problems = presets => definitionProblems({ ...base, features: [{ id: 'pp.a', label: 'A', presets }] });
    assert.deepEqual(problems(false), []);
    assert.deepEqual(problems({ lean: false, full: true }), []);
    assert.deepEqual(problems({}), []);
    assert.ok(problems('lean').some(text => /presets is not false or an object/.test(text)));
    assert.ok(problems(true).some(text => /presets is not false or an object/.test(text)));
    assert.ok(problems(null).some(text => /presets is not false or an object/.test(text)));
    assert.ok(problems({ lean: 'no' }).some(text => /presets\.lean is not true or false/.test(text)));
    assert.ok(problems({ full: 1 }).some(text => /presets\.full is not true or false/.test(text)));
    assert.deepEqual(definitionWarnings({ ...base, features: [{ id: 'pp.a', label: 'A', presets: { deluxe: true } }] }),
        ['"presets.deluxe" on feature "pp.a" is not a preset this Story Block knows; it is ignored']);
    // The registry keeps what is declared, and says nothing for a feature that declares nothing.
    const registry = createRegistry();
    registry.register({ ...base, features: [{ id: 'pp.a', label: 'A', presets: { lean: false, deluxe: true } }, { id: 'pp.b', label: 'B', presets: false }, { id: 'pp.c', label: 'C' }] });
    assert.deepEqual(registry.feature('pp.a').presets, { lean: false });
    assert.equal(registry.feature('pp.b').presets, false);
    assert.equal(Object.hasOwn(registry.feature('pp.c'), 'presets'), false);
});

test('Story Block\'s own presets: lean turns the extras off, full turns Choices, Inner chatter and the pre-roll on, the rest is outside presets', async () => {
    const host = await createHost();
    const table = Object.fromEntries(host.features.list().map(feature => [feature.id, PRESET_NAMES.map(name => presetValue(feature, name))]));
    const OUT = [null, null, null];
    assert.deepEqual(table, {
        [CORE_FEATURE.hud]: OUT, [CORE_FEATURE.cards]: OUT, [CORE_FEATURE.extractor]: OUT, [CORE_FEATURE.inspector]: OUT, [CORE_FEATURE.savepoints]: OUT, [CORE_FEATURE.leanRpg]: OUT,
        'story-block.encumbrance': OUT,
        [CORE_FEATURE.weather]: [false, true, true], [CORE_FEATURE.you]: [false, true, true], [CORE_FEATURE.mounts]: [false, true, true], 'story-block.loot': [false, true, true],
        [CORE_FEATURE.choices]: [false, false, true], [CORE_FEATURE.chatter]: [false, false, true], [CORE_FEATURE.preroll]: [false, false, true],
    });
    assert.equal(selectedPreset(host.features.list()), 'standard', 'a fresh reader is on Standard (the pre-roll needs a module that keeps checks and is skipped)');
    host.close();
});

test('Story Block\'s own presets through the real store: Lean, Full, Standard and Custom; the outside switches and the story are untouched', async () => {
    const host = await createHost({ settings: { features: { [CORE_FEATURE.extractor]: true, [CORE_FEATURE.hud]: false } } });
    const outside = () => Object.fromEntries([CORE_FEATURE.hud, CORE_FEATURE.cards, CORE_FEATURE.extractor, CORE_FEATURE.inspector, CORE_FEATURE.savepoints, CORE_FEATURE.leanRpg, 'story-block.encumbrance'].map(id => [id, host.sdk.feature(id)]));
    const outsideBefore = outside();
    const storedBefore = { ...host.ctx.extensionSettings.storySuite.features };
    await host.send('Hello.', 'Hi.\n<Changes>\n+ item Rope | qty: 1\n</Changes>');
    const stateBefore = JSON.stringify(host.store.head());

    host.features.applyPreset('lean');
    assert.equal(selectedPreset(host.features.list()), 'lean');
    for (const id of [CORE_FEATURE.weather, CORE_FEATURE.you, CORE_FEATURE.mounts, 'story-block.loot', CORE_FEATURE.choices, CORE_FEATURE.chatter]) assert.equal(host.sdk.feature(id), false, id);
    assert.deepEqual(outside(), outsideBefore);
    host.features.applyPreset('full');
    assert.equal(selectedPreset(host.features.list()), 'full');
    for (const id of [CORE_FEATURE.weather, CORE_FEATURE.you, CORE_FEATURE.mounts, 'story-block.loot', CORE_FEATURE.choices, CORE_FEATURE.chatter]) assert.equal(host.sdk.feature(id), true, id);
    assert.equal(host.sdk.feature(CORE_FEATURE.preroll), false, 'unavailable without a module that keeps checks: left as it is');
    assert.deepEqual(outside(), outsideBefore);
    host.features.applyPreset('standard');
    assert.equal(selectedPreset(host.features.list()), 'standard');
    assert.equal(host.sdk.feature(CORE_FEATURE.choices), false);
    host.features.set(CORE_FEATURE.weather, false);
    assert.equal(selectedPreset(host.features.list()), null, 'Custom');
    // The switches the preset left alone keep what the reader chose, and the story is the same.
    for (const id of Object.keys(storedBefore)) assert.equal(host.ctx.extensionSettings.storySuite.features[id], storedBefore[id], id);
    assert.equal(JSON.stringify(host.store.head()), stateBefore);
    host.close();
});

test('withFeatures: reads as if the switches were so, and leaves nothing behind (not even when the read throws)', () => {
    const { registry, features, root, told } = store();
    const stored = JSON.stringify(root);
    const grammar = () => registry.contexts().flatMap(context => context.kinds.map(kind => kind.grammar));
    assert.deepEqual(grammar(), ['+ note Name']);
    assert.deepEqual(registry.withFeatures({ 'tr.both': false }, grammar), []);
    assert.deepEqual(registry.withFeatures(new Map([['tr.both', false]]), grammar), []);
    assert.equal(registry.withFeatures({ 'tr.full-only': true }, () => registry.featureOn('tr.full-only')), true);
    assert.equal(registry.featureOn('tr.full-only'), false);
    assert.throws(() => registry.withFeatures({ 'tr.both': false }, () => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(grammar(), ['+ note Name'], 'back as it was');
    // Nested: the inner read wins, the outer comes back.
    assert.equal(registry.withFeatures({ 'tr.plain': true }, () => [registry.featureOn('tr.plain'), registry.withFeatures({ 'tr.plain': false }, () => registry.featureOn('tr.plain')), registry.featureOn('tr.plain')].join()), 'true,false,true');
    // An unavailable feature stays off, as in a real read.
    const needy = createRegistry();
    needy.register({ id: 'nd', name: 'N', features: [{ id: 'nd.a', label: 'A', needs: { kinds: ['check'] } }] });
    assert.equal(needy.withFeatures({ 'nd.a': true }, () => needy.featureOn('nd.a')), false);
    assert.equal(JSON.stringify(root), stored, 'nothing stored');
    assert.deepEqual(told, [], 'nothing told');
    assert.deepEqual(features.list().map(feature => feature.on), [true, true, false, true, false]);
});

test('token estimate per preset: the fixed prompt built for that feature set, counted as the footer counts it, without switching anything', async () => {
    const host = await createHost();
    const list = host.features.list();
    const told = [];
    host.events.on('feature', change => told.push(change));
    const text = name => staticTextWith(host.registry, presetSwitches(list, name));
    const tokens = Object.fromEntries(PRESET_NAMES.map(name => [name, estimateTokens(text(name))]));
    assert.ok(tokens.lean > 0 && tokens.lean < tokens.standard && tokens.standard < tokens.full, JSON.stringify(tokens));
    // Standard is today's defaults: the static part the next reply sends right now (the names are filled in there: {{user}} is You).
    await host.send('Hello.', 'Hi.');
    const storedBefore = JSON.stringify(host.ctx.extensionSettings.storySuite);
    const sent = () => host.turn.preview().filter(part => part.place === 'static').map(part => part.text).join('\n\n');
    assert.equal(text('standard').replaceAll('{{user}}', 'You'), sent());
    // Lean has no weather, look, mount, loot, choice or chatter line; Full has the two display lines.
    assert.ok(text('standard').includes('~ weather') && !text('lean').includes('~ weather'));
    assert.ok(!text('standard').includes('? choice') && text('full').includes('? choice'));
    // Nothing moved: the reader's choices, the events, and the real prompt are as before.
    assert.equal(JSON.stringify(host.ctx.extensionSettings.storySuite), storedBefore);
    assert.deepEqual(told, []);
    assert.equal(text('standard').replaceAll('{{user}}', 'You'), sent());
    // A registry that cannot answer leaves the number out.
    assert.equal(staticTextWith({}, new Map()), null);
    assert.equal(staticTextWith(null, new Map()), null);
    assert.equal(staticTextWith({ withFeatures: () => { throw new Error('no'); } }, new Map()), null);
    host.close();
});

test('the pre-roll is part of Full once a module keeps checks, and Lean turns it off again', async () => {
    const CHECKS = { id: 'checks', capture: { kinds: { check: { grammar: '? check skill — what | dc: normal' } }, apply: () => ({ summary: 'checked', narrate: false }) } };
    const host = await createHost({ modules: [CHECKS] });
    assert.equal(host.sdk.feature(CORE_FEATURE.preroll), false);
    host.features.applyPreset('full');
    assert.equal(host.sdk.feature(CORE_FEATURE.preroll), true);
    assert.equal(selectedPreset(host.features.list()), 'full');
    host.features.applyPreset('lean');
    assert.equal(host.sdk.feature(CORE_FEATURE.preroll), false);
    assert.equal(selectedPreset(host.features.list()), 'lean');
    host.close();
});
