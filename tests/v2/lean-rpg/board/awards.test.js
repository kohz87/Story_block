// Practice follows each carried exchange and a multi-reply fight pays its opening groups once.
// Swiping, Re-read and deleting a middle reply are exercised through the test host.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { usesOf } from '../../../../src/v2/lean-rpg/practice.js';
import { memberXp } from '../../../../src/v2/lean-rpg/fight.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { boardSession, discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, levelFoeBlock, recordOf, rollReceipt, setup, skillBlock } from '../helpers.js';

test('a fight split over two replies pays both groups once and replays after a swipe', async () => {
    const restore = seedCrypto(82);
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, stamina: 4, level: 1 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'strike one foe']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Rats', 2, 1, 1], ['Spiders', 3, 1, 1]]) },
    };
    const { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        const config = { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } };
        const action = target => [{ who: 'Astra', kind: 'skill', skill: 'Cut', target }];
        let first;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            assert.equal(openBoard(meta, host.head(), config).error, undefined);
            first = stageExchange(meta, host.head(), action(1));
            const result = first.preview?.result, fields = first.preview?.state?.domains?.dataModules?.instances['pack.chat/foes'].chat.fields;
            const next = result?.stop === 'open' && fields?.hurt1 === 0 && fields?.hurt2 > 0
                ? playBoard(first.preview.state, { ...boardSession(meta).setup, offset: 1, order: result.order }, [{ actions: action(2) }]) : null;
            if (next?.result?.stop === 'won') break;
            discardBoard(meta); first = null;
        }
        assert.ok(first, 'found a reproducible two-exchange fight');
        await host.send('I strike.', 'The first group falls.');
        const one = rollReceipt(host, 2).data.v2.result;
        const usedOne = usesOf(one).find(use => use.skill === 'Cut')?.n ?? 0;
        assert.equal(host.head().domains.dataModules.instances['pack.chat/skills'].chat.fields.practice1, usedOne * 3);
        assert.equal(stageExchange(meta, host.head(), action(2)).error, undefined);
        await host.send('I finish it.', 'The fight ends.');
        const two = rollReceipt(host, 4).data.v2.result;
        assert.equal(two.stop, 'won');
        const usedTwo = usesOf(two).find(use => use.skill === 'Cut')?.n ?? 0;
        const practice = () => host.head().domains.dataModules.instances['pack.chat/skills'].chat.fields.practice1;
        const xp = () => host.head().domains.dataModules.instances['pack.chat/hero'].chat.fields.xp;
        assert.equal(practice(), (usedOne + usedTwo) * 3);
        assert.equal(xp(), memberXp([{ count: 2, level: 1 }, { count: 3, level: 1 }], 1));
        assert.ok(xp() > 0, 'the won fight pays XP');
        await host.swipe('A different telling.');
        assert.equal(practice(), (usedOne + usedTwo) * 3);
        assert.equal(xp(), memberXp([{ count: 2, level: 1 }, { count: 3, level: 1 }], 1));
        assert.equal((await host.turn.reread(4)).ok, true);
        assert.equal(practice(), (usedOne + usedTwo) * 3);
        assert.equal(xp(), memberXp([{ count: 2, level: 1 }, { count: 3, level: 1 }], 1));
        assert.equal(callModel.calls.length, 0);

        const finalRounds = JSON.stringify(rollReceipt(host, 4).data.v2.result.rounds);
        const finalRev = rollReceipt(host, 4).rev;
        assert.equal((await host.sdk.rewind({ index: 4, beforeRev: finalRev })).ok, true);
        assert.equal(practice(), usedOne * 3, 'a rewind takes back only the second segment practice');
        assert.equal(xp(), 0, 'a rewind takes back the win award');
        await host.regenerate('The fight ends again.');
        assert.equal(practice(), (usedOne + usedTwo) * 3, 'the replayed win gives practice once');
        assert.equal(xp(), memberXp([{ count: 2, level: 1 }, { count: 3, level: 1 }], 1), 'the replayed win gives XP once');
        assert.equal(JSON.stringify(rollReceipt(host, 4).data.v2.result.rounds), finalRounds, 'the rewind replay keeps the rounds');
        assert.equal(callModel.calls.length, 0);
        assert.equal(recordOf(host, 4).receipts.filter(receipt => receipt.type === 'rpg.fight').length, 1);

        await host.st.deleteMessage(2);
        assert.equal(practice(), usedOne * 3, 'the middle delete leaves the first segment practice');
        assert.equal(xp(), 0, 'the middle delete does not pay the lost win twice');
        const afterDelete = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), afterDelete);
        assert.deepEqual(host.store.problems(), []);
    } finally { host.close(); restore(); }
});
