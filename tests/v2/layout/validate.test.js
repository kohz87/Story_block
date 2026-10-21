import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout, imageUrlError, LIMITS } from '../../../src/v2/layout/index.js';
import { layoutOf } from './helpers/fake-dom.js';

const errorsFor = (root, extra, options) => validateLayout(layoutOf(root, extra), options);
const nest = depth => {
    let node = { type: 'text', value: 'deep' };
    for (let i = 1; i < depth; i += 1) node = { type: 'box', children: [node] };
    return node;
};

test('a well-formed layout using every node type has no errors', () => {
    const errors = errorsFor({
        type: 'tabs', pages: [{
            title: 'One',
            node: {
                type: 'box', title: { query: 'party.pc', path: 'name' }, children: [
                    { type: 'row', children: [{ type: 'text', value: 'a', label: 'L', variant: 'muted' }] },
                    { type: 'col', children: [{ type: 'badge', value: 'x', tone: 'good' }] },
                    { type: 'grid', cols: 12, children: [{ type: 'meter', value: 1, max: 2, tone: 'bad' }] },
                    { type: 'image', src: 'https://example.com/a.webp', alt: 'A', size: 'large' },
                    {
                        type: 'list', bind: { query: 'inventory.items', args: { owner: 'party' } }, limit: 10, empty: 'None',
                        item: {
                            type: 'when', cond: 'item.qty > 0', children: [
                                { type: 'button', label: 'Use', command: 'item.use', icon: 'fa-flask', tone: '$item.rarity', payload: { stack: '$item.id', n: [1, { x: '$index' }] } },
                                { type: 'meter', bind: '$item.hp' },
                            ],
                        },
                    },
                ],
            },
        }],
    }, { theme: { tokens: { accent: '#fff', bg: 'rgba(0, 0, 0, 0.5)', radius: '6px', font: '"Iowan Old Style", serif', gap: 4 } } });
    assert.deepEqual(errors, []);
});

test('the layout itself: shape, id, title, icon, extra fields', () => {
    assert.deepEqual(validateLayout(null), ['layout: must be an object']);
    assert.deepEqual(validateLayout([]), ['layout: must be an object']);
    const errors = validateLayout({ id: 'Bad Id!', title: '', icon: 'box', root: { type: 'text', value: 'x' }, script: 'x' });
    assert.deepEqual(errors, [
        'layout: has no field "script" (only id, title, icon, theme, root)',
        'layout.id: must be a short lowercase id (letters, digits, . _ / -)',
        'layout.title: must be text of 1 to 60 characters',
        'layout.icon: must be a Font Awesome icon name like fa-box',
    ]);
    assert.deepEqual(validateLayout({ id: 'a', title: 'A', icon: 'fa-a' }), ['layout.root: a layout needs a root node']);
});

test('unknown node types and fields are rejected', () => {
    assert.deepEqual(errorsFor({ type: 'html', value: '<b>' }), ['root: "html" is not a node type']);
    assert.deepEqual(errorsFor({ type: 'toString' }), ['root: "toString" is not a node type']);
    assert.deepEqual(errorsFor({ type: '__proto__' }), ['root: "__proto__" is not a node type']);
    assert.deepEqual(errorsFor({ value: 'x' }), ['root: a node needs a "type"']);
    assert.deepEqual(errorsFor('text'), ['root: must be a node object with a "type"']);
    assert.deepEqual(errorsFor({ type: 'text', value: 'x', style: 'color:red', onclick: 'x' }), [
        'root: a text has no field "style"',
        'root: a text has no field "onclick"',
    ]);
    assert.deepEqual(errorsFor({ type: 'row', children: [{ type: 'text', value: 'ok' }, { type: 'iframe' }] }), ['root.children[1]: "iframe" is not a node type']);
});

