// The renderer the mounts are given (src/v2/view/render-screen.js), the dialog's onDraft for widgets
// that edit the draft, and the host's `ss.*` widget names in the registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenRenderer, layoutEvaluator } from '../../../src/v2/view/render-screen.js';
import { createDialogMount } from '../../../src/v2/view/mounts/dialog.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createCoreModule } from '../../../src/v2/domains/index.js';
import { standardWidgets } from '../../../src/v2/view/widgets/index.js';
import { fakeApi, fakeChat, fakeQuery, screensWith, setupDom } from './mounts/helpers.js';

const state = { v: 2, meta: { rev: 3, claims: {} }, domains: { n: 4 } };
const queryAt = (name, args, at) => (name === 'n' ? at.domains.n : null);

function setup(headIndex = 5) {
    const doc = setupDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const renderer = createScreenRenderer({ queryAt, widgets: () => ({ ...standardWidgets }), headIndex: () => headIndex });
    return { doc, el, renderer };
}

const button = { type: 'button', label: 'Go', command: 'x.go' };
const layoutScreen = root => ({ id: 'test/one', mounts: ['tab', 'card'], layout: { root } });

test('a layout screen queries the state the mount shows and runs commands at the head', async () => {
    const { el, renderer } = setup();
    const calls = [];
    const api = { command: async (type, payload) => { calls.push(type); return { ok: true }; } };
    renderer.render(el, layoutScreen({ type: 'col', children: [{ type: 'text', value: { query: 'n' } }, button] }), { state, api, mount: 'tab', index: 5 });
    assert.match(el.textContent, /4/);
    const go = el.querySelector('button');
    assert.notEqual(go.disabled, true);
    go.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['x.go']);
});

test('a card under an older reply is read-only: its buttons are disabled', () => {
    const { el, renderer } = setup(5);
    renderer.render(el, layoutScreen(button), { state, api: { command: async () => ({ ok: true }) }, mount: 'card', index: 2 });
    assert.equal(el.querySelector('button').disabled, true);
    renderer.render(el, layoutScreen(button), { state, api: { command: async () => ({ ok: true }) }, mount: 'card', index: 5 });
    assert.notEqual(el.querySelector('button').disabled, true, 'the newest reply\'s card can act');
});

test('layout conditions use the events language with the row and the query in scope', () => {
    const evaluate = layoutEvaluator({ state, q: { pc: { hp: 3 } } });
    assert.equal(evaluate('item.points > 0', { item: { points: 2 }, index: 0, query: () => null }), true);
    assert.equal(evaluate("query('n') == 4", { query: name => (name === 'n' ? 4 : null) }), true);
    assert.equal(evaluate('q.pc.hp >= 5', {}), false);
    assert.throws(() => evaluate('item.points >', { item: {} }));
});

test('a template screen: bindings, the query at the mount\'s state, scoped css; off says so', () => {
    const { doc, el, renderer } = setup();
    const screen = { id: 'test/tpl', mounts: ['tab'], template: '<b class="n">{{ q.n }}</b><i data-if="q.n > 3">big</i>', css: '.n { color: red; }' };
    renderer.render(el, screen, { state, q: { n: queryAt('n', {}, state) }, api: {}, mount: 'tab' });
    assert.equal(el.querySelector('.n').textContent, '4');
    assert.match(el.textContent, /big/);
    const style = doc.head.querySelector('#ss-css-test_tpl');
    assert.ok(style, 'the screen css is put in the head once');
    assert.match(style.textContent, /\[data-ss-screen="test\/tpl"\] \.n/);
    renderer.setTemplates(null);
    assert.equal(renderer.hasTemplates(), false);
    renderer.render(el, screen, { state, api: {}, mount: 'tab' });
    assert.match(el.textContent, /template screens are not available/);
    const seen = [];
    renderer.setTemplates({
        compileTemplate: html => ({ html }),
        renderTemplate: (target, compiled, scope, options) => { seen.push([compiled.html, typeof options.command, typeof scope.query]); target.textContent = 'drawn'; return { destroy() {} }; },
    });
    const dispose = renderer.render(el, screen, { state, api: { command: () => {} }, mount: 'tab' });
    assert.equal(el.textContent, 'drawn');
    assert.deepEqual(seen, [[screen.template, 'function', 'function']]);
    assert.equal(typeof dispose, 'function');
});

