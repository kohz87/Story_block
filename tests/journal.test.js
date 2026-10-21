import test from 'node:test';
import assert from 'node:assert/strict';
import { journalState } from '../src/journal.js';

const frame = (n, more = {}) => ({ owner: `reply-${n}`, signature: `text-${n}`, index: n,
    blocks: { Inventory: 'Coins | 2 silver |', Party: 'Level: 1 | XP: 0/100' }, extra: {}, ...more });
const read = (journal, frames) => journalState(journal, frames, { scope: 'chat-a' });

test('hundreds of replies retain deduplicated resources, proof and archived acceptance', () => {
    const frames = Array.from({ length: 350 }, (_, n) => frame(n));
    frames[0].extra.storyDirectorQuest = { context: { owner: 'reply-0' } };
    frames[2].extra.rpgBattleEvidence = { events: [{ id: 'fight', defeated: ['wolf'] }] };
    frames[300].blocks = { Inventory: 'Coins | 5 silver |', Party: 'Level: 2 | XP: 1/120' };
    const full = read(null, frames);
    assert.equal(full.availability, 'available');
    assert.equal(Object.keys(full.journal.bodies).length, 6);
    const archived = read(full.journal, frames.slice(250).map((entry, index) => ({ ...entry, index })));
    assert.equal(archived.prefix.length, 250);
    assert.equal(archived.offset, 250);
    assert.equal(archived.entries[2].extra.rpgBattleEvidence.events[0].id, 'fight');
    assert.equal(archived.entries[300].blocks.Party, 'Level: 2 | XP: 1/120');
    assert.deepEqual(read(JSON.parse(JSON.stringify(archived.journal)), frames.slice(250).map((entry, index) => ({ ...entry, index }))).entries, archived.entries);
});

test('tail rollback restores Party and Inventory together and old swipes remain isolated', () => {
    const base = [frame(0), frame(1)];
    const paid = frame(2, { blocks: { Inventory: 'Coins | 5 silver |', Party: 'Level: 2 | XP: 1/120' }, extra: { storyDirectorQuest: { receipts: ['paid'] } } });
    const a = read(null, [...base, paid]);
    const rewind = read(a.journal, base);
    assert.equal(rewind.entries.at(-1).blocks.Party, 'Level: 1 | XP: 0/100');
    assert.equal(rewind.entries.at(-1).blocks.Inventory, 'Coins | 2 silver |');
    const b = read(rewind.journal, [...base, frame(2, { owner: 'other-swipe', signature: 'other' })]);
    assert.equal(b.entries.at(-1).extra.storyDirectorQuest, undefined);
    const restore = read(b.journal, [...base, paid]);
    assert.deepEqual(restore.entries.at(-1), a.entries.at(-1));
});

test('interior edits and missing anchors never inherit the future as a new checkpoint', () => {
    const frames = [frame(0), frame(1), frame(2), frame(3)];
    const saved = read(null, frames).journal;
    for (const changed of [[frames[0], frames[2], frames[3]], [frames[0], { ...frames[1], signature: 'edited' }, frames[2]], [frame(20)], []]) {
        const result = read(saved, changed);
        assert.equal(result.availability, 'incomplete');
        assert.equal(result.journal.head, saved.head);
    }
    assert.equal(read(saved, frames).availability, 'available');
});

test('chat metadata copies fork their identity without sharing mutable storage', () => {
    const a = read(null, [frame(0)]);
    const b = journalState(a.journal, [frame(0), frame(1)], { scope: 'chat-b' });
    assert.notEqual(b.journal.id, a.journal.id);
    assert.equal(b.journal.forkOf, a.journal.id);
    assert.equal(Object.keys(a.journal.nodes).length, 1);
    assert.equal(Object.keys(b.journal.nodes).length, 2);
});

test('missing saved state bodies require recovery rather than a partial checkpoint', () => {
    const frames = [frame(0)];
    const saved = read(null, frames).journal;
    delete saved.bodies[saved.nodes[saved.head].blocks.Party];
    assert.equal(read(saved, frames).availability, 'incomplete');
});
