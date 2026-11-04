// INT-222: strings.js had two `card` keys in the Blocks editor strings, so the function kind "Card" read "Card on Home".
// The function kind is now `cardKind` ("Card"); `card` stays the Show-as choice ("Card on Home").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS } from '../../src/v2/strings.js';

test('the Blocks editor has one `card` label (Show as: Card on Home) and a separate `cardKind` label for the Card function', () => {
    assert.equal(STRINGS.blocks.card, 'Card on Home');
    assert.equal(STRINGS.blocks.cardKind, 'Card');
    const source = readFileSync(new URL('../../src/v2/strings.js', import.meta.url), 'utf8');
    assert.equal((source.match(/(?<![\w.])card: 'Card/gu) ?? []).filter(Boolean).length, 1, 'only one "card: \'Card…\'" label in the blocks strings');
});
