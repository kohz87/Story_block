// Cards under replies on the real host (fix 8e, 8k): a module's cards are asked once, on the head reply's state, and drawn under the head
// in the reply strip with their actions enabled (older replies carry none); Later folds a card and the fold is kept per chat and card;
// a command runs; "open" shows the screen (a dialog-only screen opens its dialog); a card the module stops returning goes on the next
// draw. A chat with only the greeting makes the greeting the head. The keyboard focus survives a redraw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../src/v2/runtime.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { aiMessage, createFakeContext, userMessage } from '../../testkit/fake-st.js';
import { setupDom } from './view/mounts/helpers.js';

async function setup(chat = [aiMessage('Welcome to Bluewatch.'), userMessage('I look around.'), aiMessage('You walk on.')]) {
    const doc = setupDom();
    const st = createFakeContext({ chat });
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    await runtime.turn.onChatChanged();
    // The message elements SillyTavern would draw: the card mount looks them up by mesid.
    for (const index of chat.keys()) {
        const mes = doc.createElement('div');
        mes.className = 'mes';
        mes.setAttribute('mesid', String(index));
        doc.body.appendChild(mes);
    }
    return { doc, st, ui, runtime };
}

const mesOf = (doc, index) => doc.body.querySelector(`.mes[mesid="${index}"]`);
const cardsOf = (doc, index) => mesOf(doc, index).querySelectorAll('[data-ss-reply-card]');

// The cards of a module follow the head (fix 8k): each card is asked once, on the head reply's state, and drawn under the head with its
// actions enabled; older replies carry none. (Before, the first message that answered kept the card for good.)
// A storage that records what is written to it, in place of the page's localStorage.
function withStorage() {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const memory = new Map();
    const writes = [];
    Object.defineProperty(globalThis, 'localStorage', {
        value: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); writes.push([key, value]); } },
        configurable: true,
    });
    return {
        writes,
        restore() {
            if (real) Object.defineProperty(globalThis, 'localStorage', real);
            else delete globalThis.localStorage;
        },
    };
}
const redraw = (ui, indexes) => indexes.forEach(index => ui.mounts.card.refresh(index, { force: true }));

test('a module\'s cards: both cards sit under the head reply with their actions enabled; Later, a command, open, and the end of a card', async () => {
    const { doc, ui, runtime } = await setup();
    const created = [];
    let made = false;
    let fighting = true;
    await runtime.sdk.registerModule({
        id: 'qa-cards',
        name: 'Cards',
        version: '2.0.0-alpha.1',
        commands: { 'qa-cards.create'(ctx, payload) { created.push(payload); return { summary: 'Created.' }; } },
        screens: [{ id: 'qa-cards/party', title: 'Party', mounts: ['screen'], template: '<p>Party</p>' }],
        cards: {
            start: { for: () => (made ? null : { tone: 'accent', icon: 'ph-user', title: 'Start your adventure', text: 'Make your character.', actions: [{ label: 'Create character', command: 'qa-cards.create', primary: true, payload: { mode: 'quick' } }], later: true }) },
            battle: { for: () => (fighting ? { tone: 'bad', icon: 'ph-sword', title: 'Battle!', rows: [{ text: 'Ridge Wolf ×2', tag: 'even', tagTone: 'warn' }], actions: [{ label: 'Fight', command: 'qa-cards.create', primary: true, payload: { fight: true } }, { label: 'Party', open: 'qa-cards/party' }], later: true } : null) },
        },
    });
    ui.refresh();
    redraw(ui, [0, 2]);

    // Both cards sit under the head reply (message 2), in the reply strip; the greeting and the reader's message carry none.
    assert.deepEqual([...cardsOf(doc, 2)].map(node => node.getAttribute('data-ss-reply-card')), ['qa-cards/start', 'qa-cards/battle']);
    assert.equal(cardsOf(doc, 2)[0].getAttribute('data-tone'), 'accent');
    assert.equal(cardsOf(doc, 0).length, 0, 'nothing under the greeting once a reply follows it');
    assert.equal(cardsOf(doc, 1).length, 0, 'nothing under the reader\'s own message');
    // The head's cards act: no button is disabled.
    for (const node of cardsOf(doc, 2)) assert.ok(!node.querySelector('button.ss-rc-primary').disabled, 'the head\'s card can act');

    // A command from the head's card: sent through sdk.command, with its payload.
    cardsOf(doc, 2)[1].querySelector('button.ss-rc-primary').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(created, [{ fight: true }]);

    // "open" shows the screen in the game view.
    cardsOf(doc, 2)[1].querySelectorAll('button.ss-rc-action')[1].click();
    assert.equal(ui.mounts.screen.isOpen(), true);
    assert.equal(ui.mounts.screen.current(), 'qa-cards/party');
    ui.mounts.screen.close();

    // Later folds the card into one line; the fold is kept across a redraw, and Open unfolds it.
    cardsOf(doc, 2)[1].querySelector('button.ss-rc-later').click();
    const folded = mesOf(doc, 2).querySelector('.ss-rc-line');
    assert.ok(folded, 'folded to one line');
    assert.equal(folded.textContent, 'Battle! · Ridge Wolf ×2 · Open');
    redraw(ui, [2]);
    assert.ok(mesOf(doc, 2).querySelector('.ss-rc-line'), 'still folded after a redraw');
    mesOf(doc, 2).querySelector('.ss-rc-line').click();
    assert.equal(mesOf(doc, 2).querySelector('.ss-rc-line'), null, 'Open unfolds it');
    assert.ok(cardsOf(doc, 2)[1].querySelector('.ss-rc-title'));

    // A story change ends the start card: the module stops returning it, and the next draw takes it away.
    made = true;
    runtime.events.emit('committed', {});
    assert.deepEqual([...cardsOf(doc, 2)].map(node => node.getAttribute('data-ss-reply-card')), ['qa-cards/battle'], 'the start card is gone once the character is made');
});

