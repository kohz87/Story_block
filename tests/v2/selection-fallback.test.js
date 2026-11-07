// The head-selection fallback chain and walk (B group spec 3a): matching prefixes newest first,
// the baseline last, one deterministic order, and verify-before-prepare with no installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boundaryMatches, createSelectionFallback, settledPlan } from '../../src/v2/timeline/selection-fallback.js';

const MODULE = 'tl-native';
const descriptor = (checkpoint, schema = 1) => ({ module: MODULE, checkpoint, hash: `hash-${checkpoint}`, schema });

function fixture() {
    const mappings = [];
    const witnesses = new Map();
    const add = (seq, checkpoint, index, op, state, prefixHash = `prefix-${checkpoint}`, witnessPatch = {}) => {
        const cursor = { sid: `sid-${checkpoint}`, swipeKey: `swipe-${checkpoint}`, block: `block-${checkpoint}`, op };
        const stateHash = state.hash;
        mappings.push({ seq, participant: MODULE, boundary: { cursor, prefixHash, stateHash }, after: descriptor(checkpoint) });
        witnesses.set(cursor.sid, { index, op, prefixHash, state, ...witnessPatch });
        return cursor;
    };
    add(1, 'ck-one', 2, 0, { hash: 'state-one' });
    add(2, 'ck-two', 5, 2, { hash: 'state-two' });
    add(3, 'ck-three', 5, 1, { hash: 'state-three' });
    // A changed prefix and a changed replayed state are not candidates.
    add(4, 'ck-prefix-changed', 4, 0, { hash: 'state-four' }, 'mapping-prefix-four', { prefixHash: 'different-witness-prefix' });
    add(5, 'ck-state-changed', 3, 0, { hash: 'state-five' }, 'prefix-state-changed', { state: { hash: 'another-state' } });
    const baseline = descriptor('ck-baseline');
    const archive = {
        exists: () => true,
        prefixes: module => mappings.filter(mapping => mapping.participant === module),
        baseline: () => ({ [MODULE]: baseline }),
    };
    const store = {
        witnessScope: read => read(),
        prefixWitness(cursor) {
            if (cursor?.sid === 'marker-root') return { index: 5, op: 1, prefixHash: 'marker', state: { hash: 'marker' } };
            return witnesses.get(cursor?.sid) ?? null;
        },
    };
    return { archive, store, fallback: createSelectionFallback({ archive, store, witnessStateHash: state => state.hash }), baseline };
}

test('fallback chain: matching checkpoints newest first, then the baseline last', () => {
    const { fallback, baseline } = fixture();
    const chain = fallback.fallbackChain(MODULE);
    assert.deepEqual(chain.map(target => target.checkpoint), ['ck-two', 'ck-three', 'ck-one', 'ck-baseline']);
    assert.deepEqual(chain.map(target => target.source), ['prefix', 'prefix', 'prefix', 'baseline']);
    assert.deepEqual(chain.map(target => target.index), [5, 5, 2, null], 'ties use op, then the archive sequence');
    assert.deepEqual(chain.at(-1), { ...baseline, source: 'baseline', index: null, op: null, seq: null });
});

