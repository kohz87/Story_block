// The `{{sb::path}}` macro (src/v2/sb-macro.js, docs/v2/PUBLIC-API.md): each path family as text, the fallback, hidden values, the cap, lists,
// the registration with SillyTavern's macro API (the engine of 1.19 and the old one), and our own prompt text staying protected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { LEGACY_PATHS, MACRO_MAX, MACRO_NAME, macroText, registerSbMacro } from '../../src/v2/sb-macro.js';
import { defuseMacros } from '../../src/v2/turn.js';
import { character, sheetDomain } from './lean-rpg/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// A fake of SillyTavern 1.19's macro engine: `macros.register(name, options)` keeps the options; `registry` unregisters.
function fakeEngine({ experimental = true, taken = false } = {}) {
    const macros = new Map(taken ? [['sb', { old: true }]] : []);
    const ctx = {
        powerUserSettings: { experimental_macro_engine: experimental },
        macros: {
            register: (name, options) => { macros.set(name, options); return options; },
            registry: { hasMacro: name => macros.has(name), unregisterMacro: name => macros.delete(name) },
        },
    };
    // `{{sb::a::b}}` as the engine hands it over: the unnamed arguments split at `::`.
    ctx.run = raw => macros.get('sb').handler({ args: raw.split('::') });
    ctx.macros_ = macros;
    return ctx;
}

// A host with no core module whose data-module domain holds a Character 'Ren' (RPG blocks) and a plain block `tracker`.
const block = (fields, state = {}) => ({
    id: 'story-block', name: 'Test', version: '0.0.1',
    features: [{ id: 'story-block.rpg', label: 'RPG', describe: 'Test.', default: false }],
    domains: { dataModules: { initial: () => {
        const domain = sheetDomain({ tracker: { fields }, ren: { role: 'character', fields: character('Ren', { level: 3 }) } });
        domain.pins.h0.definition.state = state;
        domain.pins.h0.definition.show = { tab: true, card: false };
        delete domain.pins.h0.definition.role;
        return domain;
    } } },
});

async function world(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ ...options, ...(options.modules ? { core: false } : {}), st: { user: 'Ren', ...(options.st ?? {}) } });
    t.after(() => host.close());
    return host;
}

test('registers one macro, sb, through the macro engine, and takes it out again', { skip }, async t => {
    const host = await world(t);
    const ctx = fakeEngine();
    const handle = registerSbMacro({ ctx, api: host.api });
    assert.equal(handle.engine, 'new');
    assert.deepEqual([...ctx.macros_.keys()], [MACRO_NAME]);
    assert.equal(MACRO_NAME, 'sb');
    const options = ctx.macros_.get('sb');
    assert.equal(options.unnamedArgs[0].name, 'path');
    assert.equal(typeof options.handler, 'function');
    handle.off();
    assert.deepEqual([...ctx.macros_.keys()], []);
    handle.off();   // twice is nothing
});

test('a copy registered before this one is replaced; a context with no macro API gets none', { skip }, async t => {
    const host = await world(t);
    const ctx = fakeEngine({ taken: true });
    registerSbMacro({ ctx, api: host.api });
    assert.equal(ctx.macros_.get('sb').old, undefined);
    assert.equal(registerSbMacro({ ctx: {}, api: host.api }), null);
    assert.equal(registerSbMacro({ ctx: null, api: host.api }), null);
});

test('the old macro engine: one exact name for each path in LEGACY_PATHS, taken out with unregisterMacro', { skip }, async t => {
    const host = await world(t);
    await host.send('Go.', reply('~ place Quay'));
    const legacy = new Map();
    const ctx = { registerMacro: (key, fn) => legacy.set(key, fn), unregisterMacro: key => legacy.delete(key) };
    const handle = registerSbMacro({ ctx, api: host.api });
    assert.equal(handle.engine, 'legacy');
    assert.deepEqual([...legacy.keys()], LEGACY_PATHS.map(path => `sb::${path}`));
    assert.equal(legacy.get('sb::scene.place')(), 'Quay');
    assert.equal(legacy.get('sb::scene.weather')(), '');
    handle.off();
    assert.equal(legacy.size, 0);
    // The engine switched off in a 1.19 that has the new one: the old way.
    const modern = { ...fakeEngine({ experimental: false }), registerMacro: (key, fn) => legacy.set(key, fn), unregisterMacro: key => legacy.delete(key) };
    assert.equal(registerSbMacro({ ctx: modern, api: host.api }).engine, 'legacy');
    assert.equal(modern.macros_.size, 0);
});

