// A held fight starts before the narrator reply; the opening and board exchanges replay together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, setup, skillBlock, tailOf } from '../helpers.js';
import { boardSession, markSend, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { pendingStart } from '../../../../src/v2/turn/fight-start.js';
import { dropOf } from '../../../../src/v2/lean-rpg/ambush.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';

const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const known = () => ({ hero: { role: 'character', fields: character('Astra') }, foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5]]) } });
const empty = () => ({ hero: { role: 'character', fields: character('Astra', { agi: 20 }) },
    skills: { role: 'skills', fields: skillBlock('Astra', [['Sneak', 2, 'agi', 'stamina', 'hide before the fight']]) },
    foes: { role: 'foes', fields: foeBlock([]) } });
const answer = ['foe Rats | new | count: 1 | level: 2', 'check Astra | skill: Sneak | type: check | difficulty: normal | ambush', 'act Astra | target: Rats | type: physical', 'foe Rats | target: Astra'].join('\n');
const boardReceipt = (host, index) => host.ctx.chat[index].extra.storySuite.receipts.findLast(receipt => receipt.type === 'rpg.resolve' && receipt.replan?.payload?.board);

test('known foes: a fight action pauses without a planner call; narrating resumes the ordinary planner', async () => {
    const restore = seedCrypto(501), { host, callModel } = await setup({ blocks: known(), board: true, answers: ['act Astra | target: Rats | type: physical\nfoe Rats | target: Astra'] });
    try {
        const stopped = await host.send('I strike the rats.', 'Not sent.');
        assert.equal(stopped.aborted, true);
        assert.equal(callModel.calls.length, 0);
        const pending = pendingStart(host.ctx.chatMetadata, host.ctx.chat);
        assert.equal(pending.mode, 'known');
        pending.choice = 'narrate';
        const sent = await host.st.generate('regenerate', { reply: 'The fight.' });
        assert.equal(sent.aborted, undefined);
        assert.equal(callModel.calls.length, 1);
        assert.match(tailOf(sent.request), /Tell them in this order and as given/);
        assert.match(tailOf(sent.request), /never set those yourself/);
        assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
    } finally { host.close(); restore(); }
});

test('a non-fight message and the board-off path do not pause', async () => {
    for (const board of [false, true]) {
        const restore = seedCrypto(502), { host } = await setup({ blocks: known(), board, answers: ['none'] });
        try {
            const sent = await host.send(board ? 'I greet them.' : 'I strike the rats.', 'A reply.');
            assert.equal(sent.aborted, undefined);
            assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
        } finally { host.close(); restore(); }
    }
});

test('new foes: the held seeded approach and board exchanges survive swipe, Re-read and rebuild', async () => {
    const restore = seedCrypto(503), { host, callModel } = await setup({ blocks: empty(), board: true, answers: [answer] });
    try {
        const stopped = await host.send('I sneak up and attack the rats.', 'Not sent.');
        assert.equal(stopped.aborted, true);
        assert.equal(callModel.calls.length, 1);
        const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat);
        assert.equal(pending.mode, 'new');
        assert.equal(pending.result.opened[0].name, 'Rats');
        assert.equal(pending.result.checks.length, 1);
        const opening = host.turn.fightStartPreview();
        assert.deepEqual(opening.result.checks, pending.result.checks);
        assert.equal(opening.result.ambush.success, true);
        const sid = host.store.carrierSid(host.store.headIndex());
        const made = openBoard(meta, opening.state, { sid, rules });
        assert.equal(made.error, undefined);
        Object.assign(made.session.setup, { opening: structuredClone(pending.opening), approach: structuredClone(opening.result.checks), drop: dropOf(opening.result) });
        pending.choice = 'board';
        const staged = stageExchange(meta, opening.state, [{ who: 'Astra', kind: 'attack', target: 1 }]);
        assert.equal(staged.error, undefined);
        assert.equal(staged.preview.result.rounds[0].lines.find(line => line.kind === 'act').pc.edge, 2);
        const rounds = structuredClone(staged.preview.result.rounds), checks = structuredClone(opening.result.checks);
        await host.st.loadChat(structuredClone(host.ctx.chat), 'staged-opening-reload');
        assert.deepEqual(host.turn.fightStartPreview().result.checks, checks);
        assert.equal(pendingStart(meta, host.ctx.chat).choice, 'board');
        host.settings.set('story-block', 'rpgPracticePerUse', 5);
        assert.equal(markSend(meta, pending, boardSession(meta)), true); // what the Send button does before it generates
        const sent = await host.st.generate('regenerate', { reply: 'The approach and fight.' });
        assert.equal(sent.aborted, undefined);
        const receipt = boardReceipt(host, sent.index);
        assert.deepEqual(receipt.data.v2.result.rounds, rounds);
        assert.deepEqual(receipt.data.v2.result.checks, checks);
        assert.equal(host.head().domains.dataModules.instances['pack.chat/skills'].chat.fields.practice1, 3, 'the approach skill is practised once');
        assert.equal(host.head().domains.dataModules.instances['pack.chat/hero'].chat.fields.stamina, 3, 'the approach cost is applied once');
        assert.equal(callModel.calls.length, 1);
        assert.match(tailOf(sent.request), /Sneak/);
        assert.match(tailOf(sent.request), /Exchange 1/);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal((await host.sdk.reread(sent.index)).ok, true);
        assert.deepEqual(boardReceipt(host, sent.index).data.v2.result.rounds, rounds);
        assert.equal(host.head().domains.dataModules.instances['pack.chat/skills'].chat.fields.practice1, 3);
        await host.swipe('The same fight again.');
        assert.deepEqual(boardReceipt(host, sent.index).data.v2.result.rounds, rounds);
        assert.deepEqual(boardReceipt(host, sent.index).data.v2.result.checks, checks);
        assert.equal(callModel.calls.length, 1);
        assert.ok(!boardSession(meta) || boardSession(meta).anchor === host.store.carrierSid(host.store.headIndex()));
    } finally { host.close(); restore(); }
});

