// Beta-candidate break (a3, B-a3-2/3): Diagnostics removes common key shapes in any value, and a quote mark
// with no partner never lets chat text through scrubLine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REMOVED, scrubLine, scrubSecrets } from '../../src/v2/diagnostics.js';

test('key shapes are removed: short sk-/pk- keys, JWTs, long letter-and-digit runs; plain words and ids stay', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0In0', 'c2lnbmF0dXJlLXZhbHVl'].join('.');
    for (const key of ['sk-FAKE12345', 'pk-abcdefgh9', jwt, 'abcd1234efgh5678ijkl9012', 'AKIA' + 'ABCDEFGHIJKLMNOP']) {
        assert.equal(scrubSecrets(`value ${key} here`), `value ${REMOVED} here`, key);
    }
    for (const kept of ['story-block', 'npc-state-delta.scannerConnectionProfile', 'tailBudget 600', 'Bluewatch Village', 'abcdefghijklmnopqrstuvwxyz']) {
        assert.equal(scrubSecrets(kept), kept);
    }
});

test('scrubLine: from the first quote mark to the last goes, and a lone quote mark takes the rest of the line', () => {
    assert.equal(scrubLine('was "Bob\'s "Lucky" mug" here'), 'was "[17 characters]" here');
    assert.equal(scrubLine('it said “Anna was here'), 'it said "[13 characters]"');
    assert.equal(scrubLine('no quotes at all'), 'no quotes at all');
});
