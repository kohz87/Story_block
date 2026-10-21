// The integration's host fixes on the real runtime (store.js, commands.js, turn.js through the
// testkit): ctx.caller, ctx.rev, ctx.id, the capture context (ctx.carrier, ctx.chat) and
// store.changesAt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

// A module that records what its handlers were told.
function spy(seen) {
    return {
        id: 'spy',
        name: 'Spy',
        domains: { spy: { initial: () => ({ ids: [] }) } },
        commands: {
            'spy.outer'(ctx) {
                seen.push({ at: 'outer', caller: ctx.caller, rev: ctx.rev, carrier: ctx.carrier, chat: ctx.chat });
                ctx.call('spy.inner', {});
                return { summary: '', narrate: false };
            },
            'spy.inner'(ctx) {
                seen.push({ at: 'inner', caller: ctx.caller, rev: ctx.rev });
                return { summary: '', narrate: false };
            },
            'spy.ids'(ctx) {
                const draft = ctx.draft('spy');
                draft.ids.push(ctx.id('th'), ctx.id('th'));
                return { summary: '', narrate: false, data: { roll: ctx.rng() } };
            },
        },
        capture: {
            kinds: { mark: { grammar: '! mark Name' } },
            apply(ctx, line) {
                seen.push({ at: 'capture', name: line.name, rev: ctx.rev, carrier: ctx.carrier, key: String(ctx.carrier), chat: ctx.chat, caller: ctx.caller });
                ctx.draft('spy').ids.push(ctx.id('mk'));
                return { summary: '', narrate: false };
            },
        },
    };
}

test('ctx.caller is the calling module inside ctx.call and null at the top; ctx.rev is the receipt\'s rev', async () => {
    const seen = [];
    const host = await createHost({ core: false, modules: [spy(seen)] });
    await host.send('Hi.', 'Hello.');
    const rev = host.head().meta.rev;
    const result = await host.sdk.command('spy.outer', {});
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(seen.map(item => [item.at, item.caller, item.rev]), [['outer', null, rev + 1], ['inner', 'spy', rev + 1]]);
    assert.equal(result.receipt.rev, rev + 1);
    assert.equal(seen[0].carrier, null, 'no carrier outside capture');
    assert.equal(seen[0].chat, null);
    host.close();
});

test('ctx.id(prefix) comes from the receipt seed: same seed, same IDs, and ctx.rng is not disturbed', async () => {
    const host = await createHost({ core: false, modules: [spy([])] });
    await host.send('Hi.', 'Hello.');
    const one = host.bus.run('spy.ids', {}, { cause: 'ui', seed: 1234 });
    const two = host.bus.run('spy.ids', {}, { cause: 'ui', seed: 1234 });
    const other = host.bus.run('spy.ids', {}, { cause: 'ui', seed: 99 });
    const ids = result => result.state.domains.spy.ids;
    assert.deepEqual(ids(one), ids(two));
    assert.notDeepEqual(ids(one), ids(other));
    assert.notEqual(ids(one)[0], ids(one)[1], 'two calls give two IDs');
    for (const id of ids(one)) assert.match(id, /^th_[0-9a-z]{8}$/);
    assert.equal(one.receipt.data.roll, two.receipt.data.roll);
    host.close();
});

test('ctx.id refuses a bad prefix', async () => {
    const mod = { id: 'bad', commands: { 'bad.id': ctx => { ctx.id('Not Ok'); return {}; } } };
    const host = await createHost({ core: false, modules: [mod] });
    await host.send('Hi.', 'Hello.');
    const result = await host.sdk.command('bad.id', {});
    assert.equal(result.code, 'INVALID');
    host.close();
});

test('capture runs get ctx.carrier { index, swipe } and ctx.chat { lastUser, reply }', async () => {
    const seen = [];
    const host = await createHost({ core: false, modules: [spy(seen)] });
    await host.send('I wave at Fenna.', 'Fenna waves back.\n<Changes>\n! mark Fenna\n! mark Bo\n</Changes>');
    const captures = seen.filter(item => item.at === 'capture');
    assert.equal(captures.length, 2);
    assert.deepEqual({ ...captures[0].carrier }, { index: 2, swipe: 0, key: '2:0' });
    assert.equal(captures[0].key, '2:0', 'String(ctx.carrier) is its key');
    assert.deepEqual({ ...captures[0].chat }, { lastUser: 'I wave at Fenna.', reply: 'Fenna waves back.' });
    assert.equal(captures[0].caller, null);
    assert.equal(captures[1].rev, captures[0].rev + 1, 'each line is its own receipt');
    await host.swipe('Fenna frowns.\n<Changes>\n! mark Fenna\n</Changes>');
    const last = seen.filter(item => item.at === 'capture').at(-1);
    assert.equal(last.carrier.swipe, 1);
    assert.equal(last.chat.reply, 'Fenna frowns.');
    assert.equal(last.chat.lastUser, 'I wave at Fenna.');
    host.close();
});

