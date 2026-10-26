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
    const host = await world(t, pack(Array.from({ length: 8 }, (_, i) => ({ ...definition(), slug: `m${i}` }))));
    const second = pack(Array.from({ length: 8 }, (_, i) => ({ ...definition(), slug: `m${i}` }))); second.id = 'dm-next';
    success(await host.packs.packs.install(second));
    for (let i = 0; i < 16; i++) { if (i) await host.send('More.', 'A reply.'); await pin(host, [], i); }
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
