// sum(list, field?): a pure helper of the template expressions, for points-buy totals. Lists and
// records, a field or a dotted path, non-numbers as 0, no prototype keys; read without the condition
// language and with it; and the "points left" example in docs/v2/TEMPLATES.md with Story Block's own
// ss.stepper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RESERVED, TEMPLATE_CALLS, compileExpr, conditionEvaluator, evalExpr, isLoopName, makeScope, sum } from '../../../../src/v2/view/bind.js';
import { compile, evaluate } from '../../../../src/v2/events/index.js';
import { compileTemplate, renderTemplate } from '../../../../src/v2/view/template/index.js';
import { standardWidgets } from '../../../../src/v2/view/widgets/index.js';
import { fakeEvaluate, installFakeDom } from './helpers.js';

const language = conditionEvaluator({ compile, evaluate });

test('sum: a list\'s numbers or a record\'s values, added up', () => {
    assert.equal(sum([1, 2, 3]), 6);
    assert.equal(sum({ STR: 3, VIT: 2, AGI: 0 }), 5);
    assert.equal(sum([]), 0);
    assert.equal(sum({}), 0);
    assert.equal(sum([-2, 5]), 3);
    assert.equal(sum([0.1, 0.2]), 0.3, 'no float noise');
    assert.equal(sum([2 ** 40, 2 ** 40]), 2 ** 41, 'big whole numbers stay exact');
});

test('sum: anything that is not a finite number counts as 0', () => {
    assert.equal(sum([1, '2', null, undefined, true, NaN, Infinity, -Infinity, [3], { n: 4 }, 5]), 6);
    for (const nothing of [null, undefined, 7, 'abc', true, () => 3]) assert.equal(sum(nothing), 0, String(nothing));
});

test('sum(list, field): each item\'s field, or a dotted path; missing fields count as 0', () => {
    const stats = { STR: { base: 3, bonus: 1 }, VIT: { base: 2 }, AGI: { bonus: 2 } };
    assert.equal(sum(stats, 'base'), 5);
    assert.equal(sum(stats, 'bonus'), 3);
    const actors = [{ hp: { cur: 10 } }, { hp: { cur: 7 } }, { hp: null }, 'Ren', 4];
    assert.equal(sum(actors, 'hp.cur'), 17);
    assert.equal(sum([{ a: { b: { c: 2 } } }, { a: { b: { c: 3 } } }], 'a.b.c'), 5);
    assert.equal(sum([[1, 2], [3, 4]], '1'), 6, 'a list item\'s index');
    for (const field of ['', 7, true, {}, ['base']]) assert.equal(sum(stats, field), 0, `field ${JSON.stringify(field)}`);
    assert.equal(sum(stats, null), 0, 'a null field reads the items themselves, which are records');
    assert.equal(sum([1, 2], null), 3);
});

