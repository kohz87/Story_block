// A proof id belongs to the block that holds it (docs/v2/EVIDENCE.md): a block planned again may take back only the ids it
// had itself, found by kind, key and place among its own; every id another block holds is kept for that block, in the same reply
// or not; and a plan that would still collide is refused before it applies and before it publishes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { pinOf } from '../../src/v2/evidence.js';
import { T1, director, evidenceHarness, fighter, hostModule } from './helpers/evidence.js';

const ids = list => list.map(each => each.id);
const steps = ask => ask({}).filter(proof => proof.payload.after === 'dependent');
const rerunOf = h => (state, receipt, info) => h.bus.run(info.replan.type, info.replan.payload, {
    cause: 'system', state, seed: info.replan.seed, replacing: info.span.evidence ?? [], occurrence: info.occurrence,
    reply: { index: info.index, sid: h.store.carrierSid(info.index), ordinal: info.span.source.ordinal },
});

async function open(t) {
    const link = hostModule();
    const wanted = ['a', 'b'];
    const host = await createHost({ modules: [link.def, director({ after: 'each', wanted }), fighter()], core: false });
    t.after(() => host.close());
    link.link(host.store);
    const ask = args => host.sdk.query('story.evidence', args);
    // Three replies that each give a proof (a visit), and a fourth whose afterCapture asks for a step on each wanted one.
    for (const place of ['a', 'b', 'c']) {
        await host.send('Go on.', `Narration of ${place}.`);
        const made = host.bus.command('sd.many', { specs: [{ kind: 'visit', payload: { place } }] }, { cause: 'ui' });
        assert.equal(made.ok, true, made.message);
    }
    await host.send('Sure, I accept the job. Thanks a lot!', `The last narration.\n\n<Changes>\n! accept ${T1} | words: Sure, I accept the job\n</Changes>`);
    return { host, ask, wanted };
}

test('an unchanged Re-read keeps every id: a step left at a salted id keeps it when another step of its key is added beside it', async t => {
    const { host, ask, wanted } = await open(t);
    const [first, second] = steps(ask);
    assert.equal(steps(ask).length, 2, 'a step on each wanted visit');
    assert.notEqual(first.id, second.id, 'two steps of one key, two ids');
    // The reply that gave `a` goes: the step on it is taken back by a reconcile, and the other keeps its salted id.
    await host.st.deleteMessage(2);
    await host.st.deleteMessage(1);
    assert.deepEqual(ids(steps(ask)), [second.id], 'the step on b stays at the id it had');
    // Another step of the same key is added by a Re-read that wants it: it takes the id that is free, below the survivor's.
    wanted.push('c');
    const added = await host.turn.reread(host.ctx.chat.length - 1);
    assert.equal(added.ok, true, added.message);
    const [kept, third] = steps(ask);
    assert.equal(kept.id, second.id, 'the survivor keeps its id');
    assert.notEqual(third.id, second.id);
    const map = () => JSON.stringify(ask({}).map(proof => [proof.id, proof.kind, proof.payloadHash, proof.parents]));
    const was = map();
    // Now nothing changes: a Re-read of the same text keeps every id and loses no proof, live and after a reload.
    for (let n = 0; n < 2; n += 1) {
        const again = await host.turn.reread(host.ctx.chat.length - 1);
        assert.equal(again.ok, true, again.message);
        assert.equal(map(), was, `Re-read ${n + 1} of the same text changes no id and loses no proof`);
    }
    assert.deepEqual(host.store.problems().filter(problem => problem.code !== 'REPLANNED'), []);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(map(), was, 'and a reload shows the same');
});

