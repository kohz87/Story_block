// B-b5b-robust-1..4: a template <form> whose controls are named after HTMLFormElement properties.
//
// In a browser, HTMLFormElement is [LegacyOverrideBuiltIns]: `form.classList`, `form.setAttribute`,
// `form.addEventListener`, `form.insertBefore`, `form.disabled`, ... return the form's control with that
// `name` (or `id`) instead of the built-in. render.js (ElementBlock) calls those members on the form element,
// so a template (a pack's screen, or a name bound from state) breaks the form. The v1 fake DOM does not model
// named-property shadowing, so `namedForms()` below wraps each <form> in a Proxy that does what the browser
// does (verified against Chromium with Playwright: break/b5b-robust/repro/pw-forms.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { compileTemplate, renderTemplate } from '../../../src/v2/view/template/index.js';
import { conditionEvaluator } from '../../../src/v2/view/bind.js';
import { compile, evaluate } from '../../../src/v2/events/condition.js';

const EVALUATE = conditionEvaluator({ compile, evaluate });
const LISTED = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'FIELDSET', 'OUTPUT', 'OBJECT']);

/** A fake DOM whose forms shadow their own members with named controls, like HTMLFormElement. */
function namedForms() {
    const doc = installFakeDom();
    const create = doc.createElement;
    doc.createElement = tag => {
        const el = create(tag);
        if (String(tag).toLowerCase() !== 'form') return el;
        return new Proxy(el, {
            get(target, prop, receiver) {
                if (typeof prop === 'string') {
                    const hit = target.descendants().find(node => LISTED.has(node.tagName)
                        && (node.getAttribute('name') === prop || node.getAttribute('id') === prop));
                    if (hit) return hit;
                }
                return Reflect.get(target, prop, receiver);
            },
        });
    };
    return doc;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

async function submitWith(template, scope = { draft: { pick: 'a' } }) {
    const doc = namedForms();
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const calls = [];
    const rejections = [];
    const onRejection = reason => rejections.push(String(reason?.message ?? reason));
    process.on('unhandledRejection', onRejection);
    let renderError = null;
    try {
        try {
            renderTemplate(host, compileTemplate(template), scope, {
                evaluate: EVALUATE,
                command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; },
            });
        } catch (error) {
            renderError = error.message;
        }
        const form = host.querySelector('form');
        if (!renderError) {
            form?.dispatch('submit');
            await tick();
            form?.dispatch('submit');
            await tick();
        }
        return { renderError, calls, rejections, form };
    } finally {
        process.off('unhandledRejection', onRejection);
    }
}

const FORM = name => `<form data-submit="party.create"><input name="${name}" data-draft="pick"><button>Go</button></form>`;

test('B-b5b-robust-1: <input name="classList"> leaves the form stuck busy; its command never runs', async () => {
    const { renderError, calls, rejections, form } = await submitWith(FORM('classList'));
    assert.equal(renderError, null);
    assert.deepEqual(rejections, [], 'a submit must not end in an unhandled rejection');
    assert.equal(calls.length, 2, 'both submits run party.create (the first one never did, and busy() stays set for good)');
    assert.equal(form.getAttribute('aria-busy'), null);
});

test('B-b5b-robust-1: <input name="setAttribute"> leaves class ss-busy on the form for good', async () => {
    const { calls, rejections, form } = await submitWith(FORM('setAttribute'));
    assert.deepEqual(rejections, []);
    assert.equal(calls.length, 2);
    assert.ok(!String(form.className).includes('ss-busy'), 'the form is not left looking busy');
});

test('B-b5b-robust-1: <input name="removeAttribute"> leaves aria-busy="true" after the command finished', async () => {
    const { calls, rejections, form } = await submitWith(FORM('removeAttribute'));
    assert.deepEqual(rejections, []);
    assert.equal(calls.length, 2);
    assert.equal(form.getAttribute('aria-busy'), null);
});

test('B-b5b-robust-2: <input name="disabled"> makes every submit a silent no-op (form.disabled is the input)', async () => {
    const { calls } = await submitWith(FORM('disabled'));
    assert.equal(calls.length, 2, 'a form has no disabled property; the named input must not stop the submit');
});

for (const [name, template] of [
    ['addEventListener', FORM('addEventListener')],
    ['appendChild', `<form data-submit="party.create"><input name="appendChild" data-draft="pick"><button>Go</button></form>`],
    ['insertBefore', `<form data-submit="party.create"><input name="insertBefore" data-draft="pick"><span data-each="q.list as x">{{ x }}</span><button>Go</button></form>`],
    ['classList (data-class on the form)', `<form data-submit="party.create" data-class="hot: draft.pick == 'a'"><input name="classList" data-draft="pick"></form>`],
    ['style (data-bind-var on the form)', `<form data-submit="party.create" data-bind-var="--w: draft.pick"><input name="style" data-draft="pick"></form>`],
]) {
    test(`B-b5b-robust-3: a control named ${name} must not stop the screen from drawing`, async () => {
        const { renderError, calls } = await submitWith(template, { draft: { pick: 'a' }, q: { list: [1, 2] } });
        assert.equal(renderError, null, 'the form draws (or the name is refused with a warning at compile time)');
        assert.equal(calls.length, 2);
    });
}

test('B-b5b-robust-4: a control name bound from state (model or pack text) breaks the form the same way', async () => {
    const template = `<form data-submit="shop.buy"><input data-bind-attr="name: q.field" data-draft="pick"><button>Buy</button></form>`;
    const { renderError, calls, rejections } = await submitWith(template, { draft: { pick: 'a' }, q: { field: 'classList' } });
    assert.equal(renderError, null);
    assert.deepEqual(rejections, []);
    assert.equal(calls.length, 2, 'a bound name is checked like a static one');
});
