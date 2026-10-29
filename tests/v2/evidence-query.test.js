// story.evidence and what keeps a proof (docs/v2/EVIDENCE.md, contract §6 and §10 E): active, visible,
// code-validated proof only; hidden with a deleted or skipped parent or block; kept through trimming, checkpoints,
// reloads and swipes; and the bytes pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashJson, sha256 } from '../../src/v2/replay.js';
import { LIMITS, merged, pinOf, pinOps, proofPins, recordEntries, visibleProofs } from '../../src/v2/evidence.js';
import { newSwipe, showSwipe } from './helpers/store-chat.js';
import { SD, T1, T2, evidenceHarness } from './helpers/evidence.js';

const ids = list => list.map(each => each.id);

function threeReplies(options = {}) {
    const mode = { value: 'normal' };
    const h = evidenceHarness({ mode, ...options });
    const first = h.send();
    const accepted = h.command('sd.guarded', { thread: T1, selection: 'take it' });
    assert.equal(accepted.ok, true, accepted.message);
    const second = h.send();
    const kill = h.command('demo.many', { specs: [{ kind: 'event', payload: { foe: 'wolf' }, parents: [accepted.receipt.data.proof.id] }] });
    assert.equal(kill.ok, true, kill.message);
    return { h, mode, first, second, parent: accepted.receipt.data.proof.id, child: kill.receipt.data.proofs[0].id };
}

test('story.evidence gives every visible proof in source order, or the ids asked for; unknown ones are left out', () => {
    const h = evidenceHarness();
    h.send();
    const visits = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }, { kind: 'visit', payload: { place: 'b' } }] }).receipt.data.proofs;
    h.send();
    const [kill] = h.command('demo.many', { specs: [{ kind: 'event', payload: { foe: 'wolf' } }] }).receipt.data.proofs;
    const all = [visits[0].id, visits[1].id, kill.id];
    assert.deepEqual(ids(h.ask()), all, 'default: all, in source order');
    assert.deepEqual(ids(h.ask({})), all);
    assert.deepEqual(ids(h.ask({ ids: undefined })), all);
    assert.deepEqual(ids(h.ask({ ids: [kill.id, visits[0].id, kill.id] })), [kill.id, visits[0].id], 'in the order asked, once each');
    assert.deepEqual(ids(h.ask({ ids: ['pf_00000000', visits[1].id, 'th_00000000'] })), [visits[1].id], 'unknown ids are left out');
    assert.deepEqual(h.ask({ ids: [] }), []);
    // A proof is the contract's Proof, and nothing else.
    assert.deepEqual(Object.keys(h.ask()[0]).sort(), ['id', 'kind', 'owner', 'parents', 'payload', 'payloadHash', 'source']);
    // Malformed arguments give [], never an error.
    const malformed = [null, 'x', 5, true, [], [kill.id], { ids: 'x' }, { ids: kill.id }, { ids: [1] }, { ids: [null] }, { ids: ['nope'] },
        { ids: [kill.id, 'nope'] }, { extra: 1 }, { ids: [kill.id], extra: 1 }, { ids: Array.from({ length: LIMITS.ids + 1 }, () => kill.id) }];
    for (const args of malformed) assert.deepEqual(h.ask(args), [], JSON.stringify(args)?.slice(0, 40));
    // The answer is a copy: changing it changes nothing.
    const copy = h.ask();
    copy[0].payload.place = 'changed';
    assert.equal(h.ask()[0].payload.place, 'a');
    // And it is only a read.
    assert.deepEqual(ids(h.ask()), all);
});

test('a deleted parent hides its child; the block of the child stays applied; a missing first block does not stop later ones', () => {
    const { h, first, parent, child } = threeReplies();
    assert.deepEqual(ids(h.ask()), [parent, child]);
    // The reply that gave the parent is deleted.
    h.chat.splice(first - 1, 2);
    h.store.rebuild();
    assert.deepEqual(h.ask(), [], 'the parent is gone, and so is its child');
    assert.deepEqual(h.store.head().domains.demoState.log, [1], 'the child\'s own changes stand: it is only the proof that is hidden');
    assert.deepEqual(Object.keys(h.store.head().meta.proofs), [child], 'its pin is there, behind a parent that is not');
    assert.deepEqual(h.problems(), []);
    // A proof whose first-proof block is gone is still pinned when its own block replays (the record of pins is made again).
    h.send();
    const other = h.command('demo.many', { specs: [{ kind: 'event', payload: { foe: 'bear' } }] });
    assert.equal(other.ok, true);
    assert.deepEqual(ids(h.ask()), [other.receipt.data.proofs[0].id]);
    h.store.rebuild();
    assert.deepEqual(ids(h.ask()), [other.receipt.data.proofs[0].id]);
});

