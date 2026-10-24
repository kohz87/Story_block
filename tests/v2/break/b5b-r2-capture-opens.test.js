// B-b5b-robust-r2-4: capture.js is linear on whitespace now, but two of its regexes still retry from every
// unclosed opening tag: REASONING_RE (capture.js:154, `<think…>[\s\S]*?</think…>`, lazy to the end of the
// reply from each `<think>`) and HIDDEN_RE (capture.js:18, `<!--\s*STORY_SUITE_V2\b([\s\S]*?)-->`). A reply
// with many unclosed `<think>` tags (a looping reasoning model) costs seconds in withoutReasoning /
// maskReasoning, which extractBlock, hideBlock, cutLine and continuation() each run again:
// 20 000 × "<think>" (140 KB): first reply 3.8–4.2 s, the next reply 1.3 s (the history pass), then cached.
//
// B-b5b-robust-r2-5: lines in a block that are not change lines are not capped: maxChangeLines (150) counts
// only parsed lines, so a block of 100 000 junk lines makes 100 000 Problems, each a console.warn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutLine, extractBlock, hideBlock, stripBlock } from '../../../src/v2/capture.js';
import { createHost } from '../../../testkit/index.js';

const ms = fn => {
    const start = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - start) / 1e6;
};
const THINKS = `${'<think>'.repeat(20_000)}\nThe road.\n\n<Changes>\n+ item Rope | qty: 1\n</Changes>`;

test('B-b5b-robust-r2-4: many unclosed <think> tags are read in linear time', () => {
    assert.ok(ms(() => extractBlock(THINKS)) < 100, 'extractBlock (withoutReasoning)');
    assert.ok(ms(() => hideBlock(THINKS)) < 100, 'hideBlock (maskReasoning)');
    assert.ok(ms(() => cutLine(THINKS)) < 100, 'cutLine (withoutReasoning)');
});

test('B-b5b-robust-r2-4: many unclosed hidden-comment markers are read in linear time', () => {
    const text = `${'<!-- STORY_SUITE_V2 '.repeat(10_000)}The road.`;
    assert.ok(ms(() => stripBlock(text)) < 100, 'stripBlock (HIDDEN_RE)');
    assert.ok(ms(() => hideBlock(text)) < 100, 'hideBlock (HIDDEN_RE)');
});

test('B-b5b-robust-r2-4: a reply with 20 000 unclosed <think> tags does not stall this reply or the next', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    try {
        let start = Date.now();
        await host.send('go', THINKS);
        const first = Date.now() - start;
        start = Date.now();
        await host.send('next', 'Fine.');
        const next = Date.now() - start;
        assert.ok(first < 500 && next < 250, `first reply ${first} ms, the next ${next} ms`);
    } finally {
        host.close();
    }
});

test('B-b5b-robust-r2-5: a block of 100 000 junk lines makes a bounded number of Problems', async t => {
    let warns = 0;
    t.mock.method(console, 'warn', () => { warns += 1; });
    const host = await createHost();
    try {
        await host.send('go', `The road.\n\n<Changes>\n${'x\n'.repeat(100_000)}</Changes>`);
        assert.ok(warns <= 200, `${warns} warnings for one reply (maxChangeLines caps only the lines that parse)`);
    } finally {
        host.close();
    }
});
