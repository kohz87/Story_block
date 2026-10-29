import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCaptureTiming, timedCapture } from '../break/capture-timing.js';

test('the timing helper rejects an injected threefold capture delay', async () => {
    let clock = 0;
    const options = { now: () => clock, delay: async ms => { clock += ms; } };
    const capture = async () => { clock += 2000; };
    const normal = await timedCapture(capture, options);
    assertCaptureTiming(normal, 100);
    const slowed = await timedCapture(capture, { ...options, delayMs: 2 * normal });
    assert.equal(slowed, 3 * normal);
    assert.throws(() => assertCaptureTiming(slowed, 100), /plain-capture baseline/);
    assert.throws(() => assertCaptureTiming(10_000, 1000), /10 s backstop/);
});