test('a skipped parent block hides its child, and a skipped block publishes nothing; the proof is back when the block is', () => {
    const { h, mode, parent, child } = threeReplies();
    mode.value = 'deny';
    h.store.rebuild();
    assert.deepEqual(h.ask(), []);
    const [problem] = h.problems();
    assert.equal(problem.code, 'REPLAY_PREREQUISITE');
    assert.match(problem.why, /the offer is gone/);
    assert.equal(h.problems().length, 1, 'only the guarded block is skipped');
    assert.deepEqual(Object.keys(h.store.head().meta.proofs), [child], 'the skipped block pinned nothing');
    assert.deepEqual(h.store.head().domains.sdt.accepted, {}, 'and did nothing');
    // The block is stored still, with its proof, and is asked again; it did not apply, so the projection lists only the other.
    assert.equal(h.store.proofs({ all: true }).length, 2);
    assert.equal(h.store.proofs().length, 1);
    mode.value = 'normal';
    h.store.rebuild();
    assert.deepEqual(ids(h.ask()), [parent, child]);
    assert.deepEqual(h.problems(), []);
    // A skipped block on its own publishes nothing at all.
    const alone = evidenceHarness({ mode });
    alone.send();
    mode.value = 'normal';
    assert.equal(alone.command('sd.guarded', { thread: T2, selection: 'x' }).ok, true);
    mode.value = 'deny';
    alone.store.rebuild();
    assert.deepEqual(alone.ask(), []);
    assert.equal(alone.store.head().meta.proofs, undefined, 'no pin');
});

test('a guard asks story.evidence on the state before its block: a proof that is not shown holds a block back, and it is back with the proof', () => {
    const h = evidenceHarness();
    const first = h.send();
    const [kill] = h.command('demo.many', { specs: [{ kind: 'event', payload: { foe: 'wolf' } }] }).receipt.data.proofs;
    h.send();
    const needs = h.command('sd.needs', { thread: T1, selection: 'take it', parent: kill.id });
    assert.equal(needs.ok, true, needs.message);
    assert.deepEqual(ids(h.ask()), [kill.id, needs.receipt.data.proof.id]);
    // The parent's reply is deleted: the guard no longer holds, so the acceptance and its pin are not applied at all.
    const before = h.chat.slice();
    h.chat.splice(first - 1, 2);
    h.store.rebuild();
    assert.deepEqual(h.ask(), []);
    assert.deepEqual(h.store.head().domains.sdt.accepted, {}, 'nothing of the block applied');
    assert.equal(h.store.head().meta.proofs, undefined);
    const [problem] = h.problems();
    assert.equal(problem.code, 'REPLAY_PREREQUISITE');
    assert.match(problem.why, /its parent proof is not shown/);
    // Put the reply back: the block is asked again and applies.
    h.chat.splice(0, h.chat.length, ...before);
    h.store.rebuild();
    assert.deepEqual(ids(h.ask()), [kill.id, needs.receipt.data.proof.id]);
    assert.deepEqual(h.problems(), []);
});