test('a waiting opening survives reload, and Narrate reuses its approach dice', async () => {
    const restore = seedCrypto(504), { host, callModel } = await setup({ blocks: empty(), board: true, answers: [answer] });
    try {
        assert.equal((await host.send('I sneak up and attack the rats.', '')).aborted, true);
        const saved = structuredClone(host.ctx.chat), before = structuredClone(host.ctx.chatMetadata.rpgFightStart);
        await host.st.loadChat(saved, 'waiting-reload');
        const pending = pendingStart(host.ctx.chatMetadata, host.ctx.chat);
        assert.deepEqual(pending.result.checks, before.result.checks);
        pending.choice = 'narrate';
        const sent = await host.st.generate('regenerate', { reply: 'A narrated fight.' });
        const roll = host.ctx.chat[sent.index].extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve');
        const unmark = list => list.map(({ ambushDrop: _drop, ...check }) => check);
        assert.deepEqual(unmark(roll.data.v2.result.checks), unmark(before.result.checks));
        assert.equal(callModel.calls.length, 1);
        assert.match(tailOf(sent.request), /Tell them in this order and as given/);
        assert.match(tailOf(sent.request), /never set those yourself/);
    } finally { host.close(); restore(); }
});

test('branch load keeps a staged fight only when its anchor sid is present', async () => {
    const restore = seedCrypto(505), { host } = await setup({ blocks: known(), board: true, answers: ['none'] });
    try {
        await host.send('I wait.', 'A later reply.');
        const meta = host.ctx.chatMetadata, anchor = host.store.carrierSid(host.store.headIndex());
        assert.equal(openBoard(meta, host.head(), { sid: anchor, rules }).error, undefined);
        assert.equal(stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]).error, undefined);
        const staged = structuredClone(boardSession(meta)), chat = structuredClone(host.ctx.chat);
        await host.st.loadChat(chat, 'branch-with-anchor');
        assert.deepEqual(boardSession(meta), staged);
        await host.st.loadChat(chat.slice(0, 1), 'branch-before-anchor');
        assert.equal(boardSession(meta), null);
    } finally { host.close(); restore(); }
});

test('a new fight with no approach check still opens before the reply', async () => {
    const restore = seedCrypto(506), { host } = await setup({ blocks: empty(), board: true,
        answers: ['foe Rats | new | count: 1 | level: 2\nact Astra | target: Rats | type: physical'] });
    try {
        const stopped = await host.send('I attack the rats.', 'Not yet.');
        assert.equal(stopped.aborted, true);
        const pending = pendingStart(host.ctx.chatMetadata, host.ctx.chat);
        assert.equal(pending.mode, 'new');
        assert.equal(pending.result.opened[0].name, 'Rats');
        assert.deepEqual(pending.result.checks, []);
    } finally { host.close(); restore(); }
});

