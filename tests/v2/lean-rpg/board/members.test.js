// Foe members and packs: the pure split, pack formula, collapse, kept-bar and board-list rules.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MEMBER_CAP, PACK_MAX_ATTACKS, PACK_MAX_SIZE, boardFoes, collapseFoes, keptFrom, matchesBlock, memberSize,
    packAreaBlocks, packAttacks, packCounts, packFullAttacks, packLeft, packSize, splitFoes, virtualSlot,
} from '../../../../src/v2/lean-rpg/board/members.js';

const realFoe = (over = {}) => ({
    slot: 1, module: 'foes', name: 'Bristle-boar', count: 3, class: 1, level: 1, levelled: true, hurt: 4, filled: true, ...over,
});
const map = entries => new Map(entries);

test('the constants, even pack split, formulas and area blocks follow the approved rules', () => {
    assert.equal(MEMBER_CAP, 5);
    assert.equal(PACK_MAX_SIZE, 12);
    assert.equal(PACK_MAX_ATTACKS, 3);
    assert.deepEqual(packCounts(13), [7, 6]);
    assert.deepEqual(packCounts(25), [9, 8, 8]);
    assert.deepEqual(packCounts(40), [10, 10, 10, 10]);
    assert.deepEqual(packCounts(99), [11, 11, 11, 11, 11, 11, 11, 11, 11]);
    assert.deepEqual(packCounts(12), [12]);
    assert.deepEqual(packCounts(6), [6]);
    assert.equal(memberSize(realFoe({ size: 6 })), 6, 'a levelled size wins');
    assert.equal(memberSize(realFoe({ level: 30, size: undefined })), 5, 'level 30 has five blocks');
    assert.equal(memberSize(realFoe({ levelled: false, class: 9 })), 7, 'an old class still sizes its bar');
    let asked = null;
    assert.equal(memberSize(realFoe({ slot: 4 }), (module, field) => { asked = [module, field]; return 3; }), 3);
    assert.deepEqual(asked, ['foes', 'hurt4']);
    assert.equal(packSize(4, 12), 8);
    assert.equal(packSize(6, 12), 10);
    assert.equal(packSize(4, 10), 7);
    assert.equal(packSize(7, 40), 12);
    assert.equal(packFullAttacks(6), 2);
    assert.equal(packFullAttacks(7), 2);
    assert.equal(packFullAttacks(8), 2);
    assert.equal(packFullAttacks(10), 2);
    assert.equal(packFullAttacks(12), 3);
    assert.equal(packFullAttacks(40), 3);
    assert.equal(packAttacks(12, 8, 8), 3);
    assert.equal(packAttacks(12, 5, 8), 2);
    assert.equal(packAttacks(12, 2, 8), 1);
    assert.equal(packAttacks(12, 0, 8), 0);
    assert.equal(packAttacks(10, 3, 7), 1);
    assert.equal(packAttacks(10, 7, 7), 2);
    assert.equal(packLeft(12, 8, 8), 12);
    assert.equal(packLeft(12, 5, 8), 8);
    assert.equal(packLeft(12, 2, 8), 3);
    assert.equal(packLeft(12, 0, 8), 0);
    assert.equal(packAreaBlocks(8, false), 3);
    assert.equal(packAreaBlocks(8, true), 4);
    assert.equal(packAreaBlocks(10, false), 4);
    assert.equal(packAreaBlocks(7, false), 3);
    assert.equal(virtualSlot(3, 1), 31);
    assert.equal(virtualSlot(3, 2), 32);
});

test('the SPEC table splits rats, level-60 wolves and forty gnashers into packs', () => {
    const rats = realFoe({ slot: 3, name: 'Cellar-rat', count: 12, level: 1, hurt: 4 });
    const wolves = realFoe({ slot: 4, name: 'Grey wolf', count: 12, level: 60, hurt: 6 });
    const gnashers = realFoe({ slot: 2, name: 'Reed-gnasher', count: 40, level: 1, hurt: 4 });
    const [ratPack] = splitFoes([rats]);
    assert.deepEqual([ratPack.slot, ratPack.n, ratPack.name, ratPack.size, ratPack.count], [31, 1, 'Cellar-rat', 8, 12]);
    assert.equal(packFullAttacks(ratPack.count), 3);
    assert.equal(packAttacks(ratPack.count, 5, ratPack.size), 2);
    assert.equal(packAttacks(ratPack.count, 2, ratPack.size), 1);
    assert.equal(packAreaBlocks(ratPack.size, false), 3);
    assert.equal(packAreaBlocks(ratPack.size, true), 4);
    const [wolfPack] = splitFoes([wolves]);
    assert.equal(wolfPack.size, 10, 'Lv60 wolves have six blocks, plus twelve foes ÷ 3');
    assert.equal(packAreaBlocks(wolfPack.size, false), 4);
    const packs = splitFoes([gnashers]);
    assert.deepEqual(packs.map(pack => pack.count), [10, 10, 10, 10]);
    assert.deepEqual(packs.map(pack => pack.size), [7, 7, 7, 7]);
    assert.deepEqual(packs.map(pack => pack.n), [1, 2, 3, 4]);
    assert.deepEqual(packs.map(pack => pack.name), [
        'Reed-gnasher pack 1', 'Reed-gnasher pack 2', 'Reed-gnasher pack 3', 'Reed-gnasher pack 4',
    ]);
    assert.deepEqual(packs.map(pack => packFullAttacks(pack.count)), [2, 2, 2, 2]);
    assert.deepEqual(packs.map(pack => packAreaBlocks(pack.size, false)), [3, 3, 3, 3]);
});

