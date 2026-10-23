// Home's layout (the CSS is the screen's own, src/v2/screens/home.js). The lead's hero card is the game view's header now
// (UI stage 5a, view/game-header.js), so Home has no hero rule. A quest's status tag wraps and never leaves its card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { homeScreen } from '../../../src/v2/screens/home.js';

const css = homeScreen.css;
const rule = selector => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} has a rule`);
    return css.slice(at, css.indexOf('}', at));
};

test('Home has no hero card: the game view header draws the lead on every screen', () => {
    assert.doesNotMatch(homeScreen.template, /class="panel hero"/);
    assert.doesNotMatch(homeScreen.template, /ss\.portrait/);
    assert.doesNotMatch(css, /\.hero\b/);
});

test('the section headings are the section label (a label and a hairline)', () => {
    assert.match(homeScreen.template, /<h4 class="ss-section-label">/);
    assert.equal((homeScreen.template.match(/<h4>/g) ?? []).length, 0, 'no plain heading left');
});

test('a quest\'s status tag wraps and never overflows its card', () => {
    assert.match(rule('.chip.status'), /max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
    assert.match(rule('.quest'), /min-width: 0;[^}]*overflow-wrap: anywhere;/);
});
