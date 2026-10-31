// Features (MODULES §F100, SPEC §6): a module's optional mechanics as reader switches. Checked here:
// the definition rules, "off means fully off" (no grammar, no context, commands refused with FEATURE_OFF,
// queries null, hooks skipped, screens, tabs and widgets left out, a line told quietly), the state kept
// and back on the switch, the static prompt part byte-identical between toggles and changed exactly once
// by one, unknown feature ids, and Story Block's own features (with the switches they replace).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { createRegistry, definitionProblems, definitionWarnings } from '../../src/v2/registry.js';
import { CORE_FEATURE, FEATURE_OFF, createFeatureStore } from '../../src/v2/features.js';
import { refusedFrom } from '../../src/v2/reply-notes.js';
import { STATIC_KEY, TAIL_KEY } from '../../src/v2/turn.js';

const WEAR_GRAMMAR = '~ wear Item | wear: worn|broken';
const WEAR_STATIC = 'Gear wears out: write a wear line when an item is damaged.';
const WEATHER_LINE = 'Weather: rain.';
const BASE_STATIC = 'Gear keeps what the party carries.';

// A module with three features: `gear.wear` (a kind and a static context part, so it changes the static
// prompt), `gear.weather` (a tail part only; off by default) and `gear.extras` (a command, a query, hooks,
// a tab, a screen and a widget).
function gear({ hooks = {} } = {}) {
    const lookAt = (state, args) => ({ wear: state.domains.gear.wear[args?.item] ?? null });
    lookAt.feature = 'gear.extras';
    const beforeGenerate = () => ['Gear note: extras on.'];
    beforeGenerate.feature = 'gear.extras';
    const canGenerate = () => (hooks.block ? { ok: false, reason: 'Extras say wait.' } : true);
    canGenerate.feature = 'gear.extras';
    return {
        id: 'gear',
        name: 'Gear',
        version: '0.0.1',
        features: [
            { id: 'gear.wear', label: 'Wear', describe: 'Items wear out and break.', default: true },
            { id: 'gear.weather', label: 'Weather', describe: 'A weather line each reply.', default: false },
            { id: 'gear.extras', label: 'Extras', describe: 'A command, a query, a tab and more.' },
        ],
        domains: { gear: { initial: () => ({ wear: {}, polished: 0 }) } },
        commands: {
            'gear.polish': { handler: ctx => { ctx.draft('gear').polished += 1; return { summary: 'Polished.', narrate: false }; }, feature: 'gear.extras' },
            'gear.count': ctx => ({ summary: `${ctx.read('gear').polished}`, narrate: false }),
            // Calls the off command and carries on without it (nothing ran, so this is allowed).
            'gear.try': ctx => {
                let code = null;
                try { ctx.call('gear.polish', {}); } catch (error) { code = error.code; }
                return { summary: 'Tried.', narrate: false, data: { code, extras: ctx.feature('gear.extras'), unknown: ctx.feature('nope.thing') } };
            },
        },
        queries: { 'gear.look': lookAt, 'gear.all': state => state.domains.gear.wear },
        capture: {
            kinds: {
                wear: { grammar: WEAR_GRAMMAR, feature: 'gear.wear' },
                gear: { grammar: '+ gear Item' },
            },
            apply(ctx, line) {
                const draft = ctx.draft('gear');
                if (line.kind === 'wear') draft.wear[line.name] = line.labels?.wear ?? 'worn';
                return { summary: `${line.name}: ${line.kind}`, narrate: false };
            },
        },
        context: {
            static: () => BASE_STATIC,
            tail: view => ({ lines: [`Gear: ${Object.keys(view.state.domains.gear?.wear ?? {}).length} worn.`], optional: [] }),
            parts: [
                { feature: 'gear.wear', static: () => WEAR_STATIC, tail: view => ({ lines: Object.entries(view.state.domains.gear?.wear ?? {}).map(([name, wear]) => `${name} is ${wear}.`) }) },
                { feature: 'gear.weather', tail: () => ({ lines: [WEATHER_LINE] }) },
            ],
            budget: 200,
        },
        hooks: { beforeGenerate, canGenerate },
        tabs: [{ id: 'gear-tab', title: 'Gear', render: el => { el.textContent = 'gear'; }, feature: 'gear.extras' }],
        screens: [
            { id: 'gear/extras', title: 'Extras', mounts: ['tab'], template: '<p>extras</p>', feature: 'gear.extras' },
            { id: 'gear/always', title: 'Always', mounts: ['tab'], template: '<p>always</p>' },
        ],
        widgets: { 'gear.badge': { render: () => null, feature: 'gear.extras' }, 'gear.plain': { render: () => null } },
    };
}

