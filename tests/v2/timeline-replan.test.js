// A plan the guard refuses publishes nothing (E5's rule, which the timeline's gate in guardHolds feeds the same way): the guard is
// asked before the replacement proof is published, so a refused plan leaves the owner's proof where it was and a dependent that was
// built on it is not taken back, now or on a later valid dependent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceHarness } from './helpers/evidence.js';

const ids = list => list.map(each => each.id);
const rerunOf = h => (state, receipt, info) => h.bus.run(info.replan.type, info.replan.payload, {
    cause: 'system', state, seed: info.replan.seed, replacing: info.span.evidence ?? [], occurrence: info.nth,
    reply: { index: info.index, sid: h.store.carrierSid(info.index), ordinal: info.span.source.ordinal },
});

test('a settings change makes the replan\'s guard fail: the dependent that stands on the owner is not deleted, and a later valid dependent works', () => {
    const mode = { value: 'normal' };
    const h = evidenceHarness({ mode });
    h.send();
    const step = h.command('sd.setting', {}, 'system').receipt.data.made;
    h.send();
    const child = h.command('sd.dependent', { parent: step.id }, 'system').receipt.data.made;
    const shown = () => JSON.stringify(h.ask().map(proof => [proof.id, proof.payload, proof.parents]));
    const before = shown();
    mode.value = 'deny';
    const done = h.store.reconcile(0, { rerun: rerunOf(h) });
    assert.equal(done.removed, 0, 'what depends on the owner is not taken back');
    assert.equal(shown(), before);
    assert.deepEqual(ids(h.ask({ ids: [child.id] })), [child.id], 'the dependent is still there');
    // A later dependent, valid on the owner that stands, is accepted and shows with the rest.
    h.send();
    const later = h.command('sd.dependent', { parent: step.id }, 'system');
    assert.equal(later.ok, true, later.message);
    assert.deepEqual(ids(h.ask({ ids: [child.id] })), [child.id]);
    assert.equal(h.ask({ ids: [later.receipt.data.made.id] }).length, 1);
    h.store.rebuild();
    assert.equal(h.ask({ ids: [child.id] }).length, 1, 'and a replay shows the same');
    assert.equal(h.ask({ ids: [later.receipt.data.made.id] }).length, 1);
    assert.deepEqual(h.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE' && /proof/.test(problem.why)), []);
});