test('a chat with only the greeting: the greeting is the head, so its card acts; when a reply follows, the card moves to it', async () => {
    const { doc, st, ui, runtime } = await setup([aiMessage('Welcome to Bluewatch.')]);
    const sent = [];
    const asked = [];
    await runtime.sdk.registerModule({
        id: 'qa-cards',
        name: 'Cards',
        version: '2.0.0-alpha.1',
        commands: { 'qa-cards.create'(ctx, payload) { sent.push(payload); return { summary: 'Created.' }; } },
        cards: { start: { for: (state, message, ctx) => { asked.push([ctx.index, ctx.head]); return { tone: 'accent', icon: 'ph-user', title: 'Start your adventure', actions: [{ label: 'Create character', command: 'qa-cards.create', primary: true, payload: { mode: 'quick' } }] }; } } },
    });
    ui.refresh();
    ui.mounts.card.refresh(0, { force: true });
    const button = index => cardsOf(doc, index)[0].querySelector('button.ss-rc-primary');
    assert.ok(!button(0).disabled, 'no reply follows the greeting: it is the head and its card can act');
    assert.deepEqual(asked.at(-1), [0, true]);
    button(0).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, [{ mode: 'quick' }], 'the command ran');

    // A reply after it: the card is the new head\'s and acts there; the greeting carries none.
    st.ctx.chat.push(userMessage('I look around.'), aiMessage('You walk on.'));
    for (const index of [1, 2]) {
        const mes = doc.createElement('div');
        mes.className = 'mes';
        mes.setAttribute('mesid', String(index));
        doc.body.appendChild(mes);
    }
    await runtime.turn.onChatChanged();
    redraw(ui, [0, 2]);
    assert.equal(cardsOf(doc, 0).length, 0, 'the greeting carries no card once a reply follows');
    assert.ok(!button(2).disabled, 'the card sits under the newest reply, enabled');
    assert.deepEqual(asked.at(-1), [2, true]);
});

