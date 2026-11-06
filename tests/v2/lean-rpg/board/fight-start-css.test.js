// The new start-view stylesheet: touch sizes, wrapping, the tab dot and the reduced-motion spinner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../../src/v2/lean-rpg/board/fight-start.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const rule = selector => {
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `${selector} exists`);
    return css.slice(at, css.indexOf('}', at));
};

test('both cards and their action rows wrap instead of overflowing', () => {
    const offer = rule('.rpg-fight-offer {');
    assert.match(offer, /flex-direction: column/);
    assert.match(rule('.rpg-fight-offer, .rpg-fight-pause {'), /min-width: 0/);
    assert.match(rule('.rpg-fight-offer-line {'), /overflow-wrap: anywhere/);
    assert.match(rule('.rpg-fight-offer-actions, .rpg-fight-pause-actions {'), /flex-wrap: wrap/);
    assert.match(rule('.rpg-fight-pause-foe {'), /flex-wrap: wrap/);
});

test('action buttons are 44px at rest and 48px on the zoomed phone frame', () => {
    const actions = rule('.rpg-fight-offer-actions > button, .rpg-fight-pause-actions > button {');
    assert.match(actions, /min-height: 44px/);
    assert.match(actions, /touch-action: manipulation/);
    const coarse = css.slice(css.indexOf('@media (max-width: 759.98px), (pointer: coarse)'));
    assert.match(coarse, /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\)/);
});

test('the offer dot is the mockup size and the waiting spinner respects reduced motion', () => {
    const dot = rule('.rpg-fight-offer-dot {');
    assert.match(dot, /position: absolute/);
    assert.match(dot, /width: 9px/);
    assert.match(dot, /height: 9px/);
    assert.match(rule('.rpg-fight-pause-working {'), /align-items: center/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.rpg-fight-pause-spinner \{ animation: none; \} \}/);
});
