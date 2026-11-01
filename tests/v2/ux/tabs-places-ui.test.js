// The fixture module stands for any other module that says `bar: true` on some of its screens.
// Settings → Tabs & Packs → Tabs, each row's place: "In the bar" or "Under More" (host-ui.js TABS_TEXT, settings/tabs-list.js, ui-host.js tabsControl),
// stored with the reader's order and hidden choices; the bar and the Story panel's strip follow at once. Two tabs with the same name are told
// apart in the list ("Notes (2)"). Home's place is locked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../../testkit/fake-st.js';
import { createRuntime } from '../../../src/v2/runtime.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { TABS_FOLD, TABS_TEXT } from '../../../src/v2/host-ui.js';
import { fill } from '../../../src/v2/strings.js';
import { setupDom } from '../view/mounts/helpers.js';

const screen = (id, title, mounts = ['tab', 'screen'], bar = false) => ({ id, title, icon: 'fa-star', mounts, template: `<p>${title}</p>`, ...(bar ? { bar: true } : {}) });
const MODULES = {
    'example-module': () => ({ id: 'example-module', name: 'Example Module', screens: [screen('example-module/world', 'World', undefined, true), screen('example-module/quests', 'Quests', undefined, true),
        screen('example-module/map', 'Map', undefined, true), screen('example-module/chronicle', 'Chronicle'), screen('example-module/director', 'Director')] }),
    // three screens that go by the same name, from two sources
    notes: () => ({ id: 'notes', name: 'Notes', screens: [screen('notes/a', 'Notes'), screen('notes/b', 'Notes'), screen('notes/c', ' notes ')] }),
};

async function setup(extensionSettings = {}, { wide = false } = {}) {
    const doc = setupDom();
    // a wide window draws the bar as one row of the screens in it; a phone as a pill of four slots and More
    if (wide) doc.defaultView = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
    const st = createFakeContext({ extensionSettings });
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    for (const make of Object.values(MODULES)) await runtime.sdk.registerModule(make());
    ui.syncScreens();
    return { doc, st, ui, runtime };
}

const rows = doc => doc.querySelectorAll('.ss-tabrow');
const row = (doc, id) => rows(doc).find(node => node.dataset.tabId === id);
const place = (doc, id) => row(doc, id).querySelector('.ss-tabrow-place');
const choose = (doc, id, value) => { const select = place(doc, id); select.value = value; select.dispatch('change'); };
const saved = st => st.ctx.extensionSettings.storySuite?.tabs;
const slotIds = doc => [...doc.querySelector('.ss-gameview').querySelectorAll('.ss-screenbar-item[data-id]')].map(node => node.getAttribute('data-id'));
const tileIds = doc => [...doc.querySelector('.ss-gameview').querySelectorAll('.ss-screenbar-tile[data-id]')].map(node => node.getAttribute('data-id'));

test('every row has a place: In the bar for Home, Inventory, Quests, World and Map, Under More for the rest; Home\'s is locked', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui } = await setup();
    ui.openSettings({ fold: TABS_FOLD });
    const expected = { 'story-block/home': 'bar', 'story-block/inventory': 'bar', 'example-module/quests': 'bar', 'example-module/world': 'bar', 'example-module/map': 'bar',
        'example-module/chronicle': 'more', 'example-module/director': 'more', 'notes/a': 'more' };
    for (const [id, value] of Object.entries(expected)) assert.equal(place(doc, id).value, value, id);
    assert.deepEqual(place(doc, 'story-block/home').children.map(option => option.textContent), [TABS_TEXT.inBar, TABS_TEXT.underMore]);
    assert.equal(place(doc, 'story-block/home').disabled, true, 'Home is always in the bar');
    assert.equal(place(doc, 'example-module/map').disabled, false);
    assert.equal(place(doc, 'example-module/map').getAttribute('aria-label'), fill(TABS_TEXT.placeTitle, { name: 'Map' }));
});

