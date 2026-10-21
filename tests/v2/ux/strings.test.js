// strings.js (MODULES §F56): one English object for every text of Story Block's own screens and page
// furniture; the helpers that fill and escape them; every word the default screens show comes from it.
// Also the Inventory's name filter ("Filter…") and the summary's count of refused lines (§F41).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, escapeHtml, fill, html, jsonText } from '../../../src/v2/strings.js';
import { changesSummary, homeScreen, inventoryScreen, sceneScreen, changesCardScreen, screens } from '../../../src/v2/screens/index.js';
import { parseHtml } from '../../../src/v2/view/template/html.js';
import { core, queries, renderSkip, show, stocked, text } from '../screens/helpers.js';

const leaves = (value, out = []) => {
    if (typeof value === 'string') out.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(item => leaves(item, out));
    return out;
};

test('STRINGS is one frozen object of non-empty texts', () => {
    const all = leaves(STRINGS);
    assert.ok(all.length > 80);
    for (const value of all) assert.ok(value.trim().length > 0);
    assert.ok(Object.isFrozen(STRINGS) && Object.isFrozen(STRINGS.inventory.kinds));
    assert.throws(() => { 'use strict'; STRINGS.bar.story = 'x'; });
});

test('fill, html and jsonText', () => {
    assert.equal(fill('Drop all {qty}', { qty: 3 }), 'Drop all 3');
    assert.equal(fill('{a} and {b}', { a: 'Fenna' }), 'Fenna and {b}', 'a hole without a value stays');
    assert.equal(fill('{n} more', { n: 0 }), '0 more');
    assert.equal(escapeHtml('<b a="1">\'&'), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;');
    assert.equal(html('Equip "{name}" <now>', { name: '{{ it.name }}' }), 'Equip &quot;{{ it.name }}&quot; &lt;now&gt;');
    assert.equal(jsonText('Say "hi" <b>'), 'Say \\&quot;hi\\&quot; &lt;b&gt;');
    assert.equal(JSON.parse(`"${jsonText('Say "hi"').replace(/&quot;/g, '"')}"`), 'Say "hi"');
});

test('every word the default screens show is a text from STRINGS', () => {
    const known = leaves(STRINGS).map(value => value.replace(/\{\w+\}/g, '\u0000'));
    const fromStrings = piece => known.some(value => value.split('\u0000').some(part => part.includes(piece)) || value.includes(piece));
    const missing = [];
    const visit = (nodes, screen) => {
        for (const node of nodes) {
            const pieces = [];
            if (node.type === 'text') pieces.push(node.text);
            else {
                for (const [name, value] of node.attrs) if (['title', 'placeholder', 'aria-label'].includes(name)) pieces.push(value);
                visit(node.children, screen);
            }
            for (const piece of pieces.flatMap(value => value.split(/\{\{[\s\S]*?\}\}/))) {
                const words = piece.replace(/\s+/g, ' ').trim();
                if (/\p{L}/u.test(words) && !fromStrings(words)) missing.push(`${screen}: "${words}"`);
            }
        }
    };
    for (const screen of screens) visit(parseHtml(screen.template), screen.id);
    assert.deepEqual(missing, []);
    for (const screen of screens) assert.ok(leaves(STRINGS).includes(screen.title), screen.id);
    assert.equal(homeScreen.title, STRINGS.home.title);
    assert.equal(sceneScreen.title, STRINGS.scene.title);
    assert.equal(changesCardScreen.title, STRINGS.card.title);
});

test('inventory: a themed name filter with the "Filter…" placeholder', { skip: renderSkip }, () => {
    const module = core();
    const state = stocked(module);
    const { el, view } = show(inventoryScreen, { state, query: queries(module, state) });
    assert.deepEqual(view.warnings, []);
    const find = el.querySelector('.filter .find');
    assert.ok(find, 'the box is there');
    assert.equal(find.getAttribute('type'), 'search');
    assert.equal(find.getAttribute('placeholder'), 'Filter…');
    assert.equal(find.getAttribute('data-draft'), 'find');
    // Themed: SillyTavern's colours through the screen's tokens, a placeholder colour, a small checkbox.
    assert.match(inventoryScreen.css, /\.filter select, \.filter \.find \{[^}]*background: var\(--sb-surface\)/);
    assert.match(inventoryScreen.css, /\.filter \.find::placeholder \{ color: var\(--sb-em\)/);
    assert.match(inventoryScreen.css, /\.filter \.check input \{[^}]*width: 1em; height: 1em/);
});

test('inventory: the name filter narrows the list, ignoring case, with the other filters', { skip: renderSkip }, () => {
    const module = core();
    const state = stocked(module);
    const names = draft => show(inventoryScreen, { state, query: queries(module, state), draft }).el
        .querySelectorAll('.item').map(item => item.querySelector('.name').textContent);
    assert.deepEqual(names({ find: 'RO' }), ['Iron Sword', 'Rope']);
    assert.deepEqual(names({ find: 'ro', kind: 'goods' }), ['Rope']);
    assert.deepEqual(names({ find: '   ' }).length, 6, 'blank text filters nothing');
    const none = show(inventoryScreen, { state, query: queries(module, state), draft: { find: 'dragon' } });
    assert.equal(none.el.querySelectorAll('.item').length, 0);
    assert.equal(text(none.el.querySelector('.nomatch')), 'Nothing matches the filter.');
});

test('changes card summary: refused lines are counted after the changes', () => {
    const digest = { gained: [{ def: 'a', name: 'Rope', qty: 1 }], lost: [], held: [], coin: null, coinNow: null, place: null, arrived: [], left: [], presentNow: null, other: false };
    assert.equal(changesSummary({ digest, refused: 1 }), '+1 Rope · 1 line not applied');
    assert.equal(changesSummary({ digest, refused: 3 }), '+1 Rope · 3 lines not applied');
    assert.equal(changesSummary({ digest }), '+1 Rope');
    const empty = { ...digest, gained: [] };
    assert.equal(changesSummary({ digest: empty, refused: 2 }), 'No changes · 2 lines not applied');
    assert.equal(changesSummary({ digest: { ...empty, other: true }, refused: 1 }), 'No item, coin or place changes · 1 line not applied');
    assert.equal(changesSummary({ digest: empty, refused: -1 }), 'No changes');
});

test('changes card template: refused lines drawn from the scope, none without it', { skip: renderSkip }, () => {
    const module = core();
    const state = stocked(module);
    const plain = show(changesCardScreen, { state, query: queries(module, state), changes: ['/meta/rev'] });
    assert.deepEqual(plain.view.warnings, []);
    assert.equal(plain.el.querySelector('.refused'), null);
    const { el, view } = show(changesCardScreen, {
        state, query: queries(module, state), changes: ['/meta/rev'],
        extra: { refused: [{ line: '- item Lantern | qty: 1', reason: 'There is no Lantern.' }, { line: '+ spell <b>Fire</b>', reason: '' }] },
    });
    assert.deepEqual(view.warnings, []);
    const lines = el.querySelectorAll('.refused .line').map(line => text(line));
    assert.deepEqual(lines, ['not applied: - item Lantern | qty: 1 — There is no Lantern.', 'not applied: + spell <b>Fire</b>']);
    assert.equal(el.querySelectorAll('.refused b').length, 0, 'a refused line is text, never markup');
});
