// B-b1r2-4: what a command reads is the head's own frozen state, not a copy of it, and the diff walks only
// the keys that changed. These tests hold the faster paths to what the old ones gave: the same ops, byte
// for byte, over seeded corpora (old: every key walked in sorted order; reads and queries as deep-frozen
// copies of the drafts), and frozen views a handler or a query cannot write through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandBus } from '../../src/v2/commands.js';
import { checkOps, clone, deepFreeze, diff, escapeKey, frozenCopy, isDeepFrozen } from '../../src/v2/ops.js';
import { rng } from '../../src/v2/rng.js';
import { counterIds, fakeRegistry, fakeStore } from './helpers/bus-fakes.js';

const isPlain = value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

const setKey = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

// The diff as it was before (B-b1r2-4): every key of both objects, in sorted order, walked one by one.
// Lists and plain values are left to ops.js itself (unchanged by the fix).
function oldDiff(a, b, path = '') {
    const ops = [];
    (function walk(x, y, at) {
        if (x === y) return;
        if (isPlain(x) && isPlain(y)) {
            for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
                const to = `${at}/${escapeKey(key)}`;
                if (!Object.hasOwn(y, key)) ops.push({ op: 'remove', path: to });
                else if (!Object.hasOwn(x, key)) ops.push({ op: 'add', path: to, value: clone(y[key]) });
                else walk(x[key], y[key], to);
            }
            return;
        }
        ops.push(...diff(x, y, at));
    })(a, b, path);
    return ops;
}

function deeplyFrozen(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return true;
    seen.add(value);
    return Object.isFrozen(value) && Object.keys(value).every(key => deeplyFrozen(value[key], seen));
}

// ---------- seeded values ----------

const KEYS = ['a', 'b', 'c', 'it_k3f9a2qz', 'it_00000001', '0', '9', '10', 'x/y', 'm~n', 'é', 'Z', '__proto__'];
const LEAVES = [0, 1, -1, 2.5, -0, '', 'x', 'Rope', true, false, null, NaN];
// What a state may hold (checkOps): no __proto__ key, no NaN.
const STATE_KEYS = KEYS.filter(key => key !== '__proto__');
const STATE_LEAVES = LEAVES.filter(leaf => !Number.isNaN(leaf));

function randomValue(r, depth, { keys = KEYS, leaves = LEAVES } = {}) {
    const roll = r();
    if (depth > 3 || roll < 0.35) return leaves[Math.floor(r() * leaves.length)];
    if (roll < 0.8) {
        const out = r() < 0.1 ? Object.create(null) : {};
        for (const key of keys) if (r() < 0.35) setKey(out, key, randomValue(r, depth + 1, { keys, leaves }));
        return out;
    }
    return Array.from({ length: Math.floor(r() * 4) }, () => randomValue(r, depth + 1, { keys, leaves }));
}
const stateValue = (r, depth) => randomValue(r, depth, { keys: STATE_KEYS, leaves: STATE_LEAVES });

// A changed copy: keys dropped, changed, added and re-added (so they come later in the key order).
function changed(r, value, depth = 0) {
    if (r() < 0.12) return randomValue(r, depth);
    if (Array.isArray(value)) {
        const out = value.map(item => (r() < 0.3 ? changed(r, item, depth + 1) : clone(item)));
        if (r() < 0.3) out.push(randomValue(r, depth + 1));
        return out;
    }
    if (isPlain(value)) {
        const out = clone(value);
        for (const key of Object.keys(out)) {
            const roll = r();
            if (roll < 0.12) delete out[key];
            else if (roll < 0.2) {
                const kept = out[key];
                delete out[key];
                setKey(out, key, kept);
            } else if (roll < 0.45) setKey(out, key, changed(r, out[key], depth + 1));
        }
        if (r() < 0.3) setKey(out, KEYS[Math.floor(r() * KEYS.length)], randomValue(r, depth + 1));
        return out;
    }
    return r() < 0.5 ? value : randomValue(r, depth);
}

