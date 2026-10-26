// Replay purity for data modules (DATA_MODULES.md section 8, test 5): seeded random definitions and chats on the real host,
// every property of fuzz/run.js checked after every step; malformed definitions must never get past the checker, or crash it.
// A failing seed replays exactly: `node scripts/fuzz-data-modules.mjs <seed> <steps>` (TRACE=1 lists the steps, DUMP=<file>
// writes the chat at the first failure and the chat before the step). Seeds that once failed stay in RETAINED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { generate, mutate, rng } from './fuzz/generate.js';
import { runFuzz } from './fuzz/run.js';

// Seeds that found a bug while this was written (each is a different shape of chat); kept so they never come back.
const RETAINED = [5];
const SEEDS = process.env.DM_FUZZ_SEED ? [Number(process.env.DM_FUZZ_SEED)] : [...RETAINED, 1, 2, 3, 4, 6, 7];
const STEPS = Number(process.env.DM_FUZZ_STEPS) || 40;

for (const seed of SEEDS) {
    test(`replay fuzz seed ${seed}: live == cold replay (checkpoints trusted and stripped), pure, valid, reply-bound`, async () => {
        const result = await runFuzz({ seed, steps: STEPS });
        assert.deepEqual(result.fails, [], JSON.stringify(result.fails).slice(0, 2000));
    });
}

test('malformed definitions are refused or accepted by the checker without ever throwing; generated ones are always accepted', () => {
    let refused = 0;
    let accepted = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
        const r = rng(seed);
        const alpha = generate(r, 'alpha', { clock: r.chance(0.5), offers: r.chance(0.5) });
        const beta = generate(r, 'beta', { scope: 'character', clock: true, source: 'pack.fz/alpha' });
        const pack = (...definitions) => ({ id: 'fz', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['data-modules-v1', 'story-director'] }, content: { dataModules: definitions } });
        assert.equal(validatePack(pack(alpha, beta)).ok, true, `generated pair ${seed}`);
        for (let n = 0; n < 4; n += 1) {
            const result = validatePack(pack(mutate(r, alpha), beta));
            if (result.ok) accepted += 1; else { refused += 1; assert.ok(result.errors.length >= 1 && result.errors.length <= 20, 'a bounded list of diagnostics'); }
        }
    }
    assert.ok(refused > accepted, `most damage is refused (${refused} refused, ${accepted} accepted)`);
});