test('a brand-new chat (only the greeting, no record on it yet): each card\'s for() is still asked, with the initial state, so a start card shows', async () => {
    const doc = setupDom();
    const st = createFakeContext({ chat: [aiMessage('Welcome to Bluewatch.')] });
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    // No onChatChanged: nothing has been read or written yet, the greeting carries no story record.
    const mes = doc.createElement('div');
    mes.className = 'mes';
    mes.setAttribute('mesid', '0');
    doc.body.appendChild(mes);
    assert.equal(st.ctx.chat[0].extra?.['story-suite'] ?? st.ctx.chat[0].extra?.storySuite ?? null, null, 'the greeting has no record');
    const seen = [];
    await runtime.sdk.registerModule({
        id: 'qa-cards', name: 'Cards', version: '2.0.0-alpha.1',
        cards: { start: { for: (state, message, ctx) => { seen.push({ v: state?.v, rev: state?.meta?.rev, index: ctx.index, head: ctx.head }); return { tone: 'accent', title: 'Start your adventure', actions: [{ label: 'Create', command: 'qa-cards.create' }] }; } } },
    });
    ui.refresh();
    redraw(ui, [0]);
    assert.ok(seen.length >= 1, 'for() was asked');
    assert.deepEqual(seen.at(-1), { v: 2, rev: seen.at(-1).rev, index: 0, head: true }, 'with a real (initial) state, on the greeting as the head');
    assert.ok(Number.isInteger(seen.at(-1).rev));
    assert.equal(cardsOf(doc, 0).length, 1, 'the start card shows in a brand-new chat');
    assert.ok(!cardsOf(doc, 0)[0].querySelector('button.ss-rc-primary, button.ss-rc-action').disabled);
});

test('a second fight: the battle card is under the newest reply, not on the first fight\'s; the start card leaves once the character exists', async () => {
    const chat = [aiMessage('Welcome.'), userMessage('go'), aiMessage('A wolf!'), userMessage('hit'), aiMessage('It falls.'), userMessage('walk'), aiMessage('Another wolf!')];
    const { doc, ui, runtime } = await setup(chat);
    // Per reply: the fight is on at 2, over at 4 and on again at 6; the character is made at 4.
    const fightAt = { 2: true, 4: false, 6: true };
    const madeAt = { 2: false, 4: true, 6: true };
    const asked = [];
    await runtime.sdk.registerModule({
        id: 'qa-cards',
        name: 'Cards',
        version: '2.0.0-alpha.1',
        cards: {
            start: { for: (state, message, ctx) => { asked.push(['start', ctx.index]); return madeAt[ctx.index] ? null : { title: 'Start your adventure', actions: [{ label: 'Create', command: 'qa-cards.create' }] }; } },
            battle: { for: (state, message, ctx) => { asked.push(['battle', ctx.index]); return fightAt[ctx.index] ? { tone: 'bad', title: `Battle at ${ctx.index}` } : null; } },
        },
    });
    ui.refresh();
    redraw(ui, [0, 2, 4, 6]);
    assert.deepEqual([0, 2, 4].map(index => cardsOf(doc, index).length), [0, 0, 0], 'nothing on the older replies');
    assert.deepEqual([...cardsOf(doc, 6)].map(node => node.getAttribute('data-ss-reply-card')), ['qa-cards/battle'], 'only the second fight\'s battle card, under the head; no start card (the character exists)');
    assert.equal(cardsOf(doc, 6)[0].querySelector('.ss-rc-title').textContent, 'Battle at 6');
    assert.ok(asked.every(([, index]) => index === 6), 'every card was asked about the head only');
});

test('the scan is kept per chat, head and rev: drawing the head again does not ask the cards again, a story change does', async () => {
    const { doc, ui, runtime } = await setup();
    let asks = 0;
    await runtime.sdk.registerModule({
        id: 'qa-cards', name: 'Cards', version: '2.0.0-alpha.1',
        cards: { a: { for: () => { asks++; return { title: 'A' }; } }, b: { for: () => { asks++; return { title: 'B' }; } } },
    });
    ui.refresh();
    redraw(ui, [2]);
    const first = asks;
    assert.equal(first, 2, 'two cards, asked once each');
    redraw(ui, [2]);
    redraw(ui, [0, 2]);
    assert.equal(asks, first, 'the same chat, head and rev: the scan is reused');
    runtime.events.emit('committed', {});
    assert.equal(asks, first + 2, 'a story change asks again, once per card');
    assert.equal(cardsOf(doc, 2).length, 2);
});

