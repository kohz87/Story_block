// B-b7-combos-5: one module's async hook that never settles (a canGenerate or beforeGenerate that
// awaits a network call, a lock, a dialog...) holds every story generation of every module forever:
// turn.js blockedBy() and runCues() await each hook with no time limit. turn.js's own comment says
// "a bug must not lock the reader out"; a throw is handled, a hang is not (invariant 4: no stuck
// generation). Drop into Story_block/tests/v2/break/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../../testkit/index.js';

const LIMIT_MS = 8000;
const within = (promise, ms = LIMIT_MS) => Promise.race([
    promise.then(() => 'done'),
    new Promise(resolve => setTimeout(() => resolve('stuck'), ms).unref()),
]);

for (const hook of ['canGenerate', 'beforeGenerate']) {
    test(`a ${hook} hook that never settles does not hold the reply forever`, async () => {
        const hanging = { id: 'zz-hang', name: 'Hang', hooks: { [hook]: () => new Promise(() => {}) } };
        const host = await createHost({ modules: [hanging] });
        const outcome = await within(host.send('I open the door.', 'The door creaks.\n<Changes>\n+ item Rope | qty: 1\n</Changes>'));
        assert.equal(outcome, 'done', `the generation is still waiting on ${hook} after ${LIMIT_MS} ms`);
        assert.equal(Object.values(host.head().domains.inventory.stacks).length, 1, 'the other modules still capture the reply');
        host.close();
    });
}
