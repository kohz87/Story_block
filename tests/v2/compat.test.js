// The Story Suite overlay's Versions fold (compat.js): every installed module with its version and the
// Story Block it needs; what is out of step (refused for the version, made for a newer Story Block, a
// clash, installed twice) with one plain sentence on how to fix it. The registry keeps its refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../ui-fake-dom.js';
import { createRegistry } from '../../src/v2/registry.js';
import { createSettings } from '../../src/v2/sdk.js';
import { compatReport, renderCompat } from '../../src/v2/compat.js';
import { VERSIONS_FOLD, renderSettingsHost } from '../../src/v2/host-ui.js';

const doc = installFakeDom();
const HOST = '2.0.0-alpha.2';

function registryWith(...defs) {
    const warned = [];
    const registry = createRegistry({ hostVersion: HOST, warn: line => warned.push(line) });
    for (const def of defs) {
        try { registry.register(def); } catch { /* refused: kept in registry.refusals() */ }
    }
    return { registry, warned };
}

const core = { id: 'story-block', name: 'Story Block', version: HOST };
const sd = { id: 'story-director', name: 'Story Director', version: '2.0.0-alpha.2', requires: { storyBlock: '>=2.0.0-alpha.2' }, queries: { 'sd.x': () => 1 } };
const rb = { id: 'rpg-battle', name: 'RPG Battle', version: '2.1.0', requires: { storyBlock: '>=2.1.0' } };
const nsd = { id: 'npc-state-delta', name: 'NPC State Delta', version: '2.0.0', queries: { 'npc.x': () => 1 } };
const future = { id: 'loot', name: 'Loot', version: '0.3.0', requires: { storyBlock: '^2', lootTables: '^1' }, grids: {} };

test('the registry keeps who it refused and why, until that module registers', () => {
    const { registry } = registryWith(core, sd, rb, { ...sd, id: 'story-director-copy', queries: { 'sd.x': () => 2 } });
    const refused = registry.refusals();
    assert.deepEqual(refused.map(item => [item.id, item.forVersion]), [['rpg-battle', true], ['story-director-copy', false]]);
    assert.equal(refused[0].message, 'RPG Battle needs Story Block ≥ 2.1.0; this is 2.0.0-alpha.2. Update Story Block to use it.');
    assert.equal(refused[0].requires, '>=2.1.0');
    assert.match(refused[1].message, /the query "sd\.x" already belongs to "story-director"/);
    assert.equal(registry.hostVersion(), HOST);
    // A fixed version registers: the refusal goes.
    registry.register({ ...rb, requires: { storyBlock: '^2' } });
    assert.deepEqual(registry.refusals().map(item => item.id), ['story-director-copy']);
});

test('compatReport: Story Block first; in step, unstated, newer, refused for the version, a clash, twice', () => {
    const { registry } = registryWith(core, sd, rb, nsd, future, { ...nsd, version: '1.9.0' }, { id: 'clash', name: 'Clash', requires: { storyBlock: '^2' }, queries: { 'npc.x': () => 2 } });
    const report = compatReport({ hostVersion: HOST, modules: registry.modules(), refusals: registry.refusals() });
    const byId = Object.fromEntries(report.rows.map(row => [row.id, row]));
    assert.equal(report.rows[0].id, 'story-block');
    assert.equal(report.rows[0].note, 'This Story Block is 2.0.0-alpha.2.');
    assert.equal(byId['story-director'].state, 'ok');
    assert.equal(byId['story-director'].note, 'Needs Story Block >=2.0.0-alpha.2: this one fits.');
    assert.equal(byId['npc-state-delta'].state, 'twice', 'a second copy was refused');
    assert.equal(byId['npc-state-delta'].fix, 'Two copies of NPC State Delta are installed; remove the older one in SillyTavern\'s Extensions panel and reload.');
    assert.equal(byId.loot.state, 'newer');
    assert.equal(byId.loot.fix, 'Loot was made for a newer Story Block: update Story Block to use all of it (until then those parts are left out).');
    assert.match(byId.loot.note, /^2 parts of it this Story Block does not know: "grids" is not a module field this Story Block knows; "requires\.lootTables" is not a requires field this Story Block knows\.$/);
    assert.equal(byId['rpg-battle'].state, 'refused');
    assert.equal(byId['rpg-battle'].version, '2.1.0');
    assert.equal(byId['rpg-battle'].fix, 'Update Story Block to use RPG Battle (this is 2.0.0-alpha.2; it needs >=2.1.0), or install the RPG Battle version made for this one.');
    assert.equal(byId.clash.state, 'refused');
    assert.match(byId.clash.fix, /^Clash could not be loaded beside the modules here: update Clash and the module it clashes with/);
    assert.equal(report.outOfStep, 4, 'loot, rpg-battle, clash, the second NSD');
    // A module that says nothing of the Story Block it needs is in step, and noted.
    const plain = compatReport({ hostVersion: HOST, modules: [{ id: 'quiet', version: '1.0.0' }] });
    assert.deepEqual(plain.rows.map(row => [row.name, row.state, row.note]), [['quiet', 'unstated', 'It does not say which Story Block it needs.']]);
    assert.equal(plain.outOfStep, 0);
    // A module registered without the check (no host version then) that does not fit this one.
    const unchecked = compatReport({ hostVersion: HOST, modules: [{ id: 'old', name: 'Old', requires: { storyBlock: '>=3' } }] });
    assert.equal(unchecked.rows[0].fix, 'Old needs Story Block >=3; this is 2.0.0-alpha.2. Update Story Block.');
});

