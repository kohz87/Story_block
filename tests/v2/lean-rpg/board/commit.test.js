// A staged fight is resolved by the production command on a test host.
// The recorded dice, bars and narrator note must match the pre-reply view.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boardWitness, equipmentForBoard, playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { settledNote } from '../../../../src/v2/lean-rpg/board/note.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { character, foeBlock, setup } from '../helpers.js';
import { boardSession, discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { planGear } from '../../../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../../src/v2/lean-rpg/templates.js';
import { createFakeModel, createHost } from '../../../../testkit/index.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { gearAnswer } from '../../../../src/v2/domains/gear.js';
import { condOf, defCarry, ENCUMBERED_PENALTY } from '../../../../src/v2/domains/inventory.js';
import { aiMessage } from '../../../../testkit/fake-st.js';
import { heldForMessage } from '../../../../src/v2/turn/held-board.js';
import { boardGuard } from '../../../../src/v2/lean-rpg/board/commit.js';
import { hashJson } from '../../../../src/v2/replay.js';
import { actorIdOf } from '../../../../src/v2/lean-rpg/roster.js';

test('the reply resolver commits exactly the staged exchange and refuses a duplicate claim', async () => {
    const blocks = { hero: { role: 'character', fields: character('Astra') }, foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5]]) } };
    const { host } = await setup({ blocks });
    try {
        const setup = { seed: 24, offset: 0, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } };
        setup.witness = { offset: 0, hash: boardWitness(host.head(), setup) };
        const exchanges = [{ actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }];
        const staged = playBoard(host.head(), setup, exchanges);
        assert.equal(staged.error, undefined);
        const payload = { key: '1-abc', board: { id: 'fight-one', groups: [1], setup, exchanges } };
        const result = host.bus.run('rpg.resolve', payload, { cause: 'system' });
        assert.equal(result.ok, true, result.message);
        const recorded = result.receipt.data.v2.result;
        assert.deepEqual(recorded.rounds, staged.result.rounds);
        assert.deepEqual(recorded.hurts, staged.result.hurts);
        assert.equal(result.receipt.summary, settledNote(recorded));
        for (const hurt of staged.result.hurts) assert.equal(result.state.domains.dataModules.instances[hurt.module].chat.fields[hurt.field], hurt.to);
        // A committed fight moves the sheet, so its witness refuses a replay; the claim itself is checked on a fight with no staged rolls.
        const bare = { key: '2-abc', board: { id: 'fight-two', groups: [1], setup: { seed: 24, offset: 0, rules: setup.rules }, exchanges: [] } };
        const first = host.bus.run('rpg.resolve', bare, { cause: 'system' });
        assert.equal(first.ok, true, first.message);
        const twice = host.bus.run('rpg.resolve', bare, { cause: 'system', state: first.state });
        assert.equal(twice.ok, false);
        assert.equal(twice.code, 'CLAIMED');
    } finally { host.close(); }
});

test('the opening is named from the setup without recording it on the board result', async () => {
    const blocks = { hero: { role: 'character', fields: character('Astra') }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host } = await setup({ blocks });
    try {
        const rules = { ...STANDARD_FORMULA, levelDivisor: 5 }, opened = [{ name: 'Rats', count: 2, level: 1 }];
        const made = host.bus.run('rpg.resolve', { key: '6-abc', board: {
            id: 'members-open', groups: [1], exchanges: [],
            setup: { seed: 24, offset: 0, rules, members: 1, opened },
        } }, { cause: 'system' });
        assert.equal(made.ok, true, made.message);
        assert.equal(Object.hasOwn(made.receipt.data.v2.result, 'opened'), false);
        assert.match(made.receipt.summary, /New foes: Rats ×2 \(Lv 1\), each fought on its own\./);
        const old = host.bus.run('rpg.resolve', { key: '7-abc', board: {
            id: 'old-open', groups: [1], exchanges: [], setup: { seed: 24, offset: 0, rules },
        } }, { cause: 'system' });
        assert.equal(old.ok, true, old.message);
        assert.equal(Object.hasOwn(old.receipt.data.v2.result, 'opened'), false);
        assert.equal(Object.hasOwn(old.receipt.data.v2.result, 'members'), false);
    } finally { host.close(); }
});

test('editing a staged sheet holds generation until the original input is restored', async () => {
    const restore = seedCrypto(81);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        assert.equal(staged.error, undefined);
        assert.equal((await host.sdk.command('test.set', { slug: 'hero', field: 'str', value: 20 })).ok, true);
        const blocked = await host.send('I strike.', 'Should not be sent.');
        assert.equal(blocked.aborted, true);
        assert.match(host.st.notices.at(-1).reason, /restore|discard/i);
        assert.equal(boardSession(meta).exchanges.length, 1);
        assert.equal(callModel.calls.length, 0);
        assert.equal((await host.sdk.command('test.set', { slug: 'hero', field: 'str', value: 5 })).ok, true);
        const sent = await host.st.generate('normal', { reply: 'The fight continues.' });
        assert.notEqual(sent.aborted, true);
        const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
    } finally { host.close(); restore(); }
});