test('sum never reaches prototype keys and changes nothing', () => {
    const items = [{ base: 1 }, { base: 2 }];
    for (const field of ['__proto__', 'constructor', 'prototype', 'constructor.length', '__proto__.base', 'base.constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
        assert.equal(sum(items, field), 0, field);
    }
    assert.equal(sum(Object.create({ inherited: 5 })), 0, 'inherited values are not the record\'s');
    assert.equal(sum([Object.create({ base: 5 })], 'base'), 0, 'inherited fields are not the item\'s');
    assert.equal(sum([{ base: 1, length: 9 }], 'length'), 9, 'an own field of any name is read');
    const frozen = Object.freeze([Object.freeze({ base: 1 }), Object.freeze({ base: 2 })]);
    assert.equal(sum(frozen, 'base'), 3);
    const list = [1, 2];
    sum(list);
    assert.deepEqual(list, [1, 2]);
});

test('sum is a scope helper, a reserved name and an extra call of the condition language', () => {
    const scope = makeScope({ draft: { points: { STR: 2, VIT: 3 } } });
    assert.equal(scope.sum, sum);
    assert.ok(RESERVED.has('sum'));
    assert.equal(isLoopName('sum'), false, 'a loop may not hide it');
    assert.deepEqual(TEMPLATE_CALLS.sum, [1, 2]);
});

test('sum() is read without the condition language, and through it', () => {
    const scope = makeScope({
        state: { v: 2, meta: { rev: 1 }, domains: { party: { actors: { a: { hp: { cur: 5 } }, b: { hp: { cur: 6 } } } } } },
        q: { rules: { points: 4 }, rows: [{ base: 3 }, { base: 4 }] },
        draft: { points: { STR: 2, VIT: 3 } },
    });
    for (const text of ['sum(draft.points)', "sum(q.rows, 'base')", "sum(state.party.actors, 'hp.cur')", 'sum(q.missing)']) {
        assert.ok(compileExpr(text).fast, `${text} is a short form`);
    }
    assert.equal(evalExpr('sum(draft.points)', scope), 5);
    assert.equal(evalExpr("sum(q.rows, 'base')", scope), 7);
    assert.equal(evalExpr("sum(state.party.actors, 'hp.cur')", scope), 11);
    assert.equal(evalExpr('sum(q.missing)', scope), 0);
    assert.equal(evalExpr("sum(q.rows, '__proto__')", scope), 0);
    // Comparisons need the language.
    for (const evaluator of [language, fakeEvaluate]) {
        assert.equal(evalExpr('sum(draft.points) > q.rules.points', scope, evaluator), true);
        assert.equal(evalExpr("sum(q.rows, 'base') == 7", scope, evaluator), true);
        assert.equal(evalExpr("sum(q.rows, 'constructor') == 0", scope, evaluator), true);
    }
    const warnings = [];
    assert.equal(evalExpr("sum(q.rows, 'base', 1) > 0", scope, language, text => warnings.push(text)), undefined);
    assert.equal(warnings.length, 1, 'three arguments are refused');
    assert.equal(evalExpr('sum() > 0', scope, language, text => warnings.push(text)), undefined);
    assert.equal(warnings.length, 2, 'no argument is refused');
});

// The "points left" snippet under Example 3 of the templates page.
const doc = readFileSync(new URL('../../../../docs/v2/TEMPLATES.md', import.meta.url), 'utf8');
const snippet = /\*\*Points left\.\*\*[\s\S]*?```html\n([\s\S]*?)```/.exec(doc)?.[1];

function showPointsLeft(scope) {
    const compiled = compileTemplate(snippet);
    assert.deepEqual(compiled.warnings, []);
    const page = installFakeDom();
    const el = page.createElement('div');
    page.body.appendChild(el);
    const view = renderTemplate(el, compiled, scope, { evaluate: language, widgets: standardWidgets });
    assert.deepEqual(view.warnings, []);
    return el;
}

test('the docs\' "points left" example: the steppers share the pool through sum(draft.points)', () => {
    assert.ok(snippet, 'the snippet is on the page');
    const rules = { points: 4, max: 8, stats: ['STR', 'VIT'] };
    const draft = { points: { STR: 0, VIT: 0 } };
    const el = showPointsLeft({ q: { rules }, draft });
    const legend = () => el.querySelector('legend');
    const notes = () => el.querySelectorAll('.ss-w-stepper-budget').map(note => note.textContent);
    assert.equal(legend().querySelector('small').textContent, '0 of 4 points spent');
    assert.deepEqual(notes(), ['Points left: 4', 'Points left: 4']);
    const [str, vit] = el.querySelectorAll('ss-widget');
    str.querySelector('.ss-w-stepper-inc').click();
    str.querySelector('.ss-w-stepper-inc').click();
    str.querySelector('.ss-w-stepper-inc').click();
    assert.deepEqual(draft.points, { STR: 3, VIT: 0 });
    assert.equal(legend().querySelector('small').textContent, '3 of 4 points spent');
    assert.deepEqual(notes(), ['Points left: 1', 'Points left: 1'], 'every stepper sees the shared pool');
    vit.querySelector('.ss-w-stepper-inc').click();
    assert.deepEqual(draft.points, { STR: 3, VIT: 1 });
    assert.deepEqual(notes(), ['Points left: 0', 'Points left: 0']);
    assert.ok(str.querySelector('.ss-w-stepper-inc').disabled && vit.querySelector('.ss-w-stepper-inc').disabled, 'the pool is spent');
    assert.ok(!legend().className.includes('over'));
    // A draft that came in overspent (a ready-made character from older rules) is flagged.
    const over = showPointsLeft({ q: { rules }, draft: { points: { STR: 5, VIT: 1 } } });
    assert.equal(over.querySelector('legend').className, 'over');
});
