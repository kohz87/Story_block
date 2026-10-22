// The settings window's stylesheet (src/v2/view/settings.css, UI stage step 3a) and the legacy surfaces' glass
// (host.css `.story-suite-sheet`, mounts.css `.ss-gameview`): every rule under Story Suite's roots at the weight a
// screen's own CSS can beat, colours and sizes from the theme tokens, the window and its page laid out for a phone and a
// wide window, and the legacy surfaces glass under Glass but opaque as before without the glass tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT_SELECTOR } from '../../../src/v2/view/theme.js';

const read = path => readFileSync(new URL(`../../../src/v2/${path}`, import.meta.url), 'utf8');
const css = read('view/settings.css');

function splitTop(text) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') depth -= 1;
        else if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out.map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function rules(source, at = []) {
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    let i = 0;
    while (i < body.length) {
        const open = body.indexOf('{', i);
        if (open < 0) break;
        const head = body.slice(i, open).trim();
        let depth = 1;
        let j = open + 1;
        while (j < body.length && depth) {
            if (body[j] === '{') depth += 1;
            else if (body[j] === '}') depth -= 1;
            j += 1;
        }
        const inner = body.slice(open + 1, j - 1);
        if (head.startsWith('@')) out.push(...rules(inner, [...at, head]));
        else out.push({ selectors: splitTop(head), block: inner, at });
        i = j;
    }
    return out;
}
function weight(selector) {
    let text = selector;
    while (/:where\(/.test(text)) text = text.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
    const ids = (text.match(/#[\w-]+/g) ?? []).length;
    const classes = (text.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length;
    return ids * 100 + classes * 10;
}
const all = rules(css);
const block = (selector, at = []) => all.filter(rule => rule.selectors.includes(`${ROOT_SELECTOR} ${selector}`) && at.every((a, n) => rule.at[n] === a) && rule.at.length === at.length).map(rule => rule.block).join('\n');

test('host.css loads settings.css after glass.css', () => {
    assert.match(read('view/host.css'), /@import url\('\.\/glass\.css'\);\s*@import url\('\.\/settings\.css'\);/);
});

test('every rule is scoped to Story Suite\'s roots; the window weighs two classes at most, the old folds\' rules a few more to beat host.css and SillyTavern\'s own', () => {
    assert.ok(all.length >= 60);
    for (const rule of all) for (const selector of rule.selectors) {
        assert.ok(selector.startsWith(ROOT_SELECTOR), `not scoped: ${selector}`);
        assert.ok(weight(selector) <= 40, `too heavy (${weight(selector)}): ${selector}`);
        // Only what restyles the old folds and rows (they start with `.ss-settings`) may weigh more than two classes.
        if (!selector.slice(ROOT_SELECTOR.length).trim().startsWith('.ss-settings ')) assert.ok(weight(selector) <= 30, `too heavy for a block of its own (${weight(selector)}): ${selector}`);
    }
    // The window and its parts weigh one or two classes, so a screen's own CSS can still restyle them.
    for (const name of ['.ss-settings', '.ss-settings-head', '.ss-settings-rail', '.ss-settings-content', '.ss-settings-page']) {
        assert.ok(all.some(rule => rule.selectors.includes(`${ROOT_SELECTOR} ${name}`)), `${name} has a rule`);
        assert.equal(weight(`${ROOT_SELECTOR} ${name}`), 10);
    }
});

test('colours, radii, spacing and the font come from the theme tokens; no colour of its own', () => {
    // No colour literal at all: not a hex, rgb(), hsl() or a named colour in a value.
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    const frame = block('.ss-settings');
    for (const part of ['var(--ss-glass)', 'backdrop-filter: var(--ss-blur)', '-webkit-backdrop-filter: var(--ss-blur)', 'var(--ss-text)', 'var(--ss-font)']) assert.ok(frame.includes(part), part);
    const wide = block('.ss-settings', ['@media (min-width: 760px)']);
    for (const part of ['var(--ss-border)', 'var(--ss-radius-xxl)', 'var(--ss-shadow)', 'max-width: 1120px', 'max-height: 780px']) assert.ok(wide.includes(part), part);
    assert.ok(block('.ss-settings-title').includes('font-weight: 800'));
    assert.ok(block('.ss-settings-search', ['@media (min-width: 760px)']).includes('width: min(100%, 420px)'));
});

test('a phone: the window fills the screen, the rail is a row that scrolls sideways above the page, nothing is wider than the screen', () => {
    const frame = block('.ss-settings');
    assert.match(frame, /width: 100%;/);
    assert.match(frame, /height: 100%;/);
    assert.match(frame, /overflow: hidden;/);
    assert.match(frame, /safe-area-inset-top/);
    assert.doesNotMatch(frame, /border-radius/, 'square on a phone');
    assert.match(block('.ss-settings-main'), /flex-direction: column;/);
    assert.match(block('.ss-settings-content'), /overflow-x: hidden;/);
    assert.match(block('.ss-settings-content'), /overflow-y: auto;/);
    assert.match(block('.ss-settings-content'), /min-width: 0;/);
    assert.match(block('.ss-settings-content'), /safe-area-inset-bottom/);
    // The rail's list is the tabs block's own sideways-scrolling row; only the wide layout makes it a column.
    assert.doesNotMatch(block('.ss-settings-rail .ss-tabs-list'), /flex-direction|overflow/);
    const wideList = block('.ss-settings-rail .ss-tabs-list', ['@media (min-width: 760px)']);
    assert.match(wideList, /flex-direction: column;/);
    assert.match(block('.ss-settings-main', ['@media (min-width: 760px)']), /grid-template-columns: 250px minmax\(0, 1fr\);/);
    // Targets of at least 40px: the rail's items, the close button and the search box.
    assert.match(block('.ss-settings-close'), /width: 40px;\s*height: 40px;/);
    assert.match(block('.ss-settings-rail .ss-tabs-item', ['@media (min-width: 760px)']), /min-height: 44px;/);
});

test('the rail\'s items outweigh the tabs block\'s own only where they must: the chosen one keeps its accent', () => {
    // `:not([aria-current="page"])` keeps the quiet look off the chosen item, whose rule (glass.css) stays in force.
    const quiet = all.find(rule => rule.selectors.some(s => s.includes('.ss-tabs-item:not([aria-current="page"])')));
    assert.ok(quiet);
    assert.match(quiet.block, /border-color: transparent;/);
    assert.equal(all.filter(rule => /aria-current/.test(rule.selectors.join()) && !/:not\(\[aria-current/.test(rule.selectors.join())).length, 0);
});

test('the folds and rows the sections still draw take the look: a tile card, token borders, a switch in place of the checkbox, features as tiles', () => {
    const card = block('.ss-settings .ss-settings-pane > .story-suite-fold');
    assert.match(card, /border: 1px solid var\(--ss-border\);/);
    assert.match(card, /background: var\(--ss-tile\);/);
    assert.match(card, /border-radius: var\(--ss-radius-l\);/);
    const sw = block('.ss-settings .story-suite-row > input[type="checkbox"]');
    for (const part of ['appearance: none', 'width: 48px', 'height: 28px', 'var(--ss-off)', 'filter: none', 'overflow: visible']) assert.ok(sw.includes(part), part);
    assert.match(block('.ss-settings .story-suite-row > input[type="checkbox"]:checked'), /var\(--ss-accent\)/);
    assert.match(block('.ss-settings .story-suite-row > input[type="checkbox"]::before'), /var\(--ss-knob\)/);
    assert.match(block('.ss-settings .story-suite-row > input[type="checkbox"]:checked::before'), /translateX\(20px\)/);
    assert.match(block('.ss-settings .story-suite-feature-group .story-suite-feature'), /background: var\(--ss-tile\);/);
    // The old Features filter is covered by the window's search.
    assert.match(block('.ss-settings .story-suite-feature-filter'), /display: none;/);
    // No transitions when the system asks for less motion.
    assert.ok(all.some(rule => rule.at[0] === '@media (prefers-reduced-motion: reduce)' && /transition: none;/.test(rule.block)));
});

// ---- the legacy surfaces

test('the side sheet is glass when the theme sets the glass tokens, the tint as before when it does not', () => {
    const host = read('view/host.css');
    const sheet = host.slice(host.indexOf('.story-suite-sheet {'), host.indexOf('}', host.indexOf('.story-suite-sheet {')));
    assert.match(sheet, /background: var\(--ss-sheet-bg, var\(--story-suite-bg\)\);/, 'the tint is the fallback');
    assert.match(sheet, /backdrop-filter: var\(--ss-sheet-blur, blur\(var\(--SmartThemeBlurStrength, 8px\)\)\);/);
    assert.match(sheet, /-webkit-backdrop-filter: var\(--ss-sheet-blur,/);
});

test('the game view is glass when the theme sets the glass tokens, opaque as before when it does not', () => {
    const mounts = read('view/mounts.css');
    const at = mounts.indexOf('.ss-gameview {');
    const base = mounts.slice(at, mounts.indexOf('}', at));
    assert.match(base, /background-color: var\(--ss-sheet-bg, var\(--ss-surface\)\);/);
    assert.match(base, /background-image: var\(--ss-sheet-layers, linear-gradient\(var\(--ss-surface\), var\(--ss-surface\)\), linear-gradient\(var\(--ss-surface\), var\(--ss-surface\)\)\);/);
    assert.match(base, /backdrop-filter: var\(--ss-sheet-blur, none\);/);
    const supports = mounts.slice(mounts.indexOf('@supports (color: rgb(from red r g b))'), mounts.indexOf('.ss-gameview-main'));
    assert.match(supports, /background-color: var\(--ss-sheet-bg, rgb\(from var\(--ss-surface\) r g b \/ 1\)\);/);
    assert.match(supports, /background-image: var\(--ss-sheet-layers, none\);/);
});

test('the layer around the window paints a see-through scrim and no filter, so the page reaches the window\'s glass', () => {
    const host = read('view/host.css');
    const at = host.indexOf('.story-suite-overlay {');
    const layer = host.slice(at, host.indexOf('}', at));
    assert.match(layer, /background: color-mix\(in srgb, var\(--ss-scrim, rgba\(0, 0, 0, 0\.55\)\) \d+%, transparent\);/);
    assert.doesNotMatch(layer, /filter|--story-suite-bg|--ss-surface/);
    assert.match(layer, /height: 100dvh;/);
});
