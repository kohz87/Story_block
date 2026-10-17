// The rows format is Inventory Block's snapshot body format; these port its parser rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rows from '../src/formats/rows.js';
import { buildTree, groupItems, resolveNode, searchItems, nodeIdForCategory } from '../src/formats/tree.js';
import { normalizeBlock } from '../src/schema.js';
import { templateById } from '../src/templates.js';

const def = templateById('inventory');
const parse = body => rows.parse(body, def);
const items = body => parse(body).state.categories.map(category => [category.name, category.items.map(item => [item.name, item.quantity, item.remark])]);

test('rows round-trip through serialize and parse', () => {
    const body = 'Coin Pouch | 1 | 85 Gold\n\n[Wagon > Food > Preserved]\nSalt Pork | 3 | Barrel\n\n[Lent]\nCloak | 1 | ';
    const first = parse(body);
    assert.equal(first.ok, true);
    const again = parse(rows.serialize(first.state, def));
    assert.deepEqual(again.state, first.state);
    assert.equal(rows.serialize(again.state, def), rows.serialize(first.state, def));
});

test('Inventory Block snapshot bodies read unchanged', () => {
    assert.deepEqual(items('Coin Pouch | 1 | 90 Gold\n[Wagon>Food]\nBread | 2 |\n[Wagon > Food]\nCheese | 1 | wheel'), [
        ['General', [['Coin Pouch', '1', '90 Gold']]],
        ['Wagon > Food', [['Bread', '2', ''], ['Cheese', '1', 'wheel']]],
    ]);
});

test('markdown tables, list markers and trailing pipes are tolerated', () => {
    assert.deepEqual(items('| Item | Qty | Note |\n|---|---|---|\n| Rope | 1 | coiled |\n- Tent | 1 |\n2. Axe | 1 |\n-10% Coupon | 1 |'), [
        ['General', [['Rope', '1', 'coiled'], ['Tent', '1', ''], ['Axe', '1', ''], ['-10% Coupon', '1', '']]],
    ]);
    assert.deepEqual(items('Map | 1 | North | South roads'), [['General', [['Map', '1', 'North | South roads']]]]);
});

test('bracketed rows stay rows; one-pipe headers stay headers', () => {
    assert.deepEqual(items('[Spare Rope | 1 | coiled]'), [['General', [['Spare Rope', '1', 'coiled']]]]);
    assert.deepEqual(items('[Food | Water]\nBread | 2 |'), [['Food | Water', [['Bread', '2', '']]]]);
    assert.deepEqual(items('[Sealed] Letter | 1 |'), [['General', [['[Sealed] Letter', '1', '']]]]);
});

test('duplicates and malformed rows reject the body with a readable error', () => {
    assert.match(parse('Rope | 1 |\nrope | 2 |').error, /Duplicate Inventory row in General: rope/);
    assert.match(parse('just prose here').error, /Inventory line 1 must be Item \| Qty \| Note/);
    assert.match(parse('[ ]\nRope | 1 |').error, /category on line 1 is blank/);
});

test('names, cells and headers with special characters round-trip', () => {
    const tricky = {
        categories: [
            { name: 'General', items: [
                { name: '- Spare', quantity: '1', remark: 'A --> B' },
                { name: '[Sealed] Letter', quantity: '1', remark: 'see </Inventory> and <Blocks>' },
                { name: '2. Map', quantity: '1', remark: 'pipe | inside' },
            ] },
            { name: 'Odd ] Section | x', items: [{ name: 'Back\\slash', quantity: '1', remark: '' }] },
        ],
    };
    const text = rows.serialize(tricky, def);
    assert.doesNotMatch(text, /-->/);
    assert.doesNotMatch(text, /<\/?(?:Inventory|Blocks)/i);
    assert.deepEqual(parse(text).state, rows.normalizeRows(tricky));
});

test('a "\\n-->" left by a receive-time closer is dropped when only that breaks the body', () => {
    assert.equal(parse('Rope | 1 | coiled\n-->').ok, true);
    assert.equal(parse('Rope | 1 | coiled\n-->').state.categories[0].items.length, 1);
});

test('custom column labels appear in rules, skeleton and errors, and skip their own table header', () => {
    const quest = normalizeBlock({ name: 'Quests', tag: 'Quests', format: 'rows', columns: ['Quest', 'Status', 'Next step'] });
    assert.match(rows.rules(quest), /Quest \| Status \| Next step/);
    assert.match(rows.skeleton(quest), /\(Quest\) \| \(Status\) \| \(Next step\)/);
    assert.match(rows.parse('nope', quest).error, /Quests line 1 must be Quest \| Status \| Next step/);
    assert.deepEqual(rows.parse('| Quest | Status | Next step |\n|---|---|---|\n| Find Mira | open | ask the guard |', quest).state.categories[0].items,
        [{ name: 'Find Mira', quantity: 'open', remark: 'ask the guard' }]);
});

test('rules state the nesting limit', () => {
    assert.match(rows.rules({ ...def, maxDepth: 1 }), /Do not nest sections/);
    assert.match(rows.rules({ ...def, maxDepth: 4 }), /at most 4 levels deep/);
});

test('empty, isEmpty and diff', () => {
    assert.equal(rows.isEmpty(rows.empty()), true);
    assert.equal(rows.isEmpty(parse('Rope | 1 |').state), false);
    const before = parse('Coin Pouch | 1 | 100 Gold\nCloak | 1 |\n[Wagon > Food]\nSalt Pork | 3 | Barrel').state;
    const after = parse('Coin Pouch | 1 | 85 Gold\n[Wagon > Food]\nSalt Pork | 3 | Barrel\n[Wagon > Tools]\nTarp | 1 | Folded\n[Lent > Astra]\nCloak | 1 |').state;
    assert.deepEqual(rows.diff(before, after).map(change => [change.type, change.label, change.from ?? '', change.to ?? '']), [
        ['added', 'Tarp', '', '1 · Folded'],
        ['changed', 'Coin Pouch', '1 · 100 Gold', '1 · 85 Gold'],
        ['moved', 'Cloak', 'General', 'Lent > Astra'],
    ]);
    assert.deepEqual(rows.diff(before, before), []);
    assert.deepEqual(rows.diff(null, before), []);
});

test('tree helpers nest, group, resolve and search', () => {
    const state = parse('Coin | 1 |\n[Wagon > Food > Preserved]\nSalt Pork | 3 |\n[Wagon > Tools]\nTarp | 1 |\n[A > B > C > D > E]\nDeep | 1 |').state;
    const root = buildTree(state, { maxDepth: 3 });
    assert.deepEqual(root.children.map(node => node.name), ['General', 'Wagon', 'A']);
    const wagon = root.children[1];
    assert.equal(wagon.total, 2);
    assert.deepEqual(groupItems(wagon).map(group => group.label), ['Food › Preserved', 'Tools']);
    assert.equal(resolveNode(root, nodeIdForCategory('Wagon > Gone')).name, 'Wagon');
    assert.equal(root.children[2].children[0].children[0].name, 'C › D › E', 'deeper paths fold into the last level');
    assert.deepEqual(searchItems(root, 'tarp').map(result => result.item.name), ['Tarp']);
});
