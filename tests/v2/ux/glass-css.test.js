// view/glass.css, Story Suite's building blocks: loaded with the host's stylesheet, every rule scoped to
// Story Suite's roots (SillyTavern's own UI is untouched), one class of weight so a screen's scoped CSS
// still wins, colours and sizes from the theme tokens (view/theme.js), and the motion token for
// transitions (none when the system asks for less motion).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { FONT_STACKS, ROOT_SELECTOR, themeTokens } from '../../../src/v2/view/theme.js';

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

test('the type scale and sizes are the concept\'s: label 15px/600/1.4px, bar 7px track and 13px head, pill 3px 10px, badge 44px', () => {
    const block = selector => all.filter(rule => rule.selectors.includes(`${ROOT_SELECTOR} ${selector}`)).map(rule => rule.block).join('\n');
    const label = block('.ss-label');
    for (const part of ['font-size: 15px', 'font-weight: 600', 'letter-spacing: 1.4px', 'text-transform: uppercase', 'var(--ss-muted)']) assert.ok(label.includes(part), `label: ${part}`);
    const head = block('.ss-bar-head');
    for (const part of ['font-size: 13px', 'font-weight: 600', 'text-transform: uppercase']) assert.ok(head.includes(part), `bar head: ${part}`);
    assert.ok(head.includes('justify-content: space-between'), 'label left, value right');
    assert.ok(block('.ss-bar-label').includes('var(--ss-muted)'));
    assert.ok(/font-weight: 700/.test(block('.ss-bar-value')) && block('.ss-bar-value').includes('var(--ss-text)'), 'values bold, normal colour');
    const track = block('.ss-bar-track');
    assert.ok(track.includes('height: 7px') && track.includes('border-radius: var(--ss-radius-pill)') && track.includes('var(--ss-track)'));
    assert.ok(block('.ss-bar').includes('gap: var(--ss-space-1)'), '4px between the head and the track');
    assert.ok(!/border/.test(block('.ss-bar-fill').replace('border-radius: inherit', '')), 'a flat fill, no border');
    const pill = block('.ss-pill');
    assert.ok(pill.includes('padding: 3px 10px') && pill.includes('font-size: 14px') && pill.includes('font-weight: 600'));
    const status = block('.ss-status');
    assert.ok(status.includes('width: 44px') && status.includes('height: 44px'));
    assert.match(block('.ss-status-left'), /font-size: 12px;[\s\S]*font-weight: 700/);
    assert.ok(block('.ss-tile-label').includes('font-size: 13px'));
    assert.ok(block('.ss-glass').includes('font-size: 14px'), 'body text 14px');
});

test('Nunito is bundled: fonts.css points at files that exist, with the licence; nothing is fetched from outside', () => {
    const fonts = read('view/fonts.css');
    assert.match(read('view/host.css'), /@import url\('\.\/fonts\.css'\);/);
    const faces = fonts.match(/@font-face/g) ?? [];
    assert.equal(faces.length, 8, 'latin and latin-ext in four weights');
    for (const weight of [400, 600, 700, 800]) for (const subset of ['latin', 'latin-ext']) {
        assert.match(fonts, new RegExp(`font-weight: ${weight};[\\s\\S]*?nunito-${subset}-${weight}\\.woff2`), `${subset} ${weight}`);
    }
    for (const [, path] of fonts.matchAll(/url\('([^']+)'\)/g)) {
        assert.ok(path.startsWith('../../../assets/fonts/nunito/') && path.endsWith('.woff2'), path);
        const file = new URL(`../../../src/v2/view/${path}`, import.meta.url);
        assert.ok(existsSync(file) && statSync(file).size > 5000, `${path} exists`);
        assert.equal(readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', `${path} is a woff2`);
    }
    assert.match(readFileSync(new URL('../../../assets/fonts/nunito/OFL.txt', import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.ok(!/https?:\/\//.test(fonts.replace(/\/\*[\s\S]*?\*\//g, '')), 'no external URL');
    for (const file of ['view/theme.js', 'view/fonts.css', 'view/glass.css', 'ui-host.js']) assert.ok(!/googleapis|gstatic/.test(read(file)), `${file} fetches nothing from Google`);
    assert.match(themeFontStack(), /^'Nunito', system-ui/);
});

const themeFontStack = () => FONT_STACKS.nunito;

test('a tone\'s ring colour reaches the block: no block sets --ss-ring itself after the tone rules (it would win the tie)', () => {
    const setters = all.filter(rule => /(^|[\s;])--ss-ring\s*:/.test(rule.block)).flatMap(rule => rule.selectors);
    assert.ok(setters.every(selector => /\.ss-tone-[a-z]+$/.test(selector)), `only the tones set it: ${setters.join(' | ')}`);
    assert.match(all.filter(rule => rule.selectors.includes(`${ROOT_SELECTOR} .ss-status`)).map(rule => rule.block).join('\n'), /var\(--ss-ring, var\(--ss-accent\)\)/, 'the badge falls back to the accent');
});
