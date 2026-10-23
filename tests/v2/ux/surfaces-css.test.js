// The surfaces of UI stage 4a in the stylesheets: the story panel's tab bar and head (host.css, the ss.tabs block),
// the bar above the message box and its held-back notice (host.css, glass pills), the notes under a reply, the Choices
// strip (folded, full-width glass options), the changes card's rows and the card frame (mounts.css, screen CSS), and
// the frames that were opaque (the HUD strip, the dialog mount, the game view's navigation). Each reads the look's
// tokens (view/theme.js); under Glass only where the brief says so (--ss-sheet-*), so Solid and Follow SillyTavern keep
// their frames. The chat-side surfaces are theme roots: their tokens come from the theme sheet like any root's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT_SELECTOR, THEME_ROOTS, themeCss, themeTokens } from '../../../src/v2/view/theme.js';
import { changesCardScreen } from '../../../src/v2/screens/changes-card.js';

const read = path => readFileSync(new URL(`../../../src/v2/${path}`, import.meta.url), 'utf8');
const host = read('view/host.css');
const mounts = read('view/mounts.css');
const glass = read('view/glass.css');

// The declarations of every rule whose selector is exactly `selector` (outside at-rules; `at` starts the search at an
// at-rule, e.g. a media query), joined: a later rule that adds to an earlier one counts.
function block(css, selector, at = null) {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let from = at ? body.indexOf(at) : 0;
    if (from < 0) return '';
    // A rule whose selector is exactly `selector`: the header starts a line or follows a rule's end (not another selector's tail).
    // A rule whose selector list starts with `selector` (the header starts a line or follows a rule's end, and may go on after a comma).
    const head = new RegExp(`(^|[\\n}])[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:,[^{}]*)? \\{`, 'g');
    const out = [];
    for (const match of body.slice(from).matchAll(head)) {
        const start = from + match.index + match[0].length;
        out.push(body.slice(start, body.indexOf('}', start)));
    }
    return out.join('\n');
}