test('a stored proof the code cannot validate is not shown: edited payload, another owner, a pin that no longer matches', () => {
    const edit = (mutate, expectBlockSkipped) => {
        const { h, first, parent, child } = threeReplies();
        const record = h.chat[first].extra.storySuite;
        mutate(record);
        h.store.rebuild();
        const shown = ids(h.ask());
        assert.equal(shown.includes(parent), false, 'the damaged proof is not shown');
        assert.equal(shown.includes(child), false, 'nor what is built on it');
        if (expectBlockSkipped) assert.equal(h.problems()[0]?.code, 'REPLAY_PREREQUISITE');
        return h;
    };
    const proofOf = record => record.spans.find(span => span.evidence?.length).evidence[0];
    // The words changed, the hash kept; the hash changed too (the bytes now say something else); another owner.
    edit(record => { proofOf(record).payload.selection = 'something else'; }, true);
    edit(record => { const proof = proofOf(record); proof.payload.selection = 'other'; proof.payloadHash = hashJson(proof.payload); }, false);
    edit(record => { proofOf(record).owner = 'sample-extension'; }, true);
    edit(record => { proofOf(record).kind = 'unknown-kind'; }, true);
    edit(record => { proofOf(record).extra = true; }, true);
    // A proof listed that the block does not pin, or a pin with no proof listed: the block is not applied.
    edit(record => { record.spans.find(span => span.evidence?.length).evidence.push({ ...proofOf(record), id: 'pf_forged000' }); }, true);
    edit(record => { record.spans.find(span => span.evidence?.length).evidence = []; }, true);
    // The proof says it was given on another reply.
    edit(record => { proofOf(record).source = { ...proofOf(record).source, ordinal: 9 }; }, true);
    // The pin in the changes is not the one the bytes make: shown nowhere.
    const h = edit(record => {
        const pin = record.ops.find(op => op.path.startsWith('/meta/proofs'));
        pin.value = typeof pin.value === 'string' ? '0'.repeat(64) : { [proofOf(record).id]: '0'.repeat(64) };
    }, false);
    assert.deepEqual(h.problems(), []);
});

test('the pin of a proof covers its parents: a parent given again with other bytes hides what was built on the old one', () => {
    const proof = (id, payload, parents = []) => ({ id, source: { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 0 }, owner: SD, kind: 'visit', payload, payloadHash: hashJson(payload), parents });
    const parent = proof('pf_parent01', { place: 'a' });
    const child = proof('pf_child001', { place: 'b' }, [parent.id]);
    const pins = { [parent.id]: pinOf(parent, {}) };
    pins[child.id] = pinOf(child, pins);
    assert.notEqual(pins[parent.id], parent.payloadHash, 'the pin covers the id, kind and owner as well as the payload');
    assert.notEqual(pinOf({ ...parent, kind: 'event', owner: 'sample-extension' }, {}), pins[parent.id], 'a kind or an owner changed is another pin');
    assert.notEqual(pinOf({ ...parent, id: 'pf_other001' }, {}), pins[parent.id]);
    assert.notEqual(pins[child.id], pinOf({ ...child, parents: [] }, {}), 'parents: covered too');
    const entries = [parent, child].map(each => ({ proof: each, block: 'bl_00000001' }));
    const state = value => ({ meta: { rev: 1, claims: {}, proofs: value } });
    assert.deepEqual(ids(visibleProofs(state(pins), entries)), [parent.id, child.id]);
    // The parent is given again with other bytes (the same id, a new pin): it shows, the child pinned to the old one does not.
    const newer = proof(parent.id, { place: 'changed' });
    const moved = { ...pins, [parent.id]: pinOf(newer, {}) };
    assert.deepEqual(ids(visibleProofs(state(moved), [{ proof: newer, block: 'bl_00000002' }, entries[1]])), [parent.id]);
    // Not pinned, a pin that is not text, a cycle, a proof given twice, and a parent that is not there.
    assert.deepEqual(visibleProofs(state({}), entries), []);
    assert.deepEqual(visibleProofs(state({ ...pins, [parent.id]: 5 }), entries), []);
    assert.deepEqual(visibleProofs({ meta: { rev: 1 } }, entries), []);
    assert.deepEqual(ids(visibleProofs(state(pins), [...entries, entries[0]])), [], 'given twice: neither copy, and not what is built on it');
    assert.deepEqual(ids(visibleProofs(state(pins), [entries[1]])), [], 'the parent is not there');
    const a = proof('pf_cycle0001', { place: 'a' }, ['pf_cycle0002']);
    const b = proof('pf_cycle0002', { place: 'b' }, [a.id]);
    const loop = { [a.id]: pinOf(a, {}), [b.id]: pinOf(b, {}) };
    assert.deepEqual(visibleProofs(state(loop), [a, b].map(each => ({ proof: each }))), []);
    // A pending proof is laid over a stored one of its id.
    assert.deepEqual(merged([entries[0]], [{ proof: newer }]).map(each => each.proof.payload.place), ['changed']);
    assert.equal(merged([entries[0]], []).length, 1);
});

