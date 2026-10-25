// Reply-bound guards (docs/v2/REPLAY.md, "Reply-bound blocks"): a guard may say `replyBound: true`, which retracts
// its block when its reply is deleted or swiped away, even when deleting the earliest replies would otherwise carry
// the formerly known state forward. A guard without it is carried as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { spanProblem } from '../../src/v2/replay.js';
import { harness } from './helpers/guarded.js';

const OWNER = 'zz-pin';
const EPOCH = 'ep_00000001';

function pinner({ bound }) {
    return {
        id: OWNER, name: 'Pinner', version: '0.0.1',
        domains: {
            pin: { initial: () => ({ choice: null }), deferred: true },
            after: { initial: () => ({ n: 0 }), deferred: true },
        },
        commands: {
            'pin.set'(ctx, { choice }) {
                ctx.replayGuard({ owner: OWNER, version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ choice }),
                    predicate: { kind: 'pin', choice }, ...(bound === 'flag' ? { replyBound: bound === 'flag' } : bound === 'false' ? { replyBound: false } : {}) });
                ctx.draft('pin').choice = choice;
                return { summary: `Pinned ${choice}.`, narrate: false };
            },
            'pin.later'(ctx) {
                const after = ctx.draft('after');
                after.n = (after.n ?? 0) + 1;
                return { summary: 'Later.', narrate: false };
            },
        },
        queries: { 'pin.id': state => state.domains.pin?.choice ?? null },
        hooks: { replayGuard: (_view, { guard }) => (guard.owner === OWNER ? { ok: true } : undefined) },
    };
}

async function world(t, bound) {
    const host = await createHost({ modules: [pinner({ bound })], core: false });
    t.after(() => host.close());
    const ui = (type, payload) => host.bus.command(type, payload, { cause: 'ui' });
    assert.equal(host.head().domains.pin, undefined, 'a deferred domain is absent until a command writes it');
    const result = await ui('pin.set', { choice: 'a' });
    assert.equal(result.ok, true, `${result.code}: ${result.message}`);
    await host.send('One.', 'First reply.');
    const later = await ui('pin.later', {});
    assert.equal(later.ok, true, `${later.code}: ${later.message}`);
    await host.send('Two.', 'Second reply.');
    return { host, ui, pinned: () => host.head().domains.pin?.choice ?? null };
}
const reload = async host => {
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live head');
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live head');
};

test('a reply-bound pin on the first reply is retracted when that reply is deleted, and the state after it is kept', async t => {
    const { host, pinned } = await world(t, 'flag');
    assert.equal(pinned(), 'a');
    const span = host.ctx.chat[0].extra.storySuite.spans.find(each => each.guard);
    assert.equal(span.guard.replyBound, true);
    assert.equal(spanProblem(span), '');
    await host.st.deleteMessage(0);
    assert.equal(pinned(), null, 'the pin goes with its reply');
    assert.equal(host.head().domains.after.n, 1, 'what later replies did stays');
    await reload(host);
    assert.equal(pinned(), null);
});

test('the same pin without replyBound is carried forward when the first reply is deleted (the control)', async t => {
    for (const bound of ['none', 'false']) {
        const { host, pinned } = await world(t, bound);
        await host.st.deleteMessage(0);
        assert.equal(pinned(), 'a', `replyBound ${bound}: carried as before`);
        await reload(host);
        assert.equal(pinned(), 'a');
    }
});

test('a reply-bound pin is retracted when its reply is swiped away, as any block of that swipe is', async t => {
    const { host, pinned } = await world(t, 'flag');
    const message = host.ctx.chat[0];
    message.swipes.push('Another beginning.');
    message.swipe_info.push({ send_date: '', extra: {} });
    await host.st.swipeTo(0, message.swipes.length - 1);
    assert.equal(pinned(), null);
    assert.equal(host.head().domains.after.n, 1);
    await reload(host);
    assert.equal(pinned(), null);
});

test('a Re-read of the pinned reply keeps a reply-bound pin: the reply is still there', async t => {
    const { host, pinned } = await world(t, 'flag');
    host.ctx.chat[0].mes = `${host.ctx.chat[0].mes} Edited.`;
    host.ctx.chat[0].swipes[0] = host.ctx.chat[0].mes;
    const result = await host.turn.reread(0);
    assert.equal(result.ok, true, `${result.code}: ${result.message}`);
    assert.equal(pinned(), 'a');
    assert.deepEqual(host.store.problems(), []);
    await reload(host);
    assert.equal(pinned(), 'a');
});

test('deleting a later reply leaves a reply-bound pin alone', async t => {
    const { host, pinned } = await world(t, 'flag');
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(pinned(), 'a');
    await reload(host);
    assert.equal(pinned(), 'a');
});

test('replyBound must be true or false', async t => {
    const host = await createHost({ modules: [pinner({ bound: 'none' })], core: false });
    t.after(() => host.close());
    assert.equal((await host.bus.command('pin.set', { choice: 'a' }, { cause: 'ui' })).ok, true);
    const span = host.ctx.chat[0].extra.storySuite.spans.find(each => each.guard);
    assert.equal(spanProblem(span), '');
    assert.ok(!Object.hasOwn(span.guard, 'replyBound'), 'a guard that does not say it carries no field: stored bytes are unchanged');
    assert.match(spanProblem({ ...span, guard: { ...span.guard, replyBound: 'yes' } }), /replyBound is true or false/);
});

test('saved states after a reply-bound pin do not carry it once its reply is deleted', () => {
    const h = harness([pinner({ bound: 'flag' })], { checkpointEvery: 2 });
    assert.equal(h.command('pin.set', { choice: 'a' }).ok, true);
    for (let n = 0; n < 8; n++) {
        h.send(`More ${n}.`, `Reply ${n}.`);
        assert.equal(h.command('pin.later', {}).ok, true);
    }
    assert.ok(h.chat.slice(1).some(message => message.extra?.storySuite?.checkpoint), 'there are saved states after the pin');
    const kept = h.store.head().domains.after.n;
    h.chat.splice(0, 1);
    h.store.rebuild();
    h.store.ensureInitial(h.registry.initialState());
    assert.equal(h.store.head().domains.pin, undefined);
    assert.equal(h.store.head().domains.after.n, kept);
    assert.deepEqual(h.problems(), []);
});

test('a real chat long enough to hold saved states: deleting the pinned first reply retracts the pin, live and after a reload', async t => {
    const { host, ui, pinned } = await world(t, 'flag');
    for (let n = 0; n < 110; n++) {
        await host.send(`More ${n}.`, `Reply ${n}.`);
        if (n % 25 === 0) assert.equal((await ui('pin.later', {})).ok, true);
    }
    assert.ok(host.ctx.chat.some(message => message.extra?.storySuite?.checkpoint), 'a saved state exists after the pin');
    const kept = host.head().domains.after.n;
    await host.st.deleteMessage(0);
    assert.equal(pinned(), null);
    assert.equal(host.head().domains.after.n, kept);
    await reload(host);
    assert.equal(pinned(), null);
    assert.deepEqual(host.store.problems(), []);
});
