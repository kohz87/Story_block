// Regression coverage for the reported refused inventory burst and the replay oracle's failure evidence.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../../../testkit/index.js';
import { checkInvariants, rebuildAt } from './helpers/oracle.js';
import { firstDifference } from './helpers/replay-diagnostics.js';

test('refused rare shield then story-given Iron Key equipment leaves every replay unchanged', async t => {
    const host = await createHost({ settings: { features: { 'story-block.gear': true, 'story-block.rpg': true } } });
    t.after(() => host.close());
    await host.send('Search.', 'A key.\n<Changes>\n+ item Iron Key\n</Changes>');
    const index = host.store.headIndex();
    const state = structuredClone(host.head());
    const chat = structuredClone(host.ctx.chat);
    const inventory = state.domains.inventory;
    const key = Object.values(inventory.stacks).find(stack => stack.def === 'story/iron-key');
    assert.equal(inventory.defs['story/iron-key'].kind, 'goods');
    assert.equal(key?.story, true);
    assert.equal(key.owner, 'party');

    const actions = [
        { name: 'Oak Shield', kind: 'equipment', slot: 'head', rarity: 'rare' },
        { name: 'Iron Key', kind: 'equipment', slot: 'accessory-1' },
        { name: 'Iron Key', kind: 'equipment', slot: 'accessory-1' },
    ];
    for (const [i, payload] of actions.entries()) {
        const result = await host.sdk.command('inventory.add', payload);
        assert.equal(result.code, 'REFUSED', result.message);
        assert.match(result.message, i === 0 ? /Rarity and bonuses/ : /already in your things/);
        assert.deepEqual(host.ctx.chat, chat, 'the refused command stores nothing');
        assert.deepEqual(host.head(), state, 'the live state and item definition are unchanged');
        assert.deepEqual(host.store.at(index), state, 'the carrier state is unchanged');
        assert.deepEqual(rebuildAt(host.ctx.chat, index).state, state, 'the independent rebuild agrees');
        host.store.rebuild();
        assert.deepEqual(host.head(), state, 'the host rebuild agrees');
    }
});

test('a replay mismatch reports the field, commands, and complete synthetic chat in the dump', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'state-fuzz-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const previousDir = process.env.FUZZ_DUMP_DIR;
    process.env.FUZZ_DUMP_DIR = dir;
    t.after(() => {
        if (previousDir === undefined) delete process.env.FUZZ_DUMP_DIR;
        else process.env.FUZZ_DUMP_DIR = previousDir;
    });
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Search.', 'A key.\n<Changes>\n+ item Iron Key\n</Changes>');
    const index = host.store.headIndex();
    const id = Object.keys(host.head().domains.inventory.stacks)[0];
    const actual = host.store.at.bind(host.store);
    t.mock.method(host.store, 'at', at => {
        const state = structuredClone(actual(at));
        if (at === index) state.domains.inventory.stacks[id].owner = 'story/iron-key';
        return state;
    });
    const trace = [{ label: 'seed 36 step 94 ui', type: 'inventory.add', payload: { name: 'Iron Key' }, result: { ok: false, code: 'REFUSED' } }];
    assert.throws(() => checkInvariants(host, 'seed 36 step 94 ui', { trace }), error => {
        assert.match(error.message, new RegExp(`/domains/inventory/stacks/${id}/owner`));
        assert.match(error.message, /live="story\/iron-key", rebuilt="party"/);
        assert.match(error.message, /inventory\.add/);
        assert.match(error.message, /Full replay dump:/);
        return true;
    });
    const dump = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0], 'mismatch.json'), 'utf8'));
    assert.equal(dump.index, index);
    assert.deepEqual(dump.chat, host.ctx.chat);
    assert.deepEqual(dump.trace, trace);
    assert.equal(dump.live.domains.inventory.stacks[id].owner, 'story/iron-key');
    assert.equal(dump.rebuilt.domains.inventory.stacks[id].owner, 'party');
    assert.ok(Array.isArray(dump.skipped));
});

test('replay differences distinguish missing fields and escape JSON pointer segments', () => {
    assert.deepEqual(firstDifference({ 'a/b': {} }, { 'a/b': { 'x~y': 'party' } }),
        { path: '/a~1b/x~0y', live: '<missing>', rebuilt: '"party"' });
    assert.deepEqual(firstDifference([1], [1, 2]), { path: '/1', live: '<missing>', rebuilt: '2' });
});

test('a store read that writes to the chat is named, and the dump holds the chat the rebuild read', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'state-fuzz-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Search.', 'A key.\n<Changes>\n+ item Iron Key\n</Changes>');
    const before = structuredClone(host.ctx.chat);
    const actual = host.store.at.bind(host.store);
    t.mock.method(host.store, 'at', at => {
        host.ctx.chat[at].send_date = 'written by a read';
        return actual(at);
    });
    assert.throws(() => checkInvariants(host, 'a read writes', { dumpDir: dir }), error => {
        assert.match(error.message, /store\.at\(\d+\) changed the chat it only reads/);
        return true;
    });
    const dump = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0], 'mismatch.json'), 'utf8'));
    assert.deepEqual(dump.chat, before, 'the dump is the chat before the read');
});

test('a block the oracle skips says why', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Search.', 'A key.\n<Changes>\n+ item Iron Key\n</Changes>');
    const index = host.store.headIndex();
    const chat = structuredClone(host.ctx.chat);
    chat[index].extra.storySuite.ops = [...chat[index].extra.storySuite.ops, { op: 'replace', path: '/meta/nope', value: 1 }];
    chat[index].extra.storySuite.spans = [];
    const { skipped } = rebuildAt(chat, index);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].why, /no \/meta\/nope/);
});