test('a proof given as another kind of the same owner is not shown: the pin covers the kind, the owner and the id', () => {
    const { h, first, parent, child } = threeReplies();
    const record = h.chat[first].extra.storySuite;
    // An acceptance stored as a different kind of the same owner (the payload is a valid opaque one for it) keeps its payload hash.
    const proof = record.spans.find(span => span.evidence?.length).evidence[0];
    proof.kind = 'event';
    h.store.rebuild();
    assert.deepEqual(h.ask().map(each => each.id).filter(id => [parent, child].includes(id)), [], 'neither it nor what is built on it');
});

test('story.evidence with ids looks only at those proofs and their parents', () => {
    const proof = (id, payload, parents = []) => ({ id, source: { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 0 }, owner: SD, kind: 'visit', payload, payloadHash: hashJson(payload), parents });
    const a = proof('pf_aaaaaaa1', { place: 'a' });
    const b = proof('pf_bbbbbbb1', { place: 'b' }, [a.id]);
    // A proof nobody asked for, whose bytes cannot be read at all.
    const trap = { id: 'pf_trap0001', source: a.source, owner: SD, kind: 'visit', get payload() { throw new Error('looked at'); }, payloadHash: 'x', parents: [] };
    const pins = { [a.id]: pinOf(a, {}) };
    pins[b.id] = pinOf(b, pins);
    pins[trap.id] = 'x';
    const state = { meta: { rev: 1, proofs: pins } };
    const entries = [a, trap, b].map(each => ({ proof: each, block: 'bl_00000001' }));
    assert.deepEqual(ids(visibleProofs(state, entries, [b.id])), [b.id]);
    assert.deepEqual(ids(visibleProofs(state, entries, [a.id, 'pf_nope0001'])), [a.id]);
    assert.throws(() => visibleProofs(state, entries), /looked at/, 'asking for all does look at all');
});

test('a hand-edited record cannot publish a proof: pins written by a block with no proof of its own, proof on a span replay never applies', () => {
    const forge = edit => {
        const h = evidenceHarness();
        const at = h.send();
        assert.equal(h.command('sd.many', { specs: [{ kind: 'acceptance', payload: { thread: T1, selection: 'take it' } }] }).ok, true);
        assert.equal(h.ask().length, 1);
        const record = structuredClone(h.chat[at].extra.storySuite);
        edit(record);
        h.chat[at].extra.storySuite = record;
        h.store.rebuild();
        return h;
    };
    // The pin is written by a legacy block (no metadata), the proof sits on a span of no changes that replay never applies.
    const split = (record, claimGuarded) => {
        const span = record.spans.find(each => each.evidence?.length);
        record.spans = [{ n: record.ops.length, story: false }, { ...span, n: 0 }];
        record.receipts = record.receipts.map(({ guarded, ...receipt }) => ({ ...receipt, ...(claimGuarded ? { guarded } : {}), data: {} }));
    };
    const legacy = forge(record => split(record, false));
    assert.deepEqual(legacy.ask(), [], 'nothing is published');
    assert.equal(legacy.store.head().meta.proofs, undefined, 'the pin was not written');
    assert.match(legacy.problems()[0].why, /changes the record of proof pins/);
    // The same, with the receipt still saying the block was guarded: the classifier takes it for a guarded block that lost its metadata.
    const stripped = forge(record => split(record, true));
    assert.deepEqual(stripped.ask(), []);
    assert.equal(stripped.store.head().meta.proofs, undefined);
    assert.match(stripped.problems()[0].why, /damaged/);
    // The block is whole and applied, but its proof moved to a span of no changes beside it.
    const moved = forge(record => {
        const span = record.spans.find(each => each.evidence?.length);
        record.spans = [{ ...span, evidence: [] }, { ...span, id: 'bl_forged001', n: 0 }];
    });
    assert.deepEqual(moved.ask(), []);
    assert.equal(moved.problems().length, 1, 'the block that pins proof it does not hold is not applied');
    // A span of no changes with a proof, beside a block that pins nothing.
    const bare = forge(record => {
        const span = record.spans.find(each => each.evidence?.length);
        record.spans = [...record.spans, { ...span, id: 'bl_forged002', n: 0 }];
    });
    assert.deepEqual(ids(bare.ask()), ids(bare.store.proofs().filter(entry => entry.block !== 'bl_forged002').map(entry => entry.proof)), 'only the real block\'s proof');
    assert.equal(bare.ask().length, 1);
    assert.equal(bare.store.proofs().every(entry => entry.block !== 'bl_forged002'), true, 'the empty span is not even listed');
});

