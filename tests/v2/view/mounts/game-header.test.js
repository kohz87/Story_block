// The game view's header (UI stage 5a, mounts/screen.js): the lead and the scene above the screen, drawn with the ss.hero
// block from `heroOf(head state)`. It is there on open, follows the head, goes when there is no state, and is removed on close.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenMount } from '../../../../src/v2/view/mounts/screen.js';
import { createScreens } from '../../../../src/v2/view/screens.js';
import { fakeRenderer, setupDom, stateWith } from './helpers.js';

const screen = (id, title) => ({ id, title, icon: 'fa-star', mounts: ['screen'], template: `<p>${title}</p>` });

function setup({ heroOf, head, fight = false, phone = false }) {
    const doc = setupDom();
    let boardObserver;
    if (phone) doc.defaultView = {
        matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
        MutationObserver: class {
            constructor(callback) { this.callback = callback; boardObserver = this; }
            observe(target, options) { this.target = target; this.options = options; }
            disconnect() { this.disconnected = true; }
        },
    };
    const screens = createScreens({ reader: () => ({}), saveReader: () => {} });
    screens.addModule('test', [screen('test/one', 'One'), screen('test/two', 'Two')]);
    if (fight) screens.addModule('story-block', [screen('story-block/fight', 'Fight')]);
    const render = fakeRenderer();
    let current = head;
    const mount = createScreenMount({
        screens: { ...screens, list: mount => screens.list(mount) },
        render,
        head: () => current,
        query: () => null,
        api: {},
        heroOf,
        document: doc,
        container: () => doc.body,
    });
    return { doc, mount, render, observer: () => boardObserver, setHead: state => { current = state; }, close: () => mount.close() };
}

const LEAD = { name: 'Ren', className: '', level: 'Lv 4', title: 'ranger', bars: [{ kind: 'hp', label: 'HP', value: 20, max: 82, text: '20 / 82' }], place: 'Bluewatch Village', time: 'Day 1', weather: 'Drizzle', statuses: [], portrait: '' };

test('no header without a head state or without heroOf: the slot stays hidden and no class is set', () => {
    const none = setup({ heroOf: () => null, head: stateWith(1) });
    assert.equal(none.mount.open('test/one'), true);
    const slot = none.doc.querySelector('.ss-gameview-hero');
    assert.equal(slot.hidden, true);
    assert.equal(none.doc.querySelector('.ss-gameview').classList.contains('ss-gameview-has-hero'), false);
    none.close();

    const bare = setup({ heroOf: null, head: stateWith(1) });
    bare.mount.open('test/one');
    assert.equal(bare.doc.querySelector('.ss-gameview-hero').hidden, true);
    bare.close();
});

test('the header is drawn on open with the lead and the scene, and the screen is under it', () => {
    const calls = [];
    const env = setup({ heroOf: state => { calls.push(state.meta.rev); return LEAD; }, head: stateWith(3) });
    env.mount.open('test/one');
    const slot = env.doc.querySelector('.ss-gameview-hero');
    assert.equal(slot.hidden, false);
    assert.equal(env.doc.querySelector('.ss-gameview').classList.contains('ss-gameview-has-hero'), true);
    assert.equal(env.doc.querySelector('.ss-gameview-hero .ss-hero-name').textContent, 'Ren');
    assert.equal(env.doc.querySelector('.ss-gameview-hero .ss-hero-pill').textContent, 'ranger');
    assert.equal(env.doc.querySelector('.ss-gameview-hero .ss-hero-level-number').textContent, '4');
    assert.equal(env.doc.querySelector('.ss-gameview-hero .ss-hero-level .ss-visually-hidden').textContent, 'Lv 4');
    assert.deepEqual(calls, [3], 'read from the head state');
    assert.equal(env.doc.querySelector('.ss-gameview-body').querySelector('.drawn')?.textContent, 'test/one rev 3');
    env.close();
});

test('the header follows the head on a redraw, and a screen change keeps it', () => {
    const env = setup({ heroOf: state => ({ ...LEAD, name: `Ren ${state.meta.rev}` }), head: stateWith(3) });
    env.mount.open('test/one');
    env.setHead(stateWith(4));
    env.mount.update();
    assert.equal(env.doc.querySelector('.ss-gameview-hero .ss-hero-name').textContent, 'Ren 4');
    env.mount.open('test/two');
    assert.equal(env.doc.querySelector('.ss-gameview-hero .ss-hero-name').textContent, 'Ren 4');
    assert.equal(env.doc.querySelector('.ss-gameview-title').textContent, 'Two');
    env.close();
});

