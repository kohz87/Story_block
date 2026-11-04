// dataModulesPackHash / dataModuleHash remember the SHA-256 of a text (check.js hashOf): the settings window asks for every pack's hash
// on each open. A hit is the same answer; a changed pack is a different text, so it misses and hashes anew.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dataModulesPackHash, dataModuleHash, hashMemoSize } from '../../../src/v2/data-modules/check.js';

const pack = name => ({ content: { dataModules: [] }, id: 'p1', name, version: '1.0.0' });
const direct = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('a pack hashed again is remembered, and equals the plain SHA-256 of its stable text', () => {
    const one = pack('Alpha');
    const first = dataModulesPackHash(one);
    const size = hashMemoSize();
    assert.equal(dataModulesPackHash(one), first);
    assert.equal(dataModulesPackHash(structuredClone(one)), first, 'the same content, another object: the same hash');
    assert.equal(hashMemoSize(), size, 'no new text was hashed');
    assert.equal(first, direct(JSON.parse(JSON.stringify(one))), 'keys are already in order here, so the stable text is the plain one');
});

test('a changed pack misses: its hash is another, and the old one stays right', () => {
    const one = pack('Beta');
    const first = dataModulesPackHash(one);
    one.name = 'Beta 2';
    const second = dataModulesPackHash(one);
    assert.notEqual(second, first);
    one.name = 'Beta';
    assert.equal(dataModulesPackHash(one), first);
    const definition = { id: 'm', stateVersion: 1 };
    const before = dataModuleHash(definition);
    assert.equal(dataModuleHash({ ...definition }), before);
    assert.notEqual(dataModuleHash({ ...definition, stateVersion: 2 }), before);
});

test('the memo is bounded', () => {
    for (let i = 0; i < 200; i++) dataModulesPackHash(pack(`n${i}`));
    assert.ok(hashMemoSize() <= 64);
});
