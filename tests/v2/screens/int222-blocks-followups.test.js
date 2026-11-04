// INT-222 follow-ups from the Blocks review: status tones follow the editor's default, show.into has one rule, a map folds only defaults of 0 or the minimum,
// and the editor's preview draws the bars and fields layouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { createBlockWidgets, BLOCK_WIDGET } from '../../../src/v2/screens/blocks.js';
import { barFields, renderBlockPreview, statusTone } from '../../../src/v2/screens/block-layouts.js';
import { BLOCK_STARTERS } from '../../../src/v2/data-modules/block-starters.js';
import { buildBlock } from '../../../src/v2/data-modules/block-builder.js';
import { setupDom } from '../view/mounts/helpers.js';
import { success } from '../data-modules/helpers.js';

async function world(t) {
    const doc = setupDom();
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    return { doc, host, api: { query: (name, args) => host.sdk.query(name, args), command: (type, payload) => host.sdk.command(type, payload) } };
}
const stub = (definition, values) => ({ query: name => (name === 'dataModules.setup' ? [{ module: definition.id, packId: 'chat', pinned: true, pinnedDefinition: definition }]
    : name === 'dataModules.view' ? { chat: values } : null), command: async () => ({ ok: true }) });
const render = (doc, api, module) => {
    const el = doc.createElement('div');
    const view = createBlockWidgets({}).widgets[BLOCK_WIDGET].render(el, { module }, api);
    return { el, view };
};
const questBlock = statuses => ({
    id: 'pack.chat/log', pack: 'chat', slug: 'log', name: 'Quest log', scope: 'chat', kinds: {}, show: { tab: true, card: false, tabName: 'Log', icon: 'ph-star' },
    layout: 'cards', roles: { field: 'quests', title: 'title', status: 'status' },
    state: { quests: { type: 'entries', label: 'Quests', max: 30, default: [], of: { title: { type: 'text', max: 60 }, status: { type: 'enum', values: statuses, default: statuses[0] } } } } });

test('statusTone falls back to the editor\'s default: active, done and failed by name, any other value neutral and open', async t => {
    const definition = questBlock(['active', 'paused', 'done']);
    assert.deepEqual(['active', 'paused', 'done', 'failed'].map(value => statusTone(definition, ['active', 'paused', 'done'], value)), ['active', 'neutral', 'done', 'failed']);
    assert.equal(statusTone({ ...definition, tones: { paused: 'failed' } }, [], 'paused'), 'failed', 'a stored tone wins');
    assert.equal(statusTone(questBlock(['done', 'active']), ['done', 'active'], 'done'), 'done', 'the first value is not made active');
    const { doc } = await world(t);
    const { el, view } = render(doc, stub(definition, { quests: [{ title: 'Wait for rain', status: 'paused' }, { title: 'Find the key', status: 'active' }, { title: 'Pay the toll', status: 'done' }] }), definition.id);
    t.after(() => view.destroy());
    const open = el.querySelector('.ss-b-quest');
    assert.ok(open, 'cards drawn');
    assert.deepEqual(el.querySelectorAll('.ss-section-label').map(node => node.textContent), ['Active (2)'], 'paused stays open');
    assert.equal(el.querySelector('summary').textContent, 'Finished (1)');
});

test('a map folds only the rows at a default of 0 or the minimum: Court favour at 40/35/25 lists all three', async t => {
    const { doc, host, api } = await world(t);
    const base = { schema: 1, stateVersion: 1, scope: 'chat', kinds: {}, show: { tab: true, card: false, tabName: 'X', icon: 'ph-star' } };
    success(await host.sdk.command('dm.define', { definition: { ...base, slug: 'court', name: 'Court favour',
        state: { favour: { type: 'map', label: 'Court favour', keys: ['wendhild', 'corvin', 'hasse'], values: { type: 'int', min: 0, max: 100, default: 40 } } } } }));
    const court = render(doc, api, 'pack.chat/court');
    t.after(() => court.view.destroy());
    assert.deepEqual(court.el.querySelectorAll('.ss-b-box > .ss-b-list > .ss-b-row .ss-b-name').map(node => node.textContent), ['Wendhild', 'Corvin', 'Hasse']);
    assert.equal(court.el.querySelector('details.ss-b-fold'), null, 'nothing is folded');
    success(await host.sdk.command('dm.define', { definition: { ...base, slug: 'fame', name: 'Fame',
        state: { fame: { type: 'map', label: 'Fame', keys: ['a', 'b'], values: { type: 'int', min: -10, max: 10, default: -10 } } } } }));
    const fame = render(doc, api, 'pack.chat/fame');
    t.after(() => fame.view.destroy());
    assert.equal(fame.el.querySelector('summary').textContent, 'Not known yet (2)', 'a default at the minimum is still folded');
});

test('each starter\'s editor preview is not empty, and a bars block of plain numbers is drawn as one map of numbers in its tab', async t => {
    const { doc, host, api } = await world(t);
    for (const starter of BLOCK_STARTERS) {
        const built = buildBlock(starter.draft());
        assert.ok(built.definition, `${starter.id} builds`);
        const values = Object.fromEntries(Object.entries(built.definition.state).map(([field, schema]) => [field,
            schema.type === 'entries' ? [{ title: 'Find the key', status: 'active', step: 'Ask the smith' }, { title: 'Warn the mill', status: 'done' }] : schema.default]));
        const parent = doc.createElement('div');
        const handle = renderBlockPreview(parent, { definition: built.definition, values, layout: built.definition.layout ?? 'fields' });
        t.after(() => handle.destroy());
        assert.ok(parent.querySelectorAll('*').length > 0, `${starter.id}: the preview draws something`);
        assert.equal(parent.querySelectorAll('.ss-w-editable-pencil').length, 0, `${starter.id}: no editors in the preview`);
    }
    const bars = buildBlock(BLOCK_STARTERS.find(item => item.id === 'reputation').draft()).definition;
    assert.equal(barFields(bars).length, 4);
    const preview = doc.createElement('div');
    renderBlockPreview(preview, { definition: bars, values: {}, layout: 'bars' });
    assert.ok(preview.querySelector('.ss-b-map'), 'bars: a map of numbers');
    const membership = buildBlock(BLOCK_STARTERS.find(item => item.id === 'membership').draft()).definition;
    const card = doc.createElement('div');
    renderBlockPreview(card, { definition: membership, values: {}, layout: 'fields' });
    assert.ok(card.querySelector('.ss-b-card'), 'fields: a record card');
    // the tab
    success(await host.sdk.command('dm.define', { definition: bars }));
    const tab = render(doc, api, `pack.chat/${bars.slug}`);
    t.after(() => tab.view.destroy());
    assert.equal(tab.el.querySelectorAll('.ss-b-map').length, 1, 'one map of numbers for the four fields');
    assert.equal(tab.el.querySelectorAll('.ss-b-row').length + tab.el.querySelectorAll('details .ss-b-row').length > 0, true);
});
