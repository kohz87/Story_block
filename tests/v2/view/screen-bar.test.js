// The screen bar (UI stage 7, view/screen-bar.js): one strip of every screen that scrolls sideways (the items in the bar first, the
// moreOnly ones after them), the current one marked (aria-current, the accent by the CSS), the edge fade and edge alerts, the keys, and
// the focus kept across a redraw. There is no More and no sheet: the pill's code is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { barItems, createScreenBar, stripOrder } from '../../../src/v2/view/screen-bar.js';
import { STRINGS, fill } from '../../../src/v2/strings.js';
import { installDom, host } from './widgets/fake-dom.js';

const ITEMS = [
    { id: 'story-block/home', label: 'Home', icon: 'fa-house' },
    { id: 'story-block/party', label: 'Party', icon: 'fa-users' },
    { id: 'story-block/skills', label: 'Skills', icon: 'fa-wand-sparkles' },
    { id: 'story-block/bag', label: 'Bag', icon: 'fa-bag-shopping' },
    { id: 'story-director/world', label: 'World', icon: 'fa-globe' },
    { id: 'story-director/quests', label: 'Quests', icon: 'fa-scroll' },
    { id: 'rpg-battle/craft', label: 'Crafting', icon: 'fa-hammer' },
];
const LONG = 'A screen whose title runs well past seventy characters so that the bar has to cut it to one line';

function setup({ items = ITEMS, current = null, onSelect = null, decorate } = {}) {
    const doc = installDom();
    const root = host(doc);
    const chosen = [];
    const bar = createScreenBar(doc, root, {
        label: 'Screens',
        onSelect: id => { chosen.push(id); if (onSelect) onSelect(id); },
        ...(decorate ? { decorate } : {}),
    });
    bar.update({ items, current });
    const slots = () => [...root.querySelectorAll('.ss-screenbar-item')];
    const docKeys = () => doc.docListeners.filter(entry => entry.type === 'keydown').length;
    return { doc, root, bar, chosen, slots, docKeys };
}
const names = nodes => nodes.map(node => node.getAttribute('data-id'));
const text = node => node.textContent;

test('the labels: cut to one line in the bar, the full name as the title, an empty label takes the id', () => {
    const cut = barItems([{ id: 'x/long', label: LONG }, { id: '  ', label: 'no id' }, { id: 'x/none', label: '' }, { id: 'x/long', label: 'duplicate' }]);
    assert.deepEqual(cut.map(item => item.id), ['x/long', 'x/none']);
    assert.equal(cut[0].label, LONG);
    const { slots } = setup({ items: [{ id: 'x/long', label: LONG }, { id: 'x/b', label: 'B' }] });
    assert.equal(slots()[0].getAttribute('title'), LONG);
    assert.equal(text(slots()[0].querySelector('.ss-screenbar-label')), LONG, 'the CSS ellipsises, the text is whole (a reader can find it)');
});

test('the current screen: aria-current on its slot only, the dot inside it', () => {
    const { slots } = setup({ current: 'story-block/party' });
    const current = slots().filter(node => node.getAttribute('aria-current') === 'page');
    assert.deepEqual(names(current), ['story-block/party']);
    assert.ok(current[0].classList.contains('ss-screenbar-current'));
    assert.equal(current[0].querySelector('.ss-screenbar-dot').getAttribute('aria-hidden'), 'true', 'the dot is decorative');
});

test('a tap on a slot chooses that screen; a current slot is still chosen', () => {
    const { slots, chosen } = setup({ current: 'story-block/home' });
    slots()[1].click();
    slots()[0].click();
    assert.deepEqual(chosen, ['story-block/party', 'story-block/home']);
});

test('the decorate hook marks each slot (the Story panel\'s names)', () => {
    const { root } = setup({ decorate: (node, item) => { node.classList.add('story-suite-tab'); node.setAttribute('data-tab-id', item.id); } });
    assert.equal(root.querySelectorAll('.story-suite-tab').length, 7, 'every item is a slot');
    assert.equal(root.querySelector('.story-suite-tab[data-tab-id="rpg-battle/craft"]').getAttribute('data-tab-id'), 'rpg-battle/craft');
});

test('the bar is named and in the host; destroy leaves nothing behind (no sheet, scrim or More)', () => {
    const { bar, root, docKeys } = setup();
    assert.equal(root.querySelector('nav.ss-screenbar').getAttribute('aria-label'), 'Screens');
    assert.equal(root.querySelectorAll('.ss-screenbar-sheet, .ss-screenbar-scrim, .ss-screenbar-more').length, 0);
    assert.equal(docKeys(), 0, 'the bar listens to no document keys');
    bar.destroy();
    assert.equal(root.querySelectorAll('.ss-screenbar').length, 0);
});

test('the bar has no More API: the pill\'s open/close/isMoreOpen are gone', () => {
    const { bar } = setup();
    assert.deepEqual(Object.keys(bar).sort(), ['destroy', 'el', 'update']);
});

