// Head-state mounts (SPEC §13.4): tab, the full-screen game view and the hud strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHudMount, createScreenMount, createTabMount, createMounts } from '../../../../src/v2/view/mounts/index.js';
import { fakeChat, fakeQuery, fakeRenderer, screen, screensWith, setupDom } from './helpers.js';

function world(defs, extra = {}) {
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 2, 3]);
    const render = fakeRenderer();
    const query = fakeQuery();
    const listeners = {};
    const deps = {
        screens: screensWith(defs),
        render,
        query,
        stateAt: chat.stateAt,
        headIndex: chat.headIndex,
        settings: () => ({ compact: true }),
        api: { command: () => ({ ok: true }) },
        on: (event, fn) => {
            (listeners[event] ??= []).push(fn);
            return () => { listeners[event] = listeners[event].filter(item => item !== fn); };
        },
        ...extra,
    };
    const emit = event => (listeners[event] ?? []).forEach(fn => fn());
    return { doc, chat, render, query, deps, emit, listeners };
}

test('tab: registers each tab screen with the tab host and draws it from the view state', () => {
    const { doc, chat, render, query, deps } = world([
        screen('m/party', ['tab', 'screen'], { data: { hp: { query: 'party.hp' } }, theme: { '--ss-accent': '#123456' } }),
        screen('m/hud', ['hud']),
        screen('a/inv', ['tab']),
    ]);
    const added = [];
    const removed = [];
    const tabs = createTabMount({ ...deps, addTab: tab => { added.push(tab); return () => removed.push(tab.id); } });
    // Navigation order: a party screen before the rest (screens.js screenOrder).
    assert.deepEqual(tabs.register(), ['m/party', 'a/inv']);
    assert.deepEqual(added.map(tab => [tab.id, tab.title, tab.icon]), [['m/party', 'party', 'fa-star'], ['a/inv', 'inv', 'fa-star']]);

    const el = doc.createElement('div');
    const view = { state: chat.states[2] };
    const handle = added[0].render(el, view, null);
    assert.equal(handle.result.ok, true);
    const { screen: drawn, scope } = render.last();
    assert.equal(drawn.id, 'm/party');
    assert.equal(scope.state, chat.states[2]);
    assert.deepEqual(scope.q, { hp: 30 });
    assert.equal(query.calls[0].state, chat.states[2]);
    assert.deepEqual([scope.mount, scope.index, scope.settings, scope.draft], ['tab', 2, { compact: true }, null]);
    assert.equal(el.getAttribute('data-ss-screen'), 'm/party');
    assert.equal(el.style.getPropertyValue('--ss-accent'), '#123456');

    // Registering again replaces the earlier set.
    tabs.register();
    assert.deepEqual(removed, ['m/party', 'a/inv']);
});

test('a mount shows a plain line instead of a broken screen', () => {
    const { doc, deps } = world([
        screen('m/hud', ['hud']),
        screen('m/cycle', ['tab'], { data: { a: { query: 'echo', args: { x: '$a' } } } }),
    ]);
    const tabs = createTabMount(deps);
    const el = doc.createElement('div');
    assert.match(tabs.mount(el, 'm/hud').result.message, /not made to be shown as a tab/);
    assert.match(el.textContent, /not made to be shown as a tab/);
    assert.match(tabs.mount(el, 'm/none').result.message, /"m\/none" cannot be shown/);
    // The cycle fails validation, so there is no usable version at all; the reason is shown.
    assert.match(tabs.mount(el, 'm/cycle').result.message, /depend on each other/);
});

test('a renderer error and its cleanup are handled', () => {
    const { doc, deps } = world([screen('m/a', ['tab'])]);
    let disposed = 0;
    const tabs = createTabMount({ ...deps, render: () => () => { disposed++; } });
    const el = doc.createElement('div');
    const handle = tabs.mount(el, 'm/a');
    handle.update();
    assert.equal(disposed, 1);
    handle.unmount();
    assert.equal(disposed, 2);
    const failing = createTabMount({ ...deps, render: () => { throw new Error('bad template'); } });
    assert.match(failing.mount(el, 'm/a').result.message, /could not be drawn: bad template/);
});

