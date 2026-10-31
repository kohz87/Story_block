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
        // The button's hover and pressed rules carry SillyTavern's own :not() chain so they beat `.menu_button` (0,4,0) on the same
        // element; they are the only heavy rules allowed (glass.css, "the buttons"), and the primary's own states use the same chain.
        const menuButtonBeat = /button\.ss-button(?:\.ss-button-primary)?:not\(:disabled\):not\(\.disabled\):not\(\[disabled\]\):(hover|active)$/.test(selector.trim());
        assert.ok(weight(selector) <= 30 || menuButtonBeat, `too heavy (${weight(selector)}): ${selector}`);
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
    for (const name of used) assert.ok(set.has(name) || ['--ss-fill', '--ss-ring', '--ss-bar-color', '--ss-tile-size', '--ss-cols', '--ss-thumb-ring', '--ss-zoomed'].includes(name), `token ${name} is set by the theme`);
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

test('the 1b blocks are in glass.css: hero with container queries, tiers, listcard, tabs, navbar and the modal (not the dialog mount\'s classes)', () => {
    const selectors = all.flatMap(rule => rule.selectors);
    for (const name of ['ss-hero', 'ss-hero-body', 'ss-hero-portrait', 'ss-hero-compact', 'ss-tiers-grid', 'ss-tiers-line', 'ss-listcard-item', 'ss-listcard-tag', 'ss-tabs-item', 'ss-navbar-item', 'ss-modal', 'ss-modal-panel', 'ss-modal-action']) {
        assert.ok(selectors.some(s => s.includes(`.${name}`)), `.${name} has a rule`);
    }
    assert.ok(!selectors.some(s => /\.ss-dialog(?:-|\s|$|,)/.test(s.replace(ROOT_SELECTOR, ''))), 'no rule of the dialog mount\'s ss-dialog*');
    assert.match(css, /container-type: inline-size/);
    assert.match(css, /@container \(min-width: 600px\)/);
    assert.ok(!/@keyframes/.test(css), 'transitions only (the keyframe selectors would be outside the roots)');
    // Hidden stays hidden whatever display a block gives it.
    assert.ok(all.some(rule => rule.selectors.includes(`${ROOT_SELECTOR} [hidden]`) && /display: none !important/.test(rule.block)));
    // The modal is placed from the top with a height, over everything the mounts draw.
    const modal = all.filter(rule => rule.selectors.includes(`${ROOT_SELECTOR} .ss-modal`)).map(rule => rule.block).join('\n');
    // The whole screen inside a zoomed root too (size.css sets --ss-zoomed there; vw and dvh are zoomed with the root).
    for (const part of ['position: fixed', 'top: 0', 'left: 0', 'width: calc(100vw / var(--ss-zoomed, 1))', 'height: calc(100dvh / var(--ss-zoomed, 1))', 'var(--ss-scrim)', 'z-index: 3040']) assert.ok(modal.includes(part), part);
    // Touch targets of 44 px or more for what the reader presses.
    for (const name of ['ss-tabs-item', 'ss-modal-action']) assert.match(all.filter(rule => rule.selectors.includes(`${ROOT_SELECTOR} .${name}`)).map(rule => rule.block).join('\n'), /min-height: 4[4-9]px|min-height: [5-9]\d px/, name);
    assert.match(all.filter(rule => rule.selectors.includes(`${ROOT_SELECTOR} .ss-navbar-item`)).map(rule => rule.block).join('\n'), /min-height: 64px/);
});

