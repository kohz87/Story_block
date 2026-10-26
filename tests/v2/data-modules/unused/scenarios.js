// The seeded chats the baseline trace covers (play.js), shared by the generator (scripts/dm-unused-golden.mjs) and the
// test. The pack files are the repo's own examples: if one is edited on purpose, regenerate the baseline with the
// generator against the baseline tree (it feeds the same pack text to the old code).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_COMMIT = '958021b';
const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '..', '..', '..', '..');
const pack = (folder, origin) => ({ text: readFileSync(join(REPO, 'examples', 'packs', folder, 'pack.json'), 'utf8'), origin });
export const RIVERSIDE = () => pack('riverside-starter', 'riverside.json');
export const ERSVEIL = () => pack('ersveil-bluewatch', 'ersveil.json');

/** name -> { seeds, steps, packs() } */
export const SCENARIOS = {
    plain: { seeds: [1, 2, 3, 4, 5, 6, 7, 8], steps: 45, packs: () => [] },
    riverside: { seeds: [11, 12, 13], steps: 40, packs: () => [RIVERSIDE()] },
    ersveil: { seeds: [21, 22], steps: 40, packs: () => [ERSVEIL()] },
    // Long enough for the store's checkpoints (a checkpoint every few replies) and several reloads and rebuilds.
    long: { seeds: [31], steps: 140, packs: () => [] },
};
