// Deferred domains and switched-off APIs (docs/v2/LIFECYCLE.md, "Deferred domains"): a module may declare a domain
// `deferred: true` (the chat holds no slice of it until one of the module's commands writes it), and may mark a
// command, query or capture kind with an `enabled` property that reads false while its API is not in use. A module
// that uses neither is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { createRegistry, definitionProblems } from '../../src/v2/registry.js';
import { staticParts } from '../../src/v2/prompt.js';

const ID = 'zz-deferred';
function module({ gate, deferred = true }) {
    const gated = (fn) => Object.defineProperty(fn, 'enabled', { enumerable: true, get: () => gate.on });
    return {
        id: ID, name: 'Deferred', version: '0.0.1',
        domains: {
            base: { initial: () => ({ n: 0 }) },
            later: { initial: () => ({ chosen: false }), ...(deferred ? { deferred: true } : {}) },
        },
        commands: {
            'zz.choose'(ctx) { Object.assign(ctx.draft('later'), { chosen: true }); return { summary: 'Chosen.', narrate: false }; },
            'zz.gated': gated((ctx) => { ctx.draft('base').n += 1; return { summary: 'Gated.', narrate: false }; }),
        },
        queries: {
            'zz.chosen': state => state.domains.later?.chosen === true,
            'zz.gatedQuery': gated(() => 'answer'),
        },
        capture: {
            kinds: {
                plain: { grammar: '! plain Word' },
                gated: Object.defineProperty({ grammar: '! gated Word' }, 'enabled', { enumerable: true, get: () => gate.on }),
            },
            apply(ctx, line) { ctx.draft('base').n += line.kind === 'gated' ? 10 : 1; return { summary: `Read ${line.kind}.`, narrate: false }; },
        },
    };
}

test('a deferred domain is absent from a new chat, and a command may write it', async t => {
    const host = await createHost({ modules: [module({ gate: { on: true } })], core: false });
    t.after(() => host.close());
    assert.deepEqual(host.head().domains.base, { n: 0 });
    assert.equal(host.head().domains.later, undefined);
    assert.equal(host.sdk.query('zz.chosen'), false);
    const result = await host.bus.command('zz.choose', {}, { cause: 'ui' });
    assert.equal(result.ok, true, `${result.code}: ${result.message}`);
    assert.deepEqual(host.head().domains.later, { chosen: true });
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.deepEqual(host.head().domains.later, { chosen: true }, 'it survives a reload');
});

test('without deferred the same domain is there from the start (a module that does not ask is unchanged)', async t => {
    const host = await createHost({ modules: [module({ gate: { on: true }, deferred: false })], core: false });
    t.after(() => host.close());
    assert.deepEqual(host.head().domains.later, { chosen: false });
});

test('a deferred domain missing is not a missing domain: the module is ready and its chat reads as current', async t => {
    const host = await createHost({ modules: [module({ gate: { on: true } })], core: false });
    t.after(() => host.close());
    assert.equal(host.sdk.modules().find(each => each.id === ID).status, 'ready');
    const flight = host.sdk.preflight({ module: ID });
    assert.equal(flight.deferredDomains, true, 'preflight says the host defers domains');
    assert.deepEqual(flight.domains, ['base']);
    assert.equal(flight.classification, 'current');
});

test('a command, a query and a capture kind whose `enabled` reads false are not offered, and come back when it reads true', async t => {
    const gate = { on: false };
    const host = await createHost({ modules: [module({ gate })], core: false });
    t.after(() => host.close());
    const run = () => host.bus.command('zz.gated', {}, { cause: 'ui' });
    const refused = await run();
    assert.equal(refused.ok, false);
    assert.equal(host.head().domains.base.n, 0);
    assert.equal(host.registry.query('zz.gatedQuery'), null);
    assert.throws(() => host.sdk.query('zz.gatedQuery'), /no module answers/);
    assert.equal(host.sdk.query('zz.chosen'), false, 'an API without `enabled` is always on');
    const grammar = () => staticParts(host.registry).map(part => part.text).join('\n');
    assert.match(grammar(), /! plain Word/);
    assert.doesNotMatch(grammar(), /! gated Word/);
    await host.send('Go.', 'The road.\n<Changes>\n! gated one\n! plain two\n</Changes>');
    assert.equal(host.head().domains.base.n, 1, 'only the plain line was read; the gated one is not a line of this chat');

    gate.on = true;
    assert.equal((await run()).ok, true);
    assert.equal(host.sdk.query('zz.gatedQuery'), 'answer');
    assert.match(grammar(), /! gated Word/);
    await host.send('Again.', 'The road.\n<Changes>\n! gated three\n</Changes>');
    assert.equal(host.head().domains.base.n, 12);
});

test('deferred must be true or false, and enabled is a key a command entry may carry', () => {
    const def = module({ gate: { on: true } });
    def.domains.later.deferred = 'yes';
    assert.match(definitionProblems(def).join(' '), /domain "later" deferred must be true or false/);
    const ok = module({ gate: { on: true } });
    assert.deepEqual(definitionProblems(ok), []);
    const entry = module({ gate: { on: true } });
    entry.commands['zz.entry'] = { handler: () => ({ summary: 'x', narrate: false }), enabled: false };
    assert.deepEqual(definitionProblems(entry), []);
    const registry = createRegistry();
    registry.register(entry);
    assert.equal(registry.command('zz.entry'), null, 'an entry that says it is off is not found');
});
