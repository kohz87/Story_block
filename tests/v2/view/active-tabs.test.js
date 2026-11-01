// Tabs and screens shown only while active (fix 8e): `active(state, ctx) → { on, badge? }`. Off, a screen is off the bar, the More
// sheet and the desktop row, and still opens by id; on with an alert, it takes the last pinned slot on a phone (the one it displaces
// goes to More) and shows a red dot. Settings says "shown only while active" instead of a switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeNow } from '../../../src/v2/view/mounts/common.js';
import { createScreenMount } from '../../../src/v2/view/mounts/screen.js';
import { PINNED, barItems, pinAlerts } from '../../../src/v2/view/screen-bar.js';
import { validateScreen } from '../../../src/v2/view/screens.js';
import { fakeApi, fakeChat, fakeQuery, fakeRenderer, screen, screensWith, setupDom } from './mounts/helpers.js';

test('activeNow: no active is always on; the answer is read; a failing answer is off; a badge is an alert', () => {
    assert.deepEqual(activeNow({}, null), { on: true, alert: false });
    assert.deepEqual(activeNow({ active: () => ({ on: true }) }, null), { on: true, alert: false });
    assert.deepEqual(activeNow({ active: () => ({ on: true, badge: 'alert' }) }, null), { on: true, alert: true, badge: 'alert' });
    assert.deepEqual(activeNow({ active: () => ({ on: true, badge: 3 }) }, null), { on: true, alert: true, badge: '3' }, 'a count is an alert too');
    assert.deepEqual(activeNow({ active: () => ({ on: false, badge: 'alert' }) }, null), { on: false, alert: false }, 'off has no alert');
    assert.deepEqual(activeNow({ active: () => { throw new Error('boom'); } }, null), { on: false, alert: false });
    let seen = null;
    activeNow({ active: (state, ctx) => { seen = [state, ctx.query('party.hp', { a: 1 })]; return { on: true }; } }, { v: 2 }, (name, args, state) => ({ name, args, v: state.v }));
    assert.deepEqual(seen, [{ v: 2 }, { name: 'party.hp', args: { a: 1 }, v: 2 }], 'the state it is asked about, and the queries at that state');
});

test('the bar: an alert tab takes the last pinned slot and the item it displaces goes to More; without an alert the order is kept', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, label: id, icon: '', alert: false }));
    assert.deepEqual(pinAlerts(items).map(item => item.id), ['a', 'b', 'c', 'd', 'e', 'f'], 'no alert, no change');
    const withAlert = items.map(item => (item.id === 'e' ? { ...item, alert: true } : item));
    const pinned = pinAlerts(withAlert);
    assert.deepEqual(pinned.map(item => item.id), ['a', 'b', 'c', 'e', 'd', 'f'], 'e takes the 4th slot, d goes to More');
    assert.equal(barItems(pinned)[3].alert, true, 'the alert survives the bar\'s own cleaning');
    assert.deepEqual(pinAlerts(items.map(item => (item.id === 'a' ? { ...item, alert: true } : item))).map(item => item.id), ['a', 'b', 'c', 'd', 'e', 'f'], 'an alert already pinned stays put');
    assert.equal(PINNED, 4);
});

test('validateScreen: active must be a function and activeNote text', () => {
    const base = { id: 'rpg-battle/fight', title: 'Fight', mounts: ['screen'], template: '<p>x</p>' };
    assert.deepEqual(validateScreen({ ...base, active: () => ({ on: true }), activeNote: 'Shown during battles.' }), []);
    assert.match(validateScreen({ ...base, active: 'yes' }).join(' / '), /active must be a function/);
    assert.match(validateScreen({ ...base, activeNote: 3 }).join(' / '), /activeNote must be text/);
});