async function gearHost() {
    const host = await createHost({ callModel: createFakeModel(Array(10).fill('')), settings: { features: { 'story-block.gear': true }, modules: { 'story-block': { rpgFormula: 'standard' } } } });
    host.features.set('story-block.rpg', true);
    host.features.set('story-block.fight-board', true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Foes']) await host.sdk.command('dm.define', { definition: (name === 'Character' ? characterV1For() : structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition)) });
    await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', str: 3, dex: 12, agi: 10, vit: 20 } });
    await host.send('Set.', 'Fight.\n<Changes>\n+ dm foes — why | kind: set-slot-1 | name: Rats | count: 6 | level: 60\n+ item Cane Sword | kind: weapon | rarity: rare | DEX: +2 | equipped: weapon\n</Changes>');
    return host;
}

function openWithGear(host) {
    const state = host.head(), query = (name, args) => host.sdk.query(name, args);
    const gear = planGear(readSheet(state), query), weapon = query('inventory.gear', { owner: 'party' }).slots.weapon;
    return openBoard(host.ctx.chatMetadata, state, { sid: host.store.carrierSid(host.store.headIndex()), rules: { ...STANDARD_FORMULA, levelDivisor: 5 }, gear, weapons: { astra: weapon } });
}

test('staging retains the recorded carry penalty when mounts are off', async () => {
    const restore = seedCrypto(7), host = await gearHost();
    try {
        const state = structuredClone(host.head()), stack = Object.values(state.domains.inventory.stacks)[0];
        stack.qty = 16;
        state.domains.scene.mounts = { mare: { name: 'Mare', kind: 'horse', count: 1, pace: 35, condition: '', where: '' } };
        const query = (name, args) => name === 'inventory.gear'
            ? gearAnswer(state, args, { condOf, carryOf: defCarry, penalty: ENCUMBERED_PENALTY, mounts: [] }) : host.sdk.query(name, args);
        const gear = planGear(readSheet(state), query);
        assert.equal(gear.who.astra.enc, -2);
        assert.equal(equipmentForBoard(state, gear).gear.who.astra.enc, -2);
    } finally { host.close(); restore(); }
});

test('unequipping staged gear holds generation and restoring it keeps the rolls', async () => {
    const restore = seedCrypto(7), host = await gearHost();
    try {
        openWithGear(host);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        const stack = Object.values(host.head().domains.inventory.stacks).find(item => item.equipped === 'weapon');
        assert.equal((await host.sdk.command('inventory.unequip', { stack: stack.id })).ok, true);
        const blocked = await host.send('I strike.', 'Should not be sent.');
        assert.equal(blocked.aborted, true);
        assert.match(host.st.notices.at(-1).reason, /gear.*restore|gear.*discard/i);
        assert.equal((await host.sdk.command('item.equip', { stack: stack.id, slot: 'weapon' })).ok, true);
        const sent = await host.st.generate('normal', { reply: 'The fight continues.' });
        assert.notEqual(sent.aborted, true);
        const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
    } finally { host.close(); restore(); }
});

test('a board prelude refused after another cue stops generation with a reason', async () => {
    const restore = seedCrypto(82);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        await host.sdk.registerModule({ id: 'change-before-fight', name: 'Change before fight', version: '1.0.0', hooks: {
            beforeGenerate: () => ({ commands: [{ type: 'test.set', payload: { slug: 'hero', field: 'str', value: 20 } }] }),
        } });
        const sent = await host.send('I strike.', 'This should not be sent.');
        assert.equal(sent.aborted, true);
        assert.equal(sent.request, null);
        assert.match(host.st.notices.at(-1).reason, /fight could not be prepared.*restore.*discard/i);
        assert.equal(boardSession(meta).exchanges.length, 1);
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});

test('sheet edits and preview commits cannot change board inputs while the reply is in flight', async () => {
    const restore = seedCrypto(83);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        const payload = { slug: 'hero', field: 'str', value: 20 };
        const preview = host.bus.preview('test.set', payload);
        assert.equal(preview.ok, true);
        host.st.addUser('I strike.');
        let aborted = false;
        await host.turn.interceptor([], 8192, () => { aborted = true; }, 'normal');
        assert.equal(aborted, false);
        const edit = await host.sdk.command('test.set', payload);
        assert.equal(edit.code, 'REPLY_BUSY');
        assert.match(edit.message, /wait.*reply.*sheet or gear/i);
        assert.equal(host.bus.commit(preview.token).code, 'REPLY_BUSY');
        assert.equal(host.head().domains.dataModules.instances['pack.chat/hero'].chat.fields.str, 5);
        const index = host.st.addMessage(aiMessage('The fight continues.'));
        await host.turn.onMessageReceived(index);
        const receipt = host.ctx.chat[index].extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal((await host.sdk.command('test.set', payload)).ok, true, 'edits work once capture is complete');
    } finally { host.close(); restore(); }
});

