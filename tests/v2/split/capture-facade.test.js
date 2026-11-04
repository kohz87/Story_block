// capture.js was split into parts (now capture/{lines,blocks,echo,legacy,stray}.js hold the parsing; the entry points extractBlock, stripBlock and hideBlock stay here); this file keeps its old path and every export it had.
// The list is the file's export list from before the split (27 names): each must still be there, of the same kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../../src/v2/capture.js';

const EXPORTS = {
    HIDDEN_MARKER: 'string',
    LEGACY_PROBLEM: 'string',
    MAX_LINE: 'number',
    OPS: 'object',
    STRAY_PARAGRAPHS: 'number',
    adoptLegacy: 'function',
    assistSections: 'function',
    capsOf: 'function',
    continuation: 'function',
    cutLine: 'function',
    defangMarker: 'function',
    extractBlock: 'function',
    grammarHeads: 'function',
    hasHidden: 'function',
    hasLegacy: 'function',
    hideBlock: 'function',
    legacyRead: 'function',
    lineBody: 'function',
    markCaps: 'function',
    markOff: 'function',
    parseChanges: 'function',
    sameChangeLine: 'function',
    strayLines: 'function',
    stripBlock: 'function',
    stripLegacy: 'function',
    withAssist: 'function',
    withoutReasoning: 'function',
};

test('src/v2/capture.js: every pre-split export is still exported, by the same name and kind', () => {
    for (const [name, kind] of Object.entries(EXPORTS)) {
        assert.ok(name in facade, `${name} is no longer exported`);
        assert.equal(typeof facade[name], kind, `${name} changed kind`);
    }
});
