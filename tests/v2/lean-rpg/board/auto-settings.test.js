// The Auto-fight cap: the setting's reading and bounds, its default of 3, and the slider in Settings → RPG → Fight board.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_CAP, AUTO_CAP_SETTING, autoCapFrom, autoExchanges } from '../../../../src/v2/lean-rpg/names.js';
import { SETTINGS_SCHEMA } from '../../../../src/v2/lean-rpg/levels.js';
import { DEFAULT_SETTINGS } from '../../../../src/v2/lean-rpg/index.js';
import { boardSetting, capSetting, capWords } from '../../../../src/v2/lean-rpg/board/settings.js';
import { setupDom } from '../../view/mounts/helpers.js';

test('the cap reads 1 to 9, defaults to 3, and 9 means until the end', () => {
    assert.equal(autoCapFrom({}), 3);
    assert.equal(autoCapFrom(null), 3);
    for (const bad of [0, -1, 10, 2.5, '4', NaN, null]) assert.equal(autoCapFrom({ [AUTO_CAP_SETTING]: bad }), 3, `${bad} falls back to 3`);
    for (const good of [1, 2, 8, 9]) assert.equal(autoCapFrom({ [AUTO_CAP_SETTING]: good }), good);
    assert.equal(autoExchanges(8), 8);
    assert.equal(autoExchanges(9), Infinity);
    assert.deepEqual([AUTO_CAP.min, AUTO_CAP.max, AUTO_CAP.default], [1, 9, 3]);
    assert.equal(DEFAULT_SETTINGS[AUTO_CAP_SETTING], 3);
    assert.deepEqual([SETTINGS_SCHEMA[AUTO_CAP_SETTING].min, SETTINGS_SCHEMA[AUTO_CAP_SETTING].max], [1, 9]);
});

test('the words above the slider', () => {
    assert.deepEqual([1, 3, 8, 9].map(capWords), ['1 exchange', '3 exchanges', '8 exchanges', 'Until the end']);
});

test('the slider spans 1 to the "Until the end" stop, shows its value above it and saves on release', () => {
    const doc = setupDom(), saved = [];
    const node = capSetting(doc, { value: 3, set: value => saved.push(value) });
    const input = node.querySelector('input');
    assert.deepEqual([input.type, input.min, input.max, input.step, input.value], ['range', '1', '9', '1', '3']);
    assert.equal(input.getAttribute('aria-label'), 'Most exchanges per reply');
    assert.equal(node.querySelector('.rpg-board-cap-value').textContent, '3 exchanges');
    assert.match(node.textContent, /1 – 8, or until the end/);
    assert.match(node.textContent, /2 or more Health blocks/);
    input.value = '9'; input.dispatch('input');
    assert.equal(node.querySelector('.rpg-board-cap-value').textContent, 'Until the end');
    assert.deepEqual(saved, [], 'dragging saves nothing yet');
    input.dispatch('change');
    input.value = '1'; input.dispatch('input'); input.dispatch('change');
    input.value = '99'; input.dispatch('change');
    assert.deepEqual(saved, [9, 1, 9], 'values are held to 1..9');
});

test('the board setting shows the slider only when the caller gives one', () => {
    const doc = setupDom(), feature = { on: () => true, set() {} };
    assert.equal(boardSetting(doc, feature, () => {}).querySelector('.rpg-board-cap-input'), null);
    const both = boardSetting(doc, feature, () => {}, { value: 5, set() {} });
    assert.equal(both.querySelector('.rpg-board-cap-input').value, '5');
    assert.ok(both.querySelector('[data-card="board"]'));
});