test('store.changesAt(index) lists the JSON Pointers that carrier\'s ops touched', async () => {
    const host = await createHost({ core: true });
    await host.send('Go.', 'You find rope.\n<Changes>\n+ item Rope | qty: 2\n~ place Bluewatch | kind: settlement\n</Changes>');
    const paths = host.store.changesAt(2);
    assert.ok(paths.some(path => path.startsWith('/domains/inventory/stacks/')));
    assert.ok(paths.includes('/domains/scene/place/name'));
    assert.ok(paths.includes('/meta/rev'));
    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(host.store.changesAt(1), [], 'a user message has none');
    assert.deepEqual(host.store.changesAt(0), [], 'the greeting holds only its checkpoint');
    assert.deepEqual(host.store.changesAt(99), []);
    host.close();
});

test('mountQuery adapts the mounts\' query(name, args, state) to the registry\'s (state, args, tools)', async () => {
    const { mountQuery } = await import('../../src/v2/sdk.js');
    const { createRegistry } = await import('../../src/v2/registry.js');
    const registry = createRegistry();
    registry.register({
        id: 'q',
        queries: {
            'q.count': state => state.domains.n,
            'q.double': (state, args, tools) => tools.query('q.count') * (args?.by ?? 2),
        },
    });
    const query = mountQuery(registry);
    assert.equal(query('q.double', { by: 3 }, { domains: { n: 4 } }), 12);
    assert.equal(query('q.count', undefined, { domains: { n: 1 } }), 1, 'each call reads the state it was given');
    assert.throws(() => query('q.none', {}, { domains: {} }), /no module answers/);
});

test('inside a command, ctx.query gives the query tools.query and tools.receipts over the transaction', async () => {
    const seen = [];
    const mod = {
        id: 'tq',
        domains: { tq: { initial: () => ({ n: 1 }) } },
        queries: {
            'tq.n': state => state.domains.tq.n,
            'tq.both': (state, args, tools) => ({ n: tools.query('tq.n'), receipts: tools.receipts().length }),
        },
        commands: {
            'tq.bump'(ctx) {
                ctx.draft('tq').n = 5;
                seen.push(ctx.query('tq.both'));
                return { summary: '', narrate: false };
            },
        },
    };
    const host = await createHost({ core: false, modules: [mod] });
    await host.send('Hi.', 'Hello.');
    await host.sdk.command('tq.bump', {});
    await host.sdk.command('tq.bump', {});
    assert.deepEqual(seen, [{ n: 5, receipts: 0 }, { n: 5, receipts: 1 }], 'the draft is seen; stored receipts are listed');
    host.close();
});

test('sdk.substitute turns {{user}} and {{char}} into the names, for tabs and screens', async () => {
    const host = await createHost({ core: false });
    assert.equal(host.sdk.substitute('Only {{user}} may take it; {{char}} waits.'), `Only ${host.ctx.name1} may take it; ${host.ctx.name2} waits.`);
    host.close();
});

test('a command\'s ctx.query reaches every module\'s queries, and their tools do too', async () => {
    const seen = [];
    const mod = {
        id: 'reader',
        queries: { 'reader.money': (state, args, tools) => tools.query('inventory.currency').name },
        commands: {
            'reader.look'(ctx) {
                seen.push(ctx.query('reader.money'), ctx.query('packs.content', { kind: 'items' }).length, ctx.query('inventory.currency').name);
                return { summary: '', narrate: false };
            },
        },
    };
    const host = await createHost({ modules: [mod] });
    await host.send('Hi.', 'Hello.');
    assert.equal((await host.sdk.command('reader.look', {})).ok, true);
    assert.deepEqual(seen, ['gold', 0, 'gold']);
    host.close();
});
