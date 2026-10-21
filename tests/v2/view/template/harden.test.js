// Security hardening of screens (QA report, PR #70, findings 12–16, and SillyTavern's own selectors):
// themes checked before they are set, malformed attributes skipped like a browser, SVG paint limited to
// url(#id), URLs in custom properties and loaders, forms that never submit the page, and templates that
// cannot reuse SillyTavern's ids, names or handler classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, renderTemplate, strictSanitize } from '../../../../src/v2/view/template/index.js';
import { parseHtml } from '../../../../src/v2/view/template/html.js';
import { RESERVED_CLASSES, RESERVED_NAMES, cleanClasses, paintAllowed } from '../../../../src/v2/view/template/sanitize.js';
import { cssVarValue, scopeCss, templateIdPrefix, themeVars, valueProblem } from '../../../../src/v2/view/css.js';
import { validateScreen } from '../../../../src/v2/view/screens.js';
import { drawScreen } from '../../../../src/v2/view/mounts/common.js';
import { fakeEvaluate, installFakeDom } from './helpers.js';
import { screen, screensWith, setupDom } from '../mounts/helpers.js';

function render(html, scope = {}, options = {}) {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const compiled = compileTemplate(html);
    const calls = [];
    const view = renderTemplate(el, compiled, scope, { evaluate: fakeEvaluate, command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; }, ...options });
    return { el, view, compiled, calls };
}

// ---- 12: themes -------------------------------------------------------------------------------------

test('finding 12: validateScreen refuses theme values css.js would not set, with the reason', () => {
    const bad = { '--a': 'url(javascript:alert(1))', '--b': 'url(http://evil.example/t.png)', '--c': 'expression(alert(1))', '--d': 'image-set("http://evil.example/a.png" 1x)', '--e': '"http://evil.example/a.png"', '--f': 'red; color: blue' };
    for (const [key, value] of Object.entries(bad)) {
        const errors = validateScreen(screen('m/x', ['tab'], { theme: { [key]: value } }));
        assert.equal(errors.length, 1, `${key}: ${value}`);
        assert.match(errors[0], new RegExp(`Screen "m/x": Theme value for ${key}`));
    }
    assert.deepEqual(validateScreen(screen('m/x', ['tab'], { theme: { '--ss-accent': '#7c5cff', '--size': 4, '--img': 'url(https://ok.example/a.png)' } })), []);
});

test('finding 12: an unsafe card theme falls back to the module default and the reason is kept; only checked values are set', () => {
    const doc = setupDom();
    const screens = screensWith([screen('m/sheet', ['tab'], { theme: { '--ss-accent': '#123456' } })]);
    screens.setCard([screen('m/sheet', ['tab'], { theme: { '--ss-accent': '#ff0000', '--ss-bg': 'url(http://evil.example/t.png)' } })]);
    const resolved = screens.resolve('m/sheet');
    assert.equal(resolved.source, 'module');
    assert.equal(resolved.fallbacks[0].source, 'card');
    assert.match(resolved.fallbacks[0].reason, /--ss-bg/);
    const el = doc.createElement('div');
    const result = drawScreen(el, 'm/sheet', 'tab', { deps: { screens, render: () => {}, query: () => null }, state: {} });
    assert.equal(result.ok, true);
    assert.equal(el.style.getPropertyValue('--ss-accent'), '#123456');
    assert.equal(el.style.getPropertyValue('--ss-bg'), '');
});

test('finding 12: drawScreen sets only values themeVars accepts, even for a screen handed over unchecked', () => {
    const doc = setupDom();
    const def = screen('m/raw', ['tab'], { theme: { '--ok': 'blue', '--bad': 'url(http://evil.example/t.png)' } });
    const screens = { resolve: () => ({ screen: def, fallbacks: [] }) };
    const el = doc.createElement('div');
    drawScreen(el, 'm/raw', 'tab', { deps: { screens, render: () => {}, query: () => null }, state: {} });
    assert.equal(el.style.getPropertyValue('--ok'), 'blue');
    assert.equal(el.style.getPropertyValue('--bad'), '');
});

// ---- 13: malformed attributes ----------------------------------------------------------------------

test('finding 13: junk where an attribute name belongs is skipped with a warning, the rest is read', () => {
    for (const [html, tag, attrs] of [
        ['<img """><b>x</b>', 'img', []],
        ['<div \'x\'>y</div>', 'div', []],
        ['<p a="1""b">z</p>', 'p', [['a', '1']]],
        ['<span =x title="t">s</span>', 'span', [['title', 't']]],
        ['<i title="t"\'\'>i</i>', 'i', [['title', 't']]],
    ]) {
        const warnings = [];
        let nodes;
        assert.doesNotThrow(() => { nodes = parseHtml(html, warnings); }, html);
        assert.equal(nodes[0].tag, tag, html);
        assert.deepEqual(nodes[0].attrs, attrs, html);
        assert.equal(warnings.length, 1, html);
        assert.match(warnings[0], /not an attribute name/);
        const compiled = compileTemplate(html);
        assert.ok(compiled.warnings.some(line => /not an attribute name/.test(line)), html);
    }
    const { el } = render('<p a="1""b">z</p><b>x</b>');
    assert.equal(el.textContent, 'zx');
});

