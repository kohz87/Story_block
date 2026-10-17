import test from 'node:test';
import assert from 'node:assert/strict';
import { newBlockId, normalizeBlock, normalizeBlocks, tagFromName, validateBlock } from '../src/schema.js';
import { TEMPLATES, defaultBlocks, templateById } from '../src/templates.js';

test('templates are valid, unique definitions and only Inventory starts enabled', () => {
    const blocks = defaultBlocks();
    assert.equal(blocks.length, TEMPLATES.length);
    for (const block of blocks) assert.deepEqual(validateBlock(block, blocks), [], block.name);
    assert.deepEqual(blocks.filter(block => block.enabled).map(block => block.id), ['inventory']);
    assert.equal(new Set(blocks.map(block => block.tag.toLowerCase())).size, blocks.length);
    assert.equal(templateById('inventory').display, 'tree');
    assert.equal(templateById('nope'), null);
});

test('normalizeBlock repairs broken input instead of throwing', () => {
    const block = normalizeBlock({ name: '  Quest   Log ', format: 'rows', kind: 'weird', display: 'nope', tag: '1bad', columns: ['Quest'], maxDepth: 99, when: { mode: 'every', every: 0 } });
    assert.equal(block.name, 'Quest Log');
    assert.equal(block.tag, 'Quest_Log');
    assert.equal(block.kind, 'stateful');
    assert.equal(block.display, 'tree');
    assert.deepEqual(block.columns, ['Quest', 'Qty', 'Note']);
    assert.equal(block.maxDepth, 5);
    assert.equal(block.when.every, 2);
    assert.equal(normalizeBlock(null).name, 'Block');
    const fields = normalizeBlock({ name: 'Sheet', format: 'fields', fields: [{ label: 'HP', type: 'meter' }, { label: 'hp' }, { label: '' }, { label: 'Gold', type: 'number' }] });
    assert.deepEqual(fields.fields, [{ label: 'HP', type: 'meter', max: 100 }, { label: 'Gold', type: 'number' }]);
    assert.equal(fields.display, 'fields');
    assert.deepEqual(normalizeBlock({ name: 'K', when: { mode: 'keyword', keywords: 'fight, battle , ' } }).when.keywords, ['fight', 'battle']);
});

test('validateBlock explains every problem', () => {
    const blocks = defaultBlocks();
    const clash = normalizeBlock({ name: 'Bag', tag: 'inventory' });
    assert.match(validateBlock(clash, blocks).join(' '), /already used by Inventory/);
    assert.match(validateBlock(normalizeBlock({ name: 'X', tag: 'details' }), []).join(' '), /reserved/);
    assert.match(validateBlock({ ...normalizeBlock({ name: 'X' }), tag: '9x' }, []).join(' '), /must start with a letter/);
    assert.match(validateBlock(normalizeBlock({ name: 'Empty', format: 'fields' }), []).join(' '), /at least one field/);
    assert.match(validateBlock(normalizeBlock({ name: 'K', when: { mode: 'keyword' } }), []).join(' '), /keyword/);
});

test('ids and tags derive from names; normalizeBlocks drops duplicates', () => {
    assert.equal(tagFromName('  2 Quest log! '), 'Quest_log');
    assert.equal(newBlockId('Inventory', defaultBlocks()), 'inventory-2');
    const list = normalizeBlocks([{ id: 'a', name: 'A', tag: 'Alpha' }, { id: 'a', name: 'B', tag: 'Beta' }, { id: 'c', name: 'C', tag: 'alpha' }, { id: 'd', name: 'D', tag: 'div' }]);
    assert.deepEqual(list.map(block => block.id), ['a']);
});
