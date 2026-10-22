// UI stage 4b, in the DOM: the State inspector (screens/inspector.js) on the glass look: its sections are glass cards, its
// diff, operations, receipts and problems are the look's list-card rows with the raw values in monospace, its picker and
// search are the form engine's controls, and its older / newer / latest buttons go disabled at the ends and keep their
// clicks. The keys, the clicks and the focus are the same as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectorWidget } from '../../../src/v2/screens/inspector.js';
import { fakeApi, host, installDom } from '../view/widgets/fake-dom.js';

// ---- the inspector over a fake source (three replies, the newest first) ------------------------------

const REPLIES = [
    { index: 9, name: 'Ren', rev: 14, head: true, snippet: 'Harrow' },
    { index: 6, name: 'Ren', rev: 11, head: false, snippet: 'The mill' },
    { index: 3, name: 'Ren', rev: 7, head: false, snippet: 'The road' },
];
const VIEWS = {
    9: {
        ok: true, index: 9, name: 'Ren', rev: 14, checkpoint: false,
        diff: { entries: [{ kind: 'add', path: '/domains/inventory/stacks/s2', after: { def: 'rope', qty: 1 } }, { kind: 'change', path: '/domains/scene/place/name', before: 'Mill', after: 'Harrow' }], more: 0 },
        ops: [{ op: 'add', path: '/domains/inventory/stacks/s2', value: { def: 'rope', qty: 1 } }, { op: 'replace', path: '/domains/scene/place/name', value: 'Harrow', was: 'Mill' }],
        receipts: [{ id: 'r1', type: 'item', summary: '+1 Rope', module: 'story-block', cause: 'story', rev: 14, narrate: true }],
        problems: [{ code: 'REFUSED', message: 'coin not used' }],
        state: { domains: { scene: { place: { name: 'Harrow' } }, inventory: { stacks: { s2: { def: 'rope', qty: 1 } } } }, meta: { rev: 14 } },
    },
    6: { ok: true, index: 6, name: 'Ren', rev: 11, checkpoint: true, diff: { entries: [], more: 0 }, ops: [], receipts: [], problems: [], state: { meta: { rev: 11 } } },
    3: { ok: true, index: 3, name: 'Ren', rev: 7, checkpoint: false, diff: { entries: [], more: 0 }, ops: [], receipts: [], problems: [], state: { meta: { rev: 7 } } },
};

function inspector(memory = { index: null, search: '', open: new Set() }) {
    const doc = installDom();
    const source = { memory, replies: () => REPLIES, reply: index => VIEWS[index] ?? { ok: false, message: 'none' }, headIndex: () => 9 };
    const widget = createInspectorWidget(source);
    const el = host(doc);
    const handle = widget.render(el, {}, fakeApi());
    const root = el.children[0];
    return { doc, el, root, memory, handle, q: sel => root.querySelector(sel), all: sel => root.querySelectorAll(sel) };
}

test('the inspector: its sections are glass cards with label headings; the rows are the list card\'s, the mark in a tile', () => {
    const m = inspector();
    const sections = m.all('section.sb-insp-card');
    assert.ok(sections.length >= 3, 'changes, receipts, problems, state');
    for (const section of sections) {
        assert.ok(section.classList.contains('ss-glass'), 'a glass card');
        assert.equal(section.querySelector('h4').className, 'ss-label sb-insp-card-title');
    }
    const rows = m.all('.sb-insp-diff li');
    assert.equal(rows.length, 2);
    for (const row of rows) {
        assert.ok(row.classList.contains('ss-listcard-row'));
        assert.ok(row.querySelector('.ss-listcard-item .ss-listcard-icon.sb-insp-mark'), 'the mark sits in the list card tile');
        assert.ok(row.querySelector('.ss-listcard-main .ss-listcard-title.sb-insp-path'), 'the path is the title and raw (monospace)');
    }
    assert.equal(rows[0].querySelector('.sb-insp-mark').textContent, '+');
    assert.equal(rows[1].querySelector('.sb-insp-mark').textContent, '~');
    assert.equal(rows[1].querySelector('.ss-listcard-sub').textContent, '"Mill" → "Harrow"');
    assert.ok(m.all('.sb-insp-receipts li .ss-listcard-title')[0].textContent.includes('+1 Rope'));
    assert.equal(m.q('.sb-insp-problems .ss-listcard-title').textContent, 'coin not used');
    assert.equal(m.q('.sb-insp-problems .ss-listcard-sub').textContent, 'REFUSED');
});

test('the inspector: the picker and search are the form engine\'s controls; the search keeps its text and filters the tree', () => {
    const m = inspector();
    const picker = m.q('.sb-insp-pick');
    assert.ok(picker.className.includes('ss-select') && picker.className.includes('ss-input'), 'a glass select');
    const search = m.q('.sb-insp-search');
    assert.ok(search.className.includes('ss-input') && search.className.includes('ss-text'), 'a glass text box');
    search.value = 'harrow';
    search.dispatch('input', {});
    assert.equal(m.memory.search, 'harrow', 'the search is kept in the widget\'s memory');
});

test('the inspector: older, newer and latest move through the replies; the ends are disabled, the middle is not', () => {
    const m = inspector();
    const older = m.q('.sb-insp-older'), newer = m.q('.sb-insp-newer'), latest = m.q('.sb-insp-latest');
    for (const node of [older, newer, latest]) {
        assert.ok(node.className.includes('sb-insp-btn'), 'a glass pill button');
        assert.equal(node.getAttribute('type'), 'button');
    }
    assert.equal(newer.disabled, true, 'the newest reply has no newer one');
    assert.equal(latest.disabled, true, 'already on the newest');
    assert.equal(older.disabled, false);
    older.click();
    assert.equal(m.q('.sb-insp-pick').value, '6', 'older picks the reply before');
    assert.equal(newer.disabled, false, 'a newer one now exists');
    assert.equal(latest.disabled, false);
    older.click();
    assert.equal(m.q('.sb-insp-pick').value, '3');
    assert.equal(older.disabled, true, 'the oldest reply: older is disabled');
    latest.click();
    assert.equal(m.q('.sb-insp-pick').value, '9', 'latest goes back to the newest');
    assert.equal(latest.disabled, true);
    assert.equal(m.memory.index, null, 'the newest means "follow the story"');
});

test('the inspector: a tree value is raw (monospace class), a key is the label, and a branch opens on click', () => {
    // The branches on the way to the leaf are open (the reader's open set is kept across redraws).
    const m = inspector({ index: null, search: '', open: new Set(['/domains', '/domains/scene', '/domains/scene/place']) });
    const leaf = m.q('.sb-insp-leaf[data-path="/domains/scene/place/name"]');
    assert.ok(leaf, 'a leaf row');
    assert.equal(leaf.querySelector('.sb-insp-key').textContent, 'name');
    assert.ok(leaf.querySelector('.sb-insp-str'), 'the value is a string class (monospace in the stylesheet)');
    const branch = m.q('details[data-path="/domains/inventory"]');
    assert.ok(branch && !branch.hasAttribute('open'), 'a branch that was not opened is closed');
    branch.setAttribute('open', '');
    branch.dispatch('toggle', {});
    assert.ok(m.memory.open.has('/domains/inventory'), 'the open branch is kept for a redraw');
});