test('splitFoes names members, leaves a lone real foe unchanged, skips Down groups, resumes kept bars and sorts', () => {
    const boars = splitFoes([realFoe({ count: 3, hurt: 4 })]);
    assert.deepEqual(boars.map(foe => foe.name), ['Bristle-boar 1', 'Bristle-boar 2', 'Bristle-boar 3']);
    const single = realFoe({ count: 1, name: 'Bristle-boar' }), lone = splitFoes([single])[0];
    assert.deepEqual(lone, single, 'count 1 is not split and keeps its real slot and fields');
    assert.deepEqual(splitFoes([realFoe({ count: 3, hurt: 0 })]), []);
    assert.deepEqual(splitFoes([realFoe({ count: 0 })]), []);
    assert.deepEqual(splitFoes([realFoe({ filled: false })]), []);
    const kept = splitFoes([realFoe({ count: 3, hurt: 4 })], { kept: { 1: [0, 2, 4] } });
    assert.deepEqual(kept.map(foe => foe.hurt), [0, 2, 4]);
    const sorted = splitFoes([realFoe({ slot: 2 }), realFoe({ slot: 1 })]);
    assert.deepEqual(sorted.map(foe => [foe.group, foe.n]), [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]);
    const clamped = splitFoes([realFoe({ count: 3, size: 8 })], { maxOf: () => 4 });
    assert.deepEqual(clamped.map(foe => foe.size), [4, 4, 4]);
    const count13 = splitFoes([realFoe({ count: 13, hurt: 4 })]);
    assert.deepEqual(count13.map(foe => [foe.slot, foe.count, foe.hurt]), [[11, 7, 6], [12, 6, 6]]);
    const count99 = splitFoes([realFoe({ count: 99, hurt: 4 })]);
    assert.deepEqual(count99.map(foe => foe.count), [11, 11, 11, 11, 11, 11, 11, 11, 11]);
    assert.ok(count99.every(foe => foe.name.startsWith('Bristle-boar pack ')));
    assert.ok(count13.concat(count99).every(foe => foe.slot > 4 && foe.slot % 10 > 0));
});

test('packs rebuild from hurt, use kept values only when their count matches the pack count, and collapse in pack order', () => {
    const gnashers = realFoe({ slot: 3, name: 'Reed-gnasher', count: 40, hurt: 4 });
    const rebuilt = splitFoes([gnashers]);
    assert.deepEqual(rebuilt.map(pack => pack.hurt), [7, 7, 7, 7], 'ceil(7 × 4 / 4)');
    const shortened = splitFoes([gnashers], { kept: { 3: [1, 2, 3] } });
    assert.deepEqual(shortened.map(pack => pack.hurt), [7, 7, 7, 7], 'three values cannot stand for four packs');
    const resumed = splitFoes([gnashers], { kept: { 3: [1, 2, 3, 4] } });
    assert.deepEqual(resumed.map(pack => pack.hurt), [1, 2, 3, 4]);
    const rats = splitFoes([realFoe({ slot: 3, count: 12, hurt: 2 })])[0];
    assert.equal(rats.hurt, 4, 'ceil(8 × 2 / 4)');
    assert.equal(splitFoes([realFoe({ slot: 3, count: 12, hurt: 2 })], { kept: { 3: [5] } })[0].hurt, 5);
    assert.deepEqual(collapseFoes([gnashers], map([[31, 0], [32, 3], [33, 5], [34, 7]])), [{
        slot: 3, module: 'foes', count: { from: 40, to: 23 }, hurt: { from: 4, to: 4 },
    }]);
    assert.deepEqual(collapseFoes([gnashers], map([[31, 0], [32, 0], [33, 0], [34, 0]])), [{
        slot: 3, module: 'foes', count: { from: 40, to: 40 }, hurt: { from: 4, to: 0 },
    }]);
    assert.deepEqual(collapseFoes([realFoe({ count: 13 })], map([[11, 0], [12, 4]])), [{
        slot: 1, module: 'foes', count: { from: 13, to: 4 }, hurt: { from: 4, to: 3 },
    }]);
});

