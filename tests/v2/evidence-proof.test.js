// ctx.proof (docs/v2/EVIDENCE.md, contract §6 "Proof submission"): who may give which kind, closed payloads,
// the host's stamp, identical retries, CONFLICT, parents, reader intent, and a rolled-back root publishing nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_ID } from '../../src/v2/check.js';
import { hashJson, isMetaSpan } from '../../src/v2/replay.js';
import { KINDS, LIMITS, OWNERS } from '../../src/v2/evidence.js';
import { CHECK, SD, T1, T2, evidenceHarness } from './helpers/evidence.js';

const ids = made => made.map(each => each.id);

test('accept and roll each succeed once in one root; the nested commands see the pending proof and a public query does not', () => {
    const seen = [];
    const during = [];
    let h = null;
    h = evidenceHarness({ seen, peek: () => during.push(h.ask().length) });
    const at = h.send();
    const result = h.command('demo.flow', { thread: T1, selection: 'take it', check: CHECK });
    assert.equal(result.ok, true, result.message);
    const { accepted, rolled, story } = result.receipt.data;
    assert.equal(new Set([accepted.id, rolled.id, story.id]).size, 3, 'three different proofs');
    for (const made of [accepted, rolled, story]) assert.match(made.id, /^pf_[0-9a-z]{8}$/);
    // The retry inside the root (the second sd.accept) gave the accept's id back, so the root holds each once.
    const stored = h.proofsOf(at);
    assert.deepEqual(stored.map(proof => [proof.kind, proof.owner]), [['acceptance', SD], ['event', SD], ['event', SD]]);
    assert.deepEqual(ids(stored), [accepted.id, rolled.id, story.id]);
    assert.equal(h.spans(at).filter(isMetaSpan).length, 1, 'one root, one block');
    assert.equal(h.sdt().rolls[CHECK] >= 1, true, 'the roll was made once');
    assert.equal(h.store.head().domains.demoState.xp, 5, 'the payout was made once');
    // Parents are the ids of the pending proofs; the pins in the state are written with the block.
    assert.deepEqual(stored[1].parents, [accepted.id]);
    assert.deepEqual(stored[2].parents, [accepted.id, rolled.id]);
    assert.deepEqual(Object.keys(h.store.head().meta.proofs), ids(stored));
    // The nested roll found the accept in the root's own pending proof; the public query saw none of it before commit.
    assert.deepEqual(seen, [[accepted.id]]);
    assert.deepEqual(during, [0]);
    assert.deepEqual(ids(h.ask()), ids(stored), 'committed: all three, in source order');
    assert.deepEqual(ids(h.ask({ ids: [story.id, accepted.id] })), [story.id, accepted.id]);
    // The receipt shows the proof too; the host stamped id, Source and payloadHash.
    const receipt = h.record(at).receipts.at(-1);
    assert.deepEqual(receipt.data.v2.evidence, stored.map(({ id, kind, payloadHash }) => ({ id, kind, payloadHash })), 'the receipt holds ids, kinds and hashes; the span holds the bytes');
    const span = h.spans(at).at(-1);
    for (const proof of stored) {
        assert.deepEqual(proof.source, span.source);
        assert.equal(proof.payloadHash, hashJson(proof.payload));
    }
    assert.equal(span.guard, null, 'proof alone makes a block, not a guard');
    assert.equal(receipt.data.v2.guard, null);
    assert.deepEqual(h.problems(), []);
    // A second root is another block: its proof is new, and the first root's stays.
    const second = h.command('demo.flow', { thread: T1, selection: 'again', check: 'ck_check002' });
    assert.equal(second.ok, true, second.message);
    assert.equal(h.ask().length, 6);
    assert.equal(new Set(ids(h.ask())).size, 6, 'a new block, new ids');
    assert.equal(h.spans(at).at(-1).source.ordinal, 1);
});

