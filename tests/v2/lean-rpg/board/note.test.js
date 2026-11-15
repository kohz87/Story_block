// The settled account labels defence and puts every gear change beside its exchange.
// It checks the receipt text carried into the narrator's actual prompt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeModel, createHost } from '../../../../testkit/index.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { planGear } from '../../../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { settledNote } from '../../../../src/v2/lean-rpg/board/note.js';
import { discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';

test('the settled note states the defender verdict and keeps each wear event in its exchange', () => {
    const line = outcome => ({ kind: 'foe', pc: { who: 'Astra' }, foe: { name: 'Rats' }, skill: 'Dodge', outcome });
    const note = settledNote({ stop: 'open', rounds: [
        { n: 2, lines: [line('success')] }, { n: 3, lines: [line('fail')] },
    ], wear: [
        { n: 2, who: 'Astra', item: 'Sword', from: 'good', to: 'worn' },
        { n: 3, who: 'Astra', item: 'Coat', from: 'torn', to: 'broken' },
    ] });
    assert.match(note, /Exchange 2: Rats attacks Astra: Astra's defence \(Dodge\): success \| Astra's Sword condition: good → worn/);
    assert.match(note, /Exchange 3: Rats attacks Astra: Astra's defence \(Dodge\): fail \| Astra's Coat condition: torn → broken/);
});

test('a fight without members keeps the settled note byte for byte', () => {
    const line = { kind: 'act', pc: { who: 'Astra' }, foe: { name: 'Rats' }, skill: 'Cut', outcome: 'success',
        damage: { id: 'f:1', name: 'Rats', from: 5, to: 4, size: 5 } };
    assert.equal(settledNote({ stop: 'open', rounds: [{ n: 1, lines: [line] }] }),
        'Tell the settled fight results in order; do not reroll them. | Write [battle] on its own line where the fight is told. | Code has already moved the bars for these results; never set those yourself. | Exchange 1: Astra attacks Rats (Cut): success; Rats health Unhurt → Scratched. | The fight is still open. | The fight is still in progress; do not tell a post-fight aftermath yet.');
});

// Fight length (owner rule, 15 Nov): about 100 words, at most 250 when intense.
const MARK = { fightLen: 1 };
const NORMAL = /Tell the fight in about 100 words: how it opened, the deciding moment, how it ended; the battle log keeps the blow-by-blow\./;
const INTENSE = /Tell the fight in at most 250 words, in up to three short paragraphs: the opening, the turning point, the finish; the battle log keeps the blow-by-blow\./;
const hit = (from, to) => ({ kind: 'act', pc: { who: 'Astra' }, foe: { name: 'Rats' }, skill: 'Cut', outcome: 'success', damage: { id: 'f:1', name: 'Rats', from, to, size: 5 } });
const crowd = (party, foes) => [...Array.from({ length: party }, (_, i) => ({ id: `c:${i}`, name: `P${i}`, party: true })), ...Array.from({ length: foes }, (_, i) => ({ id: `f:${i}`, name: `F${i}`, party: false }))];
const exchanges = (count, line = hit(5, 4)) => Array.from({ length: count }, (_, i) => ({ n: i + 1, lines: [line] }));

test('a normal fight is told in about 100 words', () => {
    const note = settledNote({ stop: 'won', rounds: exchanges(3), order: crowd(1, 2) }, MARK);
    assert.match(note, NORMAL);
    assert.doesNotMatch(note, INTENSE);
});

test('a fight is intense when someone went Down or died', () => {
    assert.match(settledNote({ stop: 'won', rounds: exchanges(2, hit(1, 0)) }, MARK), INTENSE);
    const foeHit = { kind: 'foe', pc: { who: 'Astra' }, foe: { name: 'Rats' }, outcome: 'fail', damage: { id: 'pc:1', name: 'Astra', from: 1, to: 0, size: 5 } };
    assert.match(settledNote({ stop: 'open', rounds: exchanges(1, foeHit) }, MARK), INTENSE);
    assert.match(settledNote({ stop: 'open', rounds: exchanges(1), hurts: [{ id: 'f:1', from: 2, to: 0 }] }, MARK), INTENSE);
});

test('a fight of 20 exchanges is intense and 19 is normal', () => {
    assert.match(settledNote({ stop: 'open', rounds: exchanges(20) }, MARK), INTENSE);
    assert.match(settledNote({ stop: 'open', rounds: exchanges(19) }, MARK), NORMAL);
});

test('a party outnumbered 3 to 1 is intense; 1 against 2 is normal', () => {
    assert.match(settledNote({ stop: 'open', rounds: exchanges(2), order: crowd(1, 3) }, MARK), INTENSE);
    assert.match(settledNote({ stop: 'open', rounds: exchanges(2), order: crowd(2, 6) }, MARK), INTENSE);
    assert.match(settledNote({ stop: 'open', rounds: exchanges(2), order: crowd(1, 2) }, MARK), NORMAL);
    assert.match(settledNote({ stop: 'open', rounds: exchanges(2), order: crowd(2, 5) }, MARK), NORMAL);
});

test('a fight opened without the mark gets no length line', () => {
    const note = settledNote({ stop: 'lost', rounds: exchanges(25, hit(1, 0)) });
    assert.doesNotMatch(note, /Tell the fight in/);
    assert.doesNotMatch(settledNote({ stop: 'lost', rounds: exchanges(25) }, { opened: [] }), /Tell the fight in/);
});

test('a pack counts its foes when the party is outnumbered', () => {
    const members = [{ slot: 11, group: 1, name: 'Rats', count: 6, pack: true }];
    assert.match(settledNote({ stop: 'open', rounds: exchanges(1), members, order: crowd(2, 1) }, MARK), INTENSE);
    assert.match(settledNote({ stop: 'open', rounds: exchanges(1), members, order: crowd(3, 1) }, MARK), NORMAL);
});

test('a lost or fled fight is intense; a won one is not by itself', () => {
    assert.match(settledNote({ stop: 'lost', rounds: exchanges(2) }, MARK), INTENSE);
    assert.match(settledNote({ stop: 'fled', rounds: exchanges(2) }, MARK), INTENSE);
    assert.match(settledNote({ stop: 'won', rounds: exchanges(2) }, MARK), NORMAL);
});

test('a bar of mana or stamina running out is not a death', () => {
    const cost = { kind: 'act', pc: { who: 'Astra' }, foe: { name: 'Rats' }, outcome: 'success', cost: { id: 'pc:1:mana', name: 'Astra', from: 1, to: 0, size: 4 } };
    assert.match(settledNote({ stop: 'open', rounds: exchanges(1, cost) }, MARK), NORMAL);
});

test('new foes say whether they fight alone or as a pack', () => {
    const note = settledNote({ stop: 'open', members: [{}], rounds: [] }, { opened: [
        { name: 'Bristle-boar', count: 3, level: 1 }, { name: 'Cellar-rat', count: 12, level: 2 },
    ] });
    assert.match(note, /New foes: Bristle-boar ×3 \(Lv 1\), each fought on its own, Cellar-rat ×12 \(Lv 2\), fought as a pack\./);
});

test('member and pack damage use the line names and say how many of the pack are about left', () => {
    const members = [{ slot: 12, group: 1, n: 2, name: 'Bristle-boar 2', value: 3, size: 4, pack: false, count: 1 },
        { slot: 11, group: 1, n: 1, name: 'Cellar-rats', value: 5, size: 8, pack: true, count: 12 }];
    const memberLine = { kind: 'act', pc: { who: 'Astra' }, foe: { name: 'Bristle-boar 2', member: true, group: 1 },
        outcome: 'success', damage: { id: 'f:12', name: 'Bristle-boar', from: 4, to: 3, size: 4 } };
    const packLine = { kind: 'act', pc: { who: 'Astra' }, foe: { name: 'Cellar-rats', slot: 11, group: 1 },
        outcome: 'success', damage: { id: 'f:11', name: 'Cellar-rats', from: 8, to: 5, size: 8 } };
    const note = settledNote({ stop: 'open', members, rounds: [{ n: 1, lines: [memberLine, packLine] }] });
    assert.match(note, /Astra attacks Bristle-boar 2: success; Bristle-boar 2 health /);
    assert.match(note, /Cellar-rats health .* \(about 8 of 12 left\)/);
});

test('the carried prompt includes recorded worn and broken gear at their exchange', async t => {
    const wear = { id: 'test-wear', name: 'Test wear', version: '0.0.1', capture: {
        kinds: { hit: { grammar: '~ hit <slot> <steps>' } },
        apply(ctx, change) { const [slot, steps] = change.name.split(' '); return ctx.call('gear.wear', { owner: 'party', slot, steps: Number(steps) }); },
    } };
    const host = await createHost({ modules: [wear], callModel: createFakeModel(Array(10).fill('')), settings: {
        features: { 'story-block.gear': true }, modules: { 'story-block': { rpgFormula: 'standard' } },
    } });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    host.features.set('story-block.fight-board', true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Foes']) {
        const made = await host.sdk.command('dm.define', { definition: structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition) });
        assert.equal(made.ok, true, made.message);
    }
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', str: 3, vit: 20 } })).ok, true);
    await host.send('Set.', 'Ready.\n<Changes>\n+ dm foes — why | kind: set-slot-1 | name: Rats | count: 6 | level: 60\n+ item Cane Sword | kind: weapon | rarity: rare | DEX: +2 | equipped: weapon\n+ item Coat | kind: armour | rarity: rare | equipped: body\n~ hit defence 2\n</Changes>');
    const query = (name, args) => host.sdk.query(name, args), state = host.head();
    const gear = planGear(readSheet(state), query), slots = query('inventory.gear', { owner: 'party' }).slots;
    assert.equal(slots.body?.cond, 39);
    assert.equal(slots.weapon?.cond, 100);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    let found = false;
    for (let attempt = 0; attempt < 1000; attempt += 1) {
        openBoard(meta, state, { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 }, gear, weapons: { astra: slots.weapon } });
        const staged = stageExchange(meta, state, [{ who: 'Astra', kind: 'attack', target: 11 }]);
        const lines = staged.preview?.result?.rounds.flatMap(round => round.lines) ?? [];
        if (['act', 'foe'].every(kind => lines.some(line => line.kind === kind && line.outcome === 'fail' && line.decisive))) { found = true; break; }
        discardBoard(meta);
    }
    assert.ok(found, 'a seeded exchange wears both pieces');
    const sent = await host.send('I strike.', 'A clash.');
    const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
    assert.ok(receipt.data.v2.result.wear.some(item => item.item === 'Cane Sword' && item.to === 'worn'));
    assert.ok(receipt.data.v2.result.wear.some(item => item.item === 'Coat' && item.to === 'broken'));
    const prompt = sent.request.chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
    assert.ok(prompt.includes(receipt.summary));
    assert.match(receipt.summary, /Tell the fight in (about 100|at most 250) words/, 'a fight opened now carries the length line');
    assert.match(prompt, /Cane Sword condition: good → worn/);
    assert.match(prompt, /Coat condition: torn → broken/);
});
