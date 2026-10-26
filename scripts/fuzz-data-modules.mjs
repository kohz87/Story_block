// node scripts/fuzz-data-modules.mjs <seed> <steps>      one run; prints { seed, steps, fails, stats }
// for s in $(seq 1 200); do node scripts/fuzz-data-modules.mjs $s 60; done | grep -v '"fails":\[\]'
// The replay-purity fuzz of data modules (tests/v2/data-modules/fuzz/run.js explains the properties). TRACE=1 adds the steps.
import { runFuzz } from '../tests/v2/data-modules/fuzz/run.js';

const [seed, steps] = process.argv.slice(2).map(Number);
const out = await runFuzz({ seed: seed || 1, steps: steps || 40, verbose: Boolean(process.env.TRACE) });
console.log(JSON.stringify(out));
process.exitCode = out.fails.length ? 1 : 0;