test('validateScreen: a card\'s own summary must be a function', () => {
    const base = { id: 'm/status', title: 'Where things stand', mounts: ['card'], template: '<p>x</p>' };
    assert.deepEqual(validateScreen({ ...base, summary: () => '1:30 pm' }), []);
    assert.match(validateScreen({ ...base, summary: '1:30 pm' }).join(' / '), /summary must be a function/);
});

function world(battle) {
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 5]);
    const screens = screensWith([
        screen('game/home', ['screen'], { title: 'Home', icon: 'fa-house' }),
        screen('game/party', ['screen'], { title: 'Party', icon: 'fa-users' }),
        screen('game/bag', ['screen'], { title: 'Bag', icon: 'fa-bag-shopping' }),
        screen('game/map', ['screen'], { title: 'Map', icon: 'fa-map' }),
        screen('game/quests', ['screen'], { title: 'Quests', icon: 'fa-scroll' }),
        screen('game/fight', ['screen'], { title: 'Fight', icon: 'fa-khanda', active: () => (battle.on ? { on: true, badge: battle.badge } : { on: false }), activeNote: 'Shown only during a battle.' }),
    ]);
    const view = createScreenMount({ screens, render: fakeRenderer(), query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api: fakeApi(), document: doc });
    view.open('game/home');
    return { doc, view, screens };
}
const listed = doc => doc.body.querySelector('.ss-gameview').querySelectorAll('[data-ss-target]').map(node => node.getAttribute('data-ss-target'));

test('off: the screen is not on the bar, the More sheet or the row, and it still opens by id', () => {
    const battle = { on: false };
    const { doc, view } = world(battle);
    assert.equal(listed(doc).includes('game/fight'), false);
    assert.equal(view.open('game/fight'), true, 'opened by id even while off');
    assert.equal(view.current(), 'game/fight');
    view.close();
});

test('on with an alert: it shows in the pinned slot with a red dot; the item it displaced is under More; off again, it goes', () => {
    const slots = doc => doc.body.querySelector('.ss-gameview').querySelectorAll('.ss-screenbar-item').map(node => node.getAttribute('data-id')).filter(id => id);
    // The same screens with no alert first: where each one sits, and what holds the fourth slot (that one goes to More).
    const calm = world({ on: true, badge: null });
    calm.view.update();
    const before = slots(calm.doc);
    calm.view.close();
    const battle = { on: true, badge: 'alert' };
    const { doc, view } = world(battle);
    view.update();
    const pinned = slots(doc);
    assert.equal(pinned[3], 'game/fight', 'the last pinned slot');
    assert.deepEqual(pinned.slice(0, 3), before.filter(id => id !== 'game/fight').slice(0, 3), 'the first three keep their order');
    assert.equal(pinned.length, 4, 'four pinned, the rest under More');
    const displaced = before.filter(id => id !== 'game/fight')[3];
    assert.equal(pinned.includes(displaced), false, `${displaced}, the one that held the slot, is under More`);
    const fight = doc.body.querySelector('.ss-gameview').querySelector('[data-id="game/fight"]');
    assert.ok(fight.querySelector('.ss-screenbar-alert'), 'the red dot');
    assert.equal(doc.body.querySelector('.ss-gameview').querySelector(`[data-id="${displaced}"]`)?.querySelector('.ss-screenbar-alert') ?? null, null);
    battle.on = false;
    view.update();
    assert.equal(listed(doc).includes('game/fight'), false, 'gone once it is off');
    view.close();
});

test('on without an alert: it shows in its own place, with no dot', () => {
    const battle = { on: true, badge: null };
    const { doc, view } = world(battle);
    view.update();
    assert.ok(listed(doc).includes('game/fight'));
    assert.equal(doc.body.querySelector('.ss-gameview').querySelector('[data-id="game/fight"]').querySelector('.ss-screenbar-alert'), null);
    view.close();
});

