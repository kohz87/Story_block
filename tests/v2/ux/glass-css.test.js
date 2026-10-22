// view/glass.css, Story Suite's building blocks: loaded with the host's stylesheet, every rule scoped to
// Story Suite's roots (SillyTavern's own UI is untouched), one class of weight so a screen's scoped CSS
// still wins, colours and sizes from the theme tokens (view/theme.js), and the motion token for
// transitions (none when the system asks for less motion).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT_SELECTOR, themeTokens } from '../../../src/v2/view/theme.js';

const read = path => readFileSync(new URL(`../../../src/v2/${path}`, import.meta.url), 'utf8');
const css = read('view/glass.css');

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
// Rules with at-rules opened up.
function rules(source) {
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
        if (head.startsWith('@')) out.push(...rules(inner));
        else out.push({ selectors: splitTop(head), block: inner });
        i = j;
    }
    return out;
}
function weight(selector) {
    let text = selector;
    while (/:where\(/.test(text)) text = text.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
    const ids = (text.match(/#[\w-]+/g) ?? []).length;
    const classes = (text.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const types = (text.replace(/\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length;
    return ids * 100 + classes * 10 + types;
}
const all = rules(css);

test('host.css loads glass.css, after controls.css', () => {
    const host = read('view/host.css');
    assert.match(host, /@import url\('\.\/controls\.css'\);\s*@import url\('\.\/glass\.css'\);/);
});

test('every rule is scoped to Story Suite\'s roots and weighs at most two classes', () => {
    assert.ok(all.length >= 30);
    for (const rule of all) for (const selector of rule.selectors) {
        assert.ok(selector.startsWith(ROOT_SELECTOR), `not scoped: ${selector}`);
        assert.ok(weight(selector) <= 30, `too heavy (${weight(selector)}): ${selector}`);
    }
    // The building blocks themselves weigh one class, so [data-ss-screen="id"] .x (two) wins.
    for (const name of ['ss-glass', 'ss-label', 'ss-pill', 'ss-bar', 'ss-tile', 'ss-status']) {
        const own = all.filter(rule => rule.selectors.some(s => s === `${ROOT_SELECTOR} .${name}`));
        assert.ok(own.length, `.${name} has a rule`);
        assert.equal(weight(`${ROOT_SELECTOR} .${name}`), 10);
    }
});

test('the blocks read the theme tokens: glass, blur, hairline, shadow, radii, font, bar colours, tones', () => {
    const block = selector => all.filter(rule => rule.selectors.includes(`${ROOT_SELECTOR} ${selector}`)).map(rule => rule.block).join('\n');
    const glass = block('.ss-glass');
    for (const part of ['var(--ss-glass)', 'backdrop-filter: var(--ss-blur)', '-webkit-backdrop-filter: var(--ss-blur)', 'var(--ss-border)', 'var(--ss-shadow)', 'var(--ss-radius-l)', 'var(--ss-font)', 'var(--ss-text)']) {
        assert.ok(glass.includes(part), `glass card: ${part}`);
    }
    assert.ok(block('.ss-glass-strong').includes('var(--ss-glass-strong)'));
    assert.ok(block('.ss-bar-track').includes('var(--ss-track)'));
    assert.ok(block('.ss-bar-fill').includes('calc(var(--ss-fill, 0) * 100%)'));
    for (const kind of ['hp', 'mp', 'sp', 'exp']) assert.ok(block(`.ss-bar-${kind}`).includes(`var(--ss-${kind})`), kind);
    for (const tone of ['accent', 'good', 'warn', 'bad', 'info', 'neutral', 'uncommon', 'rare', 'epic', 'legendary']) assert.ok(block(`.ss-tone-${tone}`).includes('--ss-ring'), tone);
    assert.ok(block('.ss-pill').includes('var(--ss-radius-pill)'));
    assert.ok(block('.ss-tile-box').includes('var(--ss-tile)'));
    // Every token the blocks use is one the theme sets (or one a block sets itself).
    const used = new Set([...css.matchAll(/var\((--ss-[a-z0-9-]+)/g)].map(m => m[1]));
    const set = new Set(themeTokens().map(([name]) => name));
    for (const name of used) assert.ok(set.has(name) || ['--ss-fill', '--ss-ring', '--ss-bar-color', '--ss-tile-size'].includes(name), `token ${name} is set by the theme`);
    // Transitions follow the motion token (0s when the system asks for less motion).
    for (const rule of all) if (/transition:/.test(rule.block)) assert.match(rule.block, /var\(--ss-motion/, rule.selectors[0]);
});
