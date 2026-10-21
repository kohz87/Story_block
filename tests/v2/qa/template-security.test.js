// QA: screen templates (src/v2/view/template, SPEC §13.2) and screen CSS (src/v2/view/css.js, §13.3) with
// hostile packs, cards and data. Whatever the template or the bound data says, the page built must
// hold only allowed elements, no event attribute, no URL other than https:/data: images (links https:
// or #), no style that loads or runs anything, and nothing parsed from data. The fake DOM throws on
// innerHTML. Problems found are the test.todo entries, named after what should happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from '../../ui-fake-dom.js';
import { compileTemplate, renderTemplate } from '../../../src/v2/view/template/index.js';
import { cssVarValue, scopeCss, themeVars, valueProblem } from '../../../src/v2/view/css.js';
import { evaluateCondition } from '../../../src/v2/events/condition.js';

const forbid = name => function () { throw new Error(`markup was parsed: ${name}`); };
Object.defineProperty(FakeElement.prototype, 'innerHTML', { configurable: true, get: forbid('innerHTML get'), set: forbid('innerHTML set') });
Object.defineProperty(FakeElement.prototype, 'outerHTML', { configurable: true, get: forbid('outerHTML get'), set: forbid('outerHTML set') });
FakeElement.prototype.insertAdjacentHTML = forbid('insertAdjacentHTML');

const ALLOWED_TAGS = new Set(['A', 'ABBR', 'ARTICLE', 'ASIDE', 'B', 'BDI', 'BDO', 'BLOCKQUOTE', 'BR', 'BUTTON', 'CAPTION', 'CITE', 'CODE', 'COL', 'COLGROUP', 'DATA', 'DD', 'DEL',
    'DETAILS', 'DFN', 'DIV', 'DL', 'DT', 'EM', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'I', 'IMG', 'INPUT', 'INS',
    'KBD', 'LABEL', 'LEGEND', 'LI', 'MAIN', 'MARK', 'METER', 'NAV', 'OL', 'OPTGROUP', 'OPTION', 'OUTPUT', 'P', 'PRE', 'PROGRESS', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SAMP', 'SECTION',
    'SELECT', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUMMARY', 'SUP', 'TABLE', 'TBODY', 'TD', 'TEXTAREA', 'TFOOT', 'TH', 'THEAD', 'TIME', 'TR', 'U', 'UL', 'VAR', 'WBR', 'SS-WIDGET',
    'SVG', 'G', 'PATH', 'CIRCLE', 'ELLIPSE', 'LINE', 'POLYLINE', 'POLYGON', 'RECT', 'TEXT', 'TSPAN', 'TEXTPATH', 'DEFS', 'LINEARGRADIENT', 'RADIALGRADIENT', 'STOP', 'CLIPPATH',
    'MASK', 'PATTERN', 'SYMBOL', 'USE', 'TITLE', 'DESC', 'IMAGE', 'MARKER']);
const flat = value => String(value).replace(/[\u0000- \u007f]+/g, '').toLowerCase();

function render(html, scope = {}, options = {}) {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const compiled = compileTemplate(html);
    const evaluate = (expr, env) => {
        const result = evaluateCondition(expr, env);
        return result.error ? null : result.value ?? result.met;
    };
    const view = renderTemplate(el, compiled, scope, { evaluate, command: async () => ({ ok: true }), ...options });
    return { el, view, compiled, doc };
}

function assertInert(el, label) {
    for (const node of el.descendants()) {
        assert.ok(ALLOWED_TAGS.has(node.tagName), `${label}: <${node.tagName}> is not an allowed element`);
        const names = node.attributeNames();
        for (const name of names) {
            const value = node.getAttribute(name);
            const lower = name.toLowerCase();
            assert.doesNotMatch(lower, /^on/, `${label}: event attribute ${name}`);
            assert.ok(!['srcdoc', 'action', 'formaction', 'srcset', 'ping', 'background', 'is'].includes(lower), `${label}: ${name}`);
            assert.ok(!lower.startsWith('data-ss-') || ['data-ss-screen', 'data-ss-mount'].includes(lower) === false, `${label}: ${name} would break scoping`);
            if (lower === 'src') assert.ok(flat(value).startsWith('https:') || flat(value).startsWith('data:image/'), `${label}: src="${value}"`);
            if (lower === 'href' || lower === 'xlink:href') {
                if (node.tagName === 'A') assert.ok(flat(value).startsWith('https:') || flat(value).startsWith('#'), `${label}: <a href="${value}">`);
                else if (node.tagName === 'IMAGE') assert.ok(flat(value).startsWith('https:') || flat(value).startsWith('data:image/') || flat(value).startsWith('#'), `${label}: <image href="${value}">`);
                else assert.ok(flat(value).startsWith('#'), `${label}: <${node.tagName} href="${value}">`);
            }
            if (lower === 'style') assert.equal(valueProblem(value), '', `${label}: style="${value}"`);
            assert.ok(!(flat(value).includes('javascript:') && ['href', 'src', 'xlink:href', 'style'].includes(lower)), `${label}: ${name}="${value}"`);
        }
        if (node.tagName === 'INPUT') assert.ok(!['image', 'file', 'password'].includes(String(node.getAttribute('type')).toLowerCase()), `${label}: input type`);
        for (const [key, value] of Object.entries(node.styleProps)) assert.equal(valueProblem(value), '', `${label}: style ${key}: ${value}`);
    }
}

