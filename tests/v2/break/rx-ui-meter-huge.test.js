// rx-ui (B-rxui-9, beta rolling break, ss.meter with odd data): widgets/dom.js fmt() rounded with
// Math.round(n * 100) / 100, which overflows for a finite n above ~1.8e306: ss.meter then shows
// "Infinity / 100" (and aria-valuenow/valuemax "Infinity") for a value that is a real, finite number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { meter } from '../../../src/v2/view/widgets/meter.js';
import { fmt } from '../../../src/v2/view/widgets/dom.js';

test('fmt never turns a finite number into "Infinity"', () => {
    for (const n of [1e307, 1e308, -1e308, Number.MAX_VALUE]) assert.doesNotMatch(fmt(n), /Infinity/, `fmt(${n}) = ${fmt(n)}`);
});

test('ss.meter with a huge finite value shows no "Infinity"', () => {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    meter.render(el, { value: 1e308, max: 1e308, label: 'Gold' });
    assert.doesNotMatch(el.textContent, /Infinity/, el.textContent);
    const root = el.querySelector('[role="meter"]');
    assert.doesNotMatch(String(root.getAttribute('aria-valuemax')), /Infinity/);
});
