// ui-host.js: the page furniture over the real runtime, on the mounts' fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../testkit/fake-st.js';
import { createRuntime } from '../../src/v2/runtime.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { setupDom } from './view/mounts/helpers.js';

const LATE = { id: 'qa-late', name: 'Late', screens: [{ id: 'qa-late/strip', title: 'Strip', mounts: ['hud', 'tab'], template: '<div>{{ state.meta.rev }}</div>' }] };

function setup(chat) {
    const doc = setupDom();
    const st = createFakeContext({ chat });
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    return { doc, st, ui, runtime };
}

test('stateAt on a chat with no carrier (head index -1) shows nothing instead of throwing', async t => {
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args.map(String).join(' ')));
    const { doc, ui, runtime } = setup([]);
    assert.equal(runtime.store.headIndex(), -1);
    // A module enabled before the chat holds any reply: its screens follow without a RangeError
    // ("screens could not follow RangeError: There is no message -1").
    await runtime.sdk.registerModule(LATE);
    ui.refresh();
    const mounted = ui.mounts.hud.mount(doc.createElement('div'), 'qa-late/strip');
    assert.ok(mounted.result, 'the head mount drew');
    assert.deepEqual(warnings.filter(line => /could not follow|There is no message/.test(line)), []);
});

test('stateAt with a carrier still reads that reply\'s state', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui, runtime, st } = setup(undefined);
    await runtime.turn.onChatChanged();
    assert.equal(runtime.store.headIndex(), 0, 'the greeting is the head');
    await runtime.sdk.registerModule(LATE);
    const el = doc.createElement('div');
    ui.mounts.hud.mount(el, 'qa-late/strip');
    assert.equal(el.textContent.trim(), String(runtime.store.head().meta.rev));
    assert.ok(st.ctx.chat.length >= 1);
});

test('settings: the overlay counts the next reply\'s prompt (turn.preview) with the context\'s tokenizer, and the Packs fold is there', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui, runtime, st } = setup(undefined);
    await runtime.turn.onChatChanged();
    const counted = [];
    st.ctx.getTokenCountAsync = async text => { counted.push(text); return Math.ceil(text.length / 3); };
    const sent = JSON.stringify(st.ctx.extensionPrompts ?? null);
    const overlay = ui.openSettings();
    const root = doc.querySelector('#story_suite_v2_overlay');
    const tabsPage = root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'tabs');
    assert.deepEqual(tabsPage.querySelectorAll('details.story-suite-fold').map(node => node.dataset.fold), [], 'the Tabs & Packs page is the form engine\'s: no fold');
    assert.deepEqual(tabsPage.querySelectorAll('.ss-section-title').map(node => node.textContent).filter(Boolean), ['Tabs', 'Packs', 'Prompt'], 'Packs from the live core module');
    assert.equal(runtime.registry.settingsDefs().find(def => def.moduleId === 'story-block').folds[0].id, 'packs');
    const size = root.querySelector('.story-suite-size');
    assert.equal(size.dataset.exact, 'false');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(size.dataset.exact, 'true', 'the tokenizer\'s numbers');
    const staticText = runtime.turn.preview().filter(part => part.place === 'static').map(part => part.text).join('\n\n');
    assert.ok(counted.includes(staticText), 'the static part as sent');
    assert.equal(JSON.stringify(st.ctx.extensionPrompts ?? null), sent, 'nothing set in the prompt');
    // A feature switched elsewhere: the overlay draws again (and counts again).
    runtime.features.set('story-block.inspector', true);
    assert.equal(root.querySelectorAll('.ss-feature').find(node => node.dataset.feature === 'story-block.inspector').querySelector('.ss-switch').getAttribute('aria-checked'), 'true');
    overlay.close();
    assert.equal(doc.querySelector('#story_suite_v2_overlay'), null);
});

// A pack's screens and stylesheets follow the pack: a pack that is disabled gives up its screens (its Home included), and a
// replaced pack leaves only its new stylesheet in the head (the old red one is gone, keyed by the pack and its screen).
const homePack = (version, template) => ({
    id: 'home-pack', version, name: 'Home pack', requires: { storyBlock: '^2' }, content: {},
    screens: [{ id: 'story-block/home', title: 'Home', mounts: ['tab'], template }],
});
const boardPack = (version, color) => ({
    id: 'board-pack', version, name: 'Board pack', requires: { storyBlock: '^2' }, content: {},
    screens: [{ id: 'board-pack-board', title: 'Board', mounts: ['tab'], template: '<p class="b">board</p>', css: `.b { color: ${color} }` }],
});
const sheetsOf = (doc, id) => doc.head.querySelectorAll('style').filter(node => node.id === id);

test('a disabled pack is gone with its screens: its Home is no longer the Home, and the host\'s is back', async t => {
    t.mock.method(console, 'warn', () => {});
    const { ui, runtime } = setup([]);
    const home = () => ui.screens.resolve('story-block/home');
    await runtime.packs.packs.install(JSON.stringify(homePack('1.0.0', '<p class="h">pack home</p>')), { origin: 'pack.json' });
    ui.syncScreens();
    assert.equal(home().source, 'pack', 'the pack gives Home');
    assert.match(home().screen.template, /pack home/);
    await runtime.packs.packs.setEnabled('home-pack', false);
    assert.notEqual(home()?.source, 'pack', 'disabled: the pack gives no Home');
    assert.ok(home(), 'the host\'s own Home is there again');
    await runtime.packs.packs.setEnabled('home-pack', true);
    assert.equal(home().source, 'pack', 'enabled again: the pack gives Home again');
});

test('a replaced pack leaves only its new stylesheet in the head', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui, runtime } = setup([]);
    doc.head = doc.createElement('head');
    await runtime.packs.packs.install(JSON.stringify(boardPack('1.0.0', 'red')), { origin: 'pack.json' });
    ui.syncScreens();
    assert.equal(sheetsOf(doc, 'ss-css-board-pack-board').length, 1);
    assert.match(sheetsOf(doc, 'ss-css-board-pack-board')[0].textContent, /color: red/);
    await runtime.packs.packs.install(JSON.stringify(boardPack('1.1.0', 'green')), { origin: 'pack.json' });
    ui.syncScreens();
    const sheets = sheetsOf(doc, 'ss-css-board-pack-board');
    assert.equal(sheets.length, 1, 'one stylesheet for the screen');
    assert.match(sheets[0].textContent, /color: green/);
    assert.doesNotMatch(sheets[0].textContent, /color: red/, 'the old one is gone');
    // Disabling the pack takes its stylesheet away with its screen.
    await runtime.packs.packs.setEnabled('board-pack', false);
    assert.equal(sheetsOf(doc, 'ss-css-board-pack-board').length, 0);
});
