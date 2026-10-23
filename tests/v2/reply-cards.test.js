// Cards under replies (fix 8e, reply-cards.js and WIDGETS.md "Cards under replies"): a card read from a module's answer, the first
// assistant message that answers gets it (one card per id per chat), the registry takes `cards` and refuses one that is not an
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

test('scanReplyCards: each card asks the assistant messages oldest first, and the first that answers gets it (one per id)', () => {
    const asked = [];
    const entries = [
        { id: 'rpg-battle/start', fn: (state, message, ctx) => { asked.push(['start', ctx.index, state.v, message.mes]); return ctx.index === 0 ? { title: 'Start' } : null; } },
        { id: 'rpg-battle/battle', fn: (state, message, ctx) => { asked.push(['battle', ctx.index]); return ctx.index >= 2 ? { title: 'Battle', tone: 'bad' } : null; } },
        { id: 'rpg-battle/broken', fn: () => { throw new Error('no'); } },
        { id: 'rpg-battle/none', fn: () => 'not a card' },
    ];
    const states = { 0: { v: 'g' }, 2: { v: 'b' }, 4: { v: 'c' } };
    const scan = scanReplyCards(entries, {
        carriers: [0, 2, 4],
        messageAt: index => ({ mes: `m${index}` }),
        stateAt: index => states[index],
        query: (name, args, state) => ({ name, args, v: state.v }),
        chatId: 'chat-1',
    });
    assert.deepEqual([...scan.keys()], [0, 2], 'the start card on 0, the battle card on 2');
    assert.equal(scan.get(0)[0].key, 'rpg-battle/start');
    assert.equal(scan.get(2)[0].card.title, 'Battle');
    assert.equal(scan.get(2)[0].card.tone, 'bad');
    assert.equal(asked.filter(row => row[0] === 'start').length, 1, 'the start card stops asking once it has a message');
    assert.deepEqual(asked.find(row => row[0] === 'start'), ['start', 0, 'g', 'm0'], 'the state and the message of that reply');
    assert.equal(asked.filter(row => row[0] === 'battle').length, 2, 'asked on 0 (no) and 2 (yes), then it stops');
});

test('scanReplyCards: the context carries the index, the chat and a query against the message\'s own state', () => {
    let seen = null;
    scanReplyCards([{ id: 'm/c', fn: (state, message, ctx) => { seen = { ctx, answer: ctx.query('party.hp', { x: 1 }) }; return { title: 'T' }; } }], {
        carriers: [3],
        stateAt: () => ({ v: 9 }),
        query: (name, args, state) => ({ name, args, v: state.v }),
        chatId: 'c',
    });
    assert.equal(seen.ctx.index, 3);
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
