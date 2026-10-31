import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { definition, int, pack, pin, reload, spansOf, view, world } from '../data-modules/helpers.js';

const block = (slug = 'notes') => ({ ...definition(), slug, name: 'Notes', kinds: {} });
const id = 'pack.chat/notes';
const success = result => { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result; };

test('chat is reserved for chat blocks and an installed pack with that id contributes no content', async t => {
    const input = { ...pack([definition()]), id: 'chat' };
    const checked = validatePack(input);
    assert.equal(checked.ok, false);
    assert.equal(checked.errors[0].code, 'BAD_ID');
    assert.match(checked.errors[0].message, /reserved/);
    const host = await createHost(); t.after(() => host.close());
    host.ctx.extensionSettings.storySuite.packs = [{ id: 'chat', enabled: true, pack: input }];
    assert.deepEqual(host.packs.packs.packs(), []);
    assert.equal(host.sdk.query('dataModules.offers').length, 0);
});

test('define, redefine and remove are reply-bound and carry only compatible fields', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const madeAt = host.store.headIndex();
    const first = block();
    first.state = { points: int(1, 0, 10), mood: { type: 'text', max: 20, default: '' }, old: int(3) };
    const made = success(await host.sdk.command('dm.define', { definition: first }));
    assert.equal(made.receipt.data.edit, true);
    assert.equal(spansOf(host, 'dm.define')[0].guard.replyBound, true);
    assert.equal(host.sdk.query('dataModules.setup')[0].origin, 'Made in this chat');
    await host.send('Set.', 'A quiet road.');
    success(await host.sdk.command('dm.set', { module: id, field: 'points', value: 7 }));
    success(await host.sdk.command('dm.set', { module: id, field: 'mood', value: 'wary' }));
    await host.send('Change.', 'Another road.');
    const changed = block();
    changed.state = { points: int(2, 0, 5), mood: { type: 'text', max: 20, default: '' }, added: int(4) };
    const edited = success(await host.sdk.command('dm.redefine', { module: id, definition: changed }));
    assert.equal(edited.receipt.data.edit, true);
    assert.equal(spansOf(host, 'dm.redefine')[0].guard.replyBound, true);
    assert.deepEqual(view(host, id).chat, { points: 2, mood: 'wary', added: 4 });
    await reload(host);
    await host.swipe('A different road.');
    assert.deepEqual(view(host, id).chat, { points: 7, mood: 'wary', old: 3 });
    success(await host.sdk.command('dm.redefine', { module: id, definition: changed }));
    await host.send('Remove.', 'A reply.');
    const removeAt = host.store.headIndex();
    const removed = success(await host.sdk.command('dm.remove', { module: id }));
    assert.equal(removed.receipt.data.edit, true);
    assert.equal(spansOf(host, 'dm.remove')[0].guard.replyBound, true);
    assert.equal(view(host, id), null);
    await reload(host);
    await host.st.deleteMessage(removeAt);
    assert.deepEqual(view(host, id).chat, { points: 2, mood: 'wary', added: 4 });
    await host.st.deleteMessage(madeAt);
    assert.equal(view(host, id), null);
    assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    await reload(host);
});