test('a record lists the proof of a block only when replay could apply it: it has changes, whole metadata, its own source, and holds what it pins', () => {
    const h = evidenceHarness();
    const at = h.send();
    h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] });
    const make = () => structuredClone(h.chat[at].extra.storySuite);
    const list = (record, parts) => recordEntries(record, parts).length;
    const parts = record => { let from = 0; return record.spans.map(span => { const out = { ops: record.ops.slice(from, from + span.n), span }; from += span.n; return out; }); };
    const whole = make();
    assert.equal(list(whole, parts(whole)), 1);
    const empty = make();
    empty.spans[0].n = 0;
    assert.equal(list(empty, [{ ops: [], span: empty.spans[0] }]), 0, 'no changes: never applied');
    const pinless = make();
    assert.equal(list(pinless, [{ ops: pinless.ops.filter(op => !op.path.startsWith('/meta/proofs')), span: pinless.spans[0] }]), 0, 'changes that pin nothing');
    const other = make();
    other.source.logical = 'sr_otherrepl';
    assert.equal(list(other, parts(other)), 0, 'another reply\'s source');
    const damaged = make();
    delete damaged.spans[0].boundaries;
    assert.equal(list(damaged, parts(damaged)), 0, 'damaged metadata');
});

test('a block that replay skips lists no proof, and a proof of an unvalidated span is not listed', () => {
    const { h, mode, parent } = threeReplies();
    assert.equal(h.store.proofs().length, 2);
    mode.value = 'deny';
    h.store.rebuild();
    assert.deepEqual(h.ask(), []);
    // The skipped block is stored with its proof, but it is not active; it publishes nothing and a pin cannot come from elsewhere.
    assert.equal(h.store.head().meta.proofs?.[parent], undefined);
});

test('a chain of ten thousand proofs is read without a stack, by id or all; a cycle is still not shown', () => {
    const source = { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 0 };
    const proof = (n, parents) => {
        const payload = { n };
        return { id: `pf_${n.toString(36).padStart(8, '0')}`, source, owner: SD, kind: 'visit', payload, payloadHash: hashJson(payload), parents };
    };
    const chain = [];
    const pins = {};
    for (let n = 0; n < 10000; n += 1) {
        const made = proof(n, n ? [chain[n - 1].id] : []);
        chain.push(made);
        pins[made.id] = pinOf(made, pins);
    }
    const list = Object.freeze(chain.map(each => ({ proof: each, block: 'bl_00000001' })));
    const state = { meta: { rev: 1, proofs: pins } };
    assert.equal(visibleProofs(state, list).length, 10000);
    assert.deepEqual(ids(visibleProofs(state, list, [chain.at(-1).id])), [chain.at(-1).id]);
    // Break the first link: all of them hang on it.
    const broken = { meta: { rev: 1, proofs: { ...pins, [chain[0].id]: 'x' } } };
    assert.deepEqual(visibleProofs(broken, list, [chain.at(-1).id]), []);
    assert.equal(visibleProofs(broken, list).length, 0);
});

test('story.evidence refuses a list with a gap in it', () => {
    const h = evidenceHarness();
    h.send();
    const [made] = h.command('demo.many', { specs: [{ kind: 'event', payload: { foe: 'wolf' } }] }).receipt.data.proofs;
    const gap = [made.id, , ];
    assert.deepEqual(h.ask({ ids: gap }), []);
    assert.deepEqual(ids(h.ask({ ids: [made.id] })), [made.id]);
});