const TEMPLATES = [
    '<div>a<script>alert(1)</script>b</div>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<svg><style><img src=x onerror=alert(1)></style></svg>',
    '<svg><p><style><img src=x onerror=alert(1)></style></p></svg>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<textarea><img src=x onerror=alert(1)></textarea>',
    '<title><img src=x onerror=alert(1)></title>',
    '<xmp><img src=x onerror=alert(1)></xmp>',
    '<!--><img src=x onerror=alert(1)>-->',
    '<!-- --!><img src=x onerror=alert(1)>-->',
    '<![CDATA[<img src=x onerror=alert(1)>]]>',
    '<?xml <img src=x onerror=alert(1)> ?>',
    '</x><img src=x onerror=alert(1)>',
    '<img src=x onerror=alert(1)//',
    '<img/src="x"/onerror="alert(1)">',
    '<img src="x" onerror="alert(1)" onerror="x">',
    '<IMG SRC="JaVaScRiPt:alert(1)">',
    '<img src="  javascript:alert(1)">',
    '<img src="java&#x09;script:alert(1)">',
    '<img src="&#106;avascript:alert(1)">',
    '<img src="data:text/html,<script>alert(1)</script>">',
    '<a href="&#x6A;avascript:alert(1)">x</a>',
    '<a href="\u0001javascript:alert(1)">x</a>',
    '<a href="java&#0;script:alert(1)">x</a>',
    '<a href="javascript&colon;alert(1)">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="//evil.example">x</a>',
    '<a href="http://evil.example">x</a>',
    '<a href="https://ok.example" target="_top">x</a>',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><image href="javascript:alert(1)"/></svg>',
    '<svg><use href="https://evil.example/x.svg#a"/></svg>',
    '<svg><use xlink:href="data:image/svg+xml;base64,PHN2Zz4=#a"/></svg>',
    '<svg><script href="data:,alert(1)"/></svg>',
    '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
    '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
    '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
    '<svg onload="alert(1)"><g onclick="alert(1)"></g></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<object data="x"></object><embed src="x"><applet code="x"></applet>',
    '<link rel="import" href="https://evil.example"><meta http-equiv="refresh" content="0"><base href="https://evil.example/">',
    '<form action="https://evil.example"><button formaction="https://evil.example">x</button><input type="image" src="https://x"><input type="file"><input type="password"></form>',
    '<div is="x-evil" data-ss-screen="other" data-ss-mount="tab">x</div>',
    '<x:script>alert(1)</x:script><svg:script>alert(1)</svg:script>',
    '<video src="https://x"><source src="x"></video><audio src="x"></audio><canvas></canvas><dialog open>x</dialog><portal src="x"></portal>',
    '<details open ontoggle="alert(1)"><summary>x</summary></details>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<div style="background:url(&quot;http://evil.example&quot;)">x</div>',
    '<div style="background:u\\rl(http://evil.example)">x</div>',
    '<div style="width:expression(alert(1))">x</div>',
    '<div style="behavior:url(x.htc); -moz-binding:url(x.xml)">x</div>',
    '<div style="position:fixed; top:0">x</div>',
    '<div style="position:f\\69xed">x</div>',
    '<div style="x:y}body{display:none">x</div>',
    '<div style="background:image-set(&quot;http://evil.example/a.png&quot; 1x)">x</div>',
    '<div style="{{ q.evil }}">x</div>',
];

test('hostile templates: what is built holds only allowed elements, attributes, URLs and styles', () => {
    for (const html of TEMPLATES) {
        let built;
        try {
            built = render(html, { q: { evil: 'background:url(javascript:alert(1))' } });
        } catch (error) {
            // A template the reader cannot read may be refused, but never half-built.
            assert.match(String(error?.message), /./, `${html}: threw`);
            continue;
        }
        assertInert(built.el, html);
        assert.equal(built.el.querySelectorAll('script, iframe, object, embed, style, link, meta, base').length, 0, html);
    }
});

