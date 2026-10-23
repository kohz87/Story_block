// The screen bar (UI stage 7, view/screen-bar.js): five slots on a phone (the first four screens in the reader's order, then
// More), the current one marked (aria-current, the accent by the CSS), More holding a current screen under it (its icon and
// label, its name says so), the wide row (every screen, no More), and the More sheet: it opens, takes the focus, keeps Tab
// inside, closes on Escape, a tap on the scrim or a tile, and the focus goes back to More.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PINNED, barItems, createScreenBar, moreHolds, splitItems } from '../../../src/v2/view/screen-bar.js';
import { STRINGS, fill } from '../../../src/v2/strings.js';
import { installDom, host } from './widgets/fake-dom.js';

const ITEMS = [
    { id: 'story-block/home', label: 'Home', icon: 'fa-house' },
    { id: 'story-block/party', label: 'Party', icon: 'fa-users' },
    { id: 'story-block/skills', label: 'Skills', icon: 'fa-wand-sparkles' },
    { id: 'story-block/bag', label: 'Bag', icon: 'fa-bag-shopping' },
    { id: 'story-director/world', label: 'World', icon: 'fa-globe' },
    { id: 'story-director/quests', label: 'Quests', icon: 'fa-scroll' },
    { id: 'rpg-battle/craft', label: 'Crafting', icon: 'fa-hammer' },
];
const LONG = 'A screen whose title runs well past seventy characters so that the bar has to cut it to one line';

function setup({ items = ITEMS, current = null, row = false, onSelect = null, decorate } = {}) {
    const doc = installDom();
    const root = host(doc);
    const chosen = [];
    const bar = createScreenBar(doc, root, {
        label: 'Screens',
        onSelect: id => { chosen.push(id); if (onSelect) onSelect(id); },
        ...(decorate ? { decorate } : {}),
    });
    bar.update({ items, current, row });
    // the slots: the bar's buttons other than More (More is the last one, hidden in the row)
    const slots = () => [...root.querySelectorAll('.ss-screenbar-item')].filter(node => !node.classList.contains('ss-screenbar-more'));
    const more = () => root.querySelector('.ss-screenbar-more');
    const sheet = () => root.querySelector('.ss-screenbar-sheet');
    const tiles = () => root.querySelectorAll('.ss-screenbar-tile');
    const docKeys = () => doc.docListeners.filter(entry => entry.type === 'keydown').length;
    return { doc, root, bar, chosen, slots, more, sheet, tiles, docKeys };
}
const names = nodes => nodes.map(node => node.getAttribute('data-id'));
const text = node => node.textContent;

test('the reader\'s order: the first four screens, then More (five slots); the rest are under More', () => {
    const { slots, more, root } = setup();
    assert.deepEqual(names(slots()), ITEMS.slice(0, PINNED).map(item => item.id));
    assert.equal(slots().length, 4, 'four slots and More');
    assert.equal(root.querySelectorAll('.ss-screenbar-item').at(-1), more(), 'More is the last slot');
    assert.equal(more().getAttribute('type'), 'button');
});

test('the split is pure: the first four in order, the rest under More, and what More holds', () => {
    const { pinned, more } = splitItems(ITEMS);
    assert.equal(pinned.length, 4);
    assert.deepEqual(more.map(item => item.id), ['story-director/world', 'story-director/quests', 'rpg-battle/craft']);
    assert.equal(moreHolds(ITEMS, 'story-director/quests')?.label, 'Quests');
    assert.equal(moreHolds(ITEMS, 'story-block/home'), null, 'a pinned screen is not held by More');
});

test('the labels: cut to one line in the bar, the full name as the title, an empty label takes the id', () => {
    const cut = barItems([{ id: 'x/long', label: LONG }, { id: '  ', label: 'no id' }, { id: 'x/none', label: '' }, { id: 'x/long', label: 'duplicate' }]);
    assert.deepEqual(cut.map(item => item.id), ['x/long', 'x/none']);
    assert.equal(cut[0].label, LONG);
    const { slots } = setup({ items: [{ id: 'x/long', label: LONG }, { id: 'x/b', label: 'B' }] });
    assert.equal(slots()[0].getAttribute('title'), LONG);
    assert.equal(text(slots()[0].querySelector('.ss-screenbar-label')), LONG, 'the CSS ellipsises, the text is whole (a reader can find it)');
});

test('the current screen: aria-current on its slot only, the dot inside it; More is not current', () => {
    const { slots, more } = setup({ current: 'story-block/party' });
    const current = slots().filter(node => node.getAttribute('aria-current') === 'page');
    assert.deepEqual(names(current), ['story-block/party']);
    assert.equal(more().getAttribute('aria-current'), null);
    assert.ok(current[0].classList.contains('ss-screenbar-current'));
    assert.equal(current[0].querySelector('.ss-screenbar-dot').getAttribute('aria-hidden'), 'true', 'the dot is decorative');
});