test('the Later fold is kept per chat and card (a new reply does not reset it), and cleared when the card stops being drawn', async () => {
    const chat = [aiMessage('Welcome.'), userMessage('go'), aiMessage('A wolf!')];
    const { doc, st, ui, runtime } = await setup(chat);
    let fighting = true;
    await runtime.sdk.registerModule({
        id: 'qa-cards', name: 'Cards', version: '2.0.0-alpha.1',
        cards: { battle: { for: () => (fighting ? { tone: 'bad', title: 'Battle', rows: [{ text: 'Wolf' }], later: true } : null) } },
    });
    const saved = withStorage();
    try {
        ui.refresh();
        redraw(ui, [2]);
        cardsOf(doc, 2)[0].querySelector('button.ss-rc-later').click();
        assert.ok(mesOf(doc, 2).querySelector('.ss-rc-line'), 'folded');
        assert.deepEqual(JSON.parse(saved.writes.at(-1)[1]), { 'chat-1|qa-cards/battle': true }, 'kept under the chat and the card key, not the message index');

        // A new reply: the card moves to it and is still folded.
        st.ctx.chat.push(userMessage('hit'), aiMessage('It snarls.'));
        for (const index of [3, 4]) {
            const mes = doc.createElement('div');
            mes.className = 'mes';
            mes.setAttribute('mesid', String(index));
            doc.body.appendChild(mes);
        }
        await runtime.turn.onChatChanged();
        redraw(ui, [2, 4]);
        assert.equal(cardsOf(doc, 2).length, 0, 'the old reply has no card');
        assert.ok(mesOf(doc, 4).querySelector('.ss-rc-line'), 'the new reply\'s card is folded too: the fold is the card\'s, not the message\'s');

        // The fight ends; the next fight\'s card starts unfolded.
        fighting = false;
        runtime.events.emit('committed', {});
        assert.equal(cardsOf(doc, 4).length, 0);
        fighting = true;
        runtime.events.emit('committed', {});
        assert.ok(cardsOf(doc, 4)[0], 'a later card of the same id');
        assert.equal(mesOf(doc, 4).querySelector('.ss-rc-line'), null, 'starts unfolded');
        assert.ok(cardsOf(doc, 4)[0].querySelector('button.ss-rc-later'));
        assert.deepEqual(JSON.parse(saved.writes.at(-1)[1]), {}, 'and nothing is left in the storage for it');
    } finally { saved.restore(); }
});

test('a chat with no id keeps the fold for this page only: Later still folds, and nothing is saved', async () => {
    const { doc, st, ui, runtime } = await setup();
    st.ctx.chatId = '';
    await runtime.sdk.registerModule({
        id: 'qa-cards', name: 'Cards', version: '2.0.0-alpha.1',
        cards: { battle: { for: () => ({ title: 'Battle', rows: [{ text: 'Wolf' }], later: true }) } },
    });
    const saved = withStorage();
    try {
        ui.refresh();
        redraw(ui, [2]);
        cardsOf(doc, 2)[0].querySelector('button.ss-rc-later').click();
        assert.ok(mesOf(doc, 2).querySelector('.ss-rc-line'), 'folded on this page');
        assert.deepEqual(saved.writes, [], 'a chat with no id saves no fold');
        redraw(ui, [2]);
        assert.ok(mesOf(doc, 2).querySelector('.ss-rc-line'), 'and it stays folded across a redraw');
    } finally { saved.restore(); }
});

test('keyboard focus survives a card redraw: Later, Open, and a command followed by `committed` keep the focus on the same control', async () => {
    const { doc, ui, runtime } = await setup();
    await runtime.sdk.registerModule({
        id: 'qa-cards', name: 'Cards', version: '2.0.0-alpha.1',
        commands: { 'qa-cards.go'() { return { summary: 'Went.' }; } },
        cards: { battle: { for: () => ({ tone: 'bad', title: 'Battle', rows: [{ text: 'Wolf' }], actions: [{ id: 'fight', label: 'Fight', command: 'qa-cards.go', primary: true }], later: true }) } },
    });
    ui.refresh();
    redraw(ui, [2]);
    const active = () => doc.activeElement;

    // Later: the card is drawn again as one line; the focus is on that line, not on the page.
    const later = cardsOf(doc, 2)[0].querySelector('button.ss-rc-later');
    later.focus();
    later.click();
    assert.ok(active(), 'the focus is not dropped to the body');
    assert.equal(active(), mesOf(doc, 2).querySelector('.ss-rc-line'), 'the fold line has it');

    // Open: the line is gone; the focus goes to the card\'s Later button.
    active().click();
    assert.equal(active(), cardsOf(doc, 2)[0].querySelector('button.ss-rc-later'), 'the card\'s own control has it');

    // A command, then `committed` (the story changes): the card is drawn again from the new state; the focus stays on Fight.
    const fight = cardsOf(doc, 2)[0].querySelector('button[data-action="fight"]');
    fight.focus();
    fight.click();
    await new Promise(resolve => setImmediate(resolve));
    runtime.events.emit('committed', {});
    assert.equal(active()?.getAttribute?.('data-action'), 'fight', 'the same action keeps the focus');
    assert.ok(mesOf(doc, 2).contains(active()), 'and it is in the page');
});

