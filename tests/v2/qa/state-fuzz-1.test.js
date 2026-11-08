// QA: shard 1 of 4 of the seeded whole-chat fuzz (see helpers/state-fuzz-run.js for what every run checks).
// The runs are split over four files so node --test runs them in parallel; together they are the same
// [seed, steps] list as before. QA_FUZZ_SEED / QA_FUZZ_SEEDS / QA_FUZZ_STEPS run their whole list once, in shard 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzz, remakes, shardRuns, checksRemakes } from './helpers/state-fuzz-run.js';

const RUNS = shardRuns(1);
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 90;

if (!RUNS.length) test('fuzz shard 1: nothing to run (a local override runs in shard 1)', t => t.skip('QA_FUZZ_* override runs in shard 1'));

for (const [seed, steps] of RUNS) {
    test(`fuzz seed ${seed}${steps === STEPS ? '' : ` (${steps} steps)`}: replay equals rebuild, rollback is exact, told once, claims once, saves per burst`, async t => {
        await fuzz(t, seed, steps);
        remakes.runs++;
    });
}

test('the fuzz reaches the remake of an earlier-used name as equipment', t => {
    if (!RUNS.length || remakes.runs < RUNS.length) return t.skip('only some seeds ran');
    if (!checksRemakes(1)) return t.skip('this shard makes no remake; shards 2 to 4 check it');
    if (process.env.QA_FUZZ_STATS) console.log(`remakes executed across ${RUNS.length} seeds: ${remakes.count}`);
    assert.ok(remakes.count > 0, 'no fuzz seed made an earlier-used name equipment (inventory.add kind equipment after a drop)');
});
