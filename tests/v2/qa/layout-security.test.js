// QA: layouts (src/v2/layout, SPEC §9, LAYOUTS.md) with hostile layouts and hostile data. A layout
// is pack data and a query answer is story data (and so, at one remove, the model's): neither may
// become markup, an event handler, a style or a URL that runs or loads anything but an image.
// The fake DOM (tests/ui-fake-dom.js) throws on innerHTML / outerHTML / insertAdjacentHTML and
// records every attribute set, so a renderer that parsed markup or set a handler fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from '../../ui-fake-dom.js';
import { renderLayout, validateLayout } from '../../../src/v2/layout/index.js';
import { evaluateCondition } from '../../../src/v2/events/condition.js';
import { badge } from '../../../src/v2/view/widgets/badge.js';
import { meter } from '../../../src/v2/view/widgets/meter.js';

const forbid = name => function () { throw new Error(`markup was parsed: ${name}`); };
Object.defineProperty(FakeElement.prototype, 'innerHTML', { configurable: true, get: forbid('innerHTML get'), set: forbid('innerHTML set') });
Object.defineProperty(FakeElement.prototype, 'outerHTML', { configurable: true, get: forbid('outerHTML get'), set: forbid('outerHTML set') });
FakeElement.prototype.insertAdjacentHTML = forbid('insertAdjacentHTML');
const attributes = [];
const setAttribute = FakeElement.prototype.setAttribute;
FakeElement.prototype.setAttribute = function (name, value) {
    attributes.push([this.tagName, String(name), String(value)]);
    return setAttribute.call(this, name, value);
};

const HOSTILE = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '"><svg onload=alert(1)>',
    'javascript:alert(1)',
    '{{constructor.constructor("alert(1)")()}}',
    '${alert(1)}',
    '</div><iframe src=//evil.example>',
];
const BAD_URLS = [
    'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'vbscript:x', 'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', 'data:image/png;base64,AAAA" onerror="alert(1)', 'http://evil.example/a.png',
    '//evil.example/a.png', 'https://user:pw@evil.example/a.png', 'file:///etc/passwd', 'blob:https://evil.example/x', '/relative.png',
    'data:image/png,notbase64', 'DATA:IMAGE/PNG;BASE64,AAAA',
];

function draw(layout, answers = {}, options = {}) {
    const doc = installFakeDom();
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const from = attributes.length;
    const query = (name, args) => {
        if (!Object.hasOwn(answers, name)) throw new Error(`no query ${name}`);
        return typeof answers[name] === 'function' ? answers[name](args) : answers[name];
    };
    const result = renderLayout(host, layout, { query, command: options.command ?? (() => ({ ok: true })), evaluate: (cond, env) => evaluateCondition(cond, env).met, widgets: options.widgets });
    return { host, result, attrs: attributes.slice(from) };
}

const layout = root => ({ id: 'qa', title: 'QA', icon: 'fa-box', root });
const all = node => [node, ...node.descendants()];