test('a non-reader command is not refused by the in-flight edit guard', async () => {
    const restore = seedCrypto(93);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        host.st.addUser('I strike.');
        let aborted = false;
        await host.turn.interceptor([], 8192, () => { aborted = true; }, 'normal');
        const edit = host.bus.command('test.set', { slug: 'hero', field: 'str', value: 20 }, { cause: 'system' });
        assert.equal(edit.ok, true, edit.message);
        host.events.emit('committed', { receipt: edit.receipt });
        assert.equal(aborted, true, 'an input change still stops the reply');
    } finally { host.close(); restore(); }
});

test('gear cannot be unequipped while a board reply is in flight', async () => {
    const restore = seedCrypto(84), host = await gearHost();
    try {
        openWithGear(host);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        const stack = Object.values(host.head().domains.inventory.stacks).find(item => item.equipped === 'weapon');
        host.st.addUser('I strike.');
        await host.turn.interceptor([], 8192, () => assert.fail('the board should preflight'), 'normal');
        const edit = await host.sdk.command('inventory.unequip', { stack: stack.id });
        assert.equal(edit.code, 'REPLY_BUSY');
        assert.match(edit.message, /wait.*reply.*gear/i);
        const index = host.st.addMessage(aiMessage('The fight continues.'));
        await host.turn.onMessageReceived(index);
        const receipt = host.ctx.chat[index].extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally { host.close(); restore(); }
});

test('a rebuilt sheet that changes during a reply invokes the stop callback and explains why', async () => {
    const restore = seedCrypto(85);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        host.st.addUser('I strike.');
        let aborted = false;
        await host.turn.interceptor([], 8192, () => { aborted = true; }, 'normal');
        // Simulate a timeline rebuild, which changes the head without going through the command commit guard.
        const edit = host.bus.run('test.set', { slug: 'hero', field: 'str', value: 20 }, { cause: 'system' });
        host.store.append({ ops: edit.ops, receipt: edit.receipt });
        host.events.emit('head', { reason: 'edit' });
        assert.equal(aborted, true);
        assert.match(host.st.notices.at(-1).reason, /sheet or gear changed.*restore.*discard/i);
        assert.equal(boardSession(meta).exchanges.length, 1);
        assert.equal((await host.sdk.command('test.set', { slug: 'hero', field: 'str', value: 5 })).ok, true);
        host.turn.onGenerationEnded();
        const sent = await host.st.generate('normal', { reply: 'The fight continues.' });
        const receipt = host.ctx.chat[sent.index].extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
    } finally { host.close(); restore(); }
});

test('a late input change holds the received reply until the sheet is restored', async () => {
    const restore = seedCrypto(86);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        host.st.addUser('I strike.');
        await host.turn.interceptor([], 8192, () => {}, 'normal');
        // The head changes without an event before the response arrives.
        const edit = host.bus.run('test.set', { slug: 'hero', field: 'str', value: 20 }, { cause: 'system' });
        host.store.append({ ops: edit.ops, receipt: edit.receipt });
        const index = host.st.addMessage(aiMessage('The fight continues.'));
        assert.equal(await host.turn.onMessageReceived(index), null);
        assert.match(host.st.notices.at(-1).reason, /fight could not be saved.*restore.*discard/i);
        assert.equal(host.ctx.chat[index].extra?.storySuite?.receipts?.some(item => item.type === 'rpg.resolve') ?? false, false);
        assert.equal(boardSession(meta).exchanges.length, 1);
        const heldSession = host.turn.session();
        host.registry.setRestore('pending', 'Waiting for the saved records.');
        let blocked = false;
        await host.turn.interceptor([], 8192, () => { blocked = true; }, 'normal');
        assert.equal(blocked, true);
        assert.deepEqual(host.turn.session(), heldSession, 'a restore barrier does not discard the held reply');
        host.registry.setRestore('idle');
        assert.equal((await host.sdk.command('test.set', { slug: 'hero', field: 'str', value: 5 })).ok, true);
        for (let n = 0; n < 20 && !host.ctx.chat[index].extra?.storySuite?.receipts?.some(item => item.type === 'rpg.resolve'); n += 1) await new Promise(resolve => setImmediate(resolve));
        const receipt = host.ctx.chat[index].extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally { host.close(); restore(); }
});

