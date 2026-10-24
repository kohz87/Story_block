// Text colours that were under 4.5:1 (fix 8k): the reply-card tags, the Inventory fold's danger buttons and the changes card's check rows
// take the theme's text tokens; the tone stays on the ring. The ratio is worked out from the CSS rule and the theme's palettes, on the
// solid surface of each scheme and on the darker backgrounds the light glass can sit over (the reviewer's #e6e3f5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALETTES } from '../../../src/v2/view/theme.js';
import { changesCardScreen } from '../../../src/v2/screens/index.js';
import { inventoryScreen } from '../../../src/v2/screens/inventory.js';

const mountsCss = readFileSync(new URL('../../../src/v2/view/mounts.css', import.meta.url), 'utf8');
const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};
const SURFACES = { dark: ['#1e2132', '#2b2f48'], light: ['#f6f5fb', '#ffffff', '#e6e3f5'] };
const TOKENS = { '--ss-text': 'text', '--ss-muted': 'muted', '--ss-bad-text': 'badText', '--ss-warn-text': 'warnText', '--ss-accent-text': 'accentText', '--ss-help': 'help' };

/** The declarations of the rule whose selector is exactly `selector` (the last such rule), as { property: value }. */
function rule(css, selector) {
    const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim() === selector);
    assert.ok(found.length, `no rule for ${selector}`);
    return Object.fromEntries(found.at(-1)[2].split(';').map(part => part.trim()).filter(Boolean).map(part => {
        const at = part.indexOf(':');
        return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    }));
}
/** The theme token a colour declaration reads first (`var(--ss-x, …)` → "--ss-x"), or null when it is not a token. */
const tokenOf = value => /^var\((--[a-z-]+)/.exec(value ?? '')?.[1] ?? null;

function assertReadable(token, where) {
    assert.ok(TOKENS[token], `${where} reads ${token}, which is not a text token of the theme`);
    for (const scheme of ['dark', 'light']) {
        for (const surface of SURFACES[scheme]) {
            const ratio = contrast(PALETTES[scheme][TOKENS[token]], surface);
            assert.ok(ratio >= 4.5, `${where}: ${token} is ${ratio.toFixed(2)}:1 on ${scheme} ${surface}`);
        }
    }
}

test('the reply cards\' tags are text in a text token on every surface; the accent tag is --ss-accent-text; good and info keep the tone as the ring', () => {
    const base = rule(mountsCss, '.ss-rc-tag');
    assertReadable(tokenOf(base.color), '.ss-rc-tag');
    assert.equal(tokenOf(rule(mountsCss, '.ss-rc-tag-accent').color), '--ss-accent-text');
    assert.equal(tokenOf(rule(mountsCss, '.ss-rc-tag-bad').color), '--ss-bad-text');
    assert.equal(tokenOf(rule(mountsCss, '.ss-rc-tag-warn').color), '--ss-warn-text');
    for (const tone of ['accent', 'bad', 'warn']) assertReadable(tokenOf(rule(mountsCss, `.ss-rc-tag-${tone}`).color), `.ss-rc-tag-${tone}`);
    // good and info set no colour of their own (the base text colour stays) and name their tone in the ring.
    for (const tone of ['good', 'info']) {
        const own = rule(mountsCss, `.ss-rc-tag-${tone}`);
        assert.equal(own.color, undefined, `${tone}: the text is the base text colour`);
        assert.equal(own['--tag-ring'], `var(--ss-${tone})`);
    }
    assert.equal(base.border, '1px solid var(--tag-ring)');
});

test('Inventory: the fold\'s danger buttons are text in --ss-bad-text (the fixed --sb-bad is the ring only)', () => {
    const danger = rule(inventoryScreen.css, '.fold .ss-button-danger');
    assert.match(danger.color, /^var\(--ss-bad-text, var\(--sb-bad\)\)$/);
    assertReadable(tokenOf(danger.color), '.fold .ss-button-danger');
    assert.equal(danger['border-color'], 'var(--sb-bad)');
});

test('Changes card: a check row\'s result and story note are the theme\'s text colour; the ring stays on the row\'s border', () => {
    const css = changesCardScreen.css;
    const row = rule(css, '.check');
    assert.match(row.color, /^var\(--ss-text/);
    assertReadable(tokenOf(row.color), '.check');
    assert.match(row.border, /var\(--ring\)/, 'the ring is the border');
    for (const selector of ['.check .res', '.check .story']) assert.ok(!/var\(--ring\)/.test(rule(css, selector).color ?? ''), `${selector} is not coloured by the ring`);
    assert.ok(!/color:\s*var\(--ring\)/.test(css.slice(css.indexOf('.check .what'), css.indexOf('.none'))), 'no text in the check rows uses the ring');
});
