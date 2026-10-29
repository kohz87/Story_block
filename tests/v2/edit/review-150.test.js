// Review 148r: ordinary edits follow their non-leading reply, and item choices are replay prerequisites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { inventoryEditGuard } from '../../../src/v2/domains/inventory.js';
import { hashJson } from '../../../src/v2/replay.js';
import { definition, pack, reload } from '../data-modules/helpers.js';

const change = (...lines) => `Changed.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const items = host => host.sdk.query('inventory.items').map(({ name, qty, note }) => ({ name, qty, note })).sort((a, b) => a.name.localeCompare(b.name));
const problems = host => host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE');

for (const removal of ['delete', 'swipe']) test(`a non-leading reply's edits go with its ${removal}, including across checkpoints`, async t => {
    const host = await createHost({ storeOptions: { checkpointEvery: 1 } });
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(pack([definition()]))).ok, true);
    await host.send('Prepare.', 'The beginning.');
    const offer = host.sdk.query('dataModules.offers')[0];
    assert.equal((await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash })).ok, true);
    await host.send('Edit.', 'A reply to edit.');
    const edited = host.store.headIndex();
    const before = { wallet: host.head().domains.inventory.wallets.party?.coin ?? 0,
        place: host.head().domains.scene.place, points: host.sdk.query('dataModules.view', { module: offer.module }).chat.points };
    for (const [type, payload] of [
        ['wallet.set', { amount: 125 }], ['inventory.add', { name: 'Rope', qty: 2 }],
        ['scene.place', { name: 'Bluewatch' }], ['dm.set', { module: offer.module, field: 'points', value: 5 }],
    ]) {
        const result = await host.sdk.command(type, payload);
        assert.equal(result.ok, true, result.message);
    }
    assert.equal(host.head().domains.inventory.wallets.party.coin, 125);
    assert.equal(items(host).find(item => item.name === 'Rope').qty, 2);
    assert.equal(host.head().domains.scene.place.name, 'Bluewatch');
    assert.equal(host.sdk.query('dataModules.view', { module: offer.module }).chat.points, 5);
    if (removal === 'swipe') {
        await host.swipe('Another version.');
        await host.st.swipeTo(edited, 0);
        assert.equal(host.head().domains.inventory.wallets.party.coin, 125);
        assert.equal(items(host).find(item => item.name === 'Rope').qty, 2);
        assert.equal(host.head().domains.scene.place.name, 'Bluewatch');
        assert.equal(host.sdk.query('dataModules.view', { module: offer.module }).chat.points, 5);
    }
    await host.send('Continue.', change('+ item Lantern'));
    if (removal === 'delete') await host.st.deleteMessage(edited);
    else await host.st.swipeTo(edited, 1);
    assert.equal(host.head().domains.inventory.wallets.party?.coin ?? 0, before.wallet);
    assert.equal(items(host).some(item => item.name === 'Rope'), false);
    assert.equal(items(host).find(item => item.name === 'Lantern').qty, 1);
    assert.deepEqual(host.head().domains.scene.place, before.place);
    assert.equal(host.sdk.query('dataModules.view', { module: offer.module }).chat.points, before.points);
    await reload(host);
});

test('deleting the oldest remaining edited reply carries its ordinary edits forward', async t => {
    const host = await createHost({ storeOptions: { checkpointEvery: 1 } }); t.after(() => host.close());
    await host.send('First.', 'The first reply.');
    assert.equal((await host.sdk.command('wallet.set', { amount: 125 })).ok, true);
    await host.send('Later.', 'The later reply.');
    await host.st.deleteMessage(0);
    await host.st.deleteMessage(host.ctx.chat.findIndex(message => message.mes === 'The first reply.'));
    assert.equal(host.head().domains.inventory.wallets.party.coin, 125);
    await reload(host);
});

