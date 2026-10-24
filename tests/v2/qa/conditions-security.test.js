// QA: the events condition language (src/v2/events/condition.js, MODULES §E) with hostile
// conditions. A pack's `when` is data from somewhere else: it may call only query, quest, has, time,
// actor and count, read only what those return (own data, no prototype names), never throw at its
// caller, never write, and stay inside its size limits. Run against a real host's view, so query()
// reaches only registered read-only queries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CALLS, LIMITS, compile, evaluate, evaluateCondition, parse } from '../../../src/v2/events/condition.js';
import { probeModule } from './helpers/probe-module.js';

const HOSTILE = [
    'constructor.constructor("globalThis.__qaHit = true")()',
    'this.constructor',
    'globalThis.__qaHit = true',
    'process.exit(1)',
    'require("child_process")',
    'import("fs")',
    'eval("globalThis.__qaHit = true")',
    'Function("globalThis.__qaHit = true")()',
    'setTimeout("globalThis.__qaHit = true")',
    'fetch("https://evil.example")',
    'query("inventory.items").constructor',
    'query("inventory.items")["constructor"]',
    'query("inventory.items").__proto__',
    'query("inventory.items")["__proto__"]["polluted"] == 1',
    'query("inventory.items").prototype',
    'query("inventory.items").push(1)',
    'query("inventory.items").length',
    'query("inventory.currency").name.length',
    'query("inventory.currency").toString()',
    'query("inventory.currency")["toString"]()',
    'quest("x").constructor.name',
    'count(query("inventory.items")).toFixed(2)',
    'query("inventory.grant", { name: "Free Sword" })',
    'query("wallet.receive", { owner: "party", amount: 5 })',
    'query("events.status")',
    'query("inventory.items", { __proto__: { polluted: 1 } })',
    'query("inventory.items", { constructor: 1 })',
    'has("Rope", { qty: 1 })',
    '`${1}`',
    '1; globalThis.__qaHit = true',
    'x => x',
    'function () {}',
    'new Date()',
    'a = 1',
    'time() = 5',
    '[1, 2].map(x)',
    'query',
    'query.call',
    'quest.apply(null, ["x"])',
    '"a" + "b"',
    '1 + 1 == 2',
    'void 0',
    'typeof query',
    'delete query',
    '(query)("inventory.items")',
    'query("inventory.items")(1)',
    'query(query)',
];

async function setup(t) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [probeModule()] });
    t.after(() => h.close());
    await h.send('Start.', 'A rope.\n<Changes>\n+ item Rope | qty: 2\n+ coin 12\n</Changes>');
    return h;
}

test('hostile conditions are never met, never throw, and change nothing', async t => {
    const h = await setup(t);
    globalThis.__qaHit = false;
    const head = JSON.stringify(h.head());
    const chat = JSON.stringify(h.ctx.chat);
    for (const source of HOSTILE) {
        let result;
        assert.doesNotThrow(() => { result = evaluateCondition(source, h.sdk.view()); }, source);
        assert.equal(result.met, false, `${source} is not met`);
        if (result.error) assert.ok(['SYNTAX', 'LIMIT', 'NOT_ALLOWED', 'TYPE', 'CALL'].includes(result.error.code), `${source}: ${result.error.code}`);
        const parsed = parse(source);
        if (parsed.ok) {
            const out = evaluate(parsed.ast, h.sdk.view());
            assert.ok(!out.ok || out.value === null || ['number', 'string', 'boolean'].includes(typeof out.value) || Array.isArray(out.value) || typeof out.value === 'object',
                `${source} gives plain data only`);
            assert.notEqual(typeof out.value, 'function', `${source} never hands out a function`);
        }
    }
    assert.equal(globalThis.__qaHit, false, 'nothing ran');
    delete globalThis.__qaHit;
    assert.equal(({}).polluted, undefined);
    assert.equal(JSON.stringify(h.head()), head, 'the state is unchanged');
    assert.equal(JSON.stringify(h.ctx.chat), chat, 'the chat is unchanged');
});

