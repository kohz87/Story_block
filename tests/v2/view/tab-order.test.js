// view/tab-order.js: the reader's order for the Story panel's tabs and the game view's screens (one list),
// and scroll-cue.js bringIntoView (the chosen tab kept in view on a phone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_ID } from '../../../src/v2/view/screens.js';
import {
    TAB_ID_MAX, TAB_LIST_MAX, createTabOrderStore, isDefaultChoice, isHiddenNav, moveNav, navKey, orderNav, readTabChoice,
    setNavHidden, visibleNav,
} from '../../../src/v2/view/tab-order.js';
import { bringIntoView } from '../../../src/v2/view/scroll-cue.js';

const entries = ids => ids.map(id => ({ id }));
const ids = list => list.map(entry => entry.id);
// Deliberately not in default order: orderNav sorts.
const ALL = entries(['story-director/director', 'story-block/scene', 'rpg-battle/fight', HOME_ID, 'rpg-battle/party', 'story-block/inventory', 'story-director/quests']);
const DEFAULT = [HOME_ID, 'rpg-battle/party', 'story-block/inventory', 'story-director/quests', 'rpg-battle/fight', 'story-block/scene', 'story-director/director'];

test('readTabChoice: strings only, no repeats, never Home, bounded; anything else is the default', () => {
    for (const raw of [undefined, null, 7, 'x', [], { order: 'a' }, { order: [1, null, {}], hidden: true }]) {
        assert.deepEqual(readTabChoice(raw), { order: [], hidden: [] }, JSON.stringify(raw));
    }
    assert.deepEqual(readTabChoice({ order: ['a/b', 'a/b', '', HOME_ID, 'c/d', 'x'.repeat(TAB_ID_MAX + 1)], hidden: [HOME_ID, 'c/d'] }),
        { order: ['a/b', 'c/d'], hidden: ['c/d'] });
    const many = Array.from({ length: TAB_LIST_MAX + 50 }, (_, i) => `m/t${i}`);
    assert.equal(readTabChoice({ order: many }).order.length, TAB_LIST_MAX);
    assert.equal(isDefaultChoice({}), true);
    assert.equal(isDefaultChoice({ hidden: ['a/b'] }), false);
});

test('navKey: a tab screen by its id, a module tab as "<module>/<id>" (Cast tab and Cast screen are one)', () => {
    assert.equal(navKey({ id: 'rpg-battle/party', moduleId: 'screens' }), 'rpg-battle/party');
    assert.equal(navKey({ id: 'cast', moduleId: 'npc-state-delta' }), 'npc-state-delta/cast');
    assert.equal(navKey({ id: 'a/b', moduleId: 'm' }), 'a/b');
    assert.equal(navKey({ id: 'loose' }), 'loose');
});

test('orderNav: the default without a choice; the reader\'s order; new ones at the end in default order; unknown ids passed over', () => {
    assert.deepEqual(ids(orderNav(ALL, null)), DEFAULT);
    assert.deepEqual(ids(orderNav(ALL, { order: [] })), DEFAULT);
    const choice = { order: ['story-director/director', 'gone/module', 'rpg-battle/fight', 'rpg-battle/party'] };
    // Named ones first in the reader's order (the removed module's id is passed over), the rest after, in default order.
    assert.deepEqual(ids(orderNav(ALL, choice)), [
        HOME_ID, 'story-director/director', 'rpg-battle/fight', 'rpg-battle/party',
        'story-block/inventory', 'story-director/quests', 'story-block/scene',
    ]);
    // Home stays first even when a hand-edited file names it last (readTabChoice drops it).
    assert.equal(ids(orderNav(ALL, { order: ['rpg-battle/party', HOME_ID] }))[0], HOME_ID);
    // Any subset of modules: only what is there, in the same relative order.
    const subset = ALL.filter(entry => !entry.id.startsWith('rpg-battle/'));
    assert.deepEqual(ids(orderNav(subset, choice)), [HOME_ID, 'story-director/director', 'story-block/inventory', 'story-director/quests', 'story-block/scene']);
    // Custom key and order readers (the panel's module tabs).
    const tabs = [{ id: 'cast', moduleId: 'npc-state-delta' }, { id: 'rpg-battle/party', moduleId: 'screens' }];
    assert.deepEqual(orderNav(tabs, null, navKey).map(navKey), ['rpg-battle/party', 'npc-state-delta/cast']);
    assert.deepEqual(orderNav(tabs, { order: ['npc-state-delta/cast'] }, navKey).map(navKey), ['npc-state-delta/cast', 'rpg-battle/party']);
});

test('visibleNav leaves the hidden ones out; Home is never hidden', () => {
    const choice = { hidden: ['rpg-battle/fight', HOME_ID, 'gone/x'] };
    assert.equal(isHiddenNav(choice, 'rpg-battle/fight'), true);
    assert.equal(isHiddenNav(choice, HOME_ID), false);
    assert.deepEqual(ids(visibleNav(ALL, choice)), DEFAULT.filter(id => id !== 'rpg-battle/fight'));
});

