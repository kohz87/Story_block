// Inline cards (SPEC §13.4): under each carrier, drawn from that reply's state, collapsed by default,
// per-screen opt-in, visible messages only, cached per (index, swipe, rev), redrawn on swipe/edit/delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changeSummary, createCardMount } from '../../../../src/v2/view/mounts/card.js';
import { fakeChat, fakeObserverClass, fakeQuery, fakeRenderer, screen, screensWith, setupDom } from './helpers.js';

function world({ revs = [1, 2, 3, 4], users = [], observer = null, cards = { 'm/sheet': true }, defs, extra = {} } = {}) {
    const doc = setupDom();
    const chat = fakeChat(doc, revs, { users });
    const render = fakeRenderer();
    const query = fakeQuery();
    const screens = screensWith(defs ?? [
        screen('m/sheet', ['card', 'tab'], { title: 'Sheet', data: { hp: { query: 'party.hp' } } }),
        screen('m/off', ['card']),
        screen('m/tab', ['tab']),
    ], { reader: { cards } });
    const deps = {
        screens,
        render,
        query,
        stateAt: chat.stateAt,
        headIndex: chat.headIndex,
        changesAt: chat.changesAt,
        carriers: chat.carriers,
        swipeAt: chat.swipeAt,
        messageElement: chat.messageElement,
        IntersectionObserver: observer,
        ...extra,
    };
    return { doc, chat, render, query, screens, deps, cards: createCardMount(deps) };
}

const cardsUnder = message => message.querySelectorAll('.ss-card');

test('a collapsed card under each carrier, only for screens the reader turned on', () => {
    const { chat, render, cards } = world({ users: [1] });
    cards.attachAll();
    assert.equal(cardsUnder(chat.messages[1]).length, 0, 'user messages carry nothing');
    for (const index of [0, 2, 3]) {
        const list = cardsUnder(chat.messages[index]);
        assert.deepEqual(list.map(card => card.getAttribute('data-ss-card')), ['m/sheet']);
        assert.equal(list[0].parentNode.parentNode, chat.messages[index].querySelector('.mes_block'));
        const head = list[0].querySelector('.ss-card-head');
        assert.equal(head.getAttribute('aria-expanded'), 'false');
        assert.equal(list[0].querySelector('.ss-card-body').hidden, true);
        assert.equal(list[0].querySelector('.ss-card-title').textContent, 'Sheet');
    }
    assert.equal(render.calls.length, 0, 'a collapsed card draws no body');
});

test('hasCard leaves a carrier without cards (the host: the greeting, a reply with no v2 record)', () => {
    const { chat, cards } = world({ users: [1], extra: { hasCard: index => index === 2 } });
    cards.attachAll();
    assert.equal(cardsUnder(chat.messages[0]).length, 0, 'the greeting');
    assert.equal(cardsUnder(chat.messages[2]).length, 1);
    assert.equal(cardsUnder(chat.messages[3]).length, 0);
    assert.equal(chat.messages[3].querySelector('.ss-cards'), null, 'no empty box either');
});

test('opening a card draws it with that reply\'s state and changed paths, not the head', () => {
    const { chat, render, query, cards } = world();
    cards.attachAll();
    const card = cardsUnder(chat.messages[1])[0];
    assert.equal(card.querySelector('[data-slot="summary"]').textContent, '', 'no raw count of changed paths');
    card.querySelector('.ss-card-head').click();
    assert.equal(card.querySelector('.ss-card-head').getAttribute('aria-expanded'), 'true');
    assert.equal(card.querySelector('.ss-card-body').hidden, false);
    const { scope, screen: drawn } = render.last();
    assert.equal(drawn.id, 'm/sheet');
    assert.equal(scope.state, chat.states[1]);
    assert.notEqual(scope.state, chat.states[3]);
    assert.deepEqual([scope.mount, scope.index], ['card', 1]);
    assert.deepEqual(scope.changes, ['/domains/party/hp', '/meta/rev']);
    assert.deepEqual(scope.q, { hp: 20 });
    assert.equal(query.calls.at(-1).state, chat.states[1]);
    assert.equal(card.querySelector('.drawn').textContent, 'm/sheet rev 2');

    // Closing keeps the body; opening again does not draw again.
    card.querySelector('.ss-card-head').click();
    assert.equal(card.querySelector('.ss-card-body').hidden, true);
    cards.toggle(1, 'm/sheet', true);
    assert.equal(render.calls.length, 1);
});

test('a swipe redraws the card with the new swipe\'s state; swiping back reuses the cache', () => {
    const { chat, render, cards } = world();
    cards.attachAll();
    cards.toggle(3, 'm/sheet', true);
    const first = cardsUnder(chat.messages[3])[0];
    assert.equal(render.last().scope.state.meta.rev, 4);

    chat.swipe(3, 7);
    cards.onSwipe(3);
    const second = cardsUnder(chat.messages[3])[0];
    assert.notEqual(second, first);
    assert.equal(second.querySelector('.ss-card-head').getAttribute('aria-expanded'), 'true', 'stays open across swipes');
    assert.equal(render.last().scope.state.meta.rev, 7);
    assert.equal(second.querySelector('.drawn').textContent, 'm/sheet rev 7');

    // Nothing changed since: the same node stays and nothing is drawn again.
    const draws = render.calls.length;
    cards.refresh(3);
    assert.equal(cardsUnder(chat.messages[3])[0], second);
    assert.equal(render.calls.length, draws);
});

