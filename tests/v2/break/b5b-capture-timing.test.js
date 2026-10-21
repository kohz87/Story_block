// B-b5b-robust-5/6: capture.js regexes are quadratic on long runs of whitespace, and the cost comes back on
// every later reply (turn.js stripHistory runs stripBlock/extractBlock over every assistant message in the
// prompt). Benign input only: a reply with a long run of spaces or blank lines, as a looping model writes.
//
// Quadratic patterns (V8 backtracks from every start position of the run):
//   capture.js:86  /\s+$/            (stripBlock)          capture.js:101 /\s+$/    (hideBlock)
//   capture.js:75  /\n\s*$/          (extractBlock)        capture.js:100 /\n\s*$/  (hideBlock)
//   capture.js:22  TEXT_DASH /\s*[—–]\s*|\s+-(?:\s+|$)/    capture.js:24  LABELLED (parseLine)
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBlock, hideBlock, parseChanges, stripBlock } from '../../../src/v2/capture.js';
import { createHost } from '../../../testkit/index.js';

const N = 20_000;
const SPACES = ' '.repeat(N);
const LINES = '\n'.repeat(N);
const BLOCK = '\n\n<Changes>\n+ item Rope | qty: 1\n</Changes>';

function ms(fn) {
    const start = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - start) / 1e6;
}

// 20 000 characters is a few hundred tokens of whitespace; linear code handles it in well under 10 ms.
const BUDGET = 100;

test('B-b5b-robust-5: stripBlock / hideBlock stay linear on a reply with a long run of spaces in the story', () => {
    const reply = `The road is quiet.${SPACES}x${BLOCK}`;
    assert.ok(ms(() => stripBlock(reply)) < BUDGET, 'stripBlock: /\\s+$/ (capture.js:86)');
    assert.ok(ms(() => hideBlock(reply)) < BUDGET, 'hideBlock: /\\s+$/ (capture.js:101)');
});

test('B-b5b-robust-5: extractBlock / hideBlock stay linear on blank lines inside the block', () => {
    const reply = `Quiet.\n\n<Changes>\n+ item Rope | qty: 1${LINES}x\n</Changes>`;
    assert.ok(ms(() => extractBlock(reply)) < BUDGET, 'extractBlock: /\\n\\s*$/ (capture.js:75)');
    assert.ok(ms(() => hideBlock(reply)) < BUDGET, 'hideBlock: /\\n\\s*$/ (capture.js:100)');
});

test('B-b5b-robust-5: parseChanges stays linear on a change line with a long run of spaces', () => {
    assert.ok(ms(() => parseChanges(`+ item Rope${SPACES}x | qty: 1`)) < BUDGET, 'TEXT_DASH (capture.js:22)');
    assert.ok(ms(() => parseChanges(`+ item Rope | qty${SPACES}x`)) < BUDGET, 'LABELLED (capture.js:24)');
});

test('B-b5b-robust-6: one whitespace-heavy reply slows every later reply (per-reply cost that never goes away)', async () => {
    const host = await createHost();
    try {
        await host.send('go', `The road is quiet.${SPACES}x${BLOCK}`);
        const times = [];
        for (let i = 0; i < 3; i += 1) {
            const start = Date.now();
            await host.send('next', `Fine.${BLOCK}`);
            times.push(Date.now() - start);
        }
        assert.ok(Math.max(...times) < 250, `later replies took ${times.join(', ')} ms each (the old reply is re-scanned for every prompt)`);
    } finally {
        host.close();
    }
});