test('fallback chain: the same journal and chat give the same chain, with no clock input', async () => {
    const { fallback } = fixture();
    const first = fallback.fallbackChain(MODULE);
    const second = fallback.fallbackChain(MODULE);
    assert.deepEqual(second, first);
    assert.equal(JSON.stringify(second), JSON.stringify(first));
    const source = await readFile(new URL('../../src/v2/timeline/selection-fallback.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Date\.now\b|Math\.random\b/);
});

test('fallback chain: the marker-root limit excludes later checkpoints', () => {
    const { fallback } = fixture();
    const chain = fallback.fallbackChain(MODULE, { sid: 'marker-root' });
    assert.deepEqual(chain.map(target => target.checkpoint), ['ck-three', 'ck-one', 'ck-baseline']);
});

test('boundary match: prefix identity and replayed state both decide', () => {
    const { archive, store } = fixture();
    const [mapping] = archive.prefixes(MODULE);
    const witness = store.prefixWitness(mapping.boundary.cursor);
    assert.equal(boundaryMatches(mapping, witness, { stateHashOf: state => state.hash }), true);
    assert.equal(boundaryMatches(mapping, { ...witness, prefixHash: 'other' }, { stateHashOf: state => state.hash }), false);
    assert.equal(boundaryMatches(mapping, { ...witness, state: { hash: 'other' } }, { stateHashOf: state => state.hash }), false);
});

test('selection walk: skip the failed target, verify newest first, then prepare only the first verified one', async () => {
    const { fallback } = fixture();
    const verifyInputs = [];
    const prepareInputs = [];
    const result = await fallback.walkSelectionFallback(MODULE, {
        from: descriptor('ck-two'), headIndex: 8,
        verify: async input => { verifyInputs.push(input); return input.checkpoint === 'ck-three' ? { ok: true } : { ok: false, code: 'SNAPSHOT_UNAVAILABLE', message: 'gone' }; },
        prepare: async input => { prepareInputs.push(input); return { ok: true, prepared: `pr-${input.checkpoint}`, hash: input.hash }; },
    });
    assert.equal(result.ok, true);
    assert.equal(result.target.checkpoint, 'ck-three');
    assert.deepEqual(verifyInputs, [{ checkpoint: 'ck-three', hash: 'hash-ck-three' }]);
    assert.deepEqual(prepareInputs, [{ checkpoint: 'ck-three', hash: 'hash-ck-three' }]);
    assert.deepEqual(result.fell, {
        module: MODULE, from: descriptor('ck-two'), to: descriptor('ck-three'), replies: 3,
    });
    assert.deepEqual(result.tried, [{ checkpoint: 'ck-three', hash: 'hash-ck-three' }]);
});

test('selection walk: a failed verify moves on without preparing that candidate', async () => {
    const { fallback } = fixture();
    const prepared = [];
    const result = await fallback.walkSelectionFallback(MODULE, {
        from: descriptor('ck-two'),
        verify: async input => input.checkpoint === 'ck-one' ? { ok: true } : { ok: false, code: 'CONFLICT', message: 'other line' },
        prepare: async input => { prepared.push(input.checkpoint); return { ok: true, prepared: `pr-${input.checkpoint}`, hash: input.hash }; },
    });
    assert.equal(result.target.checkpoint, 'ck-one');
    assert.deepEqual(prepared, ['ck-one']);
});

test('selection walk: without verify, prepare is the check and permanent failures walk on', async () => {
    const { fallback } = fixture();
    const prepared = [];
    const result = await fallback.walkSelectionFallback(MODULE, {
        from: descriptor('ck-two'), headIndex: 7,
        prepare: async input => {
            prepared.push(input.checkpoint);
            return input.checkpoint === 'ck-three'
                ? { ok: false, code: 'SNAPSHOT_UNAVAILABLE', message: 'gone' }
                : { ok: true, prepared: `pr-${input.checkpoint}`, hash: input.hash };
        },
    });
    assert.equal(result.target.checkpoint, 'ck-one');
    assert.deepEqual(prepared, ['ck-three', 'ck-one']);
    assert.equal(result.fell.replies, 5);
});

test('selection walk: a non-fallback failure stops, and nothing usable leaves the original failure as it was', async () => {
    const { fallback } = fixture();
    const stale = { ok: false, code: 'STALE', message: 'retry shortly' };
    const stopped = await fallback.walkSelectionFallback(MODULE, {
        from: descriptor('ck-two'), prepare: async () => stale,
    });
    assert.equal(stopped.code, 'STALE');
    const original = { ok: false, code: 'SNAPSHOT_UNAVAILABLE', message: 'the selected head is gone' };
    const walked = await fallback.walkSelectionFallback(MODULE, {
        from: descriptor('ck-two'), failure: original,
        prepare: async () => ({ ok: false, code: 'CONFLICT', message: 'other bytes' }),
    });
    assert.equal(walked, original, 'the block keeps today\'s failure');
});

test('selection walk: a temporary verify failure stops before an older point is prepared', async () => {
    const { fallback } = fixture();
    const calls = [];
    const result = await fallback.walkSelectionFallback(MODULE, {
        from: descriptor('ck-two'),
        verify: async input => { calls.push(input.checkpoint); return { ok: false, code: 'STALE', message: 'retry shortly' }; },
        prepare: async input => { calls.push(`prepared ${input.checkpoint}`); return { ok: true, prepared: 'pr', hash: input.hash }; },
    });
    assert.equal(result.code, 'STALE');
    assert.deepEqual(calls, ['ck-three']);
});

test('selection walk: never moves to a newer point, an absent head, or an incompatible schema', async () => {
    const { fallback } = fixture();
    const calls = [];
    const prepare = async input => { calls.push(input.checkpoint); return { ok: true, prepared: 'pr', hash: input.hash }; };
    const chain = fallback.fallbackChain(MODULE);
    const below = await fallback.walkSelectionFallback(MODULE, { from: descriptor('ck-three'), chain, prepare });
    assert.equal(below.target.checkpoint, 'ck-one');
    assert.deepEqual(calls, ['ck-one']);
    calls.length = 0;
    const original = { ok: false, code: 'SNAPSHOT_UNAVAILABLE', message: 'gone' };
    // (a point that left the head is not the original block: the unfinished selection is planned again)
    const gone = await fallback.walkSelectionFallback(MODULE, { from: descriptor('no-longer-on-head'), chain, prepare, failure: original });
    assert.equal(gone.replan, true);
    assert.equal(gone.code, 'STALE');
    assert.deepEqual(calls, []);
    chain[1].schema = 2;
    const compatible = await fallback.walkSelectionFallback(MODULE, { from: descriptor('ck-two'), chain, prepare });
    assert.equal(compatible.target.checkpoint, 'ck-one');
    assert.deepEqual(calls, ['ck-one']);
});

test('settled fallback selections survive a different participant needing a new selection', () => {
    const from = descriptor('missing');
    const to = descriptor('earlier');
    const plan = { [MODULE]: from, other: { checkpoint: 'new' } };
    const selection = { [MODULE]: to, other: { checkpoint: 'old' } };
    const entries = [{ kind: 'selection', phase: 'complete', fell: { module: MODULE, from, to, replies: 2 } }];
    assert.deepEqual(settledPlan(plan, selection, entries), { [MODULE]: to, other: { checkpoint: 'new' } });
    const another = { module: 'other', from: { checkpoint: 'new', hash: 'n' }, to: { checkpoint: 'old', hash: 'o' } };
    assert.deepEqual(settledPlan({ ...plan, other: another.from }, { ...selection, other: another.to }, [{ ...entries[0], fellOthers: [another] }]), { [MODULE]: to, other: another.to });
});
