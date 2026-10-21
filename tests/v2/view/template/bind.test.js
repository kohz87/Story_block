// Bindings: paths, scopes, pointers, changed(), helpers, and handing expressions to the condition language.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TEMPLATE_CALLS, changedPointers, compileExpr, conditionEvaluator, evalExpr, interpolate, isScope, makeScope, parseInterpolation, parsePath,
    pathKeys, pct, pointerOf, ratio, len, resolvePath, setIn, splitPairs, stateView, toText, touches, withItem,
} from '../../../../src/v2/view/bind.js';
import { fakeEvaluate } from './helpers.js';

const STATE = {
    v: 2,
    meta: { rev: 7, claims: {} },
    domains: {
        party: { pc: 'ac_aaaaaaaa', actors: { ac_aaaaaaaa: { id: 'ac_aaaaaaaa', name: 'Ren', hp: { cur: 57, max: 82 } } } },
        inventory: {
            defs: { 'story/moonveil-trout': { name: 'Moonveil Trout' } },
            stacks: { it_k3f9a2qz: { id: 'it_k3f9a2qz', def: 'story/moonveil-trout', qty: 2 } },
        },
    },
};

test('parsePath: dots, indexes, quoted keys, nested dynamic keys; anything else is not a path', () => {
    assert.deepEqual(parsePath('a.b.c'), { root: 'a', steps: [{ key: 'b' }, { key: 'c' }], source: 'a.b.c' });
    assert.deepEqual(parsePath(" list[0]['story/x'][\"y\"] ").steps, [{ key: '0' }, { key: 'story/x' }, { key: 'y' }]);
    assert.equal(parsePath('defs[s.def].name').steps[0].path.source, 's.def');
    for (const text of ['', 'a +', 'a.b > 1', '1abc', 'a..b', 'a[', 'f(x)', 'a.b c']) assert.equal(parsePath(text), null, text);
});

test('resolvePath: state reads domains; own properties only; missing steps are undefined', () => {
    const scope = makeScope({ state: STATE, q: { pc: STATE.domains.party.actors.ac_aaaaaaaa } });
    assert.equal(resolvePath(scope, 'state.party.actors.ac_aaaaaaaa.hp.cur'), 57);
    assert.equal(resolvePath(scope, 'state.meta.rev'), 7);
    assert.equal(resolvePath(scope, 'q.pc.name'), 'Ren');
    assert.equal(resolvePath(scope, "state.inventory.defs['story/moonveil-trout'].name"), 'Moonveil Trout');
    const item = withItem(scope, 's', STATE.domains.inventory.stacks.it_k3f9a2qz);
    assert.equal(resolvePath(item, 'state.inventory.defs[s.def].name'), 'Moonveil Trout', 'dynamic key');
    assert.equal(resolvePath(scope, 'q.pc.name.length'), 3);
    assert.equal(resolvePath(scope, 'q.nothing.here'), undefined);
    for (const path of ['q.pc.constructor', 'q.__proto__', 'q.pc.hasOwnProperty', 'q.pc.toString', 'state.constructor.prototype']) {
        assert.equal(resolvePath(scope, path), undefined, path);
    }
});

test('pointerOf: state paths and loop items map to JSON Pointers; queries and drafts do not', () => {
    const scope = makeScope({ state: STATE, q: { list: [] } });
    assert.equal(pointerOf(scope, 'state.inventory.stacks'), '/domains/inventory/stacks');
    assert.equal(pointerOf(scope, 'state.meta.rev'), '/meta/rev');
    assert.equal(pointerOf(scope, "state.inventory.defs['story/a~b']"), '/domains/inventory/defs/story~1a~0b');
    assert.equal(pointerOf(scope, 'q.list'), null);
    assert.equal(pointerOf(scope, 'draft.name'), null);
    const item = withItem(scope, 's', {}, '/domains/inventory/stacks/it_k3f9a2qz', 'i', 0);
    assert.equal(pointerOf(item, 's.qty'), '/domains/inventory/stacks/it_k3f9a2qz/qty');
    assert.equal(pointerOf(item, 'i'), null);
});

