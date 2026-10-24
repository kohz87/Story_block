// The hash both sides of the rules seam compute (RB_CONTRACT §4: SHA-256 of normalized JSON, sorted keys,
// array order kept), synchronously, with no Node built-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashOf, isHash, normalizedJson, sha256Hex } from '../../../src/v2/domains/digest.js';

test('SHA-256 agrees with the reference on short, block-edge, long and non-ASCII input', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const text of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'x'.repeat(1000), 'é魔剣🙂 ok', 'line\nbreak']) {
        assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'), text.slice(0, 12));
    }
});

test('normalized JSON: keys sorted at every depth, arrays in order, no spaces', () => {
    assert.equal(normalizedJson({ b: [3, { z: 1, a: [2, 1] }], a: 'é', c: null, d: undefined }), '{"a":"é","b":[3,{"a":[2,1],"z":1}],"c":null}');
    assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 }));
    assert.notEqual(hashOf([1, 2]), hashOf([2, 1]), 'array order counts');
    assert.equal(hashOf({ id: 'story/rope' }), createHash('sha256').update('{"id":"story/rope"}').digest('hex'));
    assert.throws(() => normalizedJson({ n: NaN }), TypeError);
    assert.throws(() => normalizedJson({ f() {} }), TypeError);
    assert.equal(isHash(hashOf({})), true);
    assert.equal(isHash('A'.repeat(64)), false);
    assert.equal(isHash('a'.repeat(63)), false);
});
