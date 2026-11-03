// The Party card's Inventory button and the slot card it opens (Gear in fights): four buttons in one row, eight equal tiles with a thin condition line,
// no carry on the card; off, the card is as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from '../../view/mounts/helpers.js';
import { createPartyWidget } from '../../../../src/v2/lean-rpg/view/party.js';
import { SLOT_ORDER } from '../../../../src/v2/lean-rpg/view/gear-card.js';
import { createCoreModule } from '../../../../src/v2/domains/index.js';
import { createHarness } from '../../domains/helpers/fake-ctx.js';
import { stocked } from '../../domains/fixtures.js';
import { characterDefinition, fakeState, roleOf, skillsDefinition } from './helpers.js';

const wessel = { definition: characterDefinition('wessel', 'Wessel'), fields: { health: 3, mana: 4, stamina: 1, str: 14, soul: 2, xp: 40 } };
const ren = { definition: characterDefinition('ren', 'Ren'), fields: { health: 5, mana: 2, stamina: 3, str: 7, soul: 1, xp: 85 } };
const skills = { definition: skillsDefinition('wessel-skills', 'Wessel', { tab: true, card: false, tabName: 'Skills', icon: 'ph-star' }), fields: { skill1: 'Iron Breath', rank1: 2 } };
const state = () => fakeState([ren, wessel, skills]);

// What is worn: Wessel (the party's bag) a rare sword, a worn jerkin and a broken buckler; Ren an uncommon cap.
function worn() {
    const module = createCoreModule({ hooks: () => [], settings: () => ({}), extras: { gearOn: () => true, persona: () => 'Wessel' } });
    const s = stocked(module);
    const inv = s.domains.inventory;
    s.domains.party = { actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    const piece = (id, name, slot, rarity, owner, place, cond) => {
        inv.defs[`story/${id}`] = { id: `story/${id}`, name, kind: 'equipment', slot, rarity, value: 10, stack: false, tags: [], note: '' };
        inv.stacks[`it_${id}0000`] = { id: `it_${id}0000`, def: `story/${id}`, qty: 1, owner, equipped: place, note: '', from: '', ...(cond === undefined ? {} : { cond }) };
    };
    piece('sword', 'Cane Sword', 'weapon', 'rare', 'party', 'weapon');
    piece('jerkin', 'Boiled Leather Jerkin', 'body', 'common', 'party', 'body', 50);
    piece('buckler', 'Oak Buckler', 'off-hand', 'uncommon', 'party', 'off-hand', 0);
    piece('cap', 'Iron Cap', 'head', 'uncommon', 'ac_ren00001', 'head');
    return createHarness([module], { state: s, extra: { feature: id => id === 'story-block.gear' || id === 'story-block.rpg' } });
}

function draw({ gear = null } = {}) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const widget = createPartyWidget({ headState: () => state(), readerName: () => 'Wessel', roleOf, gear, exportCharacter: () => {} });
    widget.render(el, {}, {});
    return { doc, el };
}
const names = root => root.querySelectorAll('.rpg-card-actions button').map(node => node.textContent);
const card = (el, name) => el.querySelector(`.rpg-card[data-character="${name}"]`);
const on = h => ({ on: () => true, view: args => h.query('gear.view', args) });

test('the card\'s buttons: Stats, Skills, Inventory, Export in one row while gear is on; Inventory is not there off', () => {
    const h = worn();
    const open = draw({ gear: on(h) });
    assert.deepEqual(names(card(open.el, 'Wessel')), ['Stats', 'Skills', 'Inventory', 'Export']);
    assert.deepEqual(names(card(open.el, 'Ren')), ['Stats', 'Inventory', 'Export'], 'no Skills block: three');
    assert.equal(card(open.el, 'Wessel').querySelectorAll('.rpg-card-actions').length, 1, 'one row');
    const off = draw({ gear: { on: () => false, view: () => null } });
    assert.deepEqual(names(card(off.el, 'Wessel')), ['Stats', 'Skills', 'Export']);
    assert.deepEqual(names(draw().el.querySelectorAll('.rpg-card')[0]), ['Stats', 'Skills', 'Export'], 'no host: as before');
});

test('the slot card\'s pill says what the Party card\'s level pill says ("Lv 2"), not the Soul Class', () => {
    const h = worn();
    const { el } = draw({ gear: on(h) });
    const party = card(el, 'Wessel').querySelector('.rpg-level-pill').textContent;
    card(el, 'Wessel').querySelector('.rpg-gear-open').click();
    const pill = el.querySelector('.rpg-gear .rpg-level-pill');
    assert.ok(pill, 'the slot card has a pill');
    assert.equal(pill.textContent, party);
    assert.doesNotMatch(pill.textContent, /Soul|Class/);
});