test('required fields, either-or fields and field values', () => {
    assert.deepEqual(errorsFor({ type: 'text' }), ['root: a text needs "value" or "bind"']);
    assert.deepEqual(errorsFor({ type: 'text', value: 'a', bind: { query: 'q' } }), ['root: a text takes "value" or "bind", not both']);
    assert.deepEqual(errorsFor({ type: 'meter', value: 3 }), ['root: a meter with a "value" needs a "max"']);
    assert.deepEqual(errorsFor({ type: 'grid', children: [] }), ['root: a grid needs "cols"']);
    assert.deepEqual(errorsFor({ type: 'grid', cols: 13 }), ['root.cols: must be a whole number from 1 to 12']);
    assert.deepEqual(errorsFor({ type: 'grid', cols: 1.5 }), ['root.cols: must be a whole number from 1 to 12']);
    assert.deepEqual(errorsFor({ type: 'list', bind: { query: 'q' } }), ['root: a list needs "item"']);
    assert.deepEqual(errorsFor({ type: 'list', bind: 'literal', item: { type: 'text', value: 'x' } }), ['root.bind: must be a binding ({ query, args, path }) or an $item reference']);
    assert.deepEqual(errorsFor({ type: 'list', bind: { query: 'q' }, limit: 500, item: { type: 'text', value: 'x' } }), ['root.limit: must be a whole number from 1 to 200']);
    assert.deepEqual(errorsFor({ type: 'button', label: 'Go' }), ['root: a button needs "command"']);
    assert.deepEqual(errorsFor({ type: 'button', label: 'Go', command: 'go' }), ['root.command: "go" is not a command name (like item.use)']);
    assert.deepEqual(errorsFor({ type: 'button', label: 'Go', command: 'a.b', icon: 'fa fa-x' }), ['root.icon: must be a Font Awesome icon name like fa-box']);
    assert.deepEqual(errorsFor({ type: 'badge', value: 'x', tone: 'pink' }), ['root.tone: "pink" is not a tone (neutral, accent, good, warn, bad, common, uncommon, rare, epic, legendary)']);
    assert.deepEqual(errorsFor({ type: 'text', value: 'x', variant: 'huge' }), ['root.variant: "huge" is not a text variant (body, title, label, muted)']);
    assert.deepEqual(errorsFor({ type: 'text', value: { nope: 1 } }), ['root.value: an object here must be a binding with a "query"']);
    assert.deepEqual(errorsFor({ type: 'text', value: Number.NaN }), ['layout: holds a number that is not finite']);
    assert.deepEqual(errorsFor({ type: 'text', value: 'x'.repeat(LIMITS.text + 1) }), ['root.value: text is longer than 2000 characters']);
    assert.deepEqual(errorsFor({ type: 'when', children: [] }), ['root: a when needs "cond"']);
    assert.deepEqual(errorsFor({ type: 'when', cond: '  ', children: [] }), ['root.cond: must be a condition of 1 to 500 characters']);
    assert.deepEqual(errorsFor({ type: 'tabs', pages: [] }), ['root.pages: must be a list of 1 to 12 pages']);
    assert.deepEqual(errorsFor({ type: 'tabs', pages: [{ title: 'A' }, { node: { type: 'text', value: 'x' }, extra: 1 }] }), [
        'root.pages[0]: a page needs a "node"',
        'root.pages[1]: a page has no field "extra" (only title, node)',
        'root.pages[1]: a page needs a "title"',
    ]);
    assert.deepEqual(errorsFor({ type: 'box', children: 'nope' }), ['root.children: must be a list of nodes']);
});

test('bad bindings are rejected', () => {
    assert.deepEqual(errorsFor({ type: 'text', bind: { query: 'bad name!' } }), ['root.bind: "bad name!" is not a query name']);
    assert.deepEqual(errorsFor({ type: 'text', bind: { query: 7 } }), ['root.bind: a binding\'s "query" must be a string']);
    assert.deepEqual(errorsFor({ type: 'text', bind: { query: 'q', args: [1] } }), ['root.bind.args: args must be an object']);
    assert.deepEqual(errorsFor({ type: 'text', bind: { query: 'q', path: 'a..b' } }), ['root.bind.path: "a..b" is not a path (use names joined by dots, like hp.cur)']);
    assert.deepEqual(errorsFor({ type: 'text', bind: { query: 'q', path: 'a.__proto__' } }), ['root.bind.path: "a.__proto__" uses the reserved name "__proto__"']);
    assert.deepEqual(errorsFor({ type: 'text', bind: { query: 'q', path: '' } }), ['root.bind.path: a path must be a non-empty string']);
    assert.deepEqual(errorsFor({ type: 'text', bind: { query: 'q', where: 'x' } }), ['root.bind: a binding has no field "where" (only query, args, path)']);
});

