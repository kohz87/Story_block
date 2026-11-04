// host-ui.js was split into parts (see src/v2/host-ui/); this file keeps its old path and every export it had.
// The list is the file's export list from before the split (30 names): each must still be there, of the same kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../../src/v2/host-ui.js';

const EXPORTS = {
    DIAGNOSTICS_FOLD: 'string',
    DIAGNOSTICS_TEXT: 'object',
    EVENTS_FOLD: 'string',
    FEATURES_FOLD: 'string',
    FEATURE_TEXT: 'object',
    HOST_FOLD: 'string',
    OPEN_CLASS: 'string',
    PACKS_FOLD: 'string',
    SENT_FOLD: 'string',
    SETTINGS_TEXT: 'object',
    SUB_FOLD: 'string',
    TABS_FOLD: 'string',
    TABS_TEXT: 'object',
    VERSIONS_FOLD: 'string',
    createTabHost: 'function',
    diagnosticsKeys: 'function',
    emptyValue: 'function',
    featureInputId: 'function',
    featuresFoldOf: 'function',
    fieldReadOnly: 'function',
    groupFields: 'function',
    linesToList: 'function',
    listTextFields: 'function',
    listToLines: 'function',
    promptSize: 'function',
    readInt: 'function',
    redactSentOf: 'function',
    renderSettingsHost: 'function',
    rowValue: 'function',
    sentText: 'function',
};

test('src/v2/host-ui.js: every pre-split export is still exported, by the same name and kind', () => {
    for (const [name, kind] of Object.entries(EXPORTS)) {
        assert.ok(name in facade, `${name} is no longer exported`);
        assert.equal(typeof facade[name], kind, `${name} changed kind`);
    }
});