// ---- 14: SVG paint ---------------------------------------------------------------------------------

test('finding 14: SVG paint and reference attributes hold a colour or url(#id) only, static or bound', () => {
    for (const value of ['url(http://evil.example/p.svg#g)', 'url(https://ok.example/p.svg#g)', 'url(//evil.example/p.svg#g)', 'url("javascript:alert(1)")', 'url(data:image/svg+xml,x#g)', 'u\\72l(http://evil.example)', 'var(--x)', 'url(#a) url(http://e.example)', 'image-set("x" 1x)']) {
        assert.equal(paintAllowed(value), false, value);
    }
    for (const value of ['red', '#fff', 'none', 'currentColor', 'url(#grad)', 'url( "#grad" ) red', 'rgb(1, 2, 3)', 'context-stroke']) assert.equal(paintAllowed(value), true, value);
    for (const name of ['fill', 'stroke', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end']) {
        assert.equal(strictSanitize(`<svg><rect ${name}="url(http://evil.example/x.svg#a)"/></svg>`), '<svg><rect/></svg>', name);
    }
    const { el, view } = render('<svg><rect data-bind-attr="fill: q.u; stroke: q.ok"/><circle fill="url(#g)"/></svg>', { q: { u: 'url(http://evil.example/s.svg#s)', ok: 'url(#g)' } }, { screenId: 'a/b' });
    const [rect, circle] = el.querySelector('svg').children;
    assert.equal(rect.getAttribute('fill'), null);
    assert.equal(rect.getAttribute('stroke'), 'url(#ss-t-a-b-g)', 'a bound fragment follows the id prefix');
    assert.equal(circle.getAttribute('fill'), 'url(#ss-t-a-b-g)');
    assert.ok(view.warnings.some(line => /colour or url\(#id\)/.test(line)));
});

// ---- 15: URLs in custom properties and loaders -----------------------------------------------------

test('finding 15: a URL string or a var() cannot reach a loader through a custom property', () => {
    for (const value of ['"http://evil.example/x.png"', '\'//evil.example/x.png\'', 'image-set(var(--a) 1x)', '-webkit-image-set(var(--a) 1x)', 'image(var(--a))', 'src(var(--a))', 'image-set(attr(data-x) 1x)',
        'image-set(url(https://ok.example/a.png) 1x, "http://evil.example/b.png" 2x)', '"file:///etc/passwd"', '"blob:https://x/1"', '"ftp://evil.example/x"']) {
        assert.notEqual(valueProblem(value), '', value);
        assert.equal(cssVarValue(value), '', value);
        assert.deepEqual(themeVars({ '--a': value }).vars, [], value);
    }
    for (const value of ['"HP: "', '"https://ok.example/a.png"', '"data:image/png;base64,iVBORw0KGgo="', 'image-set("https://ok.example/a.png" 1x)', '"Note: kept"']) {
        assert.equal(valueProblem(value), '', value);
    }
    const css = scopeCss('.a { --a: "http://evil.example/x.png"; --label: "HP: "; background-image: image-set(var(--a) 1x); color: red }', 'qa/screen').css;
    assert.equal(css, '[data-ss-screen="qa/screen"] .a { --label: "HP: "; color: red }');
    const { el } = render('<div style="--a: &quot;http://evil.example/x.png&quot;; background-image: image-set(var(--a) 1x); color: red">x</div>');
    assert.equal(el.children[0].getAttribute('style'), 'color: red');
});

// ---- 16: forms -------------------------------------------------------------------------------------

test('finding 16: every form stops the browser\'s submission; a data-submit form also runs its command once', async () => {
    const plain = render('<form><input name="q"><button type="submit">Go</button></form>');
    assert.equal(plain.el.querySelector('form').dispatch('submit').defaultPrevented, true);
    const nested = render('<div><section><form name="f"><button>Go</button></form></section></div>');
    assert.equal(nested.el.querySelector('form').dispatch('submit').defaultPrevented, true);
    const bound = render('<form data-submit="party.create"><input data-draft="name"></form>', { draft: { name: 'Ren' } });
    const event = bound.el.querySelector('form').dispatch('submit');
    assert.equal(event.defaultPrevented, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(bound.calls, [['party.create', { name: 'Ren' }]]);
});

// ---- SillyTavern's selectors -----------------------------------------------------------------------

test('template ids, and everything pointing at them, are prefixed per screen when drawn', () => {
    assert.equal(templateIdPrefix('rpg-battle/party'), 'ss-t-rpg-battle-party-');
    const html = '<label for="nm">Name</label><input id="nm" aria-describedby="hint help"><p id="hint">h</p><a href="#nm">top</a><a href="https://x.example/#y">out</a><form name="f" id="{{ q.id }}"></form><svg><use href="#shape"/></svg>';
    const { el } = render(html, { q: { id: 'send_textarea' } }, { screenId: 'rpg-battle/party' });
    const [label, input, p, top, out, form] = el.children;
    assert.equal(label.getAttribute('for'), 'ss-t-rpg-battle-party-nm');
    assert.equal(input.id, 'ss-t-rpg-battle-party-nm');
    assert.equal(input.getAttribute('aria-describedby'), 'ss-t-rpg-battle-party-hint ss-t-rpg-battle-party-help');
    assert.equal(p.id, 'ss-t-rpg-battle-party-hint');
    assert.equal(top.getAttribute('href'), '#ss-t-rpg-battle-party-nm');
    assert.equal(out.getAttribute('href'), 'https://x.example/#y', 'an outside link is left alone');
    assert.equal(form.id, 'ss-t-rpg-battle-party-send_textarea', 'a bound id is prefixed too: never SillyTavern\'s #send_textarea');
    assert.equal(form.getAttribute('name'), 'ss-t-rpg-battle-party-f', 'a form name would be document.<name>');
    assert.equal(el.querySelector('use').getAttribute('href'), '#ss-t-rpg-battle-party-shape');
    const cells = render('<table><tr><th id="a">A</th><td headers="a b">1</td></tr></table>', {}, { screenId: 'rpg-battle/party' }).el;
    assert.equal(cells.querySelector('td').getAttribute('headers'), 'ss-t-rpg-battle-party-a ss-t-rpg-battle-party-b');
    // The screen's CSS follows.
    assert.equal(scopeCss('#nm, .a > #hint:hover, [data-x="#q"] { color: red }', 'rpg-battle/party').css,
        '[data-ss-screen="rpg-battle/party"] #ss-t-rpg-battle-party-nm, [data-ss-screen="rpg-battle/party"] .a > #ss-t-rpg-battle-party-hint:hover, [data-ss-screen="rpg-battle/party"] [data-x="#q"] { color: red }');
});

test('the same element drawn for another screen gets that screen\'s ids', () => {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    const compiled = compileTemplate('<p id="x">x</p>');
    renderTemplate(el, compiled, { screenId: 'a/one' }, { evaluate: fakeEvaluate });
    assert.equal(el.children[0].id, 'ss-t-a-one-x');
    renderTemplate(el, compiled, { screenId: 'a/two' }, { evaluate: fakeEvaluate });
    assert.equal(el.children.length, 1);
    assert.equal(el.children[0].id, 'ss-t-a-two-x');
});

test('classes SillyTavern acts on are never set, bound or toggled; control names it reads are dropped', () => {
    for (const name of ['swipe_right', 'swipe_left', 'mes_edit', 'mes', 'last_mes', 'mes_text', 'select_chat_block']) assert.ok(RESERVED_CLASSES.has(name), name);
    assert.ok(!RESERVED_CLASSES.has('menu_button'), 'SillyTavern\'s button look stays usable');
    assert.deepEqual(cleanClasses('row swipe_right  mes_edit hp'), { value: 'row hp', dropped: ['swipe_right', 'mes_edit'] });
    assert.equal(strictSanitize('<button class="swipe_right">x</button><div class="mes_edit card">y</div>'), '<button>x</button><div class="card">y</div>');
    const compiled = compileTemplate('<button class="mes_edit">x</button>');
    assert.ok(compiled.warnings.some(line => /mes_edit/.test(line) && /SillyTavern/.test(line)));
    const { el, view } = render('<b class="a {{ q.c }}">1</b><i data-class="swipe_left: true; on: true">2</i><input type="radio" name="avatar_style"><input type="radio" data-bind-attr="name: q.n"><input name="pick">',
        { q: { c: 'swipe_right b', n: 'chat_display' } });
    const [b, i, radio, bound, pick] = el.children;
    assert.equal(b.className, 'a b');
    assert.equal(i.className, 'on');
    assert.equal(radio.getAttribute('name'), null);
    assert.equal(bound.getAttribute('name'), null);
    assert.equal(pick.getAttribute('name'), 'ss-t-pick', 'other names are kept (prefixed, as ids are) for radio groups');
    assert.ok(view.warnings.some(line => /swipe_right/.test(line)));
    assert.ok(view.warnings.some(line => /swipe_left/.test(line)));
    assert.ok(view.warnings.some(line => /chat_display/.test(line)));
});

test('SillyTavern 1.19\'s own radio group names are dropped from template controls, bound or written', () => {
    for (const name of ['character_names', 'continue_postfix', 'extension_default_position', 'extension_floating_char_position', 'extension_floating_position']) {
        assert.ok(RESERVED_NAMES.has(name), name);
    }
    const { el, view } = render('<input type="radio" name="character_names" value="x"><input type="radio" data-bind-attr="name: q.n"><input type="radio" name="mine">',
        { q: { n: 'extension_floating_position' } });
    const [written, bound, mine] = el.children;
    assert.equal(written.getAttribute('name'), null);
    assert.equal(bound.getAttribute('name'), null);
    assert.equal(mine.getAttribute('name'), 'ss-t-mine');
    assert.ok(view.warnings.some(line => /character_names/.test(line)));
    assert.ok(view.warnings.some(line => /extension_floating_position/.test(line)));
    assert.equal(strictSanitize('<input type="radio" name="character_names">'), '<input type="radio">');
});
