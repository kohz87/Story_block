// Inventory and Scene tabs: smoke tests of the minimal plain renderers on the fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { CROWNS, core, stocked } from './fixtures.js';
import { createCorePart } from '../../../src/v2/domains/index.js';

// The code tabs are the core part's; the module shows the default screens instead (src/v2/screens/).
const codeTabs = settings => createCorePart({ settings: () => settings }).tabs;

const doc = installFakeDom();
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function host() {
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    return el;
}

test('inventory tab: grouped by kind with qty, rarity, equipped marker and wallet', () => {
    const module = core({}, CROWNS);
    const state = stocked(module);
    state.domains.inventory.wallets = { party: { coin: 38 } };
    state.domains.inventory.stacks.it_sword001.equipped = 'hand';
    const el = host();
    const tab = codeTabs(CROWNS).find(item => item.id === 'inventory');
    tab.render(el, { state }, { command: () => ({ ok: true }) });
    assert.deepEqual(texts(el, '.ss-inv-wallet'), ['Wallet: 38 crowns']);
    assert.deepEqual(texts(el, '.ss-inv-group-title'), ['Equipment', 'Consumables', 'Goods']);
    assert.equal(el.querySelectorAll('.ss-inv-row').length, 6, 'one row per stack');
    const sword = el.querySelector('.ss-inv-row[data-stack="it_sword001"]');
    assert.ok(sword.classList.contains('is-equipped'));
    assert.ok(sword.classList.contains('ss-rarity-uncommon'));
    assert.deepEqual(texts(sword, '.ss-inv-equipped'), ['equipped: hand']);
    assert.deepEqual(texts(sword, 'button'), ['Unequip', 'Drop']);
    const rope = el.querySelector('.ss-inv-row[data-stack="it_rope0001"]');
    assert.deepEqual(texts(rope, '.ss-inv-qty'), ['×3']);
    assert.deepEqual(texts(rope, 'button'), ['Drop'], 'no Equip on goods');
    assert.deepEqual(texts(el.querySelector('.ss-inv-row[data-stack="it_dagg0001"]'), 'button'), ['Equip', 'Drop']);
    assert.deepEqual(texts(el.querySelector('.ss-inv-row[data-stack="it_potb0001"]'), '.ss-inv-note'), ['cloudy']);
});

test('inventory tab: buttons call sdk commands; Drop asks twice; a rejection is shown', async () => {
    const module = core();
    const calls = [];
    let answer = { ok: true };
    const api = { command: (type, payload, options) => { calls.push([type, payload, options]); return Promise.resolve(answer); } };
    const el = host();
    codeTabs({})[0].render(el, { state: stocked(module) }, api);
    el.querySelector('.ss-inv-row[data-stack="it_dagg0001"] button[data-action="equip"]').click();
    assert.deepEqual(calls[0], ['inventory.equip', { stack: 'it_dagg0001' }, { cause: 'ui' }]);
    const drop = el.querySelector('.ss-inv-row[data-stack="it_rope0001"] button[data-action="drop"]');
    drop.click();
    assert.equal(calls.length, 1, 'the first click only asks');
    assert.equal(drop.textContent, 'Drop?');
    answer = { ok: false, code: 'NOT_FOUND', message: 'That item is no longer in the inventory.' };
    drop.click();
    assert.deepEqual(calls[1], ['inventory.drop', { stack: 'it_rope0001' }, { cause: 'ui' }]);
    await settle();
    assert.deepEqual(texts(el, '.ss-inv-status'), ['That item is no longer in the inventory.']);
    assert.equal(drop.disabled, false);
});

test('inventory tab: empty, and a re-render replaces the old content', () => {
    const module = core();
    const el = host();
    codeTabs({})[0].render(el, { state: stocked(module) }, {});
    codeTabs({})[0].render(el, { state: { domains: { inventory: { defs: {}, stacks: {}, wallets: {}, aliases: {} } } } }, {});
    assert.equal(el.children.length, 1);
    assert.deepEqual(texts(el, '.ss-inv-empty'), ['Nothing carried.']);
    assert.deepEqual(texts(el, '.ss-inv-wallet'), ['Wallet: 0 gold']);
});

test('scene tab: place and who is present', () => {
    const module = core();
    const tab = codeTabs(CROWNS).find(item => item.id === 'scene');
    const el = host();
    tab.render(el, { state: { domains: { scene: { place: { name: 'Bluewatch', kind: 'settlement', region: 'Lakeshire' }, present: ['Fenna', 'Tam'] } } } }, {});
    assert.deepEqual(texts(el, '.ss-scene-place'), ['Bluewatch']);
    assert.deepEqual(texts(el, '.ss-scene-about'), ['settlement · Lakeshire']);
    assert.deepEqual(texts(el, '.ss-scene-person'), ['Fenna', 'Tam']);
    tab.render(el, { state: { domains: { scene: { place: { name: '', kind: '', region: '' }, present: [] } } } }, {});
    assert.deepEqual(texts(el, '.ss-scene-place'), ['No place yet.']);
    assert.deepEqual(texts(el, '.ss-scene-empty'), ['No one else here.']);
});
