// The game view's layout and the section label (UI stage 5a): the header sits between the bar and the body at every width,
// the wide layout runs the screens' tabs as a row under the header (not a side column), the phone keeps the bottom bar, and
// the section label is a label with a hairline in the border token, every rule under :where() at one class.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../../src/v2/view/${path}`, import.meta.url), 'utf8');
const mounts = read('mounts.css');
const glass = read('glass.css');

// The declarations of the first rule whose selector is `selector` (the text before its `{`, with the rest of the line).
const rules = (css, selector) => {
    const at = css.indexOf(selector);
    if (at < 0) return [''];
    const open = css.indexOf('{', at);
    return [css.slice(open + 1, css.indexOf('}', open))];
};

test('the header sits between the title bar and the body (its slot is in the mount, the order is in the CSS)', () => {
    assert.match(mounts, /\.ss-gameview-main \{[^}]*display: contents;/);
    assert.match(mounts, /\.ss-gameview-hero \{[^}]*flex: none;/);
    assert.match(mounts, /\.ss-gameview-hero\[hidden\] \{\s*display: none;/);
});

test('wide screens: the tab row under the header, the body below, and no side column', () => {
    const wide = mounts.slice(mounts.indexOf('@media (min-width: 768px) {', mounts.indexOf('.ss-gameview-body {')));
    assert.match(wide, /\.ss-gameview-nav \{[^}]*flex-direction: row;[^}]*overflow-x: auto;/);
    assert.doesNotMatch(wide.slice(0, wide.indexOf('.ss-gameview-navitem {')), /width: 200px/);
    assert.match(wide, /\.ss-gameview-nav \{[^}]*order: 2;/);
    assert.match(wide, /\.ss-gameview-body \{\s*order: 3;/);
    assert.match(wide, /\.ss-gameview-hero \{\s*order: 1;/);
    // option A: the current tab is a raised pill (accent border, the shadow), not an underline
    assert.match(wide, /\.ss-gameview-navitem\[aria-current="page"\] \{[^}]*border-color: var\(--ss-accent\);[^}]*box-shadow: var\(--ss-shadow/);
    assert.doesNotMatch(mounts, /inset 0 -2px 0/, 'no underline on the tabs');
    assert.doesNotMatch(mounts, /\.ss-gameview \{\s*flex-direction: row;/, 'the game view is a column at every width');
});

test('the phone keeps the bottom bar: the nav is the last item, a floating pill', () => {
    const phoneNav = rules(mounts, '.ss-gameview-nav {')[0];
    assert.match(phoneNav, /margin: 8px 12px/);
    assert.match(phoneNav, /border-radius: var\(--ss-radius-xxl, 26px\)/);
});

test('the section label: a label, a hairline in the rule token, one class of weight under :where()', () => {
    const label = rules(glass, ') .ss-section-label {')[0];
    assert.match(label, /text-transform: uppercase;/);
    assert.match(label, /letter-spacing: 1\.4px;/);
    assert.match(label, /color: var\(--ss-muted\);/);
    const line = rules(glass, ') .ss-section-label::after {')[0];
    assert.match(line, /height: 1px;/);
    assert.match(line, /background: var\(--ss-rule, var\(--ss-border\)\);/, 'the rule token, the border as fallback');
    assert.match(line, /flex: 1 1 auto;/, 'the hairline fills the rest of the row');
    for (const selector of ['.ss-section-label {', '.ss-section-label::after']) {
        const at = glass.indexOf(selector);
        const head = glass.slice(glass.lastIndexOf('\n', at - 1) + 1, at);
        assert.match(head, /^:where\(/, `${selector} is under :where() (no specificity beyond one class)`);
    }
});

test('the phone game view has an opaque floor under the tint, so blur off hides the story behind the cards', () => {
    const phone = mounts.slice(mounts.indexOf('@media (max-width: 759.98px) {', mounts.indexOf('.ss-gameview {')));
    // Glass only: the phone's floor and layers are tokens the theme sets for Glass; Solid and Follow SillyTavern have none
    assert.match(phone, /\.ss-gameview \{\s*background-image: var\(--ss-gameview-phone-layers, var\(--ss-sheet-layers, none\)\);/);
    assert.match(phone, /--ss-gameview-phone-floor, var\(--ss-sheet-bg, rgb\(from var\(--ss-surface\) r g b \/ 1\)\)/);
    const theme = read('theme.js');
    assert.match(theme, /\['--ss-sheet-floor', 'rgb\(from var\(--ss-glass-strong\) r g b \/ 1\)'\]/, 'the floor is the Glass colour with no alpha');
    assert.match(theme, /\['--ss-gameview-phone-layers'/);
});

test('the phone header shows the scene as one ellipsised line under the name (the corner), not hidden', () => {
    assert.doesNotMatch(glass, /\.ss-hero-compact \.ss-hero-corner,/, 'the corner is no longer hidden on the compact hero');
    assert.match(glass, /\.ss-hero-compact \.ss-hero-corner \{[^}]*display: flex;[^}]*overflow: hidden;/);
    assert.match(glass, /\.ss-hero-compact \.ss-hero-corner-text \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    assert.match(glass, /"portrait who status" "portrait corner corner" "vitals vitals vitals"/);
});

test('the hero pill never passes its card: it wraps an unbroken word (min-width 0, max-width 100%, overflow-wrap anywhere)', () => {
    const at = glass.indexOf('.ss-hero-pill {');
    assert.ok(at > 0);
    const body = glass.slice(at, glass.indexOf('}', at));
    assert.match(body, /min-width: 0;/);
    assert.match(body, /max-width: 100%;/);
    assert.match(body, /overflow-wrap: anywhere;/);
});