test('an update keeps the slot buttons (a focused slot keeps its focus across a redraw)', () => {
    const { bar, slots, doc } = setup({ current: 'story-block/home' });
    const before = slots()[1];
    doc.activeElement = before;
    bar.update({ items: ITEMS, current: 'story-block/party' });
    assert.equal(slots()[1], before, 'the same element');
    assert.equal(doc.activeElement, before);
    assert.equal(before.getAttribute('aria-current'), 'page');
});

test('the icons: the current slot draws the solid weight of its Phosphor icon, the others the line weight', () => {
    const items = [{ id: 'story-block/home', label: 'Home', icon: 'ph-house' }, { id: 'story-block/party', label: 'Party', icon: 'ph-users-three' }];
    const { slots } = setup({ items, current: 'story-block/party' });
    const [home, party] = slots().map(node => node.querySelector('.ss-screenbar-icon'));
    assert.equal(home.getAttribute('data-icon'), 'ph-house');
    assert.equal(home.getAttribute('data-weight'), 'regular');
    assert.equal(party.getAttribute('data-weight'), 'fill', 'solid for the current one');
});

// ---- the strip: one scrolling row, every item, no More ----------------------------------------------------------------------------

function stripSetup(items, current = null) {
    const doc = installDom();
    const root = host(doc);
    const bar = createScreenBar(doc, root, { label: 'Screens', onSelect: () => {} });
    const calls = [];
    // a slot's scrollIntoView is recorded (the fake page has no layout)
    const original = doc.createElement.bind(doc);
    doc.createElement = tag => { const node = original(tag); node.scrollIntoView = options => calls.push([node.getAttribute('data-id'), options]); return node; };
    bar.update({ items, current });
    const slots = () => [...root.querySelectorAll('.ss-screenbar-item')];
    return { doc, root, bar, slots, calls };
}

test('the strip: every item is a slot (phone and panel), More is never drawn, there is no sheet tile', () => {
    const { slots, root } = stripSetup(ITEMS);
    assert.deepEqual(names(slots()), ITEMS.map(item => item.id), 'all seven, not four');
    assert.equal(root.querySelectorAll('.ss-screenbar-more').length, 0);
    assert.equal(root.querySelectorAll('.ss-screenbar-tile').length, 0);
    assert.ok(root.querySelector('.ss-screenbar').classList.contains('ss-screenbar-strip'));
});

test('the strip\'s order: the items in the bar first in the reader\'s order, the moreOnly ones after them in theirs', () => {
    const items = [ITEMS[0], { ...ITEMS[1], moreOnly: true }, ITEMS[2], { ...ITEMS[3], moreOnly: true }, ITEMS[4]];
    assert.deepEqual(names(stripSetup(items).slots()), ['story-block/home', 'story-block/skills', 'story-director/world', 'story-block/party', 'story-block/bag']);
    assert.deepEqual(stripOrder(items).map(item => item.label), ['Home', 'Skills', 'World', 'Party', 'Bag']);
    assert.deepEqual(stripOrder(null), []);
});

test('the strip scrolls the current slot into view when it opens and when the current screen changes (and not again for the same one)', () => {
    const { bar, calls } = stripSetup(ITEMS, 'story-director/quests');
    assert.deepEqual(calls.map(call => call[0]), ['story-director/quests'], 'on open');
    assert.deepEqual(calls[0][1], { inline: 'center', block: 'nearest' });
    bar.update({ items: ITEMS, current: 'story-director/quests' });
    assert.equal(calls.length, 1, 'the same current: no scroll');
    bar.update({ items: ITEMS, current: 'rpg-battle/craft' });
    assert.deepEqual(calls.map(call => call[0]), ['story-director/quests', 'rpg-battle/craft'], 'on change');
});

test('the strip\'s edge fade says which side has more tabs', () => {
    const { root, bar } = stripSetup(ITEMS);
    const nav = root.querySelector('.ss-screenbar');
    assert.equal(nav.getAttribute('data-fade'), null, 'no layout, nothing to fade');
    Object.assign(nav, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 });
    bar.update({ items: ITEMS, current: null });
    assert.equal(nav.getAttribute('data-fade'), 'end');
    nav.scrollLeft = 200;
    nav.dispatch('scroll');
    assert.equal(nav.getAttribute('data-fade'), 'both');
    nav.scrollLeft = 500;
    nav.dispatch('scroll');
    assert.equal(nav.getAttribute('data-fade'), 'start');
});

// the fake page has no layout: a slot or the bar answers getBoundingClientRect from a left/right pair
const boxed = (node, left, right) => { node.getBoundingClientRect = () => ({ left, right, top: 0, bottom: 56, width: right - left, height: 56 }); };

