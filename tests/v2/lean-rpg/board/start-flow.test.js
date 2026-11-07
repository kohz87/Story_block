// A held fight starts before the narrator reply; the opening and board exchanges replay together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, setup } from '../helpers.js';
import { boardSession, markSend, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { pendingStart } from '../../../../src/v2/turn/fight-start.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const known = () => ({ hero: { role: 'character', fields: character('Astra') }, foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5]]) } });
const boardReceipt = (host, index) => host.ctx.chat[index].extra.storySuite.receipts.findLast(receipt => receipt.type === 'rpg.resolve' && receipt.replan?.payload?.board);

test('known foes: a fight action pauses with no model call', async () => {
    const restore = seedCrypto(501), { host, callModel } = await setup({ blocks: known(), board: true, planner: false });
    try {
        const stopped = await host.send('I strike the rats.', 'Not sent.');
        assert.equal(stopped.aborted, true);
        assert.equal(callModel.calls.length, 0);
        const pending = pendingStart(host.ctx.chatMetadata, host.ctx.chat);
        assert.equal(pending.mode, 'known');
        assert.equal(pending.choice, null);
    } finally { host.close(); restore(); }
});

test('a non-fight message and the board-off path do not pause', async () => {
    for (const board of [false, true]) {
        const restore = seedCrypto(502), { host } = await setup({ blocks: known(), board, answers: ['none'] });
        try {
            const sent = await host.send(board ? 'I greet them.' : 'I strike the rats.', 'A reply.');
            assert.equal(sent.aborted, undefined);
            assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
        } finally { host.close(); restore(); }
    }
});

test('branch load keeps a staged fight only when its anchor sid is present', async () => {
    const restore = seedCrypto(505), { host } = await setup({ blocks: known(), board: true, answers: ['none'] });
    try {
        await host.send('I wait.', 'A later reply.');
        const meta = host.ctx.chatMetadata, anchor = host.store.carrierSid(host.store.headIndex());
        assert.equal(openBoard(meta, host.head(), { sid: anchor, rules }).error, undefined);
        assert.equal(stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]).error, undefined);
        const staged = structuredClone(boardSession(meta)), chat = structuredClone(host.ctx.chat);
        await host.st.loadChat(chat, 'branch-with-anchor');
        assert.deepEqual(boardSession(meta), staged);
        await host.st.loadChat(chat.slice(0, 1), 'branch-before-anchor');
        assert.equal(boardSession(meta), null);
    } finally { host.close(); restore(); }
});

test('a board fight and its exchange survive deleting an earlier message pair', async () => {
    const restore = seedCrypto(507), { host, callModel } = await setup({ blocks: known(), board: true, planner: false });
    try {
        await host.send('I wait.', 'Earlier.');
        assert.equal((await host.send('I attack the rats.', 'Not yet.')).aborted, true);
        const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat);
        assert.equal(openBoard(meta, host.head(), { sid: host.store.carrierSid(host.store.headIndex()), rules }).error, undefined);
        pending.choice = 'board';
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
        assert.equal(staged.error, undefined);
        const rounds = structuredClone(staged.preview.result.rounds);
        assert.equal(markSend(meta, pending, boardSession(meta)), true); // what the Send button does before it generates
        const sent = await host.st.generate('regenerate', { reply: 'The fight.' });
        assert.equal(sent.aborted, undefined);
        await host.st.deleteMessage(2);
        await host.st.deleteMessage(1);
        assert.deepEqual(boardReceipt(host, 2).data.v2.result.rounds, rounds);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});

test('a board victory awards XP once through swipe and Re-read', async () => {
    const restore = seedCrypto(508);
    const blocks = known();
    Object.assign(blocks.hero.fields, { str: 20, dex: 20, agi: 20, vit: 20, soul: 1 });
    const { host } = await setup({ blocks, board: true, planner: false });
    try {
        assert.equal((await host.send('I attack the rats.', 'Not yet.')).aborted, true);
        const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat);
        assert.equal(openBoard(meta, host.head(), { sid: host.store.carrierSid(host.store.headIndex()), rules }).error, undefined);
        pending.choice = 'board';
        let played;
        for (let n = 0; n < 20; n += 1) {
            played = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
            assert.equal(played.error, undefined);
            if (played.preview.result.stop !== 'open') break;
        }
        assert.equal(played.preview.result.stop, 'won');
        assert.equal(markSend(meta, pending, boardSession(meta)), true); // what the Send button does before it generates
        const sent = await host.st.generate('regenerate', { reply: 'The fight ends.' });
        const xp = () => host.head().domains.dataModules.instances['pack.chat/hero'].chat.fields.xp;
        assert.ok(xp() > 0);
        const once = xp();
        assert.equal((await host.sdk.reread(sent.index)).ok, true);
        assert.equal(xp(), once);
        await host.swipe('A different telling.');
        assert.equal(xp(), once);
    } finally { host.close(); restore(); }
});
