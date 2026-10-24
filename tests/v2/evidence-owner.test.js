// The proof of the blocks that applied, in apply order (docs/v2/EVIDENCE.md): a proof id belongs to the block that applied
// with it first; a later block that gives the same id collides and does not apply; skipped, inactive and damaged blocks
// give no proof and decide nothing about another's. And a block with a change that is not a change fails closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { pinOf } from '../../src/v2/evidence.js';
import { SD, T1, T2, director, evidenceHarness, fighter, hostModule } from './helpers/evidence.js';

const ids = list => list.map(each => each.id);
const collisions = h => h.problems().filter(problem => /already belongs to a block that applied/.test(problem.why));

// Gives the proof of `record`'s block (a hand edit) another id, with the pin its ops write: `record` is the record to change.
function reid(record, from, to) {
    const span = record.spans.find(each => each.evidence?.some(proof => proof.id === from));
    const proof = span.evidence.find(each => each.id === from);
    proof.id = to;
    const pin = pinOf(proof, {});
    record.ops = record.ops.map(op => {
        if (op.path === `/meta/proofs/${from}`) return { ...op, path: `/meta/proofs/${to}`, value: pin };
        if (op.path === '/meta/proofs' && op.value?.[from] !== undefined) return { ...op, value: { [to]: pin } };
        return op;
    });
}

// Two replies: A on the first, B on the second (B guarded when `guard`), then B's proof takes A's id by hand.
function duplicate({ guard = false, deny = false, swap = false } = {}) {
    const mode = { value: 'normal' };
    const h = evidenceHarness({ mode });
    const one = h.send();
    const a = (swap ? guard : false)
        ? h.command('sd.guarded', { thread: T1, selection: 'first' }).receipt.data.proof
        : h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
    const two = h.send();
    const b = (swap ? false : guard)
        ? h.command('sd.guarded', { thread: T2, selection: 'second' }).receipt.data.proof
        : h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'b' } }] }).receipt.data.proofs[0];
    const record = structuredClone(h.chat[two].extra.storySuite);
    reid(record, b.id, a.id);
    h.chat[two].extra.storySuite = record;
    if (deny) mode.value = 'deny';
    h.store.rebuild();
    return { h, a, b, one, two, mode };
}

test('a skipped block that reuses an applied proof\'s id does not hide it (B1): the owner is the block that applied', () => {
    const { h, a } = duplicate({ guard: true, deny: true });
    assert.deepEqual(ids(h.ask({ ids: [a.id] })), [a.id], 'the first proof is shown');
    assert.deepEqual(ids(h.ask()), [a.id]);
    assert.equal(h.ask()[0].payload.place, 'a', 'with its own bytes');
    assert.equal(h.store.head().meta.proofs[a.id], pinOf(h.ask()[0], {}), 'and its own pin');
    assert.ok(h.problems().length >= 1, 'the denied block is reported');
});

test('a later block that gives an id another applied block owns collides and does not apply', () => {
    const { h, a } = duplicate({ guard: false });
    assert.deepEqual(ids(h.ask()), [a.id]);
    assert.equal(h.ask()[0].payload.place, 'a');
    assert.equal(collisions(h).length, 1);
    assert.equal(h.store.head().meta.proofs[a.id], pinOf(h.ask()[0], {}));
    // The collider changed nothing else either: its command's own changes went with its block.
    assert.deepEqual(h.store.head().domains.sdt.log, [1]);
});

test('the duplicate applied first owns the id; the other collides, whichever way round they stand', () => {
    // B (second reply) takes A's id: A applied first and keeps it. Here the guard on A (the first reply) is denied: B applies first and owns it.
    const { h, a, b } = duplicate({ guard: true, swap: true, deny: true });
    const shown = h.ask({ ids: [a.id] });
    assert.equal(shown.length, 1, 'one proof under the id');
    assert.equal(shown[0].payload.place, 'b', 'the block that applied, the second reply\'s');
    assert.notEqual(shown[0].payloadHash, a.payloadHash);
    assert.equal(b.id !== undefined, true);
    // Back to a guard that holds: the first reply applies first and owns the id again; the second collides.
    const { h: again, a: first } = duplicate({ guard: true, swap: true });
    const back = again.ask({ ids: [first.id] });
    assert.equal(back.length, 1);
    assert.equal(back[0].payloadHash, first.payloadHash, 'the first block owns it');
    assert.equal(collisions(again).length, 1);
});

test('a block that is off does not decide anything about a proof of the same id on another reply, and a new proof does not take its id', () => {
    const { h, a } = duplicate({ guard: true, deny: true });
    const listed = h.store.proofs().map(entry => entry.proof.id);
    assert.deepEqual(listed, [a.id], 'the projection lists the block that applied');
    // A new proof on the head reply is given an id that no stored block could use, applied or not.
    const made = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'b' } }] }).receipt.data.proofs[0];
    assert.notEqual(made.id, a.id);
    assert.equal(h.store.proofs({ all: true }).filter(entry => entry.proof.id === a.id).length, 2, 'every block that could apply holds the id, the denied one too: none of them is a free id');
});