function assertInert(host, attrs, label) {
    for (const [tag, name, value] of attrs) {
        assert.doesNotMatch(name, /^on/i, `${label}: no event attribute (${tag} ${name})`);
        assert.notEqual(name.toLowerCase(), 'style', `${label}: no style attribute`);
        assert.notEqual(name.toLowerCase(), 'href', `${label}: no links`);
        if (name.toLowerCase() === 'src') assert.match(value, /^(?:https:\/\/(?![^/]*@)|data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$)/, `${label}: image src ${value}`);
    }
    for (const node of all(host)) {
        assert.ok(['DIV', 'SPAN', 'UL', 'LI', 'BUTTON', 'I', 'IMG', 'P'].includes(node.tagName), `${label}: only plain elements (${node.tagName})`);
        for (const name of node.classes()) assert.match(name, /^(?:ss-[lw]-[a-z0-9-]+|fa-[a-z0-9-]+|fa-solid)$/, `${label}: class "${name}" comes from the renderer's own list`);
        for (const [key, value] of Object.entries(node.styleProps)) {
            assert.match(key, /^(?:--ss-[lw]-[a-z0-9-]+)$/, `${label}: style property ${key}`);
            assert.doesNotMatch(String(value), /url\(|expression|javascript|;|\{|\}/i, `${label}: style value ${value}`);
        }
    }
}

test('hostile text from a query is shown as text: text, badge, meter label, list rows, tab titles, button labels, alt', () => {
    for (const evil of HOSTILE) {
        const answers = {
            'qa.one': { name: evil, tone: `good ${evil}`, n: 3, max: 10, img: 'https://example.com/a.png' },
            'qa.list': [{ name: evil }, { name: evil, __proto__: { polluted: 1 } }],
            'qa.record': JSON.parse(`{"a":{"name":${JSON.stringify(evil)}},"__proto__":{"name":"proto"}}`),
        };
        const root = {
            type: 'box', title: { query: 'qa.one', path: 'name' }, children: [
                { type: 'text', bind: { query: 'qa.one', path: 'name' }, label: { query: 'qa.one', path: 'name' } },
                { type: 'badge', bind: { query: 'qa.one', path: 'name' }, tone: { query: 'qa.one', path: 'tone' } },
                { type: 'meter', value: { query: 'qa.one', path: 'n' }, max: { query: 'qa.one', path: 'max' }, label: { query: 'qa.one', path: 'name' }, tone: { query: 'qa.one', path: 'tone' } },
                { type: 'image', bind: { query: 'qa.one', path: 'img' }, alt: { query: 'qa.one', path: 'name' } },
                { type: 'list', bind: { query: 'qa.list' }, item: { type: 'row', children: [{ type: 'text', bind: '$item.name' }, { type: 'button', label: '$item.name', command: 'qa.do', payload: { name: '$item.name' } }] } },
                { type: 'list', bind: { query: 'qa.record' }, item: { type: 'text', bind: '$item.name' } },
                { type: 'tabs', pages: [{ title: { query: 'qa.one', path: 'name' }, node: { type: 'text', value: 'x' } }] },
            ],
        };
        assert.deepEqual(validateLayout(layout(root)), [], 'the layout itself is fine');
        const { host, result, attrs } = draw(layout(root), answers);
        assert.equal(result.ok, true);
        assert.ok(host.textContent.includes(evil), 'the text is there, as text');
        assertInert(host, attrs, `data ${JSON.stringify(evil)}`);
    }
    assert.equal(({}).polluted, undefined);
});

test('an image bound to a query never takes an unsafe URL', () => {
    for (const url of BAD_URLS) {
        const { host, result, attrs } = draw(layout({ type: 'image', bind: { query: 'qa.img' } }), { 'qa.img': url });
        assert.equal(result.ok, true);
        assert.equal(host.querySelectorAll('img').length, 0, `no image for ${JSON.stringify(url)}`);
        assert.ok(result.problems.length >= 1, `a problem says why (${url})`);
        assertInert(host, attrs, `url ${url}`);
    }
    const ok = draw(layout({ type: 'image', bind: { query: 'qa.img' } }), { 'qa.img': 'https://example.com/a.png' });
    assert.equal(ok.host.querySelectorAll('img').length, 1);
});

test('a hostile layout is refused before anything is drawn', () => {
    const bad = [
        ['an html field', { type: 'text', value: 'x', html: '<b>x</b>' }],
        ['a style field', { type: 'box', style: 'position:fixed', children: [] }],
        ['an onclick field', { type: 'button', label: 'x', command: 'qa.do', onclick: 'alert(1)' }],
        ['a script node', { type: 'script', value: 'alert(1)' }],
        ['an iframe node', { type: 'iframe', src: 'https://evil.example' }],
        ['an image with a javascript: src', { type: 'image', src: 'javascript:alert(1)' }],
        ['an image with an svg data: src', { type: 'image', src: 'data:image/svg+xml;base64,PHN2Zz4=' }],
        ['an image with an http src', { type: 'image', src: 'http://evil.example/a.png' }],
        ['an icon that is not a Font Awesome name', { type: 'button', label: 'x', command: 'qa.do', icon: 'fa-x" onclick="alert(1)' }],
        ['a variant outside the list', { type: 'text', value: 'x', variant: 'title onclick' }],
        ['a size outside the list', { type: 'image', src: 'https://example.com/a.png', size: 'huge" x="' }],
        ['a command that is not a name', { type: 'button', label: 'x', command: 'javascript:alert(1)' }],
        ['a binding path through __proto__', { type: 'text', bind: { query: 'qa.one', path: '__proto__.polluted' } }],
        ['a binding path through constructor', { type: 'text', bind: { query: 'qa.one', path: 'constructor.name' } }],
        ['an $item path through prototype', { type: 'list', bind: { query: 'qa.list' }, item: { type: 'text', bind: '$item.prototype' } }],
        ['a query name with spaces', { type: 'text', bind: { query: 'qa one; alert(1)' } }],
        ['nodes nested too deep', JSON.parse(`${'{"type":"box","children":['.repeat(40)}{"type":"text","value":"x"}${']}'.repeat(40)}`)],
    ];
    for (const [what, root] of bad) {
        const errors = validateLayout(layout(root));
        assert.ok(errors.length >= 1, `${what} is refused`);
        const { host, result } = draw(layout(root));
        assert.equal(result.ok, false, `${what}: not drawn`);
        assert.ok(host.querySelector('.ss-l-invalid'), `${what}: the reasons are shown instead`);
        assert.ok(!host.textContent.includes('alert(1)') || host.querySelectorAll('script, iframe').length === 0);
    }
    const tokens = [['url', 'url(https://evil.example/a.png)'], ['expression', 'expression(alert(1))'], ['var', 'var(--x)'], ['semicolon', 'red; position: fixed'],
        ['brace', 'red}'], ['backslash', '\\75rl(x)'], ['colon', 'a:b'], ['slash', 'a/b'], ['unknown function', 'attr(x)'], ['image-set', 'image-set("x" 1x)']];
    for (const [what, value] of tokens) {
        assert.ok(validateLayout({ ...layout({ type: 'text', value: 'x' }), theme: { tokens: { accent: value } } }).length >= 1, `theme token with ${what} is refused`);
    }
    assert.ok(validateLayout({ ...layout({ type: 'text', value: 'x' }), theme: { tokens: { 'accent; color': 'red' } } }).length >= 1, 'a token name that is not a name is refused');
    assert.ok(validateLayout({ ...layout({ type: 'text', value: 'x' }), theme: { tokens: { position: 'fixed' } } }).length >= 1, 'a token outside the list is refused');
});

test('a button sends only its own command with a plain copy of what the row showed', async () => {
    const calls = [];
    const command = (type, payload) => { calls.push([type, payload]); return { ok: false, message: '<img src=x onerror=alert(1)>' }; };
    const { host, attrs } = draw(layout({ type: 'list', bind: { query: 'qa.list' }, item: { type: 'button', label: 'Use', command: 'qa.use', payload: { stack: '$item.id', all: '$item' } } }),
        { 'qa.list': [{ id: 'it_aaaaaaaa', fn: 'x', nested: { deep: [1, 2] } }] }, { command });
    host.querySelector('button').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['qa.use', { stack: 'it_aaaaaaaa', all: { id: 'it_aaaaaaaa', fn: 'x', nested: { deep: [1, 2] } } }]]);
    assert.equal(host.querySelector('.ss-l-status').textContent, '<img src=x onerror=alert(1)>', 'a refusal message is text');
    assertInert(host, attrs, 'button');
});

