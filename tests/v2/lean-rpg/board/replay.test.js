// A board fight is kept by its reply and replays through swipes, middle deletes, rewinds and reloads.
// The tests use the real host, so the receipt guard and the saved chat are part of the check.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { boardSession, openBoard, reconcileBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, levelFoeBlock, recordOf, rollReceipt, setup, skillBlock } from '../helpers.js';

const FIGHT = {
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, stamina: 4 }) },
    skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'strike one foe']]) },
    foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 3]]) },
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

test('deleting an earlier pair keeps replay lookup and a repeated message gets a distinct claim', async () => {
    for (const mode of ['swipe', 'regenerate', 'repeat']) {
        const restore = seedCrypto(91);
        const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
        const { host, callModel } = await setup({ blocks, board: true });
        try {
            await host.send('Older.', 'An older reply.');
            const meta = host.ctx.chatMetadata;
            open(host);
            const action = [{ who: 'Astra', kind: 'attack', target: 11 }];
            assert.equal(stageExchange(meta, host.head(), action).error, undefined);
            await host.send('Strike.', 'Fight.');
            const first = rollReceipt(host, 4), rounds = structuredClone(first.data.v2.result.rounds), key = first.replan.payload.key;
            assert.equal(host.head().meta.claims[`rpg:resolve:${key}:reply:${recordOf(host, 4).sid}`], true);
            await host.st.deleteMessage(2);
            await host.st.deleteMessage(1);
            const calls = callModel.calls.length;
            if (mode === 'swipe') {
                await host.swipe('Another telling.');
                assert.deepEqual(roundsAt(host, 2), rounds);
                assert.equal(rollReceipt(host, 2).replan.payload.key, key);
            } else if (mode === 'regenerate') {
                await host.store.flush();
                const savedChat = structuredClone(host.st.saves.at(-1)), savedMeta = structuredClone(meta);
                await host.st.loadChat(savedChat, 'board-after-delete');
                host.ctx.chatMetadata = savedMeta;
                await host.regenerate('The fight again.');
                assert.deepEqual(roundsAt(host, 2), rounds);
                assert.equal(rollReceipt(host, 2).replan.payload.key, key);
            } else {
                const staged = stageExchange(meta, host.head(), action);
                assert.equal(staged.error, undefined);
                await host.send('Strike.', 'Continue fight.');
                assert.deepEqual(roundsAt(host, 4), staged.preview.result.rounds);
                assert.notEqual(rollReceipt(host, 4).replan.payload.key, key);
            }
            assert.equal(callModel.calls.length, calls);
        } finally { host.close(); restore(); }
    }
});

test('rewinding a later segment restores its saved initiative', async () => {
    const restore = seedCrypto(81);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 3, agi: 15, vit: 20, health: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 8, 8, 5]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, action = [{ who: 'Astra', kind: 'attack', target: 11 }];
        open(host);
        assert.equal(stageExchange(meta, host.head(), action).error, undefined);
        await host.send('First.', 'Fight.');
        assert.equal(stageExchange(meta, host.head(), action).error, undefined);
        await host.send('Second.', 'Fight again.');
        const session = boardSession(meta), saved = structuredClone(session.base), receipt = rollReceipt(host, 4);
        assert.ok(saved.order?.length);
        assert.equal((await host.sdk.rewind({ index: 4, beforeRev: receipt.rev })).ok, true);
        const expected = playBoard(host.head(), { ...session.setup, offset: saved.offset, order: saved.order, witness: undefined }, [{ actions: action }]);
        reconcileBoard(meta, id => host.store.receipts().some(entry => entry.receipt.id === id));
        assert.deepEqual(session.setup.order, saved.order);
        const actual = stageExchange(meta, host.head(), action);
        assert.equal(actual.error, undefined);
        assert.deepEqual(actual.preview.result.rounds, expected.result.rounds);
        assert.deepEqual(actual.preview.result.order, expected.result.order);
    } finally { host.close(); restore(); }
});