test('renderCompat: plain text only, one row per module, the fix under what is out of step', () => {
    const el = doc.createElement('div');
    const report = compatReport({ hostVersion: HOST, modules: [core, { ...sd, name: '<img src=x onerror=alert(1)>' }], refusals: [{ id: 'rpg-battle', name: 'RPG Battle', version: '2.1.0', requires: '>=2.1.0', forVersion: true, message: 'RPG Battle needs Story Block ≥ 2.1.0.' }] });
    renderCompat(el, report, { doc });
    assert.equal(el.querySelector('p').textContent, '1 module is out of step with this Story Block (2.0.0-alpha.2).');
    const rows = el.querySelectorAll('.story-suite-compat-row');
    assert.deepEqual(rows.map(row => row.dataset.state), ['ok', 'ok', 'refused']);
    assert.equal(rows[1].querySelector('b').textContent, '<img src=x onerror=alert(1)>', 'a name stays text');
    assert.equal(el.querySelectorAll('img').length, 0);
    assert.equal(rows[2].querySelector('.story-suite-compat-requires').textContent, 'needs Story Block >=2.1.0');
    assert.equal(rows[2].querySelector('.story-suite-compat-state').textContent, 'Not loaded');
    assert.match(rows[2].querySelector('.story-suite-compat-fix').textContent, /^Update Story Block to use RPG Battle/);
    assert.equal(rows[0].querySelector('.story-suite-compat-requires'), null, 'Story Block needs no Story Block');
    renderCompat(el, compatReport({ hostVersion: HOST, modules: [core] }), { doc });
    assert.equal(el.querySelector('p').textContent, 'Every module here fits this Story Block (2.0.0-alpha.2).');
});

test('the overlay\'s Versions fold, last, says in its title how many are out of step', () => {
    const { registry } = registryWith(core, sd, rb);
    const settings = createSettings({ root: () => ({}), registry });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const folds = root.querySelectorAll('details.story-suite-fold');
    const versions = folds.at(-1);
    assert.equal(versions.dataset.fold, VERSIONS_FOLD);
    assert.equal(versions.querySelector('summary b').textContent, 'Versions');
    assert.equal(versions.querySelector('summary small').textContent, '1 out of step');
    assert.ok(versions.classList.contains('story-suite-fold-warn'));
    assert.deepEqual(versions.querySelectorAll('.story-suite-compat-row').map(row => row.dataset.module), ['story-block', 'story-director', 'rpg-battle']);
    const fine = registryWith(core, sd).registry;
    const again = doc.createElement('div');
    renderSettingsHost(again, { registry: fine, settings: createSettings({ root: () => ({}), registry: fine }), doc });
    assert.equal(again.querySelectorAll('details.story-suite-fold').at(-1).querySelector('summary small').textContent, 'all in step');
});
