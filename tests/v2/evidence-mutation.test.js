// Nothing but the block that owns a proof may change the record of proof pins (docs/v2/EVIDENCE.md, "Where a proof lives"):
// a hand-edited block that writes, rewrites or erases `/meta/proofs`, or the `/meta` or the state around it, is refused
// (a block with no proof of its own) or not applied (a guarded block that changes more than its own pins), and what is
// shown follows the state replay applied, never the spans alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proofWriteProblem, touchesProof } from '../../src/v2/evidence.js';
import { T1, evidenceHarness } from './helpers/evidence.js';

const ids = list => list.map(each => each.id);

// A chat with a real proof on its first reply and a second on its second; `edit(record, mine, other)` changes the second
// reply's record in place. → the harness, with the first and second proof.
function chatWith(edit, { guard = false } = {}) {
    const mode = { value: 'normal' };
    const h = evidenceHarness({ mode });
    h.send();
    const first = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' } }] }).receipt.data.proofs[0];
    const at = h.send();
    const second = guard
        ? h.command('sd.guarded', { thread: T1, selection: 'take it' }).receipt.data.proof
        : h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
    const record = structuredClone(h.chat[at].extra.storySuite);
    edit?.(record, { first, second, mode, at });
    h.chat[at].extra.storySuite = record;
    h.store.rebuild();
    return { h, first, second, mode, at };
}

// A block with no metadata appended to the second reply's record, with the changes `ops` and a rev after the last.
const legacy = ops => record => {
    const rev = Math.max(...record.ops.filter(op => op.path === '/meta/rev').map(op => op.value)) + 1;
    const all = [...ops(record), { op: 'replace', path: '/meta/rev', value: rev }];
    record.ops.push(...all);
    record.spans.push({ n: all.length, story: false });
};

const prerequisites = h => h.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE');

test('a block with no proof of its own cannot rewrite /meta around the pins of a block that was denied (repro a)', () => {
    const { h, mode, second } = (() => {
        const mode = { value: 'normal' };
        const h = evidenceHarness({ mode });
        const at = h.send();
        const made = h.command('sd.guarded', { thread: T1, selection: 'take it' }).receipt.data.proof;
        // The saved pin, and the guard denied: the block does not apply.
        const pin = h.store.head().meta.proofs[made.id];
        const record = structuredClone(h.chat[at].extra.storySuite);
        const rev = Math.max(...record.ops.filter(op => op.path === '/meta/rev').map(op => op.value)) + 1;
        record.ops.push({ op: 'replace', path: '/meta', value: { rev, claims: {}, proofs: { [made.id]: pin } } });
        record.spans.push({ n: 1, story: false });
        h.chat[at].extra.storySuite = record;
        mode.value = 'deny';
        h.store.rebuild();
        return { h, mode, second: made };
    })();
    assert.equal(mode.value, 'deny');
    assert.deepEqual(h.ask({ ids: [second.id] }), [], 'the acceptance is not shown: its block did not apply, and the rewrite of /meta did not either');
    assert.equal(h.store.head().meta.proofs, undefined, 'no pin');
    assert.equal(prerequisites(h).length, 2, 'both blocks are reported');
    assert.ok(prerequisites(h).some(problem => /changes the record of proof pins/.test(problem.why)));
});

