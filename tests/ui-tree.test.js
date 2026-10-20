// Tree display (rows), ported from Inventory Block's tests/ui.test.js and extended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, same, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const { render, describeChange, formatQuantity, rarityClass } = await import('../src/ui/displays/tree.js');
const rows = await import('../src/formats/rows.js');
const { templateById } = await import('../src/templates.js');

const def = templateById('inventory');
function parse(body, definition = def) {
    const result = rows.parse(body, definition);
    assert.ok(result.ok, result.error);
    return result.state;
}

const current = parse(`Coin Pouch | 1 | 85 Gold
[Wagon > Food > Preserved]
Salt Pork | 3 | Barrel
[Wagon > Tools]
Tarp | 1 | Folded
[Lent to Companions > Astra]
Spare Cloak | 1 |`);
const previous = parse(`Coin Pouch | 1 | 100 Gold
Spare Cloak | 1 |
[Wagon > Food > Preserved]
Salt Pork | 3 | Barrel`);
const changes = rows.diff(previous, current, def);

function show(options = {}) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    render(pane, { def, state: current, previousState: previous, changes, uiKey: `k${Math.random()}`, ...options });
    return pane;
}

test('header, tree and item count', () => {
    const pane = show({ onEdit() {} });
    assert.equal(pane.querySelector('.story-block-title').textContent, 'Inventory');
    assert.equal(pane.querySelector('.story-block-summary').textContent, '4 items');
    assert.deepEqual(texts(pane, '.story-block-tree-label .story-block-tree-node-name'), ['All', 'General', 'Wagon', 'Lent to Companions']);
    assert.equal(pane.querySelectorAll('.story-block-edit').length, 1);
    assert.ok(pane.classList.contains('story-block-display-tree'));
});

test('change strip lists added, changed and moved items and marks changed categories', () => {
    const pane = show();
    assert.equal(pane.querySelector('.story-block-tree-changes-label').textContent, 'Changed this turn · 3');
    assert.deepEqual(texts(pane, '.story-block-tree-change-link'), [
        '+ Tarp ×1',
        '~ Coin Pouch: 100 Gold → 85 Gold',
        '↪ Spare Cloak → Lent to Companions › Astra',
    ]);
    const wagon = pane.querySelector('.story-block-tree-label[data-node-id="wagon"]');
    assert.ok(wagon.querySelector('.story-block-tree-change-dot'), 'Wagon holds the added Tarp');
    const general = pane.querySelector('.story-block-tree-label[data-node-id="general"]');
    assert.ok(general.querySelector('.story-block-tree-change-dot'), 'General lost the moved cloak');
    assert.match(show({ changesFromEarlierReply: true }).querySelector('.story-block-tree-changes-label').textContent, /earlier reply/);
    const tarp = pane.querySelectorAll('.story-block-tree-item').find(row => /Tarp/.test(row.textContent));
    assert.ok(tarp.classList.contains('is-added'), 'the added row is marked');
});

test('a change link drills down to its category', () => {
    const pane = show();
    pane.querySelectorAll('.story-block-tree-change-link')[0].click();
    assert.match(pane.querySelector('.story-block-tree-crumbs').textContent, /All.*Wagon.*Tools/);
    const tarp = pane.querySelectorAll('.story-block-tree-item').find(row => /Tarp/.test(row.textContent));
    assert.ok(tarp.classList.contains('is-added'));
});

test('changes are computed from previousState when none are passed, and removed rows are described', () => {
    const pane = show({ changes: null, previousState: parse('Lantern | 2 | Oil\nCoin Pouch | 1 | 85 Gold'), state: parse('Coin Pouch | 1 | 85 Gold') });
    assert.deepEqual(texts(pane, '.story-block-tree-change-link'), ['− Lantern ×2']);
    assert.equal(pane.querySelector('.story-block-tree-changes').classList.contains('story-block-tree-changes'), true);
    const none = show({ changes: [], previousState: null });
    assert.equal(none.querySelector('.story-block-tree-changes'), null);
});

test('selecting a parent shows its subtree grouped by sub-category', () => {
    const pane = show();
    pane.querySelector('.story-block-tree-label[data-node-id="wagon"]').click();
    assert.match(pane.querySelector('.story-block-tree-crumbs').textContent, /All.*Wagon/);
    assert.deepEqual(texts(pane, '.story-block-tree-group-title'), ['Food › Preserved', 'Tools']);
    assert.deepEqual(texts(pane, '.story-block-tree-item-label'), ['Salt Pork', 'Tarp']);
    assert.deepEqual(texts(pane, '.story-block-tree-child .story-block-tree-node-name'), ['Food', 'Tools'], 'drill-down rows for narrow layouts');
    assert.ok(pane.querySelector('.story-block-tree-back'), 'back button below the root');
    assert.deepEqual(texts(pane, '.story-block-tree-chip .story-block-tree-node-name'), ['General', 'Wagon', 'Lent to Companions']);
});