test('a "when" condition can only read through the condition language', () => {
    globalThis.__qaHit = false;
    for (const cond of ['constructor.constructor("globalThis.__qaHit = true")()', 'query("qa.one").constructor', 'this', 'globalThis.__qaHit == false',
        'process.exit()', 'require("fs")', 'eval("1")', 'Function("return 1")()', 'query("qa.one")["__proto__"]', '__proto__']) {
        const { host } = draw(layout({ type: 'when', cond, children: [{ type: 'text', value: 'SHOWN' }] }), { 'qa.one': { n: 1 } });
        assert.ok(!host.textContent.includes('SHOWN'), `${cond} is not met`);
    }
    assert.equal(globalThis.__qaHit, false);
    delete globalThis.__qaHit;
});

test('standard widgets inside a layout get hostile props and stay inert', () => {
    const widgets = { 'ss.badge': badge, 'ss.meter': meter };
    for (const evil of HOSTILE) {
        const root = { type: 'row', children: [
            { type: 'ss.badge', props: { label: evil, value: evil, icon: evil, tone: evil } },
            { type: 'ss.badge', props: { label: 'x', icon: 'javascript:alert(1)' } },
            { type: 'ss.badge', props: { label: 'x', icon: 'data:image/svg+xml;base64,PHN2Zz4=' } },
            { type: 'ss.meter', props: { label: evil, value: 3, max: 9, tone: evil, icon: evil, text: evil } },
        ] };
        const errors = validateLayout(layout(root), { widgets });
        if (errors.length) continue;   // a widget may refuse such props itself: also fine
        const { host, result, attrs } = draw(layout(root), {}, { widgets });
        assert.equal(result.ok, true);
        assertInert(host, attrs, `widget props ${JSON.stringify(evil)}`);
    }
});
