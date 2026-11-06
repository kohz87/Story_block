// A live edit to a lone foe between board segments must be the basis of its next committed move and replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeModel, createHost } from '../../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { boardSession, discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';

for (const [label, otherCount] of [['real only', 1], ['mixed', 2]]) test(`NEW5: ${label} commits and replays a live lone-foe edit`, async () => {
    const restore = seedCrypto(81), rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
    const host = await createHost({ callModel: createFakeModel(Array(10).fill('')), settings: {
        features: { 'story-block.rpg': true, 'story-block.fight-board': true }, modules: { 'story-block': { rpgFormula: 'standard' } },
    } });
    try {
        host.features.set('story-block.rpg', true);
        host.features.set('story-block.fight-board', true);
        await host.send('Begin.', 'Opening.');
        for (const name of ['Character', 'Foes']) {
            const definition = structuredClone(LEAN_RPG_TEMPLATES.find(template => template.name === name).definition);
            assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
        }
        for (const payload of [
            { module: 'pack.chat/character', fields: { who: 'Astra', str: 20, agi: 20, vit: 20, health: 5 } },
            { module: 'pack.chat/foes', fields: { foe1: 'Bat', count1: 1, level1: 1, hurt1: 4, foe2: 'Wolf', count2: otherCount, level2: 1, hurt2: 4 } },
        ]) assert.equal((await host.sdk.command('dm.set', payload)).ok, true);
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        const actions = [{ who: 'Astra', kind: 'attack', target: 1 }];
        let staged;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const opened = openBoard(meta, host.head(), { sid, rules });
            assert.equal(opened.error, undefined, opened.error);
            staged = stageExchange(meta, host.head(), actions);
            const bar = staged.preview?.result.members.find(member => member.slot === 1)?.value;
            if (staged.preview?.result.stop === 'open' && bar > 0 && bar < 4) break;
            discardBoard(meta); staged = null;
        }
        assert.ok(staged, 'the first segment leaves the real foe wounded and the fight open');
        const first = await host.send('Strike the bat.', 'The fight goes on.');
        assert.equal(first.aborted, undefined);
        const module = readSheet(host.head()).foes[0].module, wounded = readSheet(host.head()).foes[0].hurt;
        assert.ok(wounded > 0 && wounded < 4);
        assert.equal((await host.sdk.command('dm.set', { module, fields: { hurt1: 4 } })).ok, true);
        const session = boardSession(meta), preview = playBoard(host.head(), session.setup, []);
        assert.equal(preview.result.members.find(member => member.slot === 1).value, 4);
        if (otherCount > 1) assert.equal(preview.result.members.filter(member => member.group === 2).length, otherCount);
        let move;
        for (let n = 0; n < 8 && !move; n += 1) {
            const next = stageExchange(meta, host.head(), actions);
            assert.equal(next.error, undefined, next.error);
            move = next.preview.result.hurts.find(hurt => hurt.id === 'f:1');
        }
        assert.ok(move, 'a staged attack reaches the healed foe');
        assert.equal(move.from, 4);
        const sent = await host.send('Strike again.', 'The bat reels.');
        assert.equal(sent.aborted, undefined);
        const receipt = host.ctx.chat[sent.index].extra.storySuite.receipts.find(entry => entry.type === 'rpg.resolve' && entry.replan?.payload?.board);
        const recorded = receipt.data.v2.result.hurts.find(hurt => hurt.id === 'f:1');
        assert.deepEqual([recorded.from, recorded.to], [move.from, move.to]);
        assert.equal(readSheet(host.head()).foes[0].hurt, move.to);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'rebuild replays the edit and the committed move');
        assert.equal((await host.sdk.reread(sent.index)).ok, true);
        assert.equal(JSON.stringify(host.head()), live, 'Re-read preserves the edited-field result');
    } finally { host.close(); restore(); }
});
