// The bar's buttons and the Enter key: SillyTavern's keyboard handler clicks a focused menu_button on Enter, and the browser's own
// Enter activation would click it a second time (the Story toggle opened and closed). ui-host.js cancels the browser's activation
// for the three bar buttons; the handler's click stays. Pinned here from the source (the live check is in the PR body).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const host = readFileSync(new URL('../../../src/v2/ui-host.js', import.meta.url), 'utf8');

test('Enter on the bar buttons: the browser activation is cancelled once, for Story, Game view and Settings', () => {
    assert.match(host, /for \(const node of \[storyButton, gameButton, settingsButton\]\) node\.addEventListener\('keypress', event => \{ if \(event\.key === 'Enter'\) event\.preventDefault\(\); \}\);/);
    const at = host.indexOf("node.addEventListener('keypress'");
    assert.ok(at > host.indexOf("storyButton.addEventListener('click'") - 2000, 'the cancel sits with the bar\'s own wiring');
});
