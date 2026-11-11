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

// A module's own context.tail().lines may hold { text, keep: true } too (Story Director's Initiative line): kept under a tight budget,
// at most KEPT_TAIL_LINES per module and KEPT_TAIL_TOKENS in all per reply, shared with the kept prelude cues.
const tailModule = (id, lines, extra = {}) => ({
    id, name: id, version: '1.0.0', domains: {}, commands: {}, queries: {},
    context: { static: () => '', tail: () => ({ lines, optional: [] }), budget: 1000 },
    ...extra,
});
const tailWith = async (modules, tailBudget) => {
    const host = await createHost({ modules, settings: { host: { tailBudget } } });
    try {
        await host.send('Hello.', 'Hi.');
        assert.deepEqual(host.store.problems(), []);
        return tailText(host);
    } finally {
        host.close();
    }
};
const INIT = '[Director] Initiative: the Warden speaks first this reply.';
const FILL = `[Director] Note ${'padding '.repeat(12)}`.trim();

for (const tailBudget of [1500, 8]) {
    test(`a tail line { text, keep: true } stays at tailBudget ${tailBudget}; a plain one goes when the budget is small`, async () => {
        const tail = await tailWith([tailModule('tl-a', [FILL, { text: INIT, keep: true }, { text: 'object no keep', keep: false }, { nope: 1 }, null])], tailBudget);
        assert.ok(tail.includes(INIT), 'the kept line is told');
        assert.equal(tail.split(INIT).length - 1, 1, 'once');
        if (tailBudget === 8) assert.ok(!tail.includes('padding'), 'the plain line is dropped');
        else assert.ok(tail.includes('padding') && tail.includes('object no keep'), 'with room, every line is told');
    });
}

test('a kept tail line with trailing whitespace keeps its pin', async () => {
    assert.ok((await tailWith([tailModule('tl-a', [FILL, { text: `${INIT} \n`, keep: true }])], 8)).includes(INIT));
});

test('a module keeps at most KEPT_TAIL_LINES tail lines; the rest are ordinary lines the budget drops', async () => {
    const { KEPT_TAIL_LINES } = await import('../../src/v2/prompt.js');
    const lines = Array.from({ length: KEPT_TAIL_LINES + 2 }, (_, i) => ({ text: `[K] kept ${i}`, keep: true }));
    const tail = await tailWith([tailModule('tl-a', lines)], 1);
    const told = lines.filter(line => tail.includes(line.text));
    assert.equal(told.length, KEPT_TAIL_LINES);
    assert.deepEqual(told, lines.slice(0, KEPT_TAIL_LINES), 'the first ones, in order');
});

test('kept tail lines share KEPT_TAIL_TOKENS in all, across modules, in tail order', async () => {
    const { KEPT_TAIL_TOKENS, estimateTokens } = await import('../../src/v2/prompt.js');
    const lines = Array.from({ length: 4 }, (_, i) => `[K${i}] ${'word '.repeat(60)}`.trim());
    const tail = await tailWith(lines.map((text, i) => tailModule(`tl-${i}`, [{ text, keep: true }])), 1);
    const told = lines.filter(text => tail.includes(text));
    assert.ok(told.length >= 1 && told.length < lines.length, 'some are kept, not all');
    assert.ok(told.reduce((sum, text) => sum + estimateTokens(text), 0) <= KEPT_TAIL_TOKENS, 'within the cap');
});

test('kept prelude cues and kept tail lines draw on one cap', async () => {
    const { KEPT_TAIL_TOKENS, estimateTokens } = await import('../../src/v2/prompt.js');
    const cue = `World: ${'a calm morning '.repeat(5)}`.trim();
    const used = estimateTokens(`[Happened]\n${cue}`);
    const line = `[Director] ${'word '.repeat(Math.ceil((KEPT_TAIL_TOKENS - used) * 4 / 5) + 2)}`.trim();
    assert.ok(used + estimateTokens(line) > KEPT_TAIL_TOKENS, 'together they are over the cap');
    const pre = {
        id: 'tl-pre', name: 'tl-pre', version: '0.0.0',
        domains: { 'tl-pre': { initial: () => ({ n: 0 }), validate: () => [], counters: ['n'] } },
        commands: { 'tl-pre.tick': Object.assign(ctx => { ctx.draft('tl-pre').n += 1; return { summary: cue, narrate: true, data: { keep: true } }; }, { prelude: true }) },
        context: { static: () => '', tail: () => ({ lines: [], optional: [] }), budget: 1000 },
        hooks: { beforeGenerate: () => ({ commands: [{ type: 'tl-pre.tick', payload: {} }] }) },
    };
    const tail = await tailWith([pre, tailModule('tl-z', [{ text: line, keep: true }])], 1);
    assert.ok(tail.includes(cue), 'the prelude cue is kept first');
    assert.ok(!tail.includes(line), 'the tail line no longer fits the shared cap, so it is an ordinary line and goes');
});
