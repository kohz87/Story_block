// turn.js was split into parts (see src/v2/turn/); this file keeps its old path and every export it had.
// The list is the file's export list from before the split (24 names): each must still be there, of the same kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../../src/v2/turn.js';

const EXPORTS = {
    ASSIST_WAIT_MS: 'number',
    FOREGROUND: 'object',
    HOOK_TIMEOUT_MS: 'number',
    INTERCEPTOR_NAME: 'string',
    MAX_NAME: 'number',
    OWN_PROMPT_CHARS: 'number',
    OWN_PROMPT_PARTS: 'number',
    QUIET_MARK_MIN: 'number',
    QUIET_WAIT_MS: 'number',
    REPLY_BUSY_MAX_MS: 'number',
    RPG_LOAD_WAIT_MS: 'number',
    STATIC_KEY: 'string',
    TAIL_KEY: 'string',
    V1_KEYS: 'object',
    contextRoom: 'function',
    createTurn: 'function',
    defuseMacros: 'function',
    flatName: 'function',
    hookTimeout: 'function',
    normalizeType: 'function',
    quietMark: 'function',
    restoreMissing: 'function',
    stripBattleMarker: 'function',
    substituteNames: 'function',
};

test('src/v2/turn.js: every pre-split export is still exported, by the same name and kind', () => {
    for (const [name, kind] of Object.entries(EXPORTS)) {
        assert.ok(name in facade, `${name} is no longer exported`);
        assert.equal(typeof facade[name], kind, `${name} changed kind`);
    }
});
