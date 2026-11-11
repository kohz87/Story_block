// Foe members and packs: the pure split, pack formula, carried bars, collapse and board-list rules.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MEMBER_CAP, MEMBER_CAP_SIX, PACK_MAX_ATTACKS, PACK_MAX_ATTACKS_SIX, PACK_MAX_SIZE, boardFoes, carriedFrom, collapseFoes, memberSize,
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

test('splitFoes names members, leaves a lone real foe unchanged, skips Down groups, resumes carried bars and sorts', () => {
    const boars = splitFoes([realFoe({ count: 3, hurt: 4 })]);
    assert.deepEqual(boars.map(foe => foe.name), ['Bristle-boar 1', 'Bristle-boar 2', 'Bristle-boar 3']);
    const single = realFoe({ count: 1, name: 'Bristle-boar' }), lone = splitFoes([single])[0];
    assert.deepEqual(lone, single, 'count 1 is not split and keeps its real slot and fields');
    assert.deepEqual(splitFoes([realFoe({ count: 3, hurt: 0 })]), []);
    assert.deepEqual(splitFoes([realFoe({ count: 0 })]), []);
    assert.deepEqual(splitFoes([realFoe({ filled: false })]), []);
    const carried = splitFoes([realFoe({ count: 3, hurt: 4 })], { carried: { values: { 11: 0, 12: 2, 13: 4 }, counts: { 1: 3 } } });
    assert.deepEqual(carried.map(foe => foe.hurt), [0, 2, 4]);
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

test('NEW5/NEW6: real count-one bars use the live field, carry only virtual values and keep a real Down card', () => {
    const lone = realFoe({ slot: 1, name: 'Bat', count: 1, hurt: 4 });
    const live = splitFoes([lone], { carried: { values: { 1: 2 }, counts: { 1: 1 } } });
    assert.equal(live[0].hurt, 4, 'the real field is the authority between segments');
    const down = splitFoes([{ ...lone, hurt: 0 }], { carried: { values: {}, counts: { 1: 1 } } });
    assert.deepEqual(down.map(foe => [foe.slot, foe.hurt, foe.filled]), [[1, 0, true]], 'a real foe downed in the fight stays listed');
    assert.deepEqual(splitFoes([{ ...lone, hurt: 0 }]), [], 'a group already Down was never in this fight');
    const carried = carriedFrom([
        { slot: 1, group: 1, name: 'Bat', value: 2, pack: false, count: 1 },
        { slot: 11, group: 1, name: 'Bat 1', value: 1, pack: false, count: 1 },
        { slot: 12, group: 1, name: 'Bat 2', value: 0, pack: false, count: 1 },
    ]);
    assert.deepEqual(carried, { values: { 11: 1, 12: 0 }, counts: { 1: 3 } });
});

test('packs rebuild from hurt, resume exact carried values, and collapse in pack order', () => {
    const gnashers = realFoe({ slot: 3, name: 'Reed-gnasher', count: 40, hurt: 4 });
    const rebuilt = splitFoes([gnashers]);
    assert.deepEqual(rebuilt.map(pack => pack.hurt), [7, 7, 7, 7], 'ceil(7 × 4 / 4)');
    const partial = splitFoes([gnashers], { carried: { values: { 31: 1, 32: 2 }, counts: { 3: 40 } } });
    assert.deepEqual(partial.map(pack => pack.hurt), [1, 2, 7, 7], 'bars absent from the record rebuild from hurt');
    const resumed = splitFoes([gnashers], { carried: { values: { 31: 1, 32: 2, 33: 3, 34: 4 }, counts: { 3: 40 } } });
    assert.deepEqual(resumed.map(pack => pack.hurt), [1, 2, 3, 4]);
    const rats = splitFoes([realFoe({ slot: 3, count: 12, hurt: 2 })])[0];
    assert.equal(rats.hurt, 4, 'ceil(8 × 2 / 4)');
    assert.equal(splitFoes([realFoe({ slot: 3, count: 12, hurt: 2 })],
        { carried: { values: { 31: 5 }, counts: { 3: 12 } } })[0].hurt, 5);
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

// ---- the six-group rule (fight setup `foesSix: 1`, passed here as `six`) ----

test('six rule: a group of six is six member bars, seven or more is a pack, and the old cap stays five without it', () => {
    assert.equal(MEMBER_CAP_SIX, 6);
    assert.equal(PACK_MAX_ATTACKS_SIX, 6);
    const six = splitFoes([realFoe({ count: 6 })], { six: true });
    assert.equal(six.length, 6);
    assert.ok(six.every(foe => foe.member === true && foe.count === 1));
    assert.deepEqual(six.map(foe => foe.slot), [11, 12, 13, 14, 15, 16]);
    const seven = splitFoes([realFoe({ count: 7 })], { six: true });
    assert.equal(seven.length, 1);
    assert.equal(seven[0].pack, true);
    assert.equal(seven[0].count, 7);
    // without the mark (a fight staged earlier): six is one pack, as before
    const old = splitFoes([realFoe({ count: 6 })]);
    assert.equal(old.length, 1);
    assert.equal(old[0].pack, true);
    assert.equal(splitFoes([realFoe({ count: 5 })]).length, 5);
});

test('six rule: a full pack attacks 1 + floor(count / 2) times, at most six; without the mark 1 + floor(count / 6), at most three', () => {
    assert.deepEqual([7, 8, 9, 10, 11, 12].map(count => packFullAttacks(count, true)), [4, 5, 5, 6, 6, 6]);
    assert.equal(packFullAttacks(12, true), 6);
    assert.equal(packFullAttacks(40, true), 6);
    assert.deepEqual([6, 7, 11, 12, 40].map(count => packFullAttacks(count)), [2, 2, 2, 3, 3], 'the old rule is untouched');
    // a twelve-foe swarm at a full bar attacks six times, then thins with the bar and never reaches zero while it stands
    assert.equal(packAttacks(12, 8, 8, 6), 6);
    assert.equal(packAttacks(12, 4, 8, 6), 3);
    assert.equal(packAttacks(12, 1, 8, 6), 1);
    assert.equal(packAttacks(12, 0, 8, 6), 0);
    const swarm = splitFoes([realFoe({ count: 12 })], { six: true })[0];
    assert.equal(swarm.full, 6);
    assert.equal(boardFoes([realFoe({ count: 12 })], new Map(), { six: true })[0].attacks, 6);
    assert.equal(boardFoes([realFoe({ count: 12 })], new Map())[0].attacks, 3);
    assert.equal(packAreaBlocks(8, false), 3, 'the area hit against a pack is still a third of its bar');
});

test('six rule: groups five and six get their own virtual slots, collapse and carry like the first four', () => {
    const real = [realFoe({ slot: 5, local: 5, count: 6, name: 'Gulls' }), realFoe({ slot: 6, local: 6, count: 2, name: 'Crows' })];
    const bars = splitFoes(real, { six: true });
    assert.deepEqual(bars.map(foe => foe.slot), [51, 52, 53, 54, 55, 56, 61, 62]);
    assert.equal(new Set(bars.map(foe => foe.slot)).size, bars.length, 'every virtual slot is unique');
    assert.deepEqual(bars.map(foe => foe.group), [5, 5, 5, 5, 5, 5, 6, 6]);
    const values = map(bars.map(foe => [foe.slot, foe.slot === 51 ? 0 : foe.hurt]));
    const collapsed = collapseFoes(real, values, { six: true });
    assert.deepEqual(collapsed.map(change => [change.slot, change.count.to]), [[5, 5], [6, 2]]);
    assert.deepEqual(carriedFrom(boardFoes(real, values, { six: true })).counts, { 5: 6, 6: 2 });
    // the field a group writes is its block's own number: slot 5 of a first Foes block is hurt5, a second block's slot 5 (numbered 5 after a four-slot block) is hurt1
    assert.equal(memberSize(realFoe({ slot: 5, local: 5 }), (module, field) => { assert.equal(field, 'hurt5'); return 9; }), 4);
    assert.equal(memberSize(realFoe({ slot: 5, local: 1 }), (module, field) => { assert.equal(field, 'hurt1'); return 9; }), 4);
    assert.equal(memberSize(realFoe({ slot: 6 }), (module, field) => { assert.equal(field, 'hurt2'); return 9; }), 4, 'no `local`: the earlier numbering');
});
