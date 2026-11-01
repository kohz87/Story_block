// The game view's window is opaque in every panel style (mounts.css, view/theme.js): the chat behind it must not read through. Glass
// lays its tint over an opaque floor of the same colour (--ss-sheet-floor, the tint at full alpha) and keeps its blur and look; Solid and
// Follow SillyTavern are their surface at full alpha. A phone's full-screen view was opaque already and stays so. The Story panel is not
// touched by it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../../src/v2/view/${path}`, import.meta.url), 'utf8');
const mounts = read('mounts.css');
const host = read('host.css');
const theme = read('theme.js');

// The block of the media query that opens at `needle`, up to its closing brace at the left margin.
const block = (css, needle) => {
    const at = css.indexOf(needle);
    assert.ok(at >= 0, needle);
    return css.slice(at, css.indexOf('\n}\n', at));
};

test('the wide window: an opaque floor under the tint, the blur kept', () => {
    const wide = block(mounts, '.ss-gameview-main {\n        display: flex;');
    assert.match(wide, /background-color: var\(--ss-sheet-floor, var\(--ss-surface\)\);/);
    assert.match(wide, /background-image: linear-gradient\(var\(--ss-sheet-bg, transparent\), var\(--ss-sheet-bg, transparent\)\);/, 'the Glass tint on top of the floor');
    assert.match(wide, /backdrop-filter: var\(--ss-sheet-blur, none\);/, 'the blur is kept');
    assert.doesNotMatch(wide, /background-color: var\(--ss-sheet-bg/, 'the translucent tint is no longer the colour itself');
});

test('without Glass the floor is the surface at full alpha (relative colours), so a translucent theme tint cannot show the chat', () => {
    assert.match(mounts, /@supports \(color: rgb\(from red r g b\)\) \{\s*@media \(min-width: 760px\) \{\s*\.ss-gameview-main \{\s*background-color: var\(--ss-sheet-floor, rgb\(from var\(--ss-surface\) r g b \/ 1\)\);/);
});

test('Glass sets the floor: its tint colour at full alpha', () => {
    assert.match(theme, /\['--ss-sheet-floor', 'rgb\(from var\(--ss-glass-strong\) r g b \/ 1\)'\]/);
});

test('a phone\'s full-screen view keeps its opaque floor and the Story panel is left as it was', () => {
    assert.match(mounts, /background-color: var\(--ss-gameview-phone-floor, var\(--ss-sheet-bg, rgb\(from var\(--ss-surface\) r g b \/ 1\)\)\);/);
    assert.doesNotMatch(host, /ss-sheet-floor/, 'the Story panel\'s own rules do not use the game view\'s floor');
});

test('the wide More sheet opens over the window\'s foot, centred, and the row of the bar is centred', () => {
    assert.match(mounts, /\.ss-gameview-nav\.ss-screenbar-row \{\s*justify-content: center;/);
    assert.match(mounts, /\.ss-gameview-main > \.ss-screenbar-sheet \{[^}]*left: 50%;[^}]*bottom: 24px;[^}]*transform: translateX\(-50%\);/);
});
