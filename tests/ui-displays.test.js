// Plain and fields displays, plus the notices every display shares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const plain = await import('../src/ui/displays/plain.js');
const fields = await import('../src/ui/displays/fields.js');
const { templateById } = await import('../src/templates.js');

const notesDef = templateById('scene-notes');
const sheetDef = templateById('character-sheet');

function show(display, options) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    display.render(pane, options);
    return pane;
}

// Inline structure as a compact string: text, <b>…</b>, <i>…</i>, ⏎ for <br>.
function shape(node) {
    return node.childNodes.map(child => {
        if (child.nodeType === 3) return child.textContent;
        if (child.tagName === 'BR') return '⏎';
        if (child.tagName === 'STRONG') return `<b>${shape(child)}</b>`;
        if (child.tagName === 'EM') return `<i>${shape(child)}</i>`;
        return `<${child.tagName}>`;
    }).join('');
}

// ---- plain -----------------------------------------------------------------------------

test('plain: line breaks, **bold** and *italic* become elements', () => {
    const pane = show(plain, { def: notesDef, state: { text: 'The guards are **on alert**.\nAstra looks *worried*; 2 * 3 * 4 stays text.' } });
    const body = pane.querySelector('.story-block-plain-text');
    assert.equal(shape(body), 'The guards are <b>on alert</b>.⏎Astra looks <i>worried</i>; 2 * 3 * 4 stays text.');
    assert.ok(pane.classList.contains('story-block-display-plain'));
    assert.equal(pane.querySelector('.story-block-title').textContent, 'Scene Notes');
});

test('plain: italics nest inside bold, unmatched stars stay literal', () => {
    const body = doc.createElement('div');
    plain.appendInline(body, '**a *b* c** and *open');
    assert.equal(shape(body), '<b>a <i>b</i> c</b> and *open');
});

test('plain: markup in model text stays text', () => {
    const pane = show(plain, { def: notesDef, state: { text: '<img src=x onerror=alert(1)> &amp; <b>no</b>' } });
    assert.equal(pane.querySelector('.story-block-plain-text').textContent, '<img src=x onerror=alert(1)> &amp; <b>no</b>');
    assert.equal(pane.querySelectorAll('img').length + pane.querySelectorAll('b').length, 0);
});

test('plain: empty, missing, error, truncated, edit', () => {
    assert.match(show(plain, { def: notesDef, state: null }).querySelector('.story-block-empty').textContent, /^No Scene Notes in the latest reply\.$/);
    assert.match(show(plain, { def: notesDef, state: { text: '  ' } }).querySelector('.story-block-empty').textContent, /^Scene Notes is empty\. It fills in as the story goes\.$/);
    let edits = 0;
    const pane = show(plain, { def: notesDef, state: { text: 'Partial' }, error: 'The block is empty', truncated: true, onEdit: () => { edits += 1; } });
    const notices = texts(pane, '.story-block-notice');
    assert.equal(notices[0], 'This reply\'s Scene Notes couldn\'t be read: The block is empty. Showing the last valid state.');
    assert.equal(notices[1], 'This reply\'s Scene Notes was cut off before it finished.');
    const cut = show(plain, { def: notesDef, state: { text: 'Partial' }, truncated: true });
    assert.match(cut.querySelector('.story-block-notice.is-truncated').textContent, /may be incomplete/, 'turn block');
    const cutStateful = show(plain, { def: { ...notesDef, kind: 'stateful' }, state: { text: 'x' }, truncated: true });
    assert.match(cutStateful.querySelector('.story-block-notice').textContent, /Showing the last valid state/);
    pane.querySelector('.story-block-edit').click();
    assert.equal(edits, 1);
    assert.equal(pane.querySelector('.story-block-edit').getAttribute('aria-label'), 'Edit Scene Notes');
    assert.equal(show(plain, { def: notesDef, state: { text: 'x' } }).querySelector('.story-block-edit'), null);
});

test('plain: other formats still read', () => {
    const rowsPane = show(plain, { def: notesDef, state: { categories: [{ name: 'General', items: [{ name: 'Rope', quantity: '1', remark: 'Hemp' }] }] } });
    assert.match(rowsPane.textContent, /General.*Rope · 1 · Hemp/);
    const fieldsPane = show(plain, { def: notesDef, state: { entries: [{ label: 'HP', type: 'meter', raw: '80/100', value: 80, max: 100 }] } });
    assert.equal(shape(fieldsPane.querySelector('.story-block-plain-text')), '<b>HP:</b> 80/100');
});

// ---- fields ----------------------------------------------------------------------------

const sheet = {
    entries: [
        { label: 'HP', type: 'meter', raw: '72/100', value: 72, max: 100 },
        { label: 'Stamina', type: 'meter', raw: '130', value: 130, max: 100 },
        { label: 'Gold', type: 'number', raw: '85', value: 85 },
        { label: 'Status', type: 'text', raw: 'Bruised ribs', value: 'Bruised ribs' },
        { label: 'Skills', type: 'list', raw: 'Archery 3, Stealth 2', items: ['Archery 3', 'Stealth 2'] },
    ],
};