test('diff writes byte for byte the ops the old every-key walk wrote (4000 seeded pairs)', () => {
    const r = rng(1042);
    for (let i = 0; i < 4000; i++) {
        const a = deepFreeze({ root: randomValue(r, 0) });
        const b = { root: changed(r, a.root) };
        const ops = diff(a, b, '/domains/x');
        assert.deepStrictEqual(ops, oldDiff(a, b, '/domains/x'), `pair ${i}`);
        assert.equal(JSON.stringify(ops), JSON.stringify(oldDiff(a, b, '/domains/x')));
    }
});

test('frozenCopy gives what deepFreeze(clone(value)) gave, keeps the base where nothing changed', () => {
    const r = rng(77);
    for (let i = 0; i < 1500; i++) {
        const base = deepFreeze({ root: randomValue(r, 0), side: { list: [1, { n: 2 }], deep: { x: { y: 1 } } } });
        const value = { root: changed(r, base.root), side: clone(base.side) };
        const before = JSON.stringify(value);
        const copy = frozenCopy(value, base);
        const old = deepFreeze(clone(value));
        assert.deepStrictEqual(copy, old, `value ${i}`);
        assert.equal(JSON.stringify(copy), JSON.stringify(old), 'same keys in the same order');
        assert.ok(deeplyFrozen(copy));
        assert.equal(JSON.stringify(value), before, 'the value itself is not changed');
        assert.equal(Object.isFrozen(value), false, 'nor frozen');
        assert.equal(copy.side, base.side, 'an unchanged branch is the base\'s own');
    }
    const base = deepFreeze({ a: { b: 1 }, c: [1, 2] });
    assert.equal(frozenCopy(clone(base), base), base, 'nothing changed: the base itself');
    const reordered = { c: [1, 2], a: { b: 1 } };
    assert.notEqual(frozenCopy(reordered, base), base, 'another key order is another value');
    assert.deepEqual(Object.keys(frozenCopy(reordered, base)), ['c', 'a']);
    const holes = frozenCopy([1, , 3]);   // eslint-disable-line no-sparse-arrays
    assert.equal(1 in holes, false, 'a hole stays one');
    assert.equal(frozenCopy(base), base, 'a deep-frozen value is its own frozen copy');
});

test('isDeepFrozen looks all the way down', () => {
    assert.equal(isDeepFrozen(deepFreeze({ a: { b: [1, { c: 2 }] } })), true);
    assert.equal(isDeepFrozen(Object.freeze({ a: { b: 1 } })), false, 'frozen on top only');
    assert.equal(isDeepFrozen(Object.freeze({ a: Object.freeze({ b: Object.freeze([{}]) }) })), false);
    assert.equal(isDeepFrozen(Object.freeze({ a: Object.freeze({ b: Object.freeze([Object.freeze({})]) }) })), true);
    assert.equal(isDeepFrozen(3), true);
    assert.equal(isDeepFrozen({}), false);
});

// ---------- the bus ----------

const HEAD = {
    v: 2,
    meta: { rev: 3, claims: {} },
    domains: {
        bag: {
            stacks: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`it_${String(i).padStart(8, '0')}`, { id: `it_${String(i).padStart(8, '0')}`, qty: i + 1, tags: ['a'] }])),
            wallets: { party: { coin: 5 } },
            log: [],
        },
        other: { n: 1, deep: { list: [1, 2], x: { y: 'z' } } },
    },
};

function bus(modules, head = HEAD) {
    const store = fakeStore(head);
    return { store, bus: createCommandBus({ store, registry: fakeRegistry(modules), id: counterIds(), seed: () => 7 }) };
}