test('the allow-list is exactly query, quest, has, time, actor, count; every other name is refused', async t => {
    const h = await setup(t);
    assert.deepEqual([...CALLS].sort(), ['actor', 'count', 'has', 'query', 'quest', 'time']);
    for (const name of ['eval', 'Function', 'fetch', 'require', 'import', 'setTimeout', 'alert', 'globalThis', 'window', 'document', 'process',
        'constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'Object', 'Array', 'JSON', 'Math', 'Date', 'Reflect', 'Proxy', 'StoryBlock', 'sdk', 'ctx', 'state', 'view']) {
        const result = evaluateCondition(`${name}("x") == 1`, h.sdk.view());
        assert.equal(result.met, false);
        assert.ok(['NOT_ALLOWED', 'SYNTAX'].includes(result.error?.code), `${name}(): ${result.error?.code} ${result.error?.message}`);
    }
});

test('honest conditions still work on the same host', async t => {
    const h = await setup(t);
    const view = h.sdk.view();
    for (const [source, met] of [
        ['has("Rope", 2)', true], ['has("rope")', true], ['has("Rope", 3)', false], ['count(query("inventory.items")) == 1', true],
        ['query("inventory.items")[0].qty >= 2', true], ['query("probe.n") == 0', true], ['time() == null', true], ['quest("Granary Rats") == null', true],
        ['actor("Ren") == null && !has("Lamp")', true],
    ]) assert.equal(evaluateCondition(source, view).met, met, source);
});

test('query() reaches only registered queries, read-only: commands are not queries', async t => {
    const h = await setup(t);
    const asked = [];
    const view = h.sdk.view();
    const env = { state: view.state, query: (name, args) => { asked.push(name); return view.query(name, args); } };
    for (const name of ['inventory.grant', 'wallet.receive', 'probe.tick', 'module.init.story-block', 'capture.item']) {
        const result = evaluateCondition(`query("${name}") == null`, env);
        assert.equal(result.met, false, name);
        assert.equal(result.error?.code, 'CALL', `${name}: no such query`);
    }
    assert.equal(h.head().domains.probe.n, 0, 'no command ran');
    assert.equal(h.head().domains.inventory.wallets.party.coin, 12);
    assert.equal(evaluateCondition('query("events.status") == null', env).error?.code, 'NOT_ALLOWED');
    assert.ok(!asked.includes('events.status'), 'the events engine is never asked about itself');
});

test('limits: long, deep, wide and call-heavy conditions are refused without a crash', () => {
    const cases = [
        'true && '.repeat(200) + 'true',
        '('.repeat(LIMITS.depth + 1) + 'true' + ')'.repeat(LIMITS.depth + 1),
        '!'.repeat(LIMITS.depth + 2) + 'true',
        `'${'a'.repeat(LIMITS.string + 1)}' == 'a'`,
        `${'a'.repeat(LIMITS.name + 1)}() == 1`,
        `query("x", { ${Array.from({ length: LIMITS.keys + 1 }, (_, i) => `k${i}: 1`).join(', ')} }) == null`,
        Array.from({ length: LIMITS.calls + 1 }, () => 'time() == null').join(' && '),
        'x'.repeat(LIMITS.source + 1),
        '('.repeat(100000),
    ];
    for (const source of cases) {
        let result;
        assert.doesNotThrow(() => { result = evaluateCondition(source, { state: { domains: {} }, query: () => null }); });
        assert.equal(result.met, false, source.slice(0, 60));
        assert.ok(result.error, `${source.slice(0, 60)}: says why`);
    }
    assert.equal(compile('time() == null').ok, true);
});

// (Query answers reach a real condition through runQuery's structuredClone, so they are plain already.)
test('data read through a condition is the data only: a function in an answer is refused, never called', () => {
    let ran = false;
    const answer = { fn: () => { ran = true; return 1; }, list: [() => { ran = true; }] };
    const env = { state: { domains: {} }, query: () => answer };
    assert.equal(evaluateCondition('query("x").fn == null', env).met, false);
    assert.equal(evaluateCondition('query("x").list[0] == null', env).met, false);
    assert.equal(evaluateCondition('query("x").fn() == 1', env).met, false);
    assert.equal(ran, false, 'no function ran');
});