test('changed(): an op at, under or above the path; bare, quoted and pointer arguments', () => {
    const ops = [
        { op: 'replace', path: '/domains/inventory/stacks/it_k3f9a2qz/qty', value: 1 },
        { op: 'add', path: '/domains/scene/place', value: { name: 'Bluewatch' } },
        { op: 'replace', path: '/meta/rev', value: 8 },
    ];
    assert.deepEqual([...changedPointers(ops)], ops.map(op => op.path));
    const scope = makeScope({ state: STATE, ops });
    assert.equal(scope.changed('state.inventory.stacks.it_k3f9a2qz.qty'), true, 'at');
    assert.equal(scope.changed('state.inventory'), true, 'above the op');
    assert.equal(scope.changed('state.scene.place.name'), true, 'below the op (the whole place was set)');
    assert.equal(scope.changed('state.inventory.defs'), false);
    assert.equal(scope.changed('state.party'), false);
    assert.equal(scope.changed('/domains/scene'), true, 'a JSON Pointer');
    assert.equal(scope.changed('q.list'), false, 'a query has no pointer');
    assert.equal(scope.changed(42), false);
    const item = withItem(scope, 's', STATE.domains.inventory.stacks.it_k3f9a2qz, '/domains/inventory/stacks/it_k3f9a2qz');
    assert.equal(evalExpr(compileExpr('changed(s.qty)'), item), true, 'bare path, read here');
    assert.equal(evalExpr(compileExpr('changed(s.def)'), item), false);
    assert.equal(evalExpr(compileExpr("changed('state.scene')"), item), true, 'quoted');
    // Bare paths reach the condition language quoted.
    let seen = '';
    evalExpr(compileExpr('changed(s.qty) && s.qty > 0'), item, (expr, sc) => {
        seen = expr;
        return fakeEvaluate(expr, sc);
    });
    assert.equal(seen, 'changed("s.qty") && s.qty > 0');
    assert.equal(evalExpr(compileExpr('changed(s.qty) && s.qty > 1'), item, fakeEvaluate), true);
    assert.equal(touches(new Set(), '/x'), false);
    assert.equal(makeScope({ state: STATE, changed: new Set(['/domains/party']) }).changed('state.party.pc'), true, 'a Set of pointers');
    assert.equal(makeScope({ state: STATE, changed: ['/domains/party'] }).changed('state.party'), true, 'a list of pointers');
});

test('helpers: ratio, pct, len, fmt with injected and default formatters', () => {
    assert.equal(ratio(57, 82), 0.6951);
    assert.equal(ratio(90, 82), 1, 'clamped');
    assert.equal(ratio(-3, 82), 0);
    assert.equal(ratio(5, 0), 0);
    assert.equal(ratio('5', '10'), 0.5);
    assert.equal(ratio(null, 10), 0);
    assert.equal(pct(57, 82), 70);
    assert.equal(len([1, 2]), 2);
    assert.equal(len({ a: 1 }), 1);
    assert.equal(len('abc'), 3);
    assert.equal(len(null), 0);
    const plain = makeScope({});
    assert.equal(plain.fmt.money(125), '125');
    assert.equal(plain.fmt.time(1440 + 13 * 60 + 5), 'Day 2, 13:05');
    assert.equal(plain.fmt.time(null), '');
    const custom = makeScope({ formatters: { money: n => `${Math.floor(n / 100)}g ${n % 100}s`, time: () => { throw new Error('boom'); } } });
    assert.equal(evalExpr(compileExpr('fmt.money(q.x)'), { ...custom, q: { x: 1234 } }), '12g 34s');
    assert.equal(custom.fmt.time(5), '', 'a failing formatter reads as empty');
    assert.equal(isScope(custom), true);
    assert.equal(isScope({ state: {} }), false);
});

test('compileExpr: paths, literals, ! and helper calls are read without the condition language', () => {
    const scope = makeScope({ state: STATE, q: { hp: { cur: 57, max: 82 }, on: false } });
    const fast = text => compileExpr(text).fast !== null;
    for (const text of ['q.hp.cur', '12', '-1.5', "'text'", 'true', 'null', '!q.on', 'ratio(q.hp.cur, q.hp.max)', 'pct(q.hp.cur, 100)', 'len(q.hp)', 'fmt.money(5)', 'changed(q.hp)']) {
        assert.equal(fast(text), true, text);
    }
    for (const text of ['q.hp.cur > 3', 'a && b', 'other(q)', 'q.hp.cur + 1', 'ratio(q.hp.cur, q.hp.max) > 0.5']) assert.equal(fast(text), false, text);
    assert.equal(evalExpr('ratio(q.hp.cur, q.hp.max)', scope), 0.6951);
    assert.equal(evalExpr('!q.on', scope), true);
    assert.equal(evalExpr("'a'", scope), 'a');
    // The rest goes to the injected evaluate, with the scope as it is.
    assert.equal(evalExpr('q.hp.cur > 50 && !q.on', scope, fakeEvaluate), true);
    const warnings = [];
    assert.equal(evalExpr('q.hp.cur > 50', scope, null, message => warnings.push(message)), undefined, 'no language loaded');
    assert.match(warnings[0], /condition language/);
    assert.equal(evalExpr('q.hp.cur >', scope, fakeEvaluate, message => warnings.push(message)), undefined, 'a throw reads as undefined');
    assert.match(warnings[1], /could not be read/);
});