test('an id taken by a hand edit survives a truncate and a rebuild: the projection follows the blocks that apply', () => {
    const mode = { value: 'normal' };
    const h = evidenceHarness({ mode });
    h.send();
    const a = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' } }] }).receipt.data.proofs[0];
    const at = h.send();
    const first = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] });
    const second = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'bear' } }] });
    assert.deepEqual(ids(h.ask()), [a.id, first.receipt.data.proofs[0].id, second.receipt.data.proofs[0].id]);
    const rev = second.receipt.rev;
    h.store.truncate(at, rev);
    assert.deepEqual(ids(h.ask()), [a.id, first.receipt.data.proofs[0].id], 'the dropped block\'s proof goes');
    assert.deepEqual(h.store.proofs().map(entry => entry.proof.id), [a.id, first.receipt.data.proofs[0].id]);
    // A collision across a checkpoint-free rebuild after the truncate: the later block collides again.
    const record = structuredClone(h.chat[at].extra.storySuite);
    reid(record, first.receipt.data.proofs[0].id, a.id);
    h.chat[at].extra.storySuite = record;
    h.store.rebuild();
    assert.deepEqual(ids(h.ask()), [a.id]);
    assert.equal(h.ask()[0].kind, 'kill', 'the first block\'s bytes');
});

test('through a Re-read: a kept block that gives the id of a line read again collides, and the line owns it', async t => {
    const link = hostModule();
    const host = await createHost({ modules: [link.def, director(), fighter()], core: false });
    t.after(() => host.close());
    link.link(host.store);
    const text = lines => `Dawn.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    await host.send('Sure, I accept the job. Thanks a lot!', text([`! accept ${T1} | words: Sure, I accept the job`]));
    const at = host.ctx.chat.length - 1;
    const accepted = host.sdk.query('story.evidence', {})[0];
    const click = host.bus.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' } }] }, { cause: 'ui' });
    assert.equal(click.ok, true);
    // The click's proof takes the line\'s id by hand.
    const record = structuredClone(host.ctx.chat[at].extra.storySuite);
    reid(record, click.receipt.data.proofs[0].id, accepted.id);
    host.ctx.chat[at].extra.storySuite = record;
    host.store.rebuild();
    const shown = () => host.sdk.query('story.evidence', {});
    assert.deepEqual(shown().map(proof => proof.kind), ['acceptance'], 'the line owns the id, the click collided');
    const result = await host.turn.reread(at);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(shown().map(proof => proof.kind), ['acceptance']);
    assert.equal(shown()[0].id, accepted.id);
});

test('a change that is not a change fails closed: the block is not applied, lists no proof, and is a Problem, never a throw (B2)', () => {
    const malformed = {
        null: null,
        number: 7,
        text: 'x',
        'no path': { op: 'add', value: 1 },
        'path not text': { op: 'add', path: 5, value: 1 },
        'unreadable path': { op: 'add', path: 'meta', value: 1 },
        'unknown op': { op: 'frobnicate', path: '/domains/sdt/log/-', value: 1 },
        'no value': { op: 'add', path: '/domains/sdt/log/-' },
        list: ['add', '/x'],
    };
    for (const [name, bad] of Object.entries(malformed)) {
        const h = evidenceHarness();
        h.send();
        const first = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' } }] }).receipt.data.proofs[0];
        const at = h.send();
        const second = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
        const record = structuredClone(h.chat[at].extra.storySuite);
        const span = record.spans.find(each => each.evidence?.length);
        record.ops.splice(0, 0, bad);
        span.n += 1;
        h.chat[at].extra.storySuite = record;
        h.store.rebuild();
        let shown;
        assert.doesNotThrow(() => { shown = ids(h.ask()); }, `${name}: the query does not throw`);
        assert.deepEqual(shown, [first.id], `${name}: the other proof is shown, the damaged block gives none`);
        assert.deepEqual(h.ask({ ids: [second.id] }), [], name);
        assert.equal(h.store.proofs({ all: true }).some(entry => entry.proof.id === second.id), false, `${name}: nor does the stored listing`);
        assert.ok(h.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'), `${name}: a Problem`);
    }
});

test('a legacy block with a change that is not a change is a Problem and the proofs stand', () => {
    for (const bad of [null, 7, 'x', { op: 'add', value: 1 }, { op: 'add', path: 5, value: 1 }, { op: 'wat', path: '/x', value: 1 }]) {
        const h = evidenceHarness();
        const at = h.send();
        const made = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
        const record = structuredClone(h.chat[at].extra.storySuite);
        record.ops.push(bad);
        record.spans.push({ n: 1, story: false });
        h.chat[at].extra.storySuite = record;
        h.store.rebuild();
        assert.deepEqual(ids(h.ask()), [made.id], JSON.stringify(bad));
        assert.ok(h.problems().length >= 1, JSON.stringify(bad));
    }
    assert.equal(SD, 'story-director');
});
