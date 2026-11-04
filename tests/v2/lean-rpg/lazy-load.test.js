// The RPG's code is loaded only when it is needed (src/v2/rpg-lazy.js): with the feature off and nothing of the RPG's in the chat, none of
// its code files are fetched (static closure of index.js, and no load at runtime); switching the feature on loads it; a chat that holds
// the RPG's records loads it before it is replayed and replays exactly as it was recorded, whatever the feature says; the stand-in part
// has the shape of the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { LEAN_RPG_FEATURE } from '../../../src/v2/lean-rpg/names.js';
import { createLeanRpgPart } from '../../../src/v2/lean-rpg/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { createLazyRpgPart, createRpgLoader, holdsRpg, rpgLib, setRpgLib } from '../../../src/v2/rpg-lazy.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MARA = '+ party Mara | about: a hedge-witch from Kvildal | class: IV | best: int';
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// ---- what the page fetches at start, from the entry file's static imports ----------------------------------------------------------------

function closure(entry) {
    const seen = new Set();
    const walk = file => {
        if (seen.has(file)) return;
        seen.add(file);
        const source = readFileSync(file, 'utf8');
        for (const found of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g)) walk(resolve(dirname(file), found[1] ?? found[2]));
    };
    walk(resolve(ROOT, entry));
    return [...seen].map(file => relative(ROOT, file));
}
// The RPG's code proper: everything of src/v2/lean-rpg/ but the small helpers every block uses (names, blocks, formula, read, soul, tail, cue, foes, levels, roster).
const SHARED = new Set(['names', 'blocks', 'formula', 'read', 'soul', 'tail', 'cue', 'foes', 'levels', 'roster']);
const rpgFiles = files => files.filter(file => file.startsWith('src/v2/lean-rpg/') && !SHARED.has(file.slice('src/v2/lean-rpg/'.length, -3)));

test('the page start (index.js static imports) reaches none of the RPG\'s code, only its small shared helpers', () => {
    const files = closure('index.js');
    assert.deepEqual(rpgFiles(files), [], 'the RPG\'s files come in by import() only');
    const bytes = list => list.reduce((sum, file) => sum + statSync(resolve(ROOT, file)).size, 0);
    const lean = files.filter(file => file.startsWith('src/v2/lean-rpg/'));
    assert.ok(lean.every(file => SHARED.has(file.slice('src/v2/lean-rpg/'.length, -3))), `only the shared helpers: ${lean.join(', ')}`);
    assert.ok(bytes(lean) < 87000, `the shared helpers stay small (${bytes(lean)} bytes)`);
    // …and what a dynamic import brings in is the whole RPG (the part and its pieces), so the split is real.
    const whole = closure('src/v2/lean-rpg/index.js').filter(file => file.startsWith('src/v2/lean-rpg/'));
    assert.ok(bytes(whole) > 4 * bytes(lean), 'the part is most of the RPG\'s code');
});

// ---- the loader --------------------------------------------------------------------------------------------------------------------------

test('holdsRpg: stored rolls, fight XP, practice, a joined companion, a held plan or a start note; nothing else', () => {
    const record = (receipts = [], spans = []) => ({ extra: { storySuite: { receipts, spans } } });
    assert.equal(holdsRpg([]), false);
    assert.equal(holdsRpg([record([{ type: 'inventory.add' }], [{ guard: { predicate: { kind: 'loot.take' } } }])]), false);
    for (const type of ['rpg.resolve', 'rpg.fight', 'rpg.practice', 'dm.join', 'capture.party']) assert.equal(holdsRpg([record([{ type }])]), true, type);
    assert.equal(holdsRpg([record([], [{ guard: { predicate: { kind: 'rpg.resolve' } } }])]), true, 'a guarded span');
    assert.equal(holdsRpg([{ swipe_info: [{ extra: { storySuite: { receipts: [{ type: 'rpg.resolve' }] } } }] }]), true, 'another swipe\'s record');
    assert.equal(holdsRpg([], { rpgPlan: { key: '1' } }), true);
    assert.equal(holdsRpg([], { storySuite: { rpgStart: { hidden: true } } }), true);
    assert.equal(holdsRpg(null, null), false);
    assert.equal(holdsRpg([null, 5, { extra: 3 }], 7), false, 'junk holds nothing');
});

