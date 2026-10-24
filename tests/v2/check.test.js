// sdk.check: small validators that return '' or a short phrase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrayOf, bool, id, int, isId, oneOf, record, str } from '../../src/v2/check.js';

test('int: whole numbers within optional bounds', () => {
    assert.equal(int(3), '');
    assert.equal(int(0, { min: 0 }), '');
    assert.equal(int(-1, { min: 0 }), 'must be 0 or more');
    assert.equal(int(11, { max: 10 }), 'must be 10 or less');
    for (const bad of [1.5, NaN, Infinity, '3', null, undefined]) assert.equal(int(bad), 'must be a whole number');
});

test('str: text with optional length bounds', () => {
    assert.equal(str('Ren'), '');
    assert.equal(str('', { min: 1 }), 'must not be empty');
    assert.equal(str('ab', { min: 3 }), 'must be at least 3 characters');
    assert.equal(str('abcd', { max: 3 }), 'must be at most 3 characters');
    assert.equal(str(3), 'must be text');
});

test('oneOf', () => {
    assert.equal(oneOf('rare', ['common', 'rare']), '');
    assert.equal(oneOf('epic', ['common', 'rare']), 'must be one of: common, rare');
    assert.equal(oneOf('x', null), 'must be one of: ');
});

test('id: record IDs by prefix, definition slugs without one', () => {
    assert.equal(id('it_k3f9a2qz', 'it'), '');
    assert.equal(id('ac_k3f9a2qz', 'it'), 'must be an ID like it_k3f9a2qz');
    assert.equal(id('it_k3f9a2q', 'it'), 'must be an ID like it_k3f9a2qz', 'seven characters');
    assert.equal(id('it_K3F9A2QZ', 'it'), 'must be an ID like it_k3f9a2qz', 'lower case only');
    assert.equal(id('story/moonveil-trout'), '');
    assert.equal(id('pack.fantasy/iron-sword'), '');
    assert.equal(id('rc_00000001'), '');
    assert.equal(id('story/moonveil-trout', 'it'), 'must be an ID like it_k3f9a2qz');
    for (const bad of ['Moonveil Trout', 'story/', '/trout', 'story/Trout', 'it_', '', 7, null]) {
        assert.equal(id(bad), 'must be an ID like it_k3f9a2qz or story/moonveil-trout', String(bad));
    }
    assert.equal(isId('q_ab12cd34', 'q'), true);
});

test('bool', () => {
    assert.equal(bool(false), '');
    assert.equal(bool(0), 'must be true or false');
});

test('arrayOf and record build checks for lists and ID-keyed records', () => {
    const counts = arrayOf(v => int(v, { min: 0 }));
    assert.equal(counts([0, 2]), '');
    assert.equal(counts([0, -2]), 'item 2 must be 0 or more');
    assert.equal(counts('x'), 'must be a list');

    const stacks = record(stack => int(stack?.qty, { min: 0 }) && `qty ${int(stack?.qty, { min: 0 })}`, key => id(key, 'it'));
    assert.equal(stacks({ it_k3f9a2qz: { qty: 1 } }), '');
    assert.equal(stacks({ it_k3f9a2qz: { qty: -1 } }), 'it_k3f9a2qz qty must be 0 or more');
    assert.equal(stacks({ nope: { qty: 1 } }), 'key nope must be an ID like it_k3f9a2qz');
    assert.equal(stacks([]), 'must be a record (an object keyed by ID)');
    assert.equal(stacks(null), 'must be a record (an object keyed by ID)');
    assert.equal(record(bool)({}), '');
});