for (const action of ['rename', 'add']) test(`${action} stays off when an earlier Re-read changes its destination note`, async t => {
    const host = await createHost({ storeOptions: { checkpointEvery: 1 } }); t.after(() => host.close());
    await host.send('Find.', change(...(action === 'rename' ? ['+ item Hemp | qty: 2'] : []), '+ item Rope | qty: 3'));
    const source = host.sdk.query('inventory.items').find(item => item.name === 'Hemp')?.stack;
    await host.send('Wait.', 'Nothing changes.');
    const earlier = host.store.headIndex();
    await host.send('Act.', 'The road.');
    const result = action === 'rename' ? await host.sdk.command('inventory.edit', { stack: source, name: 'Rope' })
        : await host.sdk.command('inventory.add', { name: 'Rope', qty: 2, note: '' });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(items(host), [{ name: 'Rope', qty: 5, note: '' }]);
    await host.st.editMessage(earlier, change('~ item Rope | note: wet'));
    assert.equal((await host.sdk.reread(earlier)).ok, true);
    assert.deepEqual(items(host), action === 'rename'
        ? [{ name: 'Hemp', qty: 2, note: '' }, { name: 'Rope', qty: 3, note: 'wet' }]
        : [{ name: 'Rope', qty: 3, note: 'wet' }]);
    assert.ok(problems(host).length, 'the stale action reports REPLAY_PREREQUISITE');
    await reload(host);
    assert.ok(problems(host).length, 'the Problem survives rebuild and reload');
});

for (const action of ['add', 'rename']) test(`${action} witnesses its name, destination and every compatibility input`, async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Find.', change('+ item Hemp | qty: 2', '+ item Rope | qty: 3'));
    const rope = host.sdk.query('inventory.items').find(item => item.name === 'Rope');
    const hemp = host.sdk.query('inventory.items').find(item => item.name === 'Hemp');
    await host.send('Act.', 'The road.');
    const prefix = structuredClone(host.head());
    const payload = action === 'add' ? { name: 'Rope', qty: 2 } : { stack: hemp.stack, name: 'Rope' };
    const type = action === 'add' ? 'inventory.add' : 'inventory.edit';
    const result = await host.sdk.command(type, payload);
    assert.equal(result.ok, true, result.message);
    const { guard, source } = result.receipt.data.v2;
    const check = state => inventoryEditGuard({ state, hash: hashJson }, { guard, source, operation: { type, payload } });
    assert.equal(check(prefix).ok, true);
    const variants = {
        note: stack => { stack.note = 'wet'; }, equipped: stack => { stack.equipped = 'hand'; },
        condition: stack => { stack.cond = 50; }, key: stack => { stack.key = true; },
        owner: stack => { stack.owner = 'ac_other001'; }, destination: (stack, inv) => { delete inv.stacks[stack.id]; },
        name: (stack, inv) => { inv.aliases.rope = inv.stacks[hemp.stack].def; },
    };
    for (const [label, mutate] of Object.entries(variants)) {
        const state = structuredClone(prefix), inv = state.domains.inventory;
        mutate(inv.stacks[rope.stack], inv);
        assert.equal(check(state).ok, false, label);
    }
    const rebased = structuredClone(prefix);
    rebased.domains.inventory.stacks[rope.stack].qty += 1;
    assert.equal(check(rebased).ok, true, 'a compatible destination count can rebase');
    if (action === 'rename') {
        const changed = structuredClone(prefix);
        changed.domains.inventory.stacks[hemp.stack].qty += 1;
        assert.equal(check(changed).ok, false, 'a merge cannot silently discard a changed source quantity');
    }
});

test('an add that made a new stack refuses if an earlier stack becomes its destination', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Find.', change('+ item Rope | qty: 3 | note: wet'));
    const prefix = structuredClone(host.head());
    const rope = host.sdk.query('inventory.items')[0];
    const payload = { name: 'Rope', qty: 2, note: '' };
    const result = await host.sdk.command('inventory.add', payload);
    assert.equal(result.ok, true, result.message);
    const { guard, source } = result.receipt.data.v2;
    const check = state => inventoryEditGuard({ state, hash: hashJson }, { guard, source, operation: { type: 'inventory.add', payload } });
    assert.equal(check(prefix).ok, true);
    prefix.domains.inventory.stacks[rope.stack].note = '';
    assert.equal(check(prefix).ok, false);
});
