import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/check-card.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');

test('every Check card rule is scoped to its own root', () => {
    const selectors = [...css.matchAll(/(?:^|\})\s*([^{}@]+)\{/gu)].flatMap(match => match[1].split(',')).map(part => part.trim()).filter(Boolean);
    assert.ok(selectors.length > 5);
    for (const selector of selectors) assert.ok(selector.startsWith('.rpg-check'), `not scoped: ${selector}`);
});

test('the card uses theme tokens, never a fixed colour', () => {
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu);
    assert.match(css, /var\(--ss-text\)/u);
    assert.match(css, /var\(--ss-good\b/u);
});
