// The foe pre-check end to end (setup, hold, board, one reply) with a scripted Assist call: found groups hold the send, a timeout, an error,
// no group or the setting off sends plainly, standing foes keep today's hold with no call, "Send without a fight" records nothing, and
// replay / Re-read / rebuild read the recorded opening and never ask a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { NEVER, character, foeBlock, setup, skillBlock, tailOf } from '../helpers.js';
import { boardSession, markSend, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { clearStart, holdStart, pendingStart } from '../../../../src/v2/turn/fight-start.js';
import { createPauseView } from '../../../../src/v2/lean-rpg/board/pause.js';
import { createStartController } from '../../../../src/v2/lean-rpg/board/start-controller.js';
import { pauseViewData } from '../../../../src/v2/lean-rpg/board/start-view-data.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { PRECHECK_SETTING } from '../../../../src/v2/lean-rpg/names.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { validateDataModules } from '../../../../src/v2/data-modules/check.js';

const empty = () => ({ ...foeBlock([]), count1: 0, count2: 0, count3: 0, count4: 0 });
const blocks = () => ({
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 5 }) },
    skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'cut one foe']]) },
    foes: { role: 'foes', fields: empty() },
});
const ATTACK = 'I creep down the culvert and attack the six Gorged Grey-Tooth Tunnel Rats with 4 scores of Bilge-Rat Offspring.';
const GROUPS = JSON.stringify({ groups: [{ name: 'Gorged Grey-Tooth Tunnel Rats', count: 6 }, { name: 'Bilge-Rat Offspring', count: 80 }] });
const make = (over = {}) => setup({ blocks: blocks(), board: true, planner: false, precheck: true, answers: [GROUPS], ...over });
const plainFoes = host => host.head().domains.dataModules.instances['pack.chat/foes']?.chat.fields;
const stockFoes = () => {
    const raw = STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition;
    const checked = validateDataModules([raw], { packId: 'chat', capabilities: ['data-modules-v1'] });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    return checked.definitions[0];
};

test('found groups hold the send, the board plays them, and one reply tells the result', async () => {
    const restore = seedCrypto(701), { host, callModel } = await make();
    try {
        const stopped = await host.send(ATTACK, 'Not sent.');
        assert.equal(stopped.aborted, true);
        assert.equal(callModel.calls.length, 1);
        assert.equal(callModel.calls[0].options.helper, 'precheck');
        assert.equal(callModel.calls[0].options.timeoutMs, 20000);
        const pending = pendingStart(host.ctx.chatMetadata, host.ctx.chat);
        assert.equal(pending.mode, 'new');
        assert.deepEqual(pending.result.opened.map(entry => [entry.name, entry.count]), [['Gorged Grey-Tooth Tunnel Rats', 6], ['Bilge-Rat Offspring', 80]]);
        // The opening is only previewed: the sheet has no foe yet.
        assert.equal(plainFoes(host).count1, 0);
        const data = pauseViewData({ opening: pending.result, cap: 3 });
        assert.equal(data.title, 'This is an attack on Gorged Grey-Tooth Tunnel Rats (6), Bilge-Rat Offspring (80)');
        assert.equal(data.sendLabel, 'Send without a fight');
        assert.equal(data.autoLabel, 'Auto-fight (up to 3 exchanges)');
        const opening = host.turn.fightStartPreview();
        assert.equal(opening.result.opened.length, 2);
    } finally { host.close(); restore(); }
});

