// render.js was split into parts (see src/v2/render/); this file keeps its old path and every export it had.
// The list is the file's export list from before the split (3 names): each must still be there, of the same kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../../src/v2/view/template/render.js';

const EXPORTS = {
    MAX_ELEMENTS: 'number',
    destroyTemplate: 'function',
    renderTemplate: 'function',
};

test('src/v2/view/template/render.js: every pre-split export is still exported, by the same name and kind', () => {
    for (const [name, kind] of Object.entries(EXPORTS)) {
        assert.ok(name in facade, `${name} is no longer exported`);
        assert.equal(typeof facade[name], kind, `${name} changed kind`);
    }
});
