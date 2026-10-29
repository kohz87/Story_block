import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { parseLabels } from '../../../src/v2/data-modules/interpreter.js';
import { moduleGrammar } from '../../../src/v2/data-modules/grammar.js';
import { describe } from '../../../src/v2/data-modules/setup.js';
import { definition, pack, pin, view, world } from '../data-modules/helpers.js';

function made() {
    const d = definition();
    d.state.mode = { type: 'enum', values: ['calm', 'wary'], default: 'calm' };
    d.state.notes = { type: 'text', max: 8, default: '' };
    d.state.locked = { type: 'int', min: 0, max: 5, default: 1, edit: false };
    d.state.standing = { type: 'map', keys: ['guild', 'watch'], values: { type: 'int', min: -5, max: 5, default: 0 } };
    d.rules = [{ id: 'threshold', when: ['ge', ['get', ['points']], 5], then: [{ op: 'set', path: ['mode'], value: 'wary' }] }];
    return d;
}

test('dm.set validates fields, rules, bounds, map keys and non-editable fields', async t => {
    const host = await world(t, pack([made()]));
    const offer = await pin(host);
    await host.send('Wait.', 'The road.');
    const set = payload => host.sdk.command('dm.set', { module: offer.module, ...payload });
    for (const payload of [{ field: 'points', value: 101 }, { field: 'mode', value: 'other' }, { field: 'standing', key: 'other', value: 1 }, { field: 'locked', value: 2 }, { field: 'unknown', value: 1 }]) {
        const result = await set(payload);
        assert.equal(result.ok, false, JSON.stringify(payload));
    }
    const result = await set({ field: 'points', value: 5 });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.receipt.data.edit, true);
    assert.equal(view(host, offer.module).chat.mode, 'wary');
    const map = await set({ field: 'standing', key: 'guild', value: 3 });
    assert.equal(map.ok, true, map.message);
    assert.equal(view(host, offer.module).chat.standing.guild, 3);
    const text = await set({ field: 'notes', value: 'a long note over the limit' });
    assert.equal(text.ok, true, text.message);
    assert.equal(view(host, offer.module).chat.notes, 'a long n');
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
    assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
    assert.equal(view(host, offer.module).chat.mode, 'wary');
    await host.swipe('Another road.');
    assert.equal(view(host, offer.module).chat.points, 0);
    assert.equal(view(host, offer.module).chat.mode, 'calm');
});

test('text labels are bounded and nonempty; only equality with a literal is allowed in conditions', () => {
    const d = made();
    d.kinds.note = { op: '~', labels: { note: { type: 'text', max: 8 } }, effects: [{ op: 'set', path: ['notes'], value: { arg: 'note' } }] };
    d.kinds.note.when = ['eq', ['arg', 'note'], 'hello'];
    const checked = validatePack(pack([d]));
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    const normalized = checked.pack.content.dataModules[0];
    assert.match(moduleGrammar(normalized, 'counter'), /\| note: text/);
    assert.deepEqual(parseLabels(normalized, normalized.kinds.note, { kind: 'note', note: '   nine plus more  ' }, { text: true }), { note: 'nine plu' });
    assert.throws(() => parseLabels(normalized, normalized.kinds.note, { kind: 'note', note: '  ' }, { text: true }), /nonempty text/);
    assert.ok(describe({ definition: normalized, module: normalized.id }).fields.some(line => line.includes('locked') && line.includes('cannot be edited')));
    for (const condition of [['lt', ['arg', 'note'], 'hello'], ['eq', ['arg', 'note'], ['get', ['notes']]], ['eq', ['arg', 'note'], ['arg', 'note']]]) {
        d.kinds.note.when = condition;
        assert.equal(validatePack(pack([d])).ok, false, JSON.stringify(condition));
    }
});

test('text-label effects use the existing interpreter and reject text that does not fit its field', async t => {
    const d = made();
    d.kinds.note = { op: '~', labels: { note: { type: 'text', max: 8 } }, effects: [{ op: 'set', path: ['notes'], value: { arg: 'note' } }] };
    const host = await world(t, pack([d]));
    const offer = await pin(host);
    await host.send('Write.', 'Notes.\n\n<Changes>\n~ dm counter — update | kind: note | note: river in winter\n</Changes>');
    assert.equal(view(host, offer.module).chat.notes, 'river in');
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
    d.kinds.note.labels.note.max = 9;
    assert.equal(validatePack(pack([d])).ok, false);
});

test('data-module template editables may address only their own editable fields', () => {
    const d = made();
    const screen = props => `<ss-widget name="ss.editable" data-props='${JSON.stringify(props)}'></ss-widget>`;
    d.screens = [{ id: 'edit', mounts: ['tab'], template: screen({ command: 'dm.set', payload: { module: 'pack.dm-test/counter', field: 'points' } }) }];
    assert.equal(validatePack(pack([d])).ok, true);
    for (const props of [
        { command: 'inventory.add', payload: { name: 'Coin' } },
        { command: 'dm.set', payload: { module: 'pack.other/counter', field: 'points' } },
        { command: 'dm.set', payload: { module: 'pack.dm-test/counter', field: 'locked' } },
        { command: 'dm.set', payload: { module: 'pack.dm-test/counter', field: 'standing', key: 'other' } },
    ]) {
        d.screens[0].template = screen(props);
        assert.equal(validatePack(pack([d])).ok, false, JSON.stringify(props));
    }
});

test('a pinned layout puts pencils beside displayed editable fields', async t => {
    const { fixture } = await import('../data-modules/helpers.js');
    const { renderLayout } = await import('../../../src/v2/layout/index.js');
    const { standardWidgets } = await import('../../../src/v2/view/widgets/index.js');
    const { setupDom } = await import('../view/mounts/helpers.js');
    const host = await world(t, fixture('reputation'));
    const offer = await pin(host);
    const screen = host.sdk.query('dataModules.presentation', { kind: 'screens' })[0];
    const doc = setupDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const calls = [];
    const rendered = renderLayout(el, { id: screen.id, root: screen.layout.root }, {
        query: (name, args) => host.sdk.query(name, args), widgets: standardWidgets,
        command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; },
    });
    assert.deepEqual(rendered.problems, []);
    const pencils = el.querySelectorAll('.ss-w-editable-pencil');
    assert.ok(pencils.length >= 3);
    pencils[0].click();
    const input = el.querySelector('.ss-w-editable-form input');
    input.value = '5';
    el.querySelector('.ss-w-editable-save').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls[0], ['dm.set', { module: offer.module, field: 'standing', key: 'guild', value: 5 }]);
    rendered.dispose();
});
