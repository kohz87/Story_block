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

test('Home: "Import a pack" while no pack is installed opens the settings at the Packs card, the Import button focused', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui, runtime } = setup(undefined);
    await runtime.turn.onChatChanged();
    assert.equal(runtime.packs.packs.list().length, 0, 'no pack installed in the fake context');
    ui.mounts.screen.open('story-block/home');
    const button = doc.querySelectorAll('.sb-packs-import')[0];
    assert.ok(button, 'the button on Home');
    button.click();
    assert.equal(ui.mounts.screen.isOpen(), false, 'the game view steps aside');
    const overlay = doc.querySelector('#story_suite_v2_overlay');
    const importButton = overlay.querySelector('.ss-packs-card .ss-packs-import');
    assert.ok(importButton);
    assert.ok(doc.activeElement === importButton, 'the Import button has the focus');
    doc.querySelector('#story_suite_v2_overlay .story-suite-close').click();
});
