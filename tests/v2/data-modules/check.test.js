import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { contentOf } from '../../../src/v2/packs/content.js';
import { HOST_CAPABILITIES } from '../../../src/v2/packs/limits.js';
import { validatePack as oldValidatePack } from '../packs/fixtures/old-host/validate.js';
import { validateDataModules, validateDataMigration, dataModuleDefaults, dataModuleHash,
    DM_LIMITS as L, DM_DESCRIPTORS as D, DM_DIAGNOSTICS } from '../../../src/v2/data-modules/check.js';
import * as packsApi from '../../../src/v2/packs/index.js';

const read = name => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
const integer = (min = 0, max = 100, value = 0) => ({ type: 'int', min, max, default: value });
const change = () => ({ op: 'add', path: ['points'], value: 1, bounds: 'clamp' });
const definition = () => ({ slug: 'counter', name: 'Counter', schema: 1, stateVersion: 1, scope: 'chat',
    state: { points: integer() }, kinds: { gain: { op: '+', labels: {}, effects: [change()] } } });
const pack = (definitions = [definition()]) => ({ id: 'dm-test', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['data-modules-v1'] }, content: { dataModules: definitions } });
const ok = value => {
    const checked = validatePack(value);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    return checked;
};
const refuse = (value, code = 'DM_SCHEMA', path) => {
    const result = validatePack(value);
    assert.equal(result.ok, false, JSON.stringify(value));
    assert.ok(result.errors.length <= 20);
    const found = result.errors.find(e => e.code === code && (path === undefined || e.path === path));
    assert.ok(found, `Expected ${code} ${path ?? ''}: ${JSON.stringify(result.errors)}`);
    return found;
};
const edit = fn => { const d = definition(); fn(d); return pack([d]); };
const set = (value, path, next) => { let cursor = value; for (const key of path.slice(0, -1)) cursor = cursor[key]; cursor[path.at(-1)] = structuredClone(next); };
const reward = () => ({ bindings: {}, values: { amount: { min: 1, max: 5, pick: 'midpoint' } }, effects: [{ ...change(), value: ['reward', 'amount'] }] });
const timer = () => ({ id: 'clock', clock: 'clock', every: 60, effects: [{ ...change(), value: ['mul', ['timer', 'periods'], 2] }] });
const clock = () => ({ query: 'director.time', mode: 'prefix', projection: ['minutes'] });

for (const name of ['reputation', 'survival']) test(`worked example ${name} is the exact complete JSON from the approved spec`, () => {
    const doc = readFileSync(new URL('../../../docs/v2/DATA_MODULES.md', import.meta.url), 'utf8');
    const examples = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
    const input = read(name);
    const installable = readFileSync(new URL(`../../../examples/packs/${input.id}/pack.json`, import.meta.url), 'utf8');
    assert.deepEqual(JSON.parse(installable), input, 'the installable pack matches the worked example');
    const installed = validatePack(installable, { capabilities: ['data-modules-v1', 'story-director'] });
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    assert.deepEqual(input, examples.find(p => p.id === input.id));
    const before = JSON.stringify(input);
    const result = ok(input);
    assert.equal(JSON.stringify(input), before, 'the caller is untouched');
    assert.deepEqual(result.raw, input, 'raw exports retain the authored format');
    assert.equal(result.pack.content.dataModules[0].id, `pack.${input.id}/${input.content.dataModules[0].slug}`);
    assert.equal(contentOf([result.pack], 'dataModules').length, 1);
    const shared = validateDataModules(input.content.dataModules, { packId: input.id, capabilities: input.requires.capabilities });
    assert.deepEqual(shared.definitions, result.pack.content.dataModules);
    assert.match(result.packHash, /^[0-9a-f]{64}$/);
});

test('Studio can import the same frozen descriptors, diagnostics, limits and checker through packs', () => {
    assert.equal(packsApi.validateDataModules, validateDataModules);
    assert.equal(packsApi.DM_LIMITS, L);
    assert.equal(packsApi.DM_DESCRIPTORS, D);
    assert.equal(packsApi.DM_DIAGNOSTICS, DM_DIAGNOSTICS);
    assert.ok(Object.isFrozen(D.effects.add.required));
    assert.ok(Object.isFrozen(L));
    assert.ok(HOST_CAPABILITIES.includes('data-modules-v1'));
    assert.equal(Object.keys(DM_DIAGNOSTICS).length, 5);
});

for (const fixture of read('refusals')) test(`refusal fixture ${fixture.code} has stable code, path, message and Studio parity`, () => {
    const input = definition();
    set(input, fixture.target, fixture.repeat ? Array.from({ length: fixture.repeat }, change) : fixture.value);
    const file = pack([input]);
    const error = refuse(file, fixture.code, fixture.path);
    assert.equal(error.message, fixture.message);
    const standalone = validateDataModules(file.content.dataModules, { packId: file.id, capabilities: file.requires.capabilities });
    assert.deepEqual(standalone.errors, validatePack(file).errors);
});

test('capability is required even for an empty definition list; host capability availability is separate', () => {
    const input = pack([]); input.requires.capabilities = [];
    refuse(input, 'DM_SCHEMA', 'requires.capabilities');
    const missing = validatePack(pack(), { capabilities: [] });
    assert.equal(missing.ok, false);
    assert.equal(missing.errors[0].code, 'MISSING_CAPABILITY');
    ok(pack());
});

