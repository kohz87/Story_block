// The block keys of the layouts (BLOCKS-UI): `group`/`as` on a field, `show.into`, and a pack screen's `tab`, `tabTitle` and `order`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataModules, validateDataMigration } from '../../../src/v2/data-modules/check.js';
import { checkScreens } from '../../../src/v2/packs/validate.js';
import { SCREEN_FIELDS } from '../../../src/v2/packs/limits.js';
import { buildBlock, blockDraft, editableBlockDraft } from '../../../src/v2/data-modules/block-builder.js';

const CAPS = ['data-modules-v1'];
const record = () => ({ slug: 'quests', name: 'Quests', schema: 1, stateVersion: 1, scope: 'chat', kinds: {},
    show: { tab: true, card: false, tabName: 'Quests', icon: 'ph-bookmark-simple' },
    state: {
        t: { type: 'text', max: 60, default: '', group: 'q1', as: 'title' }, a: { type: 'text', max: 240, default: '', group: 'q1', as: 'text' },
        s: { type: 'text', max: 120, default: '', group: 'q1', as: 'step' }, st: { type: 'enum', values: ['active', 'done', 'failed'], default: 'active', group: 'q1', as: 'status' },
    } });
const check = change => { const d = record(); change(d); return validateDataModules([d], { packId: 'chat', capabilities: CAPS }); };
const paths = result => (result.ok ? [] : result.errors.map(error => error.path));

test('a quest record (group and as on its fields) is a valid block', () => {
    const result = check(() => {});
    assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('the hash of a block changes only when its author adds group and as', () => {
    const plain = record(); for (const field of Object.values(plain.state)) { delete field.group; delete field.as; }
    const withKeys = validateDataModules([record()], { packId: 'chat', capabilities: CAPS });
    const without = validateDataModules([plain], { packId: 'chat', capabilities: CAPS });
    assert.equal(without.ok, true);
    assert.equal(Object.hasOwn(without.definitions[0].state.t, 'group'), false, 'a block without the keys gains none');
    assert.notDeepEqual(withKeys.definitions[0].state, without.definitions[0].state);
});

test('group and as come together, and a record has one title and at most one of each other part', () => {
    assert.ok(paths(check(d => { delete d.state.t.as; })).some(path => path.endsWith('t.group')), 'group without as');
    assert.ok(paths(check(d => { delete d.state.t.group; })).some(path => path.endsWith('t.group')), 'as without group');
    assert.ok(paths(check(d => { d.state.a.as = 'step'; })).some(path => path.endsWith('.group')), 'two steps');
    assert.ok(paths(check(d => { d.state.t.as = 'text'; d.state.a.as = 'text'; })).some(path => path.endsWith('.group')), 'no title');
    assert.ok(paths(check(d => { d.state.t.as = 'nonsense'; })).length, 'an unknown part');
});

test('title, text and step are text and status is a choice', () => {
    assert.ok(paths(check(d => { d.state.st.as = 'step'; })).some(path => path.endsWith('st.as')), 'a choice as a step');
    assert.ok(paths(check(d => { d.state.s.as = 'status'; })).some(path => path.endsWith('s.as')), 'text as a status');
    assert.ok(paths(check(d => { d.state.t = { type: 'int', min: 0, max: 5, default: 0, group: 'q1', as: 'title' }; })).length, 'a number as a title');
    assert.ok(paths(check(d => { d.state.t.list = true; })).some(path => path.endsWith('t.as')), 'a list');
    assert.ok(paths(check(d => { d.state.m = { type: 'map', keys: ['a'], values: { type: 'int', min: 0, max: 5, default: 0, group: 'z', as: 'title' } }; })).length, 'a map value carries no group');
});

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

test('the block editor keeps group, as and show.into when it reads a block back', () => {
    const made = buildBlock({ name: 'Quests', fields: [
        { key: 't', name: 'Quest', type: 'text', max: 60, default: '', group: 'q1', as: 'title' }, { key: 'a', name: 'About', type: 'text', max: 240, default: '', group: 'q1', as: 'text' },
        { key: 'st', name: 'Status', type: 'choice', values: ['active', 'done'], default: 'active', group: 'q1', as: 'status' }], functions: [], prompt: '',
        show: { tab: true, card: false, tabName: 'Quests', icon: 'ph-bookmark-simple', into: 'reputation' } });
    assert.equal(made.ok, true, JSON.stringify(made.errors));
    const built = made.checked;
    const draft = blockDraft(built);
    assert.equal(draft.fields[0].group, 'q1');
    assert.equal(draft.fields[2].as, 'status');
    const again = buildBlock(draft);
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.equal(again.definition.state.t.group, 'q1');
    assert.ok(editableBlockDraft(built), 'a quest block is editable in the form');
    assert.equal(again.definition.show.into, 'reputation');
});

test('a migration may add no field: a change of screens alone is a stateVersion step the pinned chat is offered', () => {
    const base = { slug: 'm', name: 'M', schema: 1, stateVersion: 1, scope: 'chat', kinds: {}, state: { a: { type: 'int', min: 0, max: 5, default: 0 } } };
    const next = { ...structuredClone(base), stateVersion: 2, migrations: [{ from: 1, to: 2, add: {} }] };
    const a = validateDataModules([base], { packId: 'p', capabilities: CAPS }), b = validateDataModules([next], { packId: 'p', capabilities: CAPS });
    assert.equal(b.ok, true, JSON.stringify(b.errors));
    assert.equal(validateDataMigration(a.definitions[0], b.definitions[0]).ok, true);
});