test('$item references only inside a list item', () => {
    assert.deepEqual(errorsFor({ type: 'text', value: '$item.name' }), ['root.value: "$item.name" refers to a list row but is not inside a list\'s item']);
    assert.deepEqual(errorsFor({ type: 'button', label: 'x', command: 'a.b', payload: { s: '$item.id' } }), ['root.payload.s: "$item.id" refers to a list row but is not inside a list\'s item']);
    assert.deepEqual(errorsFor({ type: 'text', bind: { query: 'q', args: { n: '$index' } } }), ['root.bind.args.n: "$index" refers to a list row but is not inside a list\'s item']);
    assert.deepEqual(errorsFor({ type: 'list', bind: { query: 'q' }, item: { type: 'text', value: '$item.constructor' } }), ['root.item.value: "constructor" uses the reserved name "constructor"']);
    assert.deepEqual(errorsFor({ type: 'list', bind: { query: 'q' }, item: { type: 'text', value: '$item.a.b' } }), []);
    // `$items` is ordinary text.
    assert.deepEqual(errorsFor({ type: 'text', value: '$items' }), []);
});

test('unsafe image URLs are rejected', () => {
    const bad = [
        'javascript:alert(1)',
        'http://example.com/a.png',
        'data:image/svg+xml;base64,PHN2Zz4=',
        'data:text/html;base64,PHNjcmlwdD4=',
        'data:image/png,notbase64<>',
        'https://user:pw@example.com/a.png',
        '//example.com/a.png',
        'JAVASCRIPT:alert(1)',
        ' https://example.com/a.png',
        'file:///etc/passwd',
        'blob:https://example.com/x',
        'https://',
    ];
    for (const src of bad) {
        const errors = errorsFor({ type: 'image', src });
        assert.equal(errors.length, 1, src);
        assert.match(errors[0], /^root\.src: /, src);
        assert.notEqual(imageUrlError(src), '', src);
    }
    assert.equal(imageUrlError('https://example.com/a.png?x=1'), '');
    assert.equal(imageUrlError('data:image/jpeg;base64,/9j/4AAQ'), '');
    assert.match(imageUrlError(`data:image/png;base64,${'A'.repeat(LIMITS.urlData)}`), /larger than 200 KB/);
    assert.match(imageUrlError(`https://example.com/${'a'.repeat(LIMITS.urlHttps)}`), /longer than 2048/);
    assert.deepEqual(errorsFor({ type: 'image', src: 7 }), ['root.src: an image needs a URL']);
});

test('theme tokens: known names and safe values only', () => {
    const bad = (tokens, expected) => assert.deepEqual(validateLayout(layoutOf({ type: 'text', value: 'x' }, { theme: { tokens } })), expected);
    bad({ colour: 'red' }, ['layout.theme.tokens.colour: "colour" is not a theme token (accent, bg, surface, fg, muted, border, radius, gap, pad, font, good, warn, bad, meter, meter-bg)']);
    bad({ bg: 'url(https://evil.example/track.png)' }, ['layout.theme.tokens.bg: must be a colour, a length or a font name (letters, digits, # . , % ( ) quotes)']);
    bad({ bg: 'image(red)' }, ['layout.theme.tokens.bg: may not use "image(": only rgb(), rgba(), hsl(), hsla()']);
    bad({ bg: 'var(--x)' }, ['layout.theme.tokens.bg: may not use "var(": only rgb(), rgba(), hsl(), hsla()']);
    bad({ accent: 'red; background: blue' }, ['layout.theme.tokens.accent: must be a colour, a length or a font name (letters, digits, # . , % ( ) quotes)']);
    bad({ accent: 'red}body{display:none' }, ['layout.theme.tokens.accent: must be a colour, a length or a font name (letters, digits, # . , % ( ) quotes)']);
    bad({ accent: 'expression (alert(1))' }, ['layout.theme.tokens.accent: may not use "expression(": only rgb(), rgba(), hsl(), hsla()']);
    bad({ accent: { r: 1 } }, ['layout.theme.tokens.accent: must be a colour, a length or a font name (letters, digits, # . , % ( ) quotes)']);
    assert.deepEqual(validateLayout(layoutOf({ type: 'text', value: 'x' }, { theme: { tokens: 'x' } })), ['layout.theme.tokens: must be an object']);
    assert.deepEqual(validateLayout(layoutOf({ type: 'text', value: 'x' }, { theme: { css: '' } })), ['layout.theme: has no field "css" (only tokens)']);
});

