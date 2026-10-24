// Cards under replies on the real host (fix 8e): a module's start card under the greeting and a battle card under a reply, drawn in the
// reply strip; Later folds a card and the fold is kept; a command runs (and only the newest reply's card can act); "open" shows the
// screen (a dialog-only screen opens its dialog); a card the module stops returning goes on the next draw. A chat with only the greeting
// lets the greeting's card act.
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

test('a module\'s cards: the start card under the greeting, the battle card under the newest reply; Later, a command, open, and the end of a card', async () => {
    const { doc, st, ui, runtime } = await setup();
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
            start: { for: (state, message, ctx) => (made ? null : { tone: 'accent', icon: 'ph-user', title: 'Start your adventure', text: 'Make your character.', actions: [{ label: 'Create character', command: 'qa-cards.create', primary: true, payload: { mode: 'quick' } }], later: true }) },
            battle: { for: (state, message, ctx) => (fighting && ctx.index === 2 ? { tone: 'bad', icon: 'ph-sword', title: 'Battle!', rows: [{ text: 'Ridge Wolf ×2', tag: 'even', tagTone: 'warn' }], actions: [{ label: 'Fight', command: 'qa-cards.create', primary: true, payload: { fight: true } }, { label: 'Party', open: 'qa-cards/party' }], later: true } : null) },
        },
    });
    ui.refresh();
    ui.mounts.card.refresh(0, { force: true });
    ui.mounts.card.refresh(2, { force: true });

    // The start card sits under the greeting, in the reply strip, and the battle card under the newest reply.
    const start = cardsOf(doc, 0);
    assert.equal(start.length, 1, 'the start card under message 0');
    assert.equal(start[0].getAttribute('data-ss-reply-card'), 'qa-cards/start');
    assert.equal(start[0].getAttribute('data-tone'), 'accent');
    assert.equal(cardsOf(doc, 2)[0].getAttribute('data-ss-reply-card'), 'qa-cards/battle');
    assert.equal(cardsOf(doc, 1).length, 0, 'nothing under the reader\'s own message');
    // The newest reply's card acts; the greeting's card is read-only (its buttons disabled, with the reason).
    assert.equal(start[0].querySelector('button.ss-rc-primary').disabled, true);
    assert.ok(start[0].querySelector('button.ss-rc-primary').getAttribute('title'));
    assert.ok(!cardsOf(doc, 2)[0].querySelector('button.ss-rc-primary').disabled, 'the newest reply\'s card can act');

    // A command from the newest reply's card: sent through sdk.command, with its payload.
    cardsOf(doc, 2)[0].querySelector('button.ss-rc-primary').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(created, [{ fight: true }]);

    // "open" shows the screen in the game view.
    cardsOf(doc, 2)[0].querySelectorAll('button.ss-rc-action')[1].click();
    assert.equal(ui.mounts.screen.isOpen(), true);
    assert.equal(ui.mounts.screen.current(), 'qa-cards/party');
    ui.mounts.screen.close();

    // Later folds the card into one line; the fold is kept across a redraw, and Open unfolds it.
    cardsOf(doc, 2)[0].querySelector('button.ss-rc-later').click();
    const folded = mesOf(doc, 2).querySelector('.ss-rc-line');
    assert.ok(folded, 'folded to one line');
    assert.equal(folded.textContent, 'Battle! · Ridge Wolf ×2 · Open');
    ui.mounts.card.refresh(2, { force: true });
    assert.ok(mesOf(doc, 2).querySelector('.ss-rc-line'), 'still folded after a redraw');
    mesOf(doc, 2).querySelector('.ss-rc-line').click();
    assert.equal(mesOf(doc, 2).querySelector('.ss-rc-line'), null, 'Open unfolds it');
    assert.ok(cardsOf(doc, 2)[0].querySelector('.ss-rc-title'));

    // A story change ends the start card: the module stops returning it, and the next draw takes it away.
    made = true;
    runtime.events.emit('committed', {});
    assert.equal(cardsOf(doc, 0).length, 0, 'the start card is gone once the character is made');
    assert.equal(cardsOf(doc, 2).length, 1, 'the battle card stays');
});

test('a chat with only the greeting: the greeting\'s card acts, until a reply follows it', async () => {
    const { doc, st, ui, runtime } = await setup([aiMessage('Welcome to Bluewatch.')]);
    const sent = [];
    await runtime.sdk.registerModule({
        id: 'qa-cards',
        name: 'Cards',
        version: '2.0.0-alpha.1',
        commands: { 'qa-cards.create'(ctx, payload) { sent.push(payload); return { summary: 'Created.' }; } },
        cards: { start: { for: () => ({ tone: 'accent', icon: 'ph-user', title: 'Start your adventure', actions: [{ label: 'Create character', command: 'qa-cards.create', primary: true, payload: { mode: 'quick' } }] }) } },
    });
    ui.refresh();
    ui.mounts.card.refresh(0, { force: true });
    const button = () => cardsOf(doc, 0)[0].querySelector('button.ss-rc-primary');
    assert.ok(!button().disabled, 'no reply follows the greeting: its card can act');
    button().click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, [{ mode: 'quick' }], 'the command ran');

    // A reply after it: the newest reply's card acts, the greeting's is read-only again, with the reason.
    st.ctx.chat.push(userMessage('I look around.'), aiMessage('You walk on.'));
    await runtime.turn.onChatChanged();
    ui.mounts.card.refresh(0, { force: true });
    assert.equal(button().disabled, true);
    assert.ok(button().getAttribute('title'));
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
                tools: { for: (state, message, ctx) => (ctx.index === 2 ? { title: 'Tools', actions: [{ id: 'party', label: 'Party', open: 'qa-cards/party' }, { id: 'wizard', label: 'Wizard', open: 'qa-cards/wizard' }, { id: 'chip', label: 'Chip', open: 'qa-cards/chip' }] } : null) },
            },
        });
        ui.refresh();
        ui.mounts.card.refresh(2, { force: true });
        const act = id => cardsOf(doc, 2)[0].querySelector(`button[data-action="${id}"]`).click();

        act('wizard');
        assert.ok(ui.mounts.dialog.current(), 'a dialog-only screen opens its dialog');
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
