// Ops: diff states into JSON Patch, apply them back, and hold them to the generic rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, checkOps, clone, deepFreeze, diff, equal, escapeKey, isJson, parsePath, valueAt } from '../../src/v2/ops.js';
import { rng } from '../../src/v2/rng.js';

test('diff: minimal add / replace / remove in sorted key order', () => {
    const before = { b: 1, a: { x: 1, y: 2 }, gone: true };
    const after = { c: 3, b: 2, a: { x: 1, z: 4 } };
    assert.deepEqual(diff(before, after), [
        { op: 'remove', path: '/a/y' },
        { op: 'add', path: '/a/z', value: 4 },
        { op: 'replace', path: '/b', value: 2 },
        { op: 'add', path: '/c', value: 3 },
        { op: 'remove', path: '/gone' },
    ]);
    assert.deepEqual(diff(before, structuredClone(before)), []);
    assert.deepEqual(diff({ z: 1, a: 1 }, { a: 2, z: 2 }), diff({ a: 1, z: 1 }, { z: 2, a: 2 }), 'insertion order does not matter');
});

test('diff: basePath, type changes and escaped keys', () => {
    assert.deepEqual(diff({ qty: 1 }, { qty: 2 }, '/domains/inventory/stacks/it_k3f9a2qz'), [
        { op: 'replace', path: '/domains/inventory/stacks/it_k3f9a2qz/qty', value: 2 },
    ]);
    assert.deepEqual(diff({ a: { b: 1 } }, { a: [1] }), [{ op: 'replace', path: '/a', value: [1] }]);
    assert.deepEqual(diff({ a: null }, { a: { b: 1 } }), [{ op: 'replace', path: '/a', value: { b: 1 } }]);
    assert.deepEqual(diff({}, { 'a/b': 1, 'c~d': 2 }), [
        { op: 'add', path: '/a~1b', value: 1 },
        { op: 'add', path: '/c~0d', value: 2 },
    ]);
    assert.deepEqual(diff(1, 2), [{ op: 'replace', path: '', value: 2 }]);
});

test('diff: arrays are appended to when that is all that changed, else replaced whole', () => {
    assert.deepEqual(diff({ l: [1, 2] }, { l: [1, 2, 3, { a: 1 }] }), [
        { op: 'add', path: '/l/-', value: 3 },
        { op: 'add', path: '/l/-', value: { a: 1 } },
    ]);
    assert.deepEqual(diff({ l: [1, 2, 3] }, { l: [1, 3] }), [{ op: 'replace', path: '/l', value: [1, 3] }]);
    assert.deepEqual(diff({ l: [1, 2] }, { l: [2, 1] }), [{ op: 'replace', path: '/l', value: [2, 1] }]);
    assert.deepEqual(diff({ l: [{ a: 1 }] }, { l: [{ a: 2 }] }), [{ op: 'replace', path: '/l', value: [{ a: 2 }] }]);
    assert.deepEqual(diff({ l: [] }, { l: [] }), []);
});

test('diff: values in ops are copies', () => {
    const after = { a: { deep: [1] } };
    const [op] = diff({}, after);
    after.a.deep.push(2);
    assert.deepEqual(op.value, { deep: [1] });
});

test('apply: pure, shares unchanged branches, works on frozen input', () => {
    const state = deepFreeze({ v: 2, meta: { rev: 0 }, domains: { a: { n: 1 }, b: { list: [1] } } });
    const next = apply(state, [
        { op: 'replace', path: '/domains/a/n', value: 2 },
        { op: 'add', path: '/domains/a/m', value: { x: 1 } },
        { op: 'add', path: '/domains/b/list/-', value: 2 },
        { op: 'add', path: '/domains/b/list/0', value: 0 },
        { op: 'replace', path: '/meta/rev', value: 1 },
    ]);
    assert.deepEqual(next, { v: 2, meta: { rev: 1 }, domains: { a: { n: 2, m: { x: 1 } }, b: { list: [0, 1, 2] } } });
    assert.deepEqual(state.domains.a, { n: 1 }, 'input untouched');
    assert.notEqual(next.domains, state.domains);
    const shared = apply(state, [{ op: 'replace', path: '/domains/a/n', value: 5 }]);
    assert.equal(shared.domains.b, state.domains.b, 'an untouched branch is shared');
    assert.equal(apply(state, []), state);
});

