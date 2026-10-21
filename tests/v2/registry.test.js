// The module registry (docs/v2/SPEC.md §6, §12): checking definitions, refusing clashes, lookups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_PREFIX, INIT_PREFIX, createRegistry, definitionProblems, definitionWarnings } from '../../src/v2/registry.js';

const party = () => ({
    id: 'rpg-battle',
    name: 'RPG Battle',
    version: '2.0.0-alpha.1',
    domains: {
        party: { initial: () => ({ actors: {}, order: [] }), validate: () => [] },
        combat: { initial: () => ({ session: null }) },
    },
    commands: { 'item.use': () => ({ summary: 'used' }) },
    queries: { 'party.actors': state => Object.values(state.domains.party.actors) },
    capture: {
        kinds: { wound: { grammar: '~ wound Name — how | harm: scratch|wound|grave' }, check: { grammar: '? check skill — what | dc: easy|normal|hard' } },
        apply: (ctx, line) => ({ summary: line.name }),
    },
    context: { static: () => 'RPG rules.', tail: () => ({ lines: [], optional: [] }), budget: 400 },
    hooks: { beforeGenerate: () => [] },
    settings: { defaults: { hardMode: false }, schema: { hardMode: { type: 'bool' } } },
    tabs: [{ id: 'party', title: 'Party', icon: 'fa-users', render: () => {} }],
});
const director = () => ({
    id: 'story-director',
    domains: { director: { initial: () => ({ time: { minutes: 0 }, threads: {} }) } },
    capture: { kinds: { quest: { grammar: '~ quest Name — step', aliases: ['quests', 'bounty'] } }, apply: () => ({}) },
    hooks: { beforeGenerate: () => [] },
});

test('a module registers and every lookup finds it', () => {
    const registry = createRegistry();
    registry.register(party());
    assert.equal(registry.domainOwner('party'), 'rpg-battle');
    assert.equal(registry.domainOwner('combat'), 'rpg-battle');
    assert.equal(registry.domainOwner('scene'), null);
    assert.equal(registry.commandOwner('item.use'), 'rpg-battle');
    assert.equal(registry.commandOwner('nope'), null);
    assert.equal(registry.captureOwner('wound'), 'rpg-battle');
    assert.equal(registry.captureOwner('WOUND'), 'rpg-battle');
    assert.equal(registry.captureOwner('quest'), null);
    assert.equal(typeof registry.command('item.use'), 'function');
    assert.equal(registry.command('nope'), null);
    assert.equal(registry.capture('check').moduleId, 'rpg-battle');
    assert.equal(registry.capture('check').grammar, '? check skill — what | dc: easy|normal|hard');
    assert.equal(typeof registry.validator('party'), 'function');
    assert.equal(registry.validator('combat'), null);
    assert.equal(typeof registry.query('party.actors'), 'function');
    assert.equal(registry.queryOwner('party.actors'), 'rpg-battle');
    assert.deepEqual(registry.tabs().map(tab => [tab.moduleId, tab.id]), [['rpg-battle', 'party']]);
    assert.deepEqual(registry.settingsDefs().map(def => [def.moduleId, def.defaults]), [['rpg-battle', { hardMode: false }]]);
    assert.deepEqual(registry.contexts()[0].kinds.map(kind => kind.kind), ['check', 'wound'], 'kinds in name order');
});

test('modules come back sorted by id; hooks in module-id order', () => {
    const registry = createRegistry();
    registry.register(director());
    registry.register(party());
    registry.register({ id: 'aaa-first', hooks: { beforeGenerate: () => ['first'] } });
    assert.deepEqual(registry.modules().map(def => def.id), ['aaa-first', 'rpg-battle', 'story-director']);
    assert.equal(registry.hooks('beforeGenerate').length, 3);
    assert.deepEqual(registry.hookEntries('beforeGenerate').map(entry => entry.moduleId), ['aaa-first', 'rpg-battle', 'story-director']);
    assert.deepEqual(registry.hooks('item.define'), []);
});

test('capture aliases lead to the canonical kind', () => {
    const registry = createRegistry();
    registry.register(director());
    assert.equal(registry.kindOf('Quests'), 'quest');
    assert.equal(registry.capture('quests').kind, 'quest');
    assert.equal(registry.captureOwner('bounty'), 'story-director');
    assert.equal(registry.kindOf('agenda'), null);
});