const statics = host => host.st.promptLog.filter(entry => entry.key === STATIC_KEY && entry.value).map(entry => entry.value);
const tails = host => host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).map(entry => entry.value);

// ---------------------------------------------------------------------------------------------------
// The definition

test('features: a well-formed list registers, and its lookups describe each feature', () => {
    assert.deepEqual(definitionProblems(gear()), []);
    assert.deepEqual(definitionWarnings(gear()), []);
    const registry = createRegistry();
    registry.register(gear());
    assert.deepEqual(registry.features().map(feature => [feature.id, feature.default, feature.prompt]), [
        ['gear.wear', true, true],          // owns a kind and a static part: changes the fixed prompt
        ['gear.weather', false, false],
        ['gear.extras', true, false],       // no default given: on
    ]);
    assert.deepEqual(registry.feature('gear.weather'), {
        id: 'gear.weather', moduleId: 'gear', moduleName: 'Gear', label: 'Weather', describe: 'A weather line each reply.', default: false, prompt: false,
        needs: { kinds: [], commands: [], queries: [], why: 'Needs a module that is not installed.' }, available: true, why: '',
    });
    assert.equal(registry.feature('gear.nope'), null);
    assert.equal(registry.featureOn('gear.wear'), true);
    assert.equal(registry.featureOn('gear.weather'), false);
    assert.equal(registry.commandFeature('gear.polish'), 'gear.extras');
    assert.equal(registry.commandFeature('capture.wear'), 'gear.wear');
    assert.equal(registry.commandFeature('gear.count'), null);
    // `prompt: true` marks a feature whose own code changes the static text.
    const marked = createRegistry();
    marked.register({ id: 'mark', features: [{ id: 'mark.x', label: 'X', prompt: true }] });
    assert.equal(marked.feature('mark.x').prompt, true);
});

