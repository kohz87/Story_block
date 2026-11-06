// Board choices travel through the real test host's generation and capture path.
// A narrated swipe and a second message keep the same setup without a planner call.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { boardSession, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, rollReceipt, setup, tailOf } from '../helpers.js';

test('send, swipe and continue an open fight without planning it again', async () => {
    const restore = seedCrypto(81);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        const opened = openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        assert.equal(opened.error, undefined);
        const choices = [{ who: 'Astra', kind: 'attack', target: 1 }];
        const staged = stageExchange(meta, host.head(), choices);
        assert.equal(staged.error, undefined);
        const first = await host.send('I press on.', 'The fight continues.');
        const receipt = rollReceipt(host, 2);
        assert.ok(receipt?.guarded);
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
        assert.ok(tailOf(first.request).includes(receipt.summary));
        assert.equal(callModel.calls.length, 0);
        const beforeSwipe = receipt.data.v2.result;
        const unsent = stageExchange(meta, host.head(), choices);
        assert.equal(unsent.error, undefined);
        const unsentRounds = structuredClone(unsent.preview.result.rounds);
        await host.swipe('Another telling.');
        assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, beforeSwipe.rounds);
        assert.equal(rollReceipt(host, 2).replan.payload.board.setup.seed, opened.session.setup.seed);
        assert.equal(callModel.calls.length, 0);
        const session = boardSession(meta);
        assert.ok(session, 'this seed leaves the fight open');
        assert.equal(session.setup.offset, 1);
        assert.equal(session.exchanges.length, 1, 'the unsent exchange survives the new telling');
        await host.send('I keep going.', 'The fight goes on.');
        assert.deepEqual(rollReceipt(host, 4).data.v2.result.rounds, unsentRounds);
        assert.equal(callModel.calls.length, 0);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally { host.close(); restore(); }
});