test('drill-down: child rows, back button and selection survive a re-render', () => {
    const uiKey = 'drill';
    const pane = show({ uiKey });
    const wagonRow = pane.querySelectorAll('.story-block-tree-child').find(row => /Wagon/.test(row.textContent));
    wagonRow.click();
    pane.querySelectorAll('.story-block-tree-child').find(row => /Food/.test(row.textContent)).click();
    assert.equal(pane.querySelector('.story-block-tree-crumb-current').textContent, 'Food');
    render(pane, { def, state: current, changes, uiKey });
    assert.equal(pane.querySelector('.story-block-tree-crumb-current').textContent, 'Food', 'view state is kept per uiKey');
    pane.querySelector('.story-block-tree-back').click();
    assert.equal(pane.querySelector('.story-block-tree-crumb-current').textContent, 'Wagon');
});

test('deep paths collapse middle crumbs behind an up button', () => {
    const deep = parse('[A > B > C]\nThing | 1 |');
    const pane = show({ state: deep, changes: [], uiKey: 'deep' });
    pane.querySelectorAll('.story-block-tree-child')[0].click();
    pane.querySelectorAll('.story-block-tree-child')[0].click();
    pane.querySelectorAll('.story-block-tree-child')[0].click();
    assert.equal(pane.querySelector('.story-block-tree-crumb-current').textContent, 'C');
    assert.ok(pane.querySelector('.story-block-tree-crumb-ellipsis'));
    assert.equal(pane.querySelectorAll('.story-block-tree-crumb.is-middle').length, 2);
    pane.querySelector('.story-block-tree-crumb-ellipsis .story-block-tree-crumb-button').click();
    assert.equal(pane.querySelector('.story-block-tree-crumb-current').textContent, 'B');
});

test('def.maxDepth folds deeper levels into the last one', () => {
    const deep = parse('[A > B > C]\nThing | 1 |');
    const pane = show({ state: deep, changes: [], def: { ...def, maxDepth: 2 }, uiKey: 'fold' });
    pane.querySelectorAll('.story-block-tree-child')[0].click();
    assert.deepEqual(texts(pane, '.story-block-tree-child .story-block-tree-node-name'), ['B › C']);
});

test('filter searches the whole tree and shows each match\'s path; Escape clears it', () => {
    const pane = show();
    const input = pane.querySelector('.story-block-tree-search-input');
    assert.equal(input.placeholder, 'Filter items…');
    input.value = 'cloak';
    input.dispatch('input');
    assert.match(pane.querySelector('.story-block-tree-results-summary').textContent, /^1 match for “cloak”/);
    assert.deepEqual(texts(pane, '.story-block-tree-item-path'), ['Lent to Companions › Astra']);
    assert.ok(pane.querySelector('.story-block-tree-browser').classList.contains('is-searching'));
    let propagated = false;
    input.dispatch('keydown', { key: 'Escape', stopPropagation() { propagated = true; } });
    assert.ok(propagated, 'keys typed into the filter stop at the input');
    assert.equal(pane.querySelector('.story-block-tree-results-summary'), null);
});

test('a re-render while typing keeps focus, caret and the query', () => {
    const uiKey = 'typing';
    const pane = show({ uiKey });
    const input = pane.querySelector('.story-block-tree-search-input');
    input.value = 'pork';
    input.dispatch('input');
    input.focus();
    input.selectionStart = 2;
    input.selectionEnd = 3;
    render(pane, { def, state: current, changes, uiKey });
    const fresh = pane.querySelector('.story-block-tree-search-input');
    assert.notEqual(fresh, input);
    same(doc.activeElement, fresh, 'focus moved to the new input');
    assert.equal(fresh.value, 'pork');
    assert.deepEqual([fresh.selectionStart, fresh.selectionEnd], [2, 3]);
    assert.deepEqual(texts(pane, '.story-block-tree-item-label'), ['Salt Pork']);
});

test('scroll positions inside the pane survive a re-render', () => {
    const uiKey = 'scroll';
    const pane = show({ uiKey });
    pane.querySelector('.story-block-tree-browser').scrollTop = 80;
    render(pane, { def, state: current, changes, uiKey });
    assert.equal(pane.querySelector('.story-block-tree-browser').scrollTop, 80);
});

