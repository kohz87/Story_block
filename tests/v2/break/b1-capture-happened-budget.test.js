// B-b1-capture-3: [Happened] lines are never dropped (prompt.js assemble), and a reply may hold
// any number of narrated story lines, so one reply can push the next reply's tail far past the
// tail budget (invariant 5). Live, RPG Battle's `! rest` is such a line (narrate: true, no
// per-reply limit); here the QA probe module's `! probe Word` kind stands in for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { DEFAULT_TAIL_BUDGET, estimateTokens } from '../../../src/v2/prompt.js';
import { probeModule } from '../qa/helpers/probe-module.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('the tail after a reply with 400 narrated lines stays within the tail budget', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [probeModule()] });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Look.', reply('So many things.', Array.from({ length: 400 }, (_, i) => `! probe Word${i}`)));
    await host.send('And then?', 'Quiet.');
    const tail = host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).at(-1).value;
    assert.ok(estimateTokens(tail) <= DEFAULT_TAIL_BUDGET, `the tail is ${estimateTokens(tail)} tokens (${tail.split('\n').length} lines)`);
});
