// The multi-field `dm.set`: `{ module, fields: { name: value, … } }` writes several non-map fields of one block as ONE
// action (one root, one receipt), every value checked as the single form checks it, all or nothing, the rules once after
// all the sets. The single form is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { DM_LIMITS } from '../../../src/v2/data-modules/schema.js';
import { refusalText } from '../../../src/v2/strings.js';
import { definition, pack, pin, reload, view, world } from '../data-modules/helpers.js';
import { readRecord } from '../../../src/v2/persist.js';

function made() {
    const d = definition();
    d.state.mode = { type: 'enum', values: ['calm', 'wary'], default: 'calm' };
    d.state.notes = { type: 'text', max: 8, default: '' };
    d.state.locked = { type: 'int', min: 0, max: 5, default: 1, edit: false };
    d.state.bumps = { type: 'int', min: 0, max: 50, default: 0, label: 'Bumps' };
    d.state.standing = { type: 'map', keys: ['guild', 'watch'], values: { type: 'int', min: -5, max: 5, default: 0 } };
    // An add, not a set: if the rules ran after each field instead of once after all of them, `bumps` would count twice.
    d.rules = [{ id: 'threshold', when: ['ge', ['get', ['points']], 5], then: [{ op: 'add', path: ['bumps'], value: 1, bounds: 'clamp' }] }];
    return d;
}
async function setup(t) {
    const host = await world(t, pack([made()]));
    const offer = await pin(host);
    await host.send('Wait.', 'The road.');
    return { host, module: offer.module, set: payload => host.sdk.command('dm.set', { module: offer.module, ...payload }) };
}
const receiptsOf = host => readRecord(host.ctx.chat[host.store.headIndex()]).receipts;
const chat = (host, module) => view(host, module).chat;

test('fields: one action sets several fields, names every change and records each one', async t => {
    const { host, module, set } = await setup(t);
    const before = receiptsOf(host).length;
    const result = await set({ fields: { points: 6, mode: 'wary', notes: 'a long note over the limit' } });
    assert.equal(result.ok, true, result.message);
    assert.equal(receiptsOf(host).length - before, 1, 'one receipt');
    assert.equal(result.receipt.data.edit, true);
    assert.equal(result.receipt.summary, 'You set Counter: points 0 → 6, mode "calm" → "wary", notes "" → "a long n".');
    assert.deepEqual(result.receipt.data.v2.result, {
        fields: { points: { from: 0, to: 6 }, mode: { from: 'calm', to: 'wary' }, notes: { from: '', to: 'a long n' } },
        subject: 'chat', rules: ['threshold'],
    });
    assert.equal(result.receipt.data.v2.result.field, undefined, 'no single-form keys on the multi record');
    const now = chat(host, module);
    assert.deepEqual([now.points, now.mode, now.notes], [6, 'wary', 'a long n']);
    assert.equal(now.bumps, 1, 'the rules ran once, after all the sets');
});

test('fields: it is one root of the reply, however many fields it sets', async t => {
    const { host, set } = await setup(t);
    const roots = () => Object.values(host.head().domains.dataModules.perReply).map(entry => entry.roots);
    assert.equal((await set({ fields: { points: 1, mode: 'wary', notes: 'x', bumps: 3 } })).ok, true);
    assert.deepEqual(roots(), [1]);
    assert.equal((await set({ field: 'points', value: 2 })).ok, true);
    assert.deepEqual(roots(), [2]);
});

test('fields: all or nothing, and each value is checked as the single form checks it', async t => {
    const { host, module, set } = await setup(t);
    const before = structuredClone(host.head().domains);
    const receipts = receiptsOf(host).length;
    for (const payload of [
        { fields: { points: 3, mode: 'other' } },
        { fields: { points: 101 } },
        { fields: { points: 3, locked: 2 } },
        { fields: { points: 3, unknown: 1 } },
        { fields: { points: 3, standing: { guild: 1, watch: 1 } } },
        { fields: { points: 3, notes: 5 } },
        { fields: {} },
        { fields: [['points', 3]] },
        { fields: 'points' },
        { fields: { points: 3 }, field: 'mode', value: 'wary' },
        { fields: { points: 3 }, value: 3 },
        { fields: { points: 3 }, key: 'guild' },
        { fields: { points: 3 }, who: 'ca_wessel01' },
        { fields: Object.fromEntries(Array.from({ length: 17 }, (_, at) => [`f${at}`, 1])) },
    ]) {
        const result = await set(payload);
        assert.equal(result.ok, false, JSON.stringify(payload));
        assert.match(result.message, /nothing applied/, JSON.stringify(payload));
    }
    assert.deepEqual(host.head().domains, before, 'a refusal changes nothing');
    assert.equal(receiptsOf(host).length, receipts, 'and leaves no receipt');
    assert.equal(chat(host, module).points, 0);
    // Only the reader may use it, like the single form.
    for (const options of [{ cause: 'story' }, { cause: 'system' }]) {
        const result = await host.bus.command('dm.set', { module, fields: { points: 2 } }, options);
        assert.equal(result.code, 'REFUSED', JSON.stringify(options));
    }
});

