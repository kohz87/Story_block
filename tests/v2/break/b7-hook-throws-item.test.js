// B-b7-combos-7: an `item.define` hook that throws fails Story Block's own
// `+ item` capture: inventory.js addDef() calls the hooks without a guard, so one module's
// bug (RPG Battle's item rules) stops every story item from being gained, in every
// combination that has that module. canGenerate/beforeGenerate/afterReply/start/item.resolve hooks are guarded;
// this one is not. Invariant 4: the others must survive. Drop into Story_block/tests/v2/break/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../../testkit/index.js';

for (const hook of ['item.define']) {
    test(`a throwing ${hook} hook does not stop the core + item capture`, async () => {
        const buggy = { id: 'zz-buggy', name: 'Buggy', hooks: { [hook]() { throw new TypeError('cannot read properties of undefined'); } } };
        const host = await createHost({ modules: [buggy] });
        await host.send('I search the shelf.', 'A coil of rope.\n<Changes>\n+ item Rope | qty: 2\n</Changes>');
        const stacks = Object.values(host.head().domains.inventory.stacks);
        assert.deepEqual(stacks.map(stack => stack.qty), [2], `the rope was lost: ${host.turn.problems().map(p => p.message).join(' | ')}`);
        host.close();
    });
}
