// Sidebar: layout decision, tab/pane reconciliation, drawer/sheet open and close,
// pin/unpin, badges and the edge handle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, same, texts, visible } from './ui-fake-dom.js';

const doc = installFakeDom();

// What the fake DOM lacks and the sidebar feature-detects: document/window listeners,
// the viewport width and the pointer media query.
function listenable(target) {
    target.listeners = [];
    target.addEventListener = (type, fn, options) => target.listeners.push({ type, fn, capture: options === true || Boolean(options?.capture) });
    target.removeEventListener = (type, fn) => { target.listeners = target.listeners.filter(entry => entry.type !== type || entry.fn !== fn); };
    target.fire = (type, init = {}) => {
        const event = {
            type,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() {},
            ...init,
        };
        for (const entry of [...target.listeners]) if (entry.type === type) entry.fn(event);
        return event;
    };
    return target;
}
listenable(doc);
const win = listenable({ innerWidth: 1440, coarse: false });
win.matchMedia = query => ({ matches: query === '(pointer: coarse)' && win.coarse });
globalThis.window = win;

const { layoutMode, mountSidebar, unmountSidebar, openSidebar, closeSidebar, sidebarMode } = await import('../src/ui/sidebar.js');

// SillyTavern's chat column, as a fake element with a bounding rect.
const sheld = doc.createElement('div');
sheld.id = 'sheld';
sheld.rect = { left: 360, right: 1080, top: 40, bottom: 900, width: 720, height: 860 };
sheld.getBoundingClientRect = () => sheld.rect;
doc.body.appendChild(sheld);
const topBar = doc.createElement('div');
topBar.id = 'top-settings-holder';
topBar.getBoundingClientRect = () => ({ left: 0, right: 1440, top: 0, bottom: 40, width: 1440, height: 40 });
doc.body.appendChild(topBar);

function setViewport(width, { chatRight = 1080, coarse = false } = {}) {
    win.innerWidth = width;
    win.coarse = coarse;
    sheld.rect = { ...sheld.rect, right: chatRight };
}

let keyCounter = 0;
const freshKey = () => `chat-${keyCounter += 1}`;

function counted(id, label, { key, badge = 0, short } = {}) {
    const tab = {
        id, label, short, icon: '🎒', key, badge,
        renders: 0,
        render(pane) {
            tab.renders += 1;
            pane.replaceChildren();
            const input = doc.createElement('input');
            pane.append(`${label} #${tab.renders}`, input);
        },
    };
    return tab;
}

const sidebar = () => doc.querySelector('#story_block_sidebar');
const scrim = () => doc.querySelector('#story_block_scrim');
const handle = () => doc.querySelector('#story_block_handle');
const tabButtons = () => sidebar().querySelectorAll('.story-block-sidebar-tab');
const paneFor = id => sidebar().querySelector(`.story-block-pane[data-tab-id="${id}"]`);
const activeIds = () => tabButtons().filter(tab => tab.classList.contains('active')).map(tab => tab.dataset.tabId);
const closeButton = () => sidebar().querySelector('.story-block-sidebar-close');
const pinButton = () => sidebar().querySelector('.story-block-sidebar-pin');
const grip = () => sidebar().querySelector('.story-block-sidebar-grip');

function reset(width = 1440, options = {}) {
    unmountSidebar();
    setViewport(width, options);
    doc.activeElement = null;
}

test('layoutMode decides sheet, docked or drawer from the room beside the chat', () => {
    const chat = right => ({ left: right - 720, right });
    const cases = [
        ['phone', { viewportWidth: 390, chatRect: chat(390) }, 'sheet'],
        ['phone edge', { viewportWidth: 640, chatRect: chat(640) }, 'sheet'],
        ['tablet', { viewportWidth: 800, chatRect: chat(700) }, 'drawer'],
        ['wide tablet', { viewportWidth: 1024, chatRect: chat(700) }, 'docked'],
        ['wide with gutter', { viewportWidth: 1440, chatRect: chat(1080) }, 'docked'],
        ['wide, right drawer open', { viewportWidth: 1440, chatRect: chat(1080), blockedRight: 360 }, 'drawer'],
        ['wide, unpinned', { viewportWidth: 1440, chatRect: chat(1080), pinned: false }, 'drawer'],
        ['narrow desktop', { viewportWidth: 1024, chatRect: chat(900) }, 'drawer'],
        ['gutter exactly 324', { viewportWidth: 1404, chatRect: chat(1080) }, 'docked'],
        ['gutter 323', { viewportWidth: 1403, chatRect: chat(1080) }, 'drawer'],
        ['no chat column', { viewportWidth: 1440, chatRect: null }, 'drawer'],
    ];
    for (const [name, input, mode] of cases) assert.equal(layoutMode(input).mode, mode, name);

    assert.deepEqual(layoutMode({ viewportWidth: 1440, chatRect: chat(1080) }), { mode: 'docked', dockable: true, width: 336, right: 12 });
    assert.equal(layoutMode({ viewportWidth: 1920, chatRect: chat(1200) }).width, 380, 'width is capped');
    assert.equal(layoutMode({ viewportWidth: 1920, chatRect: chat(1200), blockedRight: 200 }).right, 212, 'docks left of an open drawer');
    const unpinned = layoutMode({ viewportWidth: 1440, chatRect: chat(1080), pinned: false });
    assert.equal(unpinned.dockable, true, 'an unpinned wide screen can still dock');
    assert.equal(layoutMode({ viewportWidth: 1024, chatRect: chat(900) }).dockable, false);
});