test('keyboard navigation moves between tree labels and expands nodes', () => {
    const pane = show({ uiKey: 'keys' });
    const nav = () => pane.querySelector('.story-block-tree-nav');
    const labels = () => pane.querySelectorAll('.story-block-tree-label');
    labels()[0].focus();
    let prevented = false;
    nav().dispatch('keydown', { key: 'ArrowDown', preventDefault() { prevented = true; } });
    same(doc.activeElement, labels()[1], 'ArrowDown moves focus');
    assert.ok(prevented, 'arrow keys are kept from SillyTavern\'s swipe hotkeys');
    pane.querySelector('.story-block-tree-label[data-node-id="wagon"]').focus();
    nav().dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(pane.querySelector('.story-block-tree-toggle[aria-expanded="true"]'), 'Wagon expanded');
    assert.deepEqual(texts(pane, '.story-block-tree-label .story-block-tree-node-name'), ['All', 'General', 'Wagon', 'Food', 'Tools', 'Lent to Companions']);
    nav().dispatch('keydown', { key: 'End' });
    same(doc.activeElement, labels().at(-1), 'End moves focus to the last label');
    nav().dispatch('keydown', { key: 'ArrowLeft' });
    nav().dispatch('keydown', { key: 'Home' });
    same(doc.activeElement, labels()[0], 'Home moves focus to All');
});

test('column labels come from def.columns, and counts use the first column', () => {
    const npcDef = { ...def, name: 'Cast', columns: ['NPC', 'Mood', 'Where'] };
    const state = parse('Astra | calm | camp\nBren | 2 | road', npcDef);
    const pane = show({ def: npcDef, state, changes: [] });
    assert.deepEqual(texts(pane, '.story-block-tree-column'), ['NPC', 'Mood', 'Where']);
    assert.equal(pane.querySelector('.story-block-summary').textContent, '2 NPCs');
    assert.equal(pane.querySelector('.story-block-tree-search-input').placeholder, 'Filter NPCs…');
    assert.equal(pane.querySelector('.story-block-tree-search-input').getAttribute('aria-label'), 'Filter Cast');
    assert.deepEqual(texts(pane, '.story-block-tree-item-qty'), ['calm', '×2']);
    assert.equal(pane.querySelector('.story-block-tree-item-qty').title, 'Mood: calm');
});

test('empty, missing, error, truncated and edit', () => {
    let edits = 0;
    const missing = show({ state: null, previousState: null, changes: [] });
    assert.match(missing.textContent, /No Inventory in the latest reply\./);
    const empty = show({ state: { categories: [] }, changes: [], onEdit: () => { edits += 1; } });
    assert.match(empty.querySelector('.story-block-empty').textContent, /Inventory is empty\. It fills in as the story goes\./);
    empty.querySelector('.story-block-edit').click();
    assert.equal(edits, 1);
    const broken = show({ error: 'Duplicate item "Tarp" in Wagon.', truncated: true });
    const notices = texts(broken, '.story-block-notice');
    assert.equal(notices[0], 'This reply\'s Inventory couldn\'t be read: Duplicate item "Tarp" in Wagon. Showing the last valid state.');
    assert.match(notices[1], /cut off/);
    assert.ok(broken.querySelector('.story-block-tree-browser'), 'the last valid state is still shown');
    assert.equal(show().querySelector('.story-block-edit'), null, 'no Edit without onEdit');
});

