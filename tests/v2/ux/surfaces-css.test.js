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
// The declarations of the first rule whose selector is exactly `selector` (e.g. '.x {'): the text between its braces.
function declared(css, selector) {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = body.indexOf(selector);
    if (at < 0) return '';
    return body.slice(at + selector.length, body.indexOf('}', at));
}

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
    assert.doesNotMatch(declared(glass, '.ss-screenbar-item[aria-current="page"] {'), /(?<![-\w])color: var\(--ss-accent[,)]/, 'the current slot takes the accent text token, not the accent');
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
    assert.match(css, /\.tile \.ico \{[^}]*width: 34px;[^}]*height: 34px;[^}]*var\(--ss-tile\)/, 'the icon sits in a 34px tile');
    assert.match(css, /@container \(min-width: 560px\) \{ \.tiles \{ grid-template-columns: repeat\(3/, 'three columns from 560px');
    assert.match(css, /@container \(min-width: 900px\) \{ \.tiles \{ grid-template-columns: repeat\(4/, 'four columns from 900px');
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

test('the screen bar takes the navbar\'s look: a glass pill on a phone, a glass row on a wide screen, the tokens only', () => {
    const pill = declared(glass, '.ss-screenbar {');
    assert.ok(pill.includes('var(--ss-glass-strong)') && pill.includes('border-radius: var(--ss-radius-xxl);'));
    assert.match(declared(glass, '.ss-screenbar-item {'), /min-height: 44px;/, 'a tap target of 44px');
    const label = declared(glass, '.ss-screenbar-label {');
    assert.ok(/font-size: 11px;/.test(label) && /font-weight: 700;/.test(label) && /white-space: nowrap;/.test(label) && /text-overflow: ellipsis;/.test(label), 'the label: 11px, 700, one line, ellipsis');
    assert.match(declared(glass, '.ss-screenbar-item[aria-current="page"] {'), /color: var\(--ss-accent-text\);/, 'the label reads in the accent text token');
    assert.match(declared(glass, '.ss-screenbar-tile[aria-current="page"] {'), /border-color: var\(--ss-accent\);[^}]*background: var\(--ss-accent-soft\);/, 'the current tile: accent ring, accent-soft fill');
    // Wide: the row is 68px, under the header card (the tab row's air), its pill-less slots spread evenly (the glass rule above).
    const wide = mounts.slice(mounts.indexOf('@media (min-width: 760px) {', mounts.indexOf('.ss-gameview-body {')));
    assert.match(wide, /\.ss-gameview-nav \{[^}]*margin: var\(--ss-space-3, 12px\) 24px 0;/);
});

test('the story panel: the tabs are the screen bar at its foot (no strip left), its head as Panel.dc.html, the sheet full height from 760px', () => {
    assert.doesNotMatch(host, /\.story-suite-tab\.active|\.story-suite-tabs \{ display: flex/);
    assert.match(block(host, '.story-suite-sheet-head'), /padding: 12px 12px 0;/);
    assert.match(block(host, '.story-suite-sheet-head .story-suite-sheet-close'), /width: 40px;/);
    assert.match(declared(host, '.story-suite-sheet-bar {'), /position: absolute;[^}]*bottom: calc\(14px/, 'the bar floats at the foot');
    assert.match(declared(host, '.story-suite-sheet-body::after {'), /height: calc\(72px \+ 14px \+ 12px/, 'the body ends with room for the bar');
    assert.match(host, /@media \(min-width: 760px\) \{\s*\.story-suite-sheet \{[^}]*height: calc\(100dvh - var\(--topBarBlockSize, 40px\)\);/, 'a side sheet to the window height');
    assert.match(mounts, /\.ss-tabs-list\[data-ss-axis="x"\]\[data-ss-more="end"\]/, 'the sub-tab lists keep their fade');
});

test('the bar\'s buttons are at least 40px tall on a phone (44 preferred); desktop keeps its 36px pills', () => {
    const host = readFileSync(new URL('../../../src/v2/view/host.css', import.meta.url), 'utf8');
    const phone = host.slice(host.indexOf('@media (max-width: 560px)'));
    const at = phone.indexOf('.story-suite-bar .menu_button');
    assert.ok(at > 0, 'a phone rule for the bar buttons');
    const height = Number(/min-height:\s*(\d+)px/.exec(phone.slice(at, phone.indexOf('}', at)))?.[1]);
    assert.ok(height >= 40, `min-height ${height}px on a phone`);
    assert.match(host, /\.story-suite-bar \.menu_button \{[^}]*min-height: 36px/, 'desktop unchanged');
});

test('the HUD strip keeps 8px of air above SillyTavern\'s message box (#send_form) at every width', () => {
    const mounts = read('view/mounts.css');
    const rule = /\.ss-hud \{([^}]*)\}/.exec(mounts)?.[1] ?? '';
    assert.match(rule, /margin: 0 0 8px;/, 'a bottom margin of 8px on the strip');
});