test('initialState: meta plus every domain\'s initial(), keys sorted', () => {
    const registry = createRegistry();
    registry.register(party());
    registry.register(director());
    const state = registry.initialState();
    assert.deepEqual(state, {
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: { combat: { session: null }, director: { time: { minutes: 0 }, threads: {} }, party: { actors: {}, order: [] } },
    });
    assert.deepEqual(Object.keys(state.domains), ['combat', 'director', 'party']);
    state.domains.party.order.push('x');
    assert.deepEqual(registry.initialState().domains.party.order, [], 'each call is a fresh copy');
    assert.deepEqual(createRegistry().initialState(), { v: 2, meta: { rev: 0, claims: {} }, domains: {} });
});

test('the registry\'s own commands: capture.<kind> runs the owner\'s apply; module.init.<id> sets up its domains', () => {
    const registry = createRegistry();
    registry.register(party());
    registry.register(director());
    assert.equal(registry.commandOwner(`${CAPTURE_PREFIX}quest`), 'story-director');
    assert.equal(registry.commandOwner(`${CAPTURE_PREFIX}quests`), 'story-director');
    assert.equal(registry.command(`${CAPTURE_PREFIX}nothing`), null);
    assert.deepEqual(registry.command(`${CAPTURE_PREFIX}wound`)({}, { name: 'Ren' }), { summary: 'Ren' });

    assert.equal(registry.commandOwner(`${INIT_PREFIX}rpg-battle`), 'rpg-battle');
    assert.equal(registry.command(`${INIT_PREFIX}nobody`), null);
    const drafts = { party: { stale: true }, combat: {} };
    const out = registry.command(`${INIT_PREFIX}rpg-battle`)({ draft: name => drafts[name], fail: (code, message) => { throw new Error(message); } });
    assert.deepEqual(drafts, { party: { actors: {}, order: [] }, combat: { session: null } });
    assert.equal(out.narrate, false);
});

test('clashes are refused with a plain sentence, and nothing of the refused module is kept', () => {
    const registry = createRegistry();
    registry.register(party());
    const clash = (def, pattern) => assert.throws(() => registry.register(def), error => pattern.test(error.message));
    clash({ id: 'rpg-battle' }, /module "rpg-battle" cannot be registered: a module with this id is already registered\./);
    clash({ id: 'two', domains: { party: { initial: () => ({}) } } }, /the domain "party" already belongs to "rpg-battle"/);
    clash({ id: 'two', commands: { 'item.use': () => ({}) } }, /the command "item.use" already belongs to "rpg-battle"/);
    clash({ id: 'two', queries: { 'party.actors': () => [] } }, /the query "party.actors" already belongs to "rpg-battle"/);
    clash({ id: 'two', capture: { kinds: { wound: { grammar: '~ wound X' } }, apply: () => ({}) } }, /the capture kind "wound" already belongs to "rpg-battle"/);
    clash({ id: 'two', tabs: [{ id: 'party', title: 'Mine', render: () => {} }] }, /the tab "party" already belongs to "rpg-battle"/);
    clash({ id: 'two', capture: { kinds: { a: { grammar: '+ a X', aliases: ['b'] }, b: { grammar: '+ b X' } }, apply: () => ({}) } }, /the capture kind "b" is named twice in it/);
    // Two clashes at once are listed together.
    clash({ id: 'two', domains: { party: { initial: () => ({}) } }, commands: { 'item.use': () => ({}) } }, /\n- the domain "party".*\n- the command "item.use"/s);
    // None of the refused modules left anything behind.
    assert.deepEqual(registry.modules().map(def => def.id), ['rpg-battle']);
    registry.register({ id: 'two', domains: { other: { initial: () => ({}) } } });
    assert.equal(registry.domainOwner('other'), 'two');
});

