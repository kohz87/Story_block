// Features in the page (MODULES §F100): the settings overlay's Features (a subsection in each module's
// fold, one overview of every module's, the prompt hint), and the page following a switch: a module's
// screens, tabs and widgets hidden, Story Block's status strip and cards under replies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { makeMessage } from '../ui-fake-dom.js';
import { setupDom } from './view/mounts/helpers.js';
import { FEATURES_FOLD, FEATURE_TEXT, renderSettingsHost } from '../../src/v2/host-ui.js';
import { CORE_FEATURE, PROMPT_HINT } from '../../src/v2/features.js';
import { hudOn, mountUi } from '../../src/v2/ui-host.js';
import { CHANGES_CARD_SCREEN_ID } from '../../src/v2/screens/index.js';

const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);

// Two features: one that changes the static prompt (it owns a kind), one that owns screens, a tab and a widget.
const loot = () => ({
    id: 'loot',
    name: 'Loot',
    features: [
        { id: 'loot.picker', label: 'Loot picker', describe: 'Pick what to keep after a fight.' },
        { id: 'loot.weight', label: 'Weight', describe: 'Items weigh something.', default: false },
    ],
    capture: { kinds: { weight: { grammar: '~ weight Item | kg: 1', feature: 'loot.weight' } }, apply: () => ({ summary: 'ok', narrate: false }) },
    screens: [
        { id: 'loot/picker', title: 'Picker', mounts: ['tab', 'hud'], template: '<p class="picker">pick</p>', feature: 'loot.picker' },
        { id: 'loot/bag', title: 'Bag', mounts: ['tab'], template: '<p class="bag">bag</p>' },
    ],
    tabs: [{ id: 'loot-code', title: 'Loot code', render: el => { el.textContent = 'code'; }, feature: 'loot.picker' }],
    widgets: { 'loot.gem': { render: el => { el.textContent = 'gem'; }, feature: 'loot.picker' } },
});
// A module with settings and no features: its fold has no Features subsection.
const plain = () => ({ id: 'plain', name: 'Plain', settings: { defaults: { on: true }, schema: { on: { type: 'bool', label: 'On' } } } });

async function overlay(options = {}) {
    const doc = setupDom();
    const host = await createHost({ modules: [loot(), plain()], ...options });
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const view = renderSettingsHost(root, { registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk });
    return { doc, host, root, view };
}

const foldOf = (root, key) => root.querySelectorAll('details.story-suite-fold').find(node => node.dataset.fold === key);
const rowsOf = node => node.querySelectorAll('.story-suite-feature');

test('the overlay: one Features overview of every module, then a Features subsection in each module\'s fold', async () => {
    const { root, host } = await overlay();
    const folds = root.querySelectorAll('details.story-suite-fold').map(node => node.dataset.fold);
    assert.deepEqual(folds, ['story-suite', FEATURES_FOLD, 'loot', 'plain', 'story-block'], 'host, overview, then modules by id');
    const overview = foldOf(root, FEATURES_FOLD);
    assert.equal(overview.querySelector('summary b').textContent, FEATURE_TEXT.title);
    assert.deepEqual(texts(overview, '.story-suite-feature-group > h4'), ['Loot', 'Story Block']);
    assert.deepEqual(rowsOf(overview).map(row => row.dataset.feature), ['loot.picker', 'loot.weight', ...host.registry.features().filter(f => f.moduleId === 'story-block').map(f => f.id)]);
    // Loot has no settings of its own, yet gets a fold for its features.
    const lootFold = foldOf(root, 'loot');
    assert.deepEqual(texts(lootFold, '.story-suite-features > h4'), [FEATURE_TEXT.title]);
    const [picker, weight] = rowsOf(lootFold);
    assert.equal(picker.querySelector('b').textContent, 'Loot picker');
    assert.deepEqual(texts(picker, 'small'), ['Pick what to keep after a fight.']);
    assert.equal(picker.querySelector('input').checked, true);
    assert.equal(picker.querySelector('input').getAttribute('role'), 'switch');
    // A feature that changes the static prompt says so.
    assert.deepEqual(texts(weight, 'small'), ['Items weigh something.', PROMPT_HINT]);
    assert.equal(PROMPT_HINT, 'Changes the fixed prompt once (one slower reply).');
    assert.equal(weight.querySelector('input').checked, false);
    // No features, no subsection.
    assert.equal(foldOf(root, 'plain').querySelector('.story-suite-features'), null);
    assert.deepEqual(texts(foldOf(root, 'story-block'), '.story-suite-features .story-suite-feature b'), ['Status strip', 'Cards under replies', 'Roll checks before the reply', 'Read changes from replies that forgot them']);
    host.close();
});