test('discarding a held fight allows the reply to be regenerated with the planner', async () => {
    const restore = seedCrypto(87);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host, callModel } = await setup({ blocks, board: true, answers: ['none'] });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        host.st.addUser('I strike.');
        await host.turn.interceptor([], 8192, () => {}, 'normal');
        const edit = host.bus.run('test.set', { slug: 'hero', field: 'str', value: 20 }, { cause: 'system' });
        host.store.append({ ops: edit.ops, receipt: edit.receipt });
        const index = host.st.addMessage(aiMessage('The fight continues.'));
        assert.equal(await host.turn.onMessageReceived(index), null);
        assert.equal(discardBoard(meta), true);
        const sent = await host.st.generate('regenerate', { reply: 'A new telling.' });
        assert.notEqual(sent.aborted, true);
        assert.equal(callModel.calls.length, 1);
        assert.equal(host.ctx.chat[sent.index].extra.storySuite.receipts.some(item => item.type === 'rpg.resolve' && item.replan?.payload?.board), false);
    } finally { host.close(); restore(); }
});

test('a board reply applies its fight and its own sheet and equipment lines', async () => {
    const restore = seedCrypto(88), host = await gearHost();
    try {
        openWithGear(host);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        assert.equal(staged.error, undefined);
        host.st.addUser('I strike.');
        await host.turn.interceptor([], 8192, () => assert.fail('the board should preflight'), 'normal');
        const equipped = Object.values(host.head().domains.inventory.stacks).find(item => item.equipped === 'weapon');
        assert.equal((await host.sdk.command('inventory.unequip', { stack: equipped.id })).code, 'REPLY_BUSY');
        const lines = [
            '~ dm character — a bruise | kind: set-health | to: Hurt',
            '+ dm character — learned | kind: add-xp | amount: 1',
            '~ item Cane Sword — nicked | wear: scuff',
            '- item Cane Sword | qty: 1',
            '+ item New Sword | kind: weapon | equipped: weapon',
        ];
        const index = host.st.addMessage(aiMessage(`The fight continues.\n<Changes>\n${lines.join('\n')}\n</Changes>`));
        const turn = await host.turn.onMessageReceived(index);
        assert.ok(turn, 'the reply was captured');
        assert.deepEqual(turn.steps.find(item => item.type === 'rpg.resolve').data.v2.result.rounds, staged.preview.result.rounds);
        assert.deepEqual(turn.problems, [], JSON.stringify(turn.problems));
        assert.equal(turn.receipts.filter(item => item.cause === 'story').length, lines.length);
        const sheet = host.head().domains.dataModules.instances['pack.chat/character'].chat.fields;
        assert.equal(sheet.health, 5, JSON.stringify(sheet)); // 'Hurt' is stage 3 of 8 health blocks
        assert.equal(sheet.xp, 1);
        const items = host.sdk.query('inventory.items');
        assert.equal(items.some(item => item.name === 'Cane Sword'), false);
        assert.equal(items.find(item => item.name === 'New Sword')?.equipped, 'weapon');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally { host.close(); restore(); }
});

test('a held reply survives reload and captures its fight only after inputs are restored', async () => {
    const restore = seedCrypto(89);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        host.st.addUser('I strike.');
        await host.turn.interceptor([], 8192, () => assert.fail('the board should preflight'), 'normal');
        const edit = host.bus.run('test.set', { slug: 'hero', field: 'str', value: 20 }, { cause: 'system' });
        host.store.append({ ops: edit.ops, receipt: edit.receipt });
        const index = host.st.addMessage(aiMessage('The fight continues.'));
        assert.equal(await host.turn.onMessageReceived(index), null);
        await host.store.flush();
        const savedChat = structuredClone(host.st.saves.at(-1)), savedMeta = structuredClone(host.ctx.chatMetadata);
        host.ctx.chatMetadata = savedMeta;
        await host.st.loadChat(savedChat, 'held-reload');
        const record = host.ctx.chat[index].extra?.storySuite;
        assert.ok(record?.sid);
        assert.ok(savedMeta.rpgFightHeld?.[record.sid], 'the marker belongs to the reply sid');
        assert.equal(record.receipts.some(item => item.type === 'rpg.resolve'), false);
        assert.match(host.turn.problems().at(-1).message, /restore.*discard.*regenerate/i);
        assert.equal((await host.turn.reread(index)).ok, false, 'Re-read cannot capture the story without the fight');
        const blocked = await host.st.generate('normal', { reply: 'Not yet.' });
        assert.equal(blocked.aborted, true);
        assert.equal((await host.sdk.command('test.set', { slug: 'hero', field: 'str', value: 5 })).ok, true);
        for (let n = 0; n < 30 && !host.ctx.chat[index].extra?.storySuite?.receipts?.some(item => item.type === 'rpg.resolve'); n += 1) await new Promise(resolve => setImmediate(resolve));
        const receipt = host.ctx.chat[index].extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        await host.turn.onChatChanged();
        assert.equal(heldForMessage(host.ctx.chatMetadata, host.ctx.chat[index]), null, 'a captured reply is no longer held');
    } finally { host.close(); restore(); }
});

