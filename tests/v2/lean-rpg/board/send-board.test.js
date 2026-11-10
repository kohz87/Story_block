// Round 16: the staged board fight is what the reply carries at Send (never a planner re-roll).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { boardSession } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';

const MSG = 'I attack the boar.';
const SET = 'The boar charges out.\n<Changes>\n+ dm foes — a fight starts | kind: set-slot-1 | name: Bristle-boar | count: 1 | level: 3\n</Changes>';

// A fight against a foe already on the Foes block: the message pauses the send and the reader opens the board (no model is asked).
async function start(t, seed) {
    const restore = seedCrypto(seed);
    t.after(restore);
    const calls = [];
    const callModel = async (...args) => { calls.push(args); return 'none'; };
    const app = await page(t, { formula: 'standard', callModel });
    const { host, doc } = app;
    await begin(host);
    await makeBlocks(host, { character: { str: 8, agi: 8, dex: 2, vit: 20 }, skills: { skill1: 'Obscure', stat1: 'dex', about1: 'hide before a fight' } });
    const foes = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    host.ctx.chatMetadata.rpgFightOffer = undefined;
    await host.send('A boar is near.', SET);
    assert.equal((await host.send(MSG, 'Not yet.')).aborted, true);
    await settle();
    doc.querySelector('.rpg-fight-pause-board').click();
    await settle();
    return { ...app, calls };
}

async function play(app, count, pick = () => true) {
    const { doc, host } = app;
    for (let n = 0; n < count && !doc.querySelector('.rpg-board-send'); n += 1) {
        const choice = [...doc.querySelectorAll('.rpg-board-choice')].find(item => !item.disabled && pick(item.textContent));
        assert.ok(choice, 'a choice is offered');
        choice.click();
        const target = doc.querySelector('.rpg-board-choice');
        if (target && /target/i.test(doc.querySelector('.rpg-board-prompt')?.textContent ?? '')) target.click();
        await new Promise(resolve => setTimeout(resolve, 450));
        await settle();
    }
}

const roll = (host, index) => host.ctx.chat[index].extra.storySuite.receipts.findLast(item => item.type === 'rpg.resolve' && item.replan?.payload?.board);
const stagedRounds = host => {
    const session = boardSession(host.ctx.chatMetadata);
    return structuredClone(playBoard(host.head(), session.setup, session.exchanges).result);
};
const promptOf = sent => sent.request.chat.filter(m => m.role === 'system').map(m => m.content).join('\n');
const sender = host => { const out = {}; host.ctx.generate = type => { out.generation = host.st.generate(type, { reply: 'Told.' }); return out.generation; }; return out; };

// seeds chosen so that the fight takes 4+ exchanges (806: 7; 803 replaced 802 when a reply's story-check dice began drawing from the same seeded stream) and the approach check fails or succeeds
for (const seed of [803, 806]) for (const reload of [false, true]) test(`seed ${seed}: Send with this fight carries every staged exchange, byte for byte, no model call${reload ? ' (after a reload)' : ''}`, async t => {
    const app = await start(t, seed);
    const { host, doc, calls, draw } = app;
    await play(app, 12);
    const session = boardSession(host.ctx.chatMetadata);
    assert.ok(session.exchanges.length >= 4, 'four or more staged exchanges');
    const staged = stagedRounds(host);
    assert.equal(staged.stop, 'won');
    if (reload) {
        const meta = structuredClone(host.ctx.chatMetadata);
        await host.st.loadChat(structuredClone(host.ctx.chat), 'before-send');
        host.ctx.chatMetadata = meta;
        draw();
        host.events.emit('head', { index: host.store.headIndex() });
        await settle();
    }
    const out = sender(host);
    doc.querySelector('.rpg-board-send').click();
    const sent = await out.generation;
    assert.equal(sent.aborted, undefined);
    assert.equal(calls.length, 0, 'no model call at Send');
    const result = roll(host, sent.index).data.v2.result;
    assert.deepEqual(result.rounds, staged.rounds, 'committed rounds == staged rounds (dice and lines)');
    assert.deepEqual(result.checks ?? [], staged.checks ?? []);
    assert.equal(result.stop, 'won');
    assert.equal((promptOf(sent).match(/Exchange \d+/g) ?? []).length, session.exchanges.length, 'every exchange is told');
    // replay == live; swipe and Re-read keep the same rounds
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    assert.equal((await host.sdk.reread(sent.index)).ok, true);
    assert.deepEqual(roll(host, sent.index).data.v2.result.rounds, staged.rounds);
    await host.swipe('Again.');
    assert.deepEqual(roll(host, sent.index).data.v2.result.rounds, staged.rounds);
    assert.equal(calls.length, 0);
});

test('a vanished session and waiting choice at Send: the copy made at the press still carries the staged fight', async t => {
    const app = await start(t, 803);
    const { host, doc, calls } = app;
    await play(app, 12);
    const staged = stagedRounds(host);
    const out = {};
    host.ctx.generate = type => {
        delete host.ctx.chatMetadata.rpgFightBoard; delete host.ctx.chatMetadata.rpgFightStart;
        out.generation = host.st.generate(type, { reply: 'Told.' }); return out.generation;
    };
    doc.querySelector('.rpg-board-send').click();
    const sent = await out.generation;
    assert.equal(sent.aborted, undefined);
    assert.equal(calls.length, 0, 'no model call');
    assert.deepEqual(roll(host, sent.index).data.v2.result.rounds, staged.rounds);
    assert.equal(host.ctx.chatMetadata.rpgFightSend, undefined, 'the copy goes once the reply is received');
});

