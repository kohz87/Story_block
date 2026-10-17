// Card mounting, tab switching, pane reuse, collapse and the external tab registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, makeMessage, same, texts, visible } from './ui-fake-dom.js';

const doc = installFakeDom();
const { createTabRegistry, mountCard, unmountCard } = await import('../src/ui/card.js');

let keyCounter = 0;
const freshKey = () => `chat-${keyCounter += 1}`;

function counted(id, label, { key, text = label } = {}) {
    const tab = {
        id, label, icon: '🎒', key,
        renders: 0,
        render(pane) {
            tab.renders += 1;
            pane.replaceChildren();
            pane.textContent = `${text} #${tab.renders}`;
        },
    };
    return tab;
}

const tabButtons = card => card.querySelectorAll('.story-block-tab');
const paneFor = (card, id) => card.querySelector(`.story-block-pane[data-tab-id="${id}"]`);
const activeIds = card => tabButtons(card).filter(tab => tab.classList.contains('active')).map(tab => tab.dataset.tabId);

test('mounts one card at the end of .mes_block with tabs, panes and Megumin classes', () => {
    const message = makeMessage(doc);
    const card = mountCard(message, [counted('inventory', 'Inventory'), counted('notes', 'Scene Notes')], { uiKey: freshKey() });
    const block = message.querySelector('.mes_block');
    same(block.children.at(-1), card, 'card is the last child of .mes_block');
    assert.ok(card.matches('.story-block-card.meg-blocks'));
    assert.ok(card.querySelector(':scope > .story-block-tabs.meg-blocks-tabs'));
    assert.ok(card.querySelector(':scope > .story-block-panel.meg-blocks-panel'));
    assert.deepEqual(texts(card, '.story-block-tab-label'), ['Inventory', 'Scene Notes']);
    assert.ok(tabButtons(card).every(tab => tab.classList.contains('meg-blocks-tab')));
    const collapse = card.querySelector('.story-block-collapse');
    assert.ok(collapse.classList.contains('meg-blocks-collapse') && !collapse.classList.contains('meg-blocks-tab'));
    same(card.querySelector('.story-block-tabs').children.at(-1), collapse, 'collapse stays last in the strip');
    assert.ok(paneFor(card, 'inventory').classList.contains('meg-block-body'));
    assert.deepEqual(activeIds(card), ['inventory'], 'first tab selected by default');
    assert.ok(visible(paneFor(card, 'inventory')));
    assert.ok(!visible(paneFor(card, 'notes')));
    assert.equal(tabButtons(card)[0].getAttribute('aria-controls'), paneFor(card, 'inventory').id);
    message.remove();
});

test('without compatMarkup the card carries no Megumin classes, and falls back to the message element', () => {
    const message = doc.createElement('div');
    doc.body.appendChild(message);
    const card = mountCard(message, [counted('a', 'A')], { uiKey: freshKey(), compatMarkup: false });
    same(card.parentElement, message, 'falls back to the message element');
    assert.equal(card.querySelectorAll('.meg-blocks-tab, .meg-block-body, .meg-blocks-tabs').length, 0);
    assert.ok(!card.classList.contains('meg-blocks'));
    card.querySelector('.story-block-collapse').click();
    assert.ok(card.classList.contains('story-block-shut'));
    message.remove();
});

test('switching tabs shows one pane; re-mounting keeps the selected tab and the card element', () => {
    const uiKey = freshKey();
    const message = makeMessage(doc);
    const tabs = [counted('a', 'A'), counted('b', 'B'), counted('c', 'C')];
    const card = mountCard(message, tabs, { uiKey });
    tabButtons(card)[1].click();
    assert.deepEqual(activeIds(card), ['b']);
    assert.deepEqual(card.querySelectorAll('.story-block-pane').filter(visible).map(pane => pane.dataset.tabId), ['b']);

    const again = mountCard(message, tabs, { uiKey });
    same(again, card, 'same card element is reused');
    assert.deepEqual(activeIds(card), ['b']);
    assert.equal(message.querySelectorAll('.story-block-card').length, 1);

    // The selection follows the reader to the card of the next reply.
    const next = makeMessage(doc, 2);
    const moved = mountCard(next, tabs, { uiKey });
    assert.ok(moved !== card);
    assert.equal(card.isConnected, false, 'the old card is removed');
    assert.equal(doc.querySelectorAll('.story-block-card').length, 1);
    assert.deepEqual(activeIds(moved), ['b']);

    // When the selected tab disappears, fall back to the first.
    const fewer = mountCard(next, [tabs[0], tabs[2]], { uiKey });
    assert.deepEqual(activeIds(fewer), ['a']);
    assert.ok(paneFor(fewer, 'b') === null, 'the dropped tab\'s pane is removed');
    message.remove();
    next.remove();
});

