// inventory.js was split into parts (see src/v2/inventory/); this file keeps its old path and every export it had.
// The list is the file's export list from before the split (59 names): each must still be there, of the same kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../../src/v2/domains/inventory.js';

const EXPORTS = {
    CARRY_MAX: 'number',
    COND_LOG_MAX: 'number',
    COND_MAX: 'number',
    DEFINITIONS_MAX_IDS: 'number',
    ECONOMY_SCALE: 'object',
    ENCUMBERED_PENALTY: 'number',
    ENCUMBERED_STATS: 'object',
    FEATURE: 'object',
    GONE_WORDS: 'object',
    INVENTORY_EDIT_GUARD: 'string',
    INVENTORY_FEATURES: 'object',
    KINDS: 'object',
    KIND_ORDER: 'object',
    LOOT_GUARD: 'string',
    LOOT_ITEMS: 'number',
    LOOT_KEEP: 'number',
    LOOT_KINDS: 'object',
    LOOT_OFFER: 'string',
    MANY_SLOTS: 'object',
    MAX_MANY: 'number',
    RARITIES: 'object',
    STORY_WEAR: 'object',
    TOLD: 'object',
    USED_WORDS: 'object',
    WALLET_NOTE: 'string',
    baseSlot: 'function',
    canWear: 'function',
    captureCoin: 'function',
    captureItem: 'function',
    captureLoot: 'function',
    carryBonuses: 'function',
    condEvents: 'function',
    condOf: 'function',
    createInventoryCommands: 'function',
    createInventoryQueries: 'function',
    defCarry: 'function',
    defaultDef: 'function',
    definitionsOf: 'function',
    economyOf: 'function',
    encumbrance: 'function',
    encumbranceTail: 'function',
    equipmentView: 'function',
    featureOn: 'function',
    gearOn: 'function',
    initialInventory: 'function',
    inventoryEditGuard: 'function',
    inventoryTail: 'function',
    itemText: 'function',
    kitOpen: 'function',
    legendEarned: 'function',
    listItems: 'function',
    lootTakeGuard: 'function',
    packCarry: 'function',
    promptNote: 'function',
    scaledDefault: 'function',
    slotLimits: 'function',
    usedByLine: 'function',
    validateInventory: 'function',
    wearWord: 'function',
};

test('src/v2/domains/inventory.js: every pre-split export is still exported, by the same name and kind', () => {
    for (const [name, kind] of Object.entries(EXPORTS)) {
        assert.ok(name in facade, `${name} is no longer exported`);
        assert.equal(typeof facade[name], kind, `${name} changed kind`);
    }
});