test('More holds a current screen: its icon and label, the current mark, and a name that says which screen it is', () => {
    const { more, root } = setup({ current: 'rpg-battle/craft' });
    assert.equal(more().getAttribute('aria-current'), 'page');
    assert.equal(more().getAttribute('aria-label'), fill(STRINGS.bar.moreWith, { title: 'Crafting' }));
    assert.equal(text(more().querySelector('.ss-screenbar-label')), 'Crafting', 'the slot shows the screen it holds');
    assert.ok(more().querySelector('.ss-screenbar-icon').classList.contains('fa-hammer'), 'and its icon');
    const tile = root.querySelector('.ss-screenbar-tile[data-id="rpg-battle/craft"]');
    assert.equal(tile.getAttribute('aria-current'), 'page', 'the tile in the sheet is current too');
});

test('More shows its own icon and the word More when nothing under it is current', () => {
    const { more } = setup({ current: 'story-block/home' });
    assert.equal(text(more().querySelector('.ss-screenbar-label')), 'More');
    assert.equal(more().querySelector('.ss-screenbar-icon').getAttribute('data-icon'), 'ph-dots-three-outline', 'the More icon');
    assert.equal(more().querySelector('.ss-screenbar-icon').getAttribute('data-weight'), 'regular', 'the line weight when not current');
    assert.equal(more().getAttribute('aria-label'), null);
});

test('every slot has an accessible name (its label text), More and the sheet are named and closed at first', () => {
    const { slots, more, sheet, root } = setup();
    for (const node of slots()) assert.ok(text(node).trim().length > 0, `${node.getAttribute('data-id')} has a name`);
    assert.equal(more().getAttribute('aria-expanded'), 'false');
    assert.equal(more().getAttribute('aria-controls'), sheet().id);
    assert.equal(sheet().getAttribute('role'), 'dialog');
    assert.equal(sheet().getAttribute('aria-modal'), 'true');
    assert.equal(sheet().getAttribute('aria-label'), STRINGS.bar.moreSheet);
    assert.equal(sheet().hidden, true);
    assert.equal(root.querySelector('.ss-screenbar-scrim').hidden, true);
});

test('the hint in the sheet names the number of pinned screens', () => {
    const { root } = setup();
    assert.equal(text(root.querySelector('.ss-screenbar-sheet-hint')), 'Pin your 4 in Settings → Tabs');
});

test('a tap on a slot chooses that screen; a current slot is still chosen', () => {
    const { slots, chosen } = setup({ current: 'story-block/home' });
    slots()[1].click();
    slots()[0].click();
    assert.deepEqual(chosen, ['story-block/party', 'story-block/home']);
});

test('More opens the sheet with the rest in a grid; the current tile is focused; Escape closes and returns the focus to More', () => {
    const { doc, more, sheet, tiles, bar, chosen } = setup({ current: 'story-director/quests' });
    more().click();
    assert.equal(bar.isMoreOpen(), true);
    assert.equal(more().getAttribute('aria-expanded'), 'true');
    assert.equal(sheet().hidden, false);
    assert.deepEqual(names(tiles()), ['story-director/world', 'story-director/quests', 'rpg-battle/craft']);
    assert.equal(doc.activeElement.getAttribute('data-id'), 'story-director/quests', 'the focus goes to the current tile');
    doc.fire('keydown', { key: 'Escape' });
    assert.equal(bar.isMoreOpen(), false);
    assert.equal(sheet().hidden, true);
    assert.equal(more().getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, more(), 'the focus returns to More');
    assert.deepEqual(chosen, [], 'closing chooses nothing');
});

test('Escape when the sheet is closed is not taken (the game view keeps it)', () => {
    const { doc } = setup();
    const event = doc.fire('keydown', { key: 'Escape' });
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, false);
});

test('a tile opens its screen: the sheet closes, the focus goes back to More, the screen is chosen once', () => {
    const { doc, more, tiles, sheet, chosen } = setup();
    more().click();
    tiles()[2].click();
    assert.deepEqual(chosen, ['rpg-battle/craft']);
    assert.equal(sheet().hidden, true);
    assert.equal(doc.activeElement, more());
});

test('Tab stays inside the sheet: it wraps from the last tile to the first, and Shift+Tab from the first to the last', () => {
    const { doc, more, tiles } = setup();
    more().click();
    doc.activeElement = tiles().at(-1);
    const forward = doc.fire('keydown', { key: 'Tab', shiftKey: false });
    assert.equal(forward.defaultPrevented, true);
    assert.equal(doc.activeElement, tiles()[0], 'wrapped to the first tile');
    const back = doc.fire('keydown', { key: 'Tab', shiftKey: true });
    assert.equal(back.defaultPrevented, true);
    assert.equal(doc.activeElement, tiles().at(-1), 'and back to the last');
});

