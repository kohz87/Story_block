import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from '../view/mounts/helpers.js';
import { renderDataModules } from '../../../src/v2/data-modules/setup.js';
import { renderLayout } from '../../../src/v2/layout/render.js';
import { DM_LIMITS as L } from '../../../src/v2/data-modules/schema.js';
import { world, pack, definition, pin, success, view, reply, rebuilt, fixture, directorStub } from './helpers.js';

test('reply roots include reader actions and Continues; budget failure leaves the claim free', async t => {
    const d = definition(); d.kinds.gain.labels = { slot: { type: 'enum', values: Array.from({ length: 32 }, (_, i) => i) } };
    d.kinds.gain.oncePerReply = ['slot'];
    const host = await world(t, pack([d])), offer = await pin(host);
    for (let slot = 0; slot < L.replyRoots - 1; slot++) success(await host.sdk.command('dm.act', { module: offer.module, kind: 'gain', labels: { slot } }));
    const before = JSON.stringify(host.head());
    const result = await host.sdk.command('dm.act', { module: offer.module, kind: 'gain', labels: { slot: 31 } });
    assert.equal(result.code, 'DM_BUDGET'); assert.equal(JSON.stringify(host.head()), before);
    await host.send('Next.', reply('+ dm counter — gain | kind: gain | slot: 31'));
    assert.equal(view(host, offer.module).chat.points, 32); rebuilt(host);
});

test('evaluation visits are charged before ordered rules and refuse the entire root', async t => {
    const tree = depth => depth ? ['and', tree(depth - 1), tree(depth - 1)] : true;
    const d = definition(); d.rules = Array.from({ length: 32 }, (_, i) => ({ id: `r${i}`, when: tree(5), then: [] }));
    const host = await world(t, pack([d])); await pin(host); const before = JSON.stringify(host.head());
    await host.send('Expensive.', reply('+ dm counter — gain | kind: gain'));
    assert.ok(host.turn.problems().some(problem => problem.code === 'DM_BUDGET'));
    assert.equal(JSON.stringify(host.head()), before); rebuilt(host);
});

test('generated patch budget counts the actual field writes before append', async t => {
    const d = definition(); d.state = {}; d.rules = []; d.kinds.gain.effects = [];
    for (let i = 0; i < 9; i++) {
        const keys = Array.from({ length: 16 }, (_, j) => `k${j}`);
        d.state[`m${i}`] = { type: 'map', keys, values: { type: 'int', min: 0, max: 100, default: 0 } };
        d.rules.push({ id: `r${i}`, when: true, then: keys.map(key => ({ op: 'add', path: [`m${i}`, key], value: 1 })) });
    }
    const host = await world(t, pack([d])); await pin(host); const before = JSON.stringify(host.head());
    await host.send('Many writes.', reply('+ dm counter — gain | kind: gain'));
    assert.ok(host.turn.problems().some(problem => problem.code === 'DM_BUDGET'));
    assert.equal(JSON.stringify(host.head()), before); rebuilt(host);
});

test('retained pins and canonical subjects are bounded without evicting existing state', async t => {
    const host = await world(t, pack(Array.from({ length: 14 }, (_, i) => ({ ...definition(), slug: `m${i}` }))));
    const second = pack(Array.from({ length: 14 }, (_, i) => ({ ...definition(), slug: `m${i}` }))); second.id = 'dm-next';
    success(await host.packs.packs.install(second));
    for (let i = 0; i < 28; i++) { if (i) await host.send('More.', 'A reply.'); await pin(host, [], i); }
    const third = pack(); third.id = 'dm-last'; success(await host.packs.packs.install(third));
    await host.send('More.', 'A reply.');
    const offer = host.sdk.query('dataModules.offers').at(-1), before = JSON.stringify(host.head());
    assert.equal((await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash })).code, 'DM_BUDGET');
    assert.equal(JSON.stringify(host.head()), before); rebuilt(host);
});

test('Setup inspection/cancel writes nothing and enabling rechecks the displayed installed hashes', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t);
    const before = JSON.stringify({ chat: host.ctx.chat, state: host.head(), meta: host.ctx.chatMetadata });
    renderDataModules(root, { sdk: host.sdk });
    const enable = root.querySelectorAll('button').find(node => node.textContent === 'Enable for this chat');
    assert.ok(enable); enable.click();
    root.querySelectorAll('button').find(node => node.textContent === 'Cancel').click();
    assert.equal(JSON.stringify({ chat: host.ctx.chat, state: host.head(), meta: host.ctx.chatMetadata }), before);
    const offer = host.sdk.query('dataModules.offers')[0], changed = fixture('reputation'); changed.content.dataModules[0].name = 'Updated';
    success(await host.packs.packs.install(changed));
    assert.equal((await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash })).code, 'STALE');
    assert.equal(host.head().domains.dataModules, undefined);
});

