// store.js was split into parts (see src/v2/store/); this file keeps its old path and every export it had.
// The list is the file's export list from before the split (6 names): each must still be there, of the same kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../../src/v2/store.js';

const EXPORTS = {
    CHECKPOINT_BYTES: 'number',
    CHECKPOINT_EVERY: 'number',
    CHECKPOINT_MIN_GAP: 'number',
    NO_LONGER_DONE: 'string',
    createStore: 'function',
    deepFreeze: 'function',
};

test('src/v2/store.js: every pre-split export is still exported, by the same name and kind', () => {
    for (const [name, kind] of Object.entries(EXPORTS)) {
        assert.ok(name in facade, `${name} is no longer exported`);
        assert.equal(typeof facade[name], kind, `${name} changed kind`);
    }
});
