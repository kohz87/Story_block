// The events condition language: tokenizer, parser, evaluator, limits, and what it refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CALLS, LIMITS, compile, evaluate, evaluateCondition, parse, tokenize } from '../../../src/v2/events/condition.js';

const env = (domains = {}, query) => ({ state: { v: 2, meta: { rev: 0, claims: {} }, domains }, query });
const value = (source, context = env()) => {
    const parsed = parse(source);
    assert.ok(parsed.ok, `parses: ${source} (${parsed.error?.message})`);
    const result = evaluate(parsed.ast, context);
    assert.ok(result.ok, `evaluates: ${source} (${result.error?.message})`);
    return result.value;
};
const error = (source, context = env()) => evaluateCondition(source, context).error;
const shape = node => {
    switch (node.type) {
        case 'lit': return JSON.stringify(node.value);
        case 'logic': case 'compare': return `(${shape(node.left)} ${node.op} ${shape(node.right)})`;
        case 'not': return `!${shape(node.arg)}`;
        case 'neg': return `-${shape(node.arg)}`;
        case 'member': return `${shape(node.object)}.${node.key}`;
        case 'index': return `${shape(node.object)}[${shape(node.key)}]`;
        case 'call': return `${node.name}(${node.args.map(shape).join(', ')})`;
        case 'record': return `{${node.entries.map(([key, item]) => `${key}: ${shape(item)}`).join(', ')}}`;
        default: return '?';
    }
};
const tree = source => shape(parse(source).ast);

test('tokenize: numbers, words with escapes, names, operators, punctuation, positions', () => {
    const { ok, tokens } = tokenize(`count(x) >= 2.5 && 'it\\'s' != "a\\"b\\n" || !{k:[1]}`);
    assert.equal(ok, true);
    assert.deepEqual(tokens.map(token => [token.type, token.value]), [
        ['name', 'count'], ['punc', '('], ['name', 'x'], ['punc', ')'], ['op', '>='], ['num', 2.5], ['op', '&&'],
        ['str', 'it\'s'], ['op', '!='], ['str', 'a"b\n'], ['op', '||'], ['op', '!'], ['punc', '{'], ['name', 'k'],
        ['punc', ':'], ['punc', '['], ['num', 1], ['punc', ']'], ['punc', '}'], ['end', null],
    ]);
    assert.deepEqual(tokens.slice(0, 5).map(token => token.at), [0, 5, 6, 7, 9]);
});

test('tokenize refuses what the language does not have, with the place', () => {
    const cases = {
        'a = 1': ['SYNTAX', /use == to compare/],
        'a & b': ['SYNTAX', /use &&/],
        'a | b': ['SYNTAX', /use \|\|/],
        '`x`': ['SYNTAX', /Unexpected character "`"/],
        '1 + 2': ['SYNTAX', /Unexpected character "\+"/],
        '"open': ['SYNTAX', /never closed/],
        '"line\nbreak"': ['SYNTAX', /never closed/],
        '"\\x41"': ['SYNTAX', /Unknown escape/],
        '12abc': ['SYNTAX', /runs into a name/],
        '1e5': ['SYNTAX', /runs into a name/],
        'a; b': ['SYNTAX', /";"/],
        '99999999999999999999 > 1': ['LIMIT', /too large/],
        'é': ['SYNTAX', /Unexpected character/],
    };
    for (const [source, [code, pattern]] of Object.entries(cases)) {
        const result = tokenize(source);
        assert.equal(result.ok, false, source);
        assert.equal(result.error.code, code, source);
        assert.match(result.error.message, pattern, source);
        assert.equal(typeof result.error.at, 'number');
    }
    assert.equal(tokenize(42).error.code, 'SYNTAX', 'a condition is text');
});