test('a card\'s open: the screen where the screen has a mount, else the dialog, else nothing', async () => {
    const { doc, ui, runtime } = await setup();
    const warn = [];
    const real = console.warn;
    console.warn = (...args) => warn.push(args.join(' '));
    try {
        await runtime.sdk.registerModule({
            id: 'qa-cards',
            name: 'Cards',
            version: '2.0.0-alpha.1',
            screens: [
                { id: 'qa-cards/party', title: 'Party', mounts: ['screen'], template: '<p>Party</p>' },
                { id: 'qa-cards/wizard', title: 'Wizard', mounts: ['dialog'], template: '<p>Wizard</p>' },
                { id: 'qa-cards/chip', title: 'Chip', mounts: ['hud'], template: '<p>Chip</p>' },
            ],
            cards: {
                tools: { for: (state, message, ctx) => (ctx.index === 2 ? { title: 'Tools', actions: [{ id: 'party', label: 'Party', open: 'qa-cards/party' }, { id: 'wizard', label: 'Wizard', open: 'qa-cards/wizard', payload: { name: 'Ren' } }, { id: 'chip', label: 'Chip', open: 'qa-cards/chip' }] } : null) },
            },
        });
        ui.refresh();
        ui.mounts.card.refresh(2, { force: true });
        const act = id => cardsOf(doc, 2)[0].querySelector(`button[data-action="${id}"]`).click();

        act('wizard');
        assert.ok(ui.mounts.dialog.current(), 'a dialog-only screen opens its dialog');
        assert.equal(ui.mounts.dialog.current().screenId, 'qa-cards/wizard');
        assert.equal(ui.mounts.dialog.current().draft.name, 'Ren', 'the action\'s payload is the starting draft');
        assert.equal(ui.mounts.screen.isOpen(), false, 'not the game view');
        ui.mounts.dialog.closeAll();

        act('party');
        assert.equal(ui.mounts.screen.current(), 'qa-cards/party', 'a screen with a screen mount opens in the game view');
        ui.mounts.screen.close();

        act('chip');
        act('chip');
        assert.equal(ui.mounts.dialog.current(), null, 'a screen with neither mount opens nothing');
        assert.equal(ui.mounts.screen.isOpen(), false);
        assert.equal(warn.filter(line => line.includes('qa-cards/chip')).length, 1, 'and says so once');
    } finally { console.warn = real; }
});

test('a card\'s open with a payload that cannot be copied still opens the dialog (with an empty draft) and throws nothing', async () => {
    const { doc, ui, runtime } = await setup();
    const loop = { name: 'Ren' };
    loop.self = loop;
    await runtime.sdk.registerModule({
        id: 'qa-cards', name: 'Cards', version: '2.0.0-alpha.1',
        screens: [{ id: 'qa-cards/wizard', title: 'Wizard', mounts: ['dialog'], template: '<p>Wizard</p>' }],
        cards: { tools: { for: () => ({ title: 'Tools', actions: [{ id: 'wizard', label: 'Wizard', open: 'qa-cards/wizard', payload: loop }] }) } },
    });
    ui.refresh();
    redraw(ui, [2]);
    assert.doesNotThrow(() => cardsOf(doc, 2)[0].querySelector('button[data-action="wizard"]').click());
    assert.equal(ui.mounts.dialog.current()?.screenId, 'qa-cards/wizard');
    assert.deepEqual(ui.mounts.dialog.current().draft, {});
    ui.mounts.dialog.closeAll();
});