test('an opening and its exchange survive deleting an earlier message pair', async () => {
    const restore = seedCrypto(507), { host, callModel } = await setup({ blocks: empty(), board: true, answers: [answer] });
    try {
        await host.send('I wait.', 'Earlier.');
        assert.equal((await host.send('I sneak up and attack the rats.', 'Not yet.')).aborted, true);
        const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat), opening = host.turn.fightStartPreview();
        const made = openBoard(meta, opening.state, { sid: host.store.carrierSid(host.store.headIndex()), rules });
        Object.assign(made.session.setup, { opening: structuredClone(pending.opening), approach: structuredClone(opening.result.checks), drop: dropOf(opening.result) });
        pending.choice = 'board';
        const staged = stageExchange(meta, opening.state, [{ who: 'Astra', kind: 'attack', target: 1 }]);
        assert.equal(staged.error, undefined);
        const rounds = structuredClone(staged.preview.result.rounds), checks = structuredClone(opening.result.checks);
        assert.equal(markSend(meta, pending, boardSession(meta)), true); // what the Send button does before it generates
        const sent = await host.st.generate('regenerate', { reply: 'The fight.' });
        assert.equal(sent.aborted, undefined);
        await host.st.deleteMessage(2);
        await host.st.deleteMessage(1);
        const receipt = boardReceipt(host, 2);
        assert.deepEqual(receipt.data.v2.result.rounds, rounds);
        assert.deepEqual(receipt.data.v2.result.checks, checks);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal(callModel.calls.length, 1);
    } finally { host.close(); restore(); }
});

test('a newly opened board victory awards XP once through swipe and Re-read', async () => {
    const restore = seedCrypto(508);
    const blocks = empty();
    Object.assign(blocks.hero.fields, { str: 20, dex: 20, agi: 20, vit: 20, soul: 1 });
    const { host } = await setup({ blocks, board: true,
        answers: ['foe Rats | new | count: 1 | level: 1\nact Astra | target: Rats | type: physical'] });
    try {
        assert.equal((await host.send('I attack the rats.', 'Not yet.')).aborted, true);
        const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat), opening = host.turn.fightStartPreview();
        const made = openBoard(meta, opening.state, { sid: host.store.carrierSid(host.store.headIndex()), rules });
        Object.assign(made.session.setup, { opening: structuredClone(pending.opening), approach: [], drop: null });
        pending.choice = 'board';
        let played;
        for (let n = 0; n < 20; n += 1) {
            played = stageExchange(meta, opening.state, [{ who: 'Astra', kind: 'attack', target: 1 }]);
            assert.equal(played.error, undefined);
            if (played.preview.result.stop !== 'open') break;
        }
        assert.equal(played.preview.result.stop, 'won');
        assert.equal(markSend(meta, pending, boardSession(meta)), true); // what the Send button does before it generates
        const sent = await host.st.generate('regenerate', { reply: 'The fight ends.' });
        const xp = () => host.head().domains.dataModules.instances['pack.chat/hero'].chat.fields.xp;
        assert.ok(xp() > 0);
        const once = xp();
        assert.equal((await host.sdk.reread(sent.index)).ok, true);
        assert.equal(xp(), once);
        await host.swipe('A different telling.');
        assert.equal(xp(), once);
    } finally { host.close(); restore(); }
});

test('the hold uses the current chat metadata when the host context has changed', async () => {
    const restore = seedCrypto(509), { host } = await setup({ blocks: empty(), board: true, answers: [answer] });
    const previous = globalThis.SillyTavern;
    try {
        const oldMeta = host.ctx.chatMetadata, currentMeta = structuredClone(oldMeta);
        globalThis.SillyTavern = { getContext: () => ({ ...host.ctx, chatMetadata: currentMeta }) };
        assert.equal((await host.send('I sneak up and attack the rats.', '')).aborted, true);
        assert.equal(oldMeta.rpgFightStart, undefined);
        assert.equal(pendingStart(currentMeta, host.ctx.chat).mode, 'new');
        assert.equal(host.turn.fightStartPreview().result.checks.length, 1);
    } finally { globalThis.SillyTavern = previous; host.close(); restore(); }
});