test('a registration that throws is logged and leaves nothing behind', { skip }, async t => {
    const host = await world(t);
    const logged = [];
    const ctx = fakeEngine();
    ctx.macros.register = () => { throw new Error('refused'); };
    assert.equal(registerSbMacro({ ctx, api: host.api, log: (...args) => logged.push(args) }), null);
    assert.equal(logged.length, 1);
});

test('each path family reads as text: scene, money, items', { skip }, async t => {
    const host = await world(t, { settings: { modules: { 'story-block': { coins: [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }], currency: 'copper' } } } });
    await host.send('Begin.', 'Opening.');
    assert.equal(macroText(host.api, 'money|none'), '0', 'zero is a value, not an empty one');
    await host.send('Go.', reply('~ place Vell Harbour | kind: settlement', '+ present Ren', '+ present Mara', '+ coin 65', '+ item Healing Draught | qty: 2', '+ item Lamp', '~ weather sea fog'));
    const ctx = fakeEngine();
    registerSbMacro({ ctx, api: host.api });
    assert.equal(ctx.run('scene.place'), 'Vell Harbour');
    assert.equal(ctx.run('scene.place.kind'), 'settlement');
    assert.equal(ctx.run('scene.weather'), 'sea fog');
    assert.equal(ctx.run('scene.present'), 'Ren, Mara', 'a list is a comma list');
    assert.equal(ctx.run('money'), '65');
    assert.equal(ctx.run('money.text'), '6 silver 5 copper');
    assert.equal(ctx.run('items.Healing Draught.qty'), '2');
    assert.equal(ctx.run('items'), 'Healing Draught x2, Lamp x1');
    assert.equal(ctx.run('  scene.place  '), 'Vell Harbour', 'the path is trimmed');
});

test('each path family reads as text: party, blocks', { skip }, async t => {
    const host = await world(t, { settings: { features: { 'story-block.rpg': true } },
        modules: [block({ hope: 4, title: 'The Lamp-lighter' }, { hope: { type: 'int', min: 0, max: 9, default: 3 }, title: { type: 'text', max: 40, default: '' } })] });
    await host.send('Go.', 'Opening.');
    const ctx = fakeEngine();
    registerSbMacro({ ctx, api: host.api });
    assert.equal(ctx.run('party.me.level'), '3');
    assert.equal(ctx.run('party.me.health'), 'Unhurt');
    assert.equal(ctx.run('party.Ren.stats.str'), '14');
    assert.equal(ctx.run('party'), 'Ren');
    assert.equal(ctx.run('blocks.pack.chat/tracker.hope'), '4');
    assert.equal(ctx.run('blocks.pack.chat/tracker.title'), 'The Lamp-lighter');
});

test('{{sb::path|fallback}}: the fallback for a path that is missing, empty, hidden or an object; nothing without one', { skip }, async t => {
    const state = { open: { type: 'int', min: 0, max: 9, default: 1 }, secret: { type: 'int', min: 0, max: 9, default: 1, prompt: false }, notes: { type: 'map', keys: ['a'], values: { type: 'int', min: 0, max: 5 } } };
    const host = await world(t, { modules: [block({ open: 2, secret: 7, notes: { a: 1 } }, state)] });
    await host.send('Go.', 'Opening.');
    const ctx = fakeEngine();
    registerSbMacro({ ctx, api: host.api });
    assert.equal(ctx.run('scene.place|nowhere'), 'nowhere', 'empty');
    assert.equal(ctx.run('scene.place'), '', 'empty, no fallback');
    assert.equal(ctx.run('nothing.here|none'), 'none', 'not a path');
    assert.equal(ctx.run('party.me.level|no party'), 'no party', 'RPG off');
    assert.equal(ctx.run('blocks.pack.chat/tracker.secret|hidden'), 'hidden', 'a hidden field');
    assert.equal(ctx.run('blocks.pack.chat/tracker.secret'), '');
    assert.equal(ctx.run('blocks.pack.chat/tracker.open|x'), '2');
    assert.equal(ctx.run('blocks.pack.chat/tracker.notes|object'), 'object', 'an object has no text');
    assert.equal(ctx.run('blocks.pack.chat/tracker.notes.a|x'), '1');
    assert.equal(ctx.run('money|no purse'), 'no purse', 'no inventory in this chat');
    assert.equal(ctx.run('scene.place|a|b'), 'a|b', 'only the first bar splits');
    assert.equal(ctx.run('scene.place|one::two'), 'one::two', 'a fallback with :: in it is whole');
    assert.equal(ctx.run('scene.place|'), '');
    assert.ok(!ctx.run('blocks.pack.chat/tracker.secret|hidden').includes('7'));
});