test('the loader fetches once, only when asked for, never throws, and tells a failure', async () => {
    setRpgLib(null);
    let loads = 0, on = false;
    const problems = [];
    const loader = createRpgLoader({ load: async () => { loads += 1; return { marker: true }; }, featureOn: () => on, chat: () => [], problem: entry => problems.push(entry) });
    assert.equal(loader.ensure(), undefined, 'feature off, empty chat: nothing to wait for');
    assert.equal(loads, 0);
    on = true;
    const waiting = loader.ensure({ scan: false });
    assert.ok(waiting && typeof waiting.then === 'function');
    await Promise.all([waiting, loader.ensure()]);
    assert.equal(loads, 1);
    assert.equal(rpgLib().marker, true);
    assert.equal(loader.ensure(), undefined, 'loaded: no wait on the reply\'s way');
    setRpgLib(null);
    const broken = createRpgLoader({ load: async () => { throw new Error('offline'); }, featureOn: () => true, problem: entry => problems.push(entry) });
    assert.equal(await broken.ensure(), null);
    assert.equal(problems[0].code, 'RPG_LOAD');
    assert.match(problems[0].message, /offline/);
});

// ---- the stand-in part has the shape of the real one -------------------------------------------------------------------------------------

test('the stand-in part has the real part\'s commands, queries, cards, hooks, settings and the same marks on them', () => {
    setRpgLib({ createLeanRpgPart });
    const real = createLeanRpgPart({ timeoutMs: 1234 }), lazy = createLazyRpgPart({ timeoutMs: 1234 });
    assert.deepEqual(Object.keys(lazy.commands).sort(), Object.keys(real.commands).sort());
    for (const name of Object.keys(real.commands)) {
        const [a, b] = [real.commands[name], lazy.commands[name]];
        for (const mark of ['prelude', 'internal', 'feature']) assert.equal(b[mark], a[mark], `${name}.${mark}`);
    }
    assert.deepEqual(Object.keys(lazy.queries).sort(), Object.keys(real.queries).sort());
    for (const name of Object.keys(real.queries)) assert.equal(lazy.queries[name].feature, real.queries[name].feature, name);
    assert.deepEqual(Object.keys(lazy.cards), Object.keys(real.cards));
    assert.equal(lazy.cards['rpg-join'].feature, real.cards['rpg-join'].feature);
    assert.deepEqual(Object.keys(lazy.hooks).sort(), Object.keys(real.hooks).sort());
    assert.equal(lazy.hooks.beforeGenerate.timeoutMs, real.hooks.beforeGenerate.timeoutMs);
    assert.deepEqual(lazy.settings, real.settings);
    assert.equal(typeof lazy.guard, 'function');
    setRpgLib(null);
});

test('before the library is there the stand-in does nothing, and a roll asked of it says so', () => {
    setRpgLib(null);
    const lazy = createLazyRpgPart({});
    assert.equal(lazy.hooks.beforeGenerate({}, {}), undefined);
    assert.equal(lazy.hooks.afterCapture({}, {}), undefined);
    assert.equal(lazy.queries['rpg.joins']({}, {}, {}) instanceof Array, true);
    assert.equal(lazy.queries['rpg.rolls']({}, {}, {}), null);
    assert.equal(lazy.guard({}, {}).ok, false);
    let said = '';
    assert.equal(lazy.commands['rpg.resolve']({ fail: (code, text) => { said = `${code}: ${text}`; return null; } }, {}), null);
    assert.match(said, /^FAILED: The RPG is still loading/);
});

// ---- through the real host ---------------------------------------------------------------------------------------------------------------