test('mounts one aside in a layer on the body; docked on a wide screen with its gutter geometry', () => {
    reset(1440);
    const aside = mountSidebar([counted('a', 'Inventory', { short: 'Items' }), counted('b', 'Sheet')], { uiKey: freshKey(), meta: 'reply #42' });
    same(aside, sidebar());
    same(aside.parentElement.parentElement, doc.body);
    assert.ok(aside.matches('aside.story-block-sidebar'));
    assert.equal(aside.dataset.mode, 'docked');
    assert.equal(sidebarMode(), 'docked');
    assert.equal(aside.style.getPropertyValue('--sb-dock-width'), '336px');
    assert.equal(aside.style.getPropertyValue('--sb-dock-right'), '12px');
    assert.equal(aside.style.getPropertyValue('--sb-dock-top'), '52px', 'below the top bar');
    assert.equal(aside.getAttribute('role'), null, 'docked is not a dialog');
    assert.equal(aside.getAttribute('aria-label'), 'Story Block');
    assert.equal(aside.querySelector('.story-block-sidebar-meta').textContent, 'reply #42');
    assert.deepEqual(texts(aside, '.story-block-sidebar-tab-short'), ['Items', 'Sheet']);
    assert.deepEqual(texts(aside, '.story-block-sidebar-tab-full'), ['Inventory', 'Sheet']);
    assert.equal(aside.querySelector('.story-block-sidebar-tabs').getAttribute('role'), 'tablist');
    assert.ok(tabButtons().every(tab => tab.getAttribute('role') === 'tab'));
    assert.deepEqual(activeIds(), ['a']);
    assert.equal(tabButtons()[0].getAttribute('aria-selected'), 'true');
    assert.equal(tabButtons()[1].getAttribute('aria-selected'), 'false');
    assert.ok(visible(paneFor('a')) && !visible(paneFor('b')));
    assert.equal(tabButtons()[0].getAttribute('aria-controls'), paneFor('a').id);
    assert.ok(!visible(handle()), 'no handle while docked');
    assert.ok(!visible(scrim()));
    assert.ok(!visible(closeButton()), 'docked has no close button');
    assert.ok(visible(pinButton()));
    assert.equal(pinButton().getAttribute('aria-label'), 'Unpin sidebar');
    assert.equal(doc.querySelectorAll('.story-block-sidebar').length, 1);
    mountSidebar([counted('a', 'A')], { uiKey: 'x' });
    assert.equal(doc.querySelectorAll('.story-block-sidebar').length, 1, 'still one sidebar');
});

test('re-mounting keeps the selected tab per uiKey; another chat has its own', () => {
    reset(1440);
    const one = freshKey();
    const two = freshKey();
    const tabs = [counted('a', 'A'), counted('b', 'B'), counted('c', 'C')];
    const aside = mountSidebar(tabs, { uiKey: one });
    tabButtons()[1].click();
    assert.deepEqual(activeIds(), ['b']);
    same(mountSidebar(tabs, { uiKey: one }), aside, 'same aside reused');
    assert.deepEqual(activeIds(), ['b']);

    mountSidebar(tabs, { uiKey: two });
    assert.deepEqual(activeIds(), ['a'], 'a new chat starts on its first tab');
    tabButtons()[2].click();
    mountSidebar(tabs, { uiKey: one });
    assert.deepEqual(activeIds(), ['b'], 'back to the first chat');

    unmountSidebar();
    mountSidebar(tabs, { uiKey: two });
    assert.deepEqual(activeIds(), ['c'], 'survives an unmount');

    mountSidebar([tabs[0], tabs[1]], { uiKey: two });
    assert.deepEqual(activeIds(), ['a'], 'falls back to the first tab when the selected one goes');
    assert.equal(paneFor('c'), null);
});

