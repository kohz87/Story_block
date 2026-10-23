// Screen CSS: scoped to the screen root, keyframes prefixed, nothing loaded from outside, 64 KB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CSS_BYTES, cssVarValue, filterDeclarations, keyframePrefix, scopeCss, screenSelector, selectorEscape, themeVars } from '../../../../src/v2/view/css.js';

const S = '[data-ss-screen="rpg-battle/party"]';
const scope = css => scopeCss(css, 'rpg-battle/party');

test('every selector is scoped, lists and combinators included; root aliases become the scope', () => {
    const { css, warnings } = scope(`
        .sheet { color: red }
        h2, .card > .title , a:hover::after { margin: 0 }
        :root { --ss-accent: #7c5cff }
        html { padding: 1px }
        > .direct { gap: 2px }
        :scope.wide { width: 100% }
    `);
    assert.deepEqual(warnings, []);
    assert.equal(css, [
        `${S} .sheet { color: red }`,
        `${S} h2, ${S} .card > .title, ${S} a:hover::after { margin: 0 }`,
        `${S} { --ss-accent: #7c5cff }`,
        `${S} { padding: 1px }`,
        `${S} > .direct { gap: 2px }`,
        `${S}.wide { width: 100% }`,
    ].join('\n'));
    assert.equal(screenSelector('a"b'), '[data-ss-screen="a\\"b"]');
});

test('@media, @supports, @container and @layer are scoped inside; nesting works', () => {
    const { css } = scope('@media (max-width: 600px) { .a { b: c } @supports (display: grid) { .g { display: grid } } } @layer base { .l { x: y } } @container card (min-width: 1px) { .c { d: e } }');
    assert.equal(css, [
        '@media (max-width: 600px) {',
        `  ${S} .a { b: c }`,
        '  @supports (display: grid) {',
        `    ${S} .g { display: grid }`,
        '  }',
        '}',
        '@layer base {',
        `  ${S} .l { x: y }`,
        '}',
        '@container card (min-width: 1px) {',
        `  ${S} .c { d: e }`,
        '}',
    ].join('\n'));
});

test('keyframes get the screen prefix and animations use it', () => {
    const { css } = scope('@keyframes pulse { 0% { opacity: 1 } to { opacity: .5 } } .hurt { animation: pulse 1s infinite; } .b { animation-name: pulse, other } @media (x) { @keyframes inner { from { top: 0 } } .c { animation: inner 2s } }');
    const prefix = keyframePrefix('rpg-battle/party');
    assert.equal(prefix, 'ss-rpg-battle-party-');
    assert.match(css, /@keyframes ss-rpg-battle-party-pulse \{\n {2}0% \{ opacity: 1 \}\n {2}to \{ opacity: .5 \}\n\}/);
    assert.ok(css.includes(`${S} .hurt { animation: ss-rpg-battle-party-pulse 1s infinite }`));
    assert.ok(css.includes(`${S} .b { animation-name: ss-rpg-battle-party-pulse, other }`), 'unknown names are left as they are');
    assert.ok(css.includes('@keyframes ss-rpg-battle-party-inner'));
    assert.ok(css.includes(`${S} .c { animation: ss-rpg-battle-party-inner 2s }`));
});

test('@import (anywhere), @charset, @namespace and unknown at-rules are dropped', () => {
    const { css, warnings } = scope('@import url("https://evil.example/x.css"); @import "y.css"; @charset "utf-8"; @namespace svg url(x); .a { b: c } @media (x) { @import "z.css"; .d { e: f } } @font-feature-values Font { @swash { fancy: 1 } } @page { margin: 0 }');
    assert.doesNotMatch(css, /@import|@charset|@namespace|@page|@font-feature|evil/);
    assert.ok(css.includes(`${S} .a { b: c }`));
    assert.ok(css.includes(`  ${S} .d { e: f }`));
    assert.equal(warnings.filter(w => /@import/.test(w)).length, 3);
});

test('position: fixed, behaviors, expression() and script URLs drop their declaration', () => {
    const { css, warnings } = scope(`.a {
        position: fixed; color: red; position: FIXED !important; position: sticky;
        behavior: url(x.htc); -moz-binding: url(x.xml#b);
        width: expression(alert(1)); width: e\\78 pression(alert(1));
        background: url(javascript:alert(1)); background: url( "  JaVaScRiPt:alert(1)" );
        background: u\\72l(javascript:alert(1)); background-image: url('vbscript:x');
        background: url(http://plain.example/a.png); background: url(/relative.png); background: url(x.png);
        background: image-set("javascript:x" 1x); list-style: url(data:image/png;base64,AAAA);
        background: url("https://cdn.example/a.png") no-repeat;
    }`);
    assert.equal(css, `${S} .a { color: red; position: sticky; list-style: url(data:image/png;base64,AAAA); background: url("https://cdn.example/a.png") no-repeat }`);
    assert.equal(warnings.length, 14);
    assert.ok(warnings.some(w => /position: fixed/.test(w)));
});