test('a rolled-back root publishes nothing: no proof, no pin, no block', () => {
    const h = evidenceHarness();
    const at = h.send();
    const before = JSON.stringify(h.store.head());
    const record = JSON.stringify(h.record(at) ?? null);
    const failed = h.command('demo.flow', { thread: T1, selection: 'take it', check: CHECK, after: 'fail' });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'REFUSED');
    assert.deepEqual(h.ask(), []);
    assert.deepEqual(h.store.proofs(), []);
    assert.equal(JSON.stringify(h.store.head()), before, 'the state is as it was, with no pin');
    assert.equal(h.store.head().meta.proofs, undefined);
    assert.equal(JSON.stringify(h.record(at) ?? null), record, 'no block was stored');
    // A nested command that refuses takes the root's earlier proof with it.
    const bad = h.command('sd.roll', { check: CHECK, actor: 'ac_hero0001', stat: 'STR', dc: 10, parents: ['pf_00000000'] });
    assert.equal(bad.ok, false);
    assert.deepEqual(h.ask(), []);
    // A preview publishes nothing either; its commit does.
    const preview = h.bus.preview('demo.record', { foe: 'wolf' });
    assert.equal(preview.ok, true);
    assert.deepEqual(h.ask(), []);
    assert.equal(h.bus.commit(preview.token).ok, true);
    assert.equal(h.ask().length, 1);
});

test('only the owner of a kind may give it: the other owner, a module outside the table and an unknown kind are REFUSED', () => {
    const stranger = {
        id: 'zz-stranger', name: 'Stranger', version: '0.0.1',
        commands: { 'zz.visit'(ctx) { ctx.proof({ kind: 'visit', payload: { place: 'pack.x/mill' } }); return { summary: 'x', narrate: false }; } },
    };
    const h = evidenceHarness({ extra: [stranger] });
    h.send();
    const refused = (type, payload, pattern) => {
        const out = h.command(type, payload);
        assert.equal(out.ok, false, type);
        assert.equal(out.code, 'REFUSED', out.message);
        assert.match(out.message, pattern);
    };
    // Every kind of the table belongs to exactly the module the contract names.
    assert.deepEqual(KINDS.map(kind => [kind, OWNERS[kind]]), [
        ['visit', SD], ['acceptance', SD], ['event', SD]]);
    for (const kind of ['visit', 'acceptance', 'event']) refused('demo.refuse', { specs: [{ kind, payload: { place: 'p' } }] }, /only story-director does/);
    refused('zz.visit', {}, /zz-stranger cannot give "visit" proof: only story-director does/);
    refused('sd.many', { specs: [{ kind: 'bogus', payload: { a: 1 } }] }, /"bogus" is not a kind of proof/);
    for (const kind of ['kill', 'use', 'rescue', 'story']) {
        refused('sd.many', { specs: [{ kind, payload: { a: 1 } }] }, /not a kind of proof/);
    }
    refused('sd.many', { specs: [{ kind: 'toString', payload: { a: 1 } }] }, /not a kind of proof/);
    assert.deepEqual(h.ask(), []);
    assert.equal(h.store.head().meta.proofs, undefined);
    // The refusal comes before the payload is looked at: a wrong owner is told so, whatever it sent.
    refused('demo.refuse', { specs: [{ kind: 'acceptance', payload: 7 }] }, /only story-director does/);
});