test('after reload a held reply cannot read story lines before its fight', async () => {
    const restore = seedCrypto(94), host = await gearHost();
    try {
        openWithGear(host);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        host.st.addUser('I strike.');
        await host.turn.interceptor([], 8192, () => assert.fail('the board should preflight'), 'normal');
        const edit = host.bus.run('dm.set', { module: 'pack.chat/character', field: 'str', value: 8 }, { cause: 'ui' });
        assert.equal(edit.ok, true, edit.message);
        host.store.append({ ops: edit.ops, receipt: edit.receipt, ...(edit.block ? { block: edit.block } : {}) });
        await host.store.flush();
        const index = host.st.addMessage(aiMessage('A bruise.\n<Changes>\n~ dm character — hurt | kind: set-health | to: 2\n</Changes>'));
        assert.equal(await host.turn.onMessageReceived(index), null);
        await host.store.flush();
        const chat = structuredClone(host.st.saves.at(-1));
        host.ctx.chatMetadata = structuredClone(host.ctx.chatMetadata);
        await host.st.loadChat(chat, 'held-with-lines');
        assert.equal((await host.turn.reread(index)).ok, false);
        assert.equal(host.ctx.chat[index].extra.storySuite.receipts.length, 0);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', field: 'str', value: 3 })).ok, true);
        for (let n = 0; n < 30 && !host.ctx.chat[index].extra.storySuite.receipts.some(item => item.type === 'rpg.resolve'); n += 1) await new Promise(resolve => setImmediate(resolve));
        const receipts = host.ctx.chat[index].extra.storySuite.receipts;
        assert.deepEqual(receipts.find(item => item.type === 'rpg.resolve').data.v2.result.rounds, staged.preview.result.rounds);
        assert.equal(receipts.filter(item => item.cause === 'story').length, 1);
        assert.equal(host.head().domains.dataModules.instances['pack.chat/character'].chat.fields.health, 3);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally { host.close(); restore(); }
});

test('discarding a reloaded held fight requires regenerating its reply', async () => {
    const restore = seedCrypto(90);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host, callModel } = await setup({ blocks, board: true, answers: ['none'] });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        host.st.addUser('I strike.');
        await host.turn.interceptor([], 8192, () => {}, 'normal');
        const edit = host.bus.run('test.set', { slug: 'hero', field: 'str', value: 20 }, { cause: 'system' });
        host.store.append({ ops: edit.ops, receipt: edit.receipt });
        const index = host.st.addMessage(aiMessage('The fight continues.'));
        assert.equal(await host.turn.onMessageReceived(index), null);
        await host.store.flush();
        const chat = structuredClone(host.st.saves.at(-1));
        host.ctx.chatMetadata = structuredClone(meta);
        await host.st.loadChat(chat, 'held-discard');
        assert.equal(discardBoard(host.ctx.chatMetadata), true);
        assert.equal((await host.turn.reread(index)).ok, false);
        const sent = await host.st.generate('regenerate', { reply: 'A new telling.' });
        assert.notEqual(sent.aborted, true);
        assert.equal(callModel.calls.length, 1);
        assert.equal(host.ctx.chat[sent.index].extra.storySuite.receipts.some(item => item.type === 'rpg.resolve' && item.replan?.payload?.board), false);
    } finally { host.close(); restore(); }
});

test('a weapon breaking in one exchange changes later rolls, including across replies', async () => {
    for (const split of [false, true]) {
        const restore = seedCrypto(7), host = await gearHost();
        try {
            assert.equal(host.bus.command('gear.wear', { owner: 'party', slot: 'weapon', steps: 2 }, { cause: 'system' }).ok, true);
            const meta = host.ctx.chatMetadata, action = [{ who: 'Astra', kind: 'attack', target: 11 }];
            let first;
            for (let attempt = 0; attempt < 200; attempt += 1) {
                assert.equal(openWithGear(host).error, undefined);
                first = stageExchange(meta, host.head(), action);
                if (first.preview?.result.stop === 'open' && first.preview.result.wear?.some(event => event.to === 'broken')) break;
                discardBoard(meta); first = null;
            }
            assert.ok(first, 'found a deterministic break in the first exchange');
            const together = playBoard(host.head(), boardSession(meta).setup, [...boardSession(meta).exchanges, { actions: action }]);
            assert.equal(together.error, undefined);
            assert.ok(together.result.rounds[0].lines.some(line => line.pc?.gear?.some(item => item.name === 'Cane Sword')));
            assert.ok(together.result.rounds[1].lines.every(line => !line.pc?.gear?.some(item => item.name === 'Cane Sword')));
            assert.equal(together.result.rounds[1].lines.find(line => line.kind === 'act').pc.stat, 'str');
            let staged;
            if (split) {
                await host.send('First.', 'The fight continues.');
                staged = stageExchange(meta, host.head(), action);
                assert.equal(staged.error, undefined);
                assert.deepEqual(staged.preview.result.rounds[0], together.result.rounds[1]);
            } else staged = stageExchange(meta, host.head(), action);
            assert.equal(staged.error, undefined);
            await host.send('Strike.', 'The fight goes on.');
            const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
            for (const [key, value] of Object.entries(staged.preview.result)) assert.deepEqual(receipt.data.v2.result[key], value, key);
            assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.cond, 0);
            await host.swipe('Another telling.');
            assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.cond, 0);
            assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
            assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.cond, 0);
        } finally { host.close(); restore(); }
    }
});

