// A board fight opens from the last ended fight's exact member bars (resume.js) when the Foes block still reads what the board left.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { boardSession, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { runAuto } from '../../../../src/v2/lean-rpg/board/auto-run.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, levelFoeBlock, rollReceipt, setup } from '../helpers.js';

const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const BLOCKS = {
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 30, health: 9 }) },
    foes: { role: 'foes', fields: levelFoeBlock([['Boars', 3, 2, 6]]) },
};
const records = host => host.store.receipts();

async function fledFight(host) {
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    assert.equal(openBoard(meta, host.head(), { sid, rules: RULES, records: records(host) }).error, undefined);
    assert.equal(boardSession(meta).resumed, undefined, 'a first fight has nothing to resume');
    assert.equal(stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]).error, undefined);
    for (let tries = 0; tries < 6; tries += 1) {
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'flee' }]);
        assert.equal(staged.error, undefined);
        if (staged.preview.result.stop === 'fled') break;
    }
    assert.equal(playBoard(host.head(), boardSession(meta).setup, boardSession(meta).exchanges).result.stop, 'fled');
    await host.send('I fight, then run.', 'Away they go.');
}

test('the next fight against the same foes starts from the fled fight\'s exact bars and says so', async () => {
    const restore = seedCrypto(91);
    const { host } = await setup({ blocks: BLOCKS, board: true });
    try {
        await fledFight(host);
        const result = rollReceipt(host, 2).data.v2.result;
        assert.equal(result.stop, 'fled');
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        const opened = openBoard(meta, host.head(), { sid, rules: RULES, records: records(host) });
        assert.equal(opened.error, undefined, opened.error);
        assert.equal(opened.session.resumed, true);
        const carried = opened.session.setup.carriedMembers;
        assert.deepEqual(Object.values(carried.values), result.members.map(member => member.value), 'the exact bars of the last fight');
        assert.deepEqual(opened.preview.result.members.map(member => member.value), result.members.map(member => member.value), 'the board plays from them');
        assert.equal(opened.session.setup.members, 1);
    } finally { host.close(); restore(); }
});

test('a narrator change to the foes in between rebuilds the members from the block, with no resume', async () => {
    const restore = seedCrypto(91);
    const { host } = await setup({ blocks: BLOCKS, board: true });
    try {
        await fledFight(host);
        assert.equal((await host.sdk.command('test.set', { slug: 'foes', field: 'count1', value: 3 })).ok, true);
        assert.equal((await host.sdk.command('test.set', { slug: 'foes', field: 'hurt1', value: 6 })).ok, true);
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        const opened = openBoard(meta, host.head(), { sid, rules: RULES, records: records(host) });
        assert.equal(opened.error, undefined);
        assert.equal(opened.session.resumed, undefined);
        assert.equal(opened.session.setup.carriedMembers, undefined);
    } finally { host.close(); restore(); }
});

test('a resumed Auto fight replays as live: a swipe and Re-read keep its rounds and bars', async () => {
    const restore = seedCrypto(91);
    const { host, callModel } = await setup({ blocks: BLOCKS, board: true });
    try {
        await fledFight(host);
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        assert.equal(openBoard(meta, host.head(), { sid, rules: RULES, records: records(host) }).session.resumed, true);
        assert.ok(runAuto({ meta, state: host.head(), rules: RULES, cap: 2 }).done >= 1);
        const staged = boardSession(meta), preview = playBoard(host.head(), staged.setup, staged.exchanges).result;
        await host.send('Again.', 'They fight on.');
        const result = rollReceipt(host, 4).data.v2.result, rounds = structuredClone(result.rounds), members = structuredClone(result.members ?? null);
        assert.deepEqual(rounds, preview.rounds);
        await host.swipe('Told another way.');
        assert.deepEqual(rollReceipt(host, 4).data.v2.result.rounds, rounds);
        assert.equal((await host.sdk.reread(4)).ok, true);
        assert.deepEqual(rollReceipt(host, 4).data.v2.result.rounds, rounds);
        assert.deepEqual(rollReceipt(host, 4).data.v2.result.members ?? null, members);
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});
