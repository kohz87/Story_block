// The Inventory's folds as a keyboard path (fix 8k): Equip on…, Use on… and Drop are real buttons with aria-expanded and aria-controls
// (the fold row is there while open), a press on the open one closes it, Escape closes the open fold and gives the focus back to its
// button, Cancel does too, no arrow key changes anything (they were radios), and the Tab order is the document order. And the equipment
// kind filter: when its option goes (RPG Battle gone) the draft filter goes back to everything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryScreen } from '../../../src/v2/screens/index.js';
import { resolveData } from '../../../src/v2/view/screens.js';
import { core, foldButtons, foldOf, openFold, queries, renderSkip, show, stocked, text } from './helpers.js';

const skip = renderSkip;
const REN = 'ac_ren00001';
const MIRA = 'ac_mira0001';
const RPG = { query: { 'rpg-battle.itemDetail': () => null }, widgets: { 'rpg-battle.item-detail': { render: () => ({ update() {}, destroy() {} }) } } };

function world() {
    const module = core();
    const state = stocked(module);
    state.domains.party = { pc: REN, order: [REN, MIRA], actors: { [REN]: { id: REN, name: 'Ren' }, [MIRA]: { id: MIRA, name: 'Mira' } } };
    const query = queries(module, state, { ...RPG.query, 'items.useOn': () => ({ it_pota0001: [{ id: MIRA }] }) });
    return { module, state, ...show(inventoryScreen, { state, query, widgets: RPG.widgets, draft: {} }) };
}
const trigger = (el, stack, kind) => foldButtons(el, stack).find(node => node.getAttribute('value') === kind);
const key = (node, name) => node.dispatch('keydown', { key: name });

test('the triggers are real buttons with aria-expanded and aria-controls; the fold row they name is there exactly while open', { skip }, () => {
    const { el, view } = world();
    assert.deepEqual(view.warnings, []);
    const triggers = foldButtons(el, 'it_sword001');
    assert.deepEqual(triggers.map(node => text(node)), ['Equip on…', 'Drop']);
    for (const node of triggers) {
        assert.equal(node.tagName.toLowerCase(), 'button', 'a button, not a styled radio');
        assert.equal(node.getAttribute('type'), 'button');
        assert.equal(node.getAttribute('aria-expanded'), 'false');
        assert.ok(node.getAttribute('aria-controls'));
    }
    assert.equal(el.querySelectorAll('input[type="radio"]').length, 0, 'no radio left, so no arrow key can change a fold');
    assert.equal(foldOf(el, 'it_sword001'), null, 'closed: no fold row');

    trigger(el, 'it_sword001', 'equipOn').click();
    const open = trigger(el, 'it_sword001', 'equipOn');
    assert.equal(open.getAttribute('aria-expanded'), 'true');
    const panel = el.querySelector(`[id="${open.getAttribute('aria-controls')}"]`);
    assert.ok(panel, 'the target of aria-controls is present while open');
    assert.equal(panel, foldOf(el, 'it_sword001'));
    assert.equal(trigger(el, 'it_sword001', 'drop').getAttribute('aria-expanded'), 'false', 'one fold per card');

    // A press on the open trigger closes it (a disclosure's toggle); a radio stayed checked.
    trigger(el, 'it_sword001', 'equipOn').click();
    assert.equal(trigger(el, 'it_sword001', 'equipOn').getAttribute('aria-expanded'), 'false');
    assert.equal(foldOf(el, 'it_sword001'), null);

    // Use on… is one too, on a consumable with a member to help.
    openFold(el, 'it_pota0001', 'use');
    assert.equal(trigger(el, 'it_pota0001', 'use').getAttribute('aria-expanded'), 'true');
});