test('a fight that cannot be attached refuses the send with a reason and calls nothing', async t => {
    const app = await start(t, 803);
    const { host, doc, calls } = app;
    await play(app, 12);
    let generated = 0;
    host.ctx.generate = () => { generated += 1; return Promise.resolve({}); };
    const chat = host.ctx.chat.length;
    host.ctx.chatMetadata.rpgFightBoard.anchor = 'some-other-reply';
    doc.querySelector('.rpg-board-send').click();
    await settle();
    assert.equal(generated, 0, 'nothing is sent');
    assert.equal(calls.length, 0);
    assert.equal(host.ctx.chat.length, chat);
    assert.match(doc.body.textContent, /cannot be attached|no longer matches/);
});

test('a fled fight is carried the same way: staged == committed, no model call', async t => {
    const app = await start(t, 803);
    const { host, doc, calls } = app;
    await play(app, 25, label => /flee|run|retreat/i.test(label));
    const session = boardSession(host.ctx.chatMetadata);
    const staged = stagedRounds(host);
    assert.equal(staged.stop, 'fled');
    assert.ok(session.exchanges.length >= 1);
    const out = sender(host);
    doc.querySelector('.rpg-board-send').click();
    const sent = await out.generation;
    assert.equal(sent.aborted, undefined);
    assert.equal(calls.length, 0);
    const result = roll(host, sent.index).data.v2.result;
    assert.deepEqual(result.rounds, staged.rounds);
    assert.equal(result.stop, 'fled');
    assert.equal(host.ctx.chat[sent.index].extra.storySuite.receipts.some(item => item.type === 'rpg.dice'), false, 'a fight reply is offered no story-check dice');
    assert.equal(/Dice for this reply/u.test(JSON.stringify(sent.request ?? '')), false, 'and its prompt has no dice note');
});

// Round 17: Send is a 'regenerate'; a stale cached payload (rpgFightLast, same anchor) must never beat the staged session.
for (const exchanges of [1, 2]) test(`a stale cached payload with ${exchanges} exchange(s) does not replace the ${'staged'} fight at Send (path c)`, async t => {
    const app = await start(t, 803);
    const { host, doc, calls } = app;
    await play(app, 12);
    const session = boardSession(host.ctx.chatMetadata);
    assert.ok(session.exchanges.length >= 4);
    const staged = stagedRounds(host);
    const stale = structuredClone(session);
    stale.exchanges = stale.exchanges.slice(0, exchanges);
    host.ctx.chatMetadata.rpgFightLast = { key: `b:${encodeURIComponent(stale.id)}:${encodeURIComponent(stale.anchor)}:${stale.setup.offset}`,
        board: { id: stale.id, anchor: stale.anchor, groups: stale.groups, setup: stale.setup, exchanges: stale.exchanges }, practice: 3 };
    const out = sender(host);
    doc.querySelector('.rpg-board-send').click();
    const sent = await out.generation;
    assert.equal(sent.aborted, undefined);
    assert.equal(calls.length, 0);
    const result = roll(host, sent.index).data.v2.result;
    assert.deepEqual(result.rounds, staged.rounds, 'every staged exchange is committed');
    assert.equal(result.stop, 'won');
    assert.equal((promptOf(sent).match(/Exchange \d+/g) ?? []).length, session.exchanges.length);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    assert.equal((await host.sdk.reread(sent.index)).ok, true);
    assert.deepEqual(roll(host, sent.index).data.v2.result.rounds, staged.rounds);
    await host.swipe('Again.');
    assert.deepEqual(roll(host, sent.index).data.v2.result.rounds, staged.rounds);
});

// Round 17b: the waiting reply is released only by "Send with this fight", never by the board holding an exchange.
test('one exchange on the board does not release the waiting reply; only Send with this fight does (path c)', async t => {
    const app = await start(t, 803);
    const { host, doc } = app;
    let chatLength = host.ctx.chat.length;
    const choice = [...doc.querySelectorAll('.rpg-board-choice')].find(item => !item.disabled);
    choice.click();
    const target = doc.querySelector('.rpg-board-choice');
    if (target && /target/i.test(doc.querySelector('.rpg-board-prompt')?.textContent ?? '')) target.click();
    await new Promise(resolve => setTimeout(resolve, 450));
    await settle();
    assert.ok(boardSession(host.ctx.chatMetadata).exchanges.length >= 1);
    for (const type of ['regenerate', 'normal']) {
        const held = await host.st.generate(type, { reply: 'Too early.' });
        assert.equal(held.aborted, true, `${type}: held with one exchange on the board`);
    }
    assert.equal(host.ctx.chat.length, chatLength, 'the waiting message stays, no reply was written');
    assert.equal(host.ctx.chat.at(-1).is_user, true);
    await play(app, 12);
    const session = boardSession(host.ctx.chatMetadata), staged = stagedRounds(host);
    assert.ok(session.exchanges.length >= 4);
    assert.equal((await host.st.generate('regenerate', { reply: 'Still early.' })).aborted, true, 'held with the whole fight staged, before Send');
    const out = sender(host);
    doc.querySelector('.rpg-board-send').click();
    const sent = await out.generation;
    assert.equal(sent.aborted, undefined);
    assert.equal((promptOf(sent).match(/Exchange \d+/g) ?? []).length, session.exchanges.length);
    assert.deepEqual(roll(host, sent.index).data.v2.result.rounds, staged.rounds);
    await host.swipe('Again.');
    assert.deepEqual(roll(host, sent.index).data.v2.result.rounds, staged.rounds, 'a later swipe keeps every exchange');
    const regen = await host.st.generate('regenerate', { reply: 'Once more.' });
    if (!regen.aborted) assert.deepEqual(roll(host, regen.index ?? sent.index).data.v2.result.rounds, staged.rounds);
});