test('ctx.read hands out the head\'s own frozen slice; a drafted domain\'s read shares what did not change', () => {
    const seen = {};
    const module = {
        id: 'bag-module',
        domains: { bag: {}, other: {} },
        commands: {
            'bag.look'(ctx) {
                seen.other = ctx.read('other');
                seen.bagBefore = ctx.read('bag');
                const bag = ctx.draft('bag');
                bag.stacks.it_00000001.qty = 99;
                seen.bagAfter = ctx.read('bag');
                bag.wallets.party.coin = 6;
                seen.again = ctx.read('bag');
                return {};
            },
        },
    };
    const { store, bus: b } = bus([module]);
    const head = store.head();
    assert.equal(b.command('bag.look', {}).ok, true);
    assert.equal(seen.other, head.domains.other, 'an undrafted domain is the head\'s own slice');
    assert.equal(seen.bagBefore, head.domains.bag);
    assert.ok(deeplyFrozen(seen.bagAfter) && deeplyFrozen(seen.again));
    assert.equal(seen.bagAfter.stacks.it_00000001.qty, 99);
    assert.equal(seen.bagAfter.stacks.it_00000002, head.domains.bag.stacks.it_00000002, 'an untouched stack is the head\'s');
    assert.equal(seen.bagAfter.wallets, head.domains.bag.wallets);
    assert.equal(seen.bagAfter.wallets.party.coin, 5, 'a read is a snapshot: later writes do not reach it');
    assert.equal(seen.again.wallets.party.coin, 6);
});

test('a query sees the transaction\'s drafts through a frozen view and cannot write it; results are frozen', () => {
    const seen = {};
    const module = {
        id: 'bag-module',
        domains: { bag: {}, other: {} },
        queries: {
            'bag.peek': state => state.domains.bag.stacks.it_00000001,
            'bag.state': state => state,
            'bag.scribble': state => {
                state.domains.bag.wallets.party.coin = 1000;
                return 0;
            },
            'bag.wallet': state => ({ coin: state.domains.bag.wallets.party.coin, list: state.domains.bag.log }),
        },
        commands: {
            'bag.peek'(ctx) {
                const bag = ctx.draft('bag');
                bag.stacks.it_00000001.qty = 50;
                seen.peek = ctx.query('bag.peek');
                seen.state = ctx.query('bag.state');
                const mine = { coin: 1 };
                bag.wallets.party = mine;
                seen.first = ctx.query('bag.wallet').coin;
                mine.coin = 2;   // changed in place, not through the draft
                seen.second = ctx.query('bag.wallet').coin;
                return {};
            },
            'bag.scribble'(ctx) {
                ctx.draft('bag').log.push('x');
                return { data: { n: ctx.query('bag.scribble') } };
            },
            'bag.writeResult'(ctx) {
                ctx.query('bag.wallet').list.push(1);
                return {};
            },
        },
    };
    const { store, bus: b } = bus([module]);
    const head = store.head();
    assert.equal(b.command('bag.peek', {}).ok, true);
    assert.equal(seen.peek.qty, 50);
    assert.ok(deeplyFrozen(seen.peek) && deeplyFrozen(seen.state));
    assert.equal(seen.state.domains.other, head.domains.other, 'the view is the head where nothing is drafted');
    assert.equal(seen.state.domains.bag.stacks.it_00000002, head.domains.bag.stacks.it_00000002);
    assert.deepEqual([seen.first, seen.second], [1, 2], 'a value the handler changed in place is seen as it is now');

    const appended = store.appended.length;
    const scribbled = b.command('bag.scribble', {});
    assert.equal(scribbled.ok, false, 'a query that writes its state fails the command');
    assert.equal(scribbled.code, 'FAILED');
    const wrote = b.command('bag.writeResult', {});
    assert.equal(wrote.ok, false, 'a handler cannot write into a query result');
    assert.equal(store.appended.length, appended, 'nothing was stored');
    assert.deepEqual(store.head().domains.bag.wallets, { party: { coin: 2 } }, 'stored as the handler left it');
});

test('a state that is not frozen (a caller\'s own) is read from a frozen copy and left as it was', () => {
    const module = {
        id: 'bag-module',
        domains: { bag: {}, other: {} },
        commands: { 'bag.add'(ctx) { ctx.draft('bag').wallets.party.coin += 1; return { data: { other: ctx.read('other').n } }; } },
    };
    const { bus: b } = bus([module]);
    const mine = structuredClone(HEAD);
    const out = b.run('bag.add', {}, { cause: 'system', state: mine, seed: 1 });
    assert.equal(out.ok, true);
    assert.equal(out.state.domains.bag.wallets.party.coin, 6);
    assert.equal(mine.domains.bag.wallets.party.coin, 5);
    assert.equal(Object.isFrozen(mine.domains.other), false, 'the caller\'s object is not frozen');
    assert.ok(deeplyFrozen(out.state));
});

