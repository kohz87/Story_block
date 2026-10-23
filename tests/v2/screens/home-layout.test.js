// Home's hero card on a phone (hotfix): the portrait left, the name, level and bars right filling the card at every width, and a status tag
// that wraps instead of leaving its card. The CSS is the screen's own (src/v2/screens/home.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { homeScreen } from '../../../src/v2/screens/home.js';

const css = homeScreen.css;
const rule = selector => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} has a rule`);
    return css.slice(at, css.indexOf('}', at));
};

test('the hero is a row at every width: no narrow-screen rule turns it into a centred column', () => {
    assert.match(rule('.hero'), /display: flex;\s*flex-direction: row;/);
    assert.match(rule('.hero'), /text-align: start;/);
    assert.doesNotMatch(css, /@media[^{]*max-width[^{]*\{\s*\.hero\b/, 'no media rule for the hero');
    assert.doesNotMatch(css, /flex-direction: column; text-align: center/);
    assert.match(rule('.hero .face'), /flex: none;/, 'the portrait keeps its size');
    assert.match(rule('.who'), /flex: 1 1 0;\s*min-width: 0;/, 'the name and bars take the rest of the card');
    assert.match(rule('.pools'), /min-width: 0;/);
});

test('a quest\'s status tag wraps and never overflows its card', () => {
    assert.match(rule('.chip.status'), /max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
    assert.match(rule('.quest'), /min-width: 0;[^}]*overflow-wrap: anywhere;/);
});