test('a step planned again by a reconcile keeps its id when another of its key is added beside it', () => {
    const h = evidenceHarness();
    h.send();
    const a = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
    h.send();
    const b = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'b' } }] }).receipt.data.proofs[0];
    h.send();
    const c = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'c' } }] }).receipt.data.proofs[0];
    h.send();
    const one = h.command('sd.dependent', { parent: a.id }, 'system').receipt.data.made;
    const two = h.command('sd.dependent', { parent: b.id }, 'system').receipt.data.made;
    h.chat.splice(1, 2);
    h.store.rebuild();
    assert.equal(h.store.reconcile(0, { rerun: rerunOf(h) }).removed, 1);
    assert.deepEqual(ids(steps(h.ask)), [two.id]);
    const three = h.command('sd.dependent', { parent: c.id }, 'system').receipt.data.made;
    assert.notEqual(three.id, two.id);
    void one;
    const was = JSON.stringify(h.ask().map(proof => [proof.id, proof.parents]));
    h.store.reconcile(0, { rerun: rerunOf(h) });
    assert.equal(JSON.stringify(h.ask().map(proof => [proof.id, proof.parents])), was, 'a reconcile that changes nothing changes no id');
    assert.deepEqual(h.problems(), []);
    h.store.rebuild();
    assert.equal(JSON.stringify(h.ask().map(proof => [proof.id, proof.parents])), was, 'and after a rebuild');
});

test('a plan that would take the id of a block that applied is refused: the owner stays and what is built on it stays shown', () => {
    const h = evidenceHarness();
    h.send();
    const a = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
    const second = h.send();
    const kill = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' } }] }).receipt.data.proofs[0];
    const third = h.send();
    // A step planned again by a reconcile, and one that comes later and needs it (a step too, so a reconcile plans it again).
    const step = h.command('sd.dependent', { parent: a.id }, 'system').receipt.data.made;
    h.send();
    const child = h.command('sd.dependent', { parent: step.id }, 'system').receipt.data.made;
    const pins = structuredClone(h.store.head().meta.proofs);
    const change = (at, from, to, parents) => {
        const record = structuredClone(h.chat[at].extra.storySuite);
        const span = record.spans.find(each => each.evidence?.some(proof => proof.id === from));
        const proof = span.evidence.find(each => each.id === from);
        proof.id = to;
        const pin = pinOf(proof, parents);
        record.ops = record.ops.map(op => {
            if (op.path === `/meta/proofs/${from}`) return { ...op, path: `/meta/proofs/${to}`, value: pin };
            if (op.path === '/meta/proofs' && op.value?.[from] !== undefined) return { ...op, value: { [to]: pin } };
            return op;
        });
        h.chat[at].extra.storySuite = record;
        return pin;
    };
    // The file is damaged: the kill's proof is edited by hand (its bytes and its pin) and holds the id the step derives for itself,
    // and the later step is pinned against what holds the id now, as a hand edit that keeps its own chain would.
    const taken = change(second, kill.id, step.id, {});
    change(h.chat.length - 1, child.id, child.id, { ...pins, [step.id]: taken });
    void third;
    h.store.rebuild();
    const shown = () => JSON.stringify(h.ask().map(each => [each.id, each.kind, each.parents]));
    const owner = () => h.ask({ ids: [step.id] });
    assert.equal(owner()[0]?.kind, 'kill', 'the block that applied first holds the id');
    assert.deepEqual(ids(h.ask({ ids: [child.id] })), [child.id], 'and what was built on it is shown');
    const was = shown();
    const done = h.store.reconcile(0, { rerun: rerunOf(h) });
    void done;
    assert.equal(owner()[0]?.kind, 'kill', 'a plan that would take the id is refused: the owner stays');
    assert.deepEqual(ids(h.ask({ ids: [child.id] })), [child.id], 'and what is built on it stays shown');
    assert.equal(shown(), was, 'a reconcile changes nothing here');
    h.store.rebuild();
    assert.equal(shown(), was, 'what a reconcile shows is what a replay shows');
    for (const each of h.ask()) for (const parent of each.parents) assert.ok(h.ask({ ids: [parent] }).length, `${each.id} has its parent shown`);
});

