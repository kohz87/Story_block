// The game view on a wide screen is a window over a scrim (from 760px): a click on the scrim closes it, a press that began
// in the window does not, and the page behind is locked while it is open (the body's class; the CSS holds it still).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenMount } from '../../../../src/v2/view/mounts/screen.js';
import { fakeApi, fakeChat, fakeQuery, fakeRenderer, screensWith, setupDom } from './helpers.js';

function world() {
    const doc = setupDom();
    const chat = fakeChat(doc, [1]);
    const screens = screensWith([
        { id: 'game/home', title: 'Home', icon: 'fa-house', mounts: ['screen'], template: '<p>Home</p>' },
    ]);
    const view = createScreenMount({ screens, render: fakeRenderer(), query: fakeQuery(), stateAt: chat.stateAt, headIndex: chat.headIndex, api: fakeApi(), document: doc });
    return { doc, view };
}

test('a click on the scrim closes the window; a press that started in the window does not', () => {
    const { doc, view } = world();
    view.open('game/home');
    const root = doc.body.querySelector('.ss-gameview');
    const main = root.querySelector('.ss-gameview-main');
    assert.ok(main, 'the window is the main');
    // a press starting in the window and ending on the scrim is no click on the scrim
    main.dispatch('pointerdown', {});
    root.dispatch('pointerdown', { target: root });
    root.dispatch('click', { target: root });
    assert.equal(view.isOpen(), false, 'a press and click on the scrim closes it');
    view.open('game/home');
    const again = doc.body.querySelector('.ss-gameview');
    again.querySelector('.ss-gameview-main').dispatch('pointerdown', {});
    again.dispatch('click', { target: again.querySelector('.ss-gameview-main') });
    assert.equal(view.isOpen(), true, 'a click inside the window keeps it open');
    view.destroy();
});

test('the page behind is locked while the game view is open, and unlocked when it closes', () => {
    const { doc, view } = world();
    assert.equal(doc.body.classList.contains('ss-gameview-open'), false);
    view.open('game/home');
    assert.equal(doc.body.classList.contains('ss-gameview-open'), true);
    view.close();
    assert.equal(doc.body.classList.contains('ss-gameview-open'), false);
});
