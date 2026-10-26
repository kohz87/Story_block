import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_LIMITS } from '../../../src/v2/packs/limits.js';
import { validatePack, slugify } from '../../../src/v2/packs/validate.js';

test('public host record bounds match the validator and derived slugs', () => {
    assert.ok(Object.isFrozen(RECORD_LIMITS));
    assert.deepEqual(RECORD_LIMITS, { slug: 64, note: 500, word: 40, element: 24 });
    assert.equal(slugify('a'.repeat(RECORD_LIMITS.slug + 1)).length, RECORD_LIMITS.slug);
    for (const [field, limit] of [['note', RECORD_LIMITS.note], ['slot', RECORD_LIMITS.word]]) {
        const pack = { id: 'limits', version: '1.0.0', requires: { storyBlock: '^2' },
            content: { items: [{ name: 'Item', [field]: 'a'.repeat(limit) }] } };
        assert.equal(validatePack(pack).ok, true);
        pack.content.items[0][field] += 'a';
        assert.equal(validatePack(pack).ok, false);
    }
});