test('moveNav: up and down by one; the edges and Home stay; saved ids of a removed module are kept', () => {
    const shown = DEFAULT.slice(1);
    const down = moveNav({}, shown, 'rpg-battle/party', 1);
    assert.deepEqual(down.order, ['story-block/inventory', 'rpg-battle/party', ...shown.slice(2)]);
    const up = moveNav(down, ids(orderNav(ALL, down)).slice(1), 'rpg-battle/party', -1);
    assert.deepEqual(up.order, shown);
    assert.deepEqual(moveNav({}, shown, shown[0], -1), { order: [], hidden: [] }, 'the first cannot go up');
    assert.deepEqual(moveNav({}, shown, shown.at(-1), 1), { order: [], hidden: [] }, 'the last cannot go down');
    assert.deepEqual(moveNav({}, shown, HOME_ID, 1), { order: [], hidden: [] }, 'Home is not in the list to move');
    assert.deepEqual(moveNav({}, shown, 'nope/x', 1), { order: [], hidden: [] });
    const kept = moveNav({ order: ['gone/a', 'rpg-battle/party'], hidden: ['gone/b'] }, ['rpg-battle/party', 'story-block/scene'], 'story-block/scene', -1);
    assert.deepEqual(kept, { order: ['gone/a', 'story-block/scene', 'rpg-battle/party'], hidden: ['gone/b'] }, 'the removed one keeps its slot');
    const slots = moveNav({ order: ['a/1', 'gone/x', 'a/2', 'gone/y'] }, ['a/1', 'a/2', 'a/3'], 'a/3', -1);
    assert.deepEqual(slots.order, ['a/1', 'gone/x', 'a/3', 'gone/y', 'a/2']);
});

test('setNavHidden hides and shows again; Home cannot be hidden', () => {
    const hidden = setNavHidden({}, 'rpg-battle/fight', true);
    assert.deepEqual(hidden, { order: [], hidden: ['rpg-battle/fight'] });
    assert.deepEqual(setNavHidden(hidden, 'rpg-battle/fight', true), hidden, 'twice is once');
    assert.deepEqual(setNavHidden(hidden, 'rpg-battle/fight', false), { order: [], hidden: [] });
    assert.deepEqual(setNavHidden(hidden, HOME_ID, true), hidden);
    assert.deepEqual(setNavHidden(hidden, '', true), hidden);
});

test('createTabOrderStore keeps the choice in extension_settings.storySuite.tabs and saves; reset forgets it', () => {
    let saves = 0;
    const ctx = { extensionSettings: {}, saveSettingsDebounced: () => { saves += 1; } };
    const store = createTabOrderStore(ctx);
    assert.deepEqual(store.choice(), { order: [], hidden: [] });
    store.set({ order: ['a/b', 'a/b', 3], hidden: ['c/d'] });
    assert.deepEqual(ctx.extensionSettings.storySuite.tabs, { order: ['a/b'], hidden: ['c/d'] });
    assert.deepEqual(store.choice(), { order: ['a/b'], hidden: ['c/d'] });
    // A hand-edited file is read safely.
    ctx.extensionSettings.storySuite.tabs = { order: 'nonsense', hidden: [HOME_ID] };
    assert.deepEqual(store.choice(), { order: [], hidden: [] });
    store.reset();
    assert.equal(Object.hasOwn(ctx.extensionSettings.storySuite, 'tabs'), false);
    assert.equal(saves, 2);
});

test('bringIntoView scrolls the strip just enough to show the chosen tab, along the axis that overflows', () => {
    const scroller = (rect, extra) => ({ scrollLeft: 0, scrollTop: 0, scrollWidth: 100, clientWidth: 100, scrollHeight: 40, clientHeight: 40, getBoundingClientRect: () => rect, ...extra });
    const item = rect => ({ getBoundingClientRect: () => rect });
    // A phone's strip: 390 wide, scrolls sideways; the tab at 500–580 is out on the right.
    const strip = scroller({ left: 0, right: 390, top: 0, bottom: 40, width: 390, height: 40 }, { scrollWidth: 1200, clientWidth: 390 });
    assert.equal(bringIntoView(strip, item({ left: 500, right: 580, top: 0, bottom: 40 })), true);
    assert.equal(strip.scrollLeft, 580 - 390 + 12);
    // Out on the left.
    strip.scrollLeft = 400;
    assert.equal(bringIntoView(strip, item({ left: -50, right: 30, top: 0, bottom: 40 })), true);
    assert.equal(strip.scrollLeft, 400 - 50 - 12);
    // Already in view: nothing moves.
    assert.equal(bringIntoView(strip, item({ left: 10, right: 90, top: 0, bottom: 40 })), false);
    // The game view's side bar scrolls down.
    const side = scroller({ left: 0, right: 200, top: 0, bottom: 600, width: 200, height: 600 }, { scrollHeight: 900, clientHeight: 600 });
    assert.equal(bringIntoView(side, item({ left: 0, right: 200, top: 640, bottom: 684 })), true);
    assert.equal(side.scrollTop, 684 - 600 + 12);
    // No layout (a fake DOM, a closed panel): nothing to measure.
    assert.equal(bringIntoView({}, {}), false);
    assert.equal(bringIntoView(scroller({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }), item({ left: 5, right: 9 })), false);
});
