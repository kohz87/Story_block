// Auto on the board: the loop plays ordinary staged exchanges and stops at the cap, a won or lost fight or a badly hurt hero;
// its records equal the same picks made by hand, and the reply that carries them replays and re-reads exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { autoPicks } from '../../../../src/v2/lean-rpg/board/auto.js';
import { autoNote, runAuto } from '../../../../src/v2/lean-rpg/board/auto-run.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { boardSession, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, levelFoeBlock, rollReceipt, setup, sheetDomain } from '../helpers.js';

const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const sturdy = {
    hero: { role: 'character', fields: character('Astra', { health: 9, str: 3, agi: 3, dex: 3 }) },
    foes: { role: 'foes', fields: levelFoeBlock([['Ogres', 1, 30, 9]]) },
};
const weak = {
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20 }) },
    foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 1]]) },
};
const stateOf = blocks => ({ domains: { dataModules: sheetDomain(blocks) } });
const fresh = blocks => {
    const meta = {}, state = stateOf(blocks);
    const opened = openBoard(meta, state, { sid: 'sid-auto', rules: RULES });
    assert.equal(opened.error, undefined, opened.error);
    return { meta, state };
};

test('Auto stops at the cap: exactly that many exchanges, and a second run plays that many more', () => {
    for (const cap of [1, 2, 3]) {
        const { meta, state } = fresh(sturdy);
        const ran = runAuto({ meta, state, rules: RULES, cap });
        if (ran.stop === 'cap') assert.equal(boardSession(meta).exchanges.length, cap);
        assert.equal(ran.done, boardSession(meta).exchanges.length);
        assert.ok(['cap', 'hurt', 'won', 'lost'].includes(ran.stop));
        assert.ok(ran.done >= 1 && ran.done <= cap);
    }
    const { meta, state } = fresh(sturdy);
    const first = runAuto({ meta, state, rules: RULES, cap: 1 });
    assert.equal(first.done, 1);
    if (first.stop === 'cap') {
        const again = runAuto({ meta, state, rules: RULES, cap: 1 });
        assert.equal(boardSession(meta).exchanges.length, 1 + again.done, 'Auto again continues from the staged exchanges');
    }
});

test('"Until the end" plays to a won fight and then says so; a finished fight plays nothing more', () => {
    const { meta, state } = fresh(weak);
    const ran = runAuto({ meta, state, rules: RULES, cap: Infinity });
    assert.equal(ran.stop, 'won');
    assert.ok(ran.done >= 1);
    const again = runAuto({ meta, state, rules: RULES, cap: Infinity });
    assert.deepEqual([again.done, again.stop], [0, 'won']);
    assert.equal(playBoard(state, boardSession(meta).setup, boardSession(meta).exchanges).result.stop, 'won');
});

test('a hero hurt by 2 blocks stops Auto and is named; the cap does not hide a won fight', () => {
    const { meta, state } = fresh(sturdy);
    const heavy = { rounds: [{ lines: [{ kind: 'foe', pc: { who: 'Astra' }, damage: { id: 'c:hero', kind: 'char', from: 5, to: 3, blocks: 2 } }] }], stop: 'open' };
    const ran = runAuto({ meta, state, rules: RULES, cap: 5, stage: () => ({ preview: { result: heavy } }) });
    assert.deepEqual([ran.done, ran.stop, ran.who], [1, 'hurt', ['Astra']]);
    const won = runAuto({ meta, state, rules: RULES, cap: 1, stage: () => ({ preview: { result: { ...heavy, rounds: [{ lines: [] }], stop: 'won' } } }) });
    assert.equal(won.stop, 'won');
});

test('a refused exchange ends the run with the board\'s own words', () => {
    const { meta, state } = fresh(sturdy);
    const ran = runAuto({ meta, state, rules: RULES, cap: 3, stage: () => ({ error: 'Nope.' }) });
    assert.deepEqual([ran.done, ran.stop, ran.error], [0, 'error', 'Nope.']);
    assert.equal(runAuto({ meta: {}, state, rules: RULES }).stop, 'error');
});

test('the one-line stop note names the reason', () => {
    assert.equal(autoNote({ stop: 'cap', done: 3, waiting: true }), 'Auto played 3 exchanges (the cap). Send to tell them, or keep fighting.');
    assert.equal(autoNote({ stop: 'cap', done: 1 }), 'Auto played 1 exchange (the cap). Your next message tells them, or keep fighting.');
    assert.equal(autoNote({ stop: 'hurt', done: 2, who: ['Astra'], waiting: true }), 'Auto played 2 exchanges. Astra was badly hurt. Send to tell them, or keep fighting.');
    assert.match(autoNote({ stop: 'hurt', done: 2, who: ['Astra', 'Ren'] }), /Astra and Ren were badly hurt/);
    assert.equal(autoNote({ stop: 'won', done: 2 }), 'Auto played 2 exchanges and the fight is won.');
    assert.equal(autoNote({ stop: 'lost', done: 1 }), 'Auto played 1 exchange and the party is down.');
});

test('Auto\'s staged exchanges are the same records as picking the same actions by hand', () => {
    const { meta, state } = fresh(sturdy);
    const ran = runAuto({ meta, state, rules: RULES, cap: 3 });
    const by = boardSession(meta);
    const hand = { meta: {}, state: stateOf(sturdy) };
    openBoard(hand.meta, hand.state, { sid: 'sid-auto', rules: RULES });
    for (let n = 0; n < by.exchanges.length; n += 1) {
        const now = playBoard(hand.state, boardSession(hand.meta).setup, boardSession(hand.meta).exchanges);
        const picks = autoPicks({ state: now.state, setup: boardSession(hand.meta).setup, members: now.result.members, number: n + 1 }, RULES);
        assert.equal(stageExchange(hand.meta, hand.state, picks).error, undefined);
    }
    assert.deepEqual(boardSession(hand.meta).exchanges, by.exchanges);
    assert.deepEqual(boardSession(hand.meta).setup, by.setup);
    assert.ok(ran.done >= 1);
    assert.equal(by.exchanges.every(exchange => Object.keys(exchange).join() === 'actions'), true, 'only ordinary board actions are stored');
});

test('the same seed gives the same Auto exchanges, and the reply that carries them replays like a hand-played fight', async () => {
    const restore = seedCrypto(91);
    const { host, callModel } = await setup({ blocks: sturdy, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        assert.equal(openBoard(meta, host.head(), { sid, rules: RULES }).error, undefined);
        const ran = runAuto({ meta, state: host.head(), rules: RULES, cap: 2 });
        const staged = structuredClone(boardSession(meta));
        const preview = playBoard(host.head(), staged.setup, staged.exchanges).result;
        assert.ok(ran.done >= 1);
        await host.send('Fight.', 'The fight is told.');
        const result = rollReceipt(host, 2).data.v2.result, rounds = structuredClone(result.rounds);
        assert.deepEqual(rounds, preview.rounds, 'live equals the previewed Auto exchanges');
        assert.deepEqual(rollReceipt(host, 2).replan.payload.board.exchanges, staged.exchanges);
        await host.swipe('Told again.');
        assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, rounds, 'a swipe keeps the Auto exchanges');
        assert.equal((await host.sdk.reread(2)).ok, true);
        assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, rounds, 'Re-read keeps them');
        assert.equal(callModel.calls.length, 0, 'no planner call');
    } finally { host.close(); restore(); }
});