test('@font-face stays with https:/data: sources only', () => {
    const { css, warnings } = scope('@font-face { font-family: Hero; src: url(https://fonts.example/hero.woff2) format("woff2"), local(Hero); } @font-face { font-family: Bad; src: url(http://x/y.woff) }');
    assert.ok(css.includes('@font-face { font-family: Hero; src: url(https://fonts.example/hero.woff2) format("woff2"), local(Hero) }'));
    assert.ok(css.includes('@font-face { font-family: Bad }'));
    assert.equal(warnings.length, 1);
});

test('comments and strings with braces are read correctly; markup is ignored', () => {
    const { css } = scope('/* .x { } */ .a::before { content: "} .evil { color: red"; } /* trailing');
    assert.equal(css, `${S} .a::before { content: "} .evil { color: red" }`);
    const tagged = scope('</style><script>alert(1)</script> .a { b: c }');
    assert.ok(tagged.warnings.some(w => /Markup/.test(w)));
    assert.doesNotMatch(tagged.css, /script>/);
});

test('over 64 KB is refused whole', () => {
    const big = `.a { color: red }\n`.repeat(Math.ceil((MAX_CSS_BYTES + 10) / 18));
    const { css, warnings } = scope(big);
    assert.equal(css, '');
    assert.match(warnings[0], /64 KB/);
    assert.ok(scope('.a{b:c}'.repeat(100)).css.length > 0);
});

test('style attributes, theme and bound CSS variables use the same checks', () => {
    assert.deepEqual(filterDeclarations('color: red; position: fixed; background: url(javascript:x)').text, 'color: red');
    assert.deepEqual(themeVars({ '--ss-accent': '#7c5cff', '--size': 4, color: 'red', '--bad': 'url(javascript:x)', '--esc': 'a; b: c', '--img': 'url(https://x.example/a.png)' }).vars, [
        ['--ss-accent', '#7c5cff'], ['--size', '4'], ['--img', 'url(https://x.example/a.png)'],
    ]);
    assert.equal(themeVars({ color: 'red' }).warnings.length, 1);
    assert.equal(cssVarValue(0.5), '0.5');
    assert.equal(cssVarValue(Infinity), '');
    assert.equal(cssVarValue(true), '1');
    assert.equal(cssVarValue('12px'), '12px');
    assert.equal(cssVarValue('url(javascript:alert(1))'), '');
    assert.equal(cssVarValue('red; background: url(x)'), '');
    assert.equal(cssVarValue('</style>'), '');
    assert.equal(cssVarValue({}), '');
});

// A screen's selectors reach only the screen's own root and what is inside it. The hostile ones are refused (dropped from the
// sheet, and a pack that has one is refused by packs/validate.js unsafeCss); the ones a screen needs keep working.
const HOSTILE = [
    ':root ~ * ',
    ':root~*',
    ':root\n  + div',
    'html ~ *',
    'BODY > .hud',
    'body .hud',
    ':root .x',
    ':host ~ .x',
    ':scope + .x',
    ':root:has(+ .hud)',
    'html:has(~ *)',
    '.a:has(~ .hud)',
    '*:has(+ *)',
    '~ *',
    '+ .hud',
];
const GOOD = [
    ':root', ':root.dark', 'html[data-x]', ':scope.wide', '> .direct', '.card > .title', 'h2', 'a:hover::after',
    '.a ~ .b', '.a + .b', '.a:has(> .b)', '.a:has(.b)', '.list:has(.item) .x', '[data-x="a ~ b"]', '#hud .x', '*',
];

test('a selector that reaches beyond the screen root is refused: the page beside it, siblings of the root, :has() on siblings', () => {
    for (const selector of HOSTILE) assert.notEqual(selectorEscape(selector), '', JSON.stringify(selector));
    for (const selector of GOOD) assert.equal(selectorEscape(selector), '', JSON.stringify(selector));
});

test('scopeCss drops a hostile selector with a plain warning and keeps the rest of its list', () => {
    const { css, warnings } = scope(':root ~ * { display: none !important } .hud, :root ~ .hud { color: red }');
    assert.equal(css, `${S} .hud { color: red }`, 'the hostile selectors are gone, the good one stays');
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every(w => /sibling|starts at/.test(w)), warnings.join(' | '));
});
