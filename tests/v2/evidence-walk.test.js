// What a guard sees during a Re-read or a reconcile is the proof of the blocks that have applied so far, counted once, from the
// walk's own base; a block's proof is published only after it applied; and every change of a block, legacy or guarded, is looked
// at before any is rebased or passed over (docs/v2/EVIDENCE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { pinOf } from '../../src/v2/evidence.js';
import { T1, director, evidenceHarness, fighter, hostModule } from './helpers/evidence.js';

const ids = list => list.map(each => each.id);

// A rerun as the turn gives the store (turn.js planAgain), for a harness.
const rerunOf = h => (state, receipt, info) => h.bus.run(info.replan.type, info.replan.payload, {
    cause: 'system', state, seed: info.replan.seed, replacing: info.span.evidence ?? [],
    reply: { index: info.index, sid: h.store.carrierSid(info.index), ordinal: info.span.source.ordinal },
});

test('a reconcile from before the head\'s checkpoint counts a parent once: the dependent step stays', () => {
    const h = evidenceHarness({ options: { checkpointEvery: 2 } });
    const first = h.send();
    const parent = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
    h.send();
    const step = h.command('sd.dependent', { parent: parent.id }, 'system');
    assert.equal(step.ok, true, step.message);
    // Replies on top, so the head replays from a checkpoint that is after the parent and the step.
    for (let n = 0; n < 6; n += 1) {
        h.send();
        assert.equal(h.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: `wolf ${n}` } }] }).ok, true);
    }
    const checkpoints = h.chat.map((message, i) => (message.extra?.storySuite?.checkpoint ? i : -1)).filter(i => i > first);
    assert.ok(checkpoints.length >= 2, 'checkpoints stand after the parent');
    h.store.rebuild();     // a cold head: replay starts from the latest checkpoint, which is after the parent
    const before = ids(h.ask());
    assert.ok(before.includes(step.receipt.data.made.id) || h.ask().some(proof => proof.payload.after === 'dependent'));
    const done = h.store.reconcile(first, { rerun: rerunOf(h) });
    assert.equal(done.removed, 0, 'the step is not taken back: its parent is shown to its guard');
    assert.deepEqual(ids(h.ask()), before, 'every proof is still there');
    assert.deepEqual(h.problems(), []);
});

test('a kept block that collides and is refused publishes nothing to the guards of a Re-read', async t => {
    const link = hostModule();
    const host = await createHost({ modules: [link.def, director(), fighter()], core: false });
    t.after(() => host.close());
    link.link(host.store);
    const text = lines => `Dawn.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    await host.send('Sure, I accept the job. Thanks a lot!', text([`! accept ${T1} | words: Sure, I accept the job`]));
    const first = host.ctx.chat.length - 1;
    const owner = host.sdk.query('story.evidence', {})[0];
    const click = host.bus.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' } }] }, { cause: 'ui' });
    assert.equal(click.ok, true);
    // The click's proof takes the owner's id by hand, so it collides when the reply is read again.
    const record = structuredClone(host.ctx.chat[first].extra.storySuite);
    const span = record.spans.find(each => each.evidence?.some(proof => proof.id === click.receipt.data.proofs[0].id));
    const proof = span.evidence[0];
    const pin = pinOf({ ...proof, id: owner.id }, {});
    proof.id = owner.id;
    record.ops = record.ops.map(op => (op?.path === `/meta/proofs/${click.receipt.data.proofs[0].id}` ? { ...op, path: `/meta/proofs/${owner.id}`, value: pin } : op?.path === '/meta/proofs' && op.value?.[click.receipt.data.proofs[0].id] ? { ...op, value: { [owner.id]: pin } } : op));
    host.ctx.chat[first].extra.storySuite = record;
    host.store.rebuild();
    // A later reply and a step on it that needs the owner shown.
    await host.send('On.', 'Noon.');
    const step = await host.bus.command('sd.dependent', { parent: owner.id }, { cause: 'system' });
    assert.equal(step.ok, true, step.message);
    const dependent = () => host.sdk.query('story.evidence', {}).filter(each => each.payload.after === 'dependent');
    assert.equal(dependent().length, 1);
    const again = await host.turn.reread(first);
    assert.equal(again.ok, true, again.message);
    assert.equal(dependent().length, 1, 'the step is still there: the refused block did not shadow the owner');
    assert.equal(host.sdk.query('story.evidence', { ids: [owner.id] })[0].kind, 'acceptance', 'and the owner is the line');
});

test('a legacy block with a change that is not one applies nothing, even when a passed-over change hides it', () => {
    const cases = {
        'unknown op that names a holder that is not there': { op: 'frobnicate', path: '/domains/sdt/log/-', value: 1, within: '/domains/sdt/nothing' },
        'add with no value in a holder that is not there': { op: 'add', path: '/domains/sdt/gone/x', within: '/domains/sdt/gone' },
        'a path that is not text': { op: 'add', path: 7, value: 1, within: '/domains/sdt/gone' },
    };
    for (const [name, bad] of Object.entries(cases)) {
        const h = evidenceHarness();
        const at = h.send();
        h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] });
        const record = structuredClone(h.chat[at].extra.storySuite);
        const rev = Math.max(...record.ops.filter(op => op.path === '/meta/rev').map(op => op.value)) + 1;
        const ops = [bad, { op: 'add', path: '/domains/sdt/log/-', value: 99 }, { op: 'replace', path: '/meta/rev', value: rev }];
        record.ops.push(...ops);
        record.spans.push({ n: ops.length, story: false });
        h.chat[at].extra.storySuite = record;
        h.store.rebuild();
        assert.equal(h.store.head().domains.sdt.log.includes(99), false, `${name}: its valid sibling did not apply either`);
        assert.ok(h.problems().length >= 1, `${name}: a Problem`);
        assert.equal(h.ask().length, 1, `${name}: the proof stands`);
    }
});

test('a step planned again keeps its own id when an earlier proof of its key went away: it does not slide onto the gap', () => {
    const h = evidenceHarness();
    h.send();
    const a = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'a' } }] }).receipt.data.proofs[0];
    h.send();
    const b = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: 'b' } }] }).receipt.data.proofs[0];
    h.send();
    // Two steps with one payload on one reply: the same key, so the second is the next occurrence of the first's id.
    const first = h.command('sd.dependent', { parent: a.id }, 'system').receipt.data.made;
    const second = h.command('sd.dependent', { parent: b.id }, 'system').receipt.data.made;
    assert.notEqual(first.id, second.id);
    // The reply that gave `a` is deleted: the first step is taken back by a reconcile, the second is planned again.
    h.chat.splice(1, 2);
    h.store.rebuild();
    const done = h.store.reconcile(0, { rerun: rerunOf(h) });
    assert.equal(done.removed, 1);
    const left = h.ask().filter(proof => proof.payload.after === 'dependent');
    assert.deepEqual(ids(left), [second.id], 'the step that stays keeps the id it had');
    assert.deepEqual(h.problems(), []);
    // And again, now that the first step's block and id are gone: the remaining step is planned again where there is a free id below its own.
    h.store.reconcile(0, { rerun: rerunOf(h) });
    assert.deepEqual(ids(h.ask().filter(proof => proof.payload.after === 'dependent')), [second.id], 'still the id it had');
    assert.deepEqual(h.problems(), []);
});