test('fields: sixteen is the most, and sixteen fit the reply budget as one action', async t => {
    const d = definition();
    d.state = Object.fromEntries(Array.from({ length: 16 }, (_, at) => [`s${String.fromCharCode(97 + at)}`, { type: 'int', min: 0, max: 20, default: 1 }]));
    d.kinds = {};
    const host = await world(t, pack([d]));
    const offer = await pin(host);
    await host.send('Wait.', 'The road.');
    const fields = Object.fromEntries(Object.keys(d.state).map(name => [name, 7]));
    const result = await host.sdk.command('dm.set', { module: offer.module, fields });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(Object.values(chat(host, offer.module)).filter(value => value === 7).length, 16);
});

test('fields: the single form is exactly as it was', async t => {
    const { host, set } = await setup(t);
    const one = await set({ field: 'points', value: 5 });
    assert.equal(one.ok, true, one.message);
    assert.equal(one.receipt.summary, 'You set Counter: points 0 → 5.');
    assert.deepEqual(one.receipt.data.v2.result, { field: 'points', subject: 'chat', from: 0, to: 5, rules: ['threshold'] });
    const map = await set({ field: 'standing', key: 'guild', value: 3 });
    assert.equal(map.receipt.summary, 'You set Counter: standing (guild) 0 → 3.');
    assert.deepEqual(map.receipt.data.v2.result, { field: 'standing', key: 'guild', subject: 'chat', from: 0, to: 3, rules: ['threshold'] });
    for (const payload of [{ field: 'locked', value: 2 }, { field: 'standing', key: 'other', value: 1 }, { field: 'points', value: 101 }]) assert.equal((await set(payload)).ok, false);
});

for (const removal of ['swipe', 'delete']) {
    test(`fields: survives a rebuild, a reload and a Re-read, and leaves with a ${removal}`, async t => {
        const { host, module, set } = await setup(t);
        const index = host.store.headIndex(), before = structuredClone(host.head().domains);
        const result = await set({ fields: { points: 6, mode: 'wary', bumps: 7 } });
        assert.equal(result.ok, true, result.message);
        const live = structuredClone(host.head().domains);
        host.store.rebuild();
        assert.deepEqual(host.head().domains, live, 'a cold rebuild gives the live state');
        await reload(host);
        assert.deepEqual(host.head().domains, live, 'a reload gives it too');
        const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
        t.after(() => loaded.close());
        assert.deepEqual(loaded.head().domains, live);
        const reread = await host.turn.reread(index);
        assert.equal(reread.ok, true, reread.message);
        assert.deepEqual(host.head().domains, live, 'a Re-read keeps it');
        assert.equal(chat(host, module).bumps, 8);
        if (removal === 'swipe') await host.swipe('Another road.');
        else await host.st.deleteMessage(index);
        assert.deepEqual(host.head().domains, before);
        host.store.rebuild();
        assert.deepEqual(host.head().domains, before);
    });
}

test('fields: a changed earlier prerequisite keeps the whole edit off with a Problem', async t => {
    const host = await world(t, pack([made()]));
    const offer = await pin(host);
    await host.send('Gain.', 'The story.\n<Changes>\n+ dm counter — gain | kind: gain\n</Changes>');
    const earlier = host.store.headIndex();
    await host.send('Wait.', 'The road.');
    const result = await host.sdk.command('dm.set', { module: offer.module, fields: { points: 6, mode: 'wary' } });
    assert.equal(result.ok, true, result.message);
    await host.st.editMessage(earlier, 'The story changes.');
    assert.equal((await host.sdk.reread(earlier)).ok, true);
    const now = chat(host, offer.module);
    assert.deepEqual([now.points, now.mode], [0, 'calm'], 'neither field is applied');
    assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
});

test('a full reply budget is refused with DM_BUDGET and told to the reader in plain words', async t => {
    const { host, module, set } = await setup(t);
    let last = null;
    for (let at = 0; at <= DM_LIMITS.replyRoots; at += 1) {
        last = await set({ field: 'points', value: at % 2 });
        if (!last.ok) break;
    }
    assert.equal(last.ok, false);
    assert.equal(last.code, 'DM_BUDGET');
    assert.match(last.message, /reply budget exhausted/);
    assert.equal(refusalText(last, 'x'), 'This reply already holds as many changes as one reply can. Send your next message, then try again.');
    assert.equal(refusalText({ ok: false, code: 'DM_BOUNDS', message: 'Counter: out of range; nothing applied.' }, 'x'), 'Counter: out of range; nothing applied.');
    assert.equal(refusalText({ ok: false }, 'Could not save.'), 'Could not save.');
    // The next reply has room again, and the multi-field save takes it as one action.
    await host.send('Next.', 'Another road.');
    const fresh = await set({ fields: { points: 2, mode: 'wary', notes: 'ok' } });
    assert.equal(fresh.ok, true, fresh.message);
    assert.equal(chat(host, module).mode, 'wary');
});
