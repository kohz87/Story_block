// node scripts/dm-unused-golden.mjs <baseline-root>   (writes tests/v2/data-modules/fixtures/unused-baseline.json)
// node scripts/dm-unused-golden.mjs --self             (prints whether this tree reproduces the stored trace)
//
// "Unused means byte-identical" (docs/v2/DATA_MODULES.md): the seeded chats of tests/v2/data-modules/unused/ are played on a
// Story Block tree from before data modules (a checkout of main at the commit named in scenarios.js, any folder) and the
// trace is stored; tests/v2/data-modules/unused.test.js plays them on this tree and compares. Needs no sibling checkouts.
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { play } from '../tests/v2/data-modules/unused/play.js';
import { BASELINE_COMMIT, SCENARIOS } from '../tests/v2/data-modules/unused/scenarios.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'tests', 'v2', 'data-modules', 'fixtures', 'unused-baseline.json');
const arg = process.argv[2];
if (!arg) { console.error('usage: dm-unused-golden.mjs <baseline-root> | --self'); process.exit(2); }

const root = arg === '--self' ? resolve(here, '..') : resolve(arg);
const out = { baseline: BASELINE_COMMIT, scenarios: {} };
for (const [name, scenario] of Object.entries(SCENARIOS)) {
    out.scenarios[name] = {};
    for (const seed of scenario.seeds) {
        const run = await play({ root, seed, steps: scenario.steps, packs: scenario.packs() });
        const { detailed, ...trace } = run;
        out.scenarios[name][seed] = trace;
        console.error(`${name} seed ${seed}: ${trace.steps.length} steps, ${trace.saves} saves, ${trace.draws} draws`);
    }
}
if (arg === '--self') {
    const stored = JSON.parse(readFileSync(target, 'utf8'));
    console.log(JSON.stringify(stored.scenarios) === JSON.stringify(out.scenarios) ? 'identical' : 'DIFFERENT');
} else {
    writeFileSync(target, `${JSON.stringify(out)}\n`);
    console.error(`wrote ${target}`);
}
