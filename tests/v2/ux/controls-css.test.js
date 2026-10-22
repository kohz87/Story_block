// view/controls.css: every input, select and textarea inside a Story Suite root takes SillyTavern's theme
// colours (no bright white boxes on a dark theme), with focus, placeholder, disabled and read-only
// states; every rule is scoped to Story Suite's roots (SillyTavern's own UI is untouched) and weighs no
// more than a bare element, so a module's own field classes still win.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../../src/v2/${path}`, import.meta.url), 'utf8');
const css = read('view/controls.css');
const ROOTS = ['.story-suite-overlay', '.story-suite-sheet', '.ss-gameview', '.ss-dialog', '.ss-cards', '.ss-card', '.ss-hud', '[data-ss-screen]'];
const PREFIX = `:where(${ROOTS.join(', ')})`;

// Top-level commas only (the :where() lists have their own).
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
function rules(source) {
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    for (let match = re.exec(body); match; match = re.exec(body)) out.push({ selectors: splitTop(match[1]), block: match[2] });
    return out;
}
// Specificity of a selector with :where() parts dropped and :is() counted by its heaviest (enough here).
function weight(selector) {
    let text = selector;
    while (/:where\(/.test(text)) text = text.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
    text = text.replace(/:is\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner) => splitTop(inner).sort((a, b) => weight(b) - weight(a))[0] ?? '');
    const ids = (text.match(/#[\w-]+/g) ?? []).length;
    const classes = (text.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const types = (text.replace(/\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length;
    return ids * 100 + classes * 10 + types;
}

test('host.css loads controls.css (the manifest loads host.css)', () => {
    assert.match(read('view/host.css'), /@import url\('\.\/controls\.css'\);/);
});

test('every rule is scoped to Story Suite\'s roots, so SillyTavern\'s own inputs are untouched', () => {
    const all = rules(css);
    assert.ok(all.length >= 10);
    for (const rule of all) for (const selector of rule.selectors) {
        assert.ok(selector.startsWith(PREFIX), `not scoped: ${selector}`);
    }
});

test('it covers text, search, number, select, textarea, checkbox, radio, range and colour, and every state', () => {
    const selectors = rules(css).flatMap(rule => rule.selectors).join('\n');
    for (const type of ['text', 'search', 'number']) assert.ok(selectors.includes(`[type="${type}"]`), type);
    assert.ok(selectors.includes(':not([type])'), 'an input with no type is a text box');
    for (const tag of [' textarea', ' select']) assert.ok(selectors.includes(tag), tag);
    for (const type of ['radio', 'checkbox', 'range', 'color']) assert.ok(selectors.includes(`[type="${type}"]`), type);
    for (const state of ['::placeholder', ':focus', ':focus-visible', ':disabled', '[readonly]']) assert.ok(selectors.includes(state), state);
});

test('the colours come from SillyTavern\'s theme variables; no fixed white field', () => {
    for (const name of ['--SmartThemeBodyColor', '--SmartThemeBlurTintColor', '--SmartThemeBorderColor', '--SmartThemeQuoteColor', '--SmartThemeEmColor']) {
        assert.ok(css.includes(`var(${name}`), name);
    }
    const blocks = rules(css).map(rule => rule.block).join('\n');
    assert.doesNotMatch(blocks, /:\s*(?:#fff\b|#ffffff\b|white\b|rgb\(255,\s*255,\s*255\))/i);
    // The field look, once, on the custom properties.
    const field = rules(css).find(rule => rule.selectors.some(selector => selector.endsWith(' textarea')) && /background-color/.test(rule.block));
    assert.match(field.block, /color: var\(--ss-field-fg\)/);
    assert.match(field.block, /background-color: var\(--ss-field-bg\)/);
    assert.match(field.block, /border: 1px solid var\(--ss-field-border\)/);
});

test('the field rules weigh no more than a bare element: a module\'s classes win, SillyTavern\'s select arrow stays', () => {
    const field = rules(css).find(rule => rule.selectors.some(selector => selector.endsWith(' textarea')) && /background-color/.test(rule.block));
    for (const selector of field.selectors) assert.equal(weight(selector), 1, selector);
    assert.ok(weight('.field') > weight(field.selectors[0]), 'a module field class (RPG Battle\'s .field) wins');
    // Only background-color is set on selects (the `background` shorthand would drop SillyTavern's arrow image).
    for (const rule of rules(css).filter(item => item.selectors.some(selector => / select$/.test(selector)))) {
        assert.doesNotMatch(rule.block, /(^|[;\s])background\s*:/, rule.selectors.join(', '));
    }
});