test('the held opening plays on the board and one reply carries it; Re-read and rebuild never ask a model', async () => {
    const restore = seedCrypto(702), { host, callModel } = await make();
    try {
        assert.equal((await host.send(ATTACK, 'Not sent.')).aborted, true);
        const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat), opening = host.turn.fightStartPreview();
        const { openBoard } = await import('../../../../src/v2/lean-rpg/board/session.js');
        const { STANDARD_FORMULA } = await import('../../../../src/v2/lean-rpg/rules.js');
        const { dropOf } = await import('../../../../src/v2/lean-rpg/ambush.js');
        const open = openBoard(meta, opening.state, { sid: host.store.carrierSid(host.store.headIndex()), rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        assert.equal(open.error, undefined, open.error);
        Object.assign(open.session.setup, { opening: structuredClone(pending.opening), approach: structuredClone(opening.result.checks ?? []), drop: dropOf(opening.result) });
        pending.choice = 'board';
        assert.equal(stageExchange(meta, opening.state, [{ who: 'Astra', kind: 'attack', target: 11 }]).error, undefined);
        assert.equal(markSend(meta, pending, boardSession(meta)), true);
        const sent = await host.st.generate('regenerate', { reply: 'The rats break.' });
        assert.equal(sent.aborted, undefined);
        assert.equal(callModel.calls.length, 1, 'no second call for the reply');
        const receipts = host.ctx.chat[sent.index].extra.storySuite.receipts.filter(receipt => receipt.type === 'rpg.resolve');
        assert.equal(receipts.length, 2, 'the recorded opening and the board fight');
        assert.equal(receipts[0].replan.payload.plan.open.length, 2);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        await host.turn.reread(sent.index);
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal(callModel.calls.length, 1, 'rebuild and Re-read read the recorded opening');
        await host.st.loadChat(structuredClone(host.ctx.chat), 'precheck-opening');
        assert.equal(JSON.stringify(host.head()), live, 'reload reads the recorded opening');
        assert.equal((await host.swipe('Another telling.')).aborted, undefined);
        const swiped = host.ctx.chat.at(-1).extra.storySuite.receipts.filter(receipt => receipt.type === 'rpg.resolve');
        assert.deepEqual(swiped[0].replan.payload.plan.open, receipts[0].replan.payload.plan.open);
        await host.cont(' The story continues.');
        assert.equal(callModel.calls.length, 1, 'reload, swipe and Continue do not ask again');
    } finally { host.close(); restore(); }
});

test('a timeout, an error, an unreadable answer or no group sends as today, with no hold', async () => {
    for (const [answer, extra] of [[NEVER, { timeoutMs: 30 }], [new Error('down'), {}], ['no idea', {}], [JSON.stringify({ groups: [] }), {}]]) {
        const restore = seedCrypto(703), { host, callModel } = await make({ answers: [answer], ...extra });
        try {
            const sent = await host.send(ATTACK, 'The narrator sets up the foes.');
            assert.equal(sent.aborted, undefined);
            assert.equal(callModel.calls.length, 1);
            assert.equal(pendingStart(host.ctx.chatMetadata, host.ctx.chat), null);
            assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
        } finally { host.close(); restore(); }
    }
});

test('a working hold is active only in the page that started it and cannot clear a newer choice', async () => {
    const restore = seedCrypto(707), { host, part, callModel } = await make();
    try {
        await host.send('A quiet approach.', 'The path is clear.');
        host.ctx.chat.push({ is_user: true, mes: ATTACK });
        const meta = host.ctx.chatMetadata, chat = host.ctx.chat;
        const working = holdStart(meta, chat, { mode: 'working' });
        assert.equal(pendingStart(meta, chat), working);
        assert.equal(pendingStart(structuredClone(meta), chat), null, 'a reload has no call still running');
        const view = { state: host.head(), feature: () => true, settings: () => ({}), query: () => null };
        assert.equal(part.hooks.canGenerate(view, { type: 'normal', commit: true }).ok, false, 'another live send waits for the active call');
        clearStart(meta, working);
        await part.hooks.beforeGenerate(view, { type: 'normal', commit: true, again: true });
        assert.equal(callModel.calls.length, 1, 'a new message gets a check despite an earlier unfinished session');
        await part.hooks.beforeGenerate(view, { type: 'normal', commit: true, again: true });
        assert.equal(callModel.calls.length, 1, 'retrying the same message does not repeat the call');
        chat.at(-1).mes = 'I attack the Bilge-Rat Offspring.';
        await part.hooks.beforeGenerate(view, { type: 'normal', commit: true, again: true });
        assert.equal(callModel.calls.length, 2, 'an edited message gets its own check');
        const next = holdStart(meta, chat, { mode: 'working' });
        const choice = holdStart(meta, chat, { mode: 'new' });
        clearStart(meta, next);
        assert.equal(pendingStart(meta, chat), choice, 'a late cleanup cannot remove a newer hold');
    } finally { host.close(); restore(); }
});

test('the stock Foes block opens and plays the example with 80 foes as packs', async () => {
    const definition = stockFoes();
    const fields = Object.fromEntries(Object.entries(definition.state).map(([key, schema]) => [key, schema.default]));
    const restore = seedCrypto(710), { host } = await make({ blocks: { ...blocks(), foes: { role: 'foes', fields, definition } } });
    try {
        assert.equal((await host.send(ATTACK, 'Not sent.')).aborted, true);
        const meta = host.ctx.chatMetadata, preview = host.turn.fightStartPreview();
        const opened = preview.state.domains.dataModules.instances['pack.chat/foes'].chat.fields;
        assert.deepEqual([opened.count1, opened.count2], [6, 80]);
        const { openBoard } = await import('../../../../src/v2/lean-rpg/board/session.js');
        const { STANDARD_FORMULA } = await import('../../../../src/v2/lean-rpg/rules.js');
        const board = openBoard(meta, preview.state, { sid: host.store.carrierSid(host.store.headIndex()), rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        assert.equal(board.error, undefined, board.error);
        const played = stageExchange(meta, preview.state, [{ who: 'Astra', kind: 'attack', target: 21 }]);
        assert.equal(played.error, undefined, played.error);
        const packs = played.preview.result.members.filter(member => member.group === 2);
        assert.equal(packs.length, 7);
        assert.equal(packs.reduce((sum, pack) => sum + pack.count, 0), 80);
    } finally { host.close(); restore(); }
});

test('an opening refused by the pinned Foes schema sends plainly with the normal approach cue', async () => {
    const definition = stockFoes();
    const fields = Object.fromEntries(Object.entries(definition.state).map(([key, schema]) => [key, schema.default]));
    const restore = seedCrypto(708), { host, callModel } = await make({
        blocks: { ...blocks(), foes: { role: 'foes', fields, definition } },
        answers: [JSON.stringify({ groups: [{ name: 'Rats', count: 999 }] })],
    });
    try {
        const sent = await host.send('I attack 999 rats.', 'The narrator sets up the foes.');
        assert.equal(sent.aborted, undefined);
        assert.equal(callModel.calls.length, 1);
        assert.match(tailOf(sent.request), /end at the moment of engagement/i);
        assert.equal(pendingStart(host.ctx.chatMetadata, host.ctx.chat), null);
        assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.some(receipt => receipt.type === 'rpg.resolve'), false);
    } finally { host.close(); restore(); }
});

test('the setting off, a calm message or a board that is off makes no call', async () => {
    for (const [message, over] of [[ATTACK, { settings: { [PRECHECK_SETTING]: false } }], ['I greet the rats politely.', {}], [ATTACK, { board: false }]]) {
        const restore = seedCrypto(704), { host, callModel } = await make(over);
        try {
            const sent = await host.send(message, 'A reply.');
            assert.equal(sent.aborted, undefined);
            assert.equal(callModel.calls.length, 0);
        } finally { host.close(); restore(); }
    }
});

test('standing foes keep the existing hold and make no call', async () => {
    const restore = seedCrypto(705), standing = { ...blocks(), foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5]]) } };
    const { host, callModel } = await make({ blocks: standing });
    try {
        assert.equal((await host.send('I strike the rats.', 'Not sent.')).aborted, true);
        assert.equal(callModel.calls.length, 0);
        assert.equal(pendingStart(host.ctx.chatMetadata, host.ctx.chat).mode, 'known');
    } finally { host.close(); restore(); }
});

