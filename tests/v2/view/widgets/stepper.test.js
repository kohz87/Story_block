// ss.stepper: limits from min/max/step and the budget, snapping, draft changes through api.onDraft,
// + disabled when the budget is spent, keyboard, and new props resetting the count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepper, stepperBudget, stepperClamp, stepperLimits, stepperRemaining } from '../../../../src/v2/view/widgets/stepper.js';
import { fakeApi, host, installDom } from './fake-dom.js';

function mount(props, api = fakeApi()) {
    const doc = installDom();
    const el = host(doc);
    const handle = stepper.render(el, props, api);
    const q = selector => el.querySelector(selector);
    return {
        el, api, handle,
        inc: q('.ss-w-stepper-inc'), dec: q('.ss-w-stepper-dec'), field: q('.ss-w-stepper-input'), note: q('.ss-w-stepper-budget'),
        root: el.children[0],
    };
}

test('stepperLimits / stepperClamp / stepperRemaining', () => {
    assert.deepEqual(stepperLimits({ value: 5, min: 1, max: 10, step: 1, budget: 3, cost: 1 }), { lo: 1, hi: 8, step: 1, cost: 1 });
    assert.deepEqual(stepperLimits({ value: 5, min: 1, max: 6, step: 1, budget: 3, cost: 1 }), { lo: 1, hi: 6, step: 1, cost: 1 });
    assert.deepEqual(stepperLimits({ value: 5, min: 0, max: null, step: 1, budget: 5, cost: 2 }), { lo: 0, hi: 7, step: 1, cost: 2 });
    assert.deepEqual(stepperLimits({ value: 5, min: 0, max: null, step: 1, budget: null, cost: 1 }), { lo: 0, hi: Infinity, step: 1, cost: 1 });
    assert.equal(stepperLimits({ value: 5, min: 0, max: 10, step: 1, budget: -2, cost: 1 }).hi, 5, 'over budget: kept, not raised');
    assert.equal(stepperLimits({ value: 0, min: 0, max: 10, step: 0, budget: null, cost: 1 }).step, 1, 'a zero step is 1');
    const limits = { lo: 0, hi: 10, step: 0.5 };
    assert.equal(stepperClamp(3.3, limits), 3.5);
    assert.equal(stepperClamp(0.1 + 0.2, { lo: 0, hi: 1, step: 0.1 }), 0.3);
    assert.equal(stepperClamp(99, limits), 10);
    assert.equal(stepperClamp(-4, limits), 0);
    assert.equal(stepperClamp('abc', limits), 0);
    assert.equal(stepperClamp('7', limits), 7);
    assert.equal(stepperRemaining(5, 7, 3, { step: 1, cost: 1 }), 1);
    assert.equal(stepperRemaining(5, 3, 3, { step: 1, cost: 1 }), 5, 'going down refunds');
    assert.equal(stepperRemaining(5, 7, null, { step: 1, cost: 1 }), null);
});

test('stepper: + spends the budget, then is disabled; − refunds; every change goes to onDraft', () => {
    const m = mount({ name: 'STR', value: 5, min: 1, max: 10, budget: 2, label: 'Strength' });
    assert.equal(m.field.value, '5');
    assert.equal(m.note.textContent, 'Points left: 2');
    assert.ok(!m.inc.disabled);
    m.inc.click();
    m.inc.click();
    assert.equal(m.field.value, '7');
    assert.equal(m.note.textContent, 'Points left: 0');
    assert.ok(m.inc.disabled, '+ disabled when the budget is spent');
    assert.ok(m.root.classList.contains('ss-w-spent'));
    m.inc.click();
    assert.equal(m.field.value, '7', 'a click on a disabled + does nothing');
    m.dec.click();
    assert.equal(m.note.textContent, 'Points left: 1');
    assert.ok(!m.inc.disabled);
    assert.deepEqual(m.api.drafts, [{ name: 'STR', value: 6 }, { name: 'STR', value: 7 }, { name: 'STR', value: 6 }]);
});

test('stepper: min and max bound the buttons; cost per step; no budget means only max', () => {
    const m = mount({ name: 'AGI', value: 2, min: 1, max: 3 });
    assert.ok(m.note.hidden, 'no budget, no note');
    m.dec.click();
    assert.ok(m.dec.disabled);
    m.inc.click(); m.inc.click();
    assert.ok(m.inc.disabled);
    assert.equal(m.field.value, '3');
    const c = mount({ name: 'INT', value: 0, budget: 5, cost: 2, budgetLabel: 'Skill points' });
    c.inc.click(); c.inc.click();
    assert.ok(c.inc.disabled, '1 point left is less than a step costs');
    assert.equal(c.note.textContent, 'Skill points: 1');
    const f = mount({ name: 'LUK', value: 0, budget: 3, step: 5, cost: 1 });
    f.inc.click(); f.inc.click(); f.inc.click();
    assert.equal(f.field.value, '15');
    assert.ok(f.inc.disabled);
});