test('pinned example screens render their exact view through the existing layout renderer', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t);
    await pin(host); await host.send('Favour.', reply('+ dm reputation — help | kind: gain | faction: guild'));
    const screen = host.sdk.query('dataModules.presentation')[0];
    const rendered = renderLayout(root, screen.layout, { query: host.sdk.query });
    assert.ok(root.textContent.includes('Guild')); assert.ok(root.textContent.includes('3'));
    rendered?.destroy?.();
    const survival = await world(t, fixture('survival'), [directorStub()]); await pin(survival, ['ca_wessel01']);
    const needs = survival.sdk.query('dataModules.presentation')[0];
    renderLayout(root, needs.layout, { query: survival.sdk.query });
    assert.ok(root.textContent.includes('Wessel')); assert.ok(root.textContent.includes('Hunger'));
});

// ---- REPUI: Enable all N for this chat ------------------------------------------------------------------------------------------------

const threeBlocks = () => {
    const source = definition(); source.slug = 'source'; source.name = 'Source'; source.exports = { score: { fields: ['points'] } };
    const reader = definition(); reader.slug = 'reader'; reader.name = 'Reader';
    reader.imports = { score: { query: 'dataModules.public', args: { module: 'pack.dm-test/source', export: 'score' }, mode: 'recorded', projection: ['points'] } };
    const plain = definition(); plain.slug = 'plain'; plain.name = 'Plain';
    return [reader, plain, source];   // (the importing block is listed before the one it reads)
};
const spied = (host, refuse = []) => {
    const calls = [];
    const sdk = { query: host.sdk.query, command: async (type, payload) => {
        calls.push([type, payload.module]);
        if (refuse.includes(payload.module)) return { ok: false, code: 'STALE', message: 'The library changed.' };
        return host.sdk.command(type, payload);
    } };
    return { sdk, calls };
};
const snapshot = host => JSON.stringify({ chat: host.ctx.chat, state: host.head(), meta: host.ctx.chatMetadata });
const named = (root, text) => root.querySelectorAll('button').find(node => node.textContent === text);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Enable all counts the blocks it would enable (also one waiting only for another in the list), the single buttons stay, and it is gone when none is left', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack(threeBlocks()));
    renderDataModules(root, { sdk: host.sdk });
    assert.ok(named(root, 'Enable all 3 for this chat'));
    assert.equal(root.querySelectorAll('button').filter(node => node.textContent === 'Enable for this chat').length, 2, 'each available block keeps its own button (the one waiting on Source has none, as before)');
    assert.equal(root.querySelectorAll('details.ss-dm-details').length, 3, 'What it does stays');
    const done = doc.createElement('div'), all = await world(t, pack([definition()]));
    await pin(all);
    renderDataModules(done, { sdk: all.sdk });
    assert.equal(done.querySelectorAll('.ss-rm-enable-all').length, 0, 'every block already enabled: no button');
});

test('Enable all opens one confirm box with only the block names, and Cancel writes nothing', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack(threeBlocks()));
    const { sdk, calls } = spied(host), before = snapshot(host);
    renderDataModules(root, { sdk });
    named(root, 'Enable all 3 for this chat').click();
    assert.equal(root.querySelectorAll('.ss-rm-confirm').length, 1, 'one box');
    assert.equal(root.querySelector('.ss-rm-confirm-title').textContent, 'Enable 3 blocks for this chat?');
    assert.deepEqual(root.querySelectorAll('.ss-rm-confirm-names li').map(node => node.textContent).sort(), ['Plain', 'Reader', 'Source'], 'names only');
    named(root, 'Cancel').click();
    assert.equal(root.querySelectorAll('.ss-rm-confirm').length, 0);
    assert.ok(named(root, 'Enable all 3 for this chat'), 'back to the button');
    assert.deepEqual(calls, [], 'no command sent');
    assert.equal(snapshot(host), before, 'nothing written');
});

test('Enable all sends dm.pin once per block, the block a block reads first, and every block ends up enabled', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack(threeBlocks()));
    await host.send('Begin.', 'Opening.');
    const { sdk, calls } = spied(host);
    renderDataModules(root, { sdk });
    named(root, 'Enable all 3 for this chat').click();
    named(root, 'Enable all').click();
    for (let i = 0; i < 20 && calls.length < 3; i++) await settle();
    await settle(); await settle();
    assert.deepEqual(calls.map(call => call[0]), ['dm.pin', 'dm.pin', 'dm.pin']);
    assert.ok(calls.findIndex(call => call[1] === 'pack.dm-test/source') < calls.findIndex(call => call[1] === 'pack.dm-test/reader'), 'the exporting block before the one that imports it');
    assert.equal(host.sdk.query('dataModules.offers').length, 3);
    assert.deepEqual(Object.keys(host.head().domains.dataModules.active).sort(), ['pack.dm-test/plain', 'pack.dm-test/reader', 'pack.dm-test/source']);
    assert.equal(root.querySelectorAll('.ss-rm-enable-all').length, 0, 'nothing left to enable');
});

