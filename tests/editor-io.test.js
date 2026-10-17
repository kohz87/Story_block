// Import / export of block lists. Imported JSON comes from files people share, so
// every malformed shape must come back as a readable error, never a throw.
import test from 'node:test';
import assert from 'node:assert/strict';

import { exportBlocks, importBlocks } from '../src/ui/editor.js';
import { defaultBlocks } from '../src/templates.js';
import { normalizeBlocks } from '../src/schema.js';

const quests = { id: 'quests', name: 'Quests', icon: '📜', tag: 'Quests', format: 'text', kind: 'stateful', prompt: 'Open quests.' };

test('export is pretty JSON with version 1 and normalized blocks', () => {
    const json = exportBlocks([...defaultBlocks(), { ...quests, junk: 'dropped' }]);
    assert.match(json, /^\{\n {4}"version": 1,\n {4}"blocks": \[/);
    const parsed = JSON.parse(json);
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.blocks.map(block => block.id), ['inventory', 'character-sheet', 'scene-notes', 'quests']);
    assert.equal('junk' in parsed.blocks[3], false);
});

test('round-trip: exporting then importing into an empty list gives the same blocks', () => {
    const blocks = normalizeBlocks([...defaultBlocks(), quests]);
    const { blocks: imported, errors, imported: count } = importBlocks(exportBlocks(blocks), []);
    assert.deepEqual(errors, []);
    assert.equal(count, 4);
    assert.deepEqual(imported, blocks);
    // Importing the same export again replaces every block in place: nothing duplicates.
    assert.deepEqual(importBlocks(exportBlocks(blocks), blocks).blocks, blocks);
});

test('accepts a bare array, a single definition, or already-parsed data', () => {
    assert.deepEqual(importBlocks(JSON.stringify([quests]), []).blocks.map(block => block.id), ['quests']);
    assert.deepEqual(importBlocks(JSON.stringify(quests), []).blocks.map(block => block.tag), ['Quests']);
    assert.deepEqual(importBlocks({ version: 1, blocks: [quests] }, []).blocks.map(block => block.id), ['quests']);
});

test('merges by id: same id replaces in place, new ones are appended', () => {
    const existing = defaultBlocks();
    const changed = { ...existing[0], name: 'Pack', prompt: 'Only the pack.' };
    const { blocks, errors } = importBlocks(JSON.stringify([quests, changed]), existing);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocks.map(block => block.id), ['inventory', 'character-sheet', 'scene-notes', 'quests']);
    assert.equal(blocks[0].name, 'Pack');
    assert.equal(blocks[0].prompt, 'Only the pack.');
});

test('a definition without an id is appended with a fresh id instead of replacing', () => {
    const { blocks, errors } = importBlocks(JSON.stringify({ name: 'Inventory', tag: 'Loot', format: 'text' }), defaultBlocks());
    assert.deepEqual(errors, []);
    assert.equal(blocks.length, 4);
    assert.equal(blocks[0].tag, 'Inventory', 'the existing Inventory is untouched');
    assert.equal(blocks[3].id, 'inventory-2');
    assert.equal(blocks[3].tag, 'Loot');
});

test('tag clashes and invalid definitions are rejected one by one with readable errors', () => {
    const existing = defaultBlocks();
    const { blocks, errors, imported } = importBlocks(JSON.stringify({
        version: 1,
        blocks: [
            { id: 'bag', name: 'Bag', tag: 'INVENTORY', format: 'text' },
            quests,
            { id: 'q2', name: 'Quests Again', tag: 'quests', format: 'text' },
            { id: 'sheet', name: 'Sheet', tag: 'Sheet', format: 'fields', fields: [] },
            { id: 'html', name: 'Html', tag: 'div' },
            'not a block',
        ],
    }), existing);
    assert.equal(imported, 1);
    assert.deepEqual(blocks.map(block => block.id), ['inventory', 'character-sheet', 'scene-notes', 'quests']);
    assert.equal(errors.length, 5);
    assert.match(errors[0], /^"Bag" was not imported: The tag "INVENTORY" is already used by Inventory\.$/);
    assert.match(errors[1], /"Quests Again" was not imported: .*already used by Quests/, 'clashes with a block imported earlier in the same file');
    assert.match(errors[2], /"Sheet" was not imported: A Fields block needs at least one field\./);
    assert.match(errors[3], /"Html" was not imported: "div" is reserved/);
    assert.match(errors[4], /Entry 6 is not a block definition/);
});

test('replacing a block may keep its own tag, but not take another block\'s', () => {
    const existing = defaultBlocks();
    const keep = importBlocks(JSON.stringify({ ...existing[0], name: 'Renamed' }), existing);
    assert.deepEqual(keep.errors, []);
    const steal = importBlocks(JSON.stringify({ ...existing[0], tag: 'Scene_Notes' }), existing);
    assert.equal(steal.errors.length, 1);
    assert.equal(steal.blocks[0].tag, 'Inventory', 'the rejected import changes nothing');
});

test('bad JSON and wrong shapes give an error, never a throw', () => {
    const existing = defaultBlocks();
    for (const input of ['{ not json', '', '   ', 'null', '42', '"text"', '{"version":1}', '{}', '[]', undefined, null]) {
        let result;
        assert.doesNotThrow(() => { result = importBlocks(input, existing); }, String(input));
        assert.ok(result.errors.length >= 1, `error for ${String(input)}`);
        assert.deepEqual(result.blocks, existing, `existing list kept for ${String(input)}`);
    }
    assert.match(importBlocks('{ not json', []).errors[0], /not valid JSON/);
});
