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
    cause: 'system', state, seed: info.replan.seed, replacing: info.span.evidence ?? [],
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
    const one = h.send();
    const a = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
    h.send();
    const b = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'b' } }] }).receipt.data.proofs[0];
    h.send();
    const first = h.command('sd.dependent', { parent: a.id }, 'system').receipt.data.made;
    const second = h.command('sd.dependent', { parent: b.id }, 'system').receipt.data.made;
    const end = h.chat.length - 1;
    // A child of the second step, which comes later.
    h.send();
    // (a step too, so a reconcile plans it again, on whatever holds the id then)
    const child = h.command('sd.dependent', { parent: second.id }, 'system').receipt.data.made;
    assert.deepEqual(ids(h.ask({ ids: [child.id] })), [child.id]);
    // The file is damaged: the first step's proof is edited by hand (its bytes and its pin) and takes the second step's id, so a
    // plan of the second step would end up on an id the first holds.
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
    const taken = change(end, first.id, second.id, pins);
    // The child is pinned against the proof that now holds the id, as a hand edit that keeps its own chain would.
    change(h.chat.length - 1, child.id, child.id, { ...pins, [second.id]: taken });
    h.store.rebuild();
    void one;
    const owner = () => h.ask({ ids: [second.id] });
    assert.equal(owner().length, 1, 'the first step holds the id');
    assert.equal(owner()[0].parents[0], a.id);
    const done = h.store.reconcile(0, { rerun: rerunOf(h) });
    void done;
    assert.equal(owner().length, 1, 'still one holder');
    assert.equal(owner()[0].parents[0], a.id, 'and it is the one that applied');
    assert.deepEqual(ids(h.ask({ ids: [child.id] })), [child.id], 'and what is built on the id stays shown');
    const was = JSON.stringify(h.ask().map(each => [each.id, each.parents]));
    h.store.rebuild();
    assert.equal(JSON.stringify(h.ask().map(each => [each.id, each.parents])), was, 'what a reconcile shows is what a replay shows');
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
