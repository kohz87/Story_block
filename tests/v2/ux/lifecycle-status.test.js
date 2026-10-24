// Where a module stands in the lifecycle (docs/v2/LIFECYCLE.md) is shown, read-only, on its Modules card and in the
// Versions list: a dormant module says what it waits for, a restore pending says so, a ready one says nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { LIFE_TEXT, compatReport, renderCompat } from '../../../src/v2/compat.js';
import { renderSettingsHost } from '../../../src/v2/host-ui.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';

const HOST = '2.0.0-beta.2';
const rb = () => ({ id: 'rpg-battle', name: 'RPG Battle', version: '2.0.0-beta.2', requires: { storyBlock: '>=2.0.0-beta.2', peers: { 'story-director': '>=2.0.0-beta.1' } }, domains: { party: { initial: () => ({}) } } });
const sd = () => ({ id: 'story-director', name: 'Story Director', version: '2.0.0-beta.2', requires: { storyBlock: '>=2.0.0-beta.2' } });
const core = { id: 'story-block', name: 'Story Block', version: HOST };

test('compatReport adds each module\'s status and reason; a module that waits is not out of step', () => {
    const registry = createRegistry({ hostVersion: HOST });
    registry.register(rb());
    const report = compatReport({ hostVersion: HOST, modules: [core, ...registry.modules()], lifecycle: id => registry.lifecycle(id) });
    assert.deepEqual(report.rows.map(row => [row.id, row.status]), [['story-block', 'ready'], ['rpg-battle', 'dormant']]);
    assert.match(report.rows[1].reason, /^Needs story-director >=2\.0\.0-beta\.1, which is not installed\.$/);
    assert.equal(report.outOfStep, 0);
    // Without a lifecycle (an older registry) every row is ready.
    assert.deepEqual(compatReport({ hostVersion: HOST, modules: [core] }).rows.map(row => row.status), ['ready']);
    registry.register(sd());
    assert.deepEqual(compatReport({ hostVersion: HOST, modules: registry.modules(), lifecycle: id => registry.lifecycle(id) }).rows.map(row => row.status), ['ready', 'ready']);
});

test('renderCompat: a line under the module that is not running, plain text; none for one that is', () => {
    const doc = installFakeDom();
    const registry = createRegistry({ hostVersion: HOST });
    registry.register(rb());
    registry.register({ ...sd(), name: '<b>Director</b>' });
    registry.setEnabled('story-director', false, 'Turned off for now.');
    const el = doc.createElement('div');
    renderCompat(el, compatReport({ hostVersion: HOST, modules: registry.modules(), lifecycle: id => registry.lifecycle(id) }), { doc });
    const rows = el.querySelectorAll('.story-suite-compat-row');
    assert.deepEqual(rows.map(row => row.dataset.module), ['rpg-battle', 'story-director']);
    const lines = rows.map(row => row.querySelector('.story-suite-compat-status')?.textContent ?? null);
    assert.equal(lines[0], `${LIFE_TEXT.dormant}: Needs <b>Director</b>, which is not ready: Turned off for now.`);
    assert.equal(lines[1], `${LIFE_TEXT.dormant}: Turned off for now.`);
    assert.equal(rows[1].querySelector('b').textContent, '<b>Director</b>', 'a name stays text');
    assert.equal(el.querySelectorAll('b b').length, 0);
    registry.setEnabled('story-director', true);
    registry.setRestore('pending', 'Going back.');
    renderCompat(el, compatReport({ hostVersion: HOST, modules: registry.modules(), lifecycle: id => registry.lifecycle(id) }), { doc });
    assert.deepEqual(el.querySelectorAll('.story-suite-compat-status').map(node => node.textContent), [`${LIFE_TEXT['restore-pending']}: Going back.`, `${LIFE_TEXT['restore-pending']}: Going back.`]);
    registry.setRestore('idle');
    renderCompat(el, compatReport({ hostVersion: HOST, modules: registry.modules(), lifecycle: id => registry.lifecycle(id) }), { doc });
    assert.equal(el.querySelectorAll('.story-suite-compat-status').length, 0);
});

test('the overlay\'s Versions fold shows a dormant module\'s status and reason', () => {
    const doc = installFakeDom();
    const registry = createRegistry({ hostVersion: HOST });
    registry.register(core);
    registry.register(rb());
    const settings = createSettings({ root: () => ({}), registry });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const versions = root.querySelectorAll('details.story-suite-fold').at(-1);
    const row = versions.querySelectorAll('.story-suite-compat-row').find(item => item.dataset.module === 'rpg-battle');
    assert.match(row.querySelector('.story-suite-compat-status').textContent, /^Waiting: Needs story-director/);
    assert.equal(versions.querySelectorAll('.story-suite-compat-row').find(item => item.dataset.module === 'story-block').querySelector('.story-suite-compat-status'), null);
});

test('Settings → Modules: the card of a module that waits says what for; the Versions card too; a ready one is quiet', async () => {
    const doc = setupDom();
    const host = await createHost({ modules: [sd(), rb()] });
    host.registry.setEnabled('story-director', false, 'Turned off.');
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map() });
    win.select('modules');
    const page = win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'modules');
    const card = id => page.querySelectorAll('.ss-module-card').find(node => node.dataset.module === id);
    const status = id => card(id).querySelector('.ss-module-status');
    assert.equal(status('rpg-battle').hidden, false);
    assert.equal(status('rpg-battle').textContent, `${LIFE_TEXT.dormant}: Needs Story Director, which is not ready: Turned off.`);
    assert.equal(status('story-director').textContent, `${LIFE_TEXT.dormant}: Turned off.`);
    assert.equal(status('story-block').hidden, true);
    assert.equal(status('story-block').textContent, '');
    const versions = page.querySelector('.ss-versions-card');
    assert.match(versions.querySelectorAll('.story-suite-compat-row').find(item => item.dataset.module === 'rpg-battle').querySelector('.story-suite-compat-status').textContent, /^Waiting: Needs Story Director/);
    // No switch: the status is text only.
    assert.equal(card('rpg-battle').querySelectorAll('input[type="checkbox"]').filter(node => /enabled|switch|dormant/i.test(node.dataset?.field ?? '')).length, 0);
    host.close();
});
