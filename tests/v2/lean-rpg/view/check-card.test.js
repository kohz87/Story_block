import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../../ui-fake-dom.js';
import { buildCheckCard } from '../../../../src/v2/lean-rpg/view/check-card.js';

const result = (over = {}) => ({
    who: 'Astra', what: 'Lie', stat: 'cha', skill: null, rank: 0, bonus: 2, die: 9, total: 11, dc: 15, difficulty: 'normal',
    outcome: 'fail', practice: null, ...over,
});

test('the card draws a failed plain-stat check as the approved mockup', () => {
    const doc = installFakeDom();
    const card = buildCheckCard(doc, [result()]);
    assert.equal(card.className, 'rpg-check rpg-check-card');
    assert.equal(card.getAttribute('data-variant'), 'card');
    assert.equal(card.querySelector('.rpg-check-h').textContent, 'Check');
    assert.equal(card.querySelector('.rpg-check-who').textContent, 'Astra · Lie (CHA, no skill) · normal');
    assert.equal(card.querySelector('.rpg-check-num').textContent, 'd20 9 + 2 = 11 vs 15');
    assert.equal(card.querySelector('.rpg-check-fail').textContent, 'Fail');
    assert.equal(card.querySelector('.rpg-check-gain'), null);
});

test('a utility skill marks utility, names its rank, and shows the practice gained', () => {
    const doc = installFakeDom();
    const card = buildCheckCard(doc, [result({
        what: 'Obscure', stat: 'dex', skill: { name: 'Obscure', stat: 'dex', rank: 1, type: 'utility' }, rank: 1, rankName: 'Adept',
        bonus: 3, die: 13, total: 16, outcome: 'success', utility: true, practice: { who: 'Astra', skill: 'Obscure', n: 1 },
    })]);
    assert.equal(card.querySelector('.rpg-check-who').textContent, 'Astra · Obscure utility (DEX, Adept) · normal');
    assert.equal(card.querySelector('.rpg-check-util').textContent, 'utility');
    assert.equal(card.querySelector('.rpg-check-num').textContent, 'd20 13 + 3 = 16 vs 15');
    assert.equal(card.querySelector('.rpg-check-ok').textContent, 'Success');
    assert.equal(card.querySelector('.rpg-check-gain').textContent, 'Obscure +3 practice');
});

test('success at a cost has its own pill and a list draws one line per check', () => {
    const doc = installFakeDom();
    const card = buildCheckCard(doc, [result({ who: 'Temiwa', what: 'Pick a lock', stat: 'dex', bonus: 2, die: 17, total: 19, dc: 20, difficulty: 'hard', outcome: 'cost' }), result()]);
    const lines = card.querySelectorAll('.rpg-check-line');
    assert.equal(lines.length, 2);
    assert.equal(lines[0].querySelector('.rpg-check-who').textContent, 'Temiwa · Pick a lock (DEX, no skill) · hard');
    assert.equal(lines[0].querySelector('.rpg-check-num').textContent, 'd20 17 + 2 = 19 vs 20');
    assert.equal(lines[0].querySelector('.rpg-check-cost').textContent, 'Success at a cost');
});
