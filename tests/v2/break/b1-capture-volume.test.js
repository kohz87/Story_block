// B-b1-capture-1: a reply's <Changes> block has no line cap, and each captured line re-clones the
// whole reply record into swipe_info (persist.js writeRecord, called by store.append per line),
// so capture cost is quadratic in the number of lines. A looping model that repeats one line
// 2000 times (about 24 KB of text) blocks the page for tens of seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

async function captureMs(t, n) {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    const lines = Array.from({ length: n }, () => '+ item Rope');
    const started = performance.now();
    await host.send('I look around.', reply('Rope everywhere.', lines));
    return performance.now() - started;
}

test('a 2000-line block is captured within 3 s (or cut off at a per-reply cap with a Problem)', async t => {
    t.mock.method(console, 'warn', () => {});
    const ms = await captureMs(t, 2000);
    assert.ok(ms < 3000, `2000 lines took ${Math.round(ms)} ms`);
});
