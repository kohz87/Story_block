// A staged fight is resolved by the production command on a test host.
// The recorded dice, bars and narrator note must match the pre-reply view.

import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentForBoard, playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { settledNote } from '../../../../src/v2/lean-rpg/board/note.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { character, foeBlock, setup } from '../helpers.js';
import { boardSession, discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { planGear } from '../../../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { createFakeModel, createHost } from '../../../../testkit/index.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { gearAnswer } from '../../../../src/v2/domains/gear.js';
import { condOf, defCarry, ENCUMBERED_PENALTY } from '../../../../src/v2/domains/inventory.js';

test('the reply resolver commits exactly the staged exchange and refuses a duplicate claim', async () => {
    const blocks = { hero: { role: 'character', fields: character('Astra') }, foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5]]) } };
    const { host } = await setup({ blocks });
    try {
        const setup = { seed: 24, offset: 0, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } };
        const exchanges = [{ actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }];
        const staged = playBoard(host.head(), setup, exchanges);
        assert.equal(staged.error, undefined);
        const payload = { key: '1-abc', board: { id: 'fight-one', groups: [1], setup, exchanges } };
        const result = host.bus.run('rpg.resolve', payload, { cause: 'system' });
        assert.equal(result.ok, true, result.message);
        const recorded = result.receipt.data.v2.result;
        assert.deepEqual(recorded.rounds, staged.result.rounds);
        assert.deepEqual(recorded.hurts, staged.result.hurts);
        assert.equal(result.receipt.summary, settledNote(recorded));
        for (const hurt of staged.result.hurts) assert.equal(result.state.domains.dataModules.instances[hurt.module].chat.fields[hurt.field], hurt.to);
        const twice = host.bus.run('rpg.resolve', payload, { cause: 'system', state: result.state });
        assert.equal(twice.ok, false);
        assert.equal(twice.code, 'CLAIMED');
    } finally { host.close(); }
});

test('editing a staged sheet holds generation until the original input is restored', async () => {
    const restore = seedCrypto(81);
    const blocks = { hero: { role: 'character', fields: character('Astra', { str: 5 }) }, foes: { role: 'foes', fields: foeBlock([['Rats', 2, 1, 5]]) } };
    const { host, callModel } = await setup({ blocks, board: true });
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
        assert.equal(staged.error, undefined);
        assert.equal((await host.sdk.command('test.set', { slug: 'hero', field: 'str', value: 20 })).ok, true);
        const blocked = await host.send('I strike.', 'Should not be sent.');
        assert.equal(blocked.aborted, true);
        assert.match(host.st.notices.at(-1).reason, /restore|discard/i);
        assert.equal(boardSession(meta).exchanges.length, 1);
        assert.equal(callModel.calls.length, 0);
        assert.equal((await host.sdk.command('test.set', { slug: 'hero', field: 'str', value: 5 })).ok, true);
        const sent = await host.st.generate('normal', { reply: 'The fight continues.' });
        assert.notEqual(sent.aborted, true);
        const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
    } finally { host.close(); restore(); }
});

