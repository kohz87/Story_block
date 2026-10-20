import test from 'node:test';
import assert from 'node:assert/strict';
import { newBlockId, normalizeBlock, normalizeBlocks, tagFromName, validateBlock } from '../src/schema.js';
import { TEMPLATES, defaultBlocks, templateById, upgradePrompts } from '../src/templates.js';

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

test('the Inventory says to copy unchanged rows word for word, and an unedited one gets the line (0.9.15)', () => {
    const inventory = templateById('inventory');
    assert.match(inventory.prompt, /Copy every row this reply does not change exactly as it was, note included, word for word/);
    assert.match(inventory.prompt, /heal 20, uncommon · ATK \+4/);
    const old = [
        "Everything {{user}}'s party owns or carries: items, money, gear and supplies.",
        'Apply only gains, losses, transfers, spending, consumption and equipment changes that this reply actually completes. Planned, attempted, interrupted, hypothetical or uncertain changes do not count; when a change cannot be worked out safely, keep the previous value instead of guessing. Never create a negative balance.',
    ].join('\n');
    const stored = normalizeBlocks([{ ...inventory, prompt: old }, { ...templateById('world-state') }]);
    const upgraded = upgradePrompts(stored);
    assert.equal(upgraded[0].prompt, inventory.prompt);
    assert.equal(upgraded[1], stored[1]);
    // Edited by the reader: theirs stays. Nothing to bring up: the same list back.
    const edited = normalizeBlocks([{ ...inventory, prompt: `${old}\nKeep it short.` }]);
    assert.equal(upgradePrompts(edited), edited);
    assert.equal(upgradePrompts(upgraded), upgraded);
});
