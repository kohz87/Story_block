// view/theme.js, the theme bridge of Story Suite's look: the token set on every Story Suite root, light or
// dark worked out from SillyTavern's theme colours, the reader's panel style (Glass, Solid, Follow
// SillyTavern) and font, the system's reduced transparency and motion, and that nothing outside Story
// Suite's roots is touched (no rule outside them, no attribute or style on SillyTavern's elements).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ACCENT, DEFAULT_GLASS, FONT_STACKS, GLASS_MAX, GLASS_MIN, PANEL_STYLES, ROOT_SELECTOR, THEME_ROOTS, createThemeBridge, decideScheme, glassAlphas,
    luminance, parseColor, schemeTokens, themeChoice, themeCss, themeTokens,
} from '../../../src/v2/view/theme.js';
import { HOST_SETTINGS_DEFAULTS, HOST_SETTINGS_SCHEMA, createSettings } from '../../../src/v2/sdk.js';
import { installDom } from './widgets/fake-dom.js';

const REQUIRED = [
    '--ss-glass', '--ss-glass-strong', '--ss-tile', '--ss-border', '--ss-shadow', '--ss-text', '--ss-muted', '--ss-track',
    '--ss-accent', '--ss-accent-soft', '--ss-pill', '--ss-pill-text', '--ss-badge', '--ss-badge-text', '--ss-blur',
    '--ss-radius-s', '--ss-radius-m', '--ss-radius-l', '--ss-radius-xl', '--ss-radius-xxl', '--ss-radius-pill',
    '--ss-space-1', '--ss-space-2', '--ss-space-3', '--ss-space-4', '--ss-space-5', '--ss-font', '--ss-motion',
    '--ss-hp', '--ss-mp', '--ss-sp', '--ss-exp', '--ss-tick', '--ss-scrim',
];

// Every rule of a stylesheet, at-rules opened up: [{ selectors, block, at: ['@media …', …] }].
function rules(css, at = []) {
    const out = [];
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
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
function splitTop(text) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let k = 0; k < text.length; k += 1) {
        if (text[k] === '(') depth += 1;
        else if (text[k] === ')') depth -= 1;
        else if (text[k] === ',' && depth === 0) { out.push(text.slice(start, k)); start = k + 1; }
    }
    out.push(text.slice(start));
    return out.map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const names = tokens => tokens.map(([name]) => name);
const valueOf = (tokens, name) => tokens.find(([n]) => n === name)?.[1];

test('parseColor reads SillyTavern\'s theme colours: rgba() with commas or spaces, hex, names; else null', () => {
    assert.deepEqual(parseColor('rgba(23, 23, 23, 1)'), { r: 23, g: 23, b: 23, a: 1 });
    assert.deepEqual(parseColor('rgb(220 220 210 / 0.5)'), { r: 220, g: 220, b: 210, a: 0.5 });
    assert.deepEqual(parseColor('rgba(100%, 0%, 50%, 40%)'), { r: 255, g: 0, b: 127.5, a: 0.4 });
    assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(parseColor('#00000080'), { r: 0, g: 0, b: 0, a: 0.502 });
    assert.deepEqual(parseColor(' White '), { r: 255, g: 255, b: 255, a: 1 });
    for (const bad of ['', 'red', 'rgb(1,2)', 'hsl(0 0% 0%)', '#12', 'var(--x)', null, 5]) assert.equal(parseColor(bad), null, String(bad));
    assert.ok(luminance(parseColor('#fff')) > 0.99 && luminance(parseColor('#000')) === 0);
});