test('Escape closes the open fold and the focus goes back to its button; Escape with nothing open is left to the window', { skip }, () => {
    const { el, doc } = world();
    // Nothing open: the key is not taken (the game view's Escape closes the window).
    const idle = trigger(el, 'it_sword001', 'drop');
    idle.focus();
    const free = key(idle, 'Escape');
    assert.equal(free.defaultPrevented, false);
    assert.equal(free.stopped, false);

    // Open on the button itself.
    idle.click();
    assert.equal(foldOf(el, 'it_sword001') !== null, true);
    idle.focus();
    const taken = key(idle, 'Escape');
    assert.equal(taken.defaultPrevented, true, 'taken');
    assert.equal(taken.stopped, true, 'and it stops there: the window around stays open');
    assert.equal(foldOf(el, 'it_sword001'), null, 'the fold is closed');
    assert.equal(doc.activeElement, trigger(el, 'it_sword001', 'drop'), 'the focus is on its button');

    // Open, the focus inside the fold row (on a member), then Escape: the button has the focus.
    trigger(el, 'it_sword001', 'equipOn').click();
    const member = foldOf(el, 'it_sword001').querySelector('.pick-member');
    member.focus();
    assert.equal(doc.activeElement, member);
    key(member, 'Escape');
    assert.equal(foldOf(el, 'it_sword001'), null);
    assert.equal(doc.activeElement, trigger(el, 'it_sword001', 'equipOn'), 'back on Equip on…, not dropped to the page');
    assert.equal(trigger(el, 'it_sword001', 'equipOn').getAttribute('aria-expanded'), 'false');

    // Other keys do nothing: arrow keys, Space and letters change no fold.
    trigger(el, 'it_sword001', 'drop').click();
    for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'x']) key(trigger(el, 'it_sword001', 'drop'), name);
    assert.equal(trigger(el, 'it_sword001', 'drop').getAttribute('aria-expanded'), 'true', 'still open');
    assert.equal(trigger(el, 'it_sword001', 'equipOn').getAttribute('aria-expanded'), 'false', 'and no other fold opened');
});

test('Cancel closes the fold and the focus goes back to the button that opened it', { skip }, () => {
    const { el, doc } = world();
    trigger(el, 'it_pota0001', 'use').click();
    const cancel = foldOf(el, 'it_pota0001').querySelector('.fold-cancel');
    assert.equal(cancel.tagName.toLowerCase(), 'button');
    cancel.focus();
    cancel.click();
    assert.equal(foldOf(el, 'it_pota0001'), null);
    assert.equal(doc.activeElement, trigger(el, 'it_pota0001', 'use'));
});

test('Tab order is the reading order: the card\'s buttons, then its fold row; nothing in the row is skipped or taken out of the order', { skip }, () => {
    const { el } = world();
    trigger(el, 'it_sword001', 'equipOn').click();
    const item = el.querySelectorAll('.item').find(row => row.querySelector('.name').textContent === 'Iron Sword');
    const order = item.querySelectorAll('button').map(node => text(node));
    assert.deepEqual(order, ['Equip', 'Equip on…', 'Drop', 'Ren', 'Mira', 'Cancel'].filter(name => order.includes(name)), 'actions first, then the fold row');
    assert.ok(order.indexOf('Ren') > order.indexOf('Drop'));
    for (const node of item.querySelectorAll('button')) assert.equal(node.getAttribute('tabindex'), null, 'no tabindex juggling');
});

test('the equipment kind filter: when RPG Battle goes and its option with it, the draft filter goes back to everything', { skip }, () => {
    const module = core();
    const state = stocked(module);
    const withRpg = queries(module, state, RPG.query);
    const draft = {};
    const { el, view } = show(inventoryScreen, { state, query: withRpg, widgets: RPG.widgets, draft });
    const select = () => el.querySelectorAll('select')[0];
    select().value = 'equipment';
    select().dispatch('change');
    assert.equal(draft.kind, 'equipment');
    assert.deepEqual(el.querySelectorAll('.group').map(group => group.getAttribute('data-kind')), ['equipment']);

    // RPG Battle is gone: the next draw has no equipment option, and the draft is reset instead of hiding every other kind.
    const without = queries(module, state);
    const data = resolveData(inventoryScreen.data, without);
    view.update({ state, q: data.q, query: without, draft: view.draft() });
    assert.equal(view.draft().kind, '', 'the filter is back to everything');
    assert.equal(draft.kind, '', 'in the draft the host holds, too');
    assert.equal(select().value, '');
    assert.ok(el.querySelectorAll('.group').map(group => group.getAttribute('data-kind')).length > 1 || el.querySelectorAll('.item').length > 0, 'the bag is listed again');
    assert.ok(!el.querySelectorAll('select')[0].querySelectorAll('option').some(option => option.getAttribute('value') === 'equipment'));
});
