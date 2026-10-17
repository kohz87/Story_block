// NPC State Delta mounts its "Present NPCs" tab into Megumin Suite's card. These tests
// run a faithful copy of that bridge (kohz87/npc_state_delta index.js,
// meguminBlockCardForMessage / mountNpcStateInsideMeguminBlock / closeMeguminNpcStatePane
// / inlineMountNeedsRepair's host check) against our card, unchanged except for
// formatting, so a change on our side that breaks the integration fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, makeMessage, same, sameList, visible } from './ui-fake-dom.js';

const doc = installFakeDom();
const { mountCard } = await import('../src/ui/card.js');

// ---- copied bridge (shape and branches kept verbatim) ---------------------------------

function meguminBlockCardForMessage(message) {
    return message?.querySelector?.('.meg-blocks') || null;
}

function canIntegrate(message) {
    const block = meguminBlockCardForMessage(message);
    return Boolean(block?.querySelector?.('.meg-blocks-tabs') && block?.querySelector?.('.meg-blocks-panel'));
}

function setClassActive(node, active) {
    if (!node) return;
    if (node.classList?.toggle) node.classList.toggle('active', Boolean(active));
}

function closeMeguminNpcStatePane(card) {
    if (!card?.querySelectorAll) return;
    for (const pane of [...(card.querySelectorAll('.npc-state-delta-megumin-pane') || [])]) {
        if (pane?.style) pane.style.display = 'none';
    }
    for (const tab of [...(card.querySelectorAll('.npc-state-delta-megumin-tab') || [])]) {
        setClassActive(tab, false);
        tab.setAttribute?.('aria-expanded', 'false');
    }
}

function mountNpcStateInsideMeguminBlock(message, messageId, html) {
    const card = meguminBlockCardForMessage(message);
    if (!card?.querySelector) return false;
    const tabs = card.querySelector('.meg-blocks-tabs');
    const panel = card.querySelector('.meg-blocks-panel');
    if (!tabs || !panel) return false;

    let button = card.querySelector('.npc-state-delta-megumin-tab');
    let pane = card.querySelector('.npc-state-delta-megumin-pane');
    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'meg-blocks-tab npc-state-delta-megumin-tab';
        button.dataset.npcStateDeltaMessageId = String(messageId);
        button.dataset.key = `npc-state-delta:${messageId}`;
        button.title = 'Present NPCs';
        button.setAttribute?.('aria-expanded', 'false');
        button.innerHTML = '<span class="meg-blocks-tab-emoji">👥</span><span class="meg-blocks-tab-label">Present NPCs</span>';
        button.addEventListener?.('click', event => {
            if (event?.defaultPrevented) return;
            event?.stopPropagation?.();

            const isOpen = button.classList?.contains?.('active')
                && pane?.style?.display !== 'none'
                && !card.classList?.contains?.('meg-blocks-shut');
            if (isOpen) {
                closeMeguminNpcStatePane(card);
                card.classList?.add?.('meg-blocks-shut');
                return;
            }

            const collapse = tabs.querySelector?.('.meg-blocks-collapse');
            if (typeof collapse?.click === 'function') {
                collapse.click();
                if (!card.classList?.contains?.('meg-blocks-shut')) collapse.click();
            }

            for (const nativePane of [...(card.querySelectorAll?.('.meg-block-body') || [])]) {
                if (nativePane?.style) nativePane.style.display = nativePane === pane ? '' : 'none';
            }
            for (const tab of [...(card.querySelectorAll?.('.meg-blocks-tab') || [])]) setClassActive(tab, tab === button);
            if (panel?.style) panel.style.display = '';
            card.classList?.remove?.('meg-blocks-shut');
            button.setAttribute?.('aria-expanded', 'true');
        });
        const collapse = tabs.querySelector?.('.meg-blocks-collapse');
        if (collapse?.before) collapse.before(button);
        else tabs.appendChild?.(button);
    }

    if (!pane) {
        pane = document.createElement('div');
        pane.className = 'meg-block-body npc-state-delta-megumin-pane';
        pane.dataset.npcStateDeltaMessageId = String(messageId);
        if (pane.style) pane.style.display = 'none';
        panel.appendChild?.(pane);
    }
    pane.dataset.key = button.dataset.key;
    if (pane.dataset.npcStateDeltaSnapshotSignature !== html || !String(pane.innerHTML || '').trim()) {
        pane.innerHTML = html;
        pane.dataset.npcStateDeltaSnapshotSignature = html;
    }

    for (const control of [...(card.querySelectorAll?.('.meg-blocks-tab, .meg-blocks-collapse') || [])]) {
        if (control === button || control?.dataset?.npcStateDeltaDismissBound === '1') continue;
        if (control?.dataset) control.dataset.npcStateDeltaDismissBound = '1';
        control?.addEventListener?.('click', () => closeMeguminNpcStatePane(card));
    }
    return true;
}

// ---- helpers ---------------------------------------------------------------------------

let keyCounter = 0;
function setup() {
    const message = makeMessage(doc, 7);
    const uiKey = `npc-${keyCounter += 1}`;
    const tabs = ['inventory', 'sheet'].map(id => ({
        id,
        label: id,
        icon: '•',
        key: 'same',
        render(pane) { pane.textContent = id; },
    }));
    const card = mountCard(message, tabs, { uiKey });
    const remount = () => mountCard(message, tabs, { uiKey });
    const bridge = () => mountNpcStateInsideMeguminBlock(message, 7, '<div class="npc-state-delta-roster">Astra</div>');
    return { message, card, remount, bridge };
}