test('definitions that are not modules are refused with what is wrong', () => {
    const problems = def => definitionProblems(def).join(' / ');
    assert.match(problems(null), /not an object/);
    assert.match(problems({ id: 'Bad Id' }), /its id must be lowercase/);
    // A field this host does not know (a newer module's) is a warning, not a refusal (SPEC §6).
    assert.deepEqual(definitionProblems({ id: 'x', command: {} }), []);
    assert.match(definitionWarnings({ id: 'x', command: {} }).join(' / '), /"command" is not a module field this Story Block knows; it is ignored/);
    assert.match(problems({ id: 'x', requires: '2.0' }), /requires is not an object/);
    assert.match(problems({ id: 'x', requires: { storyBlock: 'soon' } }), /requires.storyBlock is not a version range/);
    assert.match(problems({ id: 'x', domains: { party: {} } }), /domain "party" initial is not a function/);
    assert.match(problems({ id: 'x', domains: { 'a/b': { initial: () => ({}) } } }), /domain name "a\/b"/);
    assert.match(problems({ id: 'x', domains: { a: { initial: () => ({ when: new Date() }) } } }), /\/domains\/a\/when is not plain JSON/);
    assert.match(problems({ id: 'x', domains: { a: { initial: () => ({ n: NaN }) } } }), /not a finite number/);
    assert.match(problems({ id: 'x', domains: { a: { initial: () => [] } } }), /does not return an object/);
    assert.match(problems({ id: 'x', domains: { a: { initial: () => { throw new Error('boom'); } } } }), /initial\(\) threw: boom/);
    assert.match(problems({ id: 'x', commands: { 'capture.item': () => ({}) } }), /prefix Story Block keeps/);
    assert.match(problems({ id: 'x', commands: { 'module.init.x': () => ({}) } }), /prefix Story Block keeps/);
    assert.match(problems({ id: 'x', commands: { 'item use': () => ({}) } }), /words joined by dots/);
    assert.match(problems({ id: 'x', commands: { 'item.use': 'no' } }), /command "item.use" is not a function/);
    assert.match(problems({ id: 'x', capture: { kinds: {}, apply: () => ({}) } }), /names no kind/);
    assert.match(problems({ id: 'x', capture: { kinds: { item: { grammar: '' } }, apply: () => ({}) } }), /has no grammar line/);
    assert.match(problems({ id: 'x', capture: { kinds: { item: { grammar: 'a\nb' } }, apply: () => ({}) } }), /more than one line/);
    assert.match(problems({ id: 'x', capture: { kinds: { Item: { grammar: '+ item X' } }, apply: () => ({}) } }), /capture kind "Item" must be lowercase/);
    assert.match(problems({ id: 'x', capture: { kinds: { item: { grammar: '+ item X' } } } }), /capture.apply is not a function/);
    assert.match(problems({ id: 'x', context: { budget: 0 } }), /budget is not a positive whole number/);
    // A newer module's field type is hidden, not a refusal (R2-b7-2).
    assert.equal(problems({ id: 'x', settings: { schema: { a: { type: 'colour' } } } }), '');
    assert.match(definitionWarnings({ id: 'x', settings: { schema: { a: { type: 'colour' }, b: { type: 'list', of: { c: 'slider' } } } } }).join(), /"a" has the type "colour".*hidden.*"b\.c" has the type "slider"/);
    assert.match(problems({ id: 'x', settings: { schema: { a: {} } } }), /settings field "a" has no type/);
    assert.match(problems({ id: 'x', settings: { schema: { a: { type: 'choice', options: [] } } } }), /choice with no options/);
    assert.match(problems({ id: 'x', settings: { schema: { a: { type: 'list' } } } }), /list with no fields/);
    assert.match(problems({ id: 'x', settings: { schema: { a: { type: 'int', min: 0.5 } } } }), /min is not a whole number/);
    assert.match(problems({ id: 'x', settings: { defaults: { a: undefined } } }), /not plain JSON/);
    assert.match(problems({ id: 'x', tabs: [{ id: 'a', render: () => {} }] }), /tab "a" has no title/);
    assert.match(problems({ id: 'x', tabs: {} }), /tabs is not a list/);
    assert.deepEqual(definitionProblems(party()), []);
    assert.deepEqual(definitionProblems({ id: 'x', settings: { schema: { a: 'bool', b: ['one', 'two'], c: { type: 'list', of: { name: 'text', n: { type: 'int' } } } } } }), []);
    assert.throws(() => createRegistry().register({ id: 'x', domains: { party: {} } }), /module "x" cannot be registered: domain "party" initial is not a function\./);
});