test('precedence: || below &&, below == !=, below < <= > >=, below ! and -, below reads and calls', () => {
    assert.equal(tree('true || false && false'), '(true || (false && false))');
    assert.equal(tree('true && false || true'), '((true && false) || true)');
    assert.equal(tree('1 < 2 == true'), '((1 < 2) == true)');
    assert.equal(tree('!true == false'), '(!true == false)');
    assert.equal(tree('-1 < 0 && !(1 >= 2)'), '((-1 < 0) && !(1 >= 2))');
    assert.equal(tree('time() > 3 || true'), '((time() > 3) || true)');
    assert.equal(tree(`quest('X').fields['step'] == 'done'`), '(quest("X").fields["step"] == "done")');
    assert.equal(tree(`!has('Rope')`), '!has("Rope")');
    assert.equal(tree(`query('a.b', { id: 'x', n: -2 })[0].hp.cur`), 'query("a.b", {id: "x", n: -2})[0].hp.cur');
    assert.equal(tree('true || true || false'), '((true || true) || false)', 'left to right');
    // The values agree with the trees.
    assert.equal(value('true || false && false'), true);
    assert.equal(value('false && false || true'), true);
    assert.equal(value('!false && 2 > 1'), true);
    assert.equal(value('(true || false) && false'), false);
    assert.equal(value('-3 < -2'), true);
    assert.equal(value('--3'), 3);
});

test('comparisons do not chain', () => {
    for (const source of ['1 < 2 < 3', '1 == 1 == true', '1 >= 0 <= 2']) {
        const result = parse(source);
        assert.equal(result.ok, false, source);
        assert.match(result.error.message, /do not chain/);
    }
    assert.equal(value('1 < 2 && 2 < 3'), true);
});

test('types: == never converts, < takes two numbers or two words, logic takes true/false', () => {
    assert.equal(value('1 == 1'), true);
    assert.equal(value('1 == 1.0'), true);
    assert.equal(value(`1 == '1'`), false);
    assert.equal(value('null == null'), true);
    assert.equal(value('0 == false'), false);
    assert.equal(value(`'' != null`), true);
    assert.equal(value(`'apple' < 'banana'`), true);
    assert.equal(value('2.5 <= 2.5'), true);
    assert.equal(value('-0 == 0'), true);
    assert.equal(error(`1 < '2'`).code, 'TYPE');
    assert.match(error(`1 < '2'`).message, /two numbers or two words, not a number and a word/);
    assert.match(error('null >= 3').message, /nothing \(null\) and a number/);
    assert.match(error('1 && true').message, /left side of && needs true or false, not a number/);
    assert.equal(evaluateCondition(`true || 'x'`).met, true);
    assert.match(error(`false || 'x'`).message, /right side of \|\| needs true or false, not a word/);
    assert.match(error('!1').message, /! needs true or false/);
    assert.match(error(`-'a'`).message, /- needs a number/);
    assert.match(error(`{a: 1} == {a: 1}`).message, /not a record/);
    assert.match(error(`{a: 1} == 1`).message, /not a record/);
    assert.equal(value(`{a: 1} != null`), true, 'a record or list compares with null: "is there one?"');
    assert.equal(value(`null == {a: 1}`), false);
    assert.equal(value(`query('q') == null`, env({}, () => [1])), false);
});

test('short-circuit: the side not needed is never evaluated (no error, no call)', () => {
    let asked = 0;
    const context = env({}, () => { asked += 1; return true; });
    assert.deepEqual(evaluateCondition(`false && query('x')`, context), { met: false, value: false });
    assert.deepEqual(evaluateCondition(`true || query('x')`, context), { met: true, value: true });
    assert.equal(asked, 0);
    assert.equal(evaluateCondition(`false && (1 < 'a')`).met, false);
    assert.equal(evaluateCondition(`false && (1 < 'a')`).error, undefined);
});