test('a block with no proof of its own cannot erase the pins that stand (repro b), whatever it writes', () => {
    const erase = {
        'replace /meta/proofs with {}': () => [{ op: 'replace', path: '/meta/proofs', value: {} }],
        'remove /meta/proofs': () => [{ op: 'remove', path: '/meta/proofs' }],
        'add /meta/proofs with {}': () => [{ op: 'add', path: '/meta/proofs', value: {} }],
        'replace /meta': () => [{ op: 'replace', path: '/meta', value: { rev: 99, claims: {} } }],
        'remove /meta': () => [{ op: 'remove', path: '/meta' }],
        'replace the root': () => [{ op: 'replace', path: '', value: { v: 2, meta: { rev: 99, claims: {} }, domains: {} } }],
        'remove one pin': record => [{ op: 'remove', path: `/meta/proofs/${Object.keys(record.checkpoint?.meta?.proofs ?? {})[0] ?? 'pf_00000000'}` }],
        'move the record': () => [{ op: 'move', from: '/meta/proofs', path: '/meta/gone' }],
        'copy the record': () => [{ op: 'copy', from: '/meta/proofs', path: '/meta/backup' }],
        'move a pin': () => [{ op: 'move', from: '/meta/proofs/pf_00000000', path: '/meta/x' }],
        'an unreadable path': () => [{ op: 'remove', path: '/meta/proofs/~2' }],
    };
    for (const [name, ops] of Object.entries(erase)) {
        const { h, first, second } = chatWith(legacy(ops));
        assert.deepEqual(ids(h.ask()), [first.id, second.id], `${name}: both proofs are still shown`);
        assert.ok(prerequisites(h).some(problem => /changes the record of proof pins/.test(problem.why)), `${name}: reported (${h.problems().map(problem => problem.why).join(' | ')})`);
        assert.equal(Object.keys(h.store.head().meta.proofs).length, 2, `${name}: the pins stand`);
    }
});

test('a pin written by a block with no proof of its own is refused, with its own id or another\'s', () => {
    for (const ops of [
        () => [{ op: 'add', path: '/meta/proofs/pf_forged001', value: 'x' }],
        () => [{ op: 'replace', path: '/meta/proofs', value: { pf_forged001: 'x' } }],
    ]) {
        const { h, first, second } = chatWith(legacy(ops));
        assert.deepEqual(ids(h.ask()), [first.id, second.id]);
        assert.equal(h.store.head().meta.proofs.pf_forged001, undefined);
        assert.ok(prerequisites(h).length >= 1);
    }
});

test('a guarded block may change only the pins it owns, exactly as its span says', () => {
    const extra = {
        'erases another pin': ({ first }) => [{ op: 'remove', path: `/meta/proofs/${first.id}` }],
        'rewrites the record': () => [{ op: 'replace', path: '/meta/proofs', value: {} }],
        'rewrites /meta': () => [{ op: 'replace', path: '/meta', value: { rev: 99, claims: {} } }],
        'replaces another pin': ({ first }) => [{ op: 'replace', path: `/meta/proofs/${first.id}`, value: 'x' }],
        'moves a pin': ({ first }) => [{ op: 'move', from: `/meta/proofs/${first.id}`, path: '/meta/gone' }],
        'copies the record': () => [{ op: 'copy', from: '/meta/proofs', path: '/meta/backup' }],
    };
    for (const [name, make] of Object.entries(extra)) {
        const { h, first, second } = chatWith((record, context) => {
            // The second block's own changes, with one more change inside it (its span grows by one, its proof is its own).
            const span = record.spans.find(each => each.evidence?.length);
            const at = record.ops.findIndex(op => op.path === '/meta/rev');
            record.ops.splice(at, 0, ...make(context));
            span.n += make(context).length;
        });
        assert.deepEqual(ids(h.ask()), [first.id], `${name}: the first proof stays, the block that changes more than its pins is not applied`);
        assert.deepEqual(h.ask({ ids: [second.id] }), [], name);
        assert.ok(prerequisites(h).some(problem => /changes the record of proof pins|not the proof its changes pin/.test(problem.why)), `${name}: reported (${h.problems().map(problem => problem.why).join(' | ')})`);
    }
    // The pins it owns, in either form, are what a block does write.
    const own = chatWith(null, {});
    assert.equal(own.h.ask().length, 2);
    assert.deepEqual(prerequisites(own.h), []);
});

