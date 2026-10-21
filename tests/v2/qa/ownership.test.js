// QA: one writer per domain and nothing forged (SPEC §0.3, §2.1, §3.2), on the real host. A change
// line or a command can draft only its own module's domains (NOT_OWNER otherwise), cannot reach
// meta, cannot write a claim except through ctx.claim, cannot shape its receipt beyond summary,
// narrate and data, cannot change frozen reads, its payload or the ctx, and cannot pollute
// prototypes. Every refusal stores and saves nothing. Problems found are the test.todo entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { readRecord } from '../../../src/v2/persist.js';

const plain = value => JSON.parse(JSON.stringify(value));

// Module A owns `alpha`; its change lines (`~ grab Name`) and commands try every way out of it.
function moduleA(attempts) {
    return {
        id: 'qa-a',
        name: 'QA A',
        domains: { alpha: { initial: () => ({ n: 0, items: {} }) } },
        commands: Object.fromEntries(Object.entries(attempts).map(([name, fn]) => [`a.${name}`, fn])),
        capture: {
            kinds: { grab: { grammar: '~ grab What' } },
            apply(ctx, line) {
                const attempt = attempts[line.name];
                if (!attempt) ctx.fail('INVALID', `no attempt ${line.name}`);
                return attempt(ctx, line);
            },
        },
    };
}
const moduleB = () => ({
    id: 'qa-b',
    name: 'QA B',
    domains: { beta: { initial: () => ({ secret: 1 }), validate: slice => (slice.secret === 1 ? [] : ['beta.secret must stay 1']) } },
    commands: {
        'b.touch'(ctx) { ctx.draft('beta').secret = 1; return { summary: '' }; },
        'b.fail'() { throw new Error('b fails'); },
    },
});