test('choosing a place moves the screen in the bar at once, is stored with the rest, said in the status line, and kept on its row; reset forgets it', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, st, ui } = await setup({}, { wide: true });
    ui.mounts.screen.open();
    assert.ok(tileIds(doc).includes('example-module/chronicle'), 'under More to begin with');
    assert.ok(!slotIds(doc).includes('example-module/chronicle'));
    ui.openSettings({ fold: TABS_FOLD });
    choose(doc, 'example-module/chronicle', 'bar');
    assert.deepEqual(saved(st).inBar, ['example-module/chronicle']);
    assert.equal(doc.querySelector('.ss-tabrows-status').textContent, fill(TABS_TEXT.movedToBar, { name: 'Chronicle' }));
    assert.equal(place(doc, 'example-module/chronicle').value, 'bar', 'the row shows it');
    assert.equal(doc.activeElement, place(doc, 'example-module/chronicle'), 'the focus stays on the choice');
    ui.mounts.screen.update();
    assert.ok(slotIds(doc).includes('example-module/chronicle'), 'in the bar');
    assert.ok(!tileIds(doc).includes('example-module/chronicle'));
    choose(doc, 'example-module/map', 'more');
    assert.deepEqual(saved(st), { order: [], hidden: [], shown: [], inBar: ['example-module/chronicle'], underMore: ['example-module/map'] });
    assert.equal(doc.querySelector('.ss-tabrows-status').textContent, fill(TABS_TEXT.movedToMore, { name: 'Map' }));
    ui.mounts.screen.update();
    assert.ok(tileIds(doc).includes('example-module/map'), 'Map is under More now');
    assert.ok(!slotIds(doc).includes('example-module/map'));
    // an order and a hidden screen chosen before are untouched by it
    row(doc, 'example-module/director').querySelector('.ss-tabrow-up').click();
    assert.deepEqual(saved(st).inBar, ['example-module/chronicle']);
    assert.equal(doc.querySelector('.ss-tabrows-reset').disabled, false);
    doc.querySelector('.ss-tabrows-reset').click();
    assert.equal(saved(st), undefined);
    assert.equal(place(doc, 'example-module/chronicle').value, 'more');
    assert.equal(place(doc, 'example-module/map').value, 'bar');
});

test('the Story panel\'s strip follows the choice, and a saved choice from before (order, hidden) works with the new default places', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui } = await setup({ storySuite: { tabs: { order: ['example-module/director', 'example-module/world'], hidden: ['notes/b'] } } });
    ui.openPanel();
    const strip = () => doc.querySelectorAll('.story-suite-tab').map(node => node.getAttribute('data-tab-id'));
    const slots = () => doc.querySelectorAll('.story-suite-sheet-bar .ss-screenbar-item').filter(node => !node.classList.contains('ss-screenbar-more')).map(node => node.getAttribute('data-tab-id'));
    assert.ok(!strip().includes('notes/b'), 'hidden stays hidden');
    assert.ok(!slots().includes('example-module/director'), 'an order alone does not put a screen in the bar');
    assert.ok(slots().includes('example-module/world'));
    ui.openSettings({ fold: TABS_FOLD });
    choose(doc, 'example-module/director', 'bar');
    assert.ok(slots().includes('example-module/director'), 'the strip follows at once');
});

test('two tabs with the same name are told apart in the list, whatever the case and the spaces; the first keeps its name', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui } = await setup();
    ui.openSettings({ fold: TABS_FOLD });
    const title = id => row(doc, id).querySelector('.ss-tabrow-title').textContent;
    assert.deepEqual(['notes/a', 'notes/b', 'notes/c'].map(title), ['Notes', 'Notes (2)', 'notes (3)']);
    assert.equal(row(doc, 'notes/b').querySelector('.ss-tabrow-up').getAttribute('aria-label'), 'Move Notes (2) up', 'the buttons use the told-apart name');
    assert.equal(title('example-module/map'), 'Map', 'a name that is only once is left alone');
});

test('a module\'s tab says `bar: true` itself; the place the module declared is not kept when the reader puts it back, and a bad value is refused', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, st, ui, runtime } = await setup();
    await runtime.sdk.registerModule({ id: 'tabby', name: 'Tabby', tabs: [
        { id: 'log', title: 'Log', icon: 'fa-star', bar: true, render(el) { el.textContent = 'log'; } },
        { id: 'misc', title: 'Misc', icon: 'fa-star', render(el) { el.textContent = 'misc'; } },
    ] });
    ui.syncScreens();
    ui.openSettings({ fold: TABS_FOLD });
    assert.equal(place(doc, 'tabby/log').value, 'bar', 'the tab declared it');
    assert.equal(place(doc, 'tabby/misc').value, 'more', 'a tab that did not is under More');
    choose(doc, 'tabby/log', 'more');
    assert.deepEqual(saved(st).underMore, ['tabby/log']);
    choose(doc, 'tabby/log', 'bar');
    assert.deepEqual(saved(st), { order: [], hidden: [], shown: [] }, 'back to what the tab declared: nothing is kept');
    // A screen's own flag works the same way (Quests in the fixture module declared it).
    choose(doc, 'example-module/quests', 'more');
    assert.deepEqual(saved(st).underMore, ['example-module/quests']);
    choose(doc, 'example-module/quests', 'bar');
    assert.deepEqual(saved(st), { order: [], hidden: [], shown: [] });
    // `bar` must be true or false.
    await assert.rejects(() => runtime.sdk.registerModule({ id: 'tabby2', name: 'Tabby 2', tabs: [{ id: 'x', title: 'X', bar: 'yes', render() {} }] }), /bar is not true or false/);
});
