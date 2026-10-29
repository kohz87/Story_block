import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

// A 150-line capture on a new chat measures the same parser and command machinery without the long history.
// The history case has consistently cost about 11 times this baseline; 24 leaves room for noisy machines
// while catching a threefold increase. Counted-work assertions remain the primary regression checks.
const HISTORY_RATIO = 24;
const BACKSTOP_MS = 10_000;

export async function timedCapture(capture, { delayMs = 0, now = () => performance.now(), delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    const start = now();
    await capture();
    if (delayMs) await delay(delayMs);
    return now() - start;
}

export function assertCaptureTiming(ms, baseline) {
    assert.ok(baseline > 0 && Number.isFinite(baseline), 'a measurable baseline is required');
    assert.ok(ms < BACKSTOP_MS, `the capture took ${Math.round(ms)} ms (10 s backstop)`);
    assert.ok(ms < HISTORY_RATIO * baseline, `the capture took ${(ms / baseline).toFixed(1)} times its plain-capture baseline (limit ${HISTORY_RATIO})`);
}

export async function plainCaptureBaseline() {
    const host = await createHost();
    try {
        await host.send('Hello.', 'The road.');
        const lines = Array.from({ length: 150 }, (_, i) => `+ item Thing ${i + 1}`);
        const text = `Things.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
        const times = [await timedCapture(() => host.send('More.', text))];
        for (let i = 0; i < 2; i++) times.push(await timedCapture(() => host.swipe(text)));
        return Math.min(...times);
    } finally {
        host.close();
    }
}