test('panes with an unchanged key are reused; a new key re-renders; tabs reorder in place', () => {
    reset(1440);
    const uiKey = freshKey();
    const keyed = counted('keyed', 'Keyed', { key: 'v1' });
    const free = counted('free', 'Free');
    mountSidebar([keyed, free], { uiKey });
    const pane = paneFor('keyed');
    pane.scrollTop = 140;
    const input = pane.querySelector('input');
    input.focus();
    mountSidebar([keyed, free], { uiKey });
    assert.equal(keyed.renders, 1);
    assert.equal(free.renders, 2);
    same(paneFor('keyed'), pane);
    assert.equal(pane.scrollTop, 140);
    same(doc.activeElement, input, 'focus survives');
    assert.ok(pane.classList.contains('story-block-pane'));
    keyed.key = 'v2';
    mountSidebar([free, keyed], { uiKey });
    assert.equal(keyed.renders, 2);
    assert.deepEqual(tabButtons().map(tab => tab.dataset.tabId), ['free', 'keyed']);
});

test('a failing render shows a notice in its pane instead of breaking the sidebar', () => {
    reset(1440);
    const original = console.error;
    console.error = () => {};
    try {
        mountSidebar([{ id: 'bad', label: 'Bad', render() { throw new Error('boom'); } }, counted('ok', 'OK')], { uiKey: freshKey() });
    } finally {
        console.error = original;
    }
    assert.match(paneFor('bad').textContent, /Bad could not be shown: boom/);
    assert.match(paneFor('ok').textContent, /OK #1/);
});

test('empty tabs remove the sidebar, scrim and handle', () => {
    reset(1000);
    mountSidebar([counted('a', 'A')], { uiKey: freshKey() });
    assert.ok(sidebar() && handle() && scrim());
    assert.equal(mountSidebar([], { uiKey: 'x' }), null);
    assert.equal(sidebar(), null);
    assert.equal(handle(), null);
    assert.equal(scrim(), null);
    assert.equal(openSidebar(), false, 'nothing to open');
});

test('drawer: handle opens, scrim/close/Esc close, focus and aria follow', () => {
    reset(1024, { chatRight: 900 });
    const aside = mountSidebar([counted('a', 'A', { badge: 2 }), counted('b', 'B', { badge: 3 })], { uiKey: freshKey() });
    assert.equal(aside.dataset.mode, 'drawer');
    assert.equal(sidebarMode(), 'drawer');
    assert.ok(!aside.classList.contains('is-open'));
    assert.equal(aside.getAttribute('aria-hidden'), 'true');
    assert.ok(visible(handle()));
    assert.ok(!visible(scrim()));
    assert.ok(!visible(pinButton()), 'no pin where docking is impossible');
    assert.ok(visible(closeButton()));
    assert.ok(!visible(grip()));

    handle().click();
    assert.ok(aside.classList.contains('is-open'));
    assert.equal(aside.getAttribute('role'), 'dialog');
    assert.equal(aside.getAttribute('aria-modal'), 'true');
    assert.equal(aside.getAttribute('aria-label'), 'Story Block');
    assert.equal(aside.getAttribute('aria-hidden'), null);
    assert.ok(visible(scrim()));
    assert.ok(!visible(handle()));
    assert.ok(aside.contains(doc.activeElement), 'focus moves into the panel');

    scrim().click();
    assert.ok(!aside.classList.contains('is-open'));
    assert.equal(aside.getAttribute('role'), null);
    assert.equal(aside.getAttribute('aria-modal'), null);
    assert.ok(visible(handle()));
    same(doc.activeElement, handle(), 'focus returns to the handle');

    assert.equal(openSidebar('b'), true);
    assert.deepEqual(activeIds(), ['b'], 'opens on the asked tab');
    same(doc.activeElement, tabButtons()[1]);
    closeButton().click();
    assert.ok(!aside.classList.contains('is-open'));

    openSidebar();
    const esc = doc.fire('keydown', { key: 'Escape' });
    assert.ok(!aside.classList.contains('is-open'), 'Esc closes');
    assert.ok(esc.defaultPrevented);
    assert.equal(doc.fire('keydown', { key: 'Escape' }).defaultPrevented, false, 'Esc is left alone while closed');

    openSidebar();
    // Focus in something above the drawer (a SillyTavern popup): Esc belongs to it.
    const popup = doc.createElement('input');
    doc.body.appendChild(popup);
    popup.focus();
    doc.fire('keydown', { key: 'Escape' });
    assert.ok(aside.classList.contains('is-open'));
    popup.remove();
    // (0.9.20) A search field in a pane with text in it: Esc is the field's (it clears it);
    // once empty, Esc closes the panel again.
    const search = doc.createElement('input');
    search.type = 'search';
    paneFor('b').appendChild(search);
    search.focus();
    search.value = 'wolf';
    const kept = doc.fire('keydown', { key: 'Escape', target: search });
    assert.ok(aside.classList.contains('is-open'), 'Esc with text in the field leaves the panel open');
    assert.equal(kept.defaultPrevented, false, 'and leaves the key to the field');
    search.value = '';
    doc.fire('keydown', { key: 'Escape', target: search });
    assert.ok(!aside.classList.contains('is-open'), 'an empty field: Esc closes');
    search.remove();
    assert.equal(closeSidebar(), false, 'already closed');
});

test('drawer: a swipe right closes it, a short or mouse drag does not', () => {
    reset(1024, { chatRight: 900 });
    const aside = mountSidebar([counted('a', 'A')], { uiKey: freshKey() });
    openSidebar();
    const pane = paneFor('a');
    const swipe = (dx, pointerType = 'touch') => {
        pane.dispatch('pointerdown', { pointerId: 1, pointerType, clientX: 100, clientY: 300 });
        pane.dispatch('pointermove', { pointerId: 1, pointerType, clientX: 100 + dx / 2, clientY: 302 });
        pane.dispatch('pointerup', { pointerId: 1, pointerType, clientX: 100 + dx, clientY: 304 });
    };
    swipe(40);
    assert.ok(aside.classList.contains('is-open'), 'short swipe snaps back');
    assert.equal(aside.style.transform, '');
    swipe(120, 'mouse');
    assert.ok(aside.classList.contains('is-open'), 'mouse drags select text instead');
    swipe(120);
    assert.ok(!aside.classList.contains('is-open'), 'swipe right closes');
});

test('drawer: arrow keys move between tabs; Tab is trapped inside while open', () => {
    reset(1024, { chatRight: 900 });
    mountSidebar([counted('a', 'A'), counted('b', 'B'), counted('c', 'C')], { uiKey: freshKey() });
    openSidebar();
    const tabs = tabButtons();
    tabs[0].dispatch('keydown', { key: 'ArrowRight' });
    assert.deepEqual(activeIds(), ['b']);
    same(doc.activeElement, tabs[1]);
    tabs[1].dispatch('keydown', { key: 'End' });
    assert.deepEqual(activeIds(), ['c']);
    tabs[2].dispatch('keydown', { key: 'ArrowRight' });
    assert.deepEqual(activeIds(), ['a'], 'wraps around');
    tabs[0].dispatch('keydown', { key: 'ArrowLeft' });
    assert.deepEqual(activeIds(), ['c']);
    assert.deepEqual(tabButtons().map(tab => tab.getAttribute('tabindex')), ['-1', '-1', '0'], 'roving tabindex');

    // Last focusable in the visible pane, then Tab wraps to the close button.
    const last = paneFor('c').querySelector('input');
    last.focus();
    const forward = last.dispatch('keydown', { key: 'Tab' });
    assert.ok(forward.defaultPrevented);
    same(doc.activeElement, closeButton());
    const back = closeButton().dispatch('keydown', { key: 'Tab', shiftKey: true });
    assert.ok(back.defaultPrevented);
    same(doc.activeElement, last);
});

test('sheet on phones: pill tabs, grip tap toggles height, drags expand or close', () => {
    reset(390, { chatRight: 390 });
    const aside = mountSidebar([counted('a', 'World'), counted('b', 'Items', { badge: 1 })], { uiKey: freshKey() });
    assert.equal(aside.dataset.mode, 'sheet');
    assert.ok(visible(grip()));
    assert.ok(!visible(pinButton()));
    assert.ok(visible(handle()));
    openSidebar();
    assert.equal(aside.getAttribute('role'), 'dialog');
    assert.ok(visible(scrim()));
    assert.equal(aside.dataset.sheet, 'half');

    grip().click();
    assert.equal(aside.dataset.sheet, 'full', 'tap expands');
    assert.equal(grip().getAttribute('aria-expanded'), 'true');
    grip().click();
    assert.equal(aside.dataset.sheet, 'half', 'tap again shrinks');

    const drag = (dy, target = grip()) => {
        target.dispatch('pointerdown', { pointerId: 7, clientY: 400 });
        target.dispatch('pointermove', { pointerId: 7, clientY: 400 + dy / 2 });
        target.dispatch('pointerup', { pointerId: 7, clientY: 400 + dy });
        // A real browser follows a drag with a click; it must not toggle again.
        target.click();
    };
    drag(-90);
    assert.equal(aside.dataset.sheet, 'full', 'drag up expands');
    assert.equal(aside.style.transform, '', 'snaps into place');
    assert.equal(grip().title, 'Drag down or tap to shrink');
    drag(40);
    assert.equal(aside.dataset.sheet, 'full', 'short drag snaps back');
    assert.ok(aside.classList.contains('is-open'));
    drag(120);
    assert.ok(aside.classList.contains('is-open'), 'drag down from full does not close');
    assert.equal(aside.dataset.sheet, 'half', 'it steps back to half height');
    drag(120);
    assert.ok(!aside.classList.contains('is-open'), 'drag down from half closes');
    same(doc.activeElement, handle());
    assert.ok(visible(handle()));

    openSidebar();
    assert.equal(aside.dataset.sheet, 'half', 'opens at the default height');
    const head = aside.querySelector('.story-block-sidebar-head');
    drag(-90, head);
    assert.equal(aside.dataset.sheet, 'full', 'the header drags too');
    drag(300, head);
    assert.ok(!aside.classList.contains('is-open'), 'a long drag from full closes');

    openSidebar();
    drag(-90);
    closeButton().dispatch('pointerdown', { pointerId: 8, clientY: 120 });
    closeButton().dispatch('pointerup', { pointerId: 8, clientY: 300 });
    closeButton().click();
    assert.ok(!aside.classList.contains('is-open'), 'the close button still closes a full sheet');

    openSidebar();
    doc.fire('keydown', { key: 'Escape' });
    assert.ok(!aside.classList.contains('is-open'));
});

test('one layer holds the scrim, sidebar and handle; focus never scrolls the page', () => {
    reset(390, { chatRight: 390 });
    const aside = mountSidebar([counted('a', 'World')], { uiKey: freshKey() });
    const layer = doc.querySelector('#story_block_layer');
    assert.ok(layer);
    same(aside.parentNode, layer);
    same(scrim().parentNode, layer);
    same(handle().parentNode, layer);
    assert.equal(layer.dataset.modal, 'false');

    const calls = [];
    const tab = aside.querySelector('.story-block-sidebar-tab');
    const realFocus = tab.focus;
    tab.focus = function (options) { calls.push(options); return realFocus.call(this, options); };
    openSidebar();
    assert.equal(layer.dataset.modal, 'true', 'an open sheet raises the layer');
    assert.deepEqual(calls, [{ preventScroll: true }]);
    closeSidebar();
    assert.equal(layer.dataset.modal, 'false');

    unmountSidebar();
    assert.equal(doc.querySelector('#story_block_layer'), null);
});

test('touch tablets get the drawer; only phone widths get the sheet', () => {
    reset(780, { chatRight: 780, coarse: true });
    assert.equal(mountSidebar([counted('a', 'A')], { uiKey: freshKey() }).dataset.mode, 'drawer');
    reset(600, { chatRight: 600, coarse: true });
    assert.equal(mountSidebar([counted('a', 'A')], { uiKey: freshKey() }).dataset.mode, 'sheet');
});

test('pin/unpin: docked Unpin calls onPinnedChange(false); wide drawer offers Pin', () => {
    reset(1440);
    const calls = [];
    const options = { uiKey: freshKey(), pinned: true, onPinnedChange: value => calls.push(value) };
    const aside = mountSidebar([counted('a', 'A', { badge: 1 })], options);
    assert.equal(aside.dataset.mode, 'docked');
    pinButton().click();
    assert.deepEqual(calls, [false]);
    assert.equal(aside.dataset.mode, 'drawer', 'unpinned on a wide screen behaves as a drawer');
    assert.ok(!aside.classList.contains('is-open'), 'tucked away');
    same(doc.activeElement, handle());
    assert.ok(visible(pinButton()), 'Pin stays available while the screen could dock');
    assert.equal(pinButton().getAttribute('aria-label'), 'Pin sidebar');
    assert.equal(pinButton().getAttribute('aria-pressed'), 'false');

    // The runtime saves the setting and re-mounts with pinned: false.
    mountSidebar([counted('a', 'A')], { ...options, pinned: false });
    assert.equal(aside.dataset.mode, 'drawer');
    openSidebar();
    assert.ok(visible(closeButton()));
    pinButton().click();
    assert.deepEqual(calls, [false, true]);
    assert.equal(aside.dataset.mode, 'docked');
    assert.equal(aside.getAttribute('role'), null);
    assert.ok(!visible(scrim()));
    assert.ok(!visible(handle()));
    assert.equal(closeSidebar(), false, 'docked cannot be closed');
    assert.equal(openSidebar(), true, 'docked open just selects');
});

test('Story Suite gear: in the header next to pin and close, shown only with showSuite and onSuite', () => {
    reset(1024, { chatRight: 900 });
    const opened = [];
    const gear = () => sidebar().querySelector('.story-block-sidebar-suite');
    mountSidebar([counted('a', 'A')], { uiKey: freshKey() });
    assert.ok(gear(), 'always built');
    assert.ok(!visible(gear()), 'hidden by default (Story Block alone)');
    const head = sidebar().querySelector('.story-block-sidebar-head');
    assert.deepEqual(head.children.slice(-3).map(node => node.className.split(' ')[1]), ['story-block-sidebar-suite', 'story-block-sidebar-pin', 'story-block-sidebar-close']);
    assert.equal(gear().getAttribute('aria-label'), 'Story Suite');
    assert.ok(gear().querySelector('i.fa-gear'));

    const options = { uiKey: 'suite-gear', onSuite: opener => opened.push(opener) };
    mountSidebar([counted('a', 'A')], { ...options, showSuite: false });
    assert.ok(!visible(gear()), 'fewer than two of the suite');
    mountSidebar([counted('a', 'A')], { ...options, showSuite: true });
    assert.ok(visible(gear()));
    openSidebar();
    const click = gear().click();
    same(opened[0], gear(), 'onSuite gets the button, so focus can come back to it');
    assert.ok(click.stopped, 'the click stays ours');
    assert.ok(sidebar().classList.contains('is-open'), 'the drawer stays open under the overlay');
    mountSidebar([counted('a', 'A')], { uiKey: 'suite-gear', showSuite: true });
    assert.ok(!visible(gear()), 'nothing to call: hidden');
    gear().click();
    assert.equal(opened.length, 1);
});

test('badges show on tabs and their sum on the handle', () => {
    reset(1024, { chatRight: 900 });
    mountSidebar([counted('a', 'Inventory', { badge: 2 }), counted('b', 'Sheet', { badge: 0 }), counted('c', 'Notes', { badge: 1 })], { uiKey: freshKey() });
    const badges = tabButtons().map(tab => tab.querySelector('.story-block-sidebar-badge'));
    assert.deepEqual(badges.map(badge => (visible(badge) ? badge.textContent : null)), ['2', null, '1']);
    assert.equal(tabButtons()[0].getAttribute('aria-label'), 'Inventory, 2 changes this turn');
    assert.equal(tabButtons()[1].getAttribute('aria-label'), 'Sheet');
    assert.equal(handle().getAttribute('aria-label'), 'Open Story Block, 3 changes this turn');
    assert.equal(handle().querySelector('.story-block-handle-count').textContent, '3');

    mountSidebar([counted('a', 'Inventory', { badge: 1 })], { uiKey: 'other' });
    assert.equal(handle().getAttribute('aria-label'), 'Open Story Block, 1 change this turn');
    mountSidebar([counted('a', 'Inventory')], { uiKey: 'other' });
    assert.equal(handle().getAttribute('aria-label'), 'Open Story Block');
    assert.ok(!visible(handle().querySelector('.story-block-handle-count')));
});

test('layout follows window resizes and SillyTavern drawers opening', () => {
    reset(1440);
    const observers = [];
    globalThis.MutationObserver = class {
        constructor(fn) { this.fn = fn; this.targets = []; observers.push(this); }
        observe(target, options) { this.targets.push({ target, options }); }
        disconnect() { this.targets = []; }
    };
    const panel = doc.createElement('div');
    panel.id = 'right-nav-panel';
    panel.className = 'closedDrawer';
    panel.getBoundingClientRect = () => ({ left: 1080, right: 1440, top: 0, bottom: 900, width: 360, height: 900 });
    doc.body.appendChild(panel);
    try {
        const aside = mountSidebar([counted('a', 'A')], { uiKey: freshKey() });
        assert.equal(aside.dataset.mode, 'docked');
        const watcher = observers.find(observer => observer.targets.some(entry => entry.target === panel));
        assert.ok(watcher, 'watches the right drawer');
        assert.deepEqual(watcher.targets[0].options.attributeFilter, ['class', 'style']);

        panel.className = 'openDrawer';
        watcher.fn([]);
        assert.equal(aside.dataset.mode, 'drawer', 'an open right drawer takes the gutter');
        panel.className = 'closedDrawer';
        watcher.fn([]);
        assert.equal(aside.dataset.mode, 'docked');

        win.innerWidth = 1000;
        win.fire('resize');
        assert.equal(aside.dataset.mode, 'drawer');
        assert.ok(!aside.classList.contains('is-open'), 'shrinking never opens a modal');
        win.innerWidth = 500;
        win.fire('resize');
        assert.equal(aside.dataset.mode, 'sheet');

        unmountSidebar();
        assert.equal(win.listeners.filter(entry => entry.type === 'resize').length, 0, 'resize listener removed');
        assert.equal(doc.listeners.filter(entry => entry.type === 'keydown').length, 0, 'Esc listener removed');
        assert.ok(observers.every(observer => observer.targets.length === 0), 'observers disconnected');
    } finally {
        delete globalThis.MutationObserver;
        panel.remove();
    }
});

test('labels and icons are text, never markup', () => {
    reset(1440);
    mountSidebar([counted('a', '<img src=x onerror=alert(1)>')], { uiKey: freshKey(), meta: '<b>reply</b>' });
    const tab = tabButtons()[0];
    assert.equal(tab.querySelector('.story-block-sidebar-tab-full').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(sidebar().querySelectorAll('img, b').length, 0);
    assert.equal(sidebar().querySelector('.story-block-sidebar-meta').textContent, '<b>reply</b>');
    unmountSidebar();
});

test('many tabs: the selected one is scrolled into the strip, a wheel scrolls the pills, the ends fade', () => {
    reset(390, { chatRight: 390 });
    const many = Array.from({ length: 10 }, (_, index) => counted(`t${index}`, `Tab ${index}`));
    const aside = mountSidebar(many, { uiKey: freshKey() });
    openSidebar();
    const strip = aside.querySelector('.story-block-sidebar-tabs');
    // The fake DOM has no layout: ten 80px pills in a 300px strip.
    Object.assign(strip, { scrollWidth: 800, clientWidth: 300, scrollHeight: 40, clientHeight: 40, scrollLeft: 0, scrollTop: 0, offsetLeft: 0, offsetTop: 0 });
    tabButtons().forEach((tab, index) => Object.assign(tab, { offsetLeft: index * 80, offsetWidth: 76, offsetTop: 0, offsetHeight: 36 }));

    tabButtons()[8].click();
    assert.deepEqual(activeIds(), ['t8']);
    assert.equal(strip.scrollLeft, 8 * 80 + 76 - 300, 'the picked tab is brought fully into sight');
    assert.equal(strip.getAttribute('data-overflow'), 'both');

    tabButtons()[0].click();
    assert.equal(strip.scrollLeft, 0);
    assert.equal(strip.getAttribute('data-overflow'), 'end');

    tabButtons()[9].click();
    assert.equal(strip.scrollLeft, 500, 'the last tab scrolls the strip to its very end');
    assert.equal(strip.getAttribute('data-overflow'), 'start');
    tabButtons()[0].click();

    const wheel = strip.dispatch('wheel', { deltaY: 120, deltaX: 0 });
    assert.equal(strip.scrollLeft, 120, 'a mouse wheel scrolls sideways');
    assert.ok(wheel.defaultPrevented, 'and not the page');
    const sideways = strip.dispatch('wheel', { deltaY: 0, deltaX: 40 });
    assert.equal(strip.scrollLeft, 120, 'a trackpad\'s own sideways swipe is left to the browser');
    assert.ok(!sideways.defaultPrevented);

    strip.scrollLeft = 500;
    strip.dispatch('scroll');
    assert.equal(strip.getAttribute('data-overflow'), 'start');

    // Everything fits: no fade, and the wheel is the page's.
    Object.assign(strip, { scrollWidth: 300, scrollLeft: 0 });
    strip.dispatch('scroll');
    assert.equal(strip.getAttribute('data-overflow'), null);
    assert.ok(!strip.dispatch('wheel', { deltaY: 120, deltaX: 0 }).defaultPrevented);
});

// (0.9.20) The row stays one line: labels while they fit, icons only when they would not.
test('the tab row shows icons only when the labels would not fit, and labels again when they do', () => {
    setViewport(1440);
    mountSidebar([counted('a', 'Inventory', { short: 'Items', badge: 2 }), counted('b', 'World State', { short: 'World' })], { uiKey: freshKey() });
    const strip = sidebar().querySelector('.story-block-sidebar-tabs');
    let content = 200;
    Object.defineProperty(strip, 'clientWidth', { configurable: true, get: () => 300 });
    // Labels take what the content needs; icons are narrower (the fake DOM has no layout).
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, get: () => (strip.getAttribute('data-fit') === 'icons' ? Math.min(content, 280) : content) });
    win.fire('resize');
    assert.equal(strip.getAttribute('data-fit'), 'labels');
    content = 520;
    win.fire('resize');
    assert.equal(strip.getAttribute('data-fit'), 'icons');
    // Badges and the labels for screen readers stay in icon mode.
    const first = tabButtons()[0];
    assert.equal(first.querySelector('.story-block-sidebar-badge').textContent, '2');
    assert.match(first.getAttribute('aria-label'), /^Inventory/);
    assert.equal(first.title, 'Inventory');
    content = 240;
    win.fire('resize');
    assert.equal(strip.getAttribute('data-fit'), 'labels');
    // The phone sheet keeps its sideways pills.
    setViewport(390, { chatRight: 390, coarse: true });
    win.fire('resize');
    assert.equal(strip.getAttribute('data-fit'), null);
    setViewport(1440);
    unmountSidebar();
});

