// The literal vectors a rules module runs to prove it hashes what Story Block hashes
// (fixtures/rules-seam-vectors.js): normalized JSON and the equip plan's inputHash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashOf, normalizedJson, sha256Hex } from '../../../src/v2/domains/digest.js';
import { equipInputHash } from '../../../src/v2/domains/inventory.js';
import { EQUIP_INPUT_HASH_CASES, NORMALIZED_JSON_CASES } from './fixtures/rules-seam-vectors.js';

test('normalized JSON and its hash match the literal vectors', () => {
    for (const { what, input, text, hash } of NORMALIZED_JSON_CASES) {
        assert.equal(normalizedJson(input()), text, what);
        assert.equal(hashOf(input()), hash, what);
        assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'), what);
    }
    assert.ok(NORMALIZED_JSON_CASES.length >= 5);
});

test('the equip inputHash matches the literal vectors', () => {
    for (const { what, input, text, hash } of EQUIP_INPUT_HASH_CASES) {
        assert.equal(equipInputHash(input()), hash, what);
        assert.equal(createHash('sha256').update(text).digest('hex'), hash, `${what}: the text is what is hashed`);
    }
});
