import test from 'node:test';
import assert from 'node:assert/strict';
import { cueOfResult } from '../../../../src/v2/lean-rpg/cue.js';
import { buildReceipt } from '../../../../src/v2/lean-rpg/view/battle-log/receipt.js';
import { setupDom } from '../../view/mounts/helpers.js';

const result = () => ({
    v: 1, key: '1-receipt', pace: 'normal', stop: 'won', flow: 2, fix: 2, checks: [], refused: [],
    summary: { exchanges: 1, acts: [], refused: 0 },
    rounds: [{ n: 1, decisive: true, lines: [{ kind: 'act', outcome: 'success', skill: null,
        pc: { who: 'Astra', die: 20, stat: 'str', statBonus: 5, classValue: 2, classBonus: 4, rank: 0, edge: 0, total: 29 },
        foe: { slot: 1, name: 'Bristle-boar', die: 1, base: 5, classValue: 1, classBonus: 2, total: 8 } }] }],
});
const model = (cue, extra = {}) => ({ receipt: cue, pace: 'normal', flow: 2, cap: 8, board: false, rules: { roundCap: 8, decisiveMargin: 10 }, ...extra });
const view = node => ({ tag: node.tagName, className: node.className, open: node.open, summary: node.querySelector('summary').textContent,
    hidden: node.querySelector('pre').hidden, text: node.querySelector('pre').textContent });

test('receipt-matches-cue', () => {
    const doc = setupDom();
    const roll = result(), shape = 2, cue = cueOfResult(roll, shape);
    const node = buildReceipt(doc, model(cue));
    assert.ok(cue);
    assert.equal(node.tagName, 'DETAILS');
    assert.equal(node.className, 'rpg-bl-receipt');
    assert.equal(node.open, false);
    assert.equal(node.querySelector('summary').textContent, 'Receipt ▸');
    assert.equal(node.querySelector('pre').hidden, true);
    assert.equal(node.querySelector('pre').textContent,
        `What the narrator was told:\n${cue}\n\nRules in force: pace normal · up to 8 exchanges · decisive margin 10 · flow 2`);
    node.querySelector('summary').click();
    assert.equal(node.open, true);
    assert.equal(node.querySelector('summary').textContent, 'Receipt ▾');
    assert.equal(node.querySelector('pre').hidden, false);
    node.querySelector('summary').click();
    assert.equal(node.open, false);
    assert.equal(node.querySelector('pre').hidden, true);
});

test('receipt-only-when-cue', () => {
    const doc = setupDom();
    assert.equal(buildReceipt(doc, { receipt: '' }), null);
    assert.equal(buildReceipt(doc, { receipt: { text: '   ' } }), null);
    assert.equal(buildReceipt(doc, null), null);
});

test('receipt-board-does-not-call-fixed-pace-a-limit', () => {
    const doc = setupDom();
    const node = buildReceipt(doc, model('[Rolls] Board exchange.', { board: true, pace: 'careful', cap: 1 }));
    assert.equal(node.querySelector('pre').textContent, 'What the narrator was told:\n[Rolls] Board exchange.\n\nRules in force: decisive margin 10 · flow 2');
});

test('swipe-reread-same', () => {
    const doc = setupDom();
    const cue = cueOfResult(result(), 2), first = buildReceipt(doc, model(cue)), second = buildReceipt(doc, model(cue));
    assert.deepEqual(view(first), view(second));
    first.querySelector('summary').click();
    second.querySelector('summary').click();
    assert.deepEqual(view(first), view(second), 'the same read and fold state draw the same DOM');
});

test('no-innerhtml', () => {
    const doc = setupDom(), create = doc.createElement;
    doc.createElement = tag => {
        const node = create(tag);
        Object.defineProperty(node, 'innerHTML', { configurable: true, get: () => '', set: value => { throw new Error(`innerHTML used: ${value}`); } });
        return node;
    };
    const hostile = 'What <img src=x onerror="boom()"> & <b>bold</b> said.';
    const node = buildReceipt(doc, model(hostile));
    assert.equal(node.querySelector('pre').children.length, 0);
    assert.match(node.querySelector('pre').textContent, /<img src=x onerror="boom\(\)"> & <b>bold<\/b>/);
});
