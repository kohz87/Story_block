// Security: nothing in a template or in bound data can run code, load from outside or escape as markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PURIFY_CONFIG, compileTemplate, renderTemplate, strictSanitize } from '../../../../src/v2/view/template/index.js';
import { parseHtml, serializeHtml } from '../../../../src/v2/view/template/html.js';
import { fakeEvaluate, inner, installFakeDom } from './helpers.js';

const clean = html => strictSanitize(html);

function render(html, scope = {}, options = {}) {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const compiled = compileTemplate(html);
    const view = renderTemplate(el, compiled, scope, { evaluate: fakeEvaluate, ...options });
    return { el, view, compiled, doc };
}

test('script, iframe, object, embed, link, meta, base, style and template are removed with their content', () => {
    const html = '<div>a<script>alert(1)</script><iframe src="https://x.example"></iframe><object data="x"></object><embed src="x"><link rel="stylesheet" href="https://x"><meta http-equiv="refresh" content="0;url=https://x"><base href="https://x/"><style>body{display:none}</style><template><img src=x onerror=alert(1)></template><noscript><p>n</p></noscript>b</div>';
    assert.equal(clean(html), '<div>ab</div>');
    assert.equal(clean('<SCRIPT SRC=//x.example/x.js></SCRIPT>ok'), 'ok');
    assert.equal(clean('<scr<script>ipt>alert(1)</script>'), 'ipt&gt;alert(1)', 'what is left is text');
    assert.equal(clean('<script>never closed'), '');
});

