// Cards under replies (fix 8e, reply-cards.js and WIDGETS.md "Cards under replies"): a card read from a module's answer, asked once on the
// head reply's state and drawn under the head (fix 8k; before, the first message that answered kept it), the registry takes `cards` and refuses one that is not an
// object or has no `for`, and the viewer's Later state is kept per key and never throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_ACTIONS_MAX, CARD_ROWS_MAX, laterStore, normalizeCard, scanReplyCards } from '../../src/v2/reply-cards.js';
import { createRegistry, definitionProblems } from '../../src/v2/registry.js';

test('normalizeCard: a card with a title; tones, icons and the lists cleaned; no title, no card', () => {
    assert.equal(normalizeCard({ text: 'no title' }), null);
    assert.equal(normalizeCard('x'), null);
    const card = normalizeCard({
        title: 'Start your adventure', tone: 'purple', icon: 'fa-skull" onclick="x', text: 'Make your character.',
        rows: [{ text: 'Race' }, { icon: 'ph-star', text: 'Talents', tag: 'new', tagTone: 'good' }, { text: '' }, ...Array.from({ length: 9 }, (_, n) => ({ text: `r${n}` }))],
        actions: [
            { label: 'Create character', command: 'creation.start', primary: true, payload: { mode: 'quick' } },
            { label: 'Open the party', open: 'rpg-battle/party', icon: 'ph-users' },
            { label: 'No target' },
            { label: 'Bad command', command: 'drop table' },
            { label: 'Bad screen', open: 'x y' },
            { label: 'Extra one', command: 'a.b' },
            { label: 'Last', command: 'a.c' },
        ],
        later: true,
    });
    assert.equal(card.tone, 'info', 'an unknown tone is info');
    assert.equal(card.icon, 'ph-star', 'an icon that is not a ph- or fa- name is replaced');
    assert.equal(card.rows.length, CARD_ROWS_MAX);
    assert.deepEqual(card.rows[1], { icon: 'ph-star', text: 'Talents', tag: 'new', tagTone: 'good' });
    assert.equal(card.actions.length, CARD_ACTIONS_MAX, 'at most three buttons');
    assert.deepEqual(card.actions.map(action => action.label), ['Create character', 'Open the party', 'Extra one']);
    assert.equal(card.actions[0].primary, true);
    assert.deepEqual(card.actions[0].payload, { mode: 'quick' });
    assert.equal(card.actions[1].open, 'rpg-battle/party');
    assert.equal(card.later, true);
    assert.equal(normalizeCard({ title: 'Battle', tone: 'bad' }).later, false, 'later is off unless the card says so');
});

test('scanReplyCards: each card is asked once, on the head reply only, and an answer puts the card under the head (older replies carry none)', () => {
    const asked = [];
    const entries = [
        { id: 'rpg-battle/start', fn: (state, message, ctx) => { asked.push(['start', ctx.index, ctx.head, state.v, message.mes]); return state.made ? null : { title: 'Start' }; } },
        { id: 'rpg-battle/battle', fn: (state, message, ctx) => { asked.push(['battle', ctx.index]); return state.fighting ? { title: 'Battle', tone: 'bad' } : null; } },
        { id: 'rpg-battle/broken', fn: () => { throw new Error('no'); } },
        { id: 'rpg-battle/none', fn: () => 'not a card' },
    ];
    // Message 0 (the greeting) had a fight state and no character; the head (4) has a character and a second fight.
    const states = { 0: { v: 'g', fighting: true }, 2: { v: 'b', fighting: true }, 4: { v: 'c', made: true, fighting: true } };
    const stateAsked = [];
    const ended = [];
    const scan = scanReplyCards(entries, {
        head: 4,
        messageAt: index => ({ mes: `m${index}` }),
        stateAt: index => { stateAsked.push(index); return states[index]; },
        query: (name, args, state) => ({ name, args, v: state.v }),
        chatId: 'chat-1',
        onEnded: id => ended.push(id),
    });
    assert.deepEqual([...scan.keys()], [4], 'cards sit under the head reply and nowhere else');
    assert.deepEqual(scan.get(4).map(item => item.key), ['rpg-battle/battle'], 'the start card ended (a character exists); the battle card is under the head, not the first fight');
    assert.equal(scan.get(4)[0].card.tone, 'bad');
    assert.deepEqual(asked, [['start', 4, true, 'c', 'm4'], ['battle', 4]], 'each card asked once, with the head\'s state and message');
    assert.deepEqual(stateAsked, [4], 'the head state is worked out once and shared by every card');
    assert.deepEqual(ended, ['rpg-battle/start', 'rpg-battle/none'], 'a card that answered without a card is told as ended; a card that throws is not');
});