test('block commands refuse other causes, duplicate slugs, bad definitions and pack modules', async t => {
    const caller = { id: 'block-caller', version: '1.0.0', commands: {
        'block-caller.define': (ctx, payload) => ctx.call('dm.define', payload),
        'block-caller.redefine': (ctx, payload) => ctx.call('dm.redefine', payload),
        'block-caller.remove': (ctx, payload) => ctx.call('dm.remove', payload),
    } };
    const host = await world(t, pack(), [caller]);
    await host.send('Begin.', 'Opening.');
    for (const cause of ['story', 'system']) assert.equal((await host.bus.command('dm.define', { definition: block() }, { cause })).code, 'REFUSED');
    assert.equal((await host.bus.command('block-caller.define', { definition: block() }, { cause: 'ui' })).code, 'REFUSED');
    assert.equal((await host.sdk.command('dm.define', {})).ok, false);
    assert.equal((await host.sdk.command('dm.define', { definition: { ...block(), scope: 'character' } })).ok, false);
    success(await host.sdk.command('dm.define', { definition: block() }));
    for (const [type, payload] of [['dm.redefine', { module: id, definition: block() }], ['dm.remove', { module: id }]]) {
        for (const cause of ['story', 'system']) assert.equal((await host.bus.command(type, payload, { cause })).code, 'REFUSED');
        assert.equal((await host.bus.command(`block-caller.${type.slice(3)}`, payload, { cause: 'ui' })).code, 'REFUSED');
    }
    assert.equal((await host.sdk.command('dm.define', { definition: block() })).ok, false);
    assert.equal((await host.sdk.command('dm.redefine', { module: id, definition: block('other') })).ok, false);
    const offer = await pin(host);
    assert.equal((await host.sdk.command('dm.redefine', { module: offer.module, definition: block() })).code, 'REFUSED');
    assert.equal((await host.sdk.command('dm.remove', { module: offer.module })).code, 'REFUSED');
});

test('swiping a removal restores the block and its values', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    success(await host.sdk.command('dm.define', { definition: block() }));
    success(await host.sdk.command('dm.set', { module: id, field: 'points', value: 4 }));
    await host.send('Remove.', 'A reply.');
    success(await host.sdk.command('dm.remove', { module: id }));
    assert.equal(view(host, id), null);
    await host.swipe('Another reply.');
    assert.equal(view(host, id).chat.points, 4);
    await reload(host);
});

test('changing a field type uses the new default instead of carrying an incompatible value', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const first = block(); first.state = { mood: { type: 'text', max: 20, default: 'calm' } };
    success(await host.sdk.command('dm.define', { definition: first }));
    success(await host.sdk.command('dm.set', { module: id, field: 'mood', value: 'wary' }));
    await host.send('Change.', 'A reply.');
    const next = block(); next.state = { mood: { type: 'enum', values: ['calm', 'wary'], default: 'calm' } };
    success(await host.sdk.command('dm.redefine', { module: id, definition: next }));
    assert.equal(view(host, id).chat.mood, 'calm');
    await reload(host);
});

test('each definition action follows its own reply on swipe and delete', async t => {
    for (const action of ['define', 'redefine', 'remove']) for (const removal of ['swipe', 'delete']) {
        const host = await createHost(); t.after(() => host.close());
        await host.send('Begin.', 'Opening.');
        if (action !== 'define') success(await host.sdk.command('dm.define', { definition: block() }));
        await host.send('Change.', 'A reply.');
        const before = structuredClone(view(host, id)), index = host.store.headIndex();
        const changed = block(); changed.state.points = int(4);
        const payload = action === 'define' ? { definition: block() } : action === 'redefine'
            ? { module: id, definition: changed } : { module: id };
        success(await host.sdk.command(`dm.${action}`, payload));
        await reload(host);
        if (removal === 'swipe') await host.swipe('A different reply.');
        else await host.st.deleteMessage(index);
        assert.deepEqual(view(host, id), before, `${action} on ${removal}`);
        await reload(host);
    }
});

test('block field and purpose limits are enforced by the block commands', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const many = block();
    many.state = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`f${i}`, int()]));
    success(await host.sdk.command('dm.define', { definition: many }));
    const before = structuredClone(host.head());
    many.state.f16 = int();
    assert.equal((await host.sdk.command('dm.redefine', { module: id, definition: many })).code, 'DM_BUDGET');
    delete many.state.f16;
    many.prompt = 'x'.repeat(1201);
    assert.equal((await host.sdk.command('dm.redefine', { module: id, definition: many })).ok, false);
    assert.deepEqual(host.head(), before);
    await reload(host);
});