test('a Re-read that no longer asks for the first of several steps of one key leaves the others on the ids they had', async t => {
    const { host, ask, wanted } = await open(t);
    wanted.push('c');
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    const [one, two, three] = steps(ask);
    assert.equal(three !== undefined, true, 'a step on each of a, b and c');
    wanted.shift();
    const done = await host.turn.reread(host.ctx.chat.length - 1);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(ids(steps(ask)), [two.id, three.id], 'the steps on b and c keep their ids; the one on a is gone');
    void one;
    assert.deepEqual(host.store.problems().filter(problem => problem.code !== 'REPLANNED'), []);
});

test('several proofs of one key with one parent set in a reply, and a Continue: an unchanged Re-read keeps every id and what is built on them', async t => {
    const link = hostModule();
    const host = await createHost({ modules: [link.def, director({ checks: true }), fighter()], core: false });
    t.after(() => host.close());
    link.link(host.store);
    const ask = args => host.sdk.query('story.evidence', args);
    const check = dc => `! check ck_check001 | dc: ${dc}`;
    const text = lines => `The die falls.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    await host.send('Go on then.', text([check(10), check(11)]));
    // The reply goes on: two more of the key, the second the same line as an earlier one.
    await host.cont(text([check(12), check(11)]));
    const at = host.ctx.chat.length - 1;
    const checks = () => ask({}).filter(proof => proof.kind === 'event');
    assert.deepEqual(checks().map(proof => proof.payload.dc), [10, 11, 12, 11], 'four proofs of one key, none lost');
    assert.equal(new Set(ids(checks())).size, 4);
    // The reader builds on the third.
    const third = checks()[2];
    const built = host.bus.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' }, parents: [third.id] }] }, { cause: 'ui' });
    assert.equal(built.ok, true, built.message);
    const map = () => JSON.stringify(ask({}).map(proof => [proof.id, proof.payloadHash, proof.parents]).sort());
    const was = map();
    for (let n = 0; n < 2; n += 1) {
        const again = await host.turn.reread(at);
        assert.equal(again.ok, true, again.message);
        assert.equal(map(), was, `Re-read ${n + 1}: every id and every proof as it was, the Continue's included`);
    }
    assert.deepEqual(checks().map(proof => proof.payload.dc).sort(), [10, 11, 11, 12]);
    assert.equal(ask({ ids: [built.receipt.data.proofs[0].id] }).length, 1, 'and the child of the third is still there');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(map(), was, 'and after a reload');
});

test('a plan the guard refuses publishes nothing: the owner it leaves in place still shows to what is built on it', () => {
    const mode = { value: 'normal' };
    const h = evidenceHarness({ mode });
    h.send();
    const step = h.command('sd.setting', {}, 'system').receipt.data.made;
    h.send();
    const child = h.command('sd.dependent', { parent: step.id }, 'system').receipt.data.made;
    const before = JSON.stringify(h.ask().map(proof => [proof.id, proof.payload, proof.parents]));
    assert.deepEqual(ids(h.ask({ ids: [child.id] })), [child.id]);
    // A setting changes: planned again, the first step would be stored with a guard that does not hold, so it stays as it was.
    mode.value = 'deny';
    const done = h.store.reconcile(0, { rerun: rerunOf(h) });
    assert.equal(done.removed, 0, 'what depends on the first step is not taken back');
    assert.equal(JSON.stringify(h.ask().map(proof => [proof.id, proof.payload, proof.parents])), before, 'and nothing it shows changed');
    assert.equal(h.ask({ ids: [step.id] })[0].payload.dc, 10, 'the owner keeps its own bytes');
    h.store.rebuild();
    assert.equal(JSON.stringify(h.ask().map(proof => [proof.id, proof.payload, proof.parents])), before, 'a replay shows the same');
});

