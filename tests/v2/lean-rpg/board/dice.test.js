// Board dice are keyed by the opening reply, attempt and exchange.
// Replaying or undoing an exchange must reproduce its independent stream.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boardDice, fightSeed } from '../../../../src/v2/lean-rpg/board/dice.js';

test('the same opening and choices give the same dice, while discard changes the seed', () => {
    const seed = fightSeed('reply-id', 0);
    const sample = number => { const roll = boardDice(seed, number)('act', 0); return Array.from({ length: 8 }, roll); };
    assert.deepEqual(sample(1), sample(1));
    assert.notDeepEqual(sample(1), sample(2));
    assert.notEqual(seed, fightSeed('reply-id', 1));
});