test('old packs and explicitly unused definitions retain raw bytes and detached normalization', () => {
    const old = { id: 'old', name: 'Old', version: '1.0.0', requires: { storyBlock: '^2' }, content: {} };
    assert.deepEqual(validatePack(old), oldValidatePack(old));
    const result = ok(old);
    assert.equal('dataModules' in result.pack.content, false);
    assert.equal('packHash' in result, false);
    const input = pack();
    const checked = ok(input);
    checked.pack.content.dataModules[0].state.points.default = 12;
    assert.equal(input.content.dataModules[0].state.points.default, 0);
    assert.equal(checked.raw.content.dataModules[0].state.points.default, 0);
});

test('normalization defaults belong only to this format; hashes cover semantics and presentation, not envelope versions', () => {
    const input = pack();
    const a = ok(input);
    const def = a.pack.content.dataModules[0];
    for (const [key, value] of Object.entries(D.defaults)) assert.deepEqual(def[key], value);
    assert.deepEqual(def.kinds.gain.oncePerReply, []);
    const equivalent = structuredClone(input);
    equivalent.content.dataModules[0].kinds.gain.oncePerReply = [];
    equivalent.content.dataModules[0].kinds.gain.ui = false;
    equivalent.content.dataModules[0].kinds.gain.when = true;
    assert.equal(dataModuleHash(def), dataModuleHash(ok(equivalent).pack.content.dataModules[0]));
    equivalent.version = '1.0.1';
    const b = ok(equivalent);
    assert.equal(dataModuleHash(def), dataModuleHash(b.pack.content.dataModules[0]));
    assert.notEqual(a.packHash, b.packHash);
    equivalent.content.dataModules[0].kinds.gain.effects[0].value = 2;
    assert.notEqual(dataModuleHash(def), dataModuleHash(ok(equivalent).pack.content.dataModules[0]));
    const reversed = Object.fromEntries(Object.entries(def).reverse());
    assert.equal(dataModuleHash(def), dataModuleHash(reversed));
});

for (const type of ['check', ...D.v11Effects]) test(`v1.1 feature ${type} is refused on import with the mandated message`, () => {
    const input = edit(d => {
        if (type === 'check') d.kinds.gain.check = { skill: 'survival', stat: 'WIS', dc: 12 };
        else d.kinds.gain.effects = [{ op: type, amount: 1 }];
    });
    const result = validatePack(input);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.message.includes('needs data-modules v1.1')));
});

test('v1.1 checks cannot be read through an expression or hidden in timer/reward effects', () => {
    const checked = edit(d => { d.kinds.gain.when = ['eq', ['check', 'outcome'], 'success']; });
    assert.match(refuse(checked).message, /needs data-modules v1\.1/);
    for (const op of D.v11Effects) {
        const input = edit(d => { d.rewards = { gift: reward() }; d.rewards.gift.effects.push({ op, amount: 1 }); });
        assert.ok(validatePack(input).errors.some(e => e.message.includes('needs data-modules v1.1')));
    }
});

const unknowns = [
    [[], 'oops'], [['state', 'points'], 'oops'], [['kinds', 'gain'], 'oops'], [['kinds', 'gain', 'effects', 0], 'oops'],
    [['imports', 'clock'], 'oops'], [['rewards', 'gift'], 'oops'], [['rewards', 'gift', 'values', 'amount'], 'oops'],
    [['rules', 0], 'oops'], [['timers', 0], 'oops'], [['exports', 'score'], 'oops'], [['migrations', 0], 'oops'],
    [['screens', 0], 'oops'], [['screens', 0, 'layout', 'root'], 'oops'], [['layouts', 0], 'oops'],
];
function complete() {
    const d = definition();
    d.imports = { clock: clock() }; d.rewards = { gift: reward() };
    d.rules = [{ id: 'rule', when: true, then: [change()] }]; d.timers = [timer()];
    d.exports = { score: { fields: ['points'] } };
    d.stateVersion = 2; d.state.new = integer();
    d.migrations = [{ from: 1, to: 2, add: { new: integer() } }];
    d.screens = [{ id: 'score', title: 'Score', layout: { root: { type: 'text', value: 'Score' } } }];
    d.layouts = [{ id: 'score-layout', title: 'Score', icon: 'fa-star', root: { type: 'text', value: 'Score' } }];
    return d;
}
for (const [path, key] of unknowns) test(`unknown key at ${path.join('.') || 'definition'} refuses`, () => {
    const d = complete(); let cursor = d; for (const key of path) cursor = cursor[key]; cursor[key] = true;
    refuse(pack([d]), 'DM_SCHEMA');
});