test('light or dark from SillyTavern\'s body text against its blur tint, for the shipped themes and light ones', () => {
    // SillyTavern's own themes (data/default-user/themes): light text on a dark tint, all dark.
    for (const [name, body, tint] of [
        ['default / Dark Lite', 'rgba(220, 220, 210, 1)', 'rgba(23, 23, 23, 1)'],
        ['Azure', 'rgba(171, 198, 223, 1)', 'rgba(23, 30, 33, 0.61)'],
        ['Cappuccino', 'rgba(235, 235, 235, 1)', 'rgba(34, 30, 32, 0.95)'],
        ['Celestial Macaron', 'rgba(229, 175, 162, 1)', 'rgba(23, 36, 55, 0.9)'],
        ['Dark V 1.0', 'rgba(207, 207, 197, 1)', 'rgba(29, 33, 40, 0.9)'],
    ]) assert.equal(decideScheme({ body, tint }), 'dark', name);
    // Dark text on a light tint: light.
    assert.equal(decideScheme({ body: 'rgba(30, 30, 40, 1)', tint: 'rgba(240, 240, 245, 0.85)' }), 'light');
    assert.equal(decideScheme({ body: '#222', tint: '#fff' }), 'light');
    assert.equal(decideScheme({ body: 'rgb(60 50 80)', tint: 'rgb(250 236 220 / 0.7)' }), 'light');
    // A tint that is mostly see-through: the text decides (dark text: a light theme).
    assert.equal(decideScheme({ body: '#1a1a1a', tint: 'rgba(0, 0, 0, 0.1)' }), 'light');
    assert.equal(decideScheme({ body: '#eeeeee', tint: 'rgba(255, 255, 255, 0.1)' }), 'dark');
    // Only one colour readable, or none.
    assert.equal(decideScheme({ body: '', tint: '#f4f4f4' }), 'light');
    assert.equal(decideScheme({ body: 'var(--x)', tint: '' }), 'dark');
    assert.equal(decideScheme(), 'dark', 'SillyTavern\'s default theme is dark');
});

test('every token is set for every panel style and scheme; the shared sizes and the font too', () => {
    for (const panel of PANEL_STYLES) for (const scheme of ['dark', 'light']) {
        const tokens = themeTokens({ scheme, panel, font: 'nunito' });
        for (const name of REQUIRED) assert.ok(names(tokens).includes(name), `${panel}/${scheme}: ${name}`);
        assert.equal(new Set(names(tokens)).size, tokens.length, 'no token twice');
        for (const [name, value] of tokens) assert.ok(value && !/[;{}]/.test(value), `${name}: one CSS value`);
    }
    const glass = themeTokens({ scheme: 'dark', panel: 'glass' });
    assert.equal(valueOf(glass, '--ss-accent'), ACCENT);
    // The concept's own glass (dark 0.50, strong 0.66); the tint's colour is mixed in only where relative colours work.
    assert.equal(valueOf(glass, '--ss-glass'), 'rgba(30, 33, 50, 0.5)');
    assert.equal(valueOf(glass, '--ss-glass-strong'), 'rgba(30, 33, 50, 0.66)');
    assert.equal(valueOf(themeTokens({ scheme: 'light' }), '--ss-glass'), 'rgba(255, 255, 255, 0.55)');
    assert.equal(valueOf(themeTokens({ scheme: 'light' }), '--ss-glass-strong'), 'rgba(255, 255, 255, 0.72)');
    assert.equal(valueOf(glass, '--ss-blur'), 'blur(16px) saturate(1.2)');
    assert.equal(valueOf(themeTokens({ scheme: 'light' }), '--ss-text'), '#23253a');
    assert.equal(valueOf(themeTokens({ scheme: 'dark' }), '--ss-text'), '#f1f2f8');
    assert.equal(valueOf(themeTokens({ font: 'nunito' }), '--ss-font'), FONT_STACKS.nunito);
    assert.match(FONT_STACKS.nunito, /^'Nunito', system-ui/);
    assert.equal(valueOf(themeTokens({ font: 'theme' }), '--ss-font'), 'var(--mainFontFamily, inherit)');
});

