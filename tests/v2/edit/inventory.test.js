import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { core, stocked, stack, def } from '../domains/fixtures.js';
import { createHarness } from '../domains/helpers/fake-ctx.js';

function setup() {
    const module = core();
    return createHarness(module, { state: stocked(module) });
}
const inv = h => h.state.domains.inventory;
const edit = (h, payload, options) => h.run('inventory.edit', payload, options);

test('edit isolates shared and pack definitions; notes can be cleared', () => {
    const h = setup();
    const changed = edit(h, { stack: 'it_pota0001', name: 'Ruby Potion', qty: 3, note: '' });
    assert.equal(changed.ok, true, changed.message);
    const item = inv(h).stacks.it_pota0001;
    assert.notEqual(item.def, 'pack.fantasy/potion');
    assert.deepEqual([inv(h).defs[item.def].name, item.qty, item.note], ['Ruby Potion', 3, '']);
    assert.equal(inv(h).defs['pack.fantasy/potion'].name, 'Minor Healing Draught');
    assert.equal(inv(h).stacks.it_potb0001.def, 'pack.fantasy/potion');
    assert.equal(changed.result.data.edit, true);
    const other = edit(h, { stack: 'it_sword001', name: 'Ceremonial Sword' });
    assert.equal(other.ok, true, other.message);
    assert.equal(inv(h).defs['pack.fantasy/iron-sword'].name, 'Iron Sword');
    const cleared = edit(h, { stack: 'it_potb0001', note: '' });
    assert.equal(cleared.ok, true, cleared.message);
    assert.equal(inv(h).stacks.it_potb0001.note, '');
});

test('a rename into a known item joins only compatible stacks', () => {
    const h = setup();
    const state = structuredClone(h.state);
    state.domains.inventory.defs['story/hemp'] = def('story/hemp', 'Hemp');
    state.domains.inventory.aliases.hemp = 'story/hemp';
    state.domains.inventory.stacks.it_hemp0001 = stack('it_hemp0001', 'story/hemp', 2);
    h.state = state;
    const result = edit(h, { stack: 'it_hemp0001', name: 'Rope' });
    assert.equal(result.ok, true, result.message);
    assert.equal(inv(h).stacks.it_rope0001.qty, 5);
    assert.equal(inv(h).stacks.it_hemp0001, undefined);
    assert.equal(edit(h, { stack: 'it_potb0001', name: 'Rope' }).ok, false, 'different notes cannot merge');
});

test('reader-only commands reject other causes and invalid quantities; adds respect unstackable caps', () => {
    const h = setup();
    for (const options of [{ cause: 'story' }, { cause: 'system' }, { cause: 'ui', caller: 'another-module' }]) {
        for (const [type, payload] of [['inventory.add', { name: 'Rope' }], ['inventory.edit', { stack: 'it_rope0001', qty: 2 }]]) {
            assert.equal(h.run(type, payload, options).code, 'REFUSED');
        }
    }
    for (const qty of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(edit(h, { stack: 'it_rope0001', qty }).ok, false);
    assert.match(edit(h, { stack: 'it_lant0001', qty: 2 }).message, /does not stack/);
    assert.equal(h.run('inventory.add', { name: 'Lantern', qty: 51 }).ok, false);
    const added = h.run('inventory.add', { name: 'Lantern', qty: 2, note: 'new' });
    assert.equal(added.ok, true, added.message);
    assert.equal(added.result.data.stacks.length, 2);
    assert.ok(added.result.data.stacks.every(id => inv(h).stacks[id].qty === 1));
    const dropped = h.run('inventory.drop', { stack: 'it_rope0001' });
    assert.equal(dropped.result.data.edit, true);
});

test('an item edit agrees live, rebuilt, and reloaded and goes with a swipe', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Search.', 'Found.\n\n<Changes>\n+ item Torch | qty: 2\n</Changes>');
    const stackId = host.sdk.query('inventory.items')[0].stack;
    const done = await host.sdk.command('inventory.edit', { stack: stackId, qty: 3 });
    assert.equal(done.ok, true, done.message);
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
    const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.deepEqual(loaded.head(), live);
    assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
    assert.equal(host.sdk.query('inventory.items')[0].qty, 3);
    await host.swipe('Nothing here.');
    assert.deepEqual(host.sdk.query('inventory.items'), []);
});

test('inventory pencils and Add item send reader commands from their inline forms', async () => {
    const { inventoryScreen } = await import('../../../src/v2/screens/inventory.js');
    const { queries, show, settle } = await import('../screens/helpers.js');
    const module = core();
    const state = stocked(module);
    const { el, calls } = show(inventoryScreen, { state, query: queries(module, state) });
    const rope = el.querySelectorAll('.item').find(row => row.querySelector('.name').textContent === 'Rope');
    const pencils = rope.querySelectorAll('.ss-w-editable-pencil');
    assert.equal(pencils.length, 1);
    pencils[0].click();
    const inputs = rope.querySelectorAll('.ss-w-editable-form input');
    assert.equal(inputs.length, 3);
    inputs[0].value = 'Fine Rope';
    inputs[1].value = '7';
    inputs[2].value = 'coiled';
    rope.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.equal(calls[0][0], 'inventory.edit');
    assert.deepEqual(calls[0][1], { stack: calls[0][1].stack, group: true, name: 'Fine Rope', qty: 7, note: 'coiled' });
    const add = el.querySelector('.ss-w-inventory-add');
    add.querySelector('button').click();
    const addInputs = add.querySelectorAll('input');
    addInputs[0].value = 'Tinder';
    addInputs[1].value = '2';
    addInputs[2].value = 'dry';
    add.querySelector('.inv-add-form .ss-button-primary').click();
    await settle();
    assert.deepEqual(calls.at(-1).slice(0, 2), ['inventory.add', { name: 'Tinder', qty: 2, note: 'dry' }]);
});