test('the shape of the call and of each closed payload is checked: INVALID', () => {
    const h = evidenceHarness();
    h.send();
    const invalid = (specs, pattern) => {
        const out = h.command('sd.many', { specs: Array.isArray(specs) ? specs : [specs] });
        assert.equal(out.ok, false, JSON.stringify(specs));
        assert.equal(out.code, 'INVALID', `${JSON.stringify(specs)}: ${out.message}`);
        if (pattern) assert.match(out.message, pattern);
    };
    const acceptance = payload => ({ kind: 'acceptance', payload });
    const check = patch => ({ kind: 'event', payload: { check: CHECK, actor: 'ac_hero0001', stat: 'STR', dc: 12, ...patch } });
    // The call: { kind, payload, parents? } and nothing else.
    invalid({ kind: 'visit', payload: { place: 'p' }, extra: 1 }, /nothing else/);
    invalid({ kind: 7, payload: { place: 'p' } }, /names its kind/);
    invalid({ kind: 'visit' }, /plain JSON record/);
    invalid({ kind: 'visit', payload: [1] }, /plain JSON record/);
    // Acceptance: { thread, selection | words }.
    invalid(acceptance({ selection: 'x' }), /record id/);
    invalid(acceptance({ thread: 'thread' , selection: 'x' }), /record id/);
    invalid(acceptance({ thread: T1 }), /selection or the reader's words/);
    invalid(acceptance({ thread: T1, selection: 'a', words: 'b' }), /selection or the reader's words/);
    invalid(acceptance({ thread: T1, words: 'b', note: 'c' }), /selection or the reader's words/);
    invalid(acceptance({ thread: T1, words: '' }), /its words is text/);
    invalid(acceptance({ thread: T1, words: ' padded ' }), /no space at either end/);
    invalid(acceptance({ thread: T1, words: 'two\nlines' }), /control characters/);
    invalid(acceptance({ thread: T1, words: 'x'.repeat(LIMITS.words + 1) }), /at most 240/);
    invalid(acceptance({ thread: T1, selection: 'x'.repeat(LIMITS.selection + 1) }), /at most 120/);
    invalid(acceptance({ thread: T1, words: 7 }), /is text/);
    // A check: { check, actor, stat, dc }.
    invalid(check({ dc: 0 }), /dc is a whole number from 1 to 40/);
    invalid(check({ dc: 41 }), /dc/);
    invalid(check({ dc: 1.5 }), /dc/);
    invalid(check({ stat: 'LUCK' }), /stat is one of STR/);
    invalid(check({ actor: 'Ann' }), /actor is an id/);
    invalid(check({ check: 'c1' }), /check is a record id/);
    invalid(check({ extra: true }), /nothing else/);
    invalid({ kind: 'event', payload: { check: CHECK, actor: 'ac_hero0001', stat: 'STR' } }, /nothing else/);
    // A payload nobody has shaped: a non-empty plain object within the cap.
    invalid({ kind: 'visit', payload: {} }, /nothing in it/);
    invalid({ kind: 'visit', payload: { blob: 'x'.repeat(LIMITS.opaqueBytes) } }, /more than 4096 bytes/);
    // A hole in a list is not JSON: it would come back as null after a reload.
    invalid({ kind: 'visit', payload: { list: [1, , 3] } }, /gap/);
    invalid({ kind: 'visit', payload: { deep: { list: [[1], , [2]] } } }, /gap/);
    // Parents: up to 8 different proof ids.
    invalid({ kind: 'visit', payload: { place: 'p' }, parents: 'pf_00000000' }, /parents/);
    invalid({ kind: 'visit', payload: { place: 'p' }, parents: ['pf_00000000', 'pf_00000000'] }, /parents/);
    invalid({ kind: 'visit', payload: { place: 'p' }, parents: ['nope'] }, /parents/);
    invalid({ kind: 'visit', payload: { place: 'p' }, parents: Array.from({ length: 9 }, (_, n) => `pf_0000000${n}`) }, /parents/);
    assert.deepEqual(h.ask(), []);
    // The limits themselves are fine.
    const ok = h.command('sd.many', { specs: [{ kind: 'visit', payload: { blob: 'x'.repeat(LIMITS.opaqueBytes - 20) } }, { kind: 'acceptance', payload: { thread: T1, selection: 'x'.repeat(LIMITS.selection) } }] });
    assert.equal(ok.ok, true, ok.message);
    const longest = 'ab '.repeat(80).trim();
    const said = h.bus.run('sd.accept', { thread: T2, words: longest }, { cause: 'story', carrier: { index: 2, swipe: 0, sid: h.store.carrierSid(2) }, chat: { lastUser: `Well. ${longest}!`, reply: '' } });
    assert.equal(said.ok, true, said.message);
});

test('an identical retry in the same root gives the same id; the same key with other contents is CONFLICT', () => {
    const h = evidenceHarness();
    const at = h.send();
    const accept = { kind: 'acceptance', payload: { thread: T1, selection: 'take it' } };
    const same = h.command('sd.many', { specs: [accept, { ...accept, payload: { selection: 'take it', thread: T1 } }, { kind: 'visit', payload: { place: 'a' } }, { kind: 'visit', payload: { place: 'a' } }] });
    assert.equal(same.ok, true, same.message);
    const [one, two, three, four] = same.receipt.data.proofs;
    assert.deepEqual(one, two, 'the same id and hash, however the keys were ordered');
    assert.deepEqual(three, four);
    assert.notEqual(one.id, three.id);
    assert.equal(h.proofsOf(at).length, 2, 'stored once each');
    // The same acceptance (same thread) with other words, or another selection, is the same key with other contents.
    for (const other of [{ thread: T1, selection: 'leave it' }, { thread: T1, selection: 'Take it' }]) {
        const out = h.command('sd.many', { specs: [accept, { kind: 'acceptance', payload: other }] });
        assert.equal(out.ok, false);
        assert.equal(out.code, 'CONFLICT', out.message);
    }
    const check = { kind: 'event', payload: { check: CHECK, actor: 'ac_hero0001', stat: 'STR', dc: 12 } };
    const changed = h.command('sd.many', { specs: [check, { ...check, payload: { ...check.payload, dc: 13 } }] });
    assert.equal(changed.code, 'CONFLICT', 'a check is its check id');
    // Another thread is another key; a nobody-shaped payload that differs is another proof, not a conflict.
    const other = h.command('sd.many', { specs: [accept, { kind: 'acceptance', payload: { thread: T2, selection: 'take it' } }, { kind: 'visit', payload: { place: 'a' } }, { kind: 'visit', payload: { place: 'b' } }] });
    assert.equal(other.ok, true, other.message);
    assert.equal(new Set(ids(other.receipt.data.proofs)).size, 4);
    // The same key, the same payload, other parents: also CONFLICT.
    const a = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'p' } }, { kind: 'acceptance', payload: { thread: T1, selection: 'x' }, parents: [] }] });
    assert.equal(a.ok, true);
    const parent = ids(a.receipt.data.proofs)[0];
    const reparent = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'p' } }, { kind: 'acceptance', payload: { thread: T1, selection: 'x' } }, { kind: 'acceptance', payload: { thread: T1, selection: 'x' }, parents: [parent] }] });
    assert.equal(reparent.code, 'CONFLICT');
    // None of the failed roots left anything.
    assert.equal(h.ask().length, 2 + 4 + 2);
    // A root gives at most LIMITS.perRoot proofs.
    const many = Array.from({ length: LIMITS.perRoot + 1 }, (_, n) => ({ kind: 'visit', payload: { place: `p${n}` } }));
    assert.equal(h.command('sd.many', { specs: many }).code, 'LIMITED');
    assert.equal(h.command('sd.many', { specs: many.slice(0, LIMITS.perRoot) }).ok, true);
});

