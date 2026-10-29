// Inventory actions keep their accessible disclosure behavior without a battle module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryScreen } from '../../../src/v2/screens/index.js';
import { core, foldButtons, foldOf, openFold, queries, renderSkip, show, stocked, text } from './helpers.js';

const skip = renderSkip;
function world() {
    const module = core();
    const state = stocked(module);
    const query = queries(module, state);
    return { state, ...show(inventoryScreen, { state, query, draft: {} }) };
}
const trigger = (el, stack, kind) => foldButtons(el, stack).find(node => node.getAttribute('value') === kind);

test('equipment can be managed alone and no battle widget or member picker is mounted', { skip }, () => {
    const { el, view } = world();
    assert.deepEqual(view.warnings, []);
    const item = el.querySelectorAll('.item').find(row => row.querySelector('.name').textContent === 'Iron Sword');
    assert.ok(item.querySelector('[data-command="inventory.equip"]'));
    assert.equal(item.querySelector('[value="equipOn"]'), null);
    assert.equal(el.querySelector('ss-widget'), null);
    assert.ok(el.querySelector('option[value="equipment"]'));
});

test('the Drop disclosure opens, closes on Escape and restores focus', { skip }, () => {
    const { el, doc } = world();
    const drop = trigger(el, 'it_sword001', 'drop');
    assert.equal(drop.getAttribute('aria-expanded'), 'false');
    drop.click();
    assert.equal(trigger(el, 'it_sword001', 'drop').getAttribute('aria-expanded'), 'true');
    const panel = foldOf(el, 'it_sword001');
    assert.ok(panel);
    const cancel = panel.querySelector('.fold-cancel');
    cancel.focus();
    cancel.dispatch('keydown', { key: 'Escape' });
    assert.equal(foldOf(el, 'it_sword001'), null);
    assert.equal(doc.activeElement, trigger(el, 'it_sword001', 'drop'));
});

test('Cancel closes the Drop disclosure and leaves actions in reading order', { skip }, () => {
    const { el, doc } = world();
    openFold(el, 'it_sword001', 'drop');
    const item = el.querySelectorAll('.item').find(row => row.querySelector('.name').textContent === 'Iron Sword');
    const buttons = item.querySelectorAll('button');
    assert.ok(buttons.some(node => /Drop/.test(text(node))));
    for (const node of buttons) assert.equal(node.getAttribute('tabindex'), null);
    const cancel = foldOf(el, 'it_sword001').querySelector('.fold-cancel');
    cancel.focus();
    cancel.click();
    assert.equal(foldOf(el, 'it_sword001'), null);
    assert.equal(doc.activeElement, trigger(el, 'it_sword001', 'drop'));
});
