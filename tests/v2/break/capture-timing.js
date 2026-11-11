import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

// A 150-line capture on a new chat measures the same parser and command machinery without the long history.
// The history case has consistently cost about 11 times this baseline; 24 leaves room for noisy machines
// while catching a threefold increase. Counted-work assertions remain the primary regression checks.
const HISTORY_RATIO = 24;
// The history case's usual cost against its baseline; the threefold-slowdown proof starts from it, not from
// this run's measurement, so a run that happens to be quick does not weaken the proof.
export const TYPICAL_RATIO = 11;
// Absolute backstop: a floor of 10 s, scaled up with the run's own baseline (40x) so machine load that slows
// the baseline measurement and the capture alike cannot trip it; the ratio check stays the real regression check.
const BACKSTOP_FLOOR_MS = 10_000;
const BACKSTOP_RATIO = 40;

export async function timedCapture(capture, { delayMs = 0, now = () => performance.now(), delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    const start = now();
    await capture();
    if (delayMs) await delay(delayMs);
    return now() - start;
}

export function assertCaptureTiming(ms, baseline) {
    assert.ok(baseline > 0 && Number.isFinite(baseline), 'a measurable baseline is required');
    const backstop = Math.max(BACKSTOP_FLOOR_MS, BACKSTOP_RATIO * baseline);
    assert.ok(ms < backstop, `the capture took ${Math.round(ms)} ms (${Math.round(backstop)} ms backstop)`);
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