test('reads: .name and [n] on what calls give; missing keys and reads through null are null', () => {
    const data = { list: [{ hp: { cur: 5 } }, 'two'], name: 'Ren', nothing: null, 'odd key': 1, length: 3 };
    const context = env({}, () => data);
    assert.equal(value(`query('q').list[0].hp.cur`, context), 5);
    assert.equal(value(`query('q').list[1]`, context), 'two');
    assert.equal(value(`query('q').list[9]`, context), null);
    assert.equal(value(`query('q').list.length`, context), 2);
    assert.equal(value(`query('q')['odd key']`, context), 1);
    assert.equal(value(`query('q').missing`, context), null);
    assert.equal(value(`query('q').nothing.deeper.still`, context), null);
    assert.equal(value(`query('q').length`, context), 3, 'an own key of a record');
    assert.match(error(`query('q').name.first == 1`, context).message, /Can't read "first" of a word/);
    assert.match(error(`query('q').list[-1] == 1`, context).message, /whole number from 0/);
    assert.match(error(`query('q').list[0.5] == 1`, context).message, /whole number from 0/);
    assert.match(error(`query('q').list.hp == 1`, context).message, /A list has no "hp"/);
    assert.match(error(`query('q')[true] == 1`, context).message, /needs a number or a word/);
});

test('the result must be exactly true or false', () => {
    assert.deepEqual(evaluateCondition('1').met, false);
    assert.match(evaluateCondition('1').error.message, /gives a number, not true or false/);
    assert.match(evaluateCondition('null').error.message, /gives nothing \(null\)/);
    assert.match(evaluateCondition(`'yes'`).error.message, /gives a word/);
    assert.equal(evaluateCondition(`'yes'`).value, 'yes');
    assert.deepEqual(evaluateCondition('true'), { met: true, value: true });
    assert.deepEqual(evaluateCondition('false'), { met: false, value: false });
});

test('syntax errors are values with plain messages', () => {
    const cases = [
        ['', /empty/],
        ['   ', /empty/],
        ['(true', /Expected "\)"/],
        ['true)', /Unexpected "\)"/],
        ['1 <', /Expected a value, found the end/],
        ['time(', /Expected a value|"," or "\)"/],
        [`query('a',)`, /Expected a value/],
        ['count()', /count\(\) takes 1 value, not 0/],
        ['time(1)', /time\(\) takes 0 values, not 1/],
        [`has('a', 1, 2)`, /has\(\) takes 1 to 2 values, not 3/],
        ['{a 1}', /":" after a key/],
        ['{a: 1, a: 2}', /written twice/],
        ['{1: 2}', /Expected a key/],
        [`query('x').`, /a name after "\."/],
        [`query('x')[1`, /Expected "\]"/],
        ['true false', /Unexpected/],
    ];
    for (const [source, pattern] of cases) {
        const result = evaluateCondition(source);
        assert.equal(result.met, false, source);
        assert.ok(result.error, `an error for ${JSON.stringify(source)}`);
        assert.match(result.error.message, pattern, source);
    }
});

test('limits: length, parts, depth, words, names, record keys, calls', () => {
    assert.equal(error('true || '.repeat(150) + 'true').code, 'LIMIT', 'too long');
    assert.match(error('true || '.repeat(150) + 'true').message, /longer than 1000 characters/);
    assert.equal(LIMITS.source, 1000);
    assert.match(error(Array(120).fill('1').join('==')).message, /more than 200 parts|do not chain/);
    assert.match(error(Array(110).fill('true').join('||')).message, /more than 200 parts/);
    assert.equal(error('('.repeat(30) + 'true' + ')'.repeat(30)).code, 'LIMIT');
    assert.match(error('('.repeat(30) + 'true' + ')'.repeat(30)).message, /nested more than 24 levels/);
    assert.equal(error('!'.repeat(40) + 'true').code, 'LIMIT');
    assert.equal(error('count('.repeat(30) + 'null' + ')'.repeat(30) + ' == 0').code, 'LIMIT', 'nested calls');
    assert.equal(error('{a: '.repeat(30) + '1' + '}'.repeat(30) + ' == null').code, 'LIMIT', 'nested records');
    assert.equal(error(`-`.repeat(40) + '1 < 0').code, 'LIMIT');
    assert.equal(evaluateCondition('('.repeat(10) + 'true' + ')'.repeat(10)).met, true, 'within the limit is fine');
    assert.match(error(`'${'x'.repeat(201)}' == 'x'`).message, /longer than 200 characters/);
    assert.match(error(`${'n'.repeat(65)}()`).message, /name is longer than 64/);
    assert.match(error(`query('x', {a:1,b:2,c:3,d:4,e:5,f:6,g:7,h:8,i:9})`).message, /more than 8 keys/);
    const many = Array(17).fill('time() == time()').join(' && ');   // 34 calls in 135 parts
    assert.match(error(many).message, /more than 32 calls/);
    assert.equal(evaluateCondition(Array(16).fill('time() == time()').join(' && ')).met, true, '32 calls are fine');
    // A long flat chain is not "deep": it is bounded by the part count instead.
    assert.equal(evaluateCondition(Array(60).fill('true').join(' && ')).met, true);
});

test('allow-list: only the six calls, only by their own name', () => {
    assert.deepEqual(CALLS, ['query', 'quest', 'has', 'time', 'actor', 'count']);
    for (const source of ['eval("1")', 'Function("return 1")()', 'require("fs")', 'fetch("x")', 'setTimeout()', 'alert(1)', 'constructor()']) {
        const result = evaluateCondition(source);
        assert.equal(result.met, false, source);
        assert.equal(result.error.code, 'NOT_ALLOWED', source);
        assert.match(result.error.message, /is not something a condition can call; it can call query, quest, has, time, actor, count/);
    }
    for (const source of [`quest('a')()`, `query('x').call()`, `query('x')['f']()`, `(time)()`, 'count(x)()']) {
        const result = evaluateCondition(source, env({}, () => ({ call: 1, f: 2 })));
        assert.equal(result.met, false, source);
        assert.ok(['NOT_ALLOWED'].includes(result.error.code), `${source}: ${result.error.message}`);
    }
});

test('injection attempts are refused or read as plain data', () => {
    const data = { constructor: 'own', list: [1] };
    const context = env({ inventory: {} }, () => data);
    const refused = [
        'globalThis', 'this', 'window', 'process.exit', 'state.meta', 'party.level >= 30',
        `query('x').constructor.constructor('return process')()`,
        `query('x').__proto__ == null`,
        `query('x').prototype == null`,
        `query('x')['__proto__'] == null`,
        `query('x')['constructor'] == null`,
        `query('x').list['constructor'] == null`,
        `query('x', { __proto__: 1 })`,
        `query('x', { 'constructor': 1 })`,
        'import("fs")',
        'new Function',
        '${1}',
        '/*x*/true',
        'true // x',
        `'a' + 'b'`,
        'time() = 5',
    ];
    for (const source of refused) {
        const result = evaluateCondition(source, context);
        assert.equal(result.met, false, source);
        assert.ok(result.error, `refused: ${source}`);
        assert.ok(['SYNTAX', 'NOT_ALLOWED'].includes(result.error.code), `${source}: ${result.error.code} ${result.error.message}`);
    }
    // A key the data really has under an innocent name is just data.
    assert.equal(evaluateCondition(`query('x').list[0] == 1`, context).met, true);
    // Strings are only ever data: nothing in them runs.
    assert.equal(evaluateCondition(`query('x').list[0] == 1 || 'process.exit()' == ''`, context).met, true);
    assert.equal(Object.prototype.polluted, undefined);
});

test('a query result that is not data is refused; a query that throws or waits is an error value', () => {
    assert.match(error(`query('x') == 1`, env({}, () => () => 1)).message, /is not data/);
    assert.match(error(`query('x').f == 1`, env({}, () => ({ f: () => 1 }))).message, /"f" is not data/);
    assert.match(error(`query('x') == 1`, env({}, () => Number.NaN)).message, /not a finite number/);
    assert.match(error(`query('x') == 1`, env({}, () => { throw new Error('no such query'); })).message, /query\("x"\) failed: no such query/);
    assert.match(error(`query('x') == 1`, env({}, () => Promise.resolve(1))).message, /answers later/);
    assert.match(error(`query('x') == 1`, env({})).message, /no queries are available/);
    assert.equal(evaluateCondition(`query('x') == null`, env({}, () => undefined)).met, true, 'undefined reads as null');
});

test('parse output is plain frozen data; compile caches by text; evaluation is deterministic', () => {
    const parsed = parse(`quest('Granary Rats').status == 'resolved' && has('Rope', 2)`);
    assert.equal(parsed.ok, true);
    assert.ok(Object.isFrozen(parsed.ast) && Object.isFrozen(parsed.ast.left));
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.ast)), parsed.ast);
    assert.equal(compile('time() == null'), compile('time() == null'));
    const context = env({ director: { time: { minutes: 600 } } });
    const runs = Array.from({ length: 5 }, () => JSON.stringify(evaluateCondition('time() >= 480 && time() < 720', context)));
    assert.equal(new Set(runs).size, 1);
    assert.equal(evaluate(null).ok, false);
    assert.equal(evaluate({ type: 'nope' }).error.code, 'SYNTAX');
});

