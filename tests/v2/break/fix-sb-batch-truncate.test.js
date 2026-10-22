// fix-sb-batch (C1-3, Story Block alone): after a middle delete, a rewind of the head reply's last change
// replays its kept changes as a rebuild does. The head reply prunes a key a deleted reply added (a
// `remove`, as RPG Battle's dice cue does); a rebuild passes that remove over (replay rule c), and the
// rewind's dry run must too, or it refuses what the chat replays fine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../../src/v2/store.js';

const carrier = mes => ({ name: 'N', is_user: false, mes, swipe_id: 0, swipes: [mes], swipe_info: [{ extra: {} }], extra: {} });
const user = mes => ({ name: 'You', is_user: true, mes, extra: {} });
let n = 0;
const rc = rev => ({ id: `rc_${String(++n).padStart(8, '0')}`, type: 't.do', module: 't', cause: 'ui', seed: 1, summary: 'x', narrate: false, data: {}, rev });

test('a rewind after a middle delete replays the kept changes by the replay rules', () => {
    const chat = [carrier('Hello.')];
    let ids = 0;
    const store = createStore({ chat: () => chat, save: async () => {}, recordId: () => `sw_${String(++ids).padStart(12, '0')}` });
    store.ensureInitial({ v: 2, meta: { rev: 0, claims: {} }, domains: { t: { keys: {}, n: 0 } } });
    chat.push(user('a'), carrier('One.'));
    store.append({ ops: [{ op: 'add', path: '/domains/t/keys/k1', value: 1 }, { op: 'replace', path: '/meta/rev', value: 1 }], receipt: rc(1) });
    chat.push(user('b'), carrier('Two.'));
    store.append({ ops: [{ op: 'remove', path: '/domains/t/keys/k1' }, { op: 'replace', path: '/meta/rev', value: 2 }], receipt: rc(2) });
    store.append({ ops: [{ op: 'replace', path: '/domains/t/n', value: 5 }, { op: 'replace', path: '/meta/rev', value: 3 }], receipt: rc(3) });
    // The reader deletes the reply that added k1 (and its user message).
    chat.splice(1, 2);
    store.rebuild();
    assert.deepEqual(store.problems(), [], 'the chat replays with no problem');
    assert.equal(store.head().domains.t.n, 5);

    const plan = store.truncate(2, 3, { dryRun: true });
    assert.equal(plan.rev, 2, 'the dry run is not refused');
    const done = store.truncate(2, 3);
    assert.equal(done.rev, 2);
    assert.equal(store.head().domains.t.n, 0, 'the last change is taken back');
    const cold = createStore({ chat: () => structuredClone(chat), save: async () => {} });
    assert.deepEqual(cold.head(), store.head(), 'and a cold rebuild agrees');
    assert.deepEqual(cold.problems(), []);
});
