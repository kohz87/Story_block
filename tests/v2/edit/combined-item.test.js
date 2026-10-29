import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { inventoryScreen } from '../../../src/v2/screens/inventory.js';
import { homeScreen } from '../../../src/v2/screens/home.js';
import { core, stocked, stack as makeStack } from '../domains/fixtures.js';
import { createHarness } from '../domains/helpers/fake-ctx.js';
import { queries, show, settle, text } from '../screens/helpers.js';

test('the single item form validates, cancels and saves only changed fields', async () => {
    const module = core(), state = stocked(module);
    const { el, doc, calls } = show(inventoryScreen, { state, query: queries(module, state) });
    const rope = el.querySelectorAll('.item').find(row => row.querySelector('.name').textContent === 'Rope');
    const pencil = rope.querySelector('.ss-w-editable-pencil');
    pencil.click();
    let inputs = rope.querySelectorAll('.ss-w-editable-form input');
    assert.deepEqual(inputs.map(input => input.value), ['Rope', '3', '']);
    assert.equal(doc.activeElement, inputs[0]);
    inputs[1].value = '0';
    inputs[1].dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.equal(calls.length, 0);
    assert.match(rope.querySelector('.ss-w-editable-error').textContent, /whole number/);
    inputs[1].dispatch('keydown', { key: 'Escape' });
    assert.equal(doc.activeElement, pencil);
    pencil.click();
    inputs = rope.querySelectorAll('.ss-w-editable-form input');
    inputs[1].value = '4';
    inputs[1].dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.deepEqual(calls[0].slice(0, 2), ['inventory.edit', { stack: 'it_rope0001', group: true, qty: 4 }]);
    assert.equal(doc.activeElement, pencil);
    const wallet = el.querySelector('.wallet-and-add');
    assert.ok(wallet.querySelector('.wallet .ss-w-editable-pencil'));
    assert.ok(wallet.querySelector('.ss-w-inventory-add'));
});

test('a combined edit of separate pieces is one guarded transaction and replays safely', async t => {
    const host = await createHost(); t.after(() => host.close());
    assert.equal((await host.packs.packs.install({ id: 'pieces', version: '1.0.0', requires: { storyBlock: '^2' },
        content: { items: [{ name: 'Lantern', stack: false }] } })).ok, true);
    await host.send('Find.', 'Found.\n<Changes>\n+ item Lantern | qty: 2\n</Changes>');
    const earlier = host.store.headIndex(), stack = host.sdk.query('inventory.items')[0].stack;
    await host.send('Act.', 'The road.');
    const before = structuredClone(host.head());
    const refused = await host.sdk.command('inventory.edit', { stack, group: true, name: '', qty: 3, note: 'lit' });
    assert.equal(refused.ok, false);
    assert.deepEqual(host.head(), before, 'a rejected name also rolls back the count and note');
    const result = await host.sdk.command('inventory.edit', { stack, group: true, name: 'Bright Lantern', qty: 3, note: 'lit' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.receipt.data.edit, true);
    assert.match(result.receipt.summary, /Lantern to 3; one renamed Bright Lantern/);
    assert.match(result.receipt.data.v2.guard.predicate.pieces, /^[a-f0-9]{64}$/);
    const items = host.sdk.query('inventory.items');
    assert.equal(items.length, 3);
    assert.equal(items.find(item => item.stack === stack).name, 'Bright Lantern');
    assert.equal(items.find(item => item.stack === stack).note, 'lit');
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
    const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.deepEqual(loaded.head(), live);
    await host.st.editMessage(earlier, 'Found.\n<Changes>\n+ item Lantern | qty: 3\n</Changes>');
    assert.equal((await host.sdk.reread(earlier)).ok, true);
    assert.equal(host.sdk.query('inventory.items').length, 3);
    assert.ok(host.sdk.query('inventory.items').every(item => item.name === 'Lantern'));
    assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
});

test('Home labels the present row whether it is empty or populated', () => {
    const module = core(), state = stocked(module);
    let shown = show(homeScreen, { state, query: queries(module, state) });
    assert.match(text(shown.el.querySelector('.here')), /Here:\s*—/);
    assert.equal(shown.el.querySelectorAll('.here .ss-w-editable-pencil').length, 1);
    state.domains.scene.present = ['Ren', 'Mira'];
    shown = show(homeScreen, { state, query: queries(module, state) });
    assert.match(text(shown.el.querySelector('.here')), /Here:.*Ren.*Mira/);
    assert.equal(shown.el.querySelectorAll('.here .ss-w-editable-pencil').length, 1);
});

test('a combined reduction preserves the selected piece and never removes equipped pieces', () => {
    const module = core(), state = stocked(module);
    state.domains.inventory.stacks.it_lant0002 = makeStack('it_lant0002', 'story/lantern', 1);
    const h = createHarness(module, { state });
    const result = h.run('inventory.edit', { stack: 'it_lant0002', group: true, qty: 1, note: 'lit' });
    assert.equal(result.ok, true, result.message);
    assert.equal(h.state.domains.inventory.stacks.it_lant0002.note, 'lit');
    assert.equal(h.state.domains.inventory.stacks.it_lant0001, undefined);

    const equipped = stocked(module);
    equipped.domains.inventory.stacks.it_lant0001.equipped = 'hand';
    equipped.domains.inventory.stacks.it_lant0002 = makeStack('it_lant0002', 'story/lantern', 1);
    const another = createHarness(module, { state: equipped });
    const before = structuredClone(another.state);
    const refused = another.run('inventory.edit', { stack: 'it_lant0002', group: true, qty: 1, note: 'lit' });
    assert.equal(refused.ok, false);
    assert.deepEqual(another.state, before);
});