test('features: every mistake is refused with a plain sentence, and nothing of the module is kept', () => {
    const cases = [
        [{ features: {} }, /features is not a list/],
        [{ features: ['wear'] }, /feature 1 is not an object/],
        [{ features: [{ id: 'wear', label: 'Wear' }] }, /needs an id made of the module id, a dot and a lowercase name \(like "bad\.wear"\)/],
        [{ features: [{ id: 'other.wear', label: 'Wear' }] }, /needs an id made of the module id/],
        [{ features: [{ id: 'bad.Wear', label: 'Wear' }] }, /needs an id made of the module id/],
        [{ features: [{ id: 'bad.wear', label: 'Wear' }, { id: 'bad.wear', label: 'Again' }] }, /the feature "bad\.wear" is named twice/],
        [{ features: [{ id: 'bad.wear' }] }, /the feature "bad\.wear" has no label/],
        [{ features: [{ id: 'bad.wear', label: 'x'.repeat(61) }] }, /label longer than 60 characters/],
        [{ features: [{ id: 'bad.wear', label: 'Wear', describe: 3 }] }, /describe is not text/],
        [{ features: [{ id: 'bad.wear', label: 'Wear', default: 'yes' }] }, /default is not true or false/],
        [{ features: [{ id: 'bad.wear', label: 'Wear', prompt: 1 }] }, /prompt is not true or false/],
        [{ capture: { kinds: { wear: { grammar: '~ wear X', feature: 'bad.wear' } }, apply: () => ({}) } }, /the capture kind "wear" names the feature "bad\.wear", which is not one of this module's features/],
        [{ features: [{ id: 'bad.wear', label: 'Wear' }], commands: { 'bad.go': { handler: () => ({}), feature: 'bad.other' } } }, /the command "bad\.go" names the feature "bad\.other"/],
        [{ features: [{ id: 'bad.wear', label: 'Wear' }], queries: { 'bad.q': Object.assign(() => 1, { feature: 7 }) } }, /the query "bad\.q" has a feature that is not text/],
        [{ context: { parts: {} } }, /context\.parts is not a list/],
        [{ context: { parts: [{}] } }, /context part 1 has neither static nor tail/],
        [{ context: { parts: [{ static: 'text' }] } }, /context part 1 static is not a function/],
        [{ tabs: [{ id: 't', title: 'T', render: () => {}, feature: 'gear.extras' }] }, /the tab "t" names the feature "gear\.extras", which is not one of this module's features/],
    ];
    for (const [extra, pattern] of cases) {
        const def = { id: 'bad', name: 'Bad', ...extra };
        assert.ok(definitionProblems(def).some(problem => pattern.test(problem)), `${JSON.stringify(extra)} → ${definitionProblems(def).join(' | ')}`);
        const registry = createRegistry();
        assert.throws(() => registry.register(def), /the module "bad" cannot be registered/);
        assert.equal(registry.has('bad'), false);
        assert.deepEqual(registry.features(), []);
    }
});

test('features: a newer feature field or context field is warned about and ignored', () => {
    const messages = [];
    const registry = createRegistry({ warn: message => messages.push(message) });
    registry.register({ id: 'fut', name: 'Future', features: [{ id: 'fut.a', label: 'A', colour: 'red' }], context: { static: () => 'x', layers: [] } });
    assert.deepEqual(messages, [
        'Future: "context.layers" is not a context field this Story Block knows; it is ignored.',
        'Future: "colour" on feature "fut.a" is not a feature field this Story Block knows; it is ignored.',
    ]);
    assert.equal(registry.featureOn('fut.a'), true);
});

test('a module without features is as before: every lookup, static and tail unchanged', async () => {
    const plain = { ...gear(), id: 'plain', features: undefined, commands: { 'plain.go': () => ({ summary: 'go' }) }, queries: { 'plain.q': () => 1 }, hooks: {}, tabs: [], screens: [], widgets: {} };
    plain.capture = { kinds: { wear: { grammar: WEAR_GRAMMAR } }, apply: () => ({ summary: 'ok', narrate: false }) };
    plain.context = { static: () => BASE_STATIC, tail: () => ({ lines: ['Plain.'] }) };
    const registry = createRegistry();
    registry.register(plain);
    const [context] = registry.contexts();
    assert.deepEqual(context.kinds, [{ kind: 'wear', grammar: WEAR_GRAMMAR }]);
    assert.equal(context.static, plain.context.static, 'the very same function');
    assert.equal(context.tail, plain.context.tail);
    assert.equal(registry.capture('wear').off, false);
    assert.equal(registry.capture('wear').feature, null);
    assert.equal(registry.query('plain.q')(), 1);
    assert.deepEqual(registry.features(), []);
});

// ---------------------------------------------------------------------------------------------------
// Off means fully off

test('an off feature has no grammar, no context, no commands, no queries, no hooks and no screens', async () => {
    const host = await createHost({ modules: [gear()] });
    await host.send('Hello.', 'Hi.\n<Changes>\n~ wear Sword | wear: worn\n</Changes>');
    const onStatic = statics(host).at(-1);
    assert.ok(onStatic.includes(WEAR_GRAMMAR) && onStatic.includes(WEAR_STATIC) && onStatic.includes(BASE_STATIC));
    assert.equal(host.sdk.feature('gear.wear'), true);
    assert.equal(host.sdk.feature('gear.extras'), true);

    assert.equal(host.features.set('gear.wear', false), false);
    assert.equal(host.features.set('gear.extras', false), false);
    assert.equal(host.sdk.feature('gear.wear'), false);
    assert.equal(host.sdk.view().feature('gear.extras'), false);
    // The registry's lookups leave them out.
    const context = host.registry.contexts().find(item => item.moduleId === 'gear');
    assert.deepEqual(context.kinds.map(kind => kind.kind), ['gear']);
    assert.deepEqual(host.registry.hookEntries('beforeGenerate').filter(entry => entry.moduleId === 'gear'), []);
    assert.deepEqual(host.registry.hookEntries('canGenerate').filter(entry => entry.moduleId === 'gear'), []);
    assert.deepEqual(host.registry.tabs().filter(tab => tab.moduleId === 'gear'), []);
    assert.deepEqual(host.registry.screens().filter(screen => screen.moduleId === 'gear').map(screen => screen.id), ['gear/always']);
    assert.equal(host.registry.screenOff('gear/extras'), true);
    assert.equal(host.registry.screenOff('gear/always'), false);
    assert.deepEqual(host.registry.widgets().filter(widget => widget.moduleId === 'gear').map(widget => widget.name), ['gear.plain']);
    assert.equal(host.registry.widget('gear.badge'), null);
    assert.deepEqual(host.registry.widgetsOff(), ['gear.badge']);
    assert.equal(host.registry.capture('wear').off, true);

    // Commands: FEATURE_OFF at the top and through ctx.call (catchable: nothing ran).
    const top = await host.sdk.command('gear.polish', {});
    assert.equal(top.ok, false);
    assert.equal(top.code, FEATURE_OFF);
    assert.equal(top.message, '"gear.polish" is part of Extras, which is turned off in the Features settings.');
    const tried = await host.sdk.command('gear.try', {});
    assert.equal(tried.ok, true);
    assert.deepEqual(tried.receipt.data, { code: FEATURE_OFF, extras: false, unknown: false });
    assert.equal(host.bus.run('capture.wear', { kind: 'wear', name: 'Axe' }, { cause: 'story' }).code, FEATURE_OFF);
    // Queries answer null, wherever they are asked.
    assert.equal(host.sdk.query('gear.look', { item: 'Sword' }), null);
    assert.equal(host.sdk.view().query('gear.look', { item: 'Sword' }), null);
    assert.deepEqual(host.sdk.query('gear.all'), { Sword: 'worn' }, 'a query of no feature still answers');

    // The next reply: no grammar or static part, no tail, no hook lines; a wear line is told quietly.
    const warned = [];
    const warn = console.warn;
    console.warn = (...args) => warned.push(args.join(' '));
    try {
        await host.send('Again.', 'Fine.\n<Changes>\n~ wear Shield | wear: broken\n+ gear Rope\n</Changes>');
    } finally { console.warn = warn; }
    const offStatic = statics(host).at(-1);
    assert.ok(!offStatic.includes(WEAR_GRAMMAR) && !offStatic.includes(WEAR_STATIC) && offStatic.includes(BASE_STATIC));
    const offTail = tails(host).at(-1);
    assert.ok(!offTail.includes('Sword is worn.') && !offTail.includes('Gear note: extras on.') && offTail.includes('Gear: 1 worn.'), offTail);
    const quiet = host.turn.problems('gear').filter(problem => problem.code === FEATURE_OFF);
    assert.deepEqual(quiet.map(problem => problem.message), ['"~ wear Shield | wear: broken" was not used: Wear is turned off (feature off).']);
    assert.equal(quiet[0].quiet, true);
    assert.equal(warned.filter(text => text.includes('Shield')).length, 0, 'not warned about');
    assert.deepEqual(refusedFrom(quiet, quiet[0].index), [], 'not a refused line on the card');
    assert.equal(host.head().domains.gear.wear.Shield, undefined);
    host.close();
});

test('an off feature\'s canGenerate hook does not hold the story back', async () => {
    const host = await createHost({ modules: [gear({ hooks: { block: true } })] });
    let out = await host.send('Wait?', 'Never.');
    assert.equal(out.aborted, true);
    host.features.set('gear.extras', false);
    out = await host.send('Now?', 'Yes.');
    assert.notEqual(out.aborted, true);
    host.close();
});

test('an off feature\'s state is kept as it was, and switching it back on brings it all back', async () => {
    const host = await createHost({ modules: [gear()] });
    await host.send('Hello.', 'Hi.\n<Changes>\n~ wear Sword | wear: worn\n</Changes>');
    assert.equal((await host.sdk.command('gear.polish', {})).ok, true);
    const before = structuredClone(host.head().domains.gear);
    host.features.set('gear.wear', false);
    host.features.set('gear.extras', false);
    await host.send('On we go.', 'More.\n<Changes>\n~ wear Sword | wear: broken\n</Changes>');
    await host.send('And on.', 'Still more.');
    assert.deepEqual(host.head().domains.gear, before, 'nothing of it changed while off');
    // Back on: the query, the command, the grammar and the lines are there again, on the same state.
    host.features.set('gear.wear', true);
    host.features.set('gear.extras', true);
    assert.deepEqual(host.sdk.query('gear.look', { item: 'Sword' }), { wear: 'worn' });
    assert.equal((await host.sdk.command('gear.polish', {})).ok, true);
    assert.equal(host.head().domains.gear.polished, 2);
    await host.send('Back.', 'Yes.\n<Changes>\n~ wear Sword | wear: broken\n</Changes>');
    assert.equal(host.head().domains.gear.wear.Sword, 'broken');
    assert.ok(statics(host).at(-1).includes(WEAR_GRAMMAR));
    assert.ok(tails(host).at(-1).includes('Sword is worn.'));
    host.close();
});

test('an off-by-default feature is off until the reader turns it on (a tail part)', async () => {
    const host = await createHost({ modules: [gear()] });
    await host.send('Hello.', 'Hi.');
    assert.ok(!tails(host).at(-1).includes(WEATHER_LINE));
    host.features.set('gear.weather', true);
    await host.send('Again.', 'Hi.');
    assert.ok(tails(host).at(-1).includes(WEATHER_LINE));
    host.close();
});

// ---------------------------------------------------------------------------------------------------
// The static prompt part

test('the static part is byte-identical reply after reply, and a toggle changes it exactly once', async () => {
    const host = await createHost({ modules: [gear()] });
    const lines = ['~ wear Sword | wear: worn', '+ item Rope | qty: 1', '~ wear Axe | wear: broken', '+ coin 5 | from: a merchant'];
    for (const [n, line] of lines.entries()) await host.send(`Turn ${n}.`, `Reply ${n}.\n<Changes>\n${line}\n</Changes>`);
    const first = statics(host);
    assert.equal(first.length, lines.length);
    assert.equal(new Set(first).size, 1, 'one text for every reply, whatever the state');

    // A feature that does not touch the static part: turned on and off, the text stays the same bytes.
    host.features.set('gear.weather', true);
    host.features.set('gear.extras', false);
    await host.send('Weather?', 'Rain.');
    assert.equal(statics(host).at(-1), first[0]);

    // One that does: the next reply has a new text, and every reply after it the same new text.
    host.features.set('gear.wear', false);
    for (let n = 0; n < 3; n += 1) await host.send(`Off ${n}.`, `Off reply ${n}.\n<Changes>\n+ item Stone | qty: 1\n</Changes>`);
    const all = statics(host);
    const changes = all.filter((text, i) => i > 0 && text !== all[i - 1]).length;
    assert.equal(changes, 1, 'changed exactly once');
    assert.notEqual(all.at(-1), first[0]);
    assert.equal(new Set(all.slice(-3)).size, 1);

    // Setting a feature to the value it has changes nothing; turning it back on gives the old bytes.
    host.features.set('gear.wear', false);
    host.features.set('gear.wear', true);
    await host.send('On.', 'On again.');
    assert.equal(statics(host).at(-1), first[0]);
    // The overlay's hint is shown for this feature only.
    // (and Story Block's loot, weather and RPG, whose capture kinds are grammar lines: the RPG's is the `+ party` line)
    assert.deepEqual(host.features.list().filter(feature => feature.prompt).map(feature => feature.id), ['gear.wear', 'story-block.choices', 'story-block.chatter', 'story-block.weather', 'story-block.rpg', 'story-block.loot']);
    host.close();
});

// ---------------------------------------------------------------------------------------------------
// Unknown ids, storage, the change event

test('unknown feature ids: off everywhere, cannot be set, and a stored choice for one is kept', async () => {
    const host = await createHost({ modules: [gear()], settings: { features: { 'gone.module': false, 'gear.weather': true } } });
    assert.equal(host.sdk.feature('nope.thing'), false);
    assert.equal(host.sdk.feature(undefined), false);
    assert.equal(host.sdk.view().feature('nope.thing'), false);
    assert.equal(host.registry.featureOn('gear'), false);
    assert.equal(host.features.set('nope.thing', true), undefined);
    assert.equal(Object.hasOwn(host.ctx.extensionSettings.storySuite.features, 'nope.thing'), false);
    assert.equal(host.ctx.extensionSettings.storySuite.features['gone.module'], false, 'kept for when it comes back');
    assert.equal(host.sdk.feature('gear.weather'), true, 'the stored choice beats the default');
    // A value that is not true or false is no choice: the default holds.
    host.ctx.extensionSettings.storySuite.features['gear.wear'] = 'off';
    assert.equal(host.sdk.feature('gear.wear'), true);
    host.close();
});

test('choices are the reader\'s (extension settings, saved), told by the `feature` event, and listed by the sdk', async () => {
    const host = await createHost({ modules: [gear()] });
    const seen = [];
    host.sdk.on('feature', change => seen.push(change));
    const saves = host.st.settingsSaves;
    host.features.set('gear.wear', false);
    host.features.set('gear.wear', false);   // no change: no event
    host.features.set('gear.extras', false);
    assert.deepEqual(seen, [{ id: 'gear.wear', on: false, prompt: true }, { id: 'gear.extras', on: false, prompt: false }]);
    assert.ok(host.st.settingsSaves > saves);
    assert.deepEqual(host.ctx.extensionSettings.storySuite.features, { 'gear.wear': false, 'gear.extras': false });
    assert.deepEqual(host.sdk.features().filter(feature => feature.moduleId === 'gear').map(feature => [feature.id, feature.on]), [
        ['gear.wear', false], ['gear.weather', false], ['gear.extras', false],
    ]);
    assert.deepEqual(host.sdk.modules().find(module => module.id === 'gear').features, ['gear.wear', 'gear.weather', 'gear.extras']);
    host.close();
});

test('the feature store works on its own over any settings root', () => {
    const registry = createRegistry({ featureValue: id => store.stored(id) });
    const root = {};
    const store = createFeatureStore({ root: () => root, registry });
    registry.register(gear());
    assert.equal(store.on('gear.weather'), false);
    assert.equal(store.set('gear.weather', 1), true);
    assert.equal(root.storySuite.features['gear.weather'], true);
    assert.equal(createFeatureStore({ root: () => null, registry }).stored('gear.weather'), undefined);
});

// ---------------------------------------------------------------------------------------------------
// Story Block's own features

// A module that keeps `? check` lines, so the pre-roll has something to roll for.
const CHECKS = { id: 'checks', capture: { kinds: { check: { grammar: '? check skill — what | dc: normal' } }, apply: () => ({ summary: 'checked', narrate: false }) } };

test('needs: a feature is unavailable (off, its choice kept) until a module registers what it needs', async () => {
    const host = await createHost({ settings: { features: { [CORE_FEATURE.preroll]: true } } });
    assert.equal(host.sdk.feature(CORE_FEATURE.preroll), false, 'off without a module that keeps checks');
    const [preroll] = host.sdk.features().filter(feature => feature.id === CORE_FEATURE.preroll);
    assert.equal(preroll.available, false);
    assert.equal(preroll.why, 'Needs a module that keeps checks, like Story Director.');
    assert.equal(host.sdk.query('assist.status').classifier.on, false);
    await host.sdk.registerModule(CHECKS);
    assert.equal(host.sdk.feature(CORE_FEATURE.preroll), true, 'the reader\'s choice, kept, now counts');
    assert.equal(host.sdk.features().find(feature => feature.id === CORE_FEATURE.preroll).why, '');
    // Commands and queries can be needed too; a wrong `needs` is refused, an unknown key in it warned.
    const registry = createRegistry({ warn: () => {} });
    registry.register({ id: 'n', features: [{ id: 'n.a', label: 'A', needs: { commands: ['x.go'], queries: ['x.q'] } }] });
    assert.equal(registry.featureOn('n.a'), false);
    registry.register({ id: 'x', commands: { 'x.go': () => ({}) }, queries: { 'x.q': () => 1 } });
    assert.equal(registry.featureOn('n.a'), true);
    assert.ok(definitionProblems({ id: 'm', features: [{ id: 'm.a', label: 'A', needs: { kinds: 'check' } }] }).some(p => /needs\.kinds is not a list of names/.test(p)));
    assert.ok(definitionProblems({ id: 'm', features: [{ id: 'm.a', label: 'A', needs: { why: 'x'.repeat(121) } }] }).some(p => /needs\.why is not text of at most 120/.test(p)));
    assert.deepEqual(definitionWarnings({ id: 'm', features: [{ id: 'm.a', label: 'A', needs: { modules: ['x'] } }] }), ['"needs.modules" on feature "m.a" is not a needs field this Story Block knows; it is ignored']);
    host.close();
});

test('Story Block\'s own features: the status strip, the cards, the two assist helpers, the inspector and save points', async () => {
    const host = await createHost();
    assert.deepEqual(host.sdk.features().map(feature => [feature.id, feature.on, feature.prompt, feature.available]), [
        [CORE_FEATURE.hud, true, false, true], [CORE_FEATURE.cards, true, false, true], [CORE_FEATURE.preroll, false, false, false], [CORE_FEATURE.extractor, false, false, true],
        [CORE_FEATURE.inspector, false, false, true], [CORE_FEATURE.savepoints, true, false, true],
        [CORE_FEATURE.choices, false, true, true], [CORE_FEATURE.chatter, false, true, true], [CORE_FEATURE.weather, true, true, true], [CORE_FEATURE.leanRpg, false, true, true],
        ['story-block.loot', true, true, true], ['story-block.encumbrance', true, false, true],
    ]);
    host.close();
    // The switches older versions kept are the choice until the reader touches the feature. (The
    // pre-roll needs a module that keeps checks.)
    const old = await createHost({ modules: [CHECKS], settings: { hud: false, modules: { 'story-block': { assistClassifier: true, assistExtractor: true } } } });
    assert.equal(old.sdk.feature(CORE_FEATURE.hud), false);
    assert.equal(old.sdk.feature(CORE_FEATURE.preroll), true);
    assert.equal(old.sdk.feature(CORE_FEATURE.extractor), true);
    old.features.set(CORE_FEATURE.extractor, false);
    assert.equal(old.sdk.feature(CORE_FEATURE.extractor), false);
    assert.equal(old.sdk.query('assist.status').extractor.on, false, 'the helper follows the feature');
    assert.equal(old.sdk.query('assist.status').classifier.on, true);
    old.close();
});

test('the extractor runs only while its feature is on', async () => {
    const calls = [];
    const callModel = async prompt => { calls.push(prompt); return '+ item Rope | qty: 1'; };
    const host = await createHost({ callModel });
    await host.send('hi', 'You find a rope.');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.length, 0, 'off by default');
    host.features.set(CORE_FEATURE.extractor, true);
    await host.send('more', 'You find another rope.');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.length, 1);
    host.close();
});