test('keptFrom and matchesBlock compare several packs with the block in pack order', () => {
    const gnashers = realFoe({ slot: 3, name: 'Reed-gnasher', count: 40, hurt: 4 });
    const members = boardFoes([gnashers], map([[31, 0], [32, 3], [33, 5], [34, 7]]));
    assert.deepEqual(keptFrom(members), { 3: [0, 3, 5, 7] });
    assert.equal(matchesBlock(members, realFoe({ slot: 3, name: 'Reed-gnasher', count: 23, hurt: 4 })), true);
    assert.equal(matchesBlock(members, realFoe({ slot: 3, name: 'Reed-gnasher', count: 40, hurt: 4 })), false);
    const allDown = boardFoes([gnashers], map([[31, 0], [32, 0], [33, 0], [34, 0]]));
    assert.equal(matchesBlock(allDown, realFoe({ slot: 3, name: 'Reed-gnasher', count: 40, hurt: 0 })), true);
    assert.equal(matchesBlock(allDown, realFoe({ slot: 3, name: 'Reed-gnasher', count: 39, hurt: 0 })), false);
    const rats = realFoe({ slot: 3, name: 'Cellar-rat', count: 12, hurt: 4 });
    const ratPack = boardFoes([rats], map([[31, 5]]));
    assert.equal(matchesBlock(ratPack, realFoe({ slot: 3, name: 'Cellar-rat', count: 8, hurt: 3 })), true);
    assert.equal(matchesBlock(ratPack, realFoe({ slot: 3, name: 'Cellar-rat', count: 12, hurt: 4 })), false);
});

test('boardFoes builds member cards and each pack card with its own count, left and attacks', () => {
    const boars = realFoe({ slot: 1, count: 3, hurt: 4 });
    const cards = boardFoes([boars], map([[13, 2], [11, 4], [12, 0]]));
    assert.deepEqual(cards.map(card => [card.slot, card.n, card.name, card.value, card.size, card.pack, card.count, card.left, card.attacks, card.standing]), [
        [11, 1, 'Bristle-boar 1', 4, 4, false, 1, 1, 1, true],
        [12, 2, 'Bristle-boar 2', 0, 4, false, 1, 0, 0, false],
        [13, 3, 'Bristle-boar 3', 2, 4, false, 1, 1, 1, true],
    ]);
    const gnashers = realFoe({ slot: 3, name: 'Reed-gnasher', count: 40, hurt: 4 });
    const packs = boardFoes([gnashers], map([[31, 0], [32, 3], [33, 5], [34, 7]]));
    assert.deepEqual(packs.map(pack => [pack.slot, pack.group, pack.n, pack.name, pack.value, pack.size, pack.pack, pack.count,
        pack.left, pack.attacks, pack.standing]), [
        [31, 3, 1, 'Reed-gnasher pack 1', 0, 7, true, 10, 0, 0, false],
        [32, 3, 2, 'Reed-gnasher pack 2', 3, 7, true, 10, 5, 1, true],
        [33, 3, 3, 'Reed-gnasher pack 3', 5, 7, true, 10, 8, 2, true],
        [34, 3, 4, 'Reed-gnasher pack 4', 7, 7, true, 10, 10, 2, true],
    ]);
    const [empty] = boardFoes([realFoe({ slot: 3, count: 12, hurt: 4 })], map());
    assert.equal(empty.value, 8);
    assert.equal(empty.left, 12);
    assert.equal(empty.attacks, 3);
    const [down] = boardFoes([realFoe({ slot: 3, count: 12, hurt: 4 })], map([[31, 0]]));
    assert.equal(down.standing, false);
    assert.equal(down.left, 0);
    assert.equal(down.attacks, 0);
    const mixed = boardFoes([realFoe({ slot: 1, count: 2, hurt: 4 }), realFoe({ slot: 2, name: 'Spiders', count: 1, hurt: 4 })],
        map([[11, 2], [12, 2]]));
    assert.deepEqual(mixed.map(card => [card.slot, card.group, card.n, card.name, card.value, card.size, card.standing]), [
        [11, 1, 1, 'Bristle-boar 1', 2, 4, true], [12, 1, 2, 'Bristle-boar 2', 2, 4, true],
        [2, 2, 1, 'Spiders', 4, 4, true],
    ], 'a lone real foe shares the list with split members');
});
