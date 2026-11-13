// Practice follows each carried exchange and a multi-reply fight pays its opening groups once.
// Swiping, Re-read and deleting a middle reply are exercised through the test host.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { practiceHook, practiceStep, usesOf } from '../../../../src/v2/lean-rpg/practice.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { memberXp } from '../../../../src/v2/lean-rpg/fight.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { carriedFrom } from '../../../../src/v2/lean-rpg/board/members.js';
import { boardSession, discardBoard, openBoard, receiveBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, levelFoeBlock, recordOf, rollReceipt, setup, sheetDomain, skillBlock } from '../helpers.js';

test('more than 40 board skills earn practice once through swipe and Re-read', async () => {
    const restore = seedCrypto(21);
    const blocks = { foes: { role: 'foes', fields: foeBlock([['Rats', 1, 99, 5], ['Bats', 1, 99, 5], ['Spiders', 1, 99, 5], ['Snakes', 1, 99, 5]]) } };
    for (let i = 0; i < 24; i += 1) {
        const n = String(i).padStart(2, '0'), who = `Fighter ${n}`;
        blocks[`hero${n}`] = { role: 'character', fields: character(who, { str: 3, agi: 20, vit: 20, health: 5, stamina: 4 }) };
        blocks[`skills${n}`] = { role: 'skills', fields: skillBlock(who, [[`Poke ${n}`, 1, 'str', 'stamina', 'strike one foe'], [`Slash ${n}`, 1, 'str', 'stamina', 'strike one foe']]) };
    }
    const { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, state = host.head(), sid = host.store.carrierSid(host.store.headIndex());
        let staged, uses = [];
        for (let attempt = 0; attempt < 100 && uses.length <= 40; attempt += 1) {
            assert.equal(openBoard(meta, state, { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } }).error, undefined);
            let preview;
            for (let n = 0; n < 12; n += 1) {
                const sheet = readSheet(preview?.state ?? state), target = sheet.foes.find(foe => foe.filled && foe.hurt > 0)?.slot;
                const actions = sheet.characters.filter(actor => actor.alive !== false && actor.health !== 0).map(actor => actor.stamina > 0
                    ? { who: actor.who, kind: 'skill', skill: actor.skills[n % 2].name, target } : { who: actor.who, kind: 'attack', target });
                staged = stageExchange(meta, state, actions);
                if (staged.error) break;
                preview = staged.preview;
                uses = usesOf(preview.result);
                if (uses.length > 40 || preview.result.stop !== 'open') break;
            }
            if (uses.length <= 40) discardBoard(meta);
        }
        assert.ok(uses.length > 40, 'the fight uses more skills than one practice step accepts');
        await host.send('All attack.', 'The battle continues.');
        const rounds = structuredClone(rollReceipt(host, 2).data.v2.result.rounds);
        const check = () => {
            const receipts = recordOf(host, 2).receipts.filter(receipt => receipt.type === 'rpg.practice');
            assert.equal(receipts.length, Math.ceil(uses.length / 40));
            const awarded = receipts.flatMap(receipt => receipt.data.v2.result.practice.skills);
            assert.equal(awarded.length, uses.length);
            for (const { who, skill, n } of uses) {
                const actor = who.slice(-2), slot = skill.startsWith('Poke ') ? 1 : 2;
                const value = host.head().domains.dataModules.instances[`pack.chat/skills${actor}`].chat.fields[`practice${slot}`];
                assert.equal(value, Math.min(20, n * 3), `${who}'s ${skill} is paid once`);
            }
            assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, rounds);
            assert.deepEqual(host.store.problems(), []);
        };
        check();
        await host.swipe('A different telling.');
        check();
        assert.equal((await host.turn.reread(2)).ok, true);
        check();
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});

test('practice batches keep a repeated skill together and the per-reply cap', () => {
    const lines = Array.from({ length: 41 }, (_, n) => ({ pc: { who: `Fighter ${n}` }, skill: 'Cut' }));
    lines.push(...Array.from({ length: 120 }, () => ({ pc: { who: 'Fighter 0' }, skill: 'Cut' })));
    const receipt = { type: 'rpg.resolve', data: { v2: { result: { v: 1, practice: 5, rounds: [{ lines }] } } } };
    const commands = practiceHook({ feature: () => true }, { receipts: [receipt] }).commands;
    const uses = commands.flatMap(command => command.payload.uses);
    assert.deepEqual(commands.map(command => command.payload.uses.length), [40, 1]);
    const repeated = uses.filter(use => use.who === 'Fighter 0');
    assert.equal(repeated.length, 1);
    assert.equal(repeated[0].n, 99);
    const blocks = Object.fromEntries(Array.from({ length: 41 }, (_, n) => [`skills${n}`, { role: 'skills', fields: skillBlock(`Fighter ${n}`, [['Cut']]) }]));
    const domain = sheetDomain(blocks);
    const ctx = { cause: 'system', caller: null, source: { sid: 'reply', swipeKey: '0' }, module: 'story-block', epoch: 1,
        read: () => domain, draft: () => domain, hash: () => 'hash', replayGuard: () => {}, fail: (_code, message) => { throw new Error(message); } };
    const awarded = commands.flatMap(command => practiceStep(ctx, command.payload).data.v2.result.practice.skills);
    assert.equal(awarded.length, 41);
    assert.equal(domain.instances['pack.chat/skills0'].chat.fields.practice1, 20);
    assert.equal(domain.instances['pack.chat/skills40'].chat.fields.practice1, 5);
});

