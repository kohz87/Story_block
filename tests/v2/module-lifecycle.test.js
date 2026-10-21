// Module life cycle (SPEC §2.6, §6): a module that grows a domain, version handshakes, hooks that hang
// or throw, an initial() that throws, and a module registering before the chat has its state.
// The break-round reproductions are in tests/v2/break/b7-*.test.js; these pin the details.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../testkit/index.js';
import { aiMessage } from '../../testkit/fake-st.js';
import { createRegistry, INIT_PREFIX } from '../../src/v2/registry.js';
import { ensureModules, missingModules } from '../../src/v2/sdk.js';
import { HOOK_TIMEOUT_MS } from '../../src/v2/turn.js';
import { headIndexOf, headState } from '../../src/v2/view/mounts/common.js';

function captureWarnings() {
    const warnings = [];
    const warn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    return { warnings, restore: () => { console.warn = warn; } };
}

const grown = (domains) => ({
    id: 'zz-grow',
    name: 'Grow',
    domains: Object.fromEntries(domains.map(name => [name, { initial: () => ({ name, n: 0 }) }])),
    commands: {
        'grow.set'(ctx, payload) {
            ctx.draft(payload.domain).n = payload.n;
            return { summary: 'set', narrate: false };
        },
    },
});

test('module.init sets up only the domains the chat lacks, and its payload and receipt name them', async () => {
    const old = await createHost({ modules: [grown(['alpha'])] });
    await old.sdk.command('grow.set', { domain: 'alpha', n: 5 });
    await old.send('Hi', 'Hello.');
    const chat = structuredClone(old.ctx.chat);
    old.close();

    const host = await createHost({ modules: [grown(['alpha', 'beta', 'gamma'])], st: { chat } });
    assert.deepEqual(host.head().domains.alpha, { name: 'alpha', n: 5 }, 'the existing domain keeps its data');
    assert.deepEqual(host.head().domains.beta, { name: 'beta', n: 0 });
    assert.deepEqual(host.head().domains.gamma, { name: 'gamma', n: 0 });
    const init = host.sdk.receipts().map(entry => entry.receipt).find(receipt => receipt.type === `${INIT_PREFIX}zz-grow`);
    assert.deepEqual(init.payload?.domains ?? init.data?.domains, ['beta', 'gamma']);
    assert.deepEqual(missingModules(host.registry, host.head()), []);
    host.close();
});

test('missingModules: { def, missing } for each module whose domains the state lacks', () => {
    const registry = createRegistry();
    registry.register(grown(['alpha', 'beta']));
    registry.register({ id: 'zz-other', domains: { other: { initial: () => ({}) } } });
    const found = missingModules(registry, { domains: { alpha: {}, other: {} } });
    assert.deepEqual(found.map(({ def, missing }) => [def.id, missing]), [['zz-grow', ['beta']]]);
    assert.deepEqual(missingModules(registry, null).map(({ def, missing }) => [def.id, missing]), [['zz-grow', ['alpha', 'beta']], ['zz-other', ['other']]]);
});

test('requires.storyBlock: met, refused with "needs Story Block ≥ x", or a range above shown as written', () => {
    const registry = createRegistry({ hostVersion: '2.0.0-alpha.1' });
    registry.register({ id: 'ok-a', requires: { storyBlock: '^2' } });
    registry.register({ id: 'ok-b', requires: { storyBlock: '>=1.5.0 <3 || >=4' } });
    assert.throws(() => registry.register({ id: 'new', name: 'Newer', requires: { storyBlock: '>=2.1.0' } }),
        { message: 'Story Suite: Newer needs Story Block ≥ 2.1.0; this is 2.0.0-alpha.1. Update Story Block to use it.' });
    assert.throws(() => registry.register({ id: 'new2', requires: { storyBlock: '^3.2' } }), /new2 needs Story Block ≥ 3\.2\.0;/);
    assert.throws(() => registry.register({ id: 'old', requires: { storyBlock: '^1.4' } }), /old needs Story Block \^1\.4; this is 2\.0\.0-alpha\.1\./);
    assert.deepEqual(registry.modules().map(def => def.id), ['ok-a', 'ok-b'], 'nothing of a refused module is kept');
    // A registry built outside the host (no version) does not check.
    assert.doesNotThrow(() => createRegistry().register({ id: 'any', requires: { storyBlock: '>=99' } }));
});

test('unknown definition fields (features, a new requires key) are logged once each and ignored', () => {
    const messages = [];
    const registry = createRegistry({ hostVersion: '2.0.0', warn: message => messages.push(message) });
    registry.register({ id: 'future', name: 'Future', features: [{ id: 'wear' }], requires: { storyBlock: '^2', rpgBattle: '^2' }, queries: { 'future.ping': () => 'pong' } });
    assert.equal(registry.query('future.ping')(), 'pong');
    assert.deepEqual(messages, [
        'Future: "features" is not a module field this Story Block knows; it is ignored.',
        'Future: "requires.rpgBattle" is not a requires field this Story Block knows; it is ignored.',
    ]);
});

