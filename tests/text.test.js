import test from 'node:test';
import assert from 'node:assert/strict';
import { countWords, foldKey, oneLine } from '../src/text.js';

test('oneLine folds whitespace and cuts only when asked', () => {
    assert.equal(oneLine('  a\n\tb   c  '), 'a b c');
    assert.equal(oneLine('abcdef', 3), 'abc');
    assert.equal(oneLine(null), '');
});

test('foldKey matches NFKC forms regardless of case and edges', () => {
    assert.equal(foldKey(' Ｐotion '), 'potion');
    assert.equal(foldKey(undefined), '');
});

test('countWords counts whitespace-separated words', () => {
    assert.equal(countWords('  one two\nthree '), 3);
    assert.equal(countWords(''), 0);
});