test('Solid: no blur and an opaque glass (fully opaque where relative colours work); Follow SillyTavern: its own colours', () => {
    for (const scheme of ['dark', 'light']) {
        const solid = schemeTokens(scheme, 'solid');
        assert.equal(valueOf(solid, '--ss-blur'), 'none');
        // The base the tint goes into is opaque (no alpha), so the glass is opaque whenever the tint is.
        assert.match(valueOf(solid, '--ss-glass'), /, #[0-9a-f]{6}\)$/);
        const opaque = schemeTokens(scheme, 'solid', { opaque: true });
        assert.match(valueOf(opaque, '--ss-glass'), /^rgb\(from color-mix\(.*\) r g b \/ 1\)$/);
        assert.match(valueOf(opaque, '--ss-overlay'), /\/ 1\)$/);
    }
    const css = themeCss({ scheme: 'dark', panel: 'solid' });
    assert.match(css, /@supports \(color: rgb\(from red r g b\)\)/);
    assert.ok(!/blur\(16px/.test(css), 'no blur anywhere in Solid');
    const st = themeTokens({ scheme: 'light', panel: 'sillytavern' });
    assert.equal(valueOf(st, '--ss-text'), 'var(--SmartThemeBodyColor, #dcdcd2)');
    assert.equal(valueOf(st, '--ss-accent'), 'var(--SmartThemeQuoteColor, #e18a24)');
    assert.equal(valueOf(st, '--ss-glass'), 'var(--SmartThemeBlurTintColor, rgba(23, 23, 23, 1))');
    assert.equal(valueOf(st, '--ss-blur'), 'blur(var(--SmartThemeBlurStrength, 0px))');
    assert.ok(!themeCss({ panel: 'sillytavern' }).includes(ACCENT), 'no concept accent while following SillyTavern');
});

test('themeCss: every rule under Story Suite\'s roots, forced schemes, reduced transparency and motion', () => {
    assert.equal(ROOT_SELECTOR, `:where(${THEME_ROOTS.join(', ')})`);
    for (const panel of PANEL_STYLES) for (const scheme of ['dark', 'light']) {
        const css = themeCss({ scheme, panel, font: 'theme' });
        const all = rules(css);
        assert.ok(all.length >= 2);
        for (const rule of all) for (const selector of rule.selectors) assert.ok(selector.startsWith(ROOT_SELECTOR), `${panel}: not scoped: ${selector}`);
        // Only custom properties: no property of any element is set directly.
        for (const rule of all) for (const decl of rule.block.split(';').map(d => d.trim()).filter(Boolean)) assert.match(decl, /^--ss-[a-z0-9-]+:/, decl);
        assert.ok(all.some(rule => rule.at.includes('@media (prefers-reduced-motion: reduce)') && /--ss-motion: 0s/.test(rule.block)), 'reduced motion');
    }
    const glass = themeCss({ scheme: 'light', panel: 'glass' });
    const root = rules(glass)[0];
    assert.deepEqual(root.selectors, [ROOT_SELECTOR]);
    assert.match(root.block, /--ss-scheme: light;/);
    // Forced schemes for a part of a screen (the UI sample's two panes).
    for (const s of ['dark', 'light']) assert.ok(rules(glass).some(rule => rule.selectors.includes(`${ROOT_SELECTOR} :where(.ss-scheme-${s})`) && rule.block.includes(`--ss-scheme: ${s};`)), s);
    // A system that asks for less transparency gets Solid's glass in place of Glass.
    const reduced = rules(glass).filter(rule => rule.at[0] === '@media (prefers-reduced-transparency: reduce)');
    assert.ok(reduced.length >= 3);
    assert.ok(reduced.every(rule => /--ss-blur: none;/.test(rule.block)));
    assert.ok(reduced.some(rule => rule.at.includes('@supports (color: rgb(from red r g b))') && /\/ 1\);/.test(rule.block)));
    assert.ok(!rules(themeCss({ panel: 'solid' })).some(rule => rule.at.some(a => a.includes('reduced-transparency'))), 'Solid needs no fallback');
});

