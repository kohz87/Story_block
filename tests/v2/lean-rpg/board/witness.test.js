// The board fight's guard witness: a new record hashes the domain without `perReply`, so another reply's
// `perReply` scratch cannot drop it; a record made before that keeps the old whole-domain witness and verifies as it did.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { openBoard } from '../../../../src/v2/lean-rpg/board/session.js';
import { boardGuard } from '../../../../src/v2/lean-rpg/board/commit.js';
import { hashJson } from '../../../../src/v2/replay.js';
import { RESOLVE } from '../../../../src/v2/lean-rpg/names.js';
import { character, foeBlock, setup } from '../helpers.js';

const BLOCKS = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };

async function fixture() {
    const { host } = await setup({ blocks: BLOCKS, board: true });
    const sid = host.store.carrierSid(host.store.headIndex());
    const board = openBoard(host.ctx.chatMetadata, host.head(), { sid, rules: RULES }).session;
    const state = structuredClone(host.head());
    host.close();
    return { board: structuredClone(board), state };
}
const recordFor = (board, state, old) => {
    const source = 'reply:1', key = 'b:test', practice = 3;
    const predicate = { kind: RESOLVE, board: 1, key, setup: hashJson(board), rules: hashJson(board.setup.rules), practice };
    const domain = state.domains.dataModules, witness = { dataModules: old ? domain : { ...domain, perReply: {} } };
    const guard = { owner: 'story-block', version: 2, epoch: 0, rulesHash: null, predicate, inputHash: hashJson({ source, predicate, witness }) };
    return { guard, source, recorded: { key, board, practice } };
};
const withScratch = state => {
    const copy = structuredClone(state);
    copy.domains.dataModules.perReply = { 'other-reply/0': { xpFrom: { 'story-block': { Astra: { xp: 9 } } } } };
    return copy;
};

test('a new board record ignores another reply\'s perReply scratch and still sees a changed input', async () => {
    const { board, state } = await fixture();
    const record = recordFor(board, state, false);
    assert.equal(boardGuard({ state, hash: hashJson }, record).ok, true);
    assert.equal(boardGuard({ state: withScratch(state), hash: hashJson }, record).ok, true, 'scratch from another reply is not an input');
    const pinned = structuredClone(state);
    pinned.domains.dataModules.pins = { ...pinned.domains.dataModules.pins, extra: 'changed' };
    assert.equal(boardGuard({ state: pinned, hash: hashJson }, record).ok, false, 'a change to what the fight reads still breaks it');
});

test('an old board record (whole-domain witness) still verifies, with or without other replies\' scratch, and a changed input still breaks it', async () => {
    const { board, state } = await fixture();
    const record = recordFor(board, state, true);
    assert.equal(boardGuard({ state, hash: hashJson }, record).ok, true, 'verifies on the state it was made on');
    const pinned = structuredClone(state);
    pinned.domains.dataModules.pins = { ...pinned.domains.dataModules.pins, extra: 'changed' };
    assert.equal(boardGuard({ state: pinned, hash: hashJson }, record).ok, false);
});