test('a rewind cannot reroll an already staged continuation', async () => {
    const restore = seedCrypto(81);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, action = [{ who: 'Astra', kind: 'attack', target: 11 }];
        open(host);
        stageExchange(meta, host.head(), action);
        await host.send('First.', 'Fight.');
        const receipt = rollReceipt(host, 2), staged = stageExchange(meta, host.head(), action);
        assert.equal(staged.error, undefined);
        const choices = structuredClone(boardSession(meta).exchanges), offset = boardSession(meta).setup.offset;
        assert.equal((await host.sdk.rewind({ index: 2, beforeRev: receipt.rev })).ok, true);
        reconcileBoard(meta, id => host.store.receipts().some(entry => entry.receipt.id === id));
        assert.deepEqual(boardSession(meta).exchanges, choices);
        assert.equal(boardSession(meta).setup.offset, offset);
        assert.match(stageExchange(meta, host.head(), action).error, /restore|discard/i);
        assert.equal((await host.send('Second.', 'Should not be sent.')).aborted, true);
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

test('K2: an open member fight carries its exact bars through replies, swipe, Re-read and reload', async () => {
    const restore = seedCrypto(81);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 5 }) },
        foes: { role: 'foes', fields: levelFoeBlock([['Boar', 3, 1, 4]]) } };
    const { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex()), action = [{ who: 'Astra', kind: 'attack', target: 11 }];
        let staged;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const opened = openBoard(meta, host.head(), { sid, rules: RULES });
            assert.equal(opened.error, undefined, opened.error);
            staged = stageExchange(meta, host.head(), action);
            const values = staged.preview?.result?.members?.map(member => member.value);
            if (staged.preview?.result?.stop === 'open' && values?.[0] > 0 && values[0] < 4) break;
            meta.rpgFightAttempts = { ...(meta.rpgFightAttempts ?? {}), [sid]: attempt + 1 };
            delete meta.rpgFightBoard;
        }
        assert.deepEqual(staged.preview.result.members.map(member => member.value), [2, 4, 4]);
        const bars = JSON.stringify(staged.preview.result.members);
        await host.send('Strike.', 'The fight goes on.');
        assert.equal(JSON.stringify(rollReceipt(host, 2).data.v2.result.members), bars);
        assert.deepEqual(Object.values(boardSession(meta).setup.carriedMembers.values), [2, 4, 4]);
        assert.deepEqual(playBoard(host.head(), boardSession(meta).setup, []).result.members.map(member => member.value), [2, 4, 4]);

        await host.swipe('Another telling.');
        assert.equal(JSON.stringify(rollReceipt(host, 2).data.v2.result.members), bars);
        assert.deepEqual(playBoard(host.head(), boardSession(meta).setup, []).result.members.map(member => member.value), [2, 4, 4]);
        assert.equal((await host.sdk.reread(2)).ok, true);
        assert.equal(JSON.stringify(rollReceipt(host, 2).data.v2.result.members), bars);

        await host.store.flush();
        const savedChat = structuredClone(host.st.saves.at(-1)), savedMeta = structuredClone(meta), live = JSON.stringify(host.head());
        await host.st.loadChat(savedChat, 'members-continuation');
        host.ctx.chatMetadata = savedMeta;
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal(JSON.stringify(rollReceipt(host, 2).data.v2.result.members), bars);
        assert.deepEqual(playBoard(host.head(), boardSession(meta).setup, []).result.members.map(member => member.value), [2, 4, 4]);
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});

test('deleting the reply that changed the sheet takes a later board fight back and says so in the Problems', async () => {
    const restore = seedCrypto(91);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host } = await setup({ blocks, board: true });
    try {
        await host.send('Older.', 'An older reply.');
        const set = await host.sdk.command('test.set', { slug: 'hero', field: 'str', value: 9 });
        assert.equal(set.ok, true, set.message);
        open(host);
        assert.equal(stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]).error, undefined);
        await host.send('Strike.', 'Fight.');
        assert.ok(rollReceipt(host, 4), 'the fight is settled on the reply');
        host.turn.clearProblems();
        await host.st.deleteMessage(2);
        await host.st.deleteMessage(1);
        const named = host.turn.problems().filter(item => item.code === 'FIGHT_TAKEN_BACK');
        assert.equal(rollReceipt(host, 2), undefined, 'the fight no longer stands');
        assert.equal(named.length, 1, 'one Problem names the fight that was taken back');
        assert.match(named[0].message, /fight on the board was taken back/u);
    } finally { host.close(); restore(); }
});