test('cards are cached per (index, swipe, rev): the same key never draws twice', () => {
    const swipes = [0, 0, 0];
    const { chat, render, cards } = world({ revs: [1, 2, 3], extra: { swipeAt: index => swipes[index] } });
    cards.attachAll();
    cards.toggle(2, 'm/sheet', true);
    const a = cardsUnder(chat.messages[2])[0];
    swipes[2] = 1;
    chat.states[2] = Object.freeze({ ...chat.states[2], meta: { rev: 8, claims: {} } });
    cards.onSwipe(2);
    const b = cardsUnder(chat.messages[2])[0];
    assert.notEqual(a, b);
    swipes[2] = 0;
    chat.states[2] = Object.freeze({ ...chat.states[2], meta: { rev: 3, claims: {} } });
    cards.onSwipe(2);
    assert.equal(cardsUnder(chat.messages[2])[0], a, 'swiping back shows the cached card');
    assert.equal(render.calls.length, 2);
    assert.ok(cards.cacheSize() >= 4);
});

test('an edit forces a fresh draw; a delete or chat change forgets every index', () => {
    const { chat, render, cards } = world();
    cards.attachAll();
    cards.toggle(2, 'm/sheet', true);
    const before = cardsUnder(chat.messages[2])[0];
    cards.onEdit(2);
    const after = cardsUnder(chat.messages[2])[0];
    assert.notEqual(after, before);
    assert.equal(render.calls.length, 2);

    cards.onDelete();
    assert.equal(cardsUnder(chat.messages[2])[0].querySelector('.ss-card-head').getAttribute('aria-expanded'), 'false', 'open state is per index and forgotten');
    assert.equal(cardsUnder(chat.messages[2]).length, 1, 'no duplicate containers');
    assert.equal(chat.messages[2].querySelectorAll('.ss-cards').length, 1);
    cards.onChatChanged();
    assert.equal(chat.messages[2].querySelectorAll('.ss-cards').length, 1);
});

test('only visible messages are drawn when IntersectionObserver exists', () => {
    const Observer = fakeObserverClass();
    const { chat, cards } = world({ observer: Observer });
    cards.attachAll();
    const observer = Observer.instances[0];
    assert.equal(observer.targets.size, 4);
    assert.ok(chat.messages.every(message => cardsUnder(message).length === 0));
    assert.deepEqual(chat.reads, [], 'no state is built for messages off screen');
    observer.show(chat.messages[2]);
    assert.equal(cardsUnder(chat.messages[2]).length, 1);
    assert.equal(cardsUnder(chat.messages[0]).length, 0);
    assert.deepEqual([...new Set(chat.reads)], [2]);
    const shown = cardsUnder(chat.messages[2])[0];
    observer.show(chat.messages[2], false);
    chat.swipe(2, 9);
    cards.onSwipe(2);   // off screen now: not redrawn until it shows again
    assert.equal(cardsUnder(chat.messages[2])[0], shown);
    observer.show(chat.messages[2]);
    assert.notEqual(cardsUnder(chat.messages[2])[0], shown);
    cards.onDelete();
    assert.equal(Observer.instances[0].targets.size, 4, 're-observed after a delete');
});

test('turning a card screen off removes its cards; no screens means no container', () => {
    const { chat, screens, cards } = world();
    cards.attachAll();
    screens.setCards('m/off', true);
    cards.refreshAll();
    assert.deepEqual(cardsUnder(chat.messages[0]).map(card => card.getAttribute('data-ss-card')), ['m/off', 'm/sheet']);
    screens.setCards('m/off', false);
    screens.setCards('m/sheet', false);
    cards.refreshAll();
    assert.equal(chat.messages[0].querySelector('.ss-cards'), null);
});

test('SillyTavern events drive the cards when an eventSource is given', () => {
    const handlers = {};
    const eventSource = {
        on: (type, fn) => { (handlers[type] ??= []).push(fn); },
        removeListener: (type, fn) => { handlers[type] = handlers[type].filter(item => item !== fn); },
    };
    const eventTypes = { MESSAGE_SWIPED: 'swiped', MESSAGE_EDITED: 'edited', MESSAGE_DELETED: 'deleted', CHAT_CHANGED: 'chat', CHARACTER_MESSAGE_RENDERED: 'rendered' };
    const { chat, render, cards } = world({ extra: { eventSource, eventTypes } });
    handlers.rendered.forEach(fn => fn(3));
    assert.equal(cardsUnder(chat.messages[3]).length, 1);
    assert.equal(cardsUnder(chat.messages[2]).length, 0);
    cards.toggle(3, 'm/sheet', true);
    chat.swipe(3, 11);
    handlers.swiped.forEach(fn => fn(3));
    assert.equal(render.last().scope.state.meta.rev, 11);
    handlers.edited.forEach(fn => fn(3));
    assert.equal(render.calls.length, 3);
    cards.destroy();
    assert.equal(handlers.swiped.length, 0);
});

test('a custom summary, and the default one never counts changed paths', () => {
    assert.equal(changeSummary([]), 'No changes');
    assert.equal(changeSummary(['/meta/rev']), 'No changes');
    assert.equal(changeSummary(['/domains/a']), '');
    assert.equal(changeSummary(['/domains/a', '/domains/b', '/meta/rev']), '');
    const { chat, cards } = world({ extra: { summary: (scr, { index, state }) => `${scr.title} at ${index}: ${state.domains.party.hp} HP` } });
    cards.attachAll();
    assert.equal(cardsUnder(chat.messages[2])[0].querySelector('[data-slot="summary"]').textContent, 'Sheet at 2: 30 HP');
});

test('mount(el, id, { index }) draws one card body for that carrier', () => {
    const { doc, chat, render, cards } = world();
    const el = doc.createElement('div');
    const handle = cards.mount(el, 'm/sheet', { index: 0 });
    assert.equal(handle.result.ok, true);
    assert.equal(render.last().scope.state, chat.states[0]);
    assert.throws(() => createCardMount({ render() {} }), /carriers/);
});