test('the phone hero offers More only while the board is present and resets after discard or navigation', () => {
    const env = setup({ heroOf: () => LEAD, head: stateWith(3), fight: true, phone: true });
    env.mount.open('test/one');
    const hero = () => env.doc.querySelector('.ss-gameview-hero .ss-hero');
    const more = () => env.doc.querySelector('.ss-hero-board-more');
    assert.ok(hero().classList.contains('ss-hero-compact'));
    assert.equal(more(), null);
    env.mount.open('story-block/fight');
    assert.equal(more(), null, 'the Fight screen alone does not open a board');
    const board = env.doc.querySelector('.ss-gameview-body .drawn');
    board.classList.add('rpg-board-active');
    env.observer().callback();
    assert.equal(more().hidden, false);
    more().click();
    assert.ok(!hero().classList.contains('ss-hero-compact'));
    board.classList.remove('rpg-board-active');
    board.classList.add('rpg-board-active');
    env.observer().callback();
    assert.ok(!hero().classList.contains('ss-hero-compact'), 'a board redraw preserves the open card');
    board.classList.remove('rpg-board-active');
    env.observer().callback();
    assert.equal(more(), null, 'discarding removes the control');
    assert.ok(hero().classList.contains('ss-hero-compact'), 'discarding restores the usual phone header');
    board.classList.add('rpg-board-active');
    env.observer().callback();
    assert.equal(more().getAttribute('aria-expanded'), 'false');
    more().click();
    env.mount.open('test/two');
    assert.equal(more(), null);
    assert.ok(hero().classList.contains('ss-hero-compact'));
    const observer = env.observer();
    env.close();
    assert.equal(observer.disconnected, true);
});

test('a header that stops (no chat) goes away on the next draw, and close removes the widget', () => {
    let props = LEAD;
    const env = setup({ heroOf: () => props, head: stateWith(3) });
    env.mount.open('test/one');
    assert.equal(env.doc.querySelector('.ss-gameview-hero').hidden, false);
    props = null;
    env.mount.update();
    assert.equal(env.doc.querySelector('.ss-gameview-hero').hidden, true);
    assert.equal(env.doc.querySelector('.ss-gameview-hero .ss-hero'), null, 'the widget is taken away');
    env.close();
    assert.equal(env.mount.isOpen(), false);
});

test('a header that throws is no header (the screen still opens)', () => {
    const env = setup({ heroOf: () => { throw new Error('no state'); }, head: stateWith(3) });
    assert.equal(env.mount.open('test/one'), true);
    assert.equal(env.doc.querySelector('.ss-gameview-hero').hidden, true);
    env.close();
});

test('a Travel row under the header while there is a trip line, gone when it ends, and none without one', () => {
    let travel = 'riding, 25 km/day (Burr sets the pace) · leg 1 of 2';
    const env = setup({ heroOf: () => ({ ...LEAD, ...(travel ? { travel } : {}), you: { wearing: 'a coat', condition: '', command: '' } }), head: stateWith(3) });
    env.mount.open('test/one');
    const row = () => env.doc.querySelector('.ss-gameview-hero .ss-hero-travel');
    assert.equal(row().hidden, false);
    assert.equal(row().querySelector('.ss-hero-you-label').textContent, 'Travel');
    assert.equal(row().querySelector('.ss-hero-travel-text').textContent, 'riding, 25 km/day (Burr sets the pace) · leg 1 of 2');
    const kids = [...env.doc.querySelector('.ss-hero-text').children].map(node => node.className.split(' ')[0]);
    assert.ok(kids.indexOf('ss-hero-travel') === kids.indexOf('ss-hero-you') + 1, 'under the Wearing and Condition rows');
    travel = '';
    env.mount.update();
    assert.equal(row().hidden, true);
    env.close();
    const bare = setup({ heroOf: () => LEAD, head: stateWith(3) });
    bare.mount.open('test/one');
    assert.equal(bare.doc.querySelector('.ss-gameview-hero .ss-hero-travel'), null, 'no trace without a trip');
    bare.close();
});