test('panes with an unchanged key are not rebuilt; a new key or no key re-renders', () => {
    const uiKey = freshKey();
    const message = makeMessage(doc);
    const keyed = counted('keyed', 'Keyed', { key: 'v1' });
    const unkeyed = counted('free', 'Free');
    const card = mountCard(message, [keyed, unkeyed], { uiKey });
    const pane = paneFor(card, 'keyed');
    pane.scrollTop = 120;
    mountCard(message, [keyed, unkeyed], { uiKey });
    assert.equal(keyed.renders, 1);
    assert.equal(unkeyed.renders, 2);
    same(paneFor(card, 'keyed'), pane, 'same pane element');
    assert.equal(pane.scrollTop, 120);
    keyed.key = 'v2';
    mountCard(message, [keyed, unkeyed], { uiKey });
    assert.equal(keyed.renders, 2);
    assert.match(pane.textContent, /#2$/);
    message.remove();
});

test('tabs are reordered in place and labels update', () => {
    const uiKey = freshKey();
    const message = makeMessage(doc);
    const a = counted('a', 'A');
    const b = counted('b', 'B');
    const card = mountCard(message, [a, b], { uiKey });
    b.label = 'Bee';
    mountCard(message, [b, a], { uiKey });
    assert.deepEqual(texts(card, '.story-block-tab-label'), ['Bee', 'A']);
    assert.equal(card.querySelector('.story-block-tabs').children.at(-1).classList.contains('story-block-collapse'), true);
    message.remove();
});

test('collapse toggles the shut class, survives re-mounts, and clicking the open tab folds the card', () => {
    const uiKey = freshKey();
    const message = makeMessage(doc);
    const tabs = [counted('a', 'A'), counted('b', 'B')];
    const card = mountCard(message, tabs, { uiKey });
    const collapse = card.querySelector('.story-block-collapse');
    collapse.click();
    assert.ok(card.classList.contains('meg-blocks-shut'));
    assert.equal(collapse.getAttribute('aria-expanded'), 'false');
    mountCard(message, tabs, { uiKey });
    assert.ok(card.classList.contains('meg-blocks-shut'), 'still collapsed after a re-render');

    const next = makeMessage(doc, 2);
    const moved = mountCard(next, tabs, { uiKey });
    assert.ok(moved.classList.contains('meg-blocks-shut'), 'still collapsed on the next reply');
    moved.querySelector('.story-block-collapse').click();
    assert.ok(!moved.classList.contains('meg-blocks-shut'));
    assert.ok(visible(paneFor(moved, 'a')));

    tabButtons(moved)[0].click();
    assert.ok(moved.classList.contains('meg-blocks-shut'), 'clicking the open tab folds');
    tabButtons(moved)[1].click();
    assert.ok(!moved.classList.contains('meg-blocks-shut'), 'clicking another tab opens on it');
    assert.deepEqual(activeIds(moved), ['b']);
    message.remove();
    next.remove();
});

test('clicks on the card do not reach the message', () => {
    const message = makeMessage(doc);
    let reached = 0;
    message.addEventListener('click', () => { reached += 1; });
    const card = mountCard(message, [counted('a', 'A'), counted('b', 'B')], { uiKey: freshKey() });
    tabButtons(card)[1].click();
    card.querySelector('.story-block-collapse').click();
    assert.equal(reached, 0);
    message.remove();
});

test('a failing tab render shows an error in its own pane only', () => {
    const message = makeMessage(doc);
    const good = counted('good', 'Good');
    const bad = { id: 'bad', label: 'Bad', render() { throw new Error('boom'); } };
    const original = console.error;
    console.error = () => {};
    try {
        const card = mountCard(message, [bad, good], { uiKey: freshKey() });
        assert.match(paneFor(card, 'bad').textContent, /Bad could not be shown: boom/);
        assert.match(paneFor(card, 'good').textContent, /Good #1/);
    } finally {
        console.error = original;
    }
    message.remove();
});

test('no tabs: nothing is mounted and an existing card is removed; unmountCard clears all', () => {
    const uiKey = freshKey();
    const message = makeMessage(doc);
    assert.equal(mountCard(message, [], { uiKey }), null);
    assert.equal(mountCard(null, [counted('a', 'A')], { uiKey }), null);
    mountCard(message, [counted('a', 'A')], { uiKey });
    assert.equal(mountCard(message, [], { uiKey }), null);
    assert.equal(message.querySelectorAll('.story-block-card').length, 0);
    mountCard(message, [counted('a', 'A')], { uiKey });
    unmountCard(doc);
    assert.equal(doc.querySelectorAll('.story-block-card').length, 0);
    message.remove();
});

test('tab ids are deduplicated and tabs without render are skipped', () => {
    const message = makeMessage(doc);
    const card = mountCard(message, [counted('a', 'A'), counted('a', 'Again'), { id: 'x', label: 'X' }], { uiKey: freshKey() });
    assert.deepEqual(texts(card, '.story-block-tab-label'), ['A']);
    message.remove();
});

test('tab registry: register, replace, order, availability, unregister', () => {
    let changes = 0;
    const registry = createTabRegistry({ onChange: () => { changes += 1; } });
    const render = () => {};
    registry.register({ id: 'late', label: 'Late', icon: '⏰', order: 200, render });
    const off = registry.register({ id: 'npcs', label: 'NPCs', icon: '👥', render, isAvailable: ctx => ctx.messageId > 0 });
    registry.register({ id: 'first', label: 'First', order: 1, render });
    assert.deepEqual(registry.list().map(tab => tab.id), ['first', 'npcs', 'late']);
    assert.deepEqual(registry.list({ messageId: 0 }).map(tab => tab.id), ['first', 'late']);
    registry.register({ id: 'npcs', label: 'Present NPCs', render });
    assert.equal(registry.list().find(tab => tab.id === 'npcs').label, 'Present NPCs');
    assert.deepEqual(registry.list().map(tab => tab.id), ['first', 'npcs', 'late'], 're-registering keeps the position');
    assert.throws(() => registry.register({ label: 'No id', render }), /needs an id/);
    assert.throws(() => registry.register({ id: 'x' }), /render/);
    assert.equal(off(), true);
    assert.equal(registry.unregister('missing'), false);
    assert.deepEqual(registry.list().map(tab => tab.id), ['first', 'late']);
    assert.equal(changes, 5);

    const throwing = createTabRegistry();
    throwing.register({ id: 't', render, isAvailable() { throw new Error('nope'); } });
    const original = console.error;
    console.error = () => {};
    try { assert.deepEqual(throwing.list({}), []); } finally { console.error = original; }
});

test('registry tabs mount like block tabs', () => {
    const message = makeMessage(doc);
    const registry = createTabRegistry();
    registry.register({ id: 'ext', label: 'External', icon: '🧩', render(pane, ctx) { pane.textContent = `ext for ${ctx?.messageId}`; } });
    const ctx = { messageId: 4 };
    const tabs = [counted('a', 'A'), ...registry.list(ctx).map(tab => ({ ...tab, render: pane => tab.render(pane, ctx) }))];
    const card = mountCard(message, tabs, { uiKey: freshKey() });
    assert.deepEqual(texts(card, '.story-block-tab-label'), ['A', 'External']);
    tabButtons(card)[1].click();
    assert.equal(paneFor(card, 'ext').textContent, 'ext for 4');
    assert.ok(visible(paneFor(card, 'ext')));
    message.remove();
});