test('the dialog gives widgets onDraft: the value lands in the draft and the step is drawn again', () => {
    const doc = setupDom();
    const chat = fakeChat(doc, [1]);
    const scopes = [];
    const render = (el, screen, scope) => { scopes.push(scope); };
    const wizard = { id: 'game/make', title: 'Make', mounts: ['dialog'], template: '<div></div>' };
    const dialogs = createDialogMount({ screens: screensWith([wizard]), render, query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api: fakeApi() });
    const handle = dialogs.open('game/make', { draft: { stats: { STR: 1 } } });
    const before = scopes.length;
    scopes.at(-1).api.onDraft('stats.STR', 3);
    assert.equal(handle.draft.stats.STR, 3);
    assert.equal(scopes.length, before + 1);
    assert.equal(scopes.at(-1).draft.stats.STR, 3);
    scopes.at(-1).api.onDraft('__proto__.x', 1);
    assert.equal({}.x, undefined);
    handle.close();
});

test('the host registers the ss.* widgets; any other module must use its own id', () => {
    const registry = createRegistry();
    registry.register(createCoreModule());
    assert.deepEqual(registry.widgets().map(widget => widget.name), Object.keys(standardWidgets).sort());
    assert.ok(registry.widget('ss.stepper'));
    assert.throws(() => registry.register({ id: 'rpg-battle', widgets: { 'ss.board': { render() {} } } }), /must start with the module id/);
    registry.register({ id: 'rpg-battle', widgets: { 'rpg-battle.board': { render() {} } } });
    assert.ok(registry.widget('rpg-battle.board'));
});

test('contains(a, b): case-insensitive text search for filter boxes, in templates', async () => {
    const { contains } = await import('../../../src/v2/view/bind.js');
    assert.equal(contains('Moonveil Trout', 'TROUT'), true);
    assert.equal(contains('Rope', 'lamp'), false);
    assert.equal(contains('Rope', ''), true, 'an empty filter keeps everything');
    assert.equal(contains(['Fenna', 'Bo'], 'fen'), true);
    assert.equal(contains(null, 'x'), false);
    const { el, renderer } = setup();
    renderer.render(el, { id: 'test/find', mounts: ['tab'], template: '<p data-each="q.names as n" data-if="contains(n, draft.find)">{{ n }}</p>' },
        { state, q: { names: ['Rope', 'Lamp', 'Rowboat'] }, draft: { find: 'ro' }, api: {}, mount: 'tab' });
    assert.deepEqual(el.querySelectorAll('p').map(node => node.textContent), ['Rope', 'Rowboat']);
});

test('card scopes carry the state before the reply and the reply\'s own ops; every scope has query()', async () => {
    const { createCardMount } = await import('../../../src/v2/view/mounts/card.js');
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 5, 9]);
    const scopes = [];
    const card = createCardMount({
        screens: screensWith([{ id: 'game/card', mounts: ['card'], template: '<div></div>' }]),
        render: (el, screen, scope) => { scopes.push(scope); },
        query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, carriers: chat.carriers, IntersectionObserver: null,
        opsAt: index => [{ op: 'remove', path: `/domains/x/${index}` }],
    });
    card.mount(doc.createElement('div'), 'game/card', { index: 2 });
    const scope = scopes.at(-1);
    assert.equal(scope.before, chat.states[1]);
    assert.deepEqual(scope.replyOps, [{ op: 'remove', path: '/domains/x/2' }]);
    assert.equal(scope.query('party.hp'), 90, 'query() at the card\'s own state');
    card.mount(doc.createElement('div'), 'game/card', { index: 0 });
    assert.equal(scopes.at(-1).before, null, 'the first carrier has nothing before it');
    card.destroy();
});

test('a card screen with defaultOn shows until the reader turns it off', async () => {
    const { createScreens } = await import('../../../src/v2/view/screens.js');
    let saved = {};
    const screens = createScreens({ reader: () => saved, saveReader: next => { saved = next; } });
    screens.addModule('story-block', [
        { id: 'story-block/changes-card', mounts: ['card'], template: '<p></p>', defaultOn: true },
        { id: 'story-block/other', mounts: ['card'], template: '<p></p>' },
    ]);
    assert.equal(screens.cardsOn('story-block/changes-card'), true);
    assert.equal(screens.cardsOn('story-block/other'), false);
    screens.setCards('story-block/changes-card', false);
    assert.equal(screens.cardsOn('story-block/changes-card'), false, 'the reader\'s off is kept');
    screens.setCards('story-block/other', true);
    assert.equal(screens.cardsOn('story-block/other'), true);
    screens.addModule('x', [{ id: 'x/bad', mounts: ['card'], template: '<p></p>', defaultOn: 'yes' }]);
    assert.equal(screens.resolve('x/bad').screen, null);
});