// ---- consumables: Use on…, the story's used line, and the board's Use item (owner 14 Nov), on the real host ------------------------------------------------
async function potionHost({ rpg = true, health = 1 } = {}) {
    const host = await createHost({ callModel: createFakeModel(Array(10).fill('')), settings: { features: { 'story-block.gear': true }, modules: { 'story-block': { rpgFormula: 'standard' } } } });
    host.features.set('story-block.rpg', rpg);
    host.features.set('story-block.fight-board', true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Foes']) await host.sdk.command('dm.define', { definition: (name === 'Character' ? characterV1For() : structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition)) });
    await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', str: 3, vit: 10, agi: 10, int: 10, health, stamina: 1, mana: 1 } });   // (the sheet's bars: Health 6, Stamina 5, Mana 5)
    await host.send('Set.', 'Fight.\n<Changes>\n+ dm foes — why | kind: set-slot-1 | name: Rats | count: 2 | level: 10\n+ item Healing Draught | kind: consumable | rarity: rare | qty: 3\n+ item Mana Potion | kind: consumable | rarity: common | qty: 1\n+ item Travel Ration | kind: consumable | rarity: epic | qty: 1\n</Changes>');
    return host;
}
const fieldOf = (host, field) => host.head().domains.dataModules.instances['pack.chat/character'].chat.fields[field];
const stackOf = (host, name) => { const inv = host.head().domains.inventory; return Object.values(inv.stacks).find(stack => inv.defs[stack.def].name === name); };
const ASTRA = actorIdOf('pack.chat/character');
const itemRounds = host => host.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve').data.v2.result;

test('Use on…: items.useOn offers the party\'s consumables, and rpg.useItem restores the pool by rarity and uses one unit up', async () => {
    const restore = seedCrypto(5), host = await potionHost();
    try {
        const offered = host.sdk.query('items.useOn', {});
        assert.deepEqual(Object.keys(offered).sort(), ['Healing Draught', 'Mana Potion', 'Travel Ration'].map(name => stackOf(host, name).id).sort(), 'every consumable, no one else');
        assert.deepEqual(offered[stackOf(host, 'Mana Potion').id], [{ id: ASTRA, via: 'rpg.useItem' }]);
        assert.deepEqual(host.sdk.query('inventory.equipment', {}).users[stackOf(host, 'Mana Potion').id], [{ id: ASTRA, name: 'Astra', via: 'rpg.useItem' }], 'the inventory screen\'s picker reads it, and its button runs the RPG\'s own command');
        const before = fieldOf(host, 'health');
        const used = await host.sdk.command('rpg.useItem', { stack: stackOf(host, 'Healing Draught').id, target: ASTRA });
        assert.equal(used.ok, true, used.message);
        assert.equal(before, 2);
        assert.equal(fieldOf(host, 'health'), 6, 'a rare draught gives 4 health blocks (2 + 4)');
        assert.equal(stackOf(host, 'Healing Draught').qty, 2, 'one unit is used up');
        assert.match(used.receipt.summary, /Astra \+4 health, now 6 of 6/);
        assert.equal(used.receipt.narrate, true, 'from the button the narrator is told, as it is of inventory.consume');
        const mana = fieldOf(host, 'mana');
        assert.equal((await host.sdk.command('rpg.useItem', { stack: stackOf(host, 'Mana Potion').id, target: ASTRA })).ok, true);
        assert.equal(fieldOf(host, 'mana'), Math.min(5, mana + 2), 'a common mana potion gives 2 mana blocks');
        assert.equal(stackOf(host, 'Mana Potion'), undefined, 'the last unit leaves the bag');
        const stamina = fieldOf(host, 'stamina');
        assert.equal((await host.sdk.command('rpg.useItem', { stack: stackOf(host, 'Travel Ration').id, target: ASTRA })).ok, true);
        assert.equal(fieldOf(host, 'stamina'), 5, 'an epic ration gives 5 stamina blocks, held to the bar\'s size');
        assert.equal((await host.sdk.command('rpg.useItem', { stack: stackOf(host, 'Healing Draught').id, target: 'ac_nobody00' })).ok, false, 'a target that is not in the party is refused');
        assert.equal(stackOf(host, 'Healing Draught').qty, 2, 'and nothing is used up');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live state');
    } finally { host.close(); restore(); }
});

