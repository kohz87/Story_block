// A module's prelude command may mark its cue kept (`data.keep: true`): the tail keeps it under a tight budget, up to
// KEPT_PRELUDE_TOKENS in all per reply; an unmarked prelude cue is an ordinary [Happened] line the budget may drop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

const pulse = (id, summary, keep) => ({
    id, name: id, version: '0.0.0',
    domains: { [id]: { initial: () => ({ n: 0 }), validate: () => [], counters: ['n'] } },
    commands: { [`${id}.tick`]: Object.assign(ctx => { ctx.draft(id).n += 1; return { summary, narrate: true, data: keep ? { keep: true } : {} }; }, { prelude: true }) },
    context: { static: () => '', tail: () => ({ lines: [], optional: [] }), budget: 1000 },
    hooks: { beforeGenerate: () => ({ commands: [{ type: `${id}.tick`, payload: {} }] }) },
});
const tailText = host => (host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).map(entry => entry.value).at(-1) ?? '');
const run = async (modules, tailBudget) => {
    const host = await createHost({ modules, settings: { host: { tailBudget } } });
    try {
        await host.send('Hello.', 'Hi.');
        return tailText(host);
    } finally {
        host.close();
    }
};
const LONG = `World this reply: ${'a calm morning '.repeat(5)}`.trim();

test('a pinned prelude cue stays under a tight budget; an unpinned one goes', async () => {
    const kept = await run([pulse('pin-a', LONG, true)], 8);
    assert.ok(kept.includes(LONG), 'the pinned cue is told');
    const plain = await run([pulse('pin-a', LONG, false)], 8);
    assert.ok(!plain.includes(LONG), 'the unpinned cue is dropped as before');
});

test('with room, pinned and unpinned cues are told alike', async () => {
    assert.ok((await run([pulse('pin-a', LONG, true)], 1500)).includes(LONG));
    assert.ok((await run([pulse('pin-a', LONG, false)], 1500)).includes(LONG));
});

test('the cap holds: pinned prelude text over KEPT_PRELUDE_TOKENS in all is passed as plain cues', async () => {
    const { KEPT_PRELUDE_TOKENS } = await import('../../src/v2/turn/prompt-build.js');
    const { estimateTokens } = await import('../../src/v2/prompt.js');
    const lines = Array.from({ length: 6 }, (_, i) => `Line ${i} ${'word '.repeat(60)}`.trim());
    const tail = await run(lines.map((text, i) => pulse(`pin-${i}`, text, true)), 8);
    const told = lines.filter(text => tail.includes(text));
    assert.ok(told.length >= 1, 'the first pinned cues are told');
    assert.ok(told.length < lines.length, 'not all of them: the cap stops the rest');
    assert.ok(told.reduce((sum, text) => sum + estimateTokens(`[Happened]\n${text}`), 0) <= KEPT_PRELUDE_TOKENS, 'within the cap');
});