test('scanReplyCards: no head, no cards; one module\'s unreadable card never stops the others', () => {
    const entries = [{ id: 'm/a', fn: () => ({ title: 'A' }) }];
    assert.equal(scanReplyCards(entries, { head: -1, stateAt: () => ({}) }).size, 0, 'a chat with no reply');
    assert.equal(scanReplyCards(entries, { stateAt: () => ({}) }).size, 0, 'no head given');
    assert.equal(scanReplyCards(entries, { head: 2, stateAt: () => { throw new Error('gone'); } }).size, 0, 'a state that cannot be read');
    const hostile = { get title() { throw new Error('boom'); } };
    const scan = scanReplyCards([
        { id: 'm/bad', fn: () => hostile },
        { id: 'm/odd', fn: () => ({ title: Object.create(null) }) },
        { id: 'm/ok', fn: () => ({ title: 'Fine' }) },
    ], { head: 1, stateAt: () => ({}) });
    assert.deepEqual(scan.get(1).map(item => item.key), ['m/ok'], 'normalizeCard is inside the per-card try');
});

test('scanReplyCards: the context carries the head index, head: true, the chat and a query against the head\'s state', () => {
    let seen = null;
    scanReplyCards([{ id: 'm/c', fn: (state, message, ctx) => { seen = { ctx, answer: ctx.query('party.hp', { x: 1 }) }; return { title: 'T' }; } }], {
        head: 3,
        stateAt: () => ({ v: 9 }),
        query: (name, args, state) => ({ name, args, v: state.v }),
        chatId: 'c',
    });
    assert.equal(seen.ctx.index, 3);
    assert.equal(seen.ctx.head, true);
    assert.equal(seen.ctx.chatId, 'c');
    assert.deepEqual(seen.answer, { name: 'party.hp', args: { x: 1 }, v: 9 });
});

test('the registry takes `cards` and lists them as <module>/<card>; a card that is not an object, or has no `for`, is a problem', () => {
    assert.deepEqual(definitionProblems({ id: 'rpg-battle', cards: { start: { for: () => null } } }), []);
    assert.match(definitionProblems({ id: 'rpg-battle', cards: { start: 'x' } }).join(' / '), /card "start" is not an object/);
    assert.match(definitionProblems({ id: 'rpg-battle', cards: { start: {} } }).join(' / '), /card "start" for is not a function/);
    const registry = createRegistry();
    registry.register({ id: 'rpg-battle', cards: { start: { for: () => ({ title: 'Start' }) }, battle: { for: () => null } } });
    assert.deepEqual(registry.cardEntries().map(entry => [entry.moduleId, entry.id]), [['rpg-battle', 'rpg-battle/start'], ['rpg-battle', 'rpg-battle/battle']]);
    assert.equal(typeof registry.cardEntries()[0].fn, 'function');
});

test('laterStore: per key, kept in the storage; a storage that throws or holds junk is read as nothing folded', () => {
    const memory = new Map();
    const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
    const store = laterStore(storage);
    assert.equal(store.has('c|4|rpg-battle/battle'), false);
    store.set('c|4|rpg-battle/battle', true);
    assert.equal(laterStore(storage).has('c|4|rpg-battle/battle'), true, 'kept for the next page load');
    store.set('c|4|rpg-battle/battle', false);
    assert.equal(store.has('c|4|rpg-battle/battle'), false);
    const broken = laterStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    assert.equal(broken.has('x'), false);
    assert.doesNotThrow(() => broken.set('x', true));
    assert.equal(laterStore({ getItem: () => '[1,2]', setItem() {} }).has('x'), false, 'junk is not a folded card');
    assert.equal(laterStore(undefined).has('x'), false, 'no storage at all');
});

test('laterStore: a browser that refuses `localStorage` (the getter throws) reads as nothing folded and never throws', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
    try {
        const store = laterStore();
        assert.equal(store.has('c|m/c'), false);
        store.set('c|m/c', true);
        assert.equal(store.has('c|m/c'), true, 'the choice lasts this page');
    } finally {
        if (real) Object.defineProperty(globalThis, 'localStorage', real);
        else delete globalThis.localStorage;
    }
});

test('normalizeCard: an action\'s payload is plain JSON (a copy); one that cannot be copied is {}', () => {
    const loop = { a: 1 };
    loop.self = loop;
    const source = { n: { deep: true }, drop: undefined };
    const card = normalizeCard({ title: 'T', actions: [{ label: 'A', command: 'a.b', payload: loop }, { label: 'B', command: 'a.c', payload: source }, { label: 'C', command: 'a.d', payload: [1] }] });
    assert.deepEqual(card.actions[0].payload, {});
    assert.deepEqual(card.actions[1].payload, { n: { deep: true } });
    assert.notEqual(card.actions[1].payload, source, 'a copy: the module\'s object is not shared');
    assert.deepEqual(card.actions[2].payload, {}, 'a list is no payload');
});