test('the strip: an alerting tab scrolled out past an edge shows a dot on that edge, and it clears when the tab is in view', () => {
    const { root, bar, slots } = stripSetup(ITEMS);
    const nav = root.querySelector('.ss-screenbar');
    const dots = () => [...root.querySelectorAll('.ss-screenbar-edge-alert')].filter(node => !node.hidden).map(node => node.getAttribute('data-edge'));
    const alerting = ITEMS.map(item => (item.id === 'rpg-battle/craft' ? { ...item, alert: true } : item));
    Object.assign(nav, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 });
    boxed(nav, 0, 300);
    bar.update({ items: alerting, current: null });
    const craft = slots().find(node => node.getAttribute('data-id') === 'rpg-battle/craft');
    boxed(craft, 700, 776);
    nav.dispatch('scroll');
    assert.deepEqual(dots(), ['end'], 'beyond the right edge');
    assert.equal(nav.getAttribute('data-alert'), 'end');
    boxed(craft, -80, -4);
    nav.dispatch('scroll');
    assert.deepEqual(dots(), ['start'], 'beyond the left edge');
    assert.equal(nav.getAttribute('data-alert'), 'start');
    boxed(craft, 247, 323); // half visible: its centre (285) is inside the 28px fade (272..300)
    nav.dispatch('scroll');
    assert.deepEqual(dots(), ['end'], 'part-visible, centre in the end fade: counts as past the edge');
    boxed(craft, -23, 53); // centre 15 is inside the start fade
    nav.dispatch('scroll');
    assert.deepEqual(dots(), ['start'], 'part-visible at the start edge');
    boxed(craft, 230, 306); // centre 268, just clear of the fade
    nav.dispatch('scroll');
    assert.deepEqual(dots(), [], 'centre clear of the fade: not past the edge');
    boxed(craft, 100, 176);
    nav.dispatch('scroll');
    assert.deepEqual(dots(), [], 'in view: cleared');
    assert.equal(nav.getAttribute('data-alert'), '');
    boxed(craft, 700, 776);
    nav.dispatch('scroll');
    bar.update({ items: ITEMS, current: null });
    assert.deepEqual(dots(), [], 'the alert ended: cleared');
});

test('the strip: the fade is recomputed when the bar is resized (a ResizeObserver), and the observer is disconnected on destroy', () => {
    const seen = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; this.nodes = []; this.off = false; seen.push(this); } observe(node) { this.nodes.push(node); } disconnect() { this.off = true; } };
    try {
        const { root, bar } = stripSetup(ITEMS);
        const nav = root.querySelector('.ss-screenbar');
        assert.equal(seen.length, 1);
        assert.deepEqual(seen[0].nodes, [nav], 'it watches the bar');
        assert.equal(nav.getAttribute('data-fade'), null);
        Object.assign(nav, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 });
        seen[0].callback();
        assert.equal(nav.getAttribute('data-fade'), 'end', 'a resize that makes it overflow');
        Object.assign(nav, { clientWidth: 800 });
        seen[0].callback();
        assert.equal(nav.getAttribute('data-fade'), null, 'a resize that makes it fit');
        assert.equal(seen[0].off, false);
        bar.destroy();
        assert.equal(seen[0].off, true, 'disconnected on destroy');
    } finally {
        globalThis.ResizeObserver = original;
    }
});

test('the strip works without a ResizeObserver', () => {
    const original = globalThis.ResizeObserver;
    delete globalThis.ResizeObserver;
    try {
        const { bar, slots } = stripSetup(ITEMS);
        assert.equal(slots().length, ITEMS.length);
        bar.destroy();
    } finally {
        if (original) globalThis.ResizeObserver = original;
    }
});

test('the strip: Left and Right move the focus between slots, Home and End go to the first and last, and nothing wraps', () => {
    const { doc, slots, root } = stripSetup(ITEMS);
    const nav = root.querySelector('.ss-screenbar');
    const press = key => nav.dispatch('keydown', { key });
    slots()[0].focus();
    assert.equal(press('ArrowRight').defaultPrevented, true);
    assert.equal(doc.activeElement, slots()[1]);
    press('ArrowRight');
    assert.equal(doc.activeElement, slots()[2]);
    press('ArrowLeft');
    assert.equal(doc.activeElement, slots()[1]);
    press('End');
    assert.equal(doc.activeElement, slots().at(-1));
    press('ArrowRight');
    assert.equal(doc.activeElement, slots().at(-1), 'no wrap at the end');
    press('Home');
    assert.equal(doc.activeElement, slots()[0]);
    press('ArrowLeft');
    assert.equal(doc.activeElement, slots()[0], 'no wrap at the start');
});

test('when the focused slot disappears (a fight ended) the focus goes to the current slot, else the first one', () => {
    const fight = { id: 'rpg-battle/fight', label: 'Fight', icon: 'fa-khanda', alert: true };
    const { bar, slots, doc } = setup({ items: [...ITEMS, fight], current: 'rpg-battle/fight' });
    doc.activeElement = slots().find(node => node.getAttribute('data-id') === 'rpg-battle/fight');
    bar.update({ items: ITEMS, current: 'story-block/party' });
    assert.equal(doc.activeElement.getAttribute('data-id'), 'story-block/party', 'the current slot');
    bar.update({ items: [...ITEMS, fight], current: 'rpg-battle/fight' });
    doc.activeElement = slots().find(node => node.getAttribute('data-id') === 'rpg-battle/fight');
    bar.update({ items: ITEMS, current: 'rpg-battle/fight' });
    assert.equal(doc.activeElement.getAttribute('data-id'), ITEMS[0].id, 'the first slot when the current one is not drawn');
});
