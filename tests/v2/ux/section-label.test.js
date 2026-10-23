// The section label (glass.css, shared by Story Block, Story Director and rpg_battle): the rule passes through the middle
// of the capitals. Nunito's capitals sit 0.078em above the middle of the line box (measured live: 1.09px at 14px), so the
// rule is moved up by that much. The label's line-height is 1, and the rule is centred in the row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const glass = readFileSync(new URL('../../../src/v2/view/glass.css', import.meta.url), 'utf8');
const block = selector => {
    const at = glass.indexOf(selector);
    assert.ok(at >= 0, `${selector} is in glass.css`);
    return glass.slice(glass.indexOf('{', at) + 1, glass.indexOf('}', at));
};

test('the label: a flex row, its text at line-height 1, the icon and the text centred', () => {
    const label = block(') .ss-section-label {');
    assert.match(label, /display: flex;/);
    assert.match(label, /align-items: center;/);
    assert.match(label, /line-height: 1;/);
});

test('the rule: a 1px element centred in the row, moved up by the measured cap offset', () => {
    const rule = block(') .ss-section-label::after {');
    assert.match(rule, /height: 1px;/);
    assert.match(rule, /align-self: center;/);
    assert.match(rule, /transform: translateY\(-0\.078em\);/, 'the Nunito cap offset, in em (1.09px at 14px)');
    assert.doesNotMatch(rule, /margin-(top|bottom)/, 'no margin offsets');
});