test('themeChoice: the reader\'s settings, anything unknown is the default (Glass, Nunito); host settings hold them', () => {
    assert.deepEqual(themeChoice({}), { panel: 'glass', font: 'nunito', strength: 50 });
    assert.deepEqual(themeChoice({ panelStyle: 'solid', font: 'theme', glassStrength: 70 }), { panel: 'solid', font: 'theme', strength: 70 });
    assert.deepEqual(themeChoice({ panelStyle: '<b>', font: 3, glassStrength: 'lots' }), { panel: 'glass', font: 'nunito', strength: 50 });
    assert.deepEqual(themeChoice(null), { panel: 'glass', font: 'nunito', strength: 50 });
    assert.equal(HOST_SETTINGS_DEFAULTS.panelStyle, 'glass');
    assert.equal(HOST_SETTINGS_DEFAULTS.font, 'nunito');
    assert.deepEqual(HOST_SETTINGS_SCHEMA.panelStyle.options.map(o => o.value), ['glass', 'solid', 'sillytavern']);
    assert.deepEqual(HOST_SETTINGS_SCHEMA.font.options.map(o => o.value), ['nunito', 'theme']);
    const es = {};
    const settings = createSettings({ root: () => es, registry: { module: () => null } });
    assert.equal(settings.set(null, 'panelStyle', 'solid'), 'solid');
    assert.equal(settings.set(null, 'panelStyle', 'neon'), undefined, 'not an option: not stored');
    assert.equal(settings().panelStyle, 'solid');
    assert.equal(settings().font, 'nunito');
});

// A page with SillyTavern's theme variables on <html> and a MutationObserver the test can fire.
function page(vars) {
    const doc = installDom();
    doc.documentElement = doc.createElement('html');
    doc.documentElement.setAttribute('class', 'st-root');
    doc.body.setAttribute('class', 'no-blur');
    const observers = [];
    doc.defaultView.MutationObserver = class {
        constructor(fn) { this.fn = fn; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; }
        disconnect() { this.off = true; }
    };
    const snapshot = node => JSON.stringify({ attrs: [...node.attrs.entries()].sort(), style: { ...node.styleProps } });
    return { doc, vars, observers, readVar: name => vars[name] ?? '', snapshot };
}

test('the bridge writes one theme sheet, follows the settings and SillyTavern\'s theme, and never touches SillyTavern\'s elements', () => {
    const p = page({ '--SmartThemeBodyColor': 'rgba(220, 220, 210, 1)', '--SmartThemeBlurTintColor': 'rgba(23, 23, 23, 1)' });
    const before = [p.snapshot(p.doc.documentElement), p.snapshot(p.doc.body)];
    let values = { panelStyle: 'glass', font: 'nunito' };
    const bridge = createThemeBridge({ doc: p.doc, settings: () => values, readVar: p.readVar });
    const sheets = () => p.doc.head.querySelectorAll('style[data-ss-theme]');
    assert.equal(sheets().length, 1);
    assert.deepEqual(bridge.current(), { scheme: 'dark', panel: 'glass', font: 'nunito', strength: 50 });
    assert.equal(sheets()[0].textContent, themeCss({ scheme: 'dark', panel: 'glass', font: 'nunito' }));
    // Nunito ships with the extension (fonts.css): the bridge never adds a font stylesheet, whatever SillyTavern allows.
    values = { panelStyle: 'solid', font: 'theme' };
    bridge.apply();
    assert.equal(p.doc.head.querySelector('link[data-ss-font]'), null);
    assert.equal(p.doc.head.querySelector('link'), null, 'no link of any kind');
    assert.equal(sheets().length, 1, 'the same sheet, rewritten');
    assert.match(sheets()[0].textContent, /--ss-blur: none;/);
    // SillyTavern applies a light theme (it sets the variables on <html>'s style): read again, light now.
    assert.equal(p.observers.length, 1);
    assert.equal(p.observers[0].target, p.doc.documentElement);
    assert.deepEqual(p.observers[0].options.attributeFilter, ['style', 'class']);
    p.vars['--SmartThemeBodyColor'] = 'rgba(30, 30, 40, 1)';
    p.vars['--SmartThemeBlurTintColor'] = 'rgba(240, 240, 245, 0.85)';
    p.observers[0].fn([]);
    assert.equal(bridge.current().scheme, 'light');
    assert.match(sheets()[0].textContent, /--ss-scheme: light;/);
    // Nothing of SillyTavern's own changed: <html> and <body> have the same attributes and style.
    assert.deepEqual([p.snapshot(p.doc.documentElement), p.snapshot(p.doc.body)], before);
    assert.match(before[0], /st-root/, 'the snapshot holds the attributes');
    assert.deepEqual(p.doc.body.children, [], 'nothing added to the page body');
    bridge.destroy();
    assert.equal(p.observers[0].off, true);
});