const ours = card => card.querySelectorAll('.story-block-tab');
const ourPanes = card => card.querySelectorAll('.story-block-pane');
const npcTab = card => card.querySelector('.npc-state-delta-megumin-tab');
const npcPane = card => card.querySelector('.npc-state-delta-megumin-pane');
const shut = card => card.classList.contains('meg-blocks-shut');
const shownPanes = card => card.querySelectorAll('.meg-block-body').filter(visible);

// ---- tests -----------------------------------------------------------------------------

test('host detection accepts our card and the bridge mounts its tab before our collapse button', () => {
    const { message, card, bridge } = setup();
    same(meguminBlockCardForMessage(message), card, 'its host lookup finds our card');
    assert.equal(canIntegrate(message), true);
    assert.equal(bridge(), true);
    const strip = card.querySelector('.story-block-tabs');
    const order = strip.children.map(node => node.classList.contains('story-block-tab') ? node.dataset.tabId : node.classList.contains('npc-state-delta-megumin-tab') ? 'npc' : 'collapse');
    assert.deepEqual(order, ['inventory', 'sheet', 'npc', 'collapse']);
    same(npcPane(card).parentElement, card.querySelector('.story-block-panel'), 'its pane lives in our panel');
    assert.equal(visible(npcPane(card)), false, 'its pane starts hidden');
    assert.deepEqual(shownPanes(card).map(pane => pane.dataset.tabId), ['inventory'], 'ours stays shown');
    message.remove();
});

test('clicking its tab hides our panes; clicking ours hides its pane', () => {
    const { message, card, bridge } = setup();
    bridge();
    npcTab(card).click();
    sameList(shownPanes(card), [npcPane(card)], 'only its pane is shown');
    assert.equal(shut(card), false, 'the collapse dance ends open');
    assert.ok(npcTab(card).classList.contains('active'));
    assert.ok(ours(card).every(tab => !tab.classList.contains('active')));

    ours(card)[1].click();
    assert.deepEqual(shownPanes(card).map(pane => pane.dataset.tabId), ['sheet']);
    assert.equal(npcTab(card).classList.contains('active'), false);
    assert.equal(npcTab(card).getAttribute('aria-expanded'), 'false');
    assert.equal(shut(card), false);
    message.remove();
});

test('its tab works from a collapsed card, and toggles closed when clicked again', () => {
    const { message, card, bridge } = setup();
    bridge();
    card.querySelector('.story-block-collapse').click();
    assert.equal(shut(card), true);
    npcTab(card).click();
    assert.equal(shut(card), false);
    sameList(shownPanes(card), [npcPane(card)], 'only its pane is shown');
    npcTab(card).click();
    assert.equal(shut(card), true, 'clicking the open NPC tab folds the card');
    message.remove();
});

test('our collapse works while its pane is open, and re-opening shows our selected pane', () => {
    const { message, card, bridge } = setup();
    bridge();
    ours(card)[1].click();
    npcTab(card).click();
    const collapse = card.querySelector('.story-block-collapse');
    collapse.click();
    assert.equal(shut(card), true);
    assert.equal(visible(npcPane(card)), false, 'its dismiss listener closed its pane');
    collapse.click();
    assert.equal(shut(card), false);
    assert.deepEqual(shownPanes(card).map(pane => pane.dataset.tabId), ['sheet'], 'never an empty panel');
    message.remove();
});

test('re-mounting our card keeps its tab, its pane and its open state', () => {
    const { message, card, remount, bridge } = setup();
    bridge();
    npcTab(card).click();
    same(remount(), card, 'card reused');
    assert.ok(npcTab(card), 'foreign tab survives');
    sameList(shownPanes(card), [npcPane(card)], 'its pane stays the visible one');
    assert.equal(shut(card), false);
    // Its repair pass is idempotent against our card.
    bridge();
    assert.equal(card.querySelectorAll('.npc-state-delta-megumin-tab').length, 1);
    const strip = card.querySelector('.story-block-tabs');
    assert.ok(strip.children.at(-1).classList.contains('story-block-collapse'));
    // A later click on our tab still wins.
    ours(card)[0].click();
    assert.deepEqual(shownPanes(card).map(pane => pane.dataset.tabId), ['inventory']);
    message.remove();
});

test('its collapse dance does not leave our card collapsed on the next reply', () => {
    const { message, card, bridge } = setup();
    bridge();
    npcTab(card).click();
    const uiKey = card.dataset.uiKey;
    const next = makeMessage(doc, 8);
    const moved = mountCard(next, [{ id: 'inventory', label: 'inventory', render() {} }], { uiKey });
    assert.equal(moved.classList.contains('meg-blocks-shut'), false);
    assert.ok(visible(moved.querySelector('.story-block-pane')));
    message.remove();
    next.remove();
});

test('without compatMarkup the bridge does not attach', () => {
    const message = makeMessage(doc, 9);
    mountCard(message, [{ id: 'a', label: 'A', render() {} }], { uiKey: 'plain', compatMarkup: false });
    assert.equal(canIntegrate(message), false);
    assert.equal(mountNpcStateInsideMeguminBlock(message, 9, '<b>x</b>'), false);
    message.remove();
});