test('Use on… is capped at the pool\'s size, and not offered while a board fight is open', async () => {
    const restore = seedCrypto(5), host = await potionHost({ health: 3 });
    try {
        const used = await host.sdk.command('rpg.useItem', { stack: stackOf(host, 'Healing Draught').id, target: ASTRA });
        assert.equal(used.ok, true, used.message);
        assert.equal(fieldOf(host, 'health'), 6, '4 + 4 is held to the bar of 6');
        assert.match(used.receipt.summary, /Astra \+2 health, now 6 of 6/);
        const full = await host.sdk.command('rpg.useItem', { stack: stackOf(host, 'Healing Draught').id, target: ASTRA });
        assert.equal(full.ok, true, 'a full pool still takes the dose: the reader chose it');
        assert.match(full.receipt.summary, /already full/);
        assert.equal(stackOf(host, 'Healing Draught').qty, 1);
        openBoard(host.ctx.chatMetadata, host.head(), { sid: host.store.carrierSid(host.store.headIndex()), rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        assert.deepEqual(host.sdk.query('items.useOn', {}), {}, 'the sheet is held while the fight is open');
        assert.equal(fieldOf(host, 'health'), 6);
    } finally { host.close(); restore(); }
});

test('the story line `- item X | used: yes | on: Name` does the same through the story path: one unit, the pool by rarity, replay-safe', async () => {
    const restore = seedCrypto(5), host = await potionHost();
    try {
        await host.send('I drink.', 'She drinks.\n<Changes>\n- item Healing Draught | used: yes | on: Astra\n</Changes>');
        assert.equal(fieldOf(host, 'health'), 6, 'a rare draught: 2 + 4');
        assert.equal(stackOf(host, 'Healing Draught').qty, 2);
        assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'capture.item').narrate, false, 'from the story the narrator already said so');
        await host.send('Again.', 'She drinks.\n<Changes>\n- item Mana Potion | used: yes\n</Changes>');
        assert.equal(fieldOf(host, 'mana'), 4, 'no `on:` means the reader: a common mana potion, 2 + 2');
        assert.equal(stackOf(host, 'Mana Potion'), undefined);
        await host.send('A stranger.', 'He drinks.\n<Changes>\n- item Healing Draught | used: yes | on: Nobody\n</Changes>');
        assert.equal(stackOf(host, 'Healing Draught').qty, 1, 'someone off the sheet still uses the unit up');
        assert.equal(fieldOf(host, 'health'), 6, 'and no one on the sheet is helped');
        await host.send('Eat.', 'She eats.\n<Changes>\n- item Travel Ration | used: yes | on: Astra\n</Changes>');
        assert.equal(fieldOf(host, 'stamina'), 5, 'an epic ration: stamina to the bar');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live state');
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        assert.equal(JSON.stringify(host.head()), live, 'a reload does too');
        assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
        assert.equal(JSON.stringify(host.head()), live, 'a Re-read keeps it');
    } finally { host.close(); restore(); }
});

test('with the RPG off the used line still takes the unit away, and no one is healed', async () => {
    const restore = seedCrypto(5), host = await potionHost({ rpg: false });
    try {
        const sent = await host.send('I drink.', 'She drinks.\n<Changes>\n- item Healing Draught | used: yes | on: Astra\n</Changes>');
        assert.notEqual(sent.aborted, true);
        assert.equal(stackOf(host, 'Healing Draught').qty, 2, 'the line falls back: one unit goes');
        assert.equal(fieldOf(host, 'health'), 2);
        assert.deepEqual(host.sdk.query('inventory.equipment', {}).users, {}, 'and there is no Use on…');
    } finally { host.close(); restore(); }
});

const potionBoard = (host, actions, more = []) => {
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    assert.equal(openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } }).error, undefined);
    for (const exchange of [actions, ...more]) { const staged = stageExchange(meta, host.head(), exchange); assert.equal(staged.error, undefined, staged.error); }
    return meta;
};
const DRAUGHT = host => ({ who: 'Astra', kind: 'item', stack: stackOf(host, 'Healing Draught').id, target: 'Astra' });