test('apply: remove from objects and arrays, add over an existing key, escaped keys', () => {
    const state = { a: { 'x/y': 1, 'p~q': 2 }, l: [1, 2, 3] };
    assert.deepEqual(apply(state, [
        { op: 'remove', path: '/a/x~1y' },
        { op: 'add', path: '/a/p~0q', value: 9 },
        { op: 'remove', path: '/l/1' },
        { op: 'replace', path: '/l/0', value: 7 },
    ]), { a: { 'p~q': 9 }, l: [7, 3] });
    assert.deepEqual(apply(state, [{ op: 'replace', path: '', value: { whole: true } }]), { whole: true });
});

test('apply: inserted values are copies of the op value', () => {
    const op = { op: 'add', path: '/a', value: { list: [1] } };
    const next = apply({}, [op]);
    op.value.list.push(2);
    assert.deepEqual(next, { a: { list: [1] } });
});

test('apply: throws on bad ops and paths that do not fit', () => {
    const state = deepFreeze({ a: { b: 1 }, l: [1, 2], s: 'text' });
    const bad = [
        { op: 'move', path: '/a', from: '/b' },
        { op: 'test', path: '/a', value: 1 },
        { op: 'replace', path: '/missing', value: 1 },
        { op: 'remove', path: '/missing' },
        { op: 'add', path: '/missing/deeper', value: 1 },
        { op: 'replace', path: '/s/0', value: 'x' },
        { op: 'replace', path: '/l/2', value: 1 },
        { op: 'add', path: '/l/3', value: 1 },
        { op: 'add', path: '/l/01', value: 1 },
        { op: 'replace', path: '/l/-', value: 1 },
        { op: 'remove', path: '' },
        { op: 'replace', path: 'a/b', value: 1 },
        { op: 'replace', path: '/a/b~2', value: 1 },
        { op: 'add', path: '/__proto__/polluted', value: 1 },
        { op: 'add', path: '/a/c' },
        null,
    ];
    for (const op of bad) assert.throws(() => apply(state, [op]), Error, JSON.stringify(op));
    assert.throws(() => apply(state, 'nope'), /list/);
    assert.equal({}.polluted, undefined);
});

test('parsePath / escapeKey / valueAt', () => {
    assert.deepEqual(parsePath(''), []);
    assert.deepEqual(parsePath('/a~1b/c~0d/'), ['a/b', 'c~d', '']);
    assert.equal(escapeKey('a/b~c'), 'a~1b~0c');
    assert.equal(valueAt({ a: [{ b: 3 }] }, '/a/0/b'), 3);
    assert.equal(valueAt({ a: 1 }, '/a/b'), undefined);
    assert.equal(valueAt({ a: 1 }, 'bad'), undefined);
});

test('equal, clone, isJson', () => {
    assert.equal(equal({ a: [1, { b: null }] }, { a: [1, { b: null }] }), true);
    assert.equal(equal({ a: 1 }, { a: 1, b: undefined }), false);
    assert.equal(equal([1], { 0: 1 }), false);
    const source = { a: [{ b: 1 }] };
    const copy = clone(source);
    assert.deepEqual(copy, source);
    assert.notEqual(copy.a[0], source.a[0]);
    assert.equal(isJson({ a: [1, 'x', true, null] }), true);
    for (const bad of [{ a: undefined }, { a: NaN }, [Infinity], new Date(), new Map(), () => 1]) assert.equal(isJson(bad), false);
});

// A seeded generator of plain JSON, for diff/apply round trips.
function randomValue(r, depth) {
    const pick = Math.floor(r() * (depth > 3 ? 4 : 7));
    if (pick === 0) return Math.floor(r() * 100);
    if (pick === 1) return ['a', 'b', 'x/y', 'm~n', ''][Math.floor(r() * 5)];
    if (pick === 2) return r() < 0.5;
    if (pick === 3) return null;
    if (pick === 4 || pick === 5) {
        const out = {};
        const keys = ['a', 'b', 'c', 'd', 'it_k3f9a2qz', 'x/y', 'm~n', '0'];
        for (const key of keys) if (r() < 0.4) out[key] = randomValue(r, depth + 1);
        return out;
    }
    return Array.from({ length: Math.floor(r() * 4) }, () => randomValue(r, depth + 1));
}

