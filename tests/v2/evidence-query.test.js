// story.evidence and what keeps a proof (docs/v2/EVIDENCE.md, contract §6 and §10 E): active, visible,
// code-validated proof only; hidden with a deleted or skipped parent or block; kept through trimming, checkpoints,
// reloads and swipes; and the bytes pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashJson } from '../../src/v2/replay.js';
import { LIMITS, merged, pinOf, pinOps, proofPins, visibleProofs } from '../../src/v2/evidence.js';
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
    const kill = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' }, parents: [accepted.receipt.data.proof.id] }] });
    assert.equal(kill.ok, true, kill.message);
    return { h, mode, first, second, parent: accepted.receipt.data.proof.id, child: kill.receipt.data.proofs[0].id };
}

test('story.evidence gives every visible proof in source order, or the ids asked for; unknown ones are left out', () => {
    const h = evidenceHarness();
    h.send();
    const visits = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }, { kind: 'visit', payload: { place: 'b' } }] }).receipt.data.proofs;
    h.send();
    const [kill] = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' } }] }).receipt.data.proofs;
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
    assert.deepEqual(h.store.head().domains.rpgt.log, [1], 'the child\'s own changes stand: it is only the proof that is hidden');
    assert.deepEqual(Object.keys(h.store.head().meta.proofs), [child], 'its pin is there, behind a parent that is not');
    assert.deepEqual(h.problems(), []);
    // A proof whose first-proof block is gone is still pinned when its own block replays (the record of pins is made again).
    h.send();
    const other = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'bear' } }] });
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
    // The block is stored still, with its proof, and is asked again.
    assert.equal(h.store.proofs().length, 2);
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
    const [kill] = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' } }] }).receipt.data.proofs;
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
    edit(record => { proofOf(record).owner = 'rpg-battle'; }, true);
    edit(record => { proofOf(record).kind = 'kill'; }, true);
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
    assert.equal(pins[parent.id], parent.payloadHash, 'no parents: the payload hash');
    assert.notEqual(pins[child.id], child.payloadHash, 'parents: covered too');
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
        const out = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: `wolf-${n}` } }] });
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
    assert.equal(JSON.stringify(stored), `[{"id":"pf_8p1nww9g","source":${source},"owner":"story-director","kind":"visit","payload":{"place":"pack.x/mill"},`
        + '"payloadHash":"ba4aa08de10908a0f6e5482a8cd4f3c0f0819cad88c5ebead8c310a298f68034","parents":[]},'
        + `{"id":"pf_7jtbmlc5","source":${source},"owner":"story-director","kind":"event","payload":{"check":"ck_check001","actor":"ac_hero0001","stat":"STR","dc":12},`
        + '"payloadHash":"0bbeafc3eee44302ed056fc6e8cf714e53986dadc861351a1a43e8d55bab646f","parents":["pf_8p1nww9g"]}]');
    // The pins in the state: the payload hash for a proof with no parents, the hash of it and its parents' pins otherwise.
    assert.deepEqual(h.store.head().meta.proofs, {
        pf_8p1nww9g: 'ba4aa08de10908a0f6e5482a8cd4f3c0f0819cad88c5ebead8c310a298f68034',
        pf_7jtbmlc5: hashJson({ h: '0bbeafc3eee44302ed056fc6e8cf714e53986dadc861351a1a43e8d55bab646f', p: [['pf_8p1nww9g', 'ba4aa08de10908a0f6e5482a8cd4f3c0f0819cad88c5ebead8c310a298f68034']] }),
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