test('a parent is a visible proof, stored or pending in the root; anything else is NOT_FOUND', () => {
    const h = evidenceHarness();
    h.send();
    const chain = h.command('sd.many', { chain: true, specs: [{ kind: 'visit', payload: { place: 'a' } }, { kind: 'event', payload: { event: 'bell' } }, { kind: 'visit', payload: { place: 'b' } }] });
    assert.equal(chain.ok, true, chain.message);
    const [a, b, c] = chain.receipt.data.proofs;
    assert.deepEqual(h.ask({ ids: [c.id] })[0].parents, [b.id]);
    assert.deepEqual(h.ask({ ids: [b.id] })[0].parents, [a.id]);
    // A stored visible proof of an earlier block can be a parent, whoever owns it.
    h.send();
    const kill = h.command('demo.many', { specs: [{ kind: 'event', payload: { foe: 'wolf' }, parents: [c.id] }] });
    assert.equal(kill.ok, true, kill.message);
    // An unknown id, and the id of a proof the root has not given yet, are not found.
    for (const parents of [['pf_00000000'], [kill.receipt.data.proofs[0].id.replace(/.$/, c => (c === 'a' ? 'b' : 'a'))]]) {
        const out = h.command('demo.many', { specs: [{ kind: 'event', payload: { foe: 'bear' }, parents }] });
        assert.equal(out.ok, false);
        assert.equal(out.code, 'NOT_FOUND', out.message);
        assert.match(out.message, /no visible proof/);
    }
    assert.equal(h.ask().length, 4);
});