test('the pins a block writes are read from its ops; on replay the record is made when it is missing and never written over', () => {
    assert.deepEqual([...proofPins([
        { op: 'add', path: '/meta/proofs', value: { pf_aaaaaaaa: 'h1', pf_bbbbbbbb: 5 } },
        { op: 'add', path: '/meta/proofs/pf_cccccccc', value: 'h3' },
        { op: 'remove', path: '/meta/proofs/pf_dddddddd' },
        { op: 'add', path: '/meta/rev', value: 3 },
        { op: 'add', path: '/domains/x/proofs/pf_eeeeeeee', value: 'h5' },
    ])], [['pf_aaaaaaaa', 'h1'], ['pf_bbbbbbbb', null], ['pf_cccccccc', 'h3']]);
    assert.deepEqual([...proofPins(null)], []);
    const whole = [{ op: 'add', path: '/meta/proofs', value: { pf_new00001: 'h' } }, { op: 'replace', path: '/meta/rev', value: 4 }];
    // Where there are pins already, the whole record becomes a write per id: the earlier ones stay.
    assert.deepEqual(pinOps({ meta: { proofs: { pf_old00001: 'g' } } }, whole), [{ op: 'add', path: '/meta/proofs/pf_new00001', value: 'h' }, whole[1]]);
    // Where there are none, the record is made first (also for a block that only adds one id).
    assert.deepEqual(pinOps({ meta: {} }, whole), [{ op: 'add', path: '/meta/proofs', value: {} }, { op: 'add', path: '/meta/proofs/pf_new00001', value: 'h' }, whole[1]]);
    const one = [{ op: 'add', path: '/meta/proofs/pf_new00002', value: 'h' }];
    assert.deepEqual(pinOps({ meta: {} }, one), [{ op: 'add', path: '/meta/proofs', value: {} }, one[0]]);
    assert.deepEqual(pinOps({ meta: { proofs: {} } }, one), one);
    assert.deepEqual(pinOps({ meta: {} }, [{ op: 'add', path: '/meta/rev', value: 1 }]), [{ op: 'add', path: '/meta/rev', value: 1 }]);
});

test('proof is kept by the record: trimmed receipts keep it, a checkpoint carries the pins, a reload shows the same', () => {
    const h = evidenceHarness({ options: { checkpointEvery: 3, receiptKeep: 3 } });
    const given = [];
    const replies = [];
    for (let n = 0; n < 9; n += 1) {
        replies.push(h.send());
        const out = h.command('demo.many', { specs: [{ kind: 'event', payload: { foe: `wolf-${n}` } }] });
        assert.equal(out.ok, true, out.message);
        given.push(out.receipt.data.proofs[0].id);
    }
    const before = JSON.stringify(h.ask());
    assert.deepEqual(ids(h.ask()), given);
    h.store.rebuild();
    // The receipts three carriers back lost their display data and kept data.v2, with the proof on it.
    const old = h.record(replies[0]);
    assert.deepEqual(Object.keys(old.receipts[0].data), ['v2'], 'trimmed');
    assert.deepEqual(old.receipts[0].data.v2.evidence.map(proof => proof.id), [given[0]]);
    assert.deepEqual(old.spans[0].evidence.map(proof => proof.id), [given[0]], 'the block keeps the proof whatever the receipts do');
    assert.deepEqual(Object.keys(h.record(replies.at(-1)).receipts[0].data).sort(), ['proofs', 'v2'], 'recent receipts keep their data');
    assert.equal(JSON.stringify(h.ask()), before, 'trimming changes nothing');
    // A checkpoint carries the pins the state held, so a replay that starts from it knows them.
    const checkpoint = replies.map(at => h.record(at)).filter(record => record.checkpoint && record.checkpoint.meta.proofs).at(-1);
    assert.ok(checkpoint, 'a checkpoint with pins');
    assert.ok(Object.keys(checkpoint.checkpoint.meta.proofs).length >= 2);
    // Reload: the chat as JSON and back.
    const copy = JSON.parse(JSON.stringify(h.chat));
    h.chat.splice(0, h.chat.length, ...copy);
    h.store.rebuild();
    assert.equal(JSON.stringify(h.ask()), before);
    assert.deepEqual(h.problems(), []);
    // The same chat after the oldest reply is deleted: its proof goes with it, the others stay.
    h.chat.splice(replies[0] - 1, 2);
    h.store.rebuild();
    assert.deepEqual(ids(h.ask()), given.slice(1));
});

