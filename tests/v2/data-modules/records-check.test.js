// The block keys of the layouts (BLOCKS-UI): `show.into`, and a pack screen's `tab`, `tabTitle` and `order`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataModules, validateDataMigration } from '../../../src/v2/data-modules/check.js';
import { checkScreens } from '../../../src/v2/packs/validate.js';
import { SCREEN_FIELDS } from '../../../src/v2/packs/limits.js';

const CAPS = ['data-modules-v1'];
const record = () => ({ slug: 'quests', name: 'Quests', schema: 1, stateVersion: 1, scope: 'chat', kinds: {},
    show: { tab: true, card: false, tabName: 'Quests', icon: 'ph-bookmark-simple' }, state: { t: { type: 'text', max: 60, default: '' } } });
const check = change => { const d = record(); change(d); return validateDataModules([d], { packId: 'chat', capabilities: CAPS }); };
const paths = result => (result.ok ? [] : result.errors.map(error => error.path));

test('show.into names a tab id; any other show key is still refused', () => {
    assert.equal(check(d => { d.show.into = 'reputation'; }).ok, true);
    assert.equal(check(d => { d.show.into = 'Not A Tab'; }).ok, false);
    assert.equal(check(d => { d.show.into = 7; }).ok, false);
    assert.equal(check(d => { d.show.other = true; }).ok, false);
});

test('a pack screen may carry tab, tabTitle and order, each checked', () => {
    for (const key of ['tab', 'tabTitle', 'order']) assert.ok(SCREEN_FIELDS.includes(key), key);
    const run = extra => { const problems = []; const out = checkScreens([{ id: 'a', mounts: ['tab'], layout: { root: { type: 'col', children: [] } }, ...extra }], 'p', (code, at, message) => problems.push(`${code} ${message}`)); return { out, problems }; };
    assert.equal(run({ tab: 'reputation', tabTitle: 'Reputation', order: 2 }).out.length, 1);
    assert.equal(run({ tab: 'Bad Tab' }).out.length, 0);
    assert.equal(run({ tab: 'rep', tabTitle: '' }).out.length, 0);
    assert.equal(run({ tab: 'rep', tabTitle: 'x'.repeat(25) }).out.length, 0);
    assert.equal(run({ tabTitle: 'Orphan' }).out.length, 0, 'a title needs a tab');
    assert.equal(run({ tab: 'rep', order: 'first' }).out.length, 0);
});

test('a data module screen may show its own fields with story-block.fields, and no other module\'s', () => {
    const module = (props, extra = {}) => ({ slug: 'fame', name: 'Fame', schema: 1, stateVersion: 1, scope: 'chat', kinds: {}, ...extra,
        state: { fame: { type: 'map', keys: ['a', 'b'], values: { type: 'int', min: 0, max: 100, default: 0 } }, mood: { type: 'text', max: 20, default: '' } },
        screens: [{ id: 'fame-tab', mounts: ['tab'], tab: 'rep', layout: { root: { type: 'story-block.fields', props } }, title: 'Fame' }] });
    const run = props => validateDataModules([module(props)], { packId: 'p', capabilities: CAPS });
    assert.equal(run({ module: 'pack.p/fame', field: 'fame', names: { a: 'Alpha' } }).ok, true);
    assert.equal(run({ module: 'pack.p/other', field: 'fame' }).ok, false, 'another module');
    assert.equal(run({ module: 'pack.p/fame', field: 'nothing' }).ok, false, 'a field it does not have');
    assert.equal(run({ module: 'pack.p/fame', field: 'mood', as: 'map' }).ok, false, 'text is not a map of numbers');
    assert.equal(run({ module: 'pack.p/fame', field: 'fame', style: 'x' }).ok, false, 'an unknown prop');
    assert.equal(run({ module: 'pack.p/fame', as: 'record', fields: ['mood'] }).ok, true);
});

test('a migration may add no field: a change of screens alone is a stateVersion step the pinned chat is offered', () => {
    const base = { slug: 'm', name: 'M', schema: 1, stateVersion: 1, scope: 'chat', kinds: {}, state: { a: { type: 'int', min: 0, max: 5, default: 0 } } };
    const next = { ...structuredClone(base), stateVersion: 2, migrations: [{ from: 1, to: 2, add: {} }] };
    const a = validateDataModules([base], { packId: 'p', capabilities: CAPS }), b = validateDataModules([next], { packId: 'p', capabilities: CAPS });
    assert.equal(b.ok, true, JSON.stringify(b.errors));
    assert.equal(validateDataMigration(a.definitions[0], b.definitions[0]).ok, true);
});
