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

const screen = (id, title, mounts = ['tab', 'screen']) => ({ id, title, icon: 'fa-star', mounts, template: `<p>${title}</p>` });
const MODULES = {
    'story-director': () => ({ id: 'story-director', name: 'Story Director', screens: [screen('story-director/world', 'World'), screen('story-director/quests', 'Quests'),
        screen('story-director/map', 'Map'), screen('story-director/chronicle', 'Chronicle'), screen('story-director/director', 'Director')] }),
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
    return { doc, st, ui };
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
    const expected = { 'story-block/home': 'bar', 'story-block/inventory': 'bar', 'story-director/quests': 'bar', 'story-director/world': 'bar', 'story-director/map': 'bar',
        'story-director/chronicle': 'more', 'story-director/director': 'more', 'notes/a': 'more' };
    for (const [id, value] of Object.entries(expected)) assert.equal(place(doc, id).value, value, id);
    assert.deepEqual(place(doc, 'story-block/home').children.map(option => option.textContent), [TABS_TEXT.inBar, TABS_TEXT.underMore]);
    assert.equal(place(doc, 'story-block/home').disabled, true, 'Home is always in the bar');
    assert.equal(place(doc, 'story-director/map').disabled, false);
    assert.equal(place(doc, 'story-director/map').getAttribute('aria-label'), fill(TABS_TEXT.placeTitle, { name: 'Map' }));
});

test('choosing a place moves the screen in the bar at once, is stored with the rest, said in the status line, and kept on its row; reset forgets it', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, st, ui } = await setup({}, { wide: true });
    ui.mounts.screen.open();
    assert.ok(tileIds(doc).includes('story-director/chronicle'), 'under More to begin with');
    assert.ok(!slotIds(doc).includes('story-director/chronicle'));
    ui.openSettings({ fold: TABS_FOLD });
    choose(doc, 'story-director/chronicle', 'bar');
    assert.deepEqual(saved(st).inBar, ['story-director/chronicle']);
    assert.equal(doc.querySelector('.ss-tabrows-status').textContent, fill(TABS_TEXT.movedToBar, { name: 'Chronicle' }));
    assert.equal(place(doc, 'story-director/chronicle').value, 'bar', 'the row shows it');
    assert.equal(doc.activeElement, place(doc, 'story-director/chronicle'), 'the focus stays on the choice');
    ui.mounts.screen.update();
    assert.ok(slotIds(doc).includes('story-director/chronicle'), 'in the bar');
    assert.ok(!tileIds(doc).includes('story-director/chronicle'));
    choose(doc, 'story-director/map', 'more');
    assert.deepEqual(saved(st), { order: [], hidden: [], shown: [], inBar: ['story-director/chronicle'], underMore: ['story-director/map'] });
    assert.equal(doc.querySelector('.ss-tabrows-status').textContent, fill(TABS_TEXT.movedToMore, { name: 'Map' }));
    ui.mounts.screen.update();
    assert.ok(tileIds(doc).includes('story-director/map'), 'Map is under More now');
    assert.ok(!slotIds(doc).includes('story-director/map'));
    // an order and a hidden screen chosen before are untouched by it
    row(doc, 'story-director/director').querySelector('.ss-tabrow-up').click();
    assert.deepEqual(saved(st).inBar, ['story-director/chronicle']);
    assert.equal(doc.querySelector('.ss-tabrows-reset').disabled, false);
    doc.querySelector('.ss-tabrows-reset').click();
    assert.equal(saved(st), undefined);
    assert.equal(place(doc, 'story-director/chronicle').value, 'more');
    assert.equal(place(doc, 'story-director/map').value, 'bar');
});

test('the Story panel\'s strip follows the choice, and a saved choice from before (order, hidden) works with the new default places', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui } = await setup({ storySuite: { tabs: { order: ['story-director/director', 'story-director/world'], hidden: ['notes/b'] } } });
    ui.openPanel();
    const strip = () => doc.querySelectorAll('.story-suite-tab').map(node => node.getAttribute('data-tab-id'));
    const slots = () => doc.querySelectorAll('.story-suite-sheet-bar .ss-screenbar-item').filter(node => !node.classList.contains('ss-screenbar-more')).map(node => node.getAttribute('data-tab-id'));
    assert.ok(!strip().includes('notes/b'), 'hidden stays hidden');
    assert.ok(!slots().includes('story-director/director'), 'an order alone does not put a screen in the bar');
    assert.ok(slots().includes('story-director/world'));
    ui.openSettings({ fold: TABS_FOLD });
    choose(doc, 'story-director/director', 'bar');
    assert.ok(slots().includes('story-director/director'), 'the strip follows at once');
});

test('two tabs with the same name are told apart in the list, whatever the case and the spaces; the first keeps its name', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui } = await setup();
    ui.openSettings({ fold: TABS_FOLD });
    const title = id => row(doc, id).querySelector('.ss-tabrow-title').textContent;
    assert.deepEqual(['notes/a', 'notes/b', 'notes/c'].map(title), ['Notes', 'Notes (2)', 'notes (3)']);
    assert.equal(row(doc, 'notes/b').querySelector('.ss-tabrow-up').getAttribute('aria-label'), 'Move Notes (2) up', 'the buttons use the told-apart name');
    assert.equal(title('story-director/map'), 'Map', 'a name that is only once is left alone');
});