test('stepper: typed values are snapped and kept under the budget; keyboard steps', () => {
    const m = mount({ name: 'VIT', value: 5, min: 1, max: 20, budget: 3 });
    m.field.value = '50';
    m.field.dispatch('change');
    assert.equal(m.field.value, '8', 'typing cannot spend more than the budget');
    m.field.value = '-3';
    m.field.dispatch('change');
    assert.equal(m.field.value, '1');
    m.field.value = 'lots';
    m.field.dispatch('change');
    assert.equal(m.field.value, '1');
    const up = m.field.dispatch('keydown', { key: 'ArrowUp' });
    assert.ok(up.defaultPrevented);
    assert.equal(m.field.value, '2');
    m.field.dispatch('keydown', { key: 'End' });
    assert.equal(m.field.value, '8');
    m.field.dispatch('keydown', { key: 'Home' });
    assert.equal(m.field.value, '1');
    m.field.dispatch('keydown', { key: 'PageUp' });
    assert.equal(m.field.value, '8');
    m.field.value = '4';
    m.field.dispatch('keydown', { key: 'Enter' });
    assert.equal(m.field.value, '4');
    assert.ok(!m.field.dispatch('keydown', { key: 'a' }).defaultPrevented);
    assert.deepEqual(m.api.drafts.map(entry => entry.value), [8, 1, 2, 8, 1, 8, 4]);
});

test('stepper: new props start the count again (the dialog recomputes the budget)', () => {
    const m = mount({ name: 'STR', value: 5, budget: 1, max: 10 });
    m.inc.click();
    assert.ok(m.inc.disabled);
    m.handle.update({ name: 'STR', value: 6, budget: 2, max: 10 });
    assert.equal(m.field.value, '6');
    assert.equal(m.note.textContent, 'Points left: 2');
    assert.ok(!m.inc.disabled);
    assert.equal(m.api.drafts.length, 1, 'an update is not a reader change');
    m.handle.update({ name: 'STR', value: 50, max: 10 });
    assert.equal(m.field.value, '10', 'a value over max is shown at max');
    assert.equal(m.field.getAttribute('max'), '10');
    m.handle.update({ name: 'STR', value: 3 });
    assert.equal(m.field.getAttribute('max'), null);
});

test('stepper: disabled; accessible names; works without onDraft', () => {
    const m = mount({ name: 'STR', value: 5, budget: 3, disabled: true, label: 'Strength' });
    assert.ok(m.inc.disabled && m.dec.disabled && m.field.disabled);
    m.inc.click();
    m.field.dispatch('keydown', { key: 'ArrowUp' });
    assert.equal(m.field.value, '5');
    assert.equal(m.api.drafts.length, 0);
    assert.equal(m.inc.getAttribute('aria-label'), 'Increase Strength');
    assert.equal(m.dec.getAttribute('aria-label'), 'Decrease Strength');
    assert.equal(m.field.getAttribute('aria-label'), 'Strength');
    assert.equal(m.root.getAttribute('role'), 'group');
    assert.equal(m.note.getAttribute('aria-live'), 'polite');
    const bare = mount({ name: 'STR', value: 1 }, { command() {} });
    bare.inc.click();
    assert.equal(bare.field.value, '2');
    const thrower = mount({ name: 'STR', value: 1 }, { onDraft() { throw new Error('dialog closed'); } });
    thrower.inc.click();
    assert.equal(thrower.field.value, '2', 'a failing onDraft does not break the widget');
});

test('stepper: a shared pool is a budget of pool − spent; an explicit budget wins', () => {
    assert.equal(stepperBudget({ budget: null, pool: 12, spent: 7 }), 5);
    assert.equal(stepperBudget({ budget: 2, pool: 12, spent: 7 }), 2, 'budget wins');
    assert.equal(stepperBudget({ budget: null, pool: null, spent: 7 }), null, 'no pool, no budget');
    assert.equal(stepperBudget({ pool: 10 }), 10, 'nothing spent yet');
    assert.equal(stepperBudget({ pool: 1, spent: 0.7 }), 0.3);
    assert.equal(stepperBudget(), null);
    // The pool is spent by every stepper together: this one is at 3 of the 7 spent.
    const m = mount({ name: 'points.DEX', value: 3, min: 0, pool: 8, spent: 7, label: 'DEX' });
    assert.equal(m.note.textContent, 'Points left: 1');
    m.inc.click();
    assert.equal(m.field.value, '4');
    assert.ok(m.inc.disabled, 'the pool is spent');
    assert.equal(m.note.textContent, 'Points left: 0');
    m.dec.click();
    m.dec.click();
    assert.equal(m.note.textContent, 'Points left: 2', 'going down refunds the pool');
    // The dialog renders again with the new sum.
    m.handle.update({ name: 'points.DEX', value: 2, min: 0, pool: 8, spent: 6, label: 'DEX' });
    assert.equal(m.note.textContent, 'Points left: 2');
    m.handle.update({ name: 'points.DEX', value: 2, min: 0, pool: '8', spent: '9', label: 'DEX' });
    assert.ok(m.inc.disabled, 'overspent: kept, not raised');
    assert.equal(m.note.textContent, 'Points left: -1');
    const free = mount({ name: 'x', value: 1, spent: 40 });
    assert.ok(free.note.hidden, 'spent without a pool is no budget');
});
