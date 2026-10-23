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

// UI 7 polish: the HUD strip has room, so nothing in it is cut. The strip keeps 8px above and below and items 10px apart; an item keeps its
// own width (a full strip scrolls sideways, it does not squeeze an item so its bars run past its edge), its cap is above a normal item's
// height, and it has room for a badge's tag that hangs out of its square (5px past the right and the bottom).
test('the HUD strip: 8px above and below, items 10px apart, an item keeps its width and has room for what hangs out of it', () => {
    const at = mounts.indexOf('.ss-hud {\n    display: flex;');
    assert.ok(at > 0);
    const strip = mounts.slice(at, mounts.indexOf('}', at));
    assert.match(strip, /gap: 10px;/);
    assert.match(strip, /padding: 8px 10px;/);
    assert.match(strip, /overflow-x: auto;/);
    const item = mounts.slice(mounts.indexOf('.ss-hud-item {'), mounts.indexOf('}', mounts.indexOf('.ss-hud-item {')));
    assert.match(item, /flex: 0 0 auto;/, 'no shrink: a full strip scrolls');
    assert.match(item, /max-height: 64px;/);
    assert.match(item, /padding: 0 5px 5px 0;/);
    assert.match(item, /overflow: hidden;/);
});