// A seeded corpus of handlers, each a list of writes, reads and queries on a draft. The bus's ops must be
// the old path's (the old diff of the head slice and the draft as the handler left it), and every read
// and query must show what the old deep-frozen copy of the draft showed, key order included.
function program(r) {
    return Array.from({ length: 1 + Math.floor(r() * 8) }, () => {
        const roll = r();
        const kind = roll < 0.45 ? 'set' : roll < 0.6 ? 'delete' : roll < 0.7 ? 'push' : roll < 0.85 ? 'read' : 'query';
        return { kind, pick: [r(), r(), r(), r()], value: stateValue(r, 2) };
    });
}

function pathIn(draft, pick) {
    let node = draft;
    const keys = [];
    for (const p of pick) {
        const inside = isPlain(node) ? Object.keys(node) : null;
        if (!inside?.length || p < 0.25) break;
        const key = inside[Math.floor(p * inside.length) % inside.length];
        keys.push(key);
        node = node[key];
    }
    return keys;
}

function run(draft, steps, look) {
    for (const step of steps) {
        const keys = pathIn(draft, step.pick);
        const parent = keys.slice(0, -1).reduce((node, key) => node[key], draft);
        const key = keys.at(-1);
        if (step.kind === 'read' || step.kind === 'query') look(step.kind);
        else if (!isPlain(parent) || key === undefined) continue;
        else if (step.kind === 'set') setKey(parent, key, clone(step.value));
        else if (step.kind === 'delete') delete parent[key];
        else if (Array.isArray(parent[key])) parent[key].push(clone(step.value));
    }
}

test('over a seeded corpus of handlers the bus stores the old path\'s ops and shows the old reads', () => {
    const r = rng(9001);
    let refused = 0;
    for (let n = 0; n < 400; n++) {
        const steps = program(r);
        const head = structuredClone(HEAD);
        if (r() < 0.5) head.domains.bag.extra = stateValue(r, 0);
        const looks = [];
        let last = null;
        const module = {
            id: 'bag-module',
            domains: { bag: {}, other: {} },
            queries: { 'bag.all': state => state.domains.bag },
            commands: {
                'bag.program'(ctx) {
                    const bag = ctx.draft('bag');
                    run(bag, steps, kind => {
                        const view = kind === 'read' ? ctx.read('bag') : ctx.query('bag.all');
                        assert.ok(deeplyFrozen(view), `corpus ${n}: a ${kind} is frozen`);
                        looks.push([JSON.stringify(view), JSON.stringify(deepFreeze(clone(bag)))]);
                    });
                    last = clone(bag);
                    return {};
                },
            },
        };
        const { store, bus: b } = bus([module], head);
        const before = store.head();
        const out = b.preview('bag.program', {});
        const expected = [...oldDiff(before.domains.bag, last, '/domains/bag'), { op: 'replace', path: '/meta/rev', value: 4 }];
        const problems = checkOps(expected, before);
        if (problems.length) {
            // Refused as the old ops were (a whole number written as 2.5, say), with the same words.
            assert.deepEqual([out.ok, out.code, out.message], [false, 'INVALID', `This change breaks the state's rules: ${problems.join(' ')}`], `corpus ${n}`);
            refused++;
        } else {
            assert.equal(out.ok, true, `corpus ${n}: ${out.message}`);
            assert.deepStrictEqual(out.ops, expected, `corpus ${n}`);
        }
        for (const [seen, old] of looks) assert.equal(seen, old, `corpus ${n}: a read shows the draft as it was`);
    }
    assert.ok(refused > 0 && refused < 200, `${refused} of 400 refused`);
});