test('Send without a fight: the message goes out unchanged and no opening is recorded', async () => {
    const restore = seedCrypto(706), { host, callModel } = await make();
    try {
        assert.equal((await host.send(ATTACK, 'Not sent.')).aborted, true);
        const pending = pendingStart(host.ctx.chatMetadata, host.ctx.chat);
        // what the "Send without a fight" button does
        delete pending.opening; delete pending.result; pending.choice = 'plain';
        const sent = await host.st.generate('regenerate', { reply: 'The narrator sets up the foes.' });
        assert.equal(sent.aborted, undefined);
        assert.equal(callModel.calls.length, 1);
        assert.equal(host.ctx.chat[sent.index - 1].mes, ATTACK);
        assert.equal(host.ctx.chat[sent.index].extra.storySuite.receipts.some(receipt => receipt.type === 'rpg.resolve'), false);
    } finally { host.close(); restore(); }
});

test('a failed plain send can be retried without appending another message or restoring the opening', async () => {
    const restore = seedCrypto(709), { host } = await make();
    const doc = setupDom();
    let calls = 0;
    const controller = createStartController({ doc, chat: () => host.ctx.chat, meta: () => host.ctx.chatMetadata,
        state: () => host.head(), board: () => null, on: () => true, generate: () => {
            calls += 1;
            return calls === 1 ? Promise.reject(new Error('send failed')) : Promise.resolve();
        } });
    try {
        assert.equal((await host.send(ATTACK, 'Not sent.')).aborted, true);
        const node = doc.createElement('div');
        assert.equal(controller.draw(node), true);
        node.querySelector('.rpg-fight-pause-send').click();
        await Promise.resolve(); await Promise.resolve();
        const event = { target: { closest: selector => selector === '#send_but' ? {} : null }, prevented: false,
            preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, stopPropagation() {} };
        for (const entry of doc.listeners.filter(item => item.type === 'click' && item.capture)) entry.fn(event);
        assert.equal(event.prevented, true);
        assert.equal(calls, 2);
        assert.equal(pendingStart(host.ctx.chatMetadata, host.ctx.chat).opening, undefined);
        assert.equal(host.ctx.chat.filter(message => message.is_user && message.mes === ATTACK).length, 1);
    } finally { controller.destroy(); host.close(); restore(); }
});

