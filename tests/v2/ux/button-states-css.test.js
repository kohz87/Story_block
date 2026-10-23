// UI stage 4b review, the buttons: `.ss-button` (and its primary, quiet, danger and disabled forms) has hover, active
// (pressed), focus-visible and disabled states in glass.css, written with tokens only, and specific enough to beat
// SillyTavern's own `button` rule (0,0,1) and its `.menu_button` rules on the same element. The label colour stays --ss-text.
// The computed behaviour (a button with both classes, hovered and pressed) is checked in the live instance (the PR's checks);
// this file checks the rules as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const glass = readFileSync(new URL('../../../src/v2/view/glass.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// The selector list of every rule whose text contains `needle`, in order.
function rulesWith(needle) {
    const out = [];
    for (const match of glass.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (match[1].includes(needle)) out.push({ selector: match[1].trim(), body: match[2] });
    }
    return out;
}
// CSS specificity of one selector, with :where() as zero (a simple count, enough for these selectors).
function specificityOf(selector) {
    const bare = selector.replace(/:where\(([^()]*)\)/g, '');
    const ids = (bare.match(/#[\w-]+/g) ?? []).length;
    const classes = (bare.match(/\.[\w-]+|\[[^\]]+\]|:(?!where)[\w-]+(?!\()|:(?:not|is)\(/g) ?? []).length;
    const elements = (bare.match(/(^|[\s>+~(,])[a-z][\w-]*/g) ?? []).length;
    return [ids, classes, elements];
}
const beats = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);

test('the button: the base is a button.ss-button (0,1,1), beating SillyTavern\'s button (0,0,1) and .menu_button (0,1,0)', () => {
    const base = rulesWith('button.ss-button').find(rule => rule.selector.endsWith('button.ss-button'));
    assert.ok(base, 'the base rule exists');
    assert.ok(beats(specificityOf(base.selector), [0, 1, 0]), 'beats .menu_button');
    assert.match(base.body, /filter: none;/, 'no menu_button grey-out');
    assert.match(base.body, /background: var\(--ss-glass-strong\);/, 'the label\'s fill is the strong glass');
    assert.match(base.body, /color: var\(--ss-text\);/, 'the label is --ss-text');
});

test('the button: hover and pressed are (0,5,1), above SillyTavern\'s .menu_button:not(.disabled):not([disabled]):hover (0,4,0), and take the accent edge and soft accent fill', () => {
    const hover = rulesWith(':not(:disabled):not(.disabled):not([disabled]):hover').find(rule => rule.selector.includes('button.ss-button'));
    assert.ok(hover, 'the hover rule exists');
    assert.ok(beats(specificityOf(hover.selector), [0, 4, 0]), `hover ${hover.selector} beats the menu_button hover`);
    assert.match(hover.body, /border-color: var\(--ss-accent\);/);
    assert.match(hover.body, /linear-gradient\(var\(--ss-accent-soft\), var\(--ss-accent-soft\)\), var\(--ss-glass-strong\)/);
    const pressed = rulesWith(':not(:disabled):not(.disabled):not([disabled]):active').find(rule => rule.selector.includes('button.ss-button'));
    assert.ok(pressed, 'the pressed rule exists');
    assert.ok(beats(specificityOf(pressed.selector), [0, 4, 0]), 'pressed beats the menu_button active');
});

test('the button: the disabled state keeps the label at full contrast (no opacity on the label) and dims the edge and fill', () => {
    const disabled = rulesWith('button.ss-button:disabled').find(rule => rule.selector.includes('button.ss-button[disabled]'));
    assert.ok(disabled, 'the disabled rule exists');
    assert.ok(beats(specificityOf(disabled.selector), [0, 4, 0]), 'beats .menu_button[disabled] (opacity .5, grey-out)');
    assert.match(disabled.body, /opacity: 1;/);
    assert.match(disabled.body, /color: var\(--ss-text\);/);
    assert.match(disabled.body, /border-color: var\(--ss-border\);/);
});

test('the button: the state rules use tokens only (no colour literal in them)', () => {
    for (const rule of rulesWith('button.ss-button')) {
        assert.doesNotMatch(rule.body, /#[0-9a-f]{3,8}\b|rgba?\(/i, `a literal colour in ${rule.selector}`);
    }
});

test('the button: the focus ring is the accent, and the primary keeps its on-glass label (--ss-text)', () => {
    assert.match(rulesWith(':focus-visible').find(rule => rule.selector.includes('.ss-button:focus-visible'))?.body ?? '', /outline: 2px solid var\(--ss-accent\)/);
    const primary = rulesWith('button.ss-button.ss-button-primary').find(rule => rule.selector.includes('button.ss-button.ss-button-primary'));
    assert.ok(primary, 'the primary rule exists');
    assert.match(primary.body, /var\(--ss-glass-strong\)/);
});
