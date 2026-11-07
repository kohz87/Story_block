// The fight board is optional: off or with no open board, the ordinary planner path and prompt stay as they were.
// The board also adds no static prompt text, so turning it on cannot change the provider cache between replies.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, rollReceipt, setup } from '../helpers.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';

const blocks = {
    hero: { role: 'character', fields: character('Astra', { str: 14 }) },
    foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5]]) },
};
const ANSWER = 'act Astra | stat: STR | target: Rats\nfoe Rats | target: Astra | defend: AGI';

async function planned(board) {
    const restore = seedCrypto(71);
    const { host, callModel } = await setup({ blocks, answers: [ANSWER], board, feature: true });
    try {
        const result = await host.send('I strike.', 'The rat falls back.');
        const statics = result.request.chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
        return {
            statics,
            request: structuredClone(result.request),
            receipt: structuredClone(rollReceipt(host, 2)),
            calls: callModel.calls.length,
        };
    } finally {
        host.close();
        restore();
    }
}

test('with no board open, turning the fight board on leaves the planner request and roll byte-identical', async () => {
    const off = await planned(false);
    const on = await planned(true);
    assert.equal(off.calls, 1, 'the ordinary planner is called once');
    assert.equal(on.calls, 1, 'the board does not bypass an unopened fight');
    assert.deepEqual(on.request, off.request, 'the whole request is the same');
    assert.deepEqual(on.receipt.replan, off.receipt.replan, 'the planned dice inputs are the same');
    assert.deepEqual(on.receipt.data, off.receipt.data, 'the rolled record is the same');
    assert.equal(on.statics, off.statics, 'the static prompt is the same');
});

test('a narrated board swipe keeps its recorded Standard fight', async () => {
    const restore = seedCrypto(74), { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
        await host.send('I strike.', 'The fight.');
        const swiped = await host.swipe('Another telling.');
        assert.notEqual(swiped.aborted, true);
        assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, staged.preview.result.rounds);
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});

test('a staged fight changes the reply tail but leaves its static prompt byte-identical', async () => {
    const restore = seedCrypto(76), { host } = await setup({ blocks, board: true, answers: ['none'] });
    try {
        const first = await host.send('I wait.', 'The fight continues.');
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
        const second = await host.send('I strike.', 'The fight continues.');
        const systems = request => request.chat.filter(message => message.role === 'system').map(message => message.content);
        assert.equal(systems(first.request)[0], systems(second.request)[0]);
        assert.notEqual(systems(first.request).at(-1), systems(second.request).at(-1));
        assert.ok(systems(second.request).at(-1).includes(rollReceipt(host, second.index).summary));
    } finally { host.close(); restore(); }
});

test('the fight-board feature adds no static prompt text of its own', async () => {
    const restore = seedCrypto(72);
    const { host } = await setup({ blocks, answers: [ANSWER], board: true, feature: true });
    try {
        assert.equal(host.registry.featureOn(CORE_FEATURE.fightBoard), true);
        await host.send('I wait.', 'Nothing moves.');
        const statics = host.st.requests.at(-1).chat.filter(message => message.role === 'system').map(message => message.content);
        assert.equal(statics.length, 2, 'the static part and the reply tail');
        assert.doesNotMatch(statics[0], /fight board|Fight board|rpgFightBoard/iu, 'the static part has no board text');
        assert.doesNotMatch(statics[1], /fight board|Fight board|rpgFightBoard/iu, 'no board is open, so the tail has none either');
    } finally {
        host.close();
        restore();
    }
});