test('screens and widgets (§13): namespaced, listed in module-id order, clashes refused', () => {
    const registry = createRegistry();
    registry.register({
        id: 'rpg-battle',
        screens: [{ id: 'rpg-battle/party', title: 'Party' }, { id: 'rpg-battle/fight' }],
        widgets: { 'rpg-battle.battle-board': { props: {}, render: () => {} } },
    });
    registry.register({ id: 'fishing-activity', widgets: { 'fishing-activity.fishing': { render: () => {} } } });
    assert.deepEqual(registry.screens().map(screen => [screen.moduleId, screen.id]), [['rpg-battle', 'rpg-battle/party'], ['rpg-battle', 'rpg-battle/fight']]);
    assert.deepEqual(registry.widgets().map(widget => [widget.moduleId, widget.name]), [['fishing-activity', 'fishing-activity.fishing'], ['rpg-battle', 'rpg-battle.battle-board']]);
    assert.equal(registry.widget('rpg-battle.battle-board').moduleId, 'rpg-battle');
    assert.equal(registry.widget('ss.meter'), null);
    assert.throws(() => registry.register({ id: 'other', screens: [{ id: 'rpg-battle/party' }] }), /the screen "rpg-battle\/party" already belongs to "rpg-battle"/);
    assert.match(definitionProblems({ id: 'x', widgets: { board: { render: () => {} } } }).join(), /must start with the module id and a dot \(like "x.board"\)/);
    assert.match(definitionProblems({ id: 'x', widgets: { 'y.board': { render: () => {} } } }).join(), /must start with the module id/);
    assert.match(definitionProblems({ id: 'x', widgets: { 'x.board': {} } }).join(), /widget "x.board" render is not a function/);
    assert.match(definitionProblems({ id: 'x', screens: [{ id: 'Bad Id' }] }).join(), /screen 1 has no usable id/);
    assert.match(definitionProblems({ id: 'x', screens: {} }).join(), /screens is not a list/);
});

test('settings.section: the panel itself, or a title with render(el, api)', () => {
    const registry = createRegistry();
    const render = () => {};
    const panel = () => {};
    registry.register({ id: 'a', name: 'A', settings: { section: 'Combat', render, defaults: { x: 1 } } });
    registry.register({ id: 'b', name: 'B', settings: { section: panel } });
    registry.register({ id: 'c', name: 'C', settings: { section: 'Only a title' } });
    assert.deepEqual(registry.settingsDefs().map(def => [def.moduleId, def.title, def.section]), [['a', 'Combat', render], ['b', 'B', panel], ['c', 'Only a title', null]]);
    assert.match(definitionProblems({ id: 'x', settings: { render: 'no' } }).join(), /settings.render is not a function/);
    assert.match(definitionProblems({ id: 'x', settings: { section: 3 } }).join(), /settings.section is not a function/);
    assert.deepEqual(definitionProblems({ id: 'x', settings: { panel: () => {} } }), [], 'a newer settings part is not a refusal (R2-b7-2)');
    assert.match(definitionWarnings({ id: 'x', settings: { panel: () => {} } }).join(), /"settings.panel" is not a settings field this Story Block knows; it is ignored/);
});

test('internal commands: capture.*, module.init.* and commands marked internal (object form or flagged handler)', () => {
    const registry = createRegistry();
    registry.register(party());
    const flagged = () => ({ summary: 'flagged' });
    flagged.internal = true;
    const host = { id: 'host-steps', domains: { steps: { initial: () => ({}) } },
        commands: { 'steps.run': { handler: () => ({ summary: 'ran' }), internal: true }, 'steps.flag': flagged, 'steps.open': { handler: () => ({}) } } };
    registry.register(host);
    assert.equal(registry.isInternal(`${CAPTURE_PREFIX}wound`), true);
    assert.equal(registry.isInternal(`${CAPTURE_PREFIX}nothing`), true, 'the whole prefix, whether or not a kind answers');
    assert.equal(registry.isInternal(`${INIT_PREFIX}rpg-battle`), true);
    assert.equal(registry.isInternal('steps.run'), true);
    assert.equal(registry.isInternal('steps.flag'), true);
    assert.equal(registry.isInternal('steps.open'), false);
    assert.equal(registry.isInternal('item.use'), false);
    assert.equal(registry.isInternal('no.such'), false);
    assert.equal(typeof registry.command('steps.run'), 'function', 'the object form hands out its handler');
    assert.equal(registry.command('steps.run')().summary, 'ran');
    assert.equal(registry.commandOwner('steps.run'), 'host-steps');
    assert.deepEqual(definitionProblems({ id: 'bad', commands: { 'bad.a': { handler: 1 }, 'bad.b': { handler: () => {}, internal: 'yes' }, 'bad.c': { handler: () => {}, extra: 1 } } }), [
        'command "bad.a" handler is not a function',
        'command "bad.b" internal is not true or false',
    ]);
    assert.deepEqual(definitionWarnings({ id: 'bad', commands: { 'bad.c': { handler: () => {}, extra: 1 } } }), ['"extra" on command "bad.c" is not a command field this Story Block knows; it is ignored']);
});