let kept = null;
const ATTEMPTS = {
    other(ctx) { ctx.draft('beta').secret = 2; return { summary: 'took beta' }; },
    inventory(ctx) { ctx.draft('inventory').wallets.party = { coin: 1e6 }; return { summary: 'rich' }; },
    meta(ctx) { ctx.draft('meta').claims = { 'quest:x:paid': true }; return { summary: 'meta' }; },
    nothing(ctx) { ctx.draft('nowhere').x = 1; return { summary: 'nowhere' }; },
    proto(ctx) { ctx.draft('__proto__').polluted = 1; return { summary: 'proto' }; },
    ctor(ctx) { ctx.draft('constructor').x = 1; return { summary: 'ctor' }; },
    readWrite(ctx) { ctx.read('beta').secret = 2; return { summary: 'wrote a read' }; },
    readDeep(ctx) { ctx.read('inventory').wallets.party = { coin: 5 }; return { summary: 'wrote a read' }; },
    payload(ctx, payload) { payload.labels.qty = '99'; return { summary: 'changed the payload' }; },
    ctxWrite(ctx) { ctx.claim = () => true; return { summary: 'replaced claim' }; },
    queryWrite(ctx) { ctx.query('inventory.items').push({ fake: true }); return { summary: 'wrote a query' }; },
    settingsWrite(ctx) { ctx.settings('story-block').currency = 'FAKE'; return { summary: 'wrote settings' }; },
    keepCtx(ctx) { kept = ctx; ctx.draft('alpha').n += 1; return { summary: 'kept ctx' }; },
    protoAssign(ctx) { Object.assign(ctx.draft('alpha'), JSON.parse('{"__proto__": {"polluted": 1}}')); return { summary: 'assign proto' }; },
    protoKey(ctx) { Object.defineProperty(ctx.draft('alpha').items, '__proto__', { value: { polluted: 1 }, enumerable: true, configurable: true, writable: true }); return { summary: 'own proto key' }; },
    protoNested(ctx) { ctx.draft('alpha').items.x = JSON.parse('{"__proto__": {"polluted": 1}}'); return { summary: 'nested proto' }; },
    ctorNested(ctx) { ctx.draft('alpha').items.x = { constructor: { name: 'Fake' } }; return { summary: 'nested constructor' }; },
    protoDeep(ctx) { ctx.draft('alpha').items.x = { a: [{ prototype: 1 }] }; return { summary: 'deep prototype' }; },
    internalCall(ctx) { ctx.call('capture.item', { op: '+', kind: 'item', name: 'Gold Bar', text: '', labels: { qty: '99' } }); return { summary: 'called a capture' }; },
    internalCatch(ctx) { try { ctx.call('module.init.story-block', {}); } catch { /* caught */ } ctx.draft('alpha').n += 1; return { summary: 'caught an init' }; },
    nan(ctx) { ctx.draft('alpha').n = NaN; return { summary: 'nan' }; },
    float(ctx) { ctx.draft('alpha').n = 1.5; return { summary: 'float' }; },
    inf(ctx) { ctx.draft('alpha').n = Infinity; return { summary: 'inf' }; },
    undef(ctx) { ctx.draft('alpha').items.x = undefined; return { summary: 'undefined' }; },
    fn(ctx) { ctx.draft('alpha').items.x = () => 1; return { summary: 'function' }; },
    date(ctx) { ctx.draft('alpha').items.x = new Date(0); return { summary: 'date' }; },
    badQty(ctx) { ctx.draft('alpha').items.x = { qty: -1 }; return { summary: 'negative qty' }; },
    badId(ctx) { ctx.draft('alpha').items.x = { id: 'not an id!' }; return { summary: 'bad id' }; },
    claimProto(ctx) { ctx.claim('__proto__'); return { summary: 'claim proto' }; },
    claimEmpty(ctx) { ctx.claim(''); return { summary: 'claim empty' }; },
    callOther(ctx) { ctx.call('b.touch', {}); ctx.draft('beta').secret = 3; return { summary: 'sub then write' }; },
    swallow(ctx) { try { ctx.call('b.fail', {}); } catch { /* caught */ } ctx.draft('alpha').n += 1; return { summary: 'swallowed' }; },
    async(ctx) { ctx.draft('alpha').n += 1; return Promise.resolve({ summary: 'later' }); },
    badData(ctx) { return { summary: 'data', data: { when: new Date(0) } }; },
    badSummary(ctx) { return { summary: 42 }; },
    badNarrate(ctx) { return { summary: 'x', narrate: 'yes' }; },
    deepCall(ctx) { ctx.call('a.deepCall', {}); return { summary: 'deep' }; },
};
// Refusals, by attempt: the code the bus answers with.
const REFUSED = {
    other: 'NOT_OWNER', inventory: 'NOT_OWNER', meta: 'NOT_OWNER', nothing: 'NOT_OWNER', proto: 'NOT_OWNER', ctor: 'NOT_OWNER',
    readWrite: 'FAILED', readDeep: 'FAILED', payload: 'FAILED', ctxWrite: 'FAILED', queryWrite: 'FAILED', settingsWrite: 'FAILED',
    protoAssign: 'INVALID', protoKey: 'INVALID', protoNested: 'INVALID', ctorNested: 'INVALID', protoDeep: 'INVALID',
    internalCall: 'REFUSED', internalCatch: 'REFUSED',
    nan: 'INVALID', float: 'INVALID', inf: 'INVALID', undef: 'INVALID', fn: 'INVALID', date: 'INVALID', badQty: 'INVALID', badId: 'INVALID',
    claimProto: 'INVALID', claimEmpty: 'INVALID', callOther: 'NOT_OWNER', swallow: 'FAILED', async: 'FAILED',
    badData: 'FAILED', badSummary: 'FAILED', badNarrate: 'FAILED', deepCall: 'FAILED',
};

async function host(t, extra = []) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [moduleA(ATTEMPTS), moduleB(), ...extra] });
    t.after(() => h.close());
    await h.send('Start.', 'Fine.');
    return h;
}

test('commands: every way out of the module\'s own domain is refused, nothing is stored', async t => {
    const h = await host(t);
    for (const [name, code] of Object.entries(REFUSED)) {
        const chat = JSON.stringify(h.ctx.chat);
        const head = plain(h.head());
        const result = await h.sdk.command(`a.${name}`, { labels: { qty: '1' } });
        assert.equal(result.ok, false, `a.${name} must be refused`);
        assert.equal(result.code, code, `a.${name}: ${result.message}`);
        assert.equal(typeof result.message, 'string');
        assert.equal(JSON.stringify(h.ctx.chat), chat, `a.${name}: nothing stored`);
        assert.deepEqual(plain(h.head()), head, `a.${name}: head unchanged`);
    }
    assert.equal(({}).polluted, undefined, 'Object.prototype is clean');
    assert.equal(h.head().domains.beta.secret, 1);
});

