// UI stage 4b review: the HUD strip on a phone is the dense glass under Glass (the Glass-only token `--ss-sheet-hud-layers`,
// the tint layered over itself, as the full-screen window does), and nothing else changes; Solid and Follow SillyTavern leave
// the token unset (no layers). The text contrast on the strip is measured in the live instance (the PR's checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mounts = readFileSync(new URL('../../../src/v2/view/mounts.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const theme = readFileSync(new URL('../../../src/v2/view/theme.js', import.meta.url), 'utf8');

test('the HUD strip: on a phone (below 760px) its background layers are the Glass token, and the rule is set after the strip\'s own rule', () => {
    const at = mounts.indexOf('@media (max-width: 759.98px) {\n    .ss-hud {');
    assert.ok(at >= 0, 'the phone rule for the strip exists');
    assert.match(mounts.slice(at, at + 160), /background-image: var\(--ss-sheet-hud-layers, none\);/);
    assert.ok(at > mounts.indexOf('.ss-hud {\n    display: flex;'), 'after the strip\'s base rule, so it wins over its shorthand');
});

test('the HUD strip: the layers token is a Glass-only token (set with the other sheet tokens, reset elsewhere)', () => {
    const sheet = theme.slice(theme.indexOf('const SHEET_TOKENS = Object.freeze(['), theme.indexOf('const SHEET_RESET'));
    assert.match(sheet, /'--ss-sheet-hud-layers'/);
    assert.match(sheet, /linear-gradient\(var\(--ss-sheet-bg\), var\(--ss-sheet-bg\)\)/);
    assert.match(theme, /const SHEET_RESET = Object\.freeze\(SHEET_TOKENS\.map/);
});