test('screen: a full-screen view with navigation between screen screens; Esc closes it', () => {
    const { doc, chat, render, deps, emit, listeners } = world([
        screen('m/party', ['tab', 'screen']),
        screen('m/map', ['screen'], { title: 'Map', icon: 'fa-map', theme: { '--ss-accent': 'teal' } }),
        screen('m/tab-only', ['tab']),
    ]);
    const view = createScreenMount(deps);
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus();
    assert.equal(view.open('m/map'), true);
    const root = doc.body.querySelector('.ss-gameview');
    assert.ok(root);
    assert.equal(root.getAttribute('aria-modal'), 'true');
    const items = root.querySelectorAll('.ss-gameview-navitem');
    assert.deepEqual(items.map(item => item.getAttribute('data-ss-target')), ['m/party', 'm/map'], 'party before map');
    assert.equal(items[1].getAttribute('aria-current'), 'page');
    assert.equal(root.querySelector('.ss-gameview-title').textContent, 'Map');
    assert.equal(render.last().screen.id, 'm/map');
    assert.equal(render.last().scope.state, chat.states[2]);

    const body = root.querySelector('.ss-gameview-body');
    assert.equal(body.style.getPropertyValue('--ss-accent'), 'teal');
    items[0].click();
    assert.equal(view.current(), 'm/party');
    assert.equal(body.style.getPropertyValue('--ss-accent'), '', 'the last screen\'s theme is dropped');
    assert.equal(render.last().screen.id, 'm/party');
    assert.equal(root.querySelector('[aria-current="page"]').getAttribute('data-ss-target'), 'm/party');

    // The head changes while open: redraws with the new head.
    chat.states[2] = Object.freeze({ ...chat.states[2], meta: { rev: 9, claims: {} } });
    const before = render.calls.length;
    emit('head');
    assert.equal(render.calls.length, before + 1);
    assert.equal(render.last().scope.state.meta.rev, 9);

    const event = doc.key('Escape');
    assert.equal(event.defaultPrevented, true);
    assert.equal(view.isOpen(), false);
    assert.equal(doc.body.querySelector('.ss-gameview'), null);
    assert.equal(doc.activeElement, opener);
    assert.equal(doc.listeners.length, 0);
    assert.equal(listeners.head.length, 0);
    doc.key('Escape');   // nothing open: nothing happens

    // Unknown id opens the first; the close button closes; a single screen hides the nav.
    assert.equal(view.open('m/zzz'), true);
    assert.equal(view.current(), 'm/party', 'the first in navigation order');
    doc.body.querySelector('.ss-gameview-close').click();
    assert.equal(view.isOpen(), false);
});

test('screen: nothing to open when no screen allows it; a lone screen hides the navigation', () => {
    const empty = world([screen('m/tab', ['tab'])]);
    assert.equal(createScreenMount(empty.deps).open(), false);
    const single = world([screen('m/one', ['screen'])]);
    const view = createScreenMount(single.deps);
    view.open();
    assert.ok(single.doc.body.querySelector('.ss-gameview').classList.contains('ss-gameview-single'));
    view.destroy();
});

test('hud: a strip right above #send_form with each hud screen, redrawn on head changes', () => {
    const { doc, chat, render, deps, emit } = world([
        screen('m/hp', ['hud'], { data: { hp: { query: 'party.hp' } } }),
        screen('m/time', ['hud', 'tab']),
        screen('m/tab', ['tab']),
    ]);
    const sheld = doc.createElement('div');
    const form = doc.createElement('form');
    form.id = 'send_form';
    sheld.appendChild(form);
    doc.body.appendChild(sheld);
    const hud = createHudMount(deps);
    const strip = hud.show();
    assert.equal(strip.nextElementSibling, form);
    assert.equal(strip.parentNode, sheld);
    assert.deepEqual(strip.querySelectorAll('.ss-hud-item').map(item => item.getAttribute('data-ss-screen')), ['m/hp', 'm/time']);
    assert.ok(render.calls.every(call => call.scope.state === chat.states[2] && call.scope.mount === 'hud'));
    assert.deepEqual(render.calls[0].scope.q, { hp: 30 });

    hud.show();   // idempotent
    assert.equal(sheld.querySelectorAll('.ss-hud').length, 1);

    const before = render.calls.length;
    emit('committed');
    assert.equal(render.calls.length, before + 2);
    hud.hide();
    assert.equal(sheld.querySelector('.ss-hud'), null);
    emit('head');
    assert.equal(render.calls.length, before + 2);

    // An injected anchor; no anchor at all gives null.
    const anchor = doc.createElement('div');
    sheld.appendChild(anchor);
    assert.equal(createHudMount({ ...deps, anchor: () => anchor }).show().nextElementSibling, anchor);
    assert.equal(createHudMount({ ...deps, anchor: () => null }).show(), null);
});

test('enabled(mount, id) lets the reader turn screens off; createMounts builds all five', () => {
    const { deps } = world([screen('m/a', ['tab']), screen('m/b', ['tab'])]);
    const added = [];
    const tabs = createTabMount({ ...deps, addTab: tab => added.push(tab.id), enabled: (mount, id) => id !== 'm/a' });
    tabs.register();
    assert.deepEqual(added, ['m/b']);
    const all = createMounts({ ...deps, carriers: () => [0] });
    assert.deepEqual(Object.keys(all), ['tab', 'screen', 'card', 'hud', 'dialog']);
    assert.ok(Object.values(all).every(controller => typeof controller.mount === 'function'));
    assert.equal(createMounts(deps).card, null);
});