test('change lines: the same attempts from a reply\'s <Changes> become Problems, the other lines still apply', async t => {
    const h = await host(t);
    // internalCall / internalCatch are refused for a button only: a story capture (or a system step,
    // like the assist pre-roll) may run another capture handler through ctx.call.
    const names = Object.keys(REFUSED).filter(name => name !== 'payload' && !name.startsWith('internal'));
    const lines = names.map(name => `~ grab ${name}`).join('\n');
    await h.send('Try.', `Tries.\n<Changes>\n${lines}\n+ item Rope\n</Changes>`);
    const record = readRecord(h.ctx.chat[4]);
    assert.deepEqual(record.receipts.map(receipt => receipt.type), ['capture.item'], 'only the honest line was kept');
    const problems = h.turn.problems('qa-a');
    assert.deepEqual(problems.map(problem => problem.line), names.map(name => `~ grab ${name}`));
    for (const problem of problems) assert.equal(problem.code, REFUSED[problem.line.slice(7)], problem.message);
    assert.equal(h.head().domains.beta.secret, 1);
    assert.equal(({}).polluted, undefined);
});

test('a ctx kept after its command finished cannot be used', async t => {
    const h = await host(t);
    assert.equal((await h.sdk.command('a.keepCtx', {})).ok, true);
    const head = plain(h.head());
    assert.throws(() => kept.draft('alpha'), /already finished/);
    assert.throws(() => kept.claim('later'), /already finished/);
    assert.throws(() => kept.call('b.touch', {}), /already finished/);
    assert.deepEqual(plain(h.head()), head);
});

test('a receipt is written by the bus: a handler cannot set its id, cause, module, seed or rev', async t => {
    const forge = {
        id: 'qa-forge',
        domains: { forged: { initial: () => ({}) } },
        commands: {
            'forge.it'(ctx) {
                return { summary: 'Honest.', narrate: true, data: { ok: 1 }, id: 'rc_aaaaaaaa', cause: 'system', module: 'story-block', seed: 1, rev: 999, type: 'wallet.receive' };
            },
        },
    };
    const h = await host(t, [forge]);
    const result = await h.sdk.command('forge.it', {});
    assert.equal(result.ok, true);
    const receipt = readRecord(h.ctx.chat[2]).receipts.at(-1);
    assert.notEqual(receipt.id, 'rc_aaaaaaaa');
    assert.match(receipt.id, /^rc_[0-9a-z]{8}$/);
    assert.equal(receipt.cause, 'ui');
    assert.equal(receipt.module, 'qa-forge');
    assert.equal(receipt.type, 'forge.it');
    assert.equal(receipt.rev, h.head().meta.rev);
    assert.deepEqual(Object.keys(receipt).sort(), ['cause', 'data', 'id', 'module', 'narrate', 'rev', 'seed', 'summary', 'type']);
});

test('modules see frozen copies: the view, sdk queries and tab renders cannot change the state', async t => {
    const h = await host(t);
    await h.send('Paid.', 'Three coins.\n<Changes>\n+ coin 3\n</Changes>');
    const view = h.sdk.view();
    assert.throws(() => { view.state.domains.inventory.wallets.party.coin = 1e6; }, TypeError);
    assert.throws(() => { view.state.meta.claims['quest:x:paid'] = true; }, TypeError);
    const items = h.sdk.query('inventory.items', {});
    items.push({ fake: true });
    assert.equal(h.sdk.query('inventory.items', {}).length, 0, 'a query answer is a copy');
    assert.ok(Object.isFrozen(h.sdk));
    for (const key of ['store', 'bus', 'registry', 'chat']) assert.equal(h.sdk[key], undefined, `the sdk does not hand out ${key}`);
    assert.equal(h.head().domains.inventory.wallets.party.coin, 3);
});

