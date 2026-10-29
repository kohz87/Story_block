// The 2.5.2 size change in the stylesheets: Story Suite's roots are drawn at --ss-zoom (0.8, the old 80%) and SillyTavern's own
// chat, top bar and message box are not; on a phone or a touch screen every control inside a root is still 44px on the screen;
// the reply card's header is one line on a phone; Close in the settings window has its own row on a phone; a full-screen layer
// inside a root undoes the zoom; and the Inventory's actions sit on the right of the row, beside the name, on every width.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryScreen } from '../../../src/v2/screens/index.js';

const read = path => readFileSync(new URL(`../../../src/v2/${path}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const size = read('view/size.css');
const PHONE = '@media (max-width: 759.98px), (pointer: coarse)';
const ROOTS = ['.ss-cards', '.story-suite-extras', '.story-suite-reply-note', '.story-suite-bar', '.ss-hud', '.story-suite-sheet > *',
    '.ss-gameview-main > *', '.story-suite-overlay > .ss-settings', '.ss-dialog', '.ss-sample > *', '.ss-sample-dialog'];

// The declarations of the first rule whose selector list is exactly `selector` (it starts a line), inside `css` (from `at` when given).
function rule(css, selector, at = '') {
    const from = at ? css.indexOf(at) : 0;
    assert.ok(from >= 0, `no ${at}`);
    const head = new RegExp(`(^|\\n)[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`);
    const match = css.slice(from).match(head);
    if (!match) return '';
    const open = from + match.index + match[0].length;
    return css.slice(open, css.indexOf('}', open));
}

test('host.css loads size.css last, so its zoom and its phone sizes come after every other sheet', () => {
    const host = read('view/host.css');
    const imports = [...host.matchAll(/@import url\('\.\/([\w-]+\.css)'\);/g)].map(match => match[1]);
    assert.equal(imports.at(-1), 'size.css');
});

test('the roots are zoomed to --ss-zoom (0.8 by default) and say so in --ss-zoomed; SillyTavern\'s own page is not', () => {
    assert.match(rule(size, ':root'), /--ss-zoom: 0\.8;/);
    const zoomed = size.match(/([^{}]+)\{\s*zoom: var\(--ss-zoom\);\s*--ss-zoomed: var\(--ss-zoom\);\s*\}/);
    assert.ok(zoomed, 'one rule zooms the roots');
    const roots = zoomed[1].split(',').map(part => part.trim());
    assert.deepEqual([...roots].sort(), [...ROOTS].sort());
    // The frames keep their size (the game view's and the story panel's window, the settings layer): only what is inside is zoomed.
    for (const frame of ['.ss-gameview', '.story-suite-sheet', '.story-suite-overlay', '.ss-gameview-main']) assert.ok(!roots.includes(frame), frame);
    // Nothing of SillyTavern's is named: its chat text, top bar and message box keep their size.
    for (const st of ['#chat', '.mes', '.mes_text', '#top-bar', '#top-settings-holder', '#send_form', '#send_textarea', '#form_sheld', 'body', 'html']) {
        assert.ok(!new RegExp(`(^|[\\s,(])${st.replace(/[.#]/g, '\\$&')}(?![\\w-])`).test(size.replace(/:root/g, '')), st);
    }
    assert.equal((size.match(/(^|[\s;{])zoom:/g) ?? []).length, 1, 'zoom is set in one place');
});

test('a phone or a touch screen: every button, tab, link, summary and field in a root is 44px on the screen (44px / zoom), switches keep their look with a 44px tap area', () => {
    const at = size.indexOf(PHONE);
    assert.ok(at > 0, 'the phone line (760px) or a coarse pointer');
    const block = size.slice(at);
    const buttons = block.match(/([^{}]+:is\(button, \[role="button"\], \[role="tab"\], a\[href\], summary\)[^{}]*)\{([^}]*)\}/);
    assert.ok(buttons, 'the controls rule');
    assert.match(buttons[1], /:not\(\.ss-switch, \.ss-w-map-node, \[data-ss-hit\]\)/, 'switches and map markers draw their own tap area');
    assert.match(buttons[2], /min-width: calc\(44px \/ var\(--ss-zoomed, 1\)\) !important;/);
    assert.match(buttons[2], /min-height: calc\(44px \/ var\(--ss-zoomed, 1\)\) !important;/);
    const fields = block.match(/([^{}]+:is\(select, textarea, input:not\(\[type="checkbox"\], \[type="radio"\], \[type="range"\], \[type="hidden"\]\)\))\s*\{([^}]*)\}/);
    assert.ok(fields, 'the fields rule');
    assert.match(fields[2], /min-height: calc\(44px \/ var\(--ss-zoomed, 1\)\) !important;/);
    // wide enough too: a colour well (controls.css: 2.4em) or a short select is 44px across on the screen
    assert.match(fields[2], /min-width: calc\(44px \/ var\(--ss-zoomed, 1\)\) !important;/);
    assert.match(read('view/controls.css'), /input:where\(\[type="color"\]\) \{\s*inline-size: 2\.4em;/);
    // Both name every zoomed root's place, so a control in any of them is covered.
    for (const scope of ['.ss-cards', '.story-suite-extras', '.story-suite-reply-note', '.story-suite-bar', '.ss-hud', '.story-suite-sheet', '.ss-gameview', '.story-suite-overlay', '.ss-dialog', '.ss-sample', '.ss-sample-dialog']) {
        assert.ok(buttons[1].includes(scope) && fields[1].includes(scope), scope);
    }
    const hit = block.match(/\.ss-switch::after\s*\{([^}]*)\}/);
    assert.ok(hit, 'the switch\'s tap area');
    assert.match(hit[1], /width: max\(100%, calc\(44px \/ var\(--ss-zoomed, 1\)\)\);/);
    assert.match(hit[1], /height: max\(100%, calc\(44px \/ var\(--ss-zoomed, 1\)\)\);/);
    assert.match(hit[1], /transform: translate\(-50%, -50%\);/);
    // ...in room of its own round the 48 x 28 switch, so that area never reaches a neighbour.
    assert.match(block, /\.ss-switch \{\s*margin: max\(0px, calc\(\(44px \/ var\(--ss-zoomed, 1\) - 28px\) \/ 2\)\) max\(0px, calc\(\(44px \/ var\(--ss-zoomed, 1\) - 48px\) \/ 2\)\) !important;/);
    assert.match(read('view/glass.css'), /\) \.ss-switch \{[^}]*width: 48px;\s*height: 28px;/);
});

test('a phone or a touch screen: checkboxes, radios, sliders, links in running text and the search box\'s clear button are 44px targets too', () => {
    const block = size.slice(size.indexOf(PHONE));
    const decl = selector => {
        const at = block.indexOf(`${selector} {`);
        assert.ok(at >= 0, selector);
        return block.slice(at, block.indexOf('}', at));
    };
    const scope = ':is(.ss-cards, .story-suite-extras, .story-suite-reply-note, .story-suite-bar, .ss-hud, .story-suite-sheet, .ss-gameview, .story-suite-overlay, .ss-dialog, .ss-sample, .ss-sample-dialog)';
    const tap = 'calc(44px / var(--ss-zoomed, 1))';
    // A checkbox or radio in a label is pressed through the label, 44 x 44, and draws no tap area of its own (it would reach the next
    // label: loot chips sit 4px apart). One with no label keeps its box and gets a 44px ::after inside a margin of its own.
    // Any label holding one, however deep; a label with no display of its own becomes an inline block (no weight: flex/grid labels keep theirs).
    const label = decl(`${scope} label:has(input[type="checkbox"], input[type="radio"])`);
    for (const part of ['box-sizing: border-box;', `min-width: ${tap};`, `min-height: ${tap};`]) assert.ok(label.includes(part), part);
    const inlineLabel = decl(`:where(${scope} label:has(input[type="checkbox"], input[type="radio"]))`);
    for (const part of ['display: inline-block;', 'vertical-align: middle;', 'padding-block: max(0px, calc((44px / var(--ss-zoomed, 1) - 1lh) / 2));']) assert.ok(inlineLabel.includes(part), part);
    assert.doesNotMatch(size, /label:has\(> input/, 'not only a direct child');
    assert.match(decl(`:where(${scope} input:is([type="checkbox"], [type="radio"]):not(label input))`), /position: relative;/);
    const bare = decl(`${scope} input:is([type="checkbox"], [type="radio"]):not(label input)`);
    assert.match(bare, /overflow: visible;/);
    // room of its own for the tap area: half each side across, the whole above and below (stacked block checkboxes' margins collapse)
    assert.ok(bare.includes('margin: max(0px, calc(44px / var(--ss-zoomed, 1) - 0.8em)) max(0px, calc((44px / var(--ss-zoomed, 1) - 0.8em) / 2));'));
    assert.ok(!/min-(width|height)/.test(bare), 'the box itself keeps its size');
    const hit = decl(`${scope} input:is([type="checkbox"], [type="radio"]):not(label input)::after`);
    for (const part of ['content: "";', 'position: absolute;', `width: ${tap};`, `height: ${tap};`, 'transform: translate(-50%, -50%);']) assert.ok(hit.includes(part), part);
    assert.doesNotMatch(block, /\) input:is\(\[type="checkbox"\], \[type="radio"\]\)::after/, 'no tap area round a labelled box');
    // Sliders: Story Suite's clear box grows around its track; another range keeps its 5px bar inside 44px of padding.
    assert.ok(decl(`${scope} .ss-slider .ss-slider-input`).includes(`min-height: ${tap};`));
    const range = decl(`${scope} input[type="range"]:not(.ss-slider-input)`);
    for (const part of ['box-sizing: content-box;', 'padding-block: max(0px, calc((44px / var(--ss-zoomed, 1) - 5px) / 2));', 'background-clip: content-box;']) assert.ok(range.includes(part), part);
    // A link anywhere (any parent, any role) and a text element acting as a button or tab are inline blocks with real padding, at no
    // weight (a flex/grid/block control keeps its display), and no negative margin anywhere (nothing reaches over its neighbours).
    const inl = 'span, i, b, em, strong, small, abbr, code, kbd, label, img';
    const link = decl(`:where(${scope} :is(a[href], :is(${inl})[role="button"], :is(${inl})[role="tab"]):not([data-ss-hit]))`);
    for (const part of ['display: inline-block;', 'box-sizing: border-box;', 'max-width: 100%;', 'padding: max(0px, calc((44px / var(--ss-zoomed, 1) - 1lh) / 2)) calc(4px / var(--ss-zoomed, 1));']) assert.ok(link.includes(part), part);
    assert.doesNotMatch(link, /margin/);
    assert.doesNotMatch(size, /margin[^;]*:\s*(min\(|calc\(-|-)/, 'no negative margins anywhere in the size rules');
    assert.doesNotMatch(size, /:is\(p, li, span/, 'not only links under some text elements');
    // The search box keeps the clear button's 44px (right: 4px) free of text.
    assert.match(block, /\.ss-search \.ss-search-input \{\s*padding-right: calc\(44px \/ var\(--ss-zoomed, 1\) \+ 8px\);/);
    assert.match(read('view/glass.css'), /\.ss-search-clear \{\s*position: absolute;\s*right: 4px;/);
});

test('the reply card\'s header is one line on a phone: the summary takes the room left and ends in an ellipsis', () => {
    const mounts = read('view/mounts.css');
    const phone = '@media (max-width: 759.98px) {\n    .ss-card-head {';
    assert.ok(mounts.includes(phone), 'a phone rule for the header');
    assert.match(rule(mounts, '.ss-card-head', phone), /flex-wrap: nowrap;/);
    assert.match(rule(mounts, '.ss-card-head > :not(.ss-card-summary)', phone), /flex: none;/);
    const summary = rule(mounts, '.ss-card-summary', phone);
    for (const part of ['flex: 1 1 0;', 'display: block;', 'white-space: nowrap;', 'text-overflow: ellipsis;']) assert.ok(summary.includes(part), part);
    // The base rule still hides the overflow (the ellipsis needs it) and keeps the summary on the right.
    const base = rule(mounts, '.ss-card-summary');
    assert.match(base, /overflow: hidden;/);
    assert.match(base, /text-align: right;/);
});

test('settings on a phone: the title row is as tall as Close (44px on the screen), so Close never covers the search box', () => {
    const settings = read('view/settings.css');
    const title = settings.match(/@media \(max-width: 759\.98px\) \{\s*:where\([^)]*\) \.ss-settings-title \{([^}]*)\}/);
    assert.ok(title, 'a phone rule for the title');
    assert.match(title[1], /line-height: max\(40px, calc\(44px \/ var\(--ss-zoomed, 1\)\)\);/);
    // Close sits in that row: the window's top padding plus the side's, at the right.
    const close = settings.match(/\) \.ss-settings-close \{([^}]*)\}/)[1];
    assert.match(close, /top: calc\(env\(safe-area-inset-top, 0px\) \+ var\(--ss-space-3\)\);/);
    assert.match(settings.match(/\) \.ss-settings-side \{([^}]*)\}/)[1], /padding: var\(--ss-space-3\) 0 0;/);
});

test('ss.dialog\'s full-screen layer covers the screen inside a zoomed root (vw and dvh are zoomed with it)', () => {
    const glass = read('view/glass.css');
    const modal = glass.match(/\) \.ss-modal \{([^}]*)\}/)[1];
    assert.match(modal, /width: calc\(100vw \/ var\(--ss-zoomed, 1\)\);/);
    assert.match(modal, /height: calc\(100dvh \/ var\(--ss-zoomed, 1\)\);/);
});

test('the Inventory: the actions sit on the right of the row beside the name, centred, on every width; notes and detail under the name; a fold below', () => {
    const css = inventoryScreen.css;
    const body = rule(css, '.item > .body');
    assert.match(body, /grid-template-columns: minmax\(0, 1fr\) fit-content\(50%\);/, 'the name column, then at most half the row for the actions');
    assert.match(body, /grid-template-rows: 1fr auto auto auto 1fr auto;/, 'room above and below the text, so it is centred on taller actions');
    assert.match(body, /align-items: center;/);
    assert.match(rule(css, '.item > .body > .line'), /grid-column: 1; grid-row: 2;/);
    assert.match(rule(css, '.item > .body > .note'), /grid-column: 1; grid-row: 3;/);
    assert.match(rule(css, '.item > .body > .detail'), /grid-column: 1; grid-row: 4;/);
    const actions = rule(css, '.item > .body > .actions');
    assert.match(actions, /grid-column: 2; grid-row: 1 \/ 6;/, 'beside the name, the note and the detail, centred on them');
    assert.match(actions, /justify-content: flex-end;/);
    assert.match(rule(css, '.item > .body > .fold'), /grid-column: 1 \/ -1; grid-row: 6;/, 'the fold opens below the name and the actions');
    // The text column never paints under the actions: it may shrink, long names break anywhere, the chips wrap and are cut to it.
    for (const part of ['min-width: 0;', 'max-width: 100%;', 'overflow-wrap: anywhere;']) {
        assert.ok(rule(css, '.item > .body > :is(.line, .note, .detail)').includes(part), part);
        assert.ok(rule(css, '.item > .body > .line > *').includes(part), `${part} (the name and the chips)`);
    }
    assert.match(rule(css, '.line'), /flex-wrap: wrap;/);
    // A group that wraps on the right when the row is narrow; never a line of its own under the row.
    assert.match(rule(css, '.actions'), /display: flex; flex-wrap: wrap;/);
    assert.doesNotMatch(css, /@container|@media[^{]*\{[^}]*\.actions/, 'the same layout on a phone');
    // The tile stays put when a fold opens.
    assert.match(rule(css, '.item:has(> .body > .fold)'), /align-items: start;/);
    // The template keeps its order: name line, note, detail, actions, folds.
    const order = ['class="line"', 'class="note', 'class="actions"', 'class="fold '].map(part => inventoryScreen.template.indexOf(part));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
});