function mutate(r, value, depth = 0) {
    if (r() < 0.15) return randomValue(r, depth);
    if (Array.isArray(value)) {
        const out = value.map(item => (r() < 0.3 ? mutate(r, item, depth + 1) : item));
        if (r() < 0.3) out.push(randomValue(r, depth + 1));
        if (r() < 0.2 && out.length) out.shift();
        return out;
    }
    if (value && typeof value === 'object') {
        const out = { ...value };
        for (const key of Object.keys(out)) {
            const roll = r();
            if (roll < 0.15) delete out[key];
            else if (roll < 0.5) out[key] = mutate(r, out[key], depth + 1);
        }
        if (r() < 0.3) out[`k${Math.floor(r() * 5)}`] = randomValue(r, depth + 1);
        return out;
    }
    return r() < 0.5 ? value : randomValue(r, depth);
}

test('diff/apply round trip: apply(a, diff(a, b)) deep-equals b over 500 seeded pairs', () => {
    const r = rng(20261021);
    for (let i = 0; i < 500; i++) {
        const a = deepFreeze({ root: randomValue(r, 0) });
        const b = { root: mutate(r, structuredClone(a.root)) };
        const ops = diff(a, b);
        assert.deepEqual(apply(a, ops), b, `pair ${i}`);
        assert.deepEqual(diff(a, b), ops, 'deterministic');
        assert.deepEqual(diff(b, apply(a, ops)), [], 'nothing left to change');
    }
});

test('checkOps: plain JSON only, no NaN or Infinity, known ops, paths below the root', () => {
    assert.deepEqual(checkOps([
        { op: 'replace', path: '/domains/party/actors/ac_k3f9a2qz/hp/cur', value: 57 },
        { op: 'add', path: '/domains/scene/present/-', value: 'Fenna' },
        { op: 'remove', path: '/domains/inventory/stacks/it_k3f9a2qz' },
        { op: 'add', path: '/meta/claims/quest:q_ab12cd34:paid', value: true },
        { op: 'replace', path: '/meta/rev', value: 3 },
    ]), []);
    const cases = [
        [{ op: 'replace', path: '/a', value: NaN }, /not a finite number/],
        [{ op: 'replace', path: '/a', value: { b: [Infinity] } }, /\/a\/b\/0 is Infinity/],
        [{ op: 'add', path: '/a', value: { b: undefined } }, /undefined/],
        [{ op: 'add', path: '/a', value: new Date(0) }, /plain/],
        [{ op: 'add', path: '/a' }, /no value/],
        [{ op: 'move', path: '/a', from: '/b' }, /add, replace or remove/],
        [{ op: 'replace', path: '', value: {} }, /whole state/],
        [{ op: 'replace', path: 'a', value: 1 }, /must start with/],
        [{ op: 'add', path: '/__proto__/x', value: 1 }, /__proto__/],
        [{ op: 'replace', path: '/meta/rev', value: 1.5 }, /meta\/rev/],
        [null, /Change 1/],
    ];
    for (const [op, pattern] of cases) {
        const errors = checkOps([op]);
        assert.equal(errors.length > 0, true, JSON.stringify(op));
        assert.match(errors.join(' '), pattern);
    }
    assert.deepEqual(checkOps('x'), ['The changes are not a list.']);
});

test('checkOps: qty is a whole number, 0 or more, at a path end or inside a value', () => {
    assert.deepEqual(checkOps([{ op: 'replace', path: '/domains/inventory/stacks/it_k3f9a2qz/qty', value: 0 }]), []);
    assert.match(checkOps([{ op: 'replace', path: '/domains/inventory/stacks/it_k3f9a2qz/qty', value: -1 }])[0], /qty must be a whole number, 0 or more \(got -1\)/);
    assert.match(checkOps([{ op: 'replace', path: '/x/qty', value: 1.5 }])[0], /qty/);
    assert.match(checkOps([{ op: 'replace', path: '/x/qty', value: '2' }])[0], /qty/);
    const nested = checkOps([{ op: 'add', path: '/domains/inventory/stacks/it_k3f9a2qz', value: { id: 'it_k3f9a2qz', qty: -2 } }]);
    assert.equal(nested.length, 1);
    assert.match(nested[0], /stacks\/it_k3f9a2qz\/qty: qty/);
    assert.match(checkOps([{ op: 'add', path: '/t', value: { orders: [{ materials: [{ qty: -1 }] }] } }])[0], /\/t\/orders\/0\/materials\/0\/qty/);
});