test('the bridge survives a page without a MutationObserver, settings that throw and an unreadable theme', () => {
    const doc = installDom();
    const bridge = createThemeBridge({ doc, settings: () => { throw new Error('no'); }, readVar: () => '' });
    assert.deepEqual(bridge.current(), { scheme: 'dark', panel: 'glass', font: 'nunito', strength: 50 });
    assert.equal(doc.head.querySelectorAll('style[data-ss-theme]').length, 1);
    bridge.destroy();
});

test('Glass strength: 30–90%, the concept\'s alphas at 50%; the tint gives the glass its colour, never its alpha', () => {
    assert.deepEqual([GLASS_MIN, GLASS_MAX, DEFAULT_GLASS], [30, 90, 50]);
    assert.deepEqual(glassAlphas('dark', 50), { glass: 0.5, strong: 0.66 });
    assert.deepEqual(glassAlphas('light', 50), { glass: 0.55, strong: 0.72 });
    assert.deepEqual(glassAlphas('dark', 30), { glass: 0.3, strong: 0.46 });
    assert.deepEqual(glassAlphas('light', 90), { glass: 0.95, strong: 0.98 }, 'never fully opaque');
    assert.deepEqual(glassAlphas('dark', 5), glassAlphas('dark', 30), 'kept inside the range');
    assert.deepEqual(glassAlphas('dark', 'x'), glassAlphas('dark', 50));
    assert.equal(themeChoice({ glassStrength: 400 }).strength, 90);
    assert.equal(themeChoice({ glassStrength: 12.6 }).strength, 30);
    assert.equal(valueOf(themeTokens({ scheme: 'dark', strength: 70 }), '--ss-glass'), 'rgba(30, 33, 50, 0.7)');
    // Where relative colours work, the tint's COLOUR is mixed in at 30% and the alpha is the strength's.
    const tinted = valueOf(schemeTokens('dark', 'glass', { strength: 50, tinted: true }), '--ss-glass');
    assert.match(tinted, /^rgb\(from color-mix\(in srgb, rgb\(from var\(--SmartThemeBlurTintColor, rgba\(23, 23, 23, 1\)\) r g b \/ 1\) 30%, rgb\(30 33 50\)\) r g b \/ 0\.5\)$/);
    const css = themeCss({ scheme: 'dark', panel: 'glass', strength: 40 });
    const supported = rules(css).filter(rule => rule.at.length === 1 && rule.at[0] === '@supports (color: rgb(from red r g b))');
    assert.ok(supported.length >= 3 && supported.every(rule => /--ss-glass: rgb\(from color-mix/.test(rule.block) && / r g b \/ 0\.\d+\)/.test(rule.block)), 'root and both forced schemes');
    assert.match(supported[0].block, / r g b \/ 0\.4\);/);
    // The plain value stays in the base block for browsers without relative colours.
    assert.match(rules(css)[0].block, /--ss-glass: rgba\(30, 33, 50, 0\.4\);/);
    // The system's reduced transparency still wins over the tinted glass (it comes later).
    assert.ok(css.indexOf('@supports (color: rgb(from red r g b))') < css.indexOf('@media (prefers-reduced-transparency'));
    // Solid and Follow SillyTavern ignore it.
    assert.equal(themeCss({ scheme: 'dark', panel: 'solid', strength: 30 }), themeCss({ scheme: 'dark', panel: 'solid', strength: 90 }));
    assert.equal(themeCss({ panel: 'sillytavern', strength: 30 }), themeCss({ panel: 'sillytavern', strength: 90 }));
    assert.equal(HOST_SETTINGS_DEFAULTS.glassStrength, 50);
    const field = HOST_SETTINGS_SCHEMA.glassStrength;
    assert.deepEqual([field.type, field.min, field.max, field.form], ['int', 30, 90, 'slider']);
    assert.deepEqual(Object.keys(HOST_SETTINGS_SCHEMA).slice(-3), ['panelStyle', 'glassStrength', 'font'], 'under Panel style');
});