test('the bytes of a stored proof are pinned: what a block keeps is exactly this', () => {
    const h = evidenceHarness();
    const at = h.send();
    const out = h.command('sd.many', { chain: true, specs: [{ kind: 'visit', payload: { place: 'pack.x/mill' } }, { kind: 'event', payload: { check: 'ck_check001', actor: 'ac_hero0001', stat: 'STR', dc: 12 } }] });
    assert.equal(out.ok, true, out.message);
    const stored = h.proofsOf(at);
    // The key order is the one the host writes: id, source, owner, kind, payload, payloadHash, parents. The hashes are
    // SHA-256 of {"place":"pack.x/mill"} and of {"actor":"ac_hero0001","check":"ck_check001","dc":12,"stat":"STR"}.
    const source = '{"sid":"sr_dmfbj6ec","swipeKey":"sw_8jzvvb8q","evidence":"ev_857zrupl","ordinal":0}';
    assert.equal(JSON.stringify(stored), `[{"id":"pf_dw6nv5jz","source":${source},"owner":"story-director","kind":"visit","payload":{"place":"pack.x/mill"},`
        + '"payloadHash":"ba4aa08de10908a0f6e5482a8cd4f3c0f0819cad88c5ebead8c310a298f68034","parents":[]},'
        + `{"id":"pf_7j227crj","source":${source},"owner":"story-director","kind":"event","payload":{"check":"ck_check001","actor":"ac_hero0001","stat":"STR","dc":12},`
        + '"payloadHash":"0bbeafc3eee44302ed056fc6e8cf714e53986dadc861351a1a43e8d55bab646f","parents":["pf_dw6nv5jz"]}]');
    // The pins in the state: SHA-256 of the lines "pin", id, kind, owner, payload hash, then "parent id=parent's pin" for each parent.
    const first = sha256('pin\npf_dw6nv5jz\nvisit\nstory-director\nba4aa08de10908a0f6e5482a8cd4f3c0f0819cad88c5ebead8c310a298f68034');
    assert.deepEqual(h.store.head().meta.proofs, {
        pf_dw6nv5jz: first,
        pf_7j227crj: sha256(`pin\npf_7j227crj\nevent\nstory-director\n0bbeafc3eee44302ed056fc6e8cf714e53986dadc861351a1a43e8d55bab646f\npf_dw6nv5jz=${first}`),
    });
    // Saved and read back from the chat file, nothing about it changes.
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(h.record(at))).spans[0].evidence), JSON.stringify(stored));
});

test('a new swipe has fresh proof ids; the proof of a swipe that is not shown is not shown', () => {
    const h = evidenceHarness();
    const at = h.send();
    const message = h.chat[at];
    const first = h.command('sd.accept', { thread: T1, selection: 'take it' }).receipt.data.proof;
    assert.deepEqual(ids(h.ask()), [first.id]);
    const firstSource = h.ask()[0].source;
    // SillyTavern's new swipe copies the record; the copy is not the new swipe's own, so its proof is not there.
    newSwipe(message, 'Another try.');
    h.store.rebuild();
    assert.deepEqual(h.ask(), [], 'the first swipe\'s proof does not follow to the second');
    const second = h.command('sd.accept', { thread: T1, selection: 'take it' }).receipt.data.proof;
    assert.notEqual(second.id, first.id, 'a fresh id for the new swipe');
    assert.equal(second.payloadHash, first.payloadHash, 'the same words hash the same');
    assert.deepEqual(ids(h.ask()), [second.id]);
    assert.notEqual(h.ask()[0].source.swipeKey, firstSource.swipeKey, 'the proof names the swipe it was given on');
    assert.notEqual(h.ask()[0].source.evidence, firstSource.evidence);
    assert.equal(h.ask()[0].source.sid, firstSource.sid, 'the same logical message');
    // Showing the first swipe again brings its proof back, and only its.
    showSwipe(message, 0);
    h.store.rebuild();
    assert.deepEqual(ids(h.ask()), [first.id]);
    showSwipe(message, 1);
    h.store.rebuild();
    assert.deepEqual(ids(h.ask()), [second.id]);
});