test('a module cannot register over another\'s domain, command, query or kind, or use the host\'s own prefixes', async t => {
    const h = await host(t);
    const tries = [
        { id: 'qa-x1', domains: { inventory: { initial: () => ({}) } } },
        { id: 'qa-x2', commands: { 'wallet.receive': () => ({}) } },
        { id: 'qa-x3', queries: { 'inventory.items': () => [] } },
        { id: 'qa-x4', capture: { kinds: { item: { grammar: '+ item X' } }, apply: () => ({}) } },
        { id: 'qa-x5', capture: { kinds: { thing: { grammar: '+ thing X', aliases: ['coin'] } }, apply: () => ({}) } },
        { id: 'qa-x6', commands: { 'capture.item': () => ({}) } },
        { id: 'qa-x7', commands: { 'module.init.story-block': () => ({}) } },
        { id: 'qa-x8', domains: { 'a/b': { initial: () => ({}) } } },
        { id: 'qa-x9', domains: Object.defineProperty({}, '__proto__', { value: { initial: () => ({}) }, enumerable: true }) },
        { id: 'story-block' },
        { id: '__proto__' },
        { id: 'qa-x10', domains: { gamma: { initial: () => ({ when: new Date(0) }) } } },
    ];
    for (const def of tries) {
        await assert.rejects(h.sdk.registerModule(def), /cannot be registered/, `module ${def.id} must be refused`);
    }
    assert.equal(h.registry.domainOwner('inventory'), 'story-block');
    assert.equal(h.registry.commandOwner('wallet.receive'), 'story-block');
});

// ---- problems found by QA (#70), fixed ------------------------------------------------------

test('commands.js / registry.js: a UI command cannot run a capture handler ("capture.item") and hand out items', async t => {
    // registry.command('capture.item') is the core capture handler: from a button (or a pack layout's
    // button) it would grant items that inventory.grant itself refuses from the UI; capture.coin money.
    const h = await host(t);
    const chat = JSON.stringify(h.ctx.chat);
    const item = await h.sdk.command('capture.item', { op: '+', kind: 'item', name: 'Gold Bar', text: '', labels: { qty: '99' } });
    assert.equal(item.ok, false, 'capture.item from the UI is refused');
    assert.equal(item.code, 'REFUSED');
    const coin = await h.sdk.command('capture.coin', { op: '+', kind: 'coin', name: '100000', text: '', labels: {} });
    assert.equal(coin.ok, false, 'capture.coin from the UI is refused');
    assert.equal((await h.sdk.preview('capture.item', { op: '+', kind: 'item', name: 'Gold Bar', text: '', labels: {} })).ok, false, 'nor previewed');
    // The bus refuses it too, with cause 'ui', whoever asks: the sdk is not the only gate.
    assert.equal(h.bus.command('capture.coin', { op: '+', kind: 'coin', name: '5', text: '', labels: {} }, { cause: 'ui' }).code, 'REFUSED');
    assert.equal(h.bus.preview('capture.coin', { op: '+', kind: 'coin', name: '5', text: '', labels: {} }).code, 'REFUSED', 'a ui preview too');
    assert.equal(h.bus.command('capture.nothing', {}, { cause: 'ui' }).code, 'UNKNOWN_COMMAND', 'an unknown kind is still unknown');
    // A system step may run a capture handler (the assist pre-roll does, through ctx.call).
    assert.equal(h.bus.command('capture.coin', { op: '+', kind: 'coin', name: '5', text: '', labels: {} }, { cause: 'system' }).ok, true);
    assert.equal(h.head().domains.inventory.wallets.party.coin, 5);
    h.store.truncate(2, h.head().meta.rev);
    assert.equal(JSON.stringify(h.ctx.chat), chat, 'nothing stored');
    assert.equal(h.registry.isInternal('capture.item'), true);
    assert.equal(h.registry.isInternal('inventory.drop'), false);
});

