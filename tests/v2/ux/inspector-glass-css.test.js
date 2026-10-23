// UI stage 4b, in the stylesheets: the inspector's buttons take the glass pill with its hover and focus fill over the dense
// glass and keep the text colour; its labels read in the text colour (no accent text on glass); monospace only on raw values
// (paths, state values, operations). Scoped rules: the inspector's CSS is the screen's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectorScreen } from '../../../src/v2/screens/inspector.js';

// The declarations of every rule whose selector list is `selector` (as a whole) or has it as one of its entries; a
// `:where(...)` wrapper is read through.
const headOf = text => {
    let head = text.trim().replace(/\s+/g, ' ');
    if (head.startsWith(':where(') && head.endsWith(')')) head = head.slice(7, -1);
    return head;
};
function blocks(css, selector) {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const whole = headOf(match[1]);
        const entries = whole.split(',').map(part => part.trim());
        if (whole === selector || entries.includes(selector)) out.push(match[2]);
    }
    return out.join('\n');
}
const inspector = inspectorScreen.css;

test('the inspector\'s button: the glass pill; hover and focus lay the accent over the dense glass, the text stays the text colour', () => {
    const rest = blocks(inspector, '.sb-insp-btn');
    assert.match(rest, /border-radius: var\(--ss-radius-pill, 999px\)/);
    assert.match(rest, /background: var\(--ss-tile, transparent\)/);
    assert.match(rest, /color: var\(--ss-text, inherit\)/);
    const hover = blocks(inspector, '.sb-insp-btn:hover:not(:disabled)') + blocks(inspector, '.sb-insp-btn:focus-visible:not(:disabled)');
    assert.match(hover, /border-color: var\(--ss-accent/);
    assert.match(hover, /linear-gradient\(var\(--ss-accent-soft/, 'the accent soft fill over the glass');
    assert.match(hover, /var\(--ss-glass-strong/);
    assert.doesNotMatch(hover, /(?<![-\w])color: var\(--ss-accent/, 'no accent text on hover');
    assert.match(blocks(inspector, '.sb-insp-btn:focus-visible'), /outline: 2px solid var\(--ss-accent/);
    assert.match(blocks(inspector, '.sb-insp-btn:active:not(:disabled)'), /linear-gradient\(var\(--ss-accent-soft/);
    assert.match(blocks(inspector, '.sb-insp-btn:disabled'), /opacity: 0\.45/);
});

test('the inspector: its labels and keys read in the text colour; the accent is only a tile tint or a highlight', () => {
    assert.match(blocks(inspector, '.sb-insp-key'), /color: var\(--ss-text, inherit\)/);
    assert.doesNotMatch(blocks(inspector, '.sb-insp-key'), /accent/);
    assert.doesNotMatch(blocks(inspector, '.sb-insp-path'), /accent/);
    assert.doesNotMatch(blocks(inspector, '.sb-insp-str'), /--ss-good/, 'no green text for strings');
    assert.match(inspector, /\.sb-insp-change \.sb-insp-mark \{ background: color-mix\(in srgb, var\(--ss-accent/);
});

test('the inspector: monospace only on the raw values (paths, state values, operations); the words stay in the look\'s font', () => {
    assert.match(blocks(inspector, '.sb-insp-path'), /font-family: var\(--monoFontFamily, monospace\)/);
    assert.match(blocks(inspector, '.sb-insp-str'), /font-family: var\(--monoFontFamily, monospace\)/);
    assert.match(blocks(inspector, '.sb-insp-num'), /font-family: var\(--monoFontFamily, monospace\)/);
    assert.doesNotMatch(blocks(inspector, '.sb-insp-key'), /monospace/, 'a key is a label');
    assert.doesNotMatch(blocks(inspector, '.sb-insp-head'), /monospace/);
    assert.doesNotMatch(blocks(inspector, '.sb-insp-card-title'), /monospace/);
});

test('the inspector: a text box and a select are the form engine\'s controls, not SillyTavern\'s text_pole', () => {
    const source = readFileSync(new URL('../../../src/v2/screens/inspector.js', import.meta.url), 'utf8');
    assert.match(source, /'ss-input ss-select sb-insp-pick'/);
    assert.match(source, /'ss-input ss-text sb-insp-search'/);
    assert.doesNotMatch(source, /text_pole/);
});

test('the inspector: the cards are a grid with a gap (the heading to the first card too); long unbroken names wrap instead of widening the page', () => {
    const css = inspectorScreen.css;
    assert.match(blocks(css, '.sb-insp-body'), /gap: var\(--ss-space-3, 12px\)/, 'the body\'s grid gap');
    assert.match(blocks(css, '.sb-insp-body'), /grid-template-columns: minmax\(0, 1fr\)/, 'one column that may shrink');
    assert.match(blocks(css, '.sb-insp'), /grid-template-columns: minmax\(0, 1fr\)/, 'the screen\'s own column may shrink');
    assert.match(blocks(css, '.sb-insp-head'), /overflow-wrap: anywhere/, 'a long reply name in the heading');
    assert.match(blocks(css, '.sb-insp-tree summary'), /overflow-wrap: anywhere/, 'a long key in a branch');
});

test('the inspector: the muted text is the look\'s, on the glass (not SillyTavern\'s emphasis colour)', () => {
    assert.match(blocks(inspectorScreen.css, '.sb-insp .muted'), /color: var\(--ss-muted, var\(--sb-em, inherit\)\)/);
});
