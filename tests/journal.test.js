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

test('a proven alternate can replace the only tracked reply without inheriting its rewards or defeats', () => {
    const original = frame(20, { extra: { rpgBattleEvidence: { events: ['old-fight'] } } });
    const saved = read(null, [original]).journal;
    const alternate = frame(20, { owner: 'alternate', signature: 'new telling', replaces: [original.owner] });
    const result = read(saved, [alternate]);
    assert.equal(result.availability, 'available');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].owner, alternate.owner);
    assert.equal(result.entries[0].extra.rpgBattleEvidence, undefined);
    assert.equal(result.entries[0].parent, null);
    assert.equal(read(result.journal, [original]).journal.head, saved.head);
    assert.equal(read(saved, [{ ...alternate, replaces: [] }]).availability, 'incomplete', 'an unrelated reply cannot reset the journal');
});

test('newly identified replies before the original journal boundary preserve its verified suffix', () => {
    const root = frame(6, { blocks: { Inventory: 'Coins | 8 silver |' }, extra: { rpgBattleEvidence: { events: ['verified'] } } });
    const child = frame(8, { extra: { storyDirectorQuest: { receipts: ['paid-once'] } } });
    const saved = read(null, [root, child]).journal;
    const earlier = frame(4, { blocks: { Inventory: 'Coins | 1 silver |', Party: 'Earlier sheet' } });
    const result = read(saved, [earlier, root, child]);
    assert.equal(result.availability, 'available', result.reason);
    assert.deepEqual(result.entries.map(node => node.owner), [earlier.owner, root.owner, child.owner]);
    assert.deepEqual(result.entries[1].blocks, read(saved, [root, child]).entries[0].blocks, 'the verified root snapshot stays authoritative');
    assert.deepEqual(result.entries[1].extra.rpgBattleEvidence.events, ['verified']);
    assert.deepEqual(result.entries[2].extra.storyDirectorQuest.receipts, ['paid-once']);
    assert.ok(result.journal.nodes[saved.head], 'original nodes remain available for rollback');
    assert.equal(read(result.journal, [earlier, root, child]).journal.head, result.journal.head);
});

test('a legacy replacement at reply 6 reconnects with an unrecorded reply 4 before it', () => {
    const root = frame(6, { blocks: { Inventory: 'Coins | 8 silver |' }, extra: { rpgBattleEvidence: { events: ['discarded-fight'] } } });
    const saved = read(null, [root]).journal;
    const earlier = frame(4, { owner: 'new-offer', blocks: { Inventory: 'Coins | 1 silver |' } });
    const replacement = frame(6, { owner: 'new-response', signature: 'regenerated', blocks: {}, replaces: [root.owner] });
    const result = read(saved, [earlier, replacement]);
    assert.equal(result.availability, 'available', result.reason);
    assert.deepEqual(result.entries.map(node => node.owner), ['new-offer', 'new-response']);
    assert.equal(result.entries[1].blocks.Inventory, 'Coins | 1 silver |');
    assert.equal(result.entries[1].extra.rpgBattleEvidence, undefined);
    assert.ok(result.journal.nodes[saved.head]);
    assert.equal(read(saved, [earlier, { ...replacement, replaces: [] }]).availability, 'incomplete');
});

test('pre-journal identities cannot adopt unverified evidence or unknown archived parents', () => {
    const root = frame(6), earlier = frame(4);
    const saved = read(null, [root]).journal;
    const proof = { ...earlier, extra: { rpgBattleEvidence: { events: ['unverified'] } } };
    assert.equal(read(saved, [proof, root]).availability, 'incomplete');
    const archived = read(null, [frame(2), root]).journal;
    assert.equal(read(archived, [earlier, root]).availability, 'incomplete');
});

test('adding pre-journal identities cannot authorize an edited or missing interior reply', () => {
    const [root, middle, tail] = [frame(6), frame(8), frame(10)];
    const saved = read(null, [root, middle, tail]).journal;
    for (const frames of [[frame(4), root, tail], [frame(4), root, { ...middle, signature: 'changed' }, tail]]) {
        const result = read(saved, frames);
        assert.equal(result.availability, 'incomplete');
        assert.equal(result.journal.head, saved.head);
    }
});

test('replacing the first retained reply keeps only its proven archived parents, never its own payout', () => {
    const base = [frame(0), frame(1, { extra: { rpgBattleEvidence: { events: ['earned'] } } })];
    const paid = frame(2, { blocks: { Inventory: 'Coins | 8 silver |', Party: 'Level: 2 | XP: 1/120' },
        extra: { storyDirectorQuest: { receipts: ['paid'] } } });
    const saved = read(null, [...base, paid]).journal;
    const alternate = frame(0, { owner: 'retold', signature: 'new telling', replaces: [paid.owner], blocks: {} });
    const result = read(saved, [alternate]);
    assert.equal(result.availability, 'available');
    assert.equal(result.offset, 2);
    assert.equal(result.prefix.length, 2);
    assert.equal(result.entries.at(-1).blocks.Inventory, base[1].blocks.Inventory);
    assert.equal(result.entries.at(-1).extra.storyDirectorQuest, undefined);
    assert.equal(result.prefix[1].extra.rpgBattleEvidence.events[0], 'earned');
    const unchangedChild = frame(3);
    const withChild = read(saved, [...base, paid, unchangedChild]).journal;
    assert.equal(read(withChild, [alternate, { ...unchangedChild, index: 1 }]).availability, 'incomplete', 'dependent suffixes still need recovery');
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

test('HTTP fallback extends an existing native-ID journal without replacing its IDs', t => {
    const frames = [frame(0)];
    const saved = read(null, frames).journal;
    const nativeCrypto = globalThis.crypto;
    t.mock.getter(globalThis, 'crypto', () => ({ getRandomValues: bytes => nativeCrypto.getRandomValues(bytes) }));
    const continued = read(saved, [...frames, frame(1)]);
    assert.equal(continued.availability, 'available');
    assert.equal(continued.journal.id, saved.id);
    assert.equal(continued.entries[0].id, saved.head);
    assert.equal(continued.entries[1].parent, saved.head);
    assert.notEqual(continued.journal.head, saved.head);
});
