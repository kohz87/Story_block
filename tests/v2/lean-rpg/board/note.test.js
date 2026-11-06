// The settled account labels defence and puts every gear change beside its exchange.
// It checks the receipt text carried into the narrator's actual prompt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeModel, createHost } from '../../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
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

test('new foes say whether they fight alone or as a pack', () => {
    const note = settledNote({ stop: 'open', members: [{}], opened: [
        { name: 'Bristle-boar', count: 3, level: 1 }, { name: 'Cellar-rat', count: 12, level: 2 },
    ], rounds: [] });
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
        const made = await host.sdk.command('dm.define', { definition: structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition) });
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
    assert.match(prompt, /Cane Sword condition: good → worn/);
    assert.match(prompt, /Coat condition: torn → broken/);
});