test('hooks that never answer time out with a TIMEOUT problem; canGenerate then does not block', async () => {
    assert.equal(HOOK_TIMEOUT_MS, 2500);
    const hanging = { id: 'zz-hang', name: 'Hang', hooks: { canGenerate: () => new Promise(() => {}), beforeGenerate: () => new Promise(() => {}) } };
    const host = await createHost({ modules: [hanging] });
    const started = Date.now();
    await host.send('I wait.', 'Nothing happens.\n<Changes>\n+ item Rope | qty: 1\n</Changes>');
    const took = Date.now() - started;
    assert.ok(took >= 2 * HOOK_TIMEOUT_MS - 100 && took < 2 * HOOK_TIMEOUT_MS + 2000, `took ${took} ms`);
    assert.deepEqual(host.turn.problems('zz-hang').map(problem => problem.code), ['TIMEOUT', 'TIMEOUT']);
    assert.deepEqual(host.turn.blocked(), []);
    assert.equal(Object.values(host.head().domains.inventory.stacks).length, 1);
    host.close();
});

test('a hook that answers in time is still heard (a slow canGenerate can block)', async () => {
    const slow = { id: 'zz-slow', hooks: { canGenerate: () => new Promise(resolve => setTimeout(resolve, 20, { ok: false, reason: 'Make your character first.' })) } };
    const host = await createHost({ modules: [slow] });
    await host.send('Go.', 'Unused.');
    assert.deepEqual(host.turn.blocked(), [{ moduleId: 'zz-slow', reason: 'Make your character first.' }]);
    host.close();
});

test('a domain whose initial() throws is skipped, logged once, and set up later when it works', async () => {
    let broken = false;
    const fragile = { id: 'zz-fragile', name: 'Fragile', domains: { fragile: { initial: () => { if (broken) throw new Error('the start pack is gone'); return { n: 1 }; } } } };
    const host = await createHost({ modules: [fragile] });
    broken = true;
    const { warnings, restore } = captureWarnings();
    try {
        host.ctx.chat.splice(0, host.ctx.chat.length, aiMessage('A new tale begins.'));
        await host.turn.onChatChanged();
        assert.equal(host.head().domains.fragile, undefined);
        assert.ok(host.head().domains.inventory, 'the core still starts');
        await host.send('One.', 'A rope.\n<Changes>\n+ item Rope | qty: 1\n</Changes>');
        await host.send('Two.', 'A lamp.\n<Changes>\n+ item Lamp | qty: 1\n</Changes>');
    } finally {
        restore();
    }
    const told = warnings.filter(text => /the start pack is gone/.test(text));
    assert.equal(told.filter(text => /domain "fragile" could not be set up/.test(text)).length, 1, told.join('\n'));
    assert.ok(told.length <= 2, `logged once per place, not every turn:\n${told.join('\n')}`);
    assert.equal(Object.values(host.head().domains.inventory.stacks).length, 2);
    broken = false;
    await host.send('Three.', 'Fine.');
    assert.deepEqual(host.head().domains.fragile, { n: 1 }, 'tried again at the next turn');
    host.close();
});

test('a throwing item.define hook leaves the def as before it, records a Problem, and the next hooks still run', async () => {
    const first = { id: 'aa-first', hooks: { 'item.define'(def) { def.value = 7; } } };
    const buggy = { id: 'bb-buggy', name: 'Buggy', hooks: { 'item.define'(def) { def.value = 999; def.rarity = 'legendary'; throw new TypeError('no rules table'); } } };
    const last = { id: 'cc-last', hooks: { 'item.define': () => ({ tags: ['rope'] }) } };
    const host = await createHost({ modules: [first, buggy, last] });
    await host.send('Look.', 'A rope.\n<Changes>\n+ item Rope | qty: 2\n</Changes>');
    const { defs, stacks } = host.head().domains.inventory;
    assert.deepEqual(Object.values(stacks).map(stack => stack.qty), [2]);
    const def = defs[Object.values(stacks)[0].def];
    assert.equal(def.value, 7, 'the change made before the failing hook stays');
    assert.equal(def.rarity, 'common', 'nothing of the failing hook stays');
    assert.deepEqual(def.tags, ['rope'], 'the hooks after it still run');
    const problems = host.turn.problems('bb-buggy');
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /item\.define failed on "Rope": no rules table/);
    host.close();
});

test('before the chat has its state: ensureModules waits, and the mounts see an empty head', async () => {
    let commands = 0;
    const bus = { command: async () => { commands += 1; return { ok: true }; } };
    const registry = createRegistry();
    registry.register(grown(['alpha']));
    assert.deepEqual(await ensureModules({ store: { headIndex: () => 0, head: () => null }, bus, registry }), []);
    assert.deepEqual(await ensureModules({ store: { headIndex: () => -1, head: () => ({ domains: {} }) }, bus, registry }), []);
    assert.equal(commands, 0);

    const stateAt = index => {
        if (index < 0) throw new RangeError(`There is no message ${index} in this chat.`);
        return { at: index };
    };
    assert.equal(headState({ stateAt, headIndex: () => -1 }), null);
    assert.equal(headIndexOf({ headIndex: () => -1 }), null);
    assert.deepEqual(headState({ stateAt, headIndex: () => 2 }), { at: 2 });
    assert.equal(headIndexOf({ headIndex: () => 2 }), 2);
});