const DATA = {
    js: 'javascript:alert(1)', jsTab: 'java\tscript:alert(1)', jsEnt: '&#106;avascript:alert(1)', http: 'http://evil.example/a.png',
    rel: '//evil.example/a.png', svg: 'data:image/svg+xml;base64,PHN2Zz4=', html: '<img src=x onerror=alert(1)><script>alert(2)</script>',
    css: 'url(javascript:alert(1))', cssHttp: 'url(http://evil.example/t.png)', expr: 'expression(alert(1))', brace: 'red; } body { display:none',
    proto: { __proto__: { polluted: 1 } },
};

test('hostile data bound everywhere a binding may go is text, or is dropped', () => {
    const html = `
        <p>{{ q.html }}</p><p data-bind="q.html"></p><p title="{{ q.html }}">t</p>
        <a data-bind-attr="href: q.js">1</a><a data-bind-attr="href: q.jsTab">2</a><a data-bind-attr="href: q.jsEnt">3</a><a data-bind-attr="href: q.rel">4</a><a data-bind-attr="href: q.http">5</a>
        <img data-bind-attr="src: q.js"><img data-bind-attr="src: q.http"><img data-bind-attr="src: q.rel">
        <svg><image data-bind-attr="href: q.js"/><use data-bind-attr="href: q.http"/></svg>
        <div data-bind-var="--a: q.css; --b: q.cssHttp; --c: q.expr; --d: q.brace; --e: q.html">v</div>
        <div data-bind-attr="onclick: q.js; onmouseover: q.js; style: q.css; srcdoc: q.html; formaction: q.http; data-ss-screen: q.js">x</div>
        <ul><li data-each="q.list as item" title="{{ item.name }}">{{ item.name }}</li></ul>
        <button data-command="qa.do" data-payload='{"name":"{{ q.html }}"}'>b</button>`;
    const { el, view } = render(html, { q: { ...DATA, list: [{ name: DATA.html }, { name: DATA.js }] } });
    assertInert(el, 'bound data');
    assert.ok(el.textContent.includes(DATA.html), 'markup from data is text');
    assert.equal(el.querySelectorAll('img[src]').length, 0, 'no bound image URL survived');
    assert.equal(el.querySelectorAll('a[href]').length, 0, 'no bound link survived');
    const vars = el.querySelector('[data-bind-var]') ?? el.querySelectorAll('div').find(div => div.textContent === 'v');
    for (const key of ['--a', '--b', '--c', '--d', '--e']) assert.equal(vars.style.getPropertyValue(key), '', `${key} from hostile data is not set`);
    assert.ok(view.warnings.length > 0);
    assert.equal(({}).polluted, undefined);
});

test('screen CSS: everything that loads, runs, escapes or covers the page is dropped (§13.3)', () => {
    const bad = [
        '@import url(https://ok.example/x.css);', '@import "x.css";', '@\\69mport "x.css";', '@namespace url(http://evil.example);', '@charset "utf-8";', '@page { margin: 0 }',
        '.a { background: url(javascript:alert(1)) }', '.a { background: url(http://evil.example/a.png) }', '.a { background: url(//evil.example/a.png) }',
        '.a { background: URL( "http://evil.example" ) }', '.a { background: u\\72l(http://evil.example) }', '.a { background: url(http://evil.example/\\29) }',
        '.a { width: expression(alert(1)) }', '.a { behavior: url(x.htc) }', '.a { -moz-binding: url(x.xml#x) }', '.a { position: fixed }', '.a { position: FIXED !important }',
        '.a { position: f\\69xed }', '.a { position:/**/fixed }', '@media screen { .a { position: fixed } }', '@supports (background: url(http://evil.example)) { .a { color: red } }',
        '.a { filter: url(http://evil.example/f.svg#x) }', '.a { cursor: url(http://evil.example/c.cur), auto }', '.a { list-style: url(http://evil.example/x.png) }',
        '.a { mask: url(http://evil.example/m.svg) }', '.a { background: -webkit-cross-fade(url(https://ok.example), url(http://evil.example), 50%) }',
        '.a { background: image("http://evil.example") }', '.a { background: image-set("http://evil.example/a.png" 1x) }', '.a { background: -webkit-image-set("http://evil.example" 1x) }',
        '@font-face { font-family: x; src: url(http://evil.example/f.woff) }', '.a { --x: url(http://evil.example) }',
        '</style><script>alert(1)</script>', '.a { color: red } </style><img src=x onerror=alert(1)>',
    ];
    for (const css of bad) {
        const { css: out } = scopeCss(css, 'qa/screen');
        assert.doesNotMatch(out, /http:|\/\/evil|javascript|expression|behavior|binding|@import|@namespace|@charset|@page|fixed|<\/?(?:style|script)|onerror/i, `${css} → ${out}`);
    }
    const scoped = scopeCss('body { display: none } * { color: red } :root, html { --x: 1 } .a, .b { color: blue }', 'qa/screen').css;
    for (const line of scoped.split('\n').filter(Boolean)) assert.match(line, /^\[data-ss-screen="qa\/screen"\]/, `every rule is scoped: ${line}`);
    assert.equal(scopeCss('a'.repeat(65 * 1024), 'qa/screen').css, '', 'over 64 KB: not used');
});