test('a guarded block keeps writing its own pins, as a whole record or one by one, and the pins of the blocks before it stand', () => {
    for (const whole of [true, false]) {
        const { h, first, second } = chatWith((record, { second }) => {
            const span = record.spans.find(each => each.evidence?.length);
            const at = record.ops.findIndex(op => op.path.startsWith('/meta/proofs'));
            const pin = record.ops[at].value;
            // The second block pins its own proof as one write of the whole record (if no pin stood before it) or one per id.
            record.ops.splice(at, 1, whole ? { op: 'add', path: '/meta/proofs', value: { [second.id]: typeof pin === 'string' ? pin : pin[second.id] } } : { op: 'add', path: `/meta/proofs/${second.id}`, value: typeof pin === 'string' ? pin : pin[second.id] });
            void span;
        });
        assert.deepEqual(ids(h.ask()), [first.id, second.id], whole ? 'the whole record' : 'one by one');
        assert.deepEqual(h.problems(), []);
    }
});

test('what is shown follows the state replay applied: a proof whose block is off stays off however its span reads', () => {
    const { h, second } = chatWith((record, { mode }) => { mode.value = 'deny'; }, { guard: true });
    assert.deepEqual(h.ask({ ids: [second.id] }), [], 'the guard turned the block off: its stored proof is not shown');
    assert.equal(h.store.proofs().some(entry => entry.proof.id === second.id), true, 'it is stored and listed, and not active');
    assert.equal(h.store.head().meta.proofs[second.id], undefined);
});

test('which changes touch the proof record: the root, /meta, /meta/proofs and below it, by path or by from; not rev or claims', () => {
    const touching = [
        { op: 'replace', path: '', value: {} }, { op: 'remove', path: '/meta' }, { op: 'replace', path: '/meta', value: {} },
        { op: 'add', path: '/meta/proofs', value: {} }, { op: 'remove', path: '/meta/proofs/pf_x' }, { op: 'replace', path: '/meta/proofs/pf_x/y', value: 1 },
        { op: 'move', from: '/meta/proofs', path: '/meta/a' }, { op: 'copy', from: '/meta/proofs/pf_x', path: '/domains/x/y' },
        { op: 'add', path: '/meta/proofs/a~1b', value: 'x' }, { op: 'add', path: '/meta/bad~2', value: 1 }, null, 'nope',
    ];
    for (const op of touching) assert.equal(touchesProof(op), true, JSON.stringify(op));
    const other = [
        { op: 'replace', path: '/meta/rev', value: 3 }, { op: 'add', path: '/meta/claims/k', value: true }, { op: 'add', path: '/meta/claims', value: {} },
        { op: 'add', path: '/domains/proofs/x', value: 1 }, { op: 'replace', path: '/domains/x/meta/proofs', value: 1 },
    ];
    for (const op of other) assert.equal(touchesProof(op), false, JSON.stringify(op));
    const owned = new Set(['pf_a']);
    assert.equal(proofWriteProblem([{ op: 'add', path: '/meta/proofs/pf_a', value: 'x' }, { op: 'replace', path: '/meta/rev', value: 2 }], owned), '');
    assert.equal(proofWriteProblem([{ op: 'add', path: '/meta/proofs', value: { pf_a: 'x' } }], owned), '');
    assert.equal(proofWriteProblem([{ op: 'add', path: '/meta/proofs', value: { pf_a: 'x', pf_b: 'y' } }], owned) === '', false);
    assert.equal(proofWriteProblem([{ op: 'add', path: '/meta/proofs/pf_b', value: 'x' }], owned) === '', false);
    assert.equal(proofWriteProblem([{ op: 'add', path: '/meta/proofs/pf_a', value: 5 }], owned) === '', false);
    assert.equal(proofWriteProblem([{ op: 'remove', path: '/meta/proofs/pf_a' }], owned) === '', false);
    assert.equal(proofWriteProblem([{ op: 'replace', path: '/meta/proofs', value: {} }], owned) === '', false, 'a whole record with nothing in it');
});
