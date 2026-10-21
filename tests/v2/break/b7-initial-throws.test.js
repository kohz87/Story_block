// B-b7-combos-6: one module's domain initial() that throws when a chat starts (it read a setting
// the reader left empty, a pack that is gone...) takes the whole Story Suite down for that chat:
// registry.initialState() throws, turn.rebuild()/onChatChanged() reject, and every later
// generation fails with "The reply's notes could not be built" - no prompt, no capture, for every
// module. registerModule only test-calls initial() once. Invariant 4: the other modules must survive.
// Drop into Story_block/tests/v2/break/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../../testkit/index.js';
import { aiMessage } from '../../../testkit/fake-st.js';

test('a module whose initial() throws on a new chat does not stop the other modules', async () => {
    let broken = false;
    const fragile = {
        id: 'zz-fragile',
        name: 'Fragile',
        domains: { fragile: { initial: () => { if (broken) throw new Error('the start pack is gone'); return { n: 0 }; } } },
    };
    const host = await createHost({ modules: [fragile] });
    broken = true;
    // The reader opens another (new) chat.
    host.ctx.chat.splice(0, host.ctx.chat.length, aiMessage('A new tale begins.'));
    await assert.doesNotReject(host.turn.onChatChanged(), 'opening the chat must not throw');
    await host.send('I pick up the rope.', 'You take it.\n<Changes>\n+ item Rope | qty: 1\n</Changes>');
    const stacks = Object.values(host.head()?.domains?.inventory?.stacks ?? {});
    assert.equal(stacks.length, 1, 'Story Block\'s own inventory still captures the reply');
    assert.ok(host.st.promptLog.some(entry => entry.key === 'story_suite_static' && entry.value), 'the prompt is still sent');
    host.close();
});