test('the form engine\'s rules are in glass.css: rows, switch, inputs, slider, chips, lines, search, section; tokens only, 44 px targets where it presses', () => {
    const selectors = all.flatMap(rule => rule.selectors);
    for (const name of ['ss-form', 'ss-section', 'ss-section-head', 'ss-field', 'ss-field-inline', 'ss-field-label', 'ss-field-help', 'ss-field-error', 'ss-field-tag', 'ss-input', 'ss-switch', 'ss-switch-on', 'ss-switch-knob', 'ss-slider', 'ss-slider-input', 'ss-slider-value', 'ss-chips', 'ss-chip', 'ss-chip-on', 'ss-lines', 'ss-lines-row', 'ss-lines-remove', 'ss-lines-add', 'ss-search', 'ss-search-input', 'ss-visually-hidden']) {
        assert.ok(selectors.some(s => s.includes(`.${name}`)), `.${name} has a rule`);
    }
    const block = selector => all.filter(rule => rule.selectors.includes(`${ROOT_SELECTOR} ${selector}`)).map(rule => rule.block).join('\n');
    assert.ok(block('.ss-switch').includes('width: 48px') && block('.ss-switch').includes('height: 28px') && block('.ss-switch').includes('var(--ss-off)'));
    assert.ok(block('.ss-switch-on').includes('var(--ss-accent)'));
    assert.ok(block('.ss-switch-knob').includes('var(--ss-knob)'));
    assert.ok(block('.ss-input').includes('var(--ss-field)') && block('.ss-input').includes('var(--ss-border)') && /min-height: 40px/.test(block('.ss-input')));
    assert.ok(block('.ss-field-label').includes('font-weight: 800'));
    assert.ok(block('.ss-field-help').includes('var(--ss-muted)'));
    assert.ok(block('.ss-input[aria-invalid="true"]').includes('var(--ss-bad)'));
    // The slider's track and thumb, for both engines (separate rules: one unknown pseudo-element would drop a shared rule).
    for (const part of ['::-webkit-slider-runnable-track', '::-moz-range-track', '::-webkit-slider-thumb', '::-moz-range-thumb']) assert.ok(selectors.some(s => s.endsWith(part)), part);
    assert.ok(all.filter(rule => rule.selectors.some(s => /::-webkit-slider-runnable-track$/.test(s))).every(rule => rule.selectors.length === 1));
    // One class heavier than `.ss-slider-input` alone: SillyTavern paints every range with a body-coloured bar and a thumb of its own.
    assert.match(block('.ss-slider .ss-slider-input::-webkit-slider-runnable-track'), /var\(--ss-fill, 0\)/);
    assert.match(block('.ss-slider .ss-slider-input'), /background: transparent !important;\s*box-shadow: none !important;\s*filter: none !important;/);
    assert.ok(!selectors.some(s => /\.ss-slider-input/.test(s) && !/\.ss-slider \.ss-slider-input/.test(s)), 'every slider rule is under .ss-slider');
    assert.ok(/min-height: 40px/.test(block('.ss-lines-add')) && /width: 40px/.test(block('.ss-lines-remove')));
    assert.ok(block('.ss-chip-on').includes('var(--ss-accent-soft)'));
    // The switch\'s hit area reaches past its 28 px.
    assert.ok(all.some(rule => rule.selectors.includes(`${ROOT_SELECTOR} .ss-switch::after`) && /inset: -8px/.test(rule.block)));
    // Every focusable control has a visible focus.
    for (const name of ['ss-input', 'ss-switch', 'ss-chip', 'ss-lines-add', 'ss-lines-remove', 'ss-lines-toggle', 'ss-search-clear']) {
        assert.ok(all.some(rule => rule.selectors.some(s => s.includes(`.${name}:focus-visible`)) && /outline: 2px solid var\(--ss-accent\)/.test(rule.block)), `${name} focus ring`);
    }
    // A slider's focus is a ring round its thumb (the input's box is not outlined: that box was the blue frame on a range).
    assert.ok(all.some(rule => rule.selectors.some(s => s.endsWith('.ss-slider .ss-slider-input:focus-visible')) && /--ss-thumb-ring: 0 0 0 2px var\(--ss-knob\), 0 0 0 4px var\(--ss-accent\)/.test(rule.block)), 'ss-slider focus ring on the thumb');
    // No literal colour anywhere in the form rules.
    const form = css.slice(css.indexOf('The form engine'), css.indexOf('the UI sample'));
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(form.replace(/\/\*[\s\S]*?\*\//g, '')), 'colours come from the tokens');
});

// The slider's own box: SillyTavern paints a range with a bar in the body colour, a shadow, a brightness filter and a box outline on
// keyboard focus (public/style.css, 1.19: `input[type="range"]` 0,1,1; `:hover` and `:focus-visible` 0,2,1; `.neo-range-slider` with
// `!important`). A theme's custom CSS may add its own, often `!important`. The input itself must stay a clear, borderless box in
// every state whatever those say: only the thin track the pseudo-elements draw is seen.
test('a slider\'s input has no background, box, border, shadow, filter or outline of its own: those rules beat SillyTavern\'s and a lighter !important rule', () => {
    const own = /\.ss-slider \.ss-slider-input(?::(?:hover|active|focus|focus-visible))?$/;
    const inputRules = all.filter(rule => rule.selectors.every(s => own.test(s)));
    assert.ok(inputRules.length >= 2, 'a base rule and a rule for the states');
    const valuesOf = (hit, prop) => hit.flatMap(rule => [...rule.block.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`, 'g'))].map(m => m[1].trim()));
    const BOX = { background: 'transparent !important', border: '0 !important', 'box-shadow': 'none !important', filter: 'none !important', outline: 'none !important' };
    for (const state of ['', ':hover', ':active', ':focus', ':focus-visible']) {
        const hit = inputRules.filter(rule => rule.selectors.some(s => s.endsWith(`.ss-slider-input${state}`)));
        assert.ok(hit.length, `a rule for the input${state}`);
        for (const [prop, value] of Object.entries(BOX)) assert.ok(valuesOf(hit, prop).includes(value), `${state || 'idle'}: ${prop}: ${value} (has ${JSON.stringify(valuesOf(hit, prop))})`);
    }
    assert.ok(valuesOf(inputRules, 'appearance').includes('none !important'));
    // The weight: more than SillyTavern's range rules in every state, and more than a bare `!important` rule on `input[type="range"]` or `.neo-range-slider`.
    const ours = state => Math.min(...inputRules.flatMap(rule => rule.selectors).filter(s => s.endsWith(`.ss-slider-input${state}`)).map(weight));
    assert.ok(ours('') > weight('input[type="range"]'), `${ours('')} beats 0,1,1`);
    assert.ok(ours('') > weight('.neo-range-slider'));
    for (const state of [':hover', ':focus-visible']) assert.ok(ours(state) > weight(`input[type="range"]${state}`), `${state}: ${ours(state)} beats 0,2,1`);
    // No rule for the input sets a colour, an edge or a shadow: only the track and the thumb (the pseudo-elements) are painted.
    for (const rule of inputRules) {
        for (const [, prop, value] of rule.block.replace(/!important/g, '').matchAll(/(?:^|[;\s])(background|background-color|box-shadow|border|outline)\s*:\s*([^;]+);/g)) {
            assert.ok(['none', 'transparent', '0'].includes(value.trim()), `${rule.selectors[0].slice(-40)}: ${prop}: ${value}`);
        }
    }
    // The Firefox progress part is clear too (the fill is the track's own gradient).
    assert.ok(all.some(rule => rule.selectors.length === 1 && rule.selectors[0].endsWith('.ss-slider-input::-moz-range-progress') && /background: transparent;/.test(rule.block)));
});
