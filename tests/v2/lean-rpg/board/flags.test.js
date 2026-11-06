// Skill flag defaults and explicit choices are read without migrating old sheets.
// These tests exercise the same functions used by the board.

import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFlags, skillFlags, skillKey } from '../../../../src/v2/lean-rpg/board/flags.js';

test('skill wording supplies target, area and defence defaults independently', () => {
    assert.deepEqual(defaultFlags({ name: 'Iaijutsu', about: 'draw-cut from the sheath' }), { target: true, area: false, defence: false });
    assert.deepEqual(defaultFlags({ name: 'Shadow Cut', about: 'sweep every foe in reach' }), { target: false, area: true, defence: false });
    assert.deepEqual(defaultFlags({ name: 'Shadow Step', about: 'an evasion that wards every foe' }), { target: false, area: true, defence: true });
});

test('explicit flags win independently and another skill in the slot has a different key', () => {
    const first = { slot: 1, name: 'Step', about: 'dodge' };
    assert.deepEqual(skillFlags(first, { target: true, defence: false }), { target: true, area: false, defence: false });
    assert.notEqual(skillKey('skills', first), skillKey('skills', { ...first, name: 'Cut' }));
    assert.equal(skillKey('skills', first), skillKey('skills', { ...first, name: 'STEP' }));
});
