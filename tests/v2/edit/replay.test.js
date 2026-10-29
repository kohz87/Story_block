import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { definition, pack } from '../data-modules/helpers.js';

const edits = [
    ['inventory.add', () => ({ name: 'Rope', qty: 2, note: 'dry' })],
    ['inventory.edit', stack => ({ stack, qty: 3, note: 'lit' })],
    ['inventory.drop', stack => ({ stack, qty: 2 })],
    ['wallet.set', () => ({ amount: 25 })],
    ['scene.place', () => ({ name: 'Bluewatch' })],
    ['scene.weather', () => ({ text: 'rain' })],
    ['scene.present', () => ({ set: ['Ren', 'Mira'] })],
    ['dm.set', (_, module) => ({ module, field: 'points', value: 5 })],
];
for (const [type, payload] of edits) for (const removal of ['swipe', 'delete']) {
    test(`${type} survives replay and leaves with ${removal}`, async t => {
        const host = await createHost(); t.after(() => host.close());
        assert.equal((await host.packs.packs.install(pack([definition()]))).ok, true);
        await host.send('Prepare.', 'Found.\n<Changes>\n+ item Torch | qty: 2\n+ coin 10\n</Changes>');
        const offer = host.sdk.query('dataModules.offers')[0];
        const pin = await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash });
        assert.equal(pin.ok, true, pin.message);
        const stack = host.sdk.query('inventory.items')[0].stack;
        await host.send('Act.', 'The road.');
        const index = host.store.headIndex(), before = structuredClone(host.head().domains);
        const result = await host.sdk.command(type, payload(stack, offer.module));
        assert.equal(result.ok, true, result.message);
        assert.equal(result.receipt.data.edit, true);
        const live = structuredClone(host.head().domains);
        host.store.rebuild();
        assert.deepEqual(host.head().domains, live);
        const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
        t.after(() => loaded.close());
        assert.deepEqual(loaded.head().domains, live);
        const reread = await host.turn.reread(index);
        assert.equal(reread.ok, true, reread.message);
        assert.deepEqual(host.head().domains, live);
        if (removal === 'swipe') await host.swipe('Another road.');
        else await host.st.deleteMessage(index);
        assert.deepEqual(host.head().domains, before);
        host.store.rebuild();
        assert.deepEqual(host.head().domains, before);
    });
}

for (const type of ['inventory.edit', 'inventory.drop']) test(`${type} stays off with a Problem when its item disappears on Re-read`, async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Find.', 'Found.\n<Changes>\n+ item Torch | qty: 2\n</Changes>');
    const earlier = host.store.headIndex(), stack = host.sdk.query('inventory.items')[0].stack;
    await host.send('Act.', 'The road.');
    const result = await host.sdk.command(type, { stack, qty: type === 'inventory.edit' ? 3 : 2 });
    assert.equal(result.ok, true, result.message);
    await host.st.editMessage(earlier, 'Nothing was found.');
    const reread = await host.sdk.reread(earlier);
    assert.equal(reread.ok, true, reread.message);
    assert.deepEqual(host.sdk.query('inventory.items'), []);
    assert.ok(host.store.problems().length, 'the missing edit prerequisite is reported');
    const live = structuredClone(host.head()); host.store.rebuild(); assert.deepEqual(host.head(), live);
});

test('an unrelated earlier item does not invalidate an edit that still applies', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Find.', 'Found.\n<Changes>\n+ item Torch | qty: 2\n</Changes>');
    const earlier = host.store.headIndex(), stack = host.sdk.query('inventory.items')[0].stack;
    await host.send('Act.', 'The road.');
    const result = await host.sdk.command('inventory.edit', { stack, note: 'lit' });
    assert.equal(result.ok, true, result.message);
    await host.st.editMessage(earlier, 'Found.\n<Changes>\n+ item Torch | qty: 2\n+ item Rope\n</Changes>');
    const reread = await host.sdk.reread(earlier);
    assert.equal(reread.ok, true, reread.message);
    assert.equal(host.sdk.query('inventory.items').find(item => item.name === 'Torch')?.note, 'lit');
    assert.ok(host.sdk.query('inventory.items').some(item => item.name === 'Rope'));
    assert.equal(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 0);
});

test('a count of separate pieces stays off when that group changes on Re-read', async t => {
    const host = await createHost(); t.after(() => host.close());
    assert.equal((await host.packs.packs.install({ id: 'pieces', version: '1.0.0', requires: { storyBlock: '^2' },
        content: { items: [{ name: 'Lantern', stack: false }] } })).ok, true);
    await host.send('Find.', 'Found.\n<Changes>\n+ item Lantern | qty: 2\n</Changes>');
    const earlier = host.store.headIndex(), stack = host.sdk.query('inventory.items')[0].stack;
    await host.send('Act.', 'The road.');
    const result = await host.sdk.command('inventory.edit', { stack, group: true, qty: 1 });
    assert.equal(result.ok, true, result.message);
    await host.st.editMessage(earlier, 'Found.\n<Changes>\n+ item Lantern | qty: 3\n</Changes>');
    const reread = await host.sdk.reread(earlier);
    assert.equal(reread.ok, true, reread.message);
    assert.equal(host.sdk.query('inventory.items').length, 3);
    assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    const live = structuredClone(host.head()); host.store.rebuild(); assert.deepEqual(host.head(), live);
});
