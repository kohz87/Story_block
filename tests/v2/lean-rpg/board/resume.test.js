// Cross-fight resume: the last ended board fight's exact bars survive only while the Foes block
// still reads its collapsed count and Health.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeMembers } from '../../../../src/v2/lean-rpg/board/resume.js';

const foe = (over = {}) => ({
    slot: 1, module: 'foes', name: 'Bristle-boar', count: 3, class: 1, level: 1, levelled: true,
    hurt: 4, filled: true, ...over,
});
const member = (n, value, over = {}) => ({
    slot: 10 + n, group: 1, n, name: `Bristle-boar ${n}`, value, size: 4, pack: false, count: 1,
    standing: value > 0, ...over,
});
const pack = (n, value, count, over = {}) => ({
    slot: 10 + n, group: 1, n, name: `Bristle-boar pack ${n}`, value, size: 6, pack: true, count,
    standing: value > 0, ...over,
});
const record = (stop, members, over = {}) => ({ receipts: [{
    type: 'rpg.resolve',
    data: { v2: { result: { stop, board: { id: 'fight', groups: [1] }, members, ...over } } },
}] });

test('a lost or fled fight resumes the exact member bars its block still reads', () => {
    const members = [member(1, 2), member(2, 0), member(3, 3)];
    assert.deepEqual(resumeMembers([record('fled', members)], [1], [foe({ count: 2, hurt: 3 })]), {
        values: { 11: 2, 12: 0, 13: 3 }, counts: { 1: 3 },
    });
});

test('a narrator change to the collapsed block gives no resume', () => {
    const members = [member(1, 2), member(2, 0), member(3, 3)];
    assert.equal(resumeMembers([record('lost', members)], [1], [foe({ count: 3, hurt: 4 })]), null);
    assert.equal(resumeMembers([record('lost', members)], [1], [foe({ count: 2, hurt: 2 })]), null);
});

test('a won fight has nothing to resume', () => {
    const members = [member(1, 0), member(2, 0), member(3, 0)];
    assert.equal(resumeMembers([record('won', members)], [1], [foe({ count: 3, hurt: 0 })]), null);
});

test('pack bars resume while their scaled count and Health still match', () => {
    const members = [pack(1, 2, 7), pack(2, 3, 6)];
    assert.deepEqual(resumeMembers([record('fled', members)], [1], [foe({ count: 6, hurt: 2 })]), {
        values: { 11: 2, 12: 3 }, counts: { 1: 13 },
    });
});

test('the last covering ended fight decides; a changed block does not fall back to an older one', () => {
    const older = record('fled', [member(1, 2), member(2, 0), member(3, 3)]);
    const newer = record('lost', [member(1, 1), member(2, 0), member(3, 1)]);
    assert.equal(resumeMembers([older, newer], [1], [foe({ count: 2, hurt: 3 })]), null);
});
