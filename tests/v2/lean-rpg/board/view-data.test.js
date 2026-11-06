// The member board's pure labels: numbered target lines, pack thinning, standing groups and the grouped order sentence.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boardChoices, memberGroups, memberOrderLine, memberPackLine, memberTargetLine } from '../../../../src/v2/lean-rpg/board/view-data.js';
import { character, levelFoeBlock, sheetDomain, skillBlock } from '../helpers.js';

const member = (slot, n, value, over = {}) => ({ slot, group: 1, n, name: `Bristle-boar ${n}`, value, size: 4, pack: false, count: 1,
    left: value > 0 ? 1 : 0, attacks: value > 0 ? 1 : 0, standing: value > 0, ...over });

test('member target and pack lines use the board words, not a level parenthetical', () => {
    assert.equal(memberTargetLine(member(11, 1, 4), 1), '1. Bristle-boar 1  Unhurt');
    assert.equal(memberTargetLine(member(12, 2, 0), 2), '2. Bristle-boar 2  Down');
    assert.equal(memberPackLine({ left: 8, attacks: 2 }), 'About 8 left · 2 attacks each exchange');
    assert.equal(memberPackLine({ left: 1, attacks: 1 }), 'About 1 left · 1 attack each exchange');
});

test('standing groups keep real-slot order, drop all-Down groups, and collapse the turn order', () => {
    const members = [member(11, 1, 4), member(12, 2, 0), member(13, 3, 2), member(21, 1, 0, { group: 2, name: 'Spiders' })];
    const foes = [{ slot: 1, name: 'Bristle-boar' }, { slot: 2, name: 'Spider' }];
    assert.deepEqual(memberGroups(members, foes).map(group => [group.group, group.label]), [[1, 'Bristle-boars']]);
    const order = [{ id: 'c:astra', name: 'Astra', party: true }, { id: 'f:11', name: 'Bristle-boar 1', party: false },
        { id: 'f:12', name: 'Bristle-boar 2', party: false }, { id: 'f:13', name: 'Bristle-boar 3', party: false }];
    assert.equal(memberOrderLine(order, members, foes), 'Order: Astra · Bristle-boars (1, 3) · 2 attacks on you each exchange');
});

test('real foe names keep trailing numbers while virtual suffixes are removed', () => {
    const trolls = [member(11, 1, 4, { name: 'Troll 2 1' }), member(12, 2, 4, { name: 'Troll 2 2' })];
    assert.equal(memberGroups(trolls, [{ slot: 1, name: 'Troll 2' }])[0].label, 'Troll 2s');
    assert.equal(memberGroups(trolls)[0].label, 'Troll 2s');
    const packs = [member(11, 1, 4, { name: 'Troll 2 pack 1', pack: true })];
    assert.equal(memberGroups(packs, [{ slot: 1, name: 'Troll 2' }])[0].label, 'Troll 2s');
    assert.equal(memberGroups(packs)[0].label, 'Trolls');
});

test('a pack reads as one group and an area skill offers groups only when several stand', () => {
    const pack = { slot: 31, group: 3, n: 1, name: 'Cellar-rats', value: 5, size: 8, pack: true, count: 12, left: 8, attacks: 2, standing: true };
    assert.deepEqual(memberGroups([pack], [{ slot: 3, name: 'Cellar-rats' }]).map(group => group.label), ['Cellar-rats']);
    assert.equal(memberOrderLine([{ id: 'c:astra', name: 'Astra', party: true }, { id: 'f:31', party: false }], [pack], [{ slot: 3, name: 'Cellar-rats' }]),
        'Order: Astra · Cellar-rats · 2 attacks on you each exchange');
    const state = { domains: { dataModules: sheetDomain({
        hero: { role: 'character', fields: character('Astra') },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Shadow Cut', 1, 'int', 'mana', 'sweep every foe']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Bristle-boar', 3, 1, 4], ['Spiders', 2, 1, 4]]) },
    }) } };
    const grouped = boardChoices(state, {}, [], [{ group: 1, label: 'Bristle-boars' }, { group: 2, label: 'Spiders' }]);
    const ordinary = boardChoices(state, {}, [], null);
    assert.match(grouped.choices.find(choice => choice.action.area).label, /— one group$/u);
    assert.match(ordinary.choices.find(choice => choice.action.area).label, /— every foe$/u);
});