test('the overlay: a switch stores the reader\'s choice, and both rows of that feature follow it', async () => {
    const { root, host, view } = await overlay();
    const inOverview = rowsOf(foldOf(root, FEATURES_FOLD)).find(row => row.dataset.feature === 'loot.weight').querySelector('input');
    const inModule = rowsOf(foldOf(root, 'loot')).find(row => row.dataset.feature === 'loot.weight').querySelector('input');
    inModule.checked = true;
    inModule.dispatch('change');
    assert.equal(host.sdk.feature('loot.weight'), true);
    assert.equal(host.ctx.extensionSettings.storySuite.features['loot.weight'], true);
    assert.equal(inOverview.checked, true);
    assert.equal(inOverview.getAttribute('aria-checked'), 'true');
    inOverview.checked = false;
    inOverview.dispatch('change');
    assert.equal(host.sdk.feature('loot.weight'), false);
    assert.equal(inModule.checked, false);
    // A redraw shows what is stored, and keeps the open folds open.
    foldOf(root, 'loot').open = true;
    view.refresh();
    assert.equal(foldOf(root, 'loot').open, true);
    assert.equal(rowsOf(foldOf(root, 'loot'))[1].querySelector('input').checked, false);
    host.close();
});

test('the overlay without a feature store shows no Features (an older caller)', async () => {
    const doc = setupDom();
    const host = await createHost({ modules: [loot(), plain()] });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry: host.registry, settings: host.settings, doc });
    assert.equal(root.querySelector('.story-suite-feature'), null);
    assert.deepEqual(root.querySelectorAll('details.story-suite-fold').map(node => node.dataset.fold), ['story-suite', 'plain', 'story-block']);
    host.close();
});

// ---------------------------------------------------------------------------------------------------
// The page

async function page(options = {}) {
    const doc = setupDom();
    const form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const drawerHost = doc.createElement('div');
    drawerHost.id = 'extensions_settings';
    doc.body.appendChild(drawerHost);
    const host = await createHost({ modules: [loot()], ...options });
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn, features: host.features };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    const draw = () => {
        for (const old of doc.querySelectorAll('.mes')) old.remove();
        host.ctx.chat.forEach((message, index) => makeMessage(doc, index));
    };
    return { doc, host, ui, draw };
}

test('the page: a feature\'s screens, tabs and widgets go when it is turned off and come back when it is on', async () => {
    const { doc, host, ui } = await page();
    ui.openPanel();
    const panel = doc.querySelector('#story_suite_v2_panel');
    const labels = () => texts(panel, '.story-suite-tab-label');
    assert.ok(labels().includes('Picker') && labels().includes('Loot code') && labels().includes('Bag'), labels().join(', '));
    assert.ok(doc.querySelector('.ss-hud .picker'), 'the picker in the status strip');
    assert.ok(ui.screens.resolve('loot/picker'));

    host.features.set('loot.picker', false);
    assert.ok(!labels().includes('Picker') && !labels().includes('Loot code') && labels().includes('Bag'), labels().join(', '));
    assert.equal(doc.querySelector('.ss-hud .picker'), null);
    assert.equal(ui.screens.resolve('loot/picker'), null);
    assert.deepEqual(ui.screens.list('tab').map(entry => entry.id).filter(id => id.startsWith('loot/')), ['loot/bag']);
    // A pack's or the reader's version of an off screen is hidden all the same.
    ui.screens.choose('loot/picker', { id: 'loot/picker', title: 'Mine', mounts: ['tab'], template: '<p>mine</p>' });
    ui.refresh();
    assert.ok(!labels().includes('Mine'));

    host.features.set('loot.picker', true);
    assert.ok(labels().includes('Mine') && labels().includes('Loot code'), labels().join(', '));
    host.close();
});