test('a fight split over two replies pays both groups once and replays after a swipe', async () => {
    const restore = seedCrypto(82);
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, stamina: 4, level: 1 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'strike one foe']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Rats', 1, 1, 1], ['Spiders', 1, 1, 1]]) },
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
            const result = first.preview?.result, firstGroupDown = result?.members?.filter(member => member.group === 1).every(member => !member.standing);
            const next = result?.stop === 'open' && firstGroupDown && result.members.some(member => member.group === 2 && member.standing)
                ? playBoard(first.preview.state, { ...boardSession(meta).setup, offset: 1, order: result.order, carriedMembers: carriedFrom(result.members) }, [{ actions: action(2) }]) : null;
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
        assert.equal(xp(), memberXp([{ count: 1, level: 1 }, { count: 1, level: 1 }], 1, false, false, 1.5));
        assert.ok(xp() > 0, 'the won fight pays XP');
        await host.swipe('A different telling.');
        assert.equal(practice(), (usedOne + usedTwo) * 3);
        assert.equal(xp(), memberXp([{ count: 1, level: 1 }, { count: 1, level: 1 }], 1, false, false, 1.5));
        assert.equal((await host.turn.reread(4)).ok, true);
        assert.equal(practice(), (usedOne + usedTwo) * 3);
        assert.equal(xp(), memberXp([{ count: 1, level: 1 }, { count: 1, level: 1 }], 1, false, false, 1.5));
        assert.equal(callModel.calls.length, 0);

        const finalRounds = JSON.stringify(rollReceipt(host, 4).data.v2.result.rounds);
        const finalRev = rollReceipt(host, 4).rev;
        assert.equal((await host.sdk.rewind({ index: 4, beforeRev: finalRev })).ok, true);
        assert.equal(practice(), usedOne * 3, 'a rewind takes back only the second segment practice');
        assert.equal(xp(), 0, 'a rewind takes back the win award');
        await host.regenerate('The fight ends again.');
        assert.equal(practice(), (usedOne + usedTwo) * 3, 'the replayed win gives practice once');
        assert.equal(xp(), memberXp([{ count: 1, level: 1 }, { count: 1, level: 1 }], 1, false, false, 1.5), 'the replayed win gives XP once');
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

test('A1: a count-three win across replies pays its original-count XP once, with no partial XP', async () => {
    const restore = seedCrypto(90);
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { level: 1, str: 20, agi: 20, vit: 20, health: 5 }) },
        foes: { role: 'foes', fields: levelFoeBlock([['Boar', 3, 1, 1]]) },
    };
    const { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex()), rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
        const findWin = (initial, original) => {
            let state = initial, local = { rpgFightBoard: structuredClone(original) };
            for (let i = 0; i < 10; i += 1) {
                const board = structuredClone(local.rpgFightBoard), before = playBoard(state, board.setup, []);
                const target = before.result?.members?.find(member => member.standing)?.slot;
                if (!target) return false;
                const actions = [{ who: 'Astra', kind: 'attack', target }], played = playBoard(state, board.setup, [{ actions }]);
                if (played.error) return false;
                state = played.state;
                if (played.result.stop === 'won') return i >= 2;
                if (played.result.stop !== 'open') return false;
                board.exchanges = [{ actions }];
                receiveBoard(local, { key: `b:${i}`, board }, played.result, `reply${i}`, `receipt${i}`, state);
            }
            return false;
        };
        let attempt;
        for (attempt = 0; attempt < 150; attempt += 1) {
            const opened = openBoard(meta, host.head(), { sid, rules });
            assert.equal(opened.error, undefined);
            if (findWin(host.head(), opened.session)) break;
            discardBoard(meta);
        }
        assert.ok(attempt < 150, 'found a multi-reply count-three win');

        let latest, partial = [];
        for (let step = 0; step < 10; step += 1) {
            const before = playBoard(host.head(), boardSession(meta).setup, []);
            const target = before.result.members?.find(member => member.standing)?.slot;
            const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target }]);
            assert.equal(staged.error, undefined);
            const sent = await host.send(`Attack ${step}.`, 'The fight continues.');
            latest = rollReceipt(host, sent.index).data.v2.result;
            assert.deepEqual(latest.rounds, staged.preview.result.rounds);
            const xp = host.head().domains.dataModules.instances['pack.chat/hero'].chat.fields.xp;
            if (latest.stop === 'won') break;
            partial.push(xp);
            assert.equal(latest.stop, 'open');
        }
        assert.equal(latest.stop, 'won');
        assert.ok(partial.length >= 2, 'the win took several replies');
        assert.deepEqual(partial, partial.map(() => 0), 'no partial fight pays XP');
        const xp = () => host.head().domains.dataModules.instances['pack.chat/hero'].chat.fields.xp;
        const expected = memberXp([{ count: 3, level: 1 }], 1, false, false, 2);
        assert.equal(expected, 12);
        assert.equal(xp(), expected, 'the win pays for the original count');
        const index = host.store.headIndex(), rounds = JSON.stringify(latest.rounds);
        await host.swipe('Another telling.');
        assert.equal(xp(), expected);
        assert.equal(JSON.stringify(rollReceipt(host, index).data.v2.result.rounds), rounds);
        assert.equal((await host.sdk.reread(index)).ok, true);
        assert.equal(xp(), expected);
        assert.equal(callModel.calls.length, 0);
    } finally { host.close(); restore(); }
});