test('depth, node count, children, pages and size limits', () => {
    assert.deepEqual(errorsFor(nest(LIMITS.depth)), []);
    const deep = errorsFor(nest(LIMITS.depth + 1));
    assert.equal(deep.length, 1);
    assert.match(deep[0], /nested more than 16 deep/);

    const wide = { type: 'col', children: Array.from({ length: 101 }, () => ({ type: 'text', value: 'x' })) };
    assert.deepEqual(errorsFor(wide), ['root.children: has more than 100 children']);

    const many = { type: 'col', children: Array.from({ length: 10 }, () => ({ type: 'col', children: Array.from({ length: 60 }, () => ({ type: 'text', value: 'x' })) })) };
    const counted = errorsFor(many);
    assert.equal(counted.length, 1);
    assert.match(counted[0], /more than 600 nodes/);

    const pages = Array.from({ length: 13 }, (_, i) => ({ title: `P${i}`, node: { type: 'text', value: 'x' } }));
    assert.deepEqual(errorsFor({ type: 'tabs', pages }), ['root.pages: must be a list of 1 to 12 pages']);

    const big = { type: 'col', children: Array.from({ length: 80 }, () => ({ type: 'text', value: 'x'.repeat(1990) })) };
    const size = errorsFor({ type: 'tabs', pages: Array.from({ length: 2 }, () => ({ title: 'x', node: big })) });
    assert.match(size[0], /^layout: is \d+ KB, more than the 256 KB a layout may be$/);
});

test('only plain JSON: functions, loops and class instances are refused', () => {
    assert.deepEqual(errorsFor({ type: 'text', value: () => 'x' }), ['layout: holds a function, which is not JSON']);
    assert.deepEqual(errorsFor({ type: 'text', value: new Date(0) }), ['layout: holds an object that is not plain JSON']);
    const loop = { type: 'box', children: [] };
    loop.children.push(loop);
    assert.deepEqual(errorsFor(loop), ['layout: refers to itself (a loop)']);
    assert.deepEqual(errorsFor({ type: 'text', value: undefined }), ['layout: holds a undefined, which is not JSON']);
});

test('widgets: only registered names, with their own checks; built-ins cannot be replaced', () => {
    const widgets = {
        'rpg-battle.actor-card': { render() {}, validate: props => (props.actor ? [] : ['an actor card needs "actor"']) },
        text: { render() {} },
        'no-render': {},
    };
    assert.deepEqual(errorsFor({ type: 'rpg-battle.actor-card', props: { actor: 'ac_1' } }, {}, { widgets }), []);
    assert.deepEqual(errorsFor({ type: 'rpg-battle.actor-card' }, {}, { widgets }), ['root: an actor card needs "actor"']);
    assert.deepEqual(errorsFor({ type: 'rpg-battle.actor-card', props: { actor: 'x' }, style: 'x' }, {}, { widgets }), ['root: widget "rpg-battle.actor-card" has no field "style" (only props, bind)']);
    assert.deepEqual(errorsFor({ type: 'rpg-battle.actor-card', props: [1] }, {}, { widgets }), ['root.props: must be an object', 'root: an actor card needs "actor"']);
    assert.deepEqual(errorsFor({ type: 'rpg-battle.actor-card', props: { actor: '$item.id' } }, {}, { widgets }), ['root.props.actor: "$item.id" refers to a list row but is not inside a list\'s item']);
    assert.deepEqual(errorsFor({ type: 'rpg-battle.actor-card', props: { actor: 'x' }, bind: 'x' }, {}, { widgets }), ['root.bind: must be a binding ({ query, args, path }) or an $item reference']);
    assert.deepEqual(errorsFor({ type: 'no-render' }, {}, { widgets }), ['root: "no-render" is not a node type']);
    assert.deepEqual(errorsFor({ type: 'rpg-battle.actor-card' }), ['root: "rpg-battle.actor-card" is not a node type'], 'not installed');
    // The built-in text node is still checked as text.
    assert.deepEqual(errorsFor({ type: 'text' }, {}, { widgets }), ['root: a text needs "value" or "bind"']);
    const throwing = { boom: { render() {}, validate() { throw new Error('oops'); } } };
    assert.deepEqual(errorsFor({ type: 'boom' }, {}, { widgets: throwing }), ['root: its check failed (oops)']);
    assert.deepEqual(errorsFor({ type: 'text', value: 'x' }, {}, { widgets: null }), []);
});

test('errors are capped at 50', () => {
    const root = { type: 'col', children: Array.from({ length: 90 }, () => ({ type: 'nope' })) };
    assert.equal(errorsFor(root).length, 50);
});