test('Inventory opens the slot card: eight equal tiles, each with its place, and a condition line for what is not Good; nothing about carry; Back returns', () => {
    const h = worn();
    const { el } = draw({ gear: on(h) });
    card(el, 'Wessel').querySelector('.rpg-gear-open').click();
    const view = el.querySelector('.rpg-gear');
    assert.ok(view, 'the slot card is open');
    assert.equal(el.querySelector('.rpg-main').hidden, true, 'in place of the cards');
    assert.equal(view.querySelector('.rpg-sheet-name').textContent, 'Wessel\'s inventory');
    const tiles = view.querySelectorAll('.rpg-slot');
    assert.deepEqual(tiles.map(node => node.getAttribute('data-slot')), SLOT_ORDER);
    assert.deepEqual(SLOT_ORDER, ['head', 'body', 'cloak', 'feet', 'weapon', 'off-hand', 'accessory-1', 'accessory-2']);
    assert.equal(tiles.length, 8);
    const tile = place => view.querySelector(`.rpg-slot[data-slot="${place}"]`);
    // Weapon: the rare sword, +2 DEX, rarity colour class, no condition mark (Good).
    assert.equal(tile('weapon').querySelector('.rpg-slot-name').textContent, 'Cane Sword');
    assert.equal(tile('weapon').querySelector('.rpg-slot-bonus').textContent, '+2 DEX');
    assert.ok(tile('weapon').classList.contains('r-rare'));
    assert.ok(!tile('weapon').classList.contains('w-worn') && !tile('weapon').classList.contains('w-torn') && !tile('weapon').classList.contains('w-broken'));
    assert.ok(tile('weapon').querySelector('.rpg-slot-cond'), 'every worn tile has its 3px line; the colour says the condition');
    // Body: worn (condition 50 is 40 to 69); off-hand: broken.
    assert.ok(tile('body').classList.contains('w-worn'));
    assert.ok(tile('off-hand').classList.contains('w-broken'));
    assert.match(tile('off-hand').getAttribute('title'), /Oak Buckler: Broken — no bonus/);
    // Empty places say so; Ren's cap is not here.
    assert.equal(tile('cloak').querySelector('.rpg-slot-place').textContent, 'Cloak — empty');
    assert.ok(tile('cloak').classList.contains('rpg-slot-empty'));
    assert.equal(tile('head').classList.contains('rpg-slot-empty'), true, 'the cap is Ren\'s');
    // No carry on this card.
    assert.equal(view.querySelectorAll('.carry-card, .carry-bar, .carry-line, .ss-bar-track, .rpg-bars').length, 0);
    assert.doesNotMatch(view.textContent, /\d+ \/ \d+|Heavy|Encumbered/);
    // Back to the party.
    view.querySelector('.rpg-gear-back').click();
    assert.equal(el.querySelector('.rpg-gear'), null);
    assert.equal(el.querySelector('.rpg-main').hidden, false);
});

test('a companion\'s slot card shows what they wear; switching gear off while it is open closes it', () => {
    const h = worn();
    let live = true;
    const { el } = draw({ gear: { on: () => live, view: args => h.query('gear.view', args) } });
    card(el, 'Ren').querySelector('.rpg-gear-open').click();
    const tile = place => el.querySelector(`.rpg-gear .rpg-slot[data-slot="${place}"]`);
    assert.equal(tile('head').querySelector('.rpg-slot-name').textContent, 'Iron Cap');
    assert.equal(tile('head').querySelector('.rpg-slot-bonus').textContent, '+1 VIT');
    assert.equal(tile('weapon').classList.contains('rpg-slot-empty'), true, 'the sword is Wessel\'s');
    live = false;
    el.querySelector('.rpg-gear-back').click();
    assert.equal(el.querySelector('.rpg-gear'), null);
    assert.deepEqual(names(card(el, 'Ren')), ['Stats', 'Export']);
});

test('the four buttons share the row equally (each a quarter, on phone and desktop): the stylesheet gives each the same flex share', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    const rule = /\.rpg-card-actions-gear \.ss-button \{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(rule, /flex: 1 1 0;/);
    assert.match(css, /\.rpg-card-actions-gear \{[^}]*flex-wrap: nowrap;/);
    assert.doesNotMatch(rule, /flex: 0/);
});