test('checkOps: id fields hold well-formed IDs; *Id and *_id fields may be null', () => {
    assert.deepEqual(checkOps([{ op: 'add', path: '/d/x', value: { id: 'it_k3f9a2qz', defId: 'story/moonveil-trout', stackId: null, owner_id: 'ac_k3f9a2qz' } }]), []);
    assert.deepEqual(checkOps([{ op: 'add', path: '/defs/story~1trout', value: { id: 'story/trout' } }]), []);
    for (const value of [{ id: 'Moonveil Trout' }, { id: null }, { id: 'it_short' }, { stackId: 'stack one' }, { owner_id: 5 }]) {
        assert.equal(checkOps([{ op: 'add', path: '/d/x', value }]).length, 1, JSON.stringify(value));
    }
    assert.match(checkOps([{ op: 'replace', path: '/d/x/id', value: 'nope' }])[0], /\/d\/x\/id: id must be an ID/);
    assert.deepEqual(checkOps([{ op: 'replace', path: '/d/x/name', value: 'it is not an id' }]), [], 'other keys are free text');
});

test('checkOps with the state before: integers stay integers', () => {
    const before = { d: { hp: { cur: 57, max: 82 }, ratio: 0.5, list: [1, 2], name: 'Ren' } };
    assert.deepEqual(checkOps([{ op: 'replace', path: '/d/hp/cur', value: 60 }], before), []);
    assert.deepEqual(checkOps([{ op: 'replace', path: '/d/ratio', value: 0.75 }], before), [], 'a float may stay a float');
    assert.deepEqual(checkOps([{ op: 'replace', path: '/d/name', value: 2.5 }], before), [], 'only numbers that were whole are held');
    assert.match(checkOps([{ op: 'replace', path: '/d/hp/cur', value: 60.5 }], before)[0], /\/d\/hp\/cur was a whole number/);
    assert.match(checkOps([{ op: 'replace', path: '/d/hp', value: { cur: 1.5, max: 82 } }], before)[0], /\/d\/hp\/cur/);
    assert.match(checkOps([{ op: 'replace', path: '/d/list', value: [1, 2.5] }], before)[0], /\/d\/list\/1/);
    assert.deepEqual(checkOps([{ op: 'replace', path: '/d/hp/cur', value: 60.5 }]), [], 'without the state, nothing to compare');
});

test('checkOps: no value may hold a key named __proto__, constructor or prototype, at any depth (QA #70)', () => {
    const own = (key, value) => Object.defineProperty({}, key, { value, enumerable: true, configurable: true, writable: true });
    const cases = [
        [{ op: 'add', path: '/domains/a/x', value: JSON.parse('{"__proto__": {"polluted": 1}}') }, /\/domains\/a\/x holds a key named "__proto__"/],
        [{ op: 'add', path: '/domains/a/x', value: { constructor: 'Kael' } }, /"constructor"/],
        [{ op: 'replace', path: '/domains/a/x', value: { list: [{ deep: own('prototype', 1) }] } }, /\/domains\/a\/x\/list\/0\/deep holds a key named "prototype"/],
    ];
    for (const [op, pattern] of cases) {
        const errors = checkOps([op]);
        assert.equal(errors.length, 1, JSON.stringify(op));
        assert.match(errors[0], pattern);
    }
    assert.equal(({}).polluted, undefined);
    // A path segment named constructor (an alias key for an item called "Constructor") is a plain key.
    assert.deepEqual(checkOps([{ op: 'add', path: '/domains/inventory/aliases/constructor', value: 'story/constructor' }]), []);
    assert.deepEqual(checkOps([{ op: 'add', path: '/domains/a/x', value: { constructors: 1, proto: 2, Prototype: 3 } }]), [], 'only the exact names');
    assert.match(checkOps([{ op: 'add', path: '/domains/a/__proto__', value: 1 }])[0], /names __proto__/, 'a path naming __proto__ is still refused');
});

test('clone keeps a prototype-less object prototype-less; plain objects stay plain', () => {
    const bare = Object.assign(Object.create(null), { qty: '2', inner: Object.assign(Object.create(null), { a: 1 }) });
    const copy = clone({ labels: bare, plain: { b: 2 } });
    assert.equal(Object.getPrototypeOf(copy.labels), null);
    assert.equal(Object.getPrototypeOf(copy.labels.inner), null);
    assert.equal(copy.labels.constructor, undefined, 'nothing inherited');
    assert.equal(Object.getPrototypeOf(copy.plain), Object.prototype);
    assert.notEqual(copy.labels, bare);
    assert.equal(equal(copy.labels, bare), true);
});