test('a checkpoint says which blocks were off: the proof before it belongs to the block that applied, not to an earlier one that was skipped', () => {
    const mode = { value: 'normal' };
    const h = evidenceHarness({ mode, options: { checkpointEvery: 3 } });
    h.send();
    const a = h.command('sd.guarded', { thread: T1, selection: 'first' }).receipt.data.proof;
    const two = h.send();
    const b = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'b' } }] }).receipt.data.proofs[0];
    // The second block takes the id of the first by hand, and the first is then off (its guard no longer holds).
    const record = structuredClone(h.chat[two].extra.storySuite);
    const span = record.spans.find(each => each.evidence?.some(proof => proof.id === b.id));
    const proof = span.evidence.find(each => each.id === b.id);
    proof.id = a.id;
    const pin = pinOf(proof, {});
    record.ops = record.ops.map(op => (op.path === `/meta/proofs/${b.id}` ? { ...op, path: `/meta/proofs/${a.id}`, value: pin }
        : op.path === '/meta/proofs' && op.value?.[b.id] !== undefined ? { ...op, value: { [a.id]: pin } } : op));
    h.chat[two].extra.storySuite = record;
    mode.value = 'deny';
    h.store.rebuild();
    assert.equal(h.ask({ ids: [a.id] })[0]?.payload.place, 'b', 'the block that applied holds the id');
    // Replies on top, so the head replays from a checkpoint after both, and a step that needs the id.
    for (let n = 0; n < 5; n += 1) {
        h.send();
        assert.equal(h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: `wolf ${n}` } }] }).ok, true);
    }
    const step = h.command('sd.dependent', { parent: a.id }, 'system');
    assert.equal(step.ok, true, step.message);
    const checkpoints = h.chat.map((message, i) => (message.extra?.storySuite?.checkpoint ? i : -1)).filter(i => i > two);
    assert.ok(checkpoints.length >= 1, 'a checkpoint stands after both blocks');
    const shown = () => JSON.stringify(h.ask().map(each => [each.id, each.parents]));
    const live = shown();
    assert.ok(h.ask().some(each => each.payload.after === 'dependent'), 'the step is shown');
    h.store.rebuild();     // a cold head: replay starts from that checkpoint
    assert.equal(shown(), live, 'a replay from the checkpoint shows what the chat as a whole shows');
    assert.ok(h.ask().some(each => each.payload.after === 'dependent'), 'and the step still');
    // A checkpoint written before checkpoints said which blocks applied: what is before it is worked out by replaying it.
    for (const message of h.chat) if (message.extra?.storySuite?.owned) delete message.extra.storySuite.owned;
    h.store.rebuild();
    assert.equal(shown(), live, 'and with no list in the checkpoints');
    assert.equal(h.ask({ ids: [a.id] })[0]?.payload.place, 'b');
});

test('a checkpoint rewritten after a reconcile took a step back still names the blocks that applied: a later proof of its record stays shown', () => {
    const h = evidenceHarness({ options: { checkpointEvery: 3 } });
    h.send();
    const parent = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'p' } }] }).receipt.data.proofs[0];
    const two = h.send();
    // One reply, four blocks: a step that will be taken back, the owner of an id, a block that takes that id by hand (and does not apply), and a last proof.
    h.command('sd.dependent', { parent: parent.id }, 'system');
    const owner = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'o' } }] }).receipt.data.proofs[0];
    const taker = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'taker' } }] }).receipt.data.proofs[0];
    const last = h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'last' } }] }).receipt.data.proofs[0];
    const record = structuredClone(h.chat[two].extra.storySuite);
    const span = record.spans.find(each => each.evidence?.some(proof => proof.id === taker.id));
    const proof = span.evidence.find(each => each.id === taker.id);
    proof.id = owner.id;
    const pin = pinOf(proof, {});
    record.ops = record.ops.map(op => (op.path === `/meta/proofs/${taker.id}` ? { ...op, path: `/meta/proofs/${owner.id}`, value: pin }
        : op.path === '/meta/proofs' && op.value?.[taker.id] !== undefined ? { ...op, value: { [owner.id]: pin } } : op));
    h.chat[two].extra.storySuite = record;
    h.store.rebuild();
    for (let n = 0; n < 6; n += 1) {
        h.send();
        assert.equal(h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: `wolf ${n}` } }] }).ok, true);
    }
    // The first reply goes, and the step on it with it; the checkpoints after are written again.
    h.chat.splice(1, 2);
    h.store.rebuild();
    const done = h.store.reconcile(0, { rerun: rerunOf(h) });
    assert.equal(done.removed, 1);
    assert.ok(h.chat.some(message => message.extra?.storySuite?.checkpoint && message.extra.storySuite.owned), 'a checkpoint says which blocks applied');
    const shown = () => ids(h.ask({ ids: [owner.id, last.id] }));
    assert.deepEqual(shown(), [owner.id, last.id]);
    h.store.rebuild();     // a cold head, from the checkpoint
    assert.deepEqual(shown(), [owner.id, last.id], 'from the checkpoint too');
    assert.equal(h.ask({ ids: [owner.id] })[0].payload.place, 'o');
});