test('the three chat-side surfaces are theme roots, so the look\'s tokens reach them under every panel style', () => {
    for (const root of ['.story-suite-bar', '.story-suite-extras', '.story-suite-reply-note']) {
        assert.ok(THEME_ROOTS.includes(root), root);
        assert.ok(ROOT_SELECTOR.includes(root), root);
    }
    // The literal lists in the stylesheets name the same roots (a rule under a missing root would never apply).
    for (const file of ['controls.css', 'glass.css', 'settings.css']) {
        const text = read(`view/${file}`);
        assert.ok(text.includes('.story-suite-bar, .story-suite-extras, .story-suite-reply-note'), file);
    }
    assert.match(themeCss({ scheme: 'dark', panel: 'glass' }), /\.story-suite-bar[^{]*\{/);
    assert.ok(themeTokens({ panel: 'solid' }).some(([name]) => name === '--ss-glass'));
});

test('the bar and its held-back notice are glass pills on the tokens; the buttons keep the menu_button class', () => {
    const pill = block(host, '.story-suite-bar .menu_button');
    for (const part of ['var(--ss-glass,', 'var(--ss-border,', 'var(--ss-radius-pill, 999px)', 'var(--ss-blur, none)', 'var(--ss-shadow, none)']) assert.ok(pill.includes(part), part);
    // Hover and focus: the accent is the edge and a soft fill; the text stays the look's text colour (contrast on glass).
    const hover = block(host, '.story-suite-bar .menu_button:not(.disabled):not([disabled]):hover');
    assert.ok(hover.length > 0, 'the hover rule is written against SillyTavern\'s own hover rule (same selector shape, later)');
    assert.match(hover, /var\(--ss-accent,/);
    assert.match(hover, /color: var\(--ss-text, inherit\);/);
    assert.match(hover, /linear-gradient\(var\(--ss-accent-soft, transparent\), var\(--ss-accent-soft, transparent\)\), var\(--ss-glass-strong,/, 'the accent over the dense glass');
    const notice = block(host, '.story-suite-bar .story-suite-notice');
    assert.equal(block(host, '.story-suite-notice'), '', 'the glass is the bar\'s, not every notice of the page (other modules use the class)');
    assert.ok(notice.includes('var(--ss-glass-strong,'), 'the notice is a glass card');
    assert.ok(notice.includes('var(--ss-accent,'), 'the notice keeps its accent hairline');
});

test('no accent-coloured text on glass: hover, focus and error text use the text colour, the accent is an edge or an icon', () => {
    for (const selector of [
        '.story-suite-bar .menu_button:not(.disabled):not([disabled]):hover',
        '.story-suite-choice:hover, .story-suite-choice:focus-visible',
        '.story-suite-reply-note-reread:hover, .story-suite-reply-note-reread:focus-visible',
        '.story-suite-reply-note-error',
    ]) {
        const rules = block(host, selector);
        assert.ok(rules.length > 0, selector);
        assert.doesNotMatch(rules, /(?<![-\w])color: var\(--ss-accent/, `${selector} sets accent text`);
    }
    assert.doesNotMatch(block(mounts, '.ss-gameview-navitem[aria-current="page"]'), /(?<![-\w])color: var\(--ss-accent/);
});

test('the notes under a reply: one glass row with the icon in a tile, Re-read as a pill, the accent for a missing line', () => {
    const row = block(host, '.story-suite-reply-note');
    assert.ok(row.includes('var(--ss-glass,') && row.includes('var(--ss-radius-m, 14px)'));
    assert.ok(!/dashed/.test(row), 'no dashed rule any more');
    assert.match(block(host, '.story-suite-reply-note > i'), /width: 28px;[\s\S]*height: 28px;/);
    assert.ok(block(host, '.story-suite-reply-note-reread').includes('var(--ss-radius-pill, 999px)'));
    assert.match(host, /\.story-suite-reply-note\[data-kind="missing"\] > i \{ color: var\(--ss-accent,/);
});

test('the Choices strip: folded by default (no open attribute in its markup), a glass summary, one full-width glass option per row', () => {
    const summary = block(host, '.story-suite-choices-summary');
    assert.ok(summary.includes('var(--ss-glass,') && summary.includes('cursor: pointer'));
    assert.ok(block(host, '.story-suite-choices-summary::-webkit-details-marker').includes('display: none'), 'the browser\'s triangle is hidden');
    assert.match(block(host, '.story-suite-choices-fold[open] > .story-suite-choices-summary > .story-suite-choices-chevron'), /rotate\(180deg\)/);
    const rows = block(host, '.story-suite-choices');
    assert.match(rows, /display: grid;/);
    const option = block(host, '.story-suite-choice');
    assert.match(option, /width: 100%;/, 'a full-width button');
    assert.ok(option.includes('var(--ss-glass,') && option.includes('var(--ss-radius-m, 14px)'));
    // Its own colours only from the tokens; the old pill rule is gone.
    assert.ok(!host.includes('.story-suite-choice {\n    flex: 0 1 auto'), 'no inline-flow pill any more');
    assert.match(read('extras-ui.js'), /el\('details', 'story-suite-choices-fold'\)/, 'the strip is a details element');
});

test('the last message\'s cards keep clear of SillyTavern\'s swipe row (the arrows and the counter sit under them)', () => {
    assert.match(block(mounts, '.last_mes .ss-cards'), /margin-bottom: 52px;/);
});

test('the changes card: glass card frame, the header line on the right, rows with icons in tiles', () => {
    const frame = block(mounts, '.ss-card');
    assert.ok(frame.includes('var(--ss-glass, var(--ss-chat-surface))'), 'the frame takes the glass');
    assert.ok(frame.includes('var(--ss-shadow, none)'));
    assert.match(block(mounts, '.ss-card-summary'), /text-align: right;/);
    assert.match(block(mounts, '.ss-card-title'), /font-weight: 700;/);
    const css = changesCardScreen.css;
    assert.match(css, /\.line > i \{[^}]*width: var\(--chg-tile\);[^}]*height: var\(--chg-tile\);[^}]*var\(--ss-tile, transparent\)/);
    assert.match(css, /\.extra \.note \{[^}]*padding-left: calc\(var\(--chg-tile\) \+ var\(--chg-gap\)\)/, 'the indent is the tile and the gap, not a number');
    assert.doesNotMatch(css, /dashed/, 'the card has no dashed rules');
    assert.doesNotMatch(css, /border-left: 3px/, 'the old left accent bar is gone');
});

test('the frames that were opaque: the HUD strip and the dialog mount are glass under Glass only, with fallbacks', () => {
    const hud = block(mounts, '.ss-hud');
    assert.ok(hud.includes('background: var(--ss-sheet-bg, var(--ss-surface));'));
    assert.ok(hud.includes('backdrop-filter: var(--ss-sheet-blur, none);'));
    assert.ok(hud.includes('border-radius: var(--ss-sheet-radius, 0);'));
    assert.ok(hud.includes('border-top: var(--ss-sheet-edge, 1px solid var(--ss-border));'), 'Solid keeps the top hairline');
    const dialog = block(mounts, '.ss-dialog');
    assert.ok(dialog.includes('background: var(--ss-sheet-bg, var(--ss-surface));'));
    assert.ok(dialog.includes('var(--ss-sheet-blur, blur(var(--SmartThemeBlurStrength, 10px)))'), 'Solid keeps the old blur');
    assert.ok(dialog.includes('border-radius: var(--ss-sheet-radius-top, var(--ss-radius) var(--ss-radius) 0 0);'), 'a phone sheet rounds its top corners only under Glass');
    assert.match(mounts, /@media \(min-width: 768px\) \{[\s\S]*?\.ss-dialog \{[\s\S]*?border-radius: var\(--ss-sheet-radius, var\(--ss-radius\)\);/);
    // The backdrop keeps its own dim and light blur (the glass sits over the blurred page).
    assert.match(block(mounts, '.ss-dialog-backdrop'), /backdrop-filter: blur\(3px\);/);
});

test('the Glass-only shape tokens are set under Glass, not under Solid or Follow SillyTavern, and reset under reduced transparency', () => {
    const glassSheet = themeCss({ scheme: 'dark', panel: 'glass' });
    for (const name of ['--ss-sheet-radius', '--ss-sheet-radius-top', '--ss-sheet-edge', '--ss-sheet-shadow', '--ss-sheet-bg']) assert.ok(glassSheet.includes(`${name}:`), name);
    for (const panel of ['solid', 'sillytavern']) assert.ok(!themeCss({ panel }).includes('--ss-sheet-'), panel);
    const reduced = glassSheet.slice(glassSheet.indexOf('@media (prefers-reduced-transparency: reduce)'));
    for (const name of ['--ss-sheet-radius', '--ss-sheet-radius-top', '--ss-sheet-edge', '--ss-sheet-shadow']) assert.ok(reduced.includes(`${name}: initial;`), `${name} resets`);
});

test('the game view\'s navigation takes the navbar\'s look: a glass pill on a phone, a glass column on a wide screen', () => {
    const nav = block(mounts, '.ss-gameview-nav');
    assert.ok(nav.includes('var(--ss-glass-strong, transparent)') && nav.includes('border-radius: var(--ss-radius-xxl, 26px);'));
    assert.match(block(mounts, '.ss-gameview-navitem'), /min-height: 64px;/);
    assert.match(block(mounts, '.ss-gameview-navitem[aria-current="page"]'), /color: var\(--ss-text\);/, 'the label reads in the text colour');
    assert.match(block(mounts, '.ss-gameview-navitem[aria-current="page"] > i'), /color: var\(--ss-accent\);/);
    // Wide: the row keeps its hairline, drops the pill's radius, and sits 12px under the header card (the tab row's air).
    const wide = block(mounts, '.ss-gameview-nav', '@media (min-width: 768px)');
    assert.match(wide, /margin: var\(--ss-space-3, 12px\) 0 0;/);
    assert.match(wide, /border-radius: 0;/);
});

test('the story panel: the tab bar is the ss.tabs block (no tablist rules left), its head as Panel.dc.html, the scroll fade on the block\'s list', () => {
    assert.doesNotMatch(host, /\.story-suite-tab\.active|\.story-suite-tabs \{ display: flex/);
    assert.match(block(host, '.story-suite-sheet-head'), /padding: 12px 12px 0;/);
    assert.match(block(host, '.story-suite-sheet-head .story-suite-sheet-close'), /width: 40px;/);
    assert.match(mounts, /:is\(\.ss-gameview-nav, \.ss-tabs-list\)\[data-ss-axis="x"\]\[data-ss-more="end"\]/);
});