test('model text is never parsed as markup', () => {
    const state = parse('<img src=x onerror=alert(1)> | 1 | <b>bold</b>');
    const pane = show({ state, changes: [] });
    assert.equal(pane.querySelector('.story-block-tree-item-label').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(pane.querySelectorAll('img').length, 0);
});

test('a non-rows state falls back to plain text', () => {
    const pane = show({ state: { text: 'Just notes' }, changes: [] });
    assert.match(pane.textContent, /Just notes/);
});

test('describeChange and formatQuantity', () => {
    assert.equal(formatQuantity('3'), '×3');
    assert.equal(formatQuantity('a few'), 'a few');
    assert.equal(describeChange({ type: 'changed', label: 'Rope', path: 'General', before: { quantity: '2', remark: '' }, after: { quantity: '1', remark: '' } }), '~ Rope: ×2 → ×1');
    assert.equal(describeChange({ type: 'changed', label: 'Mood', from: 'calm', to: 'angry' }), '~ Mood: calm → angry');
});

test('found this turn: each gain of the latest reply as a chip with Leave, in the changes row; nothing without a handler (0.9.18, 0.9.22)', () => {
    const before = parse('Rope | 1\n[Consumables]\nMinor Healing Draught | 2 | heal 20');
    const after = parse('Rope | 1\n[Consumables]\nMinor Healing Draught | 4 | heal 20\n[Loot]\nBrood-Mother Skull | 1 | uncommon material');
    const left = [];
    const pane = show({ state: after, previousState: before, changes: rows.diff(before, after), onLeave: gain => left.push(gain) });
    // (0.9.22) One row: the finds sit in the "Changed this turn" row, in place of its preview.
    const row = pane.querySelector('.story-block-tree-changes-summary');
    assert.ok(row.querySelector('.story-block-found'));
    assert.equal(row.querySelector('.story-block-tree-changes-preview'), null);
    const chips = pane.querySelectorAll('.story-block-found-chip');
    assert.deepEqual(chips.map(chip => chip.querySelector('.story-block-found-name').textContent), ['Brood-Mother Skull ×1', 'Minor Healing Draught ×2']);
    assert.match(chips[0].className, /story-block-rarity is-uncommon/);
    chips[0].querySelector('.story-block-found-leave').click();
    assert.deepEqual(left, [{ name: 'Brood-Mother Skull', category: 'Loot', gain: 1, remark: 'uncommon material' }]);
    assert.equal(show({ state: after, previousState: before, changes: rows.diff(before, after) }).querySelector('.story-block-found'), null);
    assert.equal(show({ state: after, previousState: before, changes: rows.diff(before, after), onLeave() {}, changesFromEarlierReply: true }).querySelector('.story-block-found'), null, 'only the latest reply\'s');
});

test('a rarity word in the note tints the name; "uncommon" is not "common" (0.9.18)', () => {
    assert.equal(rarityClass('uncommon · LUK +2'), 'story-block-rarity is-uncommon');
    assert.equal(rarityClass('Equipped · Rare · ATK +6'), 'story-block-rarity is-rare');
    assert.equal(rarityClass('a commonplace stone'), '');
    const state = parse('[Gear]\nWolf-fang Charm | 1 | uncommon · LUK +2\nRope | 1 | coiled');
    const labels = show({ state, previousState: null, changes: [] }).querySelectorAll('.story-block-tree-item-label');
    const charm = labels.find(node => node.textContent === 'Wolf-fang Charm');
    assert.match(charm.className, /story-block-rarity is-uncommon/);
    assert.doesNotMatch(labels.find(node => node.textContent === 'Rope').className, /rarity/);
});

test('gainsOf and leaveLine: what a reply found, and the line that takes it back out (0.9.18)', () => {
    const before = parse('Coin Pouch | 1 | 85 Gold\n[Consumables]\nMinor Healing Draught | 2 | heal 20');
    const after = parse('Coin Pouch | 1 | 90 Gold\n[Consumables]\nMinor Healing Draught | 4 | heal 20\n[Loot]\nOdd Pebble | some');
    const gains = rows.gainsOf(rows.diff(before, after));
    assert.deepEqual(gains.map(gain => [gain.name, gain.gain]), [['Odd Pebble', null], ['Minor Healing Draught', 2]], 'a note change (the purse) is not a gain');
    const body = 'Coin Pouch | 1 | 90 Gold\n\n[Consumables]\nMinor Healing Draught | 4 | heal 20\n\n[Loot]\nOdd Pebble | some';
    let text = body;
    for (const gain of gains) text = rows.applyChanges(text, rows.leaveLine(gain), def).body;
    assert.match(text, /Minor Healing Draught \| 2 \| heal 20/);
    assert.doesNotMatch(text, /Odd Pebble/);
    assert.match(text, /^Coin Pouch \| 1 \| 90 Gold$/m);
    assert.equal(rows.leaveLine({ name: 'Rope | cord', category: 'General', gain: 1 }), '- Rope \\| cord | 1');
});

test('a short list opens at All with its items under section titles; a long one keeps a row per section (0.9.18)', async () => {
    const { SHORT_LIST } = await import('../src/ui/displays/tree.js');
    assert.ok(show({ previousState: null, changes: [] }).querySelector('.story-block-tree-browser').className.includes('is-short'));
    const many = parse(Array.from({ length: SHORT_LIST + 1 }, (_, index) => `[Pack]\nThing ${index} | 1`).join('\n'));
    assert.ok(!show({ state: many, previousState: null, changes: [] }).querySelector('.story-block-tree-browser').className.includes('is-short'));
});
