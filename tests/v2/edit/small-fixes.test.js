import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changesCardScreen } from '../../../src/v2/screens/changes-card.js';
import { luminance, parseColor, themeTokens } from '../../../src/v2/view/theme.js';
import { core, queries, show, stocked } from '../screens/helpers.js';

const read = name => readFileSync(new URL(`../../../src/v2/view/${name}`, import.meta.url), 'utf8');

test('a changed purse has one coin icon', () => {
    const module = core();
    const state = stocked(module);
    const { el } = show(changesCardScreen, { state, query: queries(module, state), changes: ['/domains/inventory/wallets/party/coin'] });
    assert.equal(el.querySelectorAll('.coin .fa-coins').length, 1);
});

test('the phone Story panel has an opaque, readable surface in every panel style', () => {
    const css = read('mounts.css');
    assert.match(css, /@media \(max-width: 759\.98px\)\s*\{\s*\.story-suite-sheet\.story-suite-sheet\s*\{\s*background: var\(--ss-panel-opaque\);\s*color: var\(--ss-panel-text\);/);
    for (const scheme of ['dark', 'light']) for (const panel of ['glass', 'solid', 'sillytavern']) {
        const tokens = Object.fromEntries(themeTokens({ scheme, panel }));
        const bg = parseColor(tokens['--ss-panel-opaque']);
        const fg = parseColor(tokens['--ss-panel-text']);
        assert.equal(bg.a, 1, `${scheme} ${panel}`);
        const [hi, lo] = [luminance(bg), luminance(fg)].sort((a, b) => b - a);
        assert.ok((hi + 0.05) / (lo + 0.05) >= 4.5, `${scheme} ${panel}`);
    }
});

test('authored role buttons and commands have a zoom-aware phone target', () => {
    const css = read('size.css');
    const rule = css.match(/:where\(\[data-ss-screen\] :is\(\[role="button"\], \[data-command\]\):not\([^)]*\)\)\s*\{([^}]+)\}/);
    assert.ok(rule);
    for (const part of ['display: inline-block', 'min-width: calc(44px / var(--ss-zoomed, 1)) !important', 'min-height: calc(44px / var(--ss-zoomed, 1)) !important']) assert.ok(rule[1].includes(part), part);
});
