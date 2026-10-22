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

// The map's rules are under :where() (no specificity), so a screen's own CSS still wins, except the three type rules that
// must beat SillyTavern's own "button { font-family; font-size; color }" (specificity 0,0,1): listed here, and no others.
const CLASS_LEVEL = ['.ss-w-map-btn, .ss-w-map-layer', '.ss-w-map-zoom .ss-w-map-btn', 'button.ss-w-map-node'];
const headsOf = css => [...css.matchAll(/^([^{}\n/*]+)\{/gm)].map(match => match[1].trim()).filter(head => head.includes('ss-w-map'));

test('the map: every rule is under :where() (no specificity), except the three class-level type rules', () => {
    const heads = headsOf(map);
    const classLevel = heads.filter(head => !head.startsWith(':where('));
    assert.deepEqual(classLevel, CLASS_LEVEL, 'the class-level rules are exactly the documented three');
});

// The specificity of one selector (a class or attribute or pseudo-class is 0,1,0; an element 0,0,1; :where() adds nothing).
const specificityOf = selector => {
    const bare = selector.replace(/:where\(([^()]*)\)/g, '');
    const ids = (bare.match(/#[\w-]+/g) ?? []).length;
    const classes = (bare.match(/\.[\w-]+|\[[^\]]+\]|:(?!where)[\w-]+/g) ?? []).length;
    const elements = (bare.match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
    return [ids, classes, elements];
};
const beats = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

test('the map: the colour of a control beats SillyTavern\'s button rule (0,0,1), and the controls keep the look\'s text colour', () => {
    const body = map.replace(/\/\*[\s\S]*?\*\//g, '');
    const colourRules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => /(^|;|\s)color:/.test(match[2]) && match[1].includes('ss-w-map-btn'));
    assert.ok(colourRules.length >= 1, 'the controls have a colour rule');
    for (const match of colourRules) {
        for (const selector of match[1].split(',').map(part => part.trim()).filter(part => part.includes('ss-w-map-btn'))) {
            assert.ok(beats(specificityOf(selector), [0, 0, 1]), `${selector} must beat the button rule`);
            assert.match(match[2], /color: var\(--ss-text, var\(--ss-w-fg\)\)/, 'the look\'s text colour');
        }
    }
    assert.match(blocks(map, '.ss-w-map-btn'), /font-weight: 600/);
});