async function gearHost() {
    const host = await createHost({ callModel: createFakeModel(Array(10).fill('')), settings: { features: { 'story-block.gear': true }, modules: { 'story-block': { rpgFormula: 'standard' } } } });
    host.features.set('story-block.rpg', true);
    host.features.set('story-block.fight-board', true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Foes']) await host.sdk.command('dm.define', { definition: structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition) });
    await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', str: 3, dex: 12, agi: 10, vit: 20 } });
    await host.send('Set.', 'Fight.\n<Changes>\n+ dm foes — why | kind: set-slot-1 | name: Rats | count: 6 | level: 60\n+ item Cane Sword | kind: weapon | rarity: rare | DEX: +2 | equipped: weapon\n</Changes>');
    return host;
}

function openWithGear(host) {
    const state = host.head(), query = (name, args) => host.sdk.query(name, args);
    const gear = planGear(readSheet(state), query), weapon = query('inventory.gear', { owner: 'party' }).slots.weapon;
    return openBoard(host.ctx.chatMetadata, state, { sid: host.store.carrierSid(host.store.headIndex()), rules: { ...STANDARD_FORMULA, levelDivisor: 5 }, gear, weapons: { astra: weapon } });
}

test('staging retains the recorded carry penalty when mounts are off', async () => {
    const restore = seedCrypto(7), host = await gearHost();
    try {
        const state = structuredClone(host.head()), stack = Object.values(state.domains.inventory.stacks)[0];
        stack.qty = 16;
        state.domains.scene.mounts = { mare: { name: 'Mare', kind: 'horse', count: 1, pace: 35, condition: '', where: '' } };
        const query = (name, args) => name === 'inventory.gear'
            ? gearAnswer(state, args, { condOf, carryOf: defCarry, penalty: ENCUMBERED_PENALTY, mounts: [] }) : host.sdk.query(name, args);
        const gear = planGear(readSheet(state), query);
        assert.equal(gear.who.astra.enc, -2);
        assert.equal(equipmentForBoard(state, gear).gear.who.astra.enc, -2);
    } finally { host.close(); restore(); }
});

test('unequipping staged gear holds generation and restoring it keeps the rolls', async () => {
    const restore = seedCrypto(7), host = await gearHost();
    try {
        openWithGear(host);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
        const stack = Object.values(host.head().domains.inventory.stacks).find(item => item.equipped === 'weapon');
        assert.equal((await host.sdk.command('inventory.unequip', { stack: stack.id })).ok, true);
        const blocked = await host.send('I strike.', 'Should not be sent.');
        assert.equal(blocked.aborted, true);
        assert.match(host.st.notices.at(-1).reason, /gear.*restore|gear.*discard/i);
        assert.equal((await host.sdk.command('item.equip', { stack: stack.id, slot: 'weapon' })).ok, true);
        const sent = await host.st.generate('normal', { reply: 'The fight continues.' });
        assert.notEqual(sent.aborted, true);
        const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.deepEqual(receipt.data.v2.result.rounds, staged.preview.result.rounds);
    } finally { host.close(); restore(); }
});

test('a weapon breaking in one exchange changes later rolls, including across replies', async () => {
    for (const split of [false, true]) {
        const restore = seedCrypto(7), host = await gearHost();
        try {
            assert.equal(host.bus.command('gear.wear', { owner: 'party', slot: 'weapon', steps: 2 }, { cause: 'system' }).ok, true);
            const meta = host.ctx.chatMetadata, action = [{ who: 'Astra', kind: 'attack', target: 1 }];
            let first;
            for (let attempt = 0; attempt < 200; attempt += 1) {
                assert.equal(openWithGear(host).error, undefined);
                first = stageExchange(meta, host.head(), action);
                if (first.preview?.result.stop === 'open' && first.preview.result.wear?.some(event => event.to === 'broken')) break;
                discardBoard(meta); first = null;
            }
            assert.ok(first, 'found a deterministic break in the first exchange');
            const together = playBoard(host.head(), boardSession(meta).setup, [...boardSession(meta).exchanges, { actions: action }]);
            assert.equal(together.error, undefined);
            assert.ok(together.result.rounds[0].lines.some(line => line.pc?.gear?.some(item => item.name === 'Cane Sword')));
            assert.ok(together.result.rounds[1].lines.every(line => !line.pc?.gear?.some(item => item.name === 'Cane Sword')));
            assert.equal(together.result.rounds[1].lines.find(line => line.kind === 'act').pc.stat, 'str');
            let staged;
            if (split) {
                await host.send('First.', 'The fight continues.');
                staged = stageExchange(meta, host.head(), action);
                assert.equal(staged.error, undefined);
                assert.deepEqual(staged.preview.result.rounds[0], together.result.rounds[1]);
            } else staged = stageExchange(meta, host.head(), action);
            assert.equal(staged.error, undefined);
            await host.send('Strike.', 'The fight goes on.');
            const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
            for (const [key, value] of Object.entries(staged.preview.result)) assert.deepEqual(receipt.data.v2.result[key], value, key);
            assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.cond, 0);
            await host.swipe('Another telling.');
            assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.cond, 0);
            assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
            assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).slots.weapon.cond, 0);
        } finally { host.close(); restore(); }
    }
});