test('reader intent the host did not see is REFUSED: narration cannot accept for the reader, a selection needs the reader\'s own action', () => {
    const h = evidenceHarness();
    const at = h.send('Sure, I accept the job.', 'The innkeeper nods. "You accept," she says, and you take the job.');
    const sid = h.store.carrierSid(at);
    const asStory = (words, chat) => h.bus.run('sd.accept', { thread: T1, words }, { cause: 'story', carrier: { index: at, swipe: 0, sid }, chat });
    const lastUser = 'Sure, I accept the job.';
    const reply = 'The innkeeper nods. "You accept," she says, and you take the job.';
    // Words only the narration says: refused, whatever it looks like.
    for (const words of ['You accept', 'you take the job', 'The innkeeper nods']) {
        const out = asStory(words, { lastUser, reply });
        assert.equal(out.ok, false, words);
        assert.equal(out.code, 'REFUSED');
        assert.match(out.message, /narration cannot accept for the reader/);
    }
    // No message from the reader at all, or an empty one: refused. So is words from a screen's click.
    assert.equal(asStory('I accept', { lastUser: '', reply }).code, 'REFUSED');
    assert.equal(asStory('I accept', null).code, 'REFUSED');
    assert.equal(h.command('sd.accept', { thread: T1, words: 'I accept the job' }).code, 'REFUSED', 'a click has no message the host saw');
    // A selection is the reader's pick in a screen: not a story line's, not a system step's.
    for (const cause of ['story', 'system']) {
        const out = h.bus.run('sd.accept', { thread: T1, selection: 'take it' }, { cause, carrier: { index: at, swipe: 0, sid }, chat: { lastUser, reply } });
        assert.equal(out.code, 'REFUSED', cause);
        assert.match(out.message, /reader's own pick in a screen/);
    }
    assert.equal(h.command('sd.accept', { thread: T1, selection: 'take it' }).ok, true, 'the reader\'s own click is');
    // A whole sentence of the reader's message is quoted, case, spacing and the marks at its ends aside; the narration
    // saying it too changes nothing.
    const said = asStory('  Sure, I accept the job ', { lastUser, reply });
    assert.equal(said.ok, false, 'the words are cut at the ends: this one has space at both');
    assert.equal(said.code, 'INVALID');
    for (const words of ['Sure, I accept the job', 'sure,  i accept THE job', 'Sure, I accept the job.', '"Sure, I accept the job"']) {
        const out = asStory(words, { lastUser, reply });
        assert.equal(out.ok, true, `${words}: ${out.message}`);
        assert.equal(out.block.evidence[0].payload.words, words);
    }
    // A piece of a sentence is not what they said: refused, however much of it there is (the sentence starts at "Sure").
    for (const words of ['I accept the job', 'Sure, I accept', 'accept', 'Sure', 'accept the job']) {
        const out = asStory(words, { lastUser, reply });
        assert.equal(out.code, 'REFUSED', words);
    }
    // Nothing the refused calls did reached the store.
    assert.equal(h.ask().length, 1);
});

test('a payload that contains itself, or is nested too deep, is INVALID and does not hang', () => {
    const h = evidenceHarness();
    h.send();
    const cyclic = h.command('sd.cyclic', {});
    assert.equal(cyclic.ok, false);
    assert.equal(cyclic.code, 'INVALID', cyclic.message);
    assert.match(cyclic.message, /contains itself/);
    const deep = h.command('sd.cyclic', { depth: 80 });
    assert.equal(deep.code, 'INVALID', deep.message);
    assert.match(deep.message, /nested more than 64/);
    assert.deepEqual(h.ask(), []);
    assert.equal(h.command('sd.cyclic', { depth: 10 }).ok, true, 'ten levels are fine');
    assert.equal(h.ask().length, 1);
});

test('a refusal cannot be turned into an acceptance: only a whole sentence of the reader, two words or more, is quoted', () => {
    const h = evidenceHarness();
    const refusal = 'No. I refuse the job, and I will not take it.';
    const at = h.send(refusal, 'The innkeeper sighs.');
    const sid = h.store.carrierSid(at);
    const asStory = (words, lastUser = refusal) => h.bus.run('sd.accept', { thread: T1, words }, { cause: 'story', carrier: { index: at, swipe: 0, sid }, chat: { lastUser, reply: 'The innkeeper sighs.' } });
    // The pieces a model-written line might quote to make a refusal an acceptance.
    for (const words of ['I', 'No', 'take it', 'the job', 'I will not take', 'refuse the job', 'No. I refuse', 'I refuse the job, and I will not take it. No']) {
        const out = asStory(words);
        assert.equal(out.ok, false, words);
        assert.equal(out.code, 'REFUSED', `${words}: ${out.message}`);
    }
    // A line break ends a sentence before anything is folded: the first line is a sentence of its own.
    assert.equal(asStory('I accept the job', 'I accept the job\nThanks a lot').ok, true);
    assert.equal(asStory('Thanks a lot', 'I accept the job\nThanks a lot').ok, true);
    assert.equal(asStory('I accept the job Thanks a lot', 'I accept the job\nThanks a lot').code, 'REFUSED');
    // One word is never enough, even when it is the whole sentence.
    assert.equal(asStory('Yes', 'Yes.').code, 'REFUSED');
    assert.equal(asStory('Yes!!!', 'Yes!!!').code, 'REFUSED');
    assert.equal(asStory('xxxxx', 'xxxxx').code, 'REFUSED');
    // The host proves quoting, not meaning: the refusal sentence quoted whole is a quote, and judging that it does not
    // accept is the owner's (EVIDENCE.md).
    const whole = asStory('I refuse the job, and I will not take it');
    assert.equal(whole.ok, true, whole.message);
    // Sentences are cut at . ! ? ... ; and line breaks, not at commas.
    assert.equal(asStory('Wait', 'Wait... Sure then').code, 'REFUSED');
    assert.equal(asStory('Sure then', 'Wait... Sure then').ok, true);
    assert.equal(asStory('Deal', 'Deal;\nDone deal').code, 'REFUSED');
    assert.equal(asStory('Done deal', 'Deal;\nDone deal').ok, true);
});

test('the proof ids are the host\'s: derived from the reply\'s Source, the block and the key, never from the owner', () => {
    const h = evidenceHarness();
    const at = h.send();
    const first = h.command('sd.many', { specs: [{ kind: 'acceptance', payload: { thread: T1, selection: 'x' } }] });
    const second = h.command('sd.many', { specs: [{ kind: 'acceptance', payload: { thread: T1, selection: 'x' } }] });
    const [a] = first.receipt.data.proofs;
    const [b] = second.receipt.data.proofs;
    assert.notEqual(a.id, b.id, 'two roots, two blocks');
    assert.equal(a.payloadHash, b.payloadHash, 'the same payload hashes the same');
    assert.ok(RECORD_ID.test(a.id));
    // The data an owner returns cannot carry its own evidence or source into the receipt: the host stamps both.
    const lying = h.command('sd.lying', { place: 'pack.x/mill' });
    assert.equal(lying.ok, true, lying.message);
    const lied = lying.receipt.data.v2;
    assert.equal(lied.key, 'mine', 'its other fields stay');
    assert.deepEqual(lied.source, h.spans(at).at(-1).source);
    assert.deepEqual(lied.evidence.map(proof => proof.kind), ['visit']);
    assert.equal(h.ask().length, 3);
});