test('interpolation, text and pairs', () => {
    const scope = makeScope({ q: { name: 'Ren', n: 3, list: ['a', 2, { x: 1 }], obj: { a: 1 } } });
    assert.equal(parseInterpolation('plain'), null);
    assert.equal(parseInterpolation('{{ open'), null);
    assert.equal(interpolate(parseInterpolation('{{ q.name }} has {{q.n}} — {{ q.missing }}.'), scope), 'Ren has 3 — .');
    assert.equal(interpolate(parseInterpolation('{{ q.list }}|{{ q.obj }}'), scope), 'a, 2|');
    assert.equal(toText(true), 'true');
    assert.equal(toText(NaN), '');
    assert.deepEqual(splitPairs("src: q.a; title: q.b ? 'x;y' : q.c ;; bad"), [['src', 'q.a'], ['title', "q.b ? 'x;y' : q.c"]]);
    assert.deepEqual(splitPairs('--pct: ratio(a.b, c.d)'), [['--pct', 'ratio(a.b, c.d)']]);
});

test('setIn and pathKeys copy on write and refuse prototype keys', () => {
    const draft = Object.freeze({ stats: Object.freeze({ STR: 1 }), name: 'Ren' });
    const next = setIn(draft, ['stats', 'VIT'], 2);
    assert.deepEqual(next, { stats: { STR: 1, VIT: 2 }, name: 'Ren' });
    assert.deepEqual(draft, { stats: { STR: 1 }, name: 'Ren' }, 'the original is kept');
    assert.deepEqual(setIn({}, ['a', 'b', 'c'], 1), { a: { b: { c: 1 } } });
    assert.throws(() => setIn({}, ['__proto__', 'x'], 1));
    assert.throws(() => setIn({}, ['constructor'], 1));
    const scope = withItem(makeScope({}), 'k', 'DEX');
    assert.deepEqual(pathKeys(scope, 'stats[k]'), ['stats', 'DEX']);
    assert.equal(pathKeys(scope, 'stats[missing]'), null);
    assert.deepEqual(Object.keys(stateView(STATE)).sort(), ['inventory', 'meta', 'party', 'v']);
});

test('conditionEvaluator wraps the events language: names from the scope, helpers as calls, errors as warnings', () => {
    const seen = [];
    // Shaped like src/v2/events: compile(source, options) → { ok, ast }; evaluate(ast, env) → { ok, value }.
    const language = {
        compile: (source, options) => {
            seen.push(options);
            return source === 'bad(' ? { ok: false, error: { message: 'Expected a value.' } } : { ok: true, ast: source };
        },
        evaluate: (ast, env) => {
            if (ast === 'q.hp == fails') return { ok: false, error: { message: '&& needs true or false.' } };
            return { ok: true, value: fakeEvaluate(ast, { ...env.scope, ...env.calls, fmt: { money: env.calls['fmt.money'] }, query: env.query }) };
        },
    };
    const evaluate = conditionEvaluator(language);
    const scope = makeScope({ state: STATE, q: { hp: 5 }, query: name => (name === 'party.pc' ? { level: 31 } : null) });
    assert.equal(evalExpr('q.hp < 10 && ratio(q.hp, 10) == 0.5', scope, evaluate), true);
    assert.equal(evalExpr("query('party.pc').level >= 30", scope, evaluate), true);
    assert.deepEqual(seen[0], { names: true, calls: TEMPLATE_CALLS });
    const warnings = [];
    assert.equal(evalExpr('bad(', scope, evaluate, message => warnings.push(message)), undefined);
    assert.equal(evalExpr('q.hp == fails', scope, evaluate, message => warnings.push(message)), undefined);
    assert.deepEqual(warnings.map(w => w.replace(/^.* could not be read: /, '')), ['Expected a value.', '&& needs true or false.']);
    assert.throws(() => conditionEvaluator({}), /compile and evaluate/);
});