test('fields: meters, numbers, text and list chips', () => {
    const pane = show(fields, { def: sheetDef, state: sheet });
    assert.deepEqual(texts(pane, '.story-block-field-label'), ['HP', 'Stamina', 'Gold', 'Status', 'Skills']);
    const hp = pane.querySelector('.story-block-field.is-meter .story-block-meter');
    assert.equal(hp.getAttribute('role'), 'meter');
    assert.equal(hp.getAttribute('aria-valuenow'), '72');
    assert.equal(hp.getAttribute('aria-valuemin'), '0');
    assert.equal(hp.getAttribute('aria-valuemax'), '100');
    assert.equal(hp.getAttribute('aria-label'), 'HP');
    assert.equal(hp.querySelector('.story-block-meter-fill').style.width, '72%');
    assert.equal(pane.querySelector('.story-block-meter-text').textContent, '72/100');
    assert.equal(pane.querySelector('.story-block-number').textContent, '85');
    assert.equal(pane.querySelector('.story-block-text').textContent, 'Bruised ribs');
    assert.deepEqual(texts(pane, '.story-block-chip'), ['Archery 3', 'Stealth 2']);
});

test('fields: meters clamp the bar and ARIA, but show the written value', () => {
    const pane = show(fields, { def: sheetDef, state: sheet });
    const stamina = pane.querySelectorAll('.story-block-meter')[1];
    assert.equal(stamina.getAttribute('aria-valuenow'), '100');
    assert.equal(stamina.querySelector('.story-block-meter-fill').style.width, '100%');
    assert.ok(stamina.classList.contains('is-over'));
    assert.equal(texts(pane, '.story-block-meter-text')[1], '130/100');

    assert.deepEqual(fields.meterValues({ label: 'HP', value: -5, max: 50 }, sheetDef), { value: -5, max: 50, now: 0, percent: 0 });
    assert.deepEqual(fields.meterValues({ label: 'HP', value: 25 }, sheetDef), { value: 25, max: 100, now: 25, percent: 25 }, 'max from the definition');
    assert.deepEqual(fields.meterValues({ label: 'Odd', value: 1, max: 0 }, sheetDef), { value: 1, max: 100, now: 1, percent: 1 }, 'invalid max falls back to 100');
    assert.equal(fields.meterValues({ label: 'HP', value: 1, max: 3 }).percent, 33.3);
});

test('fields: an unreadable meter shows its raw text without a bar', () => {
    const pane = show(fields, { def: sheetDef, state: { entries: [{ label: 'HP', type: 'meter', raw: 'about half', value: null, max: 100 }] } });
    assert.equal(pane.querySelector('.story-block-meter'), null);
    assert.equal(pane.querySelector('.story-block-meter-wrap.is-unreadable').textContent, 'about half');
});

test('fields: unknown entries come last and muted', () => {
    const state = { entries: [{ label: 'Mood', type: 'text', raw: 'grim', value: 'grim', unknown: true }, ...sheet.entries] };
    const pane = show(fields, { def: sheetDef, state });
    assert.equal(texts(pane, '.story-block-field-label').at(-1), 'Mood');
    const mood = pane.querySelectorAll('.story-block-field').at(-1);
    assert.ok(mood.classList.contains('is-unknown'));
});

test('fields: changed entries carry a dot; every change is worded once in the folded "Changed this turn" section', () => {
    const changes = [
        { type: 'changed', label: 'HP', from: '80/100', to: '72/100' },
        { type: 'added', label: 'Skills', to: 'Archery 3, Stealth 2' },
        { type: 'removed', label: 'Mana', from: '10' },
    ];
    const pane = show(fields, { def: sheetDef, state: sheet, changes });
    const marked = pane.querySelectorAll('.story-block-field.is-changed');
    assert.deepEqual(marked.map(node => node.querySelector('.story-block-field-label').textContent), ['HP', 'Skills']);
    assert.ok(marked.every(node => node.querySelector('.story-block-change-dot')), 'a dot, not the wording, on the field');
    assert.equal(pane.querySelector('.story-block-field-change-text'), null);
    const section = pane.querySelector('.story-block-changes');
    assert.equal(section.open, false, 'folded by default');
    assert.equal(section.querySelector('.story-block-changes-title').textContent, 'Changed this turn');
    assert.equal(section.querySelector('.story-block-changes-count').textContent, '3');
    assert.deepEqual(texts(section, '.story-block-changes-text'), ['HP: 80/100 → 72/100', 'Skills: Archery 3, Stealth 2', 'Mana (gone)']);
});

test('fields: without changes, previousState is compared by label', () => {
    const previousState = { entries: [{ label: 'HP', type: 'meter', raw: '80/100', value: 80, max: 100 }, ...sheet.entries.slice(1)] };
    const pane = show(fields, { def: sheetDef, state: sheet, previousState });
    assert.deepEqual(texts(pane, '.story-block-field.is-changed .story-block-field-label'), ['HP']);
});

test('fields: empty, missing, error, truncated, edit; text stays text', () => {
    assert.match(show(fields, { def: sheetDef, state: null }).textContent, /No Character Sheet in the latest reply\./);
    assert.match(show(fields, { def: sheetDef, state: { entries: [] } }).textContent, /Character Sheet is empty\. It fills in as the story goes\./);
    let edits = 0;
    const pane = show(fields, {
        def: sheetDef,
        state: { entries: [{ label: 'Status', type: 'text', raw: '<script>x</script>', value: '<script>x</script>' }] },
        error: 'No known field found.',
        truncated: true,
        onEdit: () => { edits += 1; },
    });
    assert.match(texts(pane, '.story-block-notice')[0], /^This reply's Character Sheet couldn't be read: No known field found\. Showing the last valid state\.$/);
    assert.match(texts(pane, '.story-block-notice')[1], /cut off/);
    assert.equal(pane.querySelector('.story-block-text').textContent, '<script>x</script>');
    assert.equal(pane.querySelectorAll('script').length, 0);
    pane.querySelector('.story-block-edit').click();
    assert.equal(edits, 1);
    assert.match(show(fields, { def: sheetDef, state: { text: 'loose text' } }).textContent, /loose text/, 'non-fields state falls back to plain');
});