test('a refusal for one block is shown on that block and the others still enable', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack(threeBlocks()));
    await host.send('Begin.', 'Opening.');
    const { sdk, calls } = spied(host, ['pack.dm-test/plain']);
    renderDataModules(root, { sdk });
    named(root, 'Enable all 3 for this chat').click();
    named(root, 'Enable all').click();
    for (let i = 0; i < 20 && calls.length < 3; i++) await settle();
    await settle(); await settle();
    assert.equal(calls.length, 3, 'a refusal does not stop the rest');
    assert.deepEqual(Object.keys(host.head().domains.dataModules.active).sort(), ['pack.dm-test/reader', 'pack.dm-test/source']);
    const row = root.querySelectorAll('.ss-dm-row').find(node => node.dataset.module === 'pack.dm-test/plain');
    assert.match(row.querySelector('.ss-rm-refusal').textContent, /^STALE: The library changed\.$/);
    assert.equal(root.querySelectorAll('.ss-rm-refusal').length, 1, 'only on that block');
    assert.ok(named(root, 'Enable all 1 for this chat'), 'the refused block is still available');
});

// A sdk over the real host whose setup rows say the plain block is character-scoped, with the roster and actors given.
const asCharacterScope = (host, { roster, actors, calls, fail = false }) => ({ command: async (type, payload) => { calls.push([type, payload]); if (fail) throw new Error('chat save failed'); return { ok: true, receipt: { summary: 'Enabled.' } }; },
    query: (name, args) => {
        if (name === 'party.actors') return roster;
        const value = host.sdk.query(name, args);
        return name === 'dataModules.setup' ? value.map(row => row.module === 'pack.dm-test/plain' ? { ...row, definition: { ...row.definition, scope: 'character' }, actors } : row) : value;
    } });

test('Enable all attaches a character block to the reader\'s own character, matched by name', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack(threeBlocks()));
    await host.send('Begin.', 'Opening.');
    const calls = [];
    renderDataModules(root, { sdk: asCharacterScope(host, { roster: [{ id: 'p1', name: 'Wessel', pc: false }, { id: 'p2', name: 'wessel marr', pc: true }], actors: [{ id: 'ca_1', name: 'Rika' }, { id: 'ca_2', name: 'Wessel Marr' }], calls }) });
    named(root, 'Enable all 3 for this chat').click();
    named(root, 'Enable all').click();
    for (let i = 0; i < 20 && calls.length < 3; i++) await settle();
    const plain = calls.find(call => call[1].module === 'pack.dm-test/plain')[1];
    assert.deepEqual(plain.subjects, ['ca_2']);
    assert.deepEqual(Object.keys(plain).sort(), ['hash', 'module', 'packHash', 'subjects'], 'the single button\'s payload shape');
    assert.deepEqual(calls.find(call => call[1].module === 'pack.dm-test/source')[1].subjects, [], 'a chat block has no subjects');
});

test('Enable all says so when no character of the reader\'s is found: in the box and on the block', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack(threeBlocks()));
    await host.send('Begin.', 'Opening.');
    const calls = [];
    renderDataModules(root, { sdk: asCharacterScope(host, { roster: null, actors: [{ id: 'ca_1', name: 'Rika' }], calls }) });
    named(root, 'Enable all 3 for this chat').click();
    assert.ok(root.querySelectorAll('.ss-rm-confirm-names li').some(node => /Plain \(no character of yours found\)/.test(node.textContent)));
    named(root, 'Enable all').click();
    for (let i = 0; i < 20 && calls.length < 3; i++) await settle();
    await settle(); await settle();
    assert.deepEqual(calls.find(call => call[1].module === 'pack.dm-test/plain')[1].subjects, []);
    const row = root.querySelectorAll('.ss-dm-row').find(node => node.dataset.module === 'pack.dm-test/plain');
    assert.match(row.querySelector('.ss-dm-result').textContent, /No character of yours was found to attach/);
});

test('an exception from the command never freezes the Enable all box: the error is shown and the others go on', async t => {
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack(threeBlocks()));
    await host.send('Begin.', 'Opening.');
    const calls = [];
    renderDataModules(root, { sdk: asCharacterScope(host, { roster: null, actors: [], calls, fail: true }) });
    named(root, 'Enable all 3 for this chat').click();
    named(root, 'Enable all').click();
    for (let i = 0; i < 20 && calls.length < 3; i++) await settle();
    await settle(); await settle();
    assert.equal(calls.length, 3, 'each block was tried');
    assert.equal(root.querySelectorAll('.ss-rm-confirm').length, 0, 'the box closed');
    assert.match(root.querySelector('.ss-rm-refusal').textContent, /^ERROR: chat save failed$/);
    assert.ok(named(root, 'Enable all 3 for this chat'), 'the button is back and live');
    assert.equal(named(root, 'Enable all 3 for this chat').disabled === true, false);
});