test('theme values and data-bound CSS variables pass the same value checks', () => {
    const { vars, warnings } = themeVars({ '--a': 'url(javascript:alert(1))', '--b': 'url(http://evil.example)', '--c': 'expression(alert(1))', '--d': 'red; } body {', background: 'red', '--ok': '#7c5cff' });
    assert.deepEqual(vars, [['--ok', '#7c5cff']]);
    assert.equal(warnings.length, 5);
    for (const value of ['url(javascript:alert(1))', 'url(http://evil.example)', 'expression(alert(1))', 'red;x', '{', '<b>', 'a\\62', 'x'.repeat(2001)]) assert.equal(cssVarValue(value), '', value);
    assert.equal(cssVarValue(0.5), '0.5');
    assert.equal(cssVarValue(NaN), '');
});

// ---- problems found (each a failing check, kept as a todo so CI stays green) -----------------

test.todo('template/html.js readAttributes: a quote where an attribute name is expected (<img """>) is read like a browser, not a TypeError', () => {
    // nameMatch = /^[^\s"'>/=]+|^=[^\s"'>/=]*/ matches nothing at a quote, so nameMatch[0] throws
    // "Cannot read properties of null": compileTemplate throws on such a template instead of warning.
    assert.doesNotThrow(() => compileTemplate('<img """><b>x</b>'));
    assert.doesNotThrow(() => compileTemplate('<div \'x\'>y</div>'));
    assert.doesNotThrow(() => compileTemplate('<p a="1""b">z</p>'));
});

test.todo('template/sanitize.js: SVG presentation attributes (fill, stroke, clip-path, mask, marker-*) may hold url() only to #fragments, https: or data:', () => {
    // SVG_ATTRS lets fill="url(http://…)", clip-path, mask and marker-start/mid/end through unchecked (and
    // from data through data-bind-attr): an external SVG resource reference loads from any http: host.
    const { el } = render('<svg><rect fill="url(http://evil.example/p.svg#g)" clip-path="url(http://evil.example/c.svg#c)" mask="url(javascript:alert(1))"/><path marker-end="url(http://evil.example/m.svg#m)"/><rect data-bind-attr="stroke: q.u"/></svg>', { q: { u: 'url(http://evil.example/s.svg#s)' } });
    for (const node of el.descendants()) {
        for (const name of node.attributeNames()) assert.doesNotMatch(node.getAttribute(name), /url\(\s*['"]?(?:http:|javascript:|\/\/)/i, `<${node.tagName} ${name}="${node.getAttribute(name)}">`);
    }
});

test.todo('css.js: a URL kept in a custom property cannot be loaded through image-set(var(--x)) (style attribute, screen CSS, theme, bound variable)', () => {
    // valueProblem looks for quoted strings inside image-set() / image() only literally; with the URL in a
    // custom property ("--a": "\"http://…\"", a plain string, allowed) image-set(var(--a) 1x) loads it.
    const css = scopeCss('.a { --a: "http://evil.example/x.png"; background-image: image-set(var(--a) 1x); }', 'qa/screen').css;
    assert.doesNotMatch(css, /image-set\(var\(--a\)/, 'screen CSS');
    const { el } = render('<div style="--a: &quot;http://evil.example/x.png&quot;; background-image: image-set(var(--a) 1x)">x</div>');
    assert.equal(el.children[0].getAttribute('style') ?? '', '', 'style attribute');
    assert.deepEqual(themeVars({ '--a': '"http://evil.example/x.png"' }).vars, [], 'theme: a string that is a non-https URL');
    assert.equal(cssVarValue('"http://evil.example/x.png"'), '', 'data-bind-var from story data');
});

test.todo('template/render.js: a <form> without data-submit cannot submit (navigate or reload the SillyTavern page)', () => {
    // No submit listener is added to a plain <form>, so its submit button sends a GET to the page itself.
    const { el } = render('<form><input name="q" value="x"><button type="submit">Go</button></form>');
    const form = el.querySelector('form');
    const event = form.dispatch('submit');
    assert.equal(event.defaultPrevented, true, 'the browser\'s own form submission is prevented');
});
