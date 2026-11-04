// registry.js was split into parts (now registry-checks.js holds the definition checks; createRegistry stays here); this file keeps its old path and every export it had.
// The list is the file's export list from before the split (13 names): each must still be there, of the same kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../../src/v2/registry.js';

const EXPORTS = {
    CAPTURE_PREFIX: 'string',
    FIELD_TYPES: 'object',
    HOST_MODULE: 'string',
    INIT_PREFIX: 'string',
    MAX_CAPABILITIES: 'number',
    RESTORE_STATES: 'object',
    SETTINGS_PLACES: 'object',
    STANDARD_PREFIX: 'string',
    createRegistry: 'function',
    definitionProblems: 'function',
    definitionWarnings: 'function',
    jsonProblem: 'function',
    normalizeField: 'function',
};

test('src/v2/registry.js: every pre-split export is still exported, by the same name and kind', () => {
    for (const [name, kind] of Object.entries(EXPORTS)) {
        assert.ok(name in facade, `${name} is no longer exported`);
        assert.equal(typeof facade[name], kind, `${name} changed kind`);
    }
});
