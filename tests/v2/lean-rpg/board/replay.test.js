// A board fight is kept by its reply and replays through swipes, middle deletes, rewinds and reloads.
// The tests use the real host, so the receipt guard and the saved chat are part of the check.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { boardSession, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, recordOf, rollReceipt, setup, skillBlock } from '../helpers.js';

const FIGHT = {
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, stamina: 4 }) },
    skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'strike one foe']]) },
    foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 3]]) },
};
const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const ACTION = [{ who: 'Astra', kind: 'skill', skill: 'Cut', target: 1 }];
const roundsAt = (host, index) => rollReceipt(host, index)?.data?.v2?.result?.rounds;

function open(host) {
    const sid = host.store.carrierSid(host.store.headIndex());
    const opened = openBoard(host.ctx.chatMetadata, host.head(), { sid, rules: RULES });
    assert.equal(opened.error, undefined, opened.error);
    return opened.session;
}

test('a narrated swipe, Re-read and reload keep the same open board fight', async () => {
    const restore = seedCrypto(91);
    const { host, callModel } = await setup({ blocks: FIGHT, board: true });
    try {
        const meta = host.ctx.chatMetadata, opened = open(host);
        assert.equal(stageExchange(meta, host.head(), ACTION).error, undefined);
        await host.send('First.', 'One.');
        const before = roundsAt(host, 2), id = opened.id, seed = opened.setup.seed;
        assert.equal(rollReceipt(host, 2).data.v2.result.stop, 'open');

        await host.swipe('Told again.');
        assert.deepEqual(roundsAt(host, 2), before, 'the swipe keeps the rounds');
        assert.equal(boardSession(meta)?.id, id);
        assert.equal(boardSession(meta)?.setup.seed, seed);

        assert.equal((await host.sdk.reread(2)).ok, true);
        assert.deepEqual(roundsAt(host, 2), before, 'Re-read keeps the rounds');
        assert.equal(callModel.calls.length, 0);

        await host.store.flush();
        const savedChat = structuredClone(host.st.saves.at(-1)), savedMeta = structuredClone(meta);
        const live = JSON.stringify(host.head());
        await host.st.loadChat(savedChat, 'reload-board');
        host.ctx.chatMetadata = savedMeta;
        assert.equal(JSON.stringify(host.head()), live, 'the reloaded state is the live state');
        assert.deepEqual(roundsAt(host, 2), before, 'the reload keeps the rounds');
        assert.deepEqual(boardSession(meta), savedMeta.rpgFightBoard, 'the unsent fight came back with the chat');
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});

test('a middle delete and a rewind keep the fight and replay it again', async () => {
    const restore = seedCrypto(91);
    const { host, callModel } = await setup({ blocks: FIGHT, board: true });
    try {
        const meta = host.ctx.chatMetadata, opened = open(host);
        assert.equal(stageExchange(meta, host.head(), ACTION).error, undefined);
        await host.send('First.', 'One.');
        await host.send('Pause.', 'Two.');
        assert.equal(stageExchange(meta, host.head(), ACTION).error, undefined);
        await host.send('Finish.', 'Three.');
        const final = roundsAt(host, 6), id = opened.id, seed = opened.setup.seed;
        assert.equal(rollReceipt(host, 6).data.v2.result.stop, 'won');

        await host.swipe('A different telling.');
        assert.deepEqual(roundsAt(host, 6), final, 'the won fight keeps its rounds on a swipe');
        assert.equal((await host.sdk.reread(6)).ok, true);
        assert.deepEqual(roundsAt(host, 6), final, 'Re-read keeps the won rounds');

        const rev = rollReceipt(host, 6).rev;
        const rewound = await host.sdk.rewind({ index: 6, beforeRev: rev });
        assert.equal(rewound.ok, true, rewound.message);
        assert.equal(rollReceipt(host, 6), undefined, 'the final exchange went back');
        const afterRewind = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), afterRewind, 'the rewound state is its own rebuild');

        await host.regenerate('Three again.');
        assert.deepEqual(roundsAt(host, 6), final, 'the saved board replays the same rounds after the rewind');
        assert.equal(rollReceipt(host, 6).data.v2.result.board.id, id);
        assert.equal(rollReceipt(host, 6).data.v2.result.board.seed, seed);
        assert.equal(callModel.calls.length, 0, 'the rewind replay does not ask the planner');

        await host.st.deleteMessage(4);
        await host.st.deleteMessage(3);
        assert.deepEqual(roundsAt(host, 4), final, 'the middle delete keeps the later fight result');
        assert.equal(recordOf(host, 4).receipts.some(receipt => receipt.type === 'rpg.resolve'), true);
        assert.deepEqual(host.store.problems(), []);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'the middle-deleted state is its own rebuild');
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});