test('no two tabs look alike: a repeated or missing icon becomes a monogram of the label', async () => {
    const { tabGlyphs } = await import('../src/ui/sidebar.js');
    const glyphs = tabGlyphs([
        { id: 'party', icon: '👥', label: 'Party' },
        { id: 'present', icon: '👥', label: 'Present NPCs' },
        { id: 'dossiers', icon: '', label: 'Dossiers' },
        { id: 'items', icon: '🎒', label: 'Inventory', short: 'Items' },
    ]);
    assert.deepEqual([...glyphs.values()], [
        { text: '👥', monogram: false }, { text: 'PN', monogram: true }, { text: 'Do', monogram: true }, { text: '🎒', monogram: false },
    ]);
    setViewport(1440);
    mountSidebar([{ ...counted('a', 'Party'), icon: '👥' }, { ...counted('b', 'Present NPCs'), icon: '👥' }], { uiKey: freshKey() });
    const glyphNodes = sidebar().querySelectorAll('.story-block-sidebar-tab-glyph');
    assert.deepEqual(glyphNodes.map(node => node.textContent), ['👥', 'PN']);
    assert.ok(glyphNodes[1].classList.contains('is-monogram'));
    unmountSidebar();
});

test('each extension\'s tabs sit together, Story Block\'s first, with a divider where a group starts', async () => {
    const { groupTabs } = await import('../src/ui/sidebar.js');
    const ordered = groupTabs([
        { id: 'ext:rpg-party', group: 'RPG Battle' },
        { id: 'inventory', group: '' },
        { id: 'ext:story-director', group: 'Story Director' },
        { id: 'ext:rpg-battle', group: 'RPG Battle' },
        { id: 'world', group: '' },
    ]);
    assert.deepEqual(ordered.map(tab => tab.id), ['inventory', 'world', 'ext:rpg-party', 'ext:rpg-battle', 'ext:story-director']);
    setViewport(1440);
    const tab = (id, label, group) => ({ ...counted(id, label), group });
    mountSidebar([tab('x', 'Party', 'RPG Battle'), tab('i', 'Inventory', ''), tab('q', 'Quests', 'Story Director'), tab('w', 'World', '')], { uiKey: freshKey() });
    assert.deepEqual(tabButtons().map(node => node.dataset.tabId), ['i', 'w', 'x', 'q']);
    assert.deepEqual(tabButtons().map(node => node.classList.contains('is-group-start')), [false, false, true, true]);
    // An extension switched off: its tabs go, the others stay together with no gap.
    mountSidebar([tab('i', 'Inventory', ''), tab('q', 'Quests', 'Story Director'), tab('w', 'World', '')], { uiKey: tabButtons()[0] && sidebar().dataset.uiKey });
    assert.deepEqual(tabButtons().map(node => node.dataset.tabId), ['i', 'w', 'q']);
    assert.deepEqual(tabButtons().map(node => node.classList.contains('is-group-start')), [false, false, true]);
    unmountSidebar();
});

test('in icon mode the label bubble shows on keyboard focus, not on the focus a drawer gives', () => {
    setViewport(1440);
    mountSidebar([counted('a', 'Inventory'), counted('b', 'World State')], { uiKey: freshKey() });
    const strip = sidebar().querySelector('.story-block-sidebar-tabs');
    Object.defineProperty(strip, 'clientWidth', { configurable: true, get: () => 100 });
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, get: () => 400 });
    win.fire('resize');
    assert.equal(strip.getAttribute('data-fit'), 'icons');
    const tip = sidebar().querySelector('.story-block-sidebar-tab-tip');
    const second = tabButtons()[1];
    second.matches = selector => (selector === ':focus-visible' ? false : Object.getPrototypeOf(second).matches.call(second, selector));
    second.dispatch('focusin');
    assert.equal(tip.style.display, 'none', 'no hanging label from a programmatic or touch focus');
    second.matches = selector => (selector === ':focus-visible' ? true : Object.getPrototypeOf(second).matches.call(second, selector));
    second.dispatch('focusin');
    assert.equal(tip.style.display, '');
    assert.equal(tip.textContent, 'World State');
    unmountSidebar();
});
