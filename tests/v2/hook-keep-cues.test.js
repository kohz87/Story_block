// A module's beforeGenerate may hand the tail a line as { text, keep: true }: it is kept whole when the tail is over the host's budget
// (Story Block's own pinned cues, prompt.js), where an ordinary line of the same module is dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

const KEPT = '[Test] This pinned line must reach the narrator.';
const PLAIN = '[Test] An ordinary line that the budget may drop, padded so that it is long enough to matter for the budget.';

function cueModule(lines) {
    return {
        id: 'cue-test', name: 'Cue test', version: '1.0.0', domains: {}, commands: {}, queries: {},
        context: { static: () => '', tail: () => ({ lines: [], optional: [] }), budget: 1000 },
        hooks: { beforeGenerate: () => ({ lines }) },
    };
}
const tailText = host => (host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).map(entry => entry.value).at(-1) ?? '');

for (const tailBudget of [1500, 8]) {
    test(`a hook line { text, keep: true } stays at tailBudget ${tailBudget}; a plain one is dropped when the budget is small`, async () => {
        const host = await createHost({ modules: [cueModule([PLAIN, { text: KEPT, keep: true }, { text: 'object without keep', keep: false }, { nope: 1 }, null])], settings: { host: { tailBudget } } });
        try {
            await host.send('Hello.', 'Hi.');
            const tail = tailText(host);
            assert.ok(tail.includes(KEPT), 'the pinned line is in the request');
            assert.equal(tail.split(KEPT).length - 1, 1, 'once');
            if (tailBudget === 1500) assert.ok(tail.includes('An ordinary line') && tail.includes('object without keep'), 'with room, every line is told');
            else assert.ok(!tail.includes('An ordinary line'), 'over the budget the plain line goes, the pinned one stays');
            assert.deepEqual(host.store.problems(), []);
        } finally {
            host.close();
        }
    });
}

test('an ordinary string line from a hook still works as before', async () => {
    const host = await createHost({ modules: [cueModule(['[Test] plain line'])] });
    try {
        await host.send('Hello.', 'Hi.');
        assert.ok(tailText(host).includes('[Test] plain line'));
    } finally {
        host.close();
    }
});

test('a module keeps at most KEPT_LINES_MAX lines and KEPT_CHARS_MAX characters; the rest are ordinary lines the budget may drop', async () => {
    const { KEPT_LINES_MAX, KEPT_CHARS_MAX } = await import('../../src/v2/turn/prompt-build.js');
    const many = Array.from({ length: 60 }, (_, i) => ({ text: `[Test] kept line ${i} ${'x'.repeat(500)}`, keep: true }));
    const host = await createHost({ modules: [cueModule(many)], settings: { host: { tailBudget: 50 } } });
    try {
        await host.send('Hello.', 'Hi.');
        const tail = tailText(host);
        const told = many.filter(line => tail.includes(line.text));
        assert.ok(told.length >= 1, 'the first kept lines are told');
        assert.ok(told.length <= KEPT_LINES_MAX, `no more than ${KEPT_LINES_MAX} kept lines survive a tiny budget (got ${told.length})`);
        assert.ok(told.reduce((sum, line) => sum + [...line.text].length, 0) <= KEPT_CHARS_MAX, 'within the character cap');
        assert.ok(tail.length < 60 * 520, 'one module cannot spend the whole tail');
    } finally {
        host.close();
    }
});
