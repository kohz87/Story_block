// The fight board is optional: off or with no open board, the ordinary planner path and prompt stay as they were.
// The board also adds no static prompt text, so turning it on cannot change the provider cache between replies.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, rollReceipt, setup } from '../helpers.js';

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
