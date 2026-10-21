// QA: Story Block's standard widgets (src/v2/view/widgets, SPEC §13.5) with hostile props. Props come
// from a layout (pack data) and from queries (story data): every widget must draw them as text, take
// images only from https or raster data: URLs, pick classes only from its own lists and set no
// event attribute or style text. The widgets' fake DOM throws on innerHTML; this file also traps
// outerHTML / insertAdjacentHTML and records every attribute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Element, fakeApi, host, installDom } from '../view/widgets/fake-dom.js';
import { standardWidgets } from '../../../src/v2/view/widgets/index.js';

const forbid = name => function () { throw new Error(`markup was parsed: ${name}`); };
Object.defineProperty(Element.prototype, 'outerHTML', { configurable: true, get: forbid('outerHTML'), set: forbid('outerHTML') });
Element.prototype.insertAdjacentHTML = forbid('insertAdjacentHTML');
const attributes = [];
const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
    attributes.push([this.tagName, String(name), String(value)]);
    return setAttribute.call(this, name, value);
};

const EVIL = '<img src=x onerror=alert(1)>"\'><svg onload=alert(1)>';
const BAD_URL = ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', 'http://evil.example/a.png', '//evil.example/a.png',
    'https://u:p@evil.example/a.png', 'data:text/html,<script>alert(1)</script>', '/\\evil.example/a.png', 'blob:https://evil.example/1'];

function hostileProps(name, url) {
    const node = id => ({ id, name: EVIL, x: 1, y: 2, icon: url, layer: EVIL, kind: EVIL, title: EVIL, text: EVIL, time: EVIL, level: 1, max: 3, label: EVIL, value: 2 });
    switch (name) {
        case 'ss.portrait': return { src: url, name: EVIL, frame: EVIL, size: EVIL, tone: EVIL, caption: EVIL };
        case 'ss.badge': return { icon: url, label: EVIL, counter: 3, unit: EVIL, tone: EVIL, showLabel: true, id: EVIL, kind: EVIL, onSelect: 'qa.do' };
        case 'ss.map': return { nodes: [node('a'), node(EVIL)], edges: [{ from: 'a', to: EVIL, kind: EVIL }], layers: [EVIL], layer: EVIL, current: 'a', discovered: ['a', EVIL], kinds: { [EVIL]: { label: EVIL, icon: url } }, onSelect: 'qa.do', label: EVIL };
        case 'ss.timeline': return { events: [node('e1'), node(EVIL)], current: 'e1', label: EVIL };
        case 'ss.skill-tree': return { tiers: [{ title: EVIL, skills: [{ ...node('s1'), active: true, locked: false, requires: [EVIL] }, node(EVIL)] }], onSelect: 'qa.do', label: EVIL };
        case 'ss.stepper': return { name: EVIL, value: 1, max: 5, budget: 3, label: EVIL, budgetLabel: EVIL, tone: EVIL };
        case 'ss.radar': return { axes: [{ label: EVIL, value: 3, max: 5 }, { label: EVIL, value: 1 }, { label: 'c', value: 2 }], label: EVIL, tone: EVIL };
        case 'ss.meter': return { value: 3, max: 9, label: EVIL, tone: EVIL, icon: url, text: EVIL };
        default: throw new Error(name);
    }
}

function assertInert(root, attrs, label) {
    for (const [tag, name, value] of attrs) {
        assert.doesNotMatch(name, /^on/i, `${label}: no event attribute (${tag} ${name}="${value}")`);
        assert.notEqual(name.toLowerCase(), 'style', `${label}: no style attribute`);
        assert.ok(!['href', 'xlink:href', 'srcdoc', 'formaction', 'action'].includes(name.toLowerCase()), `${label}: no ${name}`);
        if (name.toLowerCase() === 'src') {
            assert.match(value, /^(?:https:\/\/[^/@\s]+\/|data:image\/(?:png|jpe?g|gif|webp|avif);base64,|\/(?![/\\]))/i, `${label}: image src ${value}`);
            assert.doesNotMatch(value, /^(?:javascript|data:image\/svg|http:)/i);
        }
        if (name === 'class') for (const token of value.split(/\s+/).filter(Boolean)) assert.match(token, /^(?:ss-w(?:-[a-z0-9-]+)?|fa-[a-z0-9-]+|fa[srlbdt])$/, `${label}: class "${token}"`);
    }
    const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
    for (const node of walk(root)) {
        assert.ok(!['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FOREIGNOBJECT', 'A', 'STYLE', 'LINK'].includes(String(node.tagName).toUpperCase()), `${label}: no <${node.tagName}>`);
        const classes = typeof node.className === 'string' ? node.className : '';
        for (const token of classes.split(/\s+/).filter(Boolean)) assert.match(token, /^(?:ss-w(?:-[a-z0-9-]+)?|fa-[a-z0-9-]+|fa[srlbdt])$/, `${label}: class "${token}"`);
        for (const [key, value] of Object.entries(node.styleProps ?? {})) {
            assert.match(key, /^--ss-w-[a-z0-9-]+$|^(?:left|top|width|height|transform|display)$/, `${label}: style property ${key}`);
            assert.doesNotMatch(String(value), /url\(|expression|javascript|;|[{}<>]/i, `${label}: style value ${value}`);
        }
    }
}

for (const [name, widget] of Object.entries(standardWidgets)) {
    test(`${name}: hostile props are drawn as text, with no unsafe URL, class, style or handler`, () => {
        for (const url of BAD_URL) {
            const doc = installDom();
            const el = host(doc);
            const from = attributes.length;
            const api = fakeApi();
            const handle = widget.render(el, hostileProps(name, url), api);
            assertInert(el, attributes.slice(from), `${name} with ${url}`);
            // Updating with the same hostile data must stay inert too.
            handle?.update?.(hostileProps(name, url));
            assertInert(el, attributes.slice(from), `${name} updated`);
            handle?.destroy?.();
        }
    });
}

test('a portrait shows only a safe picture, and falls back to initials for anything else', () => {
    for (const url of BAD_URL) {
        const doc = installDom();
        const el = host(doc);
        standardWidgets['ss.portrait'].render(el, { src: url, name: 'Ren Avel' }, fakeApi());
        const img = el.querySelector('img');
        assert.ok(!img || !img.getAttribute('src'), `no picture from ${url}`);
    }
});
