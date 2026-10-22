// UI stage 4b, in the stylesheets: the map (view/widgets/styles.js) reads the look's tokens for its stage, controls, pins and
// chips, with the widget's own names as fallbacks; its hover, focus and active states are written, with the accent as a fill
// over the glass and no accent text. Its rules are under :where() with no specificity, as the other widgets' are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { widgetCss } from '../../../src/v2/view/widgets/styles.js';

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
const map = widgetCss;

test('the map: the stage is a glass panel on the look\'s tokens, with the widget\'s own names as fallbacks', () => {
    const stage = blocks(map, '.ss-w-map-stage');
    assert.match(stage, /background: var\(--ss-w-map-bg, var\(--ss-glass, var\(--ss-w-bg\)\)\)/);
    assert.match(stage, /border-radius: var\(--ss-radius-xl, var\(--ss-w-radius\)\)/);
    assert.match(stage, /backdrop-filter: var\(--ss-blur, none\)/);
});

test('the map: the zoom and layer controls are glass pills; hover, focus and the active layer take the accent fill over the glass', () => {
    const rest = blocks(map, '.ss-w-map-btn') + blocks(map, '.ss-w-map-layer');
    assert.match(rest, /border-radius: var\(--ss-radius-pill, 999px\)/);
    assert.match(rest, /color: var\(--ss-text, var\(--ss-w-fg\)\)/);
    const hover = blocks(map, '.ss-w-map-btn:hover, .ss-w-map-layer:hover, .ss-w-map-btn:focus-visible, .ss-w-map-layer:focus-visible, .ss-w-map-btn:active, .ss-w-map-layer:active');
    assert.match(hover, /linear-gradient\(var\(--ss-accent-soft/);
    assert.match(hover, /var\(--ss-glass-strong/);
    assert.doesNotMatch(hover, /(?<![-\w])color: var\(--ss-accent/, 'no accent text on hover');
    assert.match(blocks(map, '.ss-w-map-layer.ss-w-active'), /linear-gradient\(var\(--ss-accent-soft/);
    assert.match(blocks(map, '.ss-w-map-btn:focus-visible, .ss-w-map-layer:focus-visible, .ss-w-map-node:focus-visible, .ss-w-map-stage:focus-visible'), /outline: 2px solid var\(--ss-accent/);
});

test('the map: the place pins and name chips read the glass; the current place keeps its accent ring; unknown places read muted', () => {
    assert.match(blocks(map, '.ss-w-map-node .ss-w-map-dot, .ss-w-map-node .ss-w-map-icon'), /background: var\(--ss-glass-strong, var\(--ss-w-bg\)\)/);
    assert.match(blocks(map, '.ss-w-map-name'), /color: var\(--ss-text, var\(--ss-w-fg\)\)/);
    assert.match(blocks(map, '.ss-w-map-node.ss-w-current .ss-w-map-dot, .ss-w-map-node.ss-w-current .ss-w-map-icon'), /border-color: var\(--ss-accent/);
    assert.match(blocks(map, '.ss-w-map-node.ss-w-unknown'), /color: var\(--ss-muted, var\(--ss-w-muted\)\)/);
});

test('the map: every rule is under :where() (no specificity), so a screen\'s own CSS still wins', () => {
    for (const match of map.matchAll(/^([^{}\n/*]+)\{/gm)) {
        const head = match[1].trim();
        if (!head.includes('ss-w-map')) continue;
        assert.ok(head.startsWith(':where('), `not under :where(): ${head}`);
    }
});