test('closed fields accept all scalar schemas and map defaults; no nested/growing containers', () => {
    const d = definition();
    d.state = { points: integer(), huge: integer(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        flag: { type: 'bool', default: true }, title: { type: 'enum', values: ['none', 'Friend'], default: 'none' },
        note: { type: 'text', max: 240, default: 'Read me' },
        scores: { type: 'map', keys: ['a', 'b'], values: integer(-1, 1, 1) } };
    const checked = ok(pack([d])).pack.content.dataModules[0];
    assert.deepEqual(dataModuleDefaults(checked.state), { points: 0, huge: 0, flag: true, title: 'none', note: 'Read me', scores: { a: 1, b: 1 } });
    for (const type of ['list', 'array', 'object', 'number', 'constructor', null]) refuse(edit(d => { d.state.points.type = type; }));
    refuse(edit(d => { d.state.points = { type: 'map', keys: ['one'], values: { type: 'map', keys: ['two'], values: integer() } }; }));
});

for (const [name, schema, code] of [
    ['fraction default', integer(0, 100, 0.5), 'DM_BOUNDS'],
    ['reversed int', integer(10, 0, 0), 'DM_BOUNDS'],
    ['unsafe integer', integer(0, Number.MAX_SAFE_INTEGER + 1, 0), 'DM_BOUNDS'],
    ['bool coercion', { type: 'bool', default: 1 }, 'DM_SCHEMA'],
    ['enum default', { type: 'enum', values: ['a'], default: 'b' }, 'DM_BOUNDS'],
    ['enum collision', { type: 'enum', values: ['a', 'ａ'], default: 'a' }, 'DM_SCHEMA'],
    ['text min', { type: 'text', max: 0, default: '' }, 'DM_BOUNDS'],
    ['text max', { type: 'text', max: 241, default: '' }, 'DM_BOUNDS'],
    ['text default', { type: 'text', max: 1, default: 'xx' }, 'DM_BOUNDS'],
]) test(`field refusal: ${name}`, () => refuse(edit(d => { d.state.points = schema; }), code));

test('schema, IDs, scope, version, text safety, normalized keys and prototype keys are checked', () => {
    for (const [key, value] of [['schema', 2], ['stateVersion', 0], ['scope', 'persona'], ['slug', 'x'.repeat(41)], ['name', 'bad\nname']]) refuse(edit(d => { d[key] = value; }));
    refuse(pack([definition(), definition()]));
    refuse(edit(d => { d.name = '<script>bad</script>'; }), 'UNSAFE_HTML');
    const unsafe = JSON.parse(JSON.stringify(pack()).replace('"points":', '"__proto__":'));
    refuse(unsafe, 'UNSAFE_KEY');
    const unsafeExpression = edit(d => { d.kinds.gain.effects[0].path = ['constructor']; });
    refuse(unsafeExpression);
    refuse(edit(d => { d.state['é'] = integer(); d.state['e\u0301'] = integer(); }));
});

const invalidExpressions = [
    [['missing', 1], 'DM_SCHEMA'], [['add', 1], 'DM_SCHEMA'], [['add', 1, 2, 3], 'DM_SCHEMA'],
    [['constructor'], 'DM_SCHEMA'], [{ code: 'x' }, 'DM_SCHEMA'], [0.5, 'DM_BOUNDS'],
    [['get', ['missing']], 'DM_SCHEMA'], [['get', ['points', 'missing']], 'DM_SCHEMA'],
    [['arg', 'missing'], 'DM_SCHEMA'], [['bind', 'missing'], 'DM_SCHEMA'], [['reward', 'missing'], 'DM_SCHEMA'],
    [['input', 'missing', 'minutes'], 'DM_SCHEMA'], [['timer', 'periods'], 'DM_SCHEMA'],
    [['add', 1, true], 'DM_SCHEMA'], [['eq', 1, '1'], 'DM_SCHEMA'], [['gt', 'a', 'b'], 'DM_SCHEMA'],
    [['and', true, 1], 'DM_SCHEMA'], [['not', 1], 'DM_SCHEMA'],
    [['floorDiv', 1, 0], 'DM_BOUNDS'], [['floorDiv', 1, -1], 'DM_BOUNDS'],
    [['floorDiv', 1, ['add', 1, 1]], 'DM_BOUNDS'],
    [['clamp', 1, 5, 0], 'DM_BOUNDS'], [['clamp', 1, 0, ['add', 1, 2]], 'DM_BOUNDS'],
    [['add', 1000000000, 1], 'DM_BOUNDS'], [['clamp', ['add', 1000000000, 1], 0, 100], 'DM_BOUNDS'],
];
for (const [expression, code] of invalidExpressions) test(`invalid AST ${JSON.stringify(expression)} refuses ${code}`, () => {
    refuse(edit(d => { d.kinds.gain.effects[0].value = expression; }), code);
});

for (const expression of [
    ['add', 1, 2], ['sub', 3, 2], ['mul', 2, -3], ['min', 3, 4], ['max', 3, 4],
    ['floorDiv', -7, 2], ['clamp', ['get', ['points']], 1, 90],
]) test(`valid integer AST ${expression[0]}`, () => ok(edit(d => { d.kinds.gain.effects[0].value = expression; })));

for (const expression of [
    ['eq', 1, 1], ['ne', 'a', 'b'], ['lt', 1, 2], ['le', 1, 2], ['gt', 2, 1], ['ge', 2, 1],
    ['and', true, false], ['or', true, false], ['not', false], ['eq', null, null],
]) test(`valid boolean AST ${expression[0]}`, () => ok(edit(d => { d.kinds.gain.when = expression; })));

test('enum paths cover every possible key and writes must fit every possible target', () => {
    const d = definition();
    d.state.table = { type: 'map', keys: ['a', 'b'], values: integer() };
    d.kinds.gain.labels = { key: { type: 'enum', values: ['a', 'b'] } };
    d.kinds.gain.effects = [{ op: 'set', path: ['table', ['arg', 'key']], value: 7 }];
    ok(pack([d]));
    d.kinds.gain.labels.key.values.push('c'); refuse(pack([d]));
    d.kinds.gain.labels.key = { type: 'int', min: 0, max: 1 }; refuse(pack([d]));
    d.kinds.gain.effects[0].path = ['table']; refuse(pack([d]));
});

test('text stays display-only and field type/range mismatches cannot create implicit state', () => {
    const d = definition(); d.state.note = { type: 'text', max: 8, default: '' };
    d.kinds.gain.effects = [{ op: 'set', path: ['note'], value: 'hello' }]; ok(pack([d]));
    d.kinds.gain.effects[0].value = ['get', ['note']]; refuse(pack([d]));
    d.kinds.gain.effects = [{ op: 'add', path: ['note'], value: 1 }]; refuse(pack([d]));
    refuse(edit(d => { d.kinds.gain.effects = [{ op: 'set', path: ['points'], value: true }]; }), 'DM_BOUNDS');
    refuse(edit(d => { d.kinds.gain.effects = [{ op: 'set', path: ['points'], value: 101 }]; }), 'DM_BOUNDS');
    refuse(edit(d => { d.kinds.gain.effects = [{ op: 'set', path: ['implicit'], value: 1 }]; }));
});

for (const [name, changeDefinition, code] of [
    ['arbitrary commands', d => { d.kinds.gain.effects = [{ op: 'command', type: 'inventory.add', payload: {} }]; }, 'DM_SCHEMA'],
    ['raw patch', d => { d.kinds.gain.effects = [{ op: 'replace', path: '/domains/coin', value: 1 }]; }, 'DM_SCHEMA'],
    ['add bounds', d => { d.kinds.gain.effects[0].bounds = 'partial'; }, 'DM_SCHEMA'],
    ['clamp reversal', d => { d.kinds.gain.effects = [{ op: 'clamp', path: ['points'], min: 50, max: 0 }]; }, 'DM_BOUNDS'],
    ['clamp wider', d => { d.kinds.gain.effects = [{ op: 'clamp', path: ['points'], min: 0, max: 101 }]; }, 'DM_BOUNDS'],
    ['kind op', d => { d.kinds.gain.op = '='; }, 'DM_SCHEMA'],
    ['reserved labels', d => { d.kinds.gain.labels.kind = { type: 'bool' }; }, 'DM_LABEL'],
    ['label word', d => { d.kinds.gain.labels['two-words'] = { type: 'bool' }; }, 'DM_LABEL'],
    ['claim int', d => { d.kinds.gain.labels.count = { type: 'int', min: 1, max: 3 }; d.kinds.gain.oncePerReply = ['count']; }, 'DM_LABEL'],
    ['claim unknown', d => { d.kinds.gain.oncePerReply = ['missing']; }, 'DM_LABEL'],
    ['condition coercion', d => { d.kinds.gain.when = 1; }, 'DM_CONDITION'],
]) test(`effects/kinds refusal: ${name}`, () => refuse(edit(changeDefinition), code));

test('rewards validate frozen range pickers and exhaustively covered enum range tables', () => {
    const d = definition();
    d.rewards = { gift: reward() };
    d.kinds.gain.effects = [{ op: 'reward', template: 'gift', bind: {} }];
    for (const pick of ['min', 'max', 'midpoint']) { d.rewards.gift.values.amount.pick = pick; ok(pack([d])); }
    d.rewards.gift.values.amount.pick = 'random'; refuse(pack([d]));
    d.rewards.gift.bindings = { tier: { type: 'enum', values: ['low', 'high'] } };
    d.rewards.gift.values.amount = { binding: 'tier', table: { low: { min: 1, max: 2, pick: 'min' }, high: { min: 3, max: 5, pick: 'midpoint' } } };
    d.kinds.gain.effects[0].bind = { tier: 'low' }; ok(pack([d]));
    d.kinds.gain.effects[0].bind.tier = 'other'; refuse(pack([d]), 'DM_BOUNDS');
    d.kinds.gain.effects[0].bind.tier = 'low';
    delete d.rewards.gift.values.amount.table.high; refuse(pack([d]));
});

test('reward/offer references and bindings are closed and templates cannot recurse', () => {
    const d = definition(); d.rewards = { gift: reward() };
    d.kinds.gain.effects = [{ op: 'offer', template: 'gift', key: 'prize', bind: {} }, { op: 'award', offer: 'prize' }];
    ok(pack([d]));
    d.kinds.gain.effects[1].offer = 'missing'; refuse(pack([d]));
    d.kinds.gain.effects.pop(); d.kinds.gain.effects[0].template = 'missing'; refuse(pack([d]));
    d.kinds.gain.effects[0].template = 'gift'; d.kinds.gain.effects[0].bind = { unknown: 1 }; refuse(pack([d]));
    d.kinds.gain.effects[0].bind = {}; d.rewards.gift.effects = [{ op: 'reward', template: 'gift', bind: {} }]; refuse(pack([d]));
});

test('timers require witnessed SD minutes, additive effects and proven bounded arithmetic', () => {
    const d = definition(); d.imports = { clock: clock() }; d.timers = [timer()]; ok(pack([d]));
    d.timers[0].every = 0; refuse(pack([d]), 'DM_BOUNDS');
    d.timers[0].every = 525601; refuse(pack([d]), 'DM_BOUNDS');
    d.timers[0].every = 1; d.timers[0].effects[0].value = ['mul', ['timer', 'periods'], 1902]; ok(pack([d]));
    d.timers[0].effects[0].value[2] = 1903; refuse(pack([d]), 'DM_BOUNDS');
    d.timers[0].effects = [{ op: 'set', path: ['points'], value: 1 }]; refuse(pack([d]));
    d.timers[0].effects = [change()]; d.imports.clock.mode = 'recorded'; refuse(pack([d]));
    d.imports.clock.mode = 'prefix'; d.imports.clock.projection = ['text']; refuse(pack([d]));
});

function exportedPair() {
    const a = definition(), b = definition(); b.slug = 'reader'; b.kinds.gain.effects[0].value = ['input', 'score', 'points'];
    a.exports = { score: { fields: ['points'] } };
    b.imports = { score: { query: 'dataModules.public', mode: 'prefix', args: { module: 'pack.dm-test/counter', export: 'score' }, projection: ['points'] } };
    return [a, b];
}

test('data imports resolve typed public exports, reject private fields/cycles, support checked external catalogs', () => {
    const defs = exportedPair(); ok(pack(defs));
    defs[1].imports.score.projection = ['private']; refuse(pack(defs));
    defs[1].imports.score.projection = ['points'];
    defs[1].exports = { score: { fields: ['points'] } };
    defs[0].imports = { back: { ...defs[1].imports.score, args: { module: 'pack.dm-test/reader', export: 'score' } } };
    assert.match(refuse(pack(defs)).message, /cycle/);
    const pair = exportedPair();
    const target = ok(pack([pair[0]])).pack.content.dataModules[0];
    const input = pack([pair[1]]); input.id = 'external';
    const checked = validatePack(input, { dataModuleDefinitions: [target] });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    refuse(input);
});

test('public import adapters reject private paths, unknown queries/arguments and actor aliases', () => {
    for (const entry of [
        { ...clock(), query: 'director.private' }, { ...clock(), args: { state: true } },
        { ...clock(), projection: ['formatted'] }, { ...clock(), projection: ['minutes', 'minutes'] },
        { ...clock(), mode: 'live' }, { query: 'checks.policy', mode: 'prefix', projection: ['settings'] },
        { query: 'dataModules.public', mode: 'prefix', args: { module: 'pack.dm-test/counter', export: 'score', who: 'ac_fake' }, projection: ['points'] },
    ]) refuse(edit(d => { d.imports = { alias: entry }; }));
    const defs = exportedPair(); defs[0].scope = 'character'; refuse(pack(defs));
    defs[1].imports.score.args.who = 'ca_wessel'; ok(pack(defs));
});

test('module presentation uses the existing renderer validator and checks own view/command references', () => {
    const d = definition(); d.kinds.gain.ui = true;
    d.screens = [{ id: 'counter', layout: { root: { type: 'text', bind: { query: 'dataModules.view', args: { module: 'pack.dm-test/counter' }, path: 'chat.points' } } } }];
    ok(pack([d]));
    d.screens[0].layout.root.bind.path = 'chat.secret'; refuse(pack([d]));
    d.screens[0].layout.root.bind.path = 'chat.points';
    d.screens[0].layout.root.bind.args.module = 'pack.other/counter'; refuse(pack([d]));
    d.screens[0].layout.root = { type: 'button', label: 'Gain', command: 'dm.act', payload: { module: 'pack.dm-test/counter', kind: 'gain' } }; ok(pack([d]));
    d.kinds.gain.ui = false; refuse(pack([d]));
    d.kinds.gain.ui = true; d.screens[0].layout.root.command = 'inventory.add'; refuse(pack([d]));
    // Ordinary layout acceptance still allows renderer warnings.
    const old = { id: 'old', version: '1.0.0', requires: { storyBlock: '^2' }, layouts: [{ arbitrary: true }] }; ok(old);
});

test('additive migration checks old semantics, consecutive versions, exact schemas and defaults', () => {
    const old = ok(pack()).pack.content.dataModules[0];
    const next = definition(); next.stateVersion = 2; next.state.flag = { type: 'bool', default: false };
    next.migrations = [{ from: 1, to: 2, add: { flag: { type: 'bool', default: false } } }];
    const target = ok(pack([next])).pack.content.dataModules[0];
    assert.deepEqual(validateDataMigration(old, target), { ok: true, add: { flag: { type: 'bool', default: false } } });
    for (const mutate of [
        d => { d.kinds.gain.effects[0].value = 2; }, d => { d.state.points.max = 200; },
        d => { delete d.state.points; }, d => { d.state.points.default = 1; }, d => { d.scope = 'character'; },
        d => { d.rules.push({ id: 'new', when: true, then: [] }); }, d => { d.imports.new = clock(); },
    ]) {
        const changed = structuredClone(target); mutate(changed);
        assert.equal(validateDataMigration(old, changed).ok, false);
    }
    assert.equal(validateDataMigration(target, old).ok, false);
    next.migrations[0].to = 3; refuse(pack([next]));
    next.migrations[0].to = 2; next.migrations[0].add.flag.default = true; refuse(pack([next]));
});

const budgetCases = [
    ['definitions', 8, n => pack(Array.from({ length: n }, (_, i) => ({ ...definition(), slug: `module-${i}` })))],
    ['fields', 32, n => edit(d => { d.state = Object.fromEntries(Array.from({ length: n }, (_, i) => [`field-${i}`, integer()])); d.kinds.gain.effects = []; })],
    ['kinds', 16, n => edit(d => { d.kinds = Object.fromEntries(Array.from({ length: n }, (_, i) => [`kind-${i}`, { op: '!', labels: {}, effects: [] }])); })],
    ['rules', 32, n => edit(d => { d.rules = Array.from({ length: n }, (_, i) => ({ id: `rule-${i}`, when: true, then: [] })); })],
    ['timers', 8, n => edit(d => { d.imports = { clock: clock() }; d.timers = Array.from({ length: n }, (_, i) => ({ ...timer(), id: `timer-${i}` })); })],
    ['templates', 16, n => edit(d => { d.rewards = Object.fromEntries(Array.from({ length: n }, (_, i) => [`gift-${i}`, reward()])); })],
    ['effects', 16, n => edit(d => { d.kinds.gain.effects = Array.from({ length: n }, change); })],
    ['imports', 8, n => edit(d => { d.imports = Object.fromEntries(Array.from({ length: n }, (_, i) => [`clock-${i}`, clock()])); })],
];
for (const [name, limit, build] of budgetCases) test(`${name} count accepts limit-1/limit and refuses limit+1`, () => {
    ok(build(limit - 1)); ok(build(limit)); refuse(build(limit + 1), 'DM_BUDGET');
});

test('map/enum/key/text limits accept their boundary and refuse the next value', () => {
    for (const n of [31, 32]) ok(edit(d => { d.state.mode = { type: 'enum', values: Array.from({ length: n }, (_, i) => `v${i}`), default: 'v0' }; }));
    refuse(edit(d => { d.state.mode = { type: 'enum', values: Array.from({ length: 33 }, (_, i) => `v${i}`), default: 'v0' }; }));
    for (const n of [15, 16]) ok(edit(d => { d.state.map = { type: 'map', keys: Array.from({ length: n }, (_, i) => `k${i}`), values: integer() }; }));
    refuse(edit(d => { d.state.map = { type: 'map', keys: Array.from({ length: 17 }, (_, i) => `k${i}`), values: integer() }; }));
    for (const n of [39, 40]) ok(edit(d => { d.state['x'.repeat(n)] = integer(); d.state.text = { type: 'text', max: 240, default: 'x'.repeat(240) }; }));
    refuse(edit(d => { d.state['x'.repeat(41)] = integer(); }));
});

test('expression depth and node counts are checked independently at the exact boundary', () => {
    const nest = depth => depth === 1 ? true : ['not', nest(depth - 1)];
    for (const depth of [5, 6]) ok(edit(d => { d.kinds.gain.when = nest(depth); }));
    refuse(edit(d => { d.kinds.gain.when = nest(7); }), 'DM_BUDGET');
    const tree = depth => depth === 1 ? 1 : ['add', tree(depth - 1), tree(depth - 1)];
    const ast = tree(6); // 63 operator/literal visits
    ok(edit(d => { d.kinds.gain.effects[0].value = ast; }));
    ast[1][1][1][1] = ['clamp', 1, 0, 100]; // 64 visits, still depth 6
    ok(edit(d => { d.kinds.gain.effects[0].value = ast; }));
    ast[1][1][1][2] = ['clamp', 1, 0, 100]; // 65 visits
    refuse(edit(d => { d.kinds.gain.effects[0].value = ast; }), 'DM_BUDGET');
});

test('four adjacent migrations are permitted, five or a cyclic/branching/gapped chain refuse', () => {
    function chain(count) {
        const d = definition(); d.stateVersion = count + 1;
        d.migrations = Array.from({ length: count }, (_, i) => {
            const field = `new-${i}`; d.state[field] = integer();
            return { from: i + 1, to: i + 2, add: { [field]: integer() } };
        }); return d;
    }
    ok(pack([chain(3)])); ok(pack([chain(4)])); refuse(pack([chain(5)]), 'DM_BUDGET');
    for (const from of [1, 3, 5]) { const d = chain(4); d.migrations[1].from = from; refuse(pack([d])); }
});

test('definition byte budget measures normalized UTF-8 JSON at limit-1, limit and limit+1', () => {
    const d = definition(); d.screens = [{ id: 'bytes', layout: { root: { type: 'col', children: Array.from({ length: 20 }, () => ({ type: 'text', value: '' })) } } }];
    const baseline = ok(pack([d])).pack.content.dataModules[0];
    const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
    const remaining = L.definitionBytes - bytes(baseline);
    let rest = remaining;
    for (const child of d.screens[0].layout.root.children) {
        const take = Math.min(1800, rest); child.value = 'x'.repeat(take); rest -= take;
    }
    assert.equal(rest, 0);
    // Two UTF-16 units and four UTF-8 bytes; compensate exactly in another node.
    d.screens[0].layout.root.children[19].value += '😀';
    d.screens[0].layout.root.children[0].value = d.screens[0].layout.root.children[0].value.slice(4);
    const atLimit = ok(pack([d])).pack.content.dataModules[0];
    assert.equal(bytes(atLimit), L.definitionBytes);
    d.screens[0].layout.root.children[0].value = d.screens[0].layout.root.children[0].value.slice(1);
    assert.equal(bytes(ok(pack([d])).pack.content.dataModules[0]), L.definitionBytes - 1);
    d.screens[0].layout.root.children[0].value += 'xx';
    refuse(pack([d]), 'DM_BUDGET');
});

test('default instance byte budget uses expanded fixed maps, with exact 16 KiB boundaries', () => {
    const d = definition();
    for (let i = 0; i < 4; i++) d.state[`map-${i}`] = { type: 'map', keys: Array.from({ length: 16 }, (_, j) => String.fromCharCode(97 + j)), values: { type: 'text', max: 240, default: 'x'.repeat(240) } };
    for (let i = 0; i < 4; i++) d.state[`pad-${i}`] = { type: 'text', max: 240, default: '' };
    const size = state => new TextEncoder().encode(JSON.stringify({ fields: dataModuleDefaults(state), timers: {}, offers: {}, settled: {} })).length;
    let rest = L.instanceBytes - size(d.state);
    for (let i = 0; i < 4; i++) { const take = Math.min(rest, 239); d.state[`pad-${i}`].default = 'x'.repeat(take); rest -= take; }
    assert.equal(rest, 0);
    assert.equal(size(d.state), L.instanceBytes); ok(pack([d]));
    const pad = Object.values(d.state).find(f => f.type === 'text' && f.default.length > 0 && f.default.length < 239);
    assert.ok(pad); pad.default = pad.default.slice(1);
    assert.equal(size(d.state), L.instanceBytes - 1); ok(pack([d]));
    pad.default += 'xx'; refuse(pack([d]), 'DM_BUDGET');
});

function paths(value, path = [], out = []) {
    out.push(path);
    if (value && typeof value === 'object') for (const key of Object.keys(value)) paths(value[key], [...path, key], out);
    return out;
}
test('malformed definition/property sweep never throws, mutates input or exceeds the diagnostic budget', () => {
    const junk = [null, false, 0, '', [], {}, ['constructor'], { type: 'constructor' }, { op: 'constructor' }, { toString: 1 }, { type: 'map', keys: ['a'], values: null }];
    let vectors = 0;
    for (const example of ['reputation', 'survival']) {
        const base = read(example);
        for (const path of paths(base.content.dataModules[0])) for (const value of junk) {
            const input = structuredClone(base); set(input, ['content', 'dataModules', 0, ...path], value);
            const before = JSON.stringify(input);
            const result = validatePack(input);
            assert.equal(JSON.stringify(input), before);
            if (!result.ok) {
                assert.ok(result.errors.length > 0 && result.errors.length <= 20);
                assert.ok(result.errors.every(e => typeof e.code === 'string' && typeof e.path === 'string' && typeof e.message === 'string'));
            }
            vectors++;
        }
    }
    assert.ok(vectors >= 3000);
});

test('a data pack hash changes when its definition changes', () => {
    const input = pack();
    const first = ok(input);
    assert.match(first.packHash, /^[0-9a-f]{64}$/);
    assert.equal(ok(structuredClone(input)).packHash, first.packHash);
    input.content.dataModules[0].kinds.gain.effects[0].value = 2;
    assert.notEqual(ok(input).packHash, first.packHash);
});

test('enum scalar literals are exact, with finite numeric/bool membership and case-sensitive text', () => {
    const d = definition();
    d.state.number = { type: 'enum', values: [1, 3], default: 1 };
    d.state.flag = { type: 'enum', values: [true], default: true };
    d.state.name = { type: 'enum', values: ['a', 'A', ''], default: '' };
    d.state.none = { type: 'enum', values: [null], default: null };
    d.kinds.gain.effects = [{ op: 'set', path: ['number'], value: 3 }, { op: 'set', path: ['flag'], value: true }];
    d.kinds.gain.when = ['gt', ['get', ['number']], 0]; ok(pack([d]));
    d.kinds.gain.effects[0].value = 2; refuse(pack([d]), 'DM_BOUNDS');
    d.kinds.gain.effects[0].value = 3; d.kinds.gain.effects[1].value = false; refuse(pack([d]), 'DM_BOUNDS');
});

test('template command names and screen nested records are checked by shared renderer contracts', () => {
    const d = definition();
    d.screens = [{ id: 'template', mounts: ['dialog'], template: '<b>Counter</b>', data: { values: { query: 'dataModules.view', args: { module: 'pack.dm-test/counter' } } } }];
    ok(pack([d]));
    d.screens[0].template = '<button data-command="inventory.add">Grant</button>'; refuse(pack([d]));
    d.screens[0].template = '<form data-submit="inventory&#46;add"></form>'; refuse(pack([d]));
    d.screens[0].template = '<b>Counter</b>'; d.screens[0].data.values.unknown = true; refuse(pack([d]));
    delete d.screens[0].data.values.unknown;
    d.screens[0].steps = [{ id: 'one', template: '<b>Step</b>', unknown: true }]; refuse(pack([d]));
});

test('standalone checker retains pack nesting and hostile JSON safety diagnostics', () => {
    const d = definition(); let expr = true; for (let i = 0; i < 15; i++) expr = ['not', expr]; d.kinds.gain.when = expr;
    const input = pack([d]);
    const whole = validatePack(input);
    const standalone = validateDataModules(input.content.dataModules, { packId: input.id, capabilities: input.requires.capabilities });
    assert.deepEqual(standalone.errors, whole.errors);
    const getter = definition(); Object.defineProperty(getter, 'sideEffect', { enumerable: true, get() { throw new Error('must never run'); } });
    const checked = validatePack(pack([getter])); assert.equal(checked.ok, false); assert.equal(checked.errors[0].code, 'NOT_PLAIN');
});

test('a timer/view/export-only module may declare an empty kinds object', () => {
    const d = definition(); d.kinds = {}; d.imports = { clock: clock() }; d.timers = [timer()];
    ok(pack([d]));
});

test('screen action label names and literals use the same local kind schema', () => {
    const d = definition(); d.kinds.gain.ui = true; d.kinds.gain.labels = { amount: { type: 'int', min: 1, max: 3 } };
    const payload = { module: 'pack.dm-test/counter', kind: 'gain', labels: {} };
    d.screens = [{ id: 'action', layout: { root: { type: 'button', label: 'Gain', command: 'dm.act', payload } } }];
    refuse(pack([d]), 'DM_LABEL');
    payload.labels.amount = 2; ok(pack([d]));
    payload.labels.amount = 4; refuse(pack([d]), 'DM_LABEL');
    payload.labels.amount = '2'; refuse(pack([d]), 'DM_LABEL');
    payload.labels.amount = '$item.amount';
    // Row references need a list as in the existing renderer contract.
    d.screens[0].layout.root = { type: 'list', bind: { query: 'dataModules.view', args: { module: 'pack.dm-test/counter' }, path: 'chat' }, item: d.screens[0].layout.root };
    ok(pack([d]));
    payload.labels.unknown = 1; refuse(pack([d]), 'DM_LABEL');
});

// Review findings on the checker (early review of 22a3976): label payloads are plain data, and a template button's payload is
// held to the same closed shape as a layout action's.
const askKind = () => {
    const d = definition();
    d.kinds.ask = { op: '!', ui: true, labels: { query: { type: 'enum', values: ['hello', 'bye'] }, command: { type: 'enum', values: ['hello', 'bye'] } }, effects: [change()] };
    return d;
};
const action = payload => ({ type: 'button', label: 'Ask', command: 'dm.act', payload });
const withLayout = (d, payload) => { d.screens = [{ id: 'ask-screen', title: 'Ask', mounts: ['tab'], layout: { root: { type: 'col', children: [action(payload)] } } }]; return pack([d]); };
const GOOD = { module: 'pack.dm-test/counter', kind: 'ask', labels: { query: 'hello', command: 'bye' } };

test('a label may be called query or command and hold any text of its type: a payload is data, not a binding or an action', () => {
    ok(withLayout(askKind(), GOOD));
    // The label's value still has to be of its declared type.
    refuse(withLayout(askKind(), { ...GOOD, labels: { query: 'nope', command: 'bye' } }), 'DM_LABEL');
    // And a real binding or foreign action beside it is still held to the rules.
    const d = askKind();
    withLayout(d, GOOD);
    d.screens[0].layout.root.children.push({ type: 'text', label: 'x', bind: { query: 'inventory.items', args: {} } });
    refuse(pack([d]), 'DM_SCHEMA');
});

test('a template button carries the closed dm.act payload only: foreign, unknown, extra, unlabelled and form payloads are refused', () => {
    const page = (button, extra = {}) => { const d = askKind(); d.screens = [{ id: 'ask-screen', title: 'Ask', mounts: ['tab'], template: button, ...extra }]; return pack([d]); };
    const payload = value => `<button data-command="dm.act" data-payload='${JSON.stringify(value)}'>Ask</button>`;
    ok(page(payload(GOOD)));
    ok(page('<button data-command="dm.act" data-payload=\'{"module":"pack.dm-test/counter","kind":"ask","labels":{"query":"{{ item.q }}","command":"bye"}}\'>Ask</button>'));
    refuse(page(payload({ ...GOOD, module: 'pack.other/counter' })));
    refuse(page(payload({ ...GOOD, kind: 'gain' })), 'DM_SCHEMA');                                     // not a ui kind
    refuse(page(payload({ ...GOOD, kind: 'nope' })));
    refuse(page(payload({ ...GOOD, extra: 1 })));                                                       // outside the closed shape
    refuse(page(payload({ module: GOOD.module, kind: 'ask' })), 'DM_LABEL');                           // labels missing
    refuse(page(payload({ ...GOOD, labels: { query: 'hello', command: 'bye', more: 'x' } })), 'DM_LABEL');
    refuse(page(payload({ ...GOOD, who: 'Wessel' })), 'DM_LABEL');                                     // chat scope has no who
    refuse(page('<button data-command="dm.act">Ask</button>'));                                         // no payload at all
    refuse(page('<button data-command="dm.act" data-payload=\'[1]\'>Ask</button>'));
    refuse(page('<button data-command="dm.act" data-payload=\'{"module":"{{ x }}","kind":"ask","labels":{"query":"hello","command":"bye"}}\'>Ask</button>'));
    refuse(page('<form data-submit="dm.act"><input data-draft="x"></form>'));
    refuse(page(payload(GOOD), { steps: [{ id: 's', template: payload({ ...GOOD, module: 'pack.other/counter' }) }] }));
});
