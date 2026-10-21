// The live capability list reads sdk.modules(), whose domains are an array of names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stCapabilities } from '../../../src/v2/packs/st-adapter.js';

test('stCapabilities names the domains sdk.modules() lists', () => {
    const before = globalThis.StoryBlock;
    globalThis.StoryBlock = { sdk: { modules: () => [
        { id: 'story-block', domains: ['scene', 'inventory'] },
        { id: 'rpg-battle', domains: ['party', 'combat'], capabilities: ['fights'] },
        { id: 'old-shape', domains: { chronicle: {} } },
    ] } };
    try {
        const names = stCapabilities();
        for (const name of ['story-block', 'scene', 'inventory', 'rpg-battle', 'party', 'combat', 'fights', 'old-shape', 'chronicle']) assert.ok(names.includes(name), name);
        assert.ok(!names.includes('0') && !names.includes('1'));
    } finally {
        globalThis.StoryBlock = before;
    }
});