async function make(host, who, soul = 1) {
    const defs = Object.fromEntries(LEAN_RPG_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = who.toLowerCase(); defs.character.name = who; defs.character.state.who.default = who; (defs.character.state.level ?? defs.character.state.soul).default = soul;
    defs.skills.slug = `${who.toLowerCase()}-skills`; defs.skills.name = `${who}'s skills`; defs.skills.state.who.default = who;
    for (const definition of [defs.character, defs.skills]) assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
}
const counted = () => {
    const state = { loads: 0 };
    state.load = () => { state.loads += 1; return import('../../../src/v2/lean-rpg/index.js'); };
    return state;
};
const settled = host => host.rpgLoader?.ensure({ scan: false });

test('feature off, nothing of the RPG in the chat: a whole session loads none of it', { skip }, async t => {
    const count = counted();
    const host = await createHost({ lazyRpg: true, rpgLoad: count.load });
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    await host.send('I look around.', 'The gate is shut.');
    await host.turn.reread(host.ctx.chat.length - 1);
    host.store.rebuild();
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(count.loads, 0, 'the RPG was not fetched');
    assert.equal(rpgLib(), null);
    assert.equal(host.registry.featureOn(CORE_FEATURE.leanRpg), false);
    assert.deepEqual(host.turn.problems().map(entry => entry.code), []);
});

test('switching the feature on loads it once, and the RPG then works (a companion joins)', { skip }, async t => {
    const count = counted();
    const host = await createHost({ lazyRpg: true, rpgLoad: count.load, settings: { modules: { 'story-block': { rpgJoin: 'auto', rpgFormula: 'classic' } } } });
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    await make(host, 'Wessel', 3);
    assert.equal(count.loads, 0);
    host.features.set(CORE_FEATURE.leanRpg, true);
    await settled(host);
    assert.equal(count.loads, 1);
    assert.ok(rpgLib(), 'the library is there');
    await host.send('We go on.', reply(MARA));
    assert.deepEqual(host.turn.problems().filter(entry => entry.code !== 'ROLLS_SKIPPED').map(entry => entry.message), []);
    assert.ok(Object.keys(host.head().domains.dataModules.active).includes('pack.chat/mara'), 'Mara joined');
    await settled(host);
    assert.equal(count.loads, 1, 'still one load');
});

test('a chat that holds the RPG\'s records loads it before it is replayed, with the feature off, and replays as recorded', { skip }, async t => {
    const first = await createHost({ settings: { modules: { 'story-block': { rpgJoin: 'auto', rpgFormula: 'classic' } } } });
    t.after(() => first.close());
    first.features.set(CORE_FEATURE.leanRpg, true);
    await first.send('Begin.', 'Opening.');
    await make(first, 'Wessel', 3);
    await first.send('We go on.', reply(MARA));
    assert.ok(first.ctx.chat.at(-1).extra.storySuite.spans.some(span => span.guard?.predicate?.kind === 'dm.join'), 'the reply holds a companion\'s join');
    const live = JSON.stringify(first.head());
    const chat = JSON.parse(JSON.stringify(first.ctx.chat));

    const count = counted();
    const second = await createHost({ lazyRpg: true, rpgLoad: count.load });
    t.after(() => second.close());
    assert.equal(second.registry.featureOn(CORE_FEATURE.leanRpg), false, 'the feature is off here');
    assert.equal(count.loads, 0, 'an empty chat needs nothing');
    await second.st.loadChat(chat);
    assert.equal(count.loads, 1, 'the chat\'s records brought it in');
    assert.equal(JSON.stringify(second.head()), live, 'the story replays exactly as recorded');
    assert.deepEqual(second.store.problems(), []);
    second.store.rebuild();
    assert.equal(JSON.stringify(second.head()), live, 'and again after a rebuild');
});

test('the feature on at the page start loads it with the first chat, before it is replayed', { skip }, async t => {
    const count = counted();
    const host = await createHost({ lazyRpg: true, rpgLoad: count.load, settings: { features: { [CORE_FEATURE.leanRpg]: true } } });
    t.after(() => host.close());
    assert.equal(host.registry.featureOn(CORE_FEATURE.leanRpg), true);
    assert.equal(count.loads, 1);
    assert.ok(rpgLib());
    assert.equal(LEAN_RPG_FEATURE, CORE_FEATURE.leanRpg);
});

test('B9 and B11: a stalled import never holds a chat open, the chat shows what it can without the RPG, and the late load gives rebuild == live (the guard mark says the code was missing)', { skip, timeout: 20000 }, async t => {
    const first = await createHost({ settings: { modules: { 'story-block': { rpgJoin: 'auto', rpgFormula: 'classic' } } } });
    t.after(() => first.close());
    first.features.set(CORE_FEATURE.leanRpg, true);
    await first.send('Begin.', 'Opening.');
    await make(first, 'Wessel', 3);
    await first.send('We go on.', reply(MARA));
    const live = JSON.stringify(first.head());
    const chat = JSON.parse(JSON.stringify(first.ctx.chat));

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const second = await createHost({ lazyRpg: true, rpgLoad: () => gate.then(() => import('../../../src/v2/lean-rpg/index.js')) });
    t.after(() => second.close());
    const started = Date.now();
    await second.st.loadChat(chat);          // returns although the import has not: the wait is bounded
    assert.ok(Date.now() - started < 10000, 'the chat was not held for the stalled import');
    assert.equal(rpgLib(), null, 'the code is still missing');
    release();
    await second.rpgLoader.ensure({ scan: false });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(rpgLib(), 'the code came in late');
    second.store.rebuild();
    assert.equal(JSON.stringify(second.head()), live, 'after the late load the story is what it was recorded as');
    assert.deepEqual(second.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), []);
});