test('the events sources use no eval, Function, Math.random or Date.now', () => {
    const dir = new URL('../../../src/v2/events/', import.meta.url);
    for (const name of readdirSync(dir)) {
        const text = readFileSync(new URL(name, dir), 'utf8');
        assert.doesNotMatch(text, /\beval\s*\(|new Function|Function\s*\(|Math\.random|Date\.now/, name);
    }
});

test('options for other users of the language (SPEC §13.2): extra calls and bare names, off by default', () => {
    const options = { calls: { ratio: [2, 2], 'fmt.money': [1, 1] }, names: true };
    const scope = { hp: { cur: 20, max: 80 }, q: { party: [{ name: 'Ren' }] }, coins: 1234 };
    const calls = { ratio: (a, b) => a / b, 'fmt.money': n => `${n} cp` };
    const run = (source, env = { scope, calls }) => {
        const parsed = parse(source, options);
        assert.ok(parsed.ok, `${source}: ${parsed.error?.message}`);
        return evaluate(parsed.ast, env);
    };
    assert.equal(run('ratio(hp.cur, hp.max) < 0.5').value, true);
    assert.equal(run(`fmt.money(coins) == '1234 cp'`).value, true);
    assert.equal(run(`q.party[0].name == 'Ren' && count(q.party) == 1`).value, true);
    assert.equal(run('missing == null').value, true, 'a name the scope lacks is null');
    assert.match(run('hp.cur > 1', { calls }).error.message, /nothing \(null\) and a number/, 'no scope: names are null');
    assert.match(run('ratio(1, 2) > 0', { scope }).error.message, /ratio\(\) is not available here/);
    assert.match(run('ratio(1, 2) > 0', { scope, calls: { ratio: () => { throw new Error('zero'); } } }).error.message, /ratio\(\) failed: zero/);
    assert.match(run('ratio(1, 2) > 0', { scope, calls: { ratio: () => () => 1 } }).error.message, /is not data/);
    assert.match(parse('ratio(1)', options).error.message, /ratio\(\) takes 2 values, not 1/);
    assert.match(parse('fmt.other(1)', options).error.message, /Only query, quest, has, time, actor, count, fmt.money, ratio can be called/);
    assert.equal(parse('constructor', options).error.code, 'NOT_ALLOWED');
    assert.equal(parse('__proto__.x', options).error.code, 'NOT_ALLOWED');
    // Off by default: events see neither.
    assert.equal(parse('ratio(1, 2) > 0').error.code, 'NOT_ALLOWED');
    assert.equal(parse('hp.cur > 1').error.code, 'NOT_ALLOWED');
    assert.equal(evaluateCondition('hp.cur > 1', { scope, calls }).error.code, 'NOT_ALLOWED');
    // Options are checked, and the cache keeps them apart.
    assert.match(parse('true', { calls: { 'a..b': [0, 0] } }).error.message, /can't be a call name/);
    assert.match(parse('true', { calls: { 'x.constructor': [0, 0] } }).error.message, /can't be a call name/);
    assert.match(parse('true', { calls: { has: [0, 0] } }).error.message, /already a call/);
    assert.match(parse('true', { calls: { f: 2 } }).error.message, /arity/);
    assert.match(parse('true', { calls: ['f'] }).error.message, /\{ name: \[fewest, most\] \}/);
    assert.equal(compile('hp.cur > 1', { names: true }).ok, true);
    assert.equal(compile('hp.cur > 1').ok, false);
});