test('the page: a widget whose feature is off draws nothing, not a "no widget" error', async () => {
    const bag = { id: 'loot/bag', title: 'Bag', mounts: ['tab'], template: '<p class="bag"><ss-widget name="loot.gem"></ss-widget></p>' };
    const { doc, host, ui } = await page({ modules: [{ ...loot(), screens: [bag] }] });
    ui.openPanel();
    const pane = () => {
        doc.querySelectorAll('.story-suite-tab').find(node => node.dataset.tabId === 'loot/bag').click();
        return doc.querySelector('.story-suite-pane');
    };
    assert.ok(pane().textContent.includes('gem'), 'drawn while on');
    host.features.set('loot.picker', false);
    const off = pane();
    assert.ok(off.querySelector('.bag'));
    assert.ok(!/no widget/i.test(off.textContent), off.textContent);
    assert.ok(!off.textContent.includes('gem'));
    host.features.set('loot.picker', true);
    assert.ok(pane().textContent.includes('gem'), 'back on');
    host.close();
});

test('the page: the status strip is Story Block\'s feature; the drawer switch and the feature are one choice', async () => {
    const { doc, host, ui } = await page();
    assert.ok(doc.querySelector('.ss-hud'));
    host.features.set(CORE_FEATURE.hud, false);
    assert.equal(doc.querySelector('.ss-hud'), null, 'the feature hides it');
    assert.equal(doc.querySelector('.story-suite-hud-toggle input').checked, false, 'the drawer switch follows');
    assert.equal(ui.hudOn(), false);
    ui.setHud(true);
    assert.ok(doc.querySelector('.ss-hud'));
    assert.equal(host.sdk.feature(CORE_FEATURE.hud), true);
    assert.equal(host.ctx.extensionSettings.storySuite.features[CORE_FEATURE.hud], true);
    assert.equal(host.ctx.extensionSettings.storySuite.hud, true, 'the old switch kept in step');
    // The feature's choice wins over the old switch; without one the old switch counts.
    assert.equal(hudOn({ storySuite: { hud: false, features: { [CORE_FEATURE.hud]: true } } }), true);
    assert.equal(hudOn({ storySuite: { hud: false } }), false);
    host.close();
});

test('the page: with the cards feature off no card is drawn under a reply; on again they come back', async () => {
    const { doc, host, ui, draw } = await page();
    await host.send('hi', 'You find a rope.\n<Changes>\n+ item Rope | qty: 1\n</Changes>');
    draw();
    ui.mounts.card.refresh(2, { force: true });
    const card = () => doc.querySelector(`.mes[mesid="2"] [data-ss-card="${CHANGES_CARD_SCREEN_ID}"]`);
    assert.ok(card(), 'on by default');
    host.features.set(CORE_FEATURE.cards, false);
    assert.equal(card(), null);
    ui.mounts.card.refresh(2, { force: true });
    assert.equal(card(), null, 'stays off');
    host.features.set(CORE_FEATURE.cards, true);
    ui.mounts.card.refresh(2, { force: true });
    assert.ok(card());
    host.close();
});

test('the page: the overlay opened from the bar has the Features', async () => {
    const { doc, host } = await page();
    doc.querySelector('.story-suite-bar-settings').click();
    const overlayRoot = doc.querySelector('#story_suite_v2_overlay');
    assert.ok(overlayRoot.querySelectorAll('details.story-suite-fold').some(node => node.dataset.fold === FEATURES_FOLD));
    host.close();
});