test('the pause box: the wait line has no choice; found foes offer three', () => {
    const doc = setupDom(), calls = [], host = doc.createElement('div');
    const view = createPauseView({ doc, onBoard: () => calls.push('board'), onAuto: () => calls.push('auto'), onSend: () => calls.push('send') });
    const working = pauseViewData({ working: true });
    assert.equal(working.title, 'Setting up the fight…');
    assert.equal(working.hint, 'Reading your message for the foes. If it takes more than 20 seconds, your message is sent as it is.');
    const wait = view.render(host, working);
    assert.equal(wait.querySelectorAll('button').length, 0);
    assert.ok(wait.querySelector('[role="status"]'));
    const opened = [{ name: 'Gorged Grey-Tooth Tunnel Rats', count: 6, level: 5 }, { name: 'Bilge-Rat Offspring', count: 80, level: 5 }];
    assert.equal(pauseViewData({ opening: { opened: [{ name: 'Rat', count: 1 }] } }).title, 'This is an attack on Rat (1)');
    const node = view.render(host, pauseViewData({ opening: { opened }, cap: 3 }));
    const buttons = node.querySelectorAll('button');
    assert.deepEqual(buttons.map(button => button.textContent), ['Fight on the board', 'Auto-fight (up to 3 exchanges)', 'Send without a fight']);
    assert.match(node.textContent, /Found by the pre-check from your message\. Big groups fight as packs\./);
    buttons.forEach(button => button.click());
    assert.deepEqual(calls, ['board', 'auto', 'send']);
    view.destroy();
});