test('a tap on the scrim closes the sheet and gives the focus back to More', () => {
    const { doc, more, root, sheet } = setup();
    more().click();
    root.querySelector('.ss-screenbar-scrim').click();
    assert.equal(sheet().hidden, true);
    assert.equal(doc.activeElement, more());
});

test('More toggles: a second press closes the sheet', () => {
    const { more, sheet } = setup();
    more().click();
    assert.equal(sheet().hidden, false);
    more().click();
    assert.equal(sheet().hidden, true);
});

test('a slot tapped while the sheet is open closes it and chooses the slot (the focus stays where the reader tapped)', () => {
    const { doc, more, slots, sheet, chosen } = setup();
    more().click();
    slots()[0].click();
    assert.equal(sheet().hidden, true);
    assert.deepEqual(chosen, ['story-block/home']);
    assert.notEqual(doc.activeElement, more());
});

test('an empty More says so, and a sheet with tiles does not', () => {
    const { root, more } = setup({ items: ITEMS.slice(0, 3) });
    more().click();
    assert.equal(root.querySelector('.ss-screenbar-empty').hidden, false);
    const full = setup();
    full.more().click();
    assert.equal(full.root.querySelector('.ss-screenbar-empty').hidden, true);
});

test('the wide row: every screen in one row, no More, the sheet never opens', () => {
    const { bar, slots, more, root, sheet } = setup({ row: true, current: 'story-director/world' });
    assert.equal(slots().length, ITEMS.length, 'each screen is a slot');
    assert.deepEqual(names(slots()), ITEMS.map(item => item.id));
    assert.equal(more().hidden, true, 'More is not drawn in the row');
    assert.equal(root.querySelector('.ss-screenbar').classList.contains('ss-screenbar-row'), true);
    assert.equal(bar.openMore(), false);
    assert.equal(sheet().hidden, true);
    assert.equal(slots().filter(node => node.getAttribute('aria-current') === 'page').length, 1);
});

test('switching from the pill to the row closes an open sheet (the focus stays on More)', () => {
    const { bar, more, sheet } = setup();
    more().click();
    bar.update({ items: ITEMS, current: null, row: true });
    assert.equal(sheet().hidden, true);
    assert.equal(bar.isMoreOpen(), false);
});

test('the decorate hook marks each slot and each tile (the Story panel\'s names)', () => {
    const { root, more } = setup({ decorate: (node, item) => { node.classList.add('story-suite-tab'); node.setAttribute('data-tab-id', item.id); } });
    assert.equal(root.querySelectorAll('.story-suite-tab').length, 7, 'the four slots and the three tiles (drawn, hidden until More opens)');
    more().click();
    assert.equal(root.querySelectorAll('.story-suite-tab').length, 7);
    assert.equal(root.querySelector('.story-suite-tab[data-tab-id="rpg-battle/craft"]').getAttribute('data-tab-id'), 'rpg-battle/craft');
});

test('the bar is named and in the host, the sheet and scrim beside it; destroy leaves nothing behind', () => {
    const { bar, root, docKeys, more } = setup();
    assert.equal(root.querySelector('nav.ss-screenbar').getAttribute('aria-label'), 'Screens');
    assert.equal(root.querySelectorAll('.ss-screenbar-sheet').length, 1);
    more().click();
    assert.equal(docKeys(), 1, 'an open sheet listens for the keys');
    bar.destroy();
    assert.equal(docKeys(), 0, 'and stops when the bar goes');
    assert.equal(root.querySelectorAll('.ss-screenbar').length, 0);
});

test('an update keeps the slot buttons (a focused slot keeps its focus across a redraw)', () => {
    const { bar, slots, doc } = setup({ current: 'story-block/home' });
    const before = slots()[1];
    doc.activeElement = before;
    bar.update({ items: ITEMS, current: 'story-block/party' });
    assert.equal(slots()[1], before, 'the same element');
    assert.equal(doc.activeElement, before);
    assert.equal(before.getAttribute('aria-current'), 'page');
});

test('the icons: the current slot draws the solid weight of its Phosphor icon, the others the line weight', () => {
    const items = [{ id: 'story-block/home', label: 'Home', icon: 'ph-house' }, { id: 'story-block/party', label: 'Party', icon: 'ph-users-three' }];
    const { slots } = setup({ items, current: 'story-block/party' });
    const [home, party] = slots().map(node => node.querySelector('.ss-screenbar-icon'));
    assert.equal(home.getAttribute('data-icon'), 'ph-house');
    assert.equal(home.getAttribute('data-weight'), 'regular');
    assert.equal(party.getAttribute('data-weight'), 'fill', 'solid for the current one');
});

test('a held screen under More: More draws its icon in the solid weight', () => {
    const { more } = setup({ current: 'rpg-battle/craft' });
    assert.ok(more().querySelector('.ss-screenbar-icon').classList.contains('fa-hammer'), 'a Font Awesome icon from a module draws as before');
});