test('commands.js / registry.js: a UI command cannot run "module.init.<id>" and wipe a module\'s state', async t => {
    const h = await host(t);
    await h.send('More.', 'A rope.\n<Changes>\n+ item Rope\n+ coin 40\n</Changes>');
    const result = await h.sdk.command('module.init.story-block', {});
    assert.equal(result.ok, false, 'module.init from the UI is refused');
    assert.equal(result.code, 'REFUSED');
    assert.equal(h.head().domains.inventory.wallets.party.coin, 40, 'the inventory is not reset');
    assert.equal(h.registry.isInternal('module.init.qa-a'), true);
});

test('events/engine.js fireEvent: "events.fire" runs only as the host\'s system cue, not from a UI command', async t => {
    // A button (or a pack layout button, any command name is allowed) could otherwise fire a made-up
    // event, narrate any cue and run any chain of commands, or pre-claim a pack event's "event:<id>"
    // so it never happens.
    // Story Block's core module carries the events part (and so events.fire).
    const h = await host(t);
    assert.equal(h.registry.commandOwner('events.fire'), 'story-block');
    assert.equal(h.registry.isInternal('events.fire'), true, 'events.fire is marked internal');
    const fire = { id: 'dragon-hoard', cue: 'A dragon hands over its hoard.', once: true, then: [{ command: 'wallet.receive', payload: { owner: 'party', amount: 5000 } }] };
    const result = await h.sdk.command('events.fire', fire);
    assert.equal(result.ok, false, 'events.fire from the UI is refused');
    assert.equal(result.code, 'REFUSED');
    assert.equal(h.head().meta.claims['event:dragon-hoard'], undefined, 'no event claim was forged');
    assert.equal((await h.sdk.command('events.fire', fire, { cause: 'system' })).code, 'REFUSED', 'nor with a raised cause through the sdk');
    assert.equal(h.bus.command('events.fire', fire, { cause: 'story' }).code, 'REFUSED', 'nor as a change line');
    const real = h.bus.command('events.fire', fire, { cause: 'system' });
    assert.equal(real.ok, true, `the host's own system cue fires it: ${real.message}`);
    assert.equal(h.head().domains.inventory.wallets.party.coin, 5000);
});

test('sdk.js command: screens, widgets and modules cannot raise the cause above "ui"', async t => {
    const h = await host(t);
    const chat = JSON.stringify(h.ctx.chat);
    for (const cause of ['story', 'system']) {
        const result = await h.sdk.command('inventory.grant', { name: 'Free Sword' }, { cause });
        assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'REFUSED' }, cause);
        assert.equal((await h.sdk.command('wallet.receive', { owner: 'party', amount: 9 }, { cause })).code, 'REFUSED', cause);
    }
    assert.equal(JSON.stringify(h.ctx.chat), chat, 'nothing stored');
    assert.equal((await h.sdk.command('a.keepCtx', {}, { cause: 'ui' })).ok, true, 'an explicit ui cause is fine');
});

test('ops.js checkOps: a value holding an own "__proto__" key is refused, as a path naming it is', async t => {
    // parsePath refuses "__proto__" in a path; a value that carries it (or "constructor",
    // "prototype") as a key is refused too: committed, any later change inside that record would be
    // refused, and code copying it with Object.assign or a for-in loop would get its prototype replaced.
    const h = await host(t);
    for (const name of ['protoNested', 'ctorNested', 'protoDeep']) {
        const result = await h.sdk.command(`a.${name}`, {});
        assert.equal(result.ok, false, `${name}: the value with a forbidden key is refused`);
        assert.equal(result.code, 'INVALID');
    }
    assert.equal(({}).polluted, undefined);
});

test('capture.js parseChanges: a label named "constructor" keeps its value', async () => {
    // Labels are a prototype-less object: "constructor" is the line's own label, never Object.
    const { parseChanges } = await import('../../../src/v2/capture.js');
    const { lines } = parseChanges('+ item Rope | constructor: Kael | qty: 2');
    assert.equal(lines[0].labels.constructor, 'Kael');
    assert.equal(typeof lines[0].labels.constructor, 'string');
    assert.equal(parseChanges('+ item Rope | qty: 2').lines[0].labels.constructor, undefined, 'an absent label is absent');
    assert.equal(parseChanges('+ item Rope | toString: x').lines[0].labels.tostring, 'x');
});