test('an earlier identical step that goes does not move the later ones onto its identity: what was built on it stays off, however often a reconcile runs', () => {
    const h = evidenceHarness();
    h.send();
    assert.equal(h.command('sd.gate', { value: true }).ok, true);
    h.send();
    // Two identical steps in one reply, the gate shut and opened between them, and a click built on the first.
    const first = h.command('sd.ready', {}, 'system').receipt.data.made;
    assert.equal(h.command('sd.gate', { value: false }).ok, true);
    assert.equal(h.command('sd.gate', { value: true }).ok, true);
    const second = h.command('sd.ready', {}, 'system').receipt.data.made;
    assert.notEqual(first.id, second.id, 'identical steps, two ids');
    const built = h.command('sd.needs', { thread: T1, selection: 'Turn in', parent: first.id });
    assert.equal(built.ok, true, built.message);
    const onFirst = built.receipt.data.proof.id;
    assert.deepEqual(ids(h.ask({ ids: [first.id, second.id, onFirst] })), [first.id, second.id, onFirst]);
    // The reply that opened the gate for the first step goes: the first step is not ready any more (taken back), the second still is.
    h.chat.splice(1, 2);
    h.store.rebuild();
    for (let round = 1; round <= 3; round += 1) {
        h.store.reconcile(0, { rerun: rerunOf(h) });
        assert.deepEqual(ids(h.ask({ ids: [first.id, second.id, onFirst] })), [second.id], `reconcile ${round}: the second step keeps its own id, and nothing built on the first comes back`);
        assert.equal(h.ask({ ids: [second.id] })[0].payload.after, 'ready');
    }
    h.store.rebuild();
    assert.deepEqual(ids(h.ask({ ids: [first.id, second.id, onFirst] })), [second.id], 'and a replay agrees');
    assert.ok(h.problems().length >= 1, 'the click that was built on the first step is still reported off');
    // A step of the same operation added now takes a number nobody used (not the first step's).
    const third = h.command('sd.ready', {}, 'system').receipt.data.made;
    assert.notEqual(third.id, first.id);
    assert.notEqual(third.id, second.id);
});

test('a store that never gave proof is written as it was: no list of owners, no occurrences', () => {
    const h = evidenceHarness({ options: { checkpointEvery: 2 } });
    for (let n = 0; n < 6; n += 1) {
        h.send();
        assert.equal(h.command('sd.gate', { value: n % 2 === 0 }).ok, true);
    }
    const records = h.chat.map(message => message.extra?.storySuite).filter(Boolean);
    assert.ok(records.filter(record => record.checkpoint).length >= 2, 'checkpoints were written');
    for (const record of records) {
        assert.equal(Object.hasOwn(record, 'owned'), false);
        assert.equal(Object.hasOwn(record.source ?? {}, 'taken'), false);
        assert.ok(record.spans.every(span => !Object.hasOwn(span, 'occurrence')));
    }
});