test('on* attributes, javascript:/vbscript: URLs and <img src=x onerror> are neutralised', () => {
    assert.equal(clean('<img src=x onerror="alert(1)">'), '<img>');
    assert.equal(clean('<img src="javascript:alert(1)">'), '<img>');
    assert.equal(clean('<div onclick="x()" onMouseOver=y ONLOAD=z class="ok">t</div>'), '<div class="ok">t</div>');
    assert.equal(clean('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
    assert.equal(clean('<a href=" jav&#x09;ascript:alert(1)">x</a>'), '<a>x</a>', 'entity-hidden tab');
    assert.equal(clean('<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>'), '<a>x</a>', 'numeric entities');
    assert.equal(clean('<a href="JaVaScRiPt:alert(1)">x</a>'), '<a>x</a>');
    assert.equal(clean('<a href="vbscript:msgbox(1)">x</a>'), '<a>x</a>');
    assert.equal(clean('<a href="data:text/html,<script>alert(1)</script>">x</a>'), '<a>x</a>', 'no data: links');
    assert.equal(clean('<a href="/relative">x</a>'), '<a>x</a>', 'no relative links out of the page');
    assert.equal(clean('<a href="https://wiki.example/a" target="_blank">x</a>'), '<a href="https://wiki.example/a" target="_blank" rel="noopener noreferrer">x</a>');
    assert.equal(clean('<a href="#top" target="_top">x</a>'), '<a href="#top">x</a>');
    assert.equal(clean('<img src="http://plain.example/a.png">'), '<img>', 'images only https: or data:');
    assert.equal(clean('<img src="data:image/png;base64,AAAA" alt="p">'), '<img src="data:image/png;base64,AAAA" alt="p">');
    assert.equal(clean('<img src="data:text/html;base64,AAAA">'), '<img>');
    assert.equal(clean('<img srcset="https://x 1x" src="https://x.example/a.png">'), '<img src="https://x.example/a.png">');
});

test('forms have no action; dangerous input types go; buttons keep a safe type', () => {
    assert.equal(clean('<form action="https://evil.example" method="post" data-submit="party.create"><button formaction="https://evil.example">Go</button></form>'), '<form data-submit="party.create"><button>Go</button></form>');
    assert.equal(clean('<input type="password" name="p">'), '<input type="text" name="p">');
    assert.equal(clean('<input type="image" src="https://x.example/a.png">'), '<input>');
    assert.equal(clean('<input type="file">'), '<input>');
    assert.equal(clean('<button type="menu">x</button>'), '<button type="button">x</button>');
});

test('SVG: <script>, foreignObject, animation and outside hrefs are removed; shapes stay', () => {
    const svg = '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)"><circle cx="5" cy="5" r="4" fill="red"/></a><foreignObject><div>x</div></foreignObject><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onmouseover" to="alert(1)"/><use href="https://evil.example/s.svg#x"/><use href="#ok"/><image href="https://x.example/a.png"/><image xlink:href="javascript:alert(1)"/><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></svg>';
    assert.equal(clean(svg), '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/><use/><use href="#ok"/><image href="https://x.example/a.png"/><image/><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></svg>');
    assert.equal(clean('<math><mi xlink:href="javascript:alert(1)">x</mi></math>'), '', 'MathML is dropped');
});

test('style attributes: expression(), url(javascript:), @import and position: fixed are dropped; {{ }} is not read', () => {
    assert.equal(clean('<div style="color: red; width: expression(alert(1)); background: url(javascript:alert(1)); position: fixed">x</div>'), '<div style="color: red">x</div>');
    assert.equal(clean('<div style="background:url(&quot;javascript:alert(1)&quot;)">x</div>'), '<div>x</div>');
    assert.equal(clean('<div style="@import \'x.css\'; color: blue">x</div>'), '<div style="color: blue">x</div>');
    const { el, compiled } = render('<div style="color: {{ q.c }}; margin: 0">x</div>', { q: { c: 'red' } });
    assert.match(compiled.warnings.join(' '), /data-bind-var/);
    assert.equal(el.firstElementChild.getAttribute('style'), 'margin: 0', 'the binding was taken out, not filled');
});

test('data-ss-* (scoping) attributes and unknown elements are not kept', () => {
    assert.equal(clean('<div data-ss-screen="other" data-x="1">a</div>'), '<div data-x="1">a</div>');
    assert.equal(clean('<blink><marquee>hi</marquee></blink>'), 'hi');
    assert.equal(clean('<custom-el onclick="x">c</custom-el>'), 'c');
});

test('bound values containing HTML render as text, never as markup', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { el } = render('<p>{{ q.name }}</p><p data-bind="q.name"></p><p title="{{ q.name }}">t</p>', { q: { name: evil } });
    const [a, b, c] = el.children;
    assert.equal(a.childNodes.length, 1);
    assert.equal(a.childNodes[0].nodeType, 3);
    assert.equal(a.textContent, evil);
    assert.equal(b.children.length, 0);
    assert.equal(b.textContent, evil);
    assert.equal(c.getAttribute('title'), evil);
    assert.equal(el.querySelectorAll('img').length + el.querySelectorAll('script').length, 0);
});

test('bound URLs are checked again: javascript:, http: and relative links never reach the page', () => {
    const scope = { q: { js: 'javascript:alert(1)', jsTab: 'java\tscript:alert(1)', http: 'http://x.example/a.png', file: 'a.png?x=javascript:1', data: 'data:image/png;base64,AA' } };
    const { el, view } = render(`
        <a data-bind-attr="href: q.js">a</a><a href="https://x.example/{{ q.jsTab }}" data-bind-attr="href: q.jsTab">b</a><img data-bind-attr="src: q.http"><img src="https://x.example/{{ q.file }}"><img src="{{ q.file }}"><img data-bind-attr="src: q.data">
        <a data-bind-attr="onclick: q.js; style: q.js; class: q.js">c</a>`, scope);
    const [a, b, d] = el.querySelectorAll('a');
    const [i1, i2, i4, i3] = el.querySelectorAll('img');
    assert.equal(a.getAttribute('href'), null);
    assert.equal(b.getAttribute('href'), null);
    assert.equal(i1.getAttribute('src'), null);
    assert.equal(i2.getAttribute('src'), 'https://x.example/a.png?x=javascript:1', 'an https: template with a hole stays https:');
    assert.equal(i4.getAttribute('src'), null, 'a URL attribute that is only a hole is removed by the sanitiser (as DOMPurify does): use data-bind-attr');
    assert.equal(i3.getAttribute('src'), 'data:image/png;base64,AA');
    assert.equal(d.getAttribute('onclick'), null);
    assert.equal(d.getAttribute('style'), null);
    assert.ok(view.warnings.some(w => /cannot set onclick/.test(w)));
    assert.ok(view.warnings.some(w => /use data-class/.test(w)));
    assert.ok(view.warnings.some(w => /was left out/.test(w)));
});

test('data-payload: a bound value can never break out of its JSON string', () => {
    const calls = [];
    const { el } = render(`<button data-command="item.use" data-payload='{"stack":"{{ q.id }}","qty":1}'>x</button><button data-command="item.use" data-payload='{"qty":{{ q.n }}}'>y</button>`, {
        q: { id: 'it_a", "qty": 999, "x": "', n: '1}, "evil": {' },
    }, { command: async (type, payload) => calls.push(payload) });
    el.children[0].click();
    el.children[1].click();
    assert.deepEqual(calls[0], { stack: 'it_a", "qty": 999, "x": "', qty: 1 });
    assert.deepEqual(calls[1], { qty: '1}, "evil": {' }, 'outside a string a value is one JSON value');
});

test('the host sanitizer is called with the strict config, and the allow-list still runs after it', () => {
    let seen = null;
    const leaky = (html, config) => {
        seen = config;
        return html; // a sanitizer that lets everything through
    };
    const compiled = compileTemplate('<p onclick="x()">a</p><script>alert(1)</script>', { sanitize: leaky });
    assert.deepEqual(seen.ADD_TAGS, ['ss-widget']);
    assert.ok(seen.FORBID_TAGS.includes('style') && seen.FORBID_ATTR.includes('formaction'));
    assert.equal(seen.ALLOW_DATA_ATTR, true);
    assert.equal(PURIFY_CONFIG.SAFE_FOR_TEMPLATES, false, '{{ }} must survive DOMPurify');
    assert.ok(PURIFY_CONFIG.ALLOWED_URI_REGEXP.test('https://x') && !PURIFY_CONFIG.ALLOWED_URI_REGEXP.test('javascript:x'));
    const doc = installFakeDom();
    const el = doc.createElement('div');
    renderTemplate(el, compiled, {});
    assert.equal(inner(el), '<p>a</p>');
    const broken = compileTemplate('<p>a</p>', { sanitize: () => { throw new Error('no'); } });
    assert.match(broken.warnings[0], /sanitiser failed/);
});

test('the reader decodes entities, keeps raw text inert and builds tables like a browser', () => {
    assert.equal(serializeHtml(parseHtml('a &amp; b &lt;c&gt; &#x41;&#66; &nbsp;&bogus; &copy;')), 'a &amp; b &lt;c&gt; AB &nbsp;&amp;bogus; ©');
    assert.equal(serializeHtml(parseHtml('<table><tr><td>1<td>2</tr></table>')), '<table><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    assert.equal(serializeHtml(parseHtml('<ul><li>a<li>b</ul><p>x<div>y</div>')), '<ul><li>a</li><li>b</li></ul><p>x</p><div>y</div>');
    assert.equal(serializeHtml(parseHtml('<select><option>a<option>b</select>')), '<select><option>a</option><option>b</option></select>');
    assert.equal(serializeHtml(parseHtml('<textarea><b>{{ x }}</b></textarea>')), '<textarea>&lt;b&gt;{{ x }}&lt;/b&gt;</textarea>');
    assert.equal(serializeHtml(parseHtml('<svg viewbox="0 0 1 1"><lineargradient id="g"/></svg>')), '<svg viewBox="0 0 1 1"><linearGradient id="g"/></svg>');
    assert.equal(serializeHtml(parseHtml('a < b and c<3 <!-- hidden --> <![CDATA[x]]> <!doctype html> </ b>')), 'a &lt; b and c&lt;3    ');
    assert.equal(serializeHtml(parseHtml('<div title="x" title="y" a=b c>t</div>')), '<div title="x" a="b" c="">t</div>');
    assert.equal(serializeHtml(parseHtml('<div><ul><li>a</div><p>b')), '<div><ul><li>a</li></ul></div><p>b</p>', 'an end tag closes what is open inside it');
    assert.equal(serializeHtml(parseHtml('<table><tr><td><div>x</td></tr></table>')), '<table><tbody><tr><td><div>x</div></td></tr></tbody></table>');
    assert.equal(serializeHtml(parseHtml('<td>a</div>b</td>')), '<td>ab</td>', 'a stray end tag is ignored');
});