// A screen opened by name while its `active` is off (a card's open, or code) was titled with its raw id and sent Home by the next update (fix 8k).
test('off but opened by name: titled from its definition, kept through updates, and dropped only after the reader leaves it', () => {
    const battle = { on: false };
    const { doc, view, screens } = world(battle);
    assert.equal(view.open('game/fight'), true);
    const title = () => doc.body.querySelector('.ss-gameview-title').textContent;
    assert.equal(title(), 'Fight', 'the screen\'s title, not its id');
    view.update();
    view.update();
    assert.equal(view.current(), 'game/fight', 'the next update does not send it Home');
    assert.equal(title(), 'Fight');
    // The reader goes to Home; then the fight screen is gone from view and a later update does not bring it back.
    doc.body.querySelector('.ss-gameview').querySelector('[data-ss-target="game/home"]').click();
    assert.equal(view.current(), 'game/home');
    view.update();
    assert.equal(view.current(), 'game/home');
    // Opened by name again, then the screen stops being openable (its module goes): the view falls back to the first screen.
    view.open('game/fight');
    assert.equal(view.current(), 'game/fight');
    screens.removeModule('test');
    screens.addModule('test', [screen('game/home', ['screen'], { title: 'Home', icon: 'fa-house' })]);
    view.update();
    assert.equal(view.current(), 'game/home', 'a screen that can no longer be shown is dropped');
    view.close();
});

// `badge: 0` read as an alert (it is not null, undefined or false), and the dot said nothing to a screen reader (fix 8k).
test('a badge of 0, an empty text, NaN or an object is no alert; text, a count above 0 and true are; the words are kept for the slot\'s name', () => {
    const alertOf = badge => activeNow({ active: () => ({ on: true, badge }) }, null);
    for (const none of [0, '', '   ', NaN, -1, false, null, undefined, {}, []]) assert.deepEqual(alertOf(none), { on: true, alert: false }, `badge ${JSON.stringify(none)}`);
    assert.deepEqual(alertOf('Your   move'), { on: true, alert: true, badge: 'Your move' });
    assert.deepEqual(alertOf(2), { on: true, alert: true, badge: '2' });
    assert.deepEqual(alertOf(true), { on: true, alert: true, badge: '' });
    assert.equal(alertOf('x'.repeat(100)).badge.length, 40, 'cut to one short line');
});

test('the slot of an alerting tab says it: "Fight, your move" (or "Fight, alert"); a slot without an alert keeps its plain name', () => {
    const battle = { on: true, badge: 'your move' };
    const { doc, view } = world(battle);
    view.update();
    const slot = id => doc.body.querySelector('.ss-gameview').querySelector(`.ss-screenbar-item[data-id="${id}"]`);
    assert.equal(slot('game/fight').getAttribute('aria-label'), 'Fight, your move');
    assert.equal(slot('game/fight').getAttribute('title'), 'Fight, your move');
    assert.ok(slot('game/fight').querySelector('.ss-screenbar-alert'), 'the dot is drawn');
    assert.equal(slot('game/fight').querySelector('.ss-screenbar-alert').textContent, '', 'a dot, not a number');
    const plain = doc.body.querySelector('.ss-gameview').querySelectorAll('.ss-screenbar-item').find(node => node.getAttribute('data-id') && node.getAttribute('data-id') !== 'game/fight');
    assert.equal(plain.getAttribute('aria-label'), null);
    assert.equal(plain.getAttribute('title'), plain.querySelector('.ss-screenbar-label').textContent);
    battle.badge = 3;
    view.update();
    assert.equal(slot('game/fight').getAttribute('aria-label'), 'Fight, 3', 'a count is said, not drawn');
    battle.badge = true;
    view.update();
    assert.equal(slot('game/fight').getAttribute('aria-label'), 'Fight, alert');
    battle.badge = 0;
    view.update();
    assert.equal(slot('game/fight').querySelector('.ss-screenbar-alert'), null, 'badge 0 is no alert: no dot');
    assert.equal(slot('game/fight').getAttribute('aria-label'), null);
    view.close();
});