test('board: Use item takes the actor\'s action, restores the pool, uses the unit up when the reply commits, and the foes still attack', async () => {
    const restore = seedCrypto(11), host = await potionHost();
    try {
        const stack = stackOf(host, 'Healing Draught').id, meta = potionBoard(host, [DRAUGHT(host)]);
        const session = boardSession(meta), preview = playBoard(host.head(), session.setup, session.exchanges);
        assert.equal(preview.error, undefined, preview.error);
        const lines = preview.result.rounds[0].lines;
        assert.equal(lines[0].item, 'Healing Draught');
        assert.equal(lines[0].pool, 'health');
        assert.equal(lines[0].gained, 4);
        assert.equal(lines.filter(line => line.kind === 'act').length, 0, 'no attack was made');
        assert.ok(lines.some(line => line.kind === 'foe'), 'the foes still attack');
        assert.equal(host.head().domains.inventory.stacks[stack].qty, 3, 'the preview changes nothing in the bag');
        assert.deepEqual(preview.result.items.map(item => [item.name, item.who, item.target, item.pool, item.gained]), [['Healing Draught', 'Astra', 'Astra', 'health', 4]]);
        assert.match(settledNote(preview.result), /Astra drinks the Healing Draught \(\+4 health\); already used up/);
        await host.send('I drink and brace.', 'She drinks.');
        const result = itemRounds(host);
        assert.deepEqual(result.rounds, preview.result.rounds, 'the reply holds what the board showed');
        assert.equal(host.head().domains.inventory.stacks[stack].qty, 2, 'one unit is used up');
        for (const hurt of result.hurts) assert.equal(fieldOf(host, hurt.field), hurt.to, 'the bars the reply wrote are the recorded ones');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live state');
        await host.swipe('Told another way.');
        assert.deepEqual(itemRounds(host).rounds, preview.result.rounds, 'a swipe gives the same result');
        assert.equal(host.head().domains.inventory.stacks[stack].qty, 2, 'and the unit is used up once');
        assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
        assert.deepEqual(itemRounds(host).rounds, preview.result.rounds, 'Re-read keeps it');
        assert.equal(host.head().domains.inventory.stacks[stack].qty, 2);
        await host.store.flush();
        const kept = JSON.stringify(host.head());
        await host.st.loadChat(structuredClone(host.st.saves.at(-1)));
        assert.equal(JSON.stringify(host.head()), kept, 'a reload keeps it');
    } finally { host.close(); restore(); }
});

test('board: the item is checked against the bag, one item per member per exchange, and later exchanges see what earlier ones used', async () => {
    const restore = seedCrypto(11), host = await potionHost();
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        assert.match(stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'item', stack: 'it_nothere', target: 'Astra' }]).error, /no longer in the bag/);
        assert.match(stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'item', stack: stackOf(host, 'Healing Draught').id, target: 'Nobody' }]).error, /no longer here/);
        assert.match(stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'item', target: 'Astra' }]).error, /Choose an item/);
        assert.match(stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'item', stack: stackOf(host, 'Mana Potion').id, target: 'Astra' }, { who: 'Astra', kind: 'item', stack: stackOf(host, 'Mana Potion').id, target: 'Astra' }]).error, /cannot act twice|Choose an action/);
        assert.equal(boardSession(meta).exchanges.length, 0, 'a refused choice never enters the session');
        const mana = { who: 'Astra', kind: 'item', stack: stackOf(host, 'Mana Potion').id, target: 'Astra' };
        assert.equal(stageExchange(meta, host.head(), [mana]).error, undefined);
        assert.match(stageExchange(meta, host.head(), [mana]).error, /no longer in the bag/, 'the last Mana Potion went in exchange 1');
        assert.equal(boardSession(meta).exchanges.length, 1);
    } finally { host.close(); restore(); }
});

test('board: a fight that used an item holds its replay guard to that stack, and the old shape is unchanged', async () => {
    const restore = seedCrypto(11), host = await potionHost();
    try {
        potionBoard(host, [DRAUGHT(host)]);
        const before = structuredClone(host.head());
        await host.send('I drink.', 'She drinks.');
        const guarded = host.ctx.chat.at(-1).extra.storySuite.spans.find(span => span.guard?.predicate?.kind === 'rpg.resolve');
        assert.equal(guarded.guard.predicate.items, 1, 'the predicate says items were used');
        const check = state => boardGuard({ state, hash: hashJson }, { guard: guarded.guard, source: guarded.source, recorded: guarded.recorded });
        const earlier = structuredClone(before);
        // (the state this reply began on: the bag still held the dose; the guard must say so, and must say no when the bag no longer does)
        assert.equal(check(earlier).ok, true, JSON.stringify(check(earlier)));
        const stack = stackOf({ head: () => earlier }, 'Healing Draught');
        stack.qty = 1;
        assert.equal(check(earlier).ok, false, 'a different stock behind the fight breaks the guard');
        delete earlier.domains.inventory.stacks[stack.id];
        assert.equal(check(earlier).ok, false, 'so does a bag with no such item');
        const plain = await potionHost();
        try {
            potionBoard(plain, [{ who: 'Astra', kind: 'attack', target: 11 }]);
            await plain.send('I strike.', 'She strikes.');
            const span = plain.ctx.chat.at(-1).extra.storySuite.spans.find(item => item.guard?.predicate?.kind === 'rpg.resolve');
            assert.equal('items' in span.guard.predicate, false, 'a fight with no item has the predicate it always had');
            assert.equal('items' in plain.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve').data.v2.result, false);
        } finally { plain.close(); }
    } finally { host.close(); restore(); }
});