test('{{sb::path::fallback}} is the safe form of the fallback, and | still works', { skip }, async t => {
    const host = await world(t);
    await host.send('Go.', 'Opening.');
    const ctx = fakeEngine();
    registerSbMacro({ ctx, api: host.api });
    assert.equal(ctx.run('scene.place::nowhere'), 'nowhere');
    assert.equal(ctx.run('scene.place::a::b'), 'a::b');
    assert.equal(ctx.run('scene.place|nowhere'), 'nowhere');
    assert.equal(ctx.run('scene.place::a|b'), 'a|b');
    assert.equal(ctx.run('money::none'), '0');
    assert.equal(macroText(host.api, 'scene.place::'), '');
});

test('a macro engine that returns null (it refused) is told once and the old way is used', { skip }, async t => {
    const host = await world(t);
    const logged = [];
    const legacy = new Map();
    const ctx = { ...fakeEngine(), registerMacro: (key, fn) => legacy.set(key, fn), unregisterMacro: key => legacy.delete(key) };
    ctx.macros.register = () => null;
    const handle = registerSbMacro({ ctx, api: host.api, log: (...args) => logged.push(args) });
    assert.equal(handle.engine, 'legacy');
    assert.equal(legacy.size, LEGACY_PATHS.length);
    assert.equal(logged.length, 1);
    const none = { ...fakeEngine() };
    none.macros.register = () => null;
    assert.equal(registerSbMacro({ ctx: none, api: host.api, log: () => {} }), null, 'no old API either: nothing is registered');
});

test('output: cut at 300 characters, line breaks turned into spaces, {{ in a value written with a zero-width space', { skip }, async t => {
    const state = { text: { type: 'text', max: 600, default: '' } };
    const long = 'word '.repeat(100).trim();
    const host = await world(t, { modules: [block({ text: `${long}\nsecond line\r\nthird {{user}} <USER>` }, state)] });
    await host.send('Go.', 'Opening.');
    const out = macroText(host.api, 'blocks.pack.chat/tracker.text');
    assert.equal(MACRO_MAX, 300);
    assert.equal(out.length, 300);
    const braces = await world(t, { modules: [block({ text: '{{'.repeat(200) }, state)] });
    await braces.send('Go.', 'Opening.');
    assert.ok(macroText(braces.api, 'blocks.pack.chat/tracker.text').length <= MACRO_MAX, 'defusing adds characters, the cut comes after');
    assert.ok(!macroText(braces.api, 'blocks.pack.chat/tracker.text').includes('{{'));
    assert.ok(out.startsWith('word word word'));
    assert.ok(!/[\r\n]/.test(out));
    const short = await world(t, { modules: [block({ text: 'one\ntwo\r\n\r\nthree {{user}} and <USER>' }, state)] });
    await short.send('Go.', 'Opening.');
    const text = macroText(short.api, 'blocks.pack.chat/tracker.text');
    assert.equal(text, 'one two three {​{user}} and <​USER>');
    assert.ok(!text.includes('{{'));
    assert.equal(text, defuseMacros('one two three {{user}} and <USER>'));
});

test('our own prompt text stays protected: a macro written into a name the story introduced is not run', { skip }, async t => {
    const host = await world(t);
    await host.send('Go.', reply('~ place Quay {{sb::money}}', '+ item Lamp {{sb::scene.place}}'));
    await host.send('Next.', 'On.');
    const sent = host.st.promptLog.filter(entry => entry.value).map(entry => entry.value).join('\n');
    assert.ok(sent.includes('Quay'), 'the name is in the prompt');
    assert.ok(!/\{\{sb::/.test(sent), 'no live {{sb::…}} reaches the prompt');
    assert.ok(sent.includes('{\u200b{sb::money}}'), 'it is there as text');
    assert.equal(defuseMacros('{{sb::scene.place|x}}'), '{\u200b{sb::scene.place|x}}');
});

test('a chat without state, or a path the api cannot read, is the fallback and never throws', { skip }, async t => {
    const host = await world(t);
    const ctx = fakeEngine();
    registerSbMacro({ ctx, api: host.api });
    assert.equal(ctx.run('scene.place|none'), 'none');
    assert.equal(macroText({ get: () => { throw new Error('x'); } }, 'a|b'), 'b');
    assert.equal(macroText({ get: () => undefined }, undefined), '');
    assert.equal(ctx.macros_.get('sb').handler({ args: undefined }), '');
});
