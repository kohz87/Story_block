// The seeded chats the baseline trace covers (play.js), shared by the generator (scripts/dm-unused-golden.mjs) and the
// test. The pack files are the repo's own examples and the Bluewatch test fixture: if one is edited on purpose,
// regenerate the baseline with the generator against the baseline tree (it feeds the same pack text to the old code).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_COMMIT = '958021b';
const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '..', '..', '..', '..');
const pack = (folder, origin) => ({ text: readFileSync(join(REPO, 'examples', 'packs', folder, 'pack.json'), 'utf8'), origin });
// Bluewatch 1.6.0, the old example pack, lives on as a test fixture.
const BLUEWATCH_FIXTURE = join(REPO, 'tests', 'v2', 'packs', 'fixtures', 'ersveil-bluewatch-1.6.0.json');
export const RIVERSIDE = () => pack('riverside-starter', 'riverside.json');
// The baseline tree is Story Block 2.1.0, which cannot read trainer templates (added in 2.4.0, Ersveil 1.6.0). So this
// scenario feeds both trees the pack as it was at 1.5.0: the fixture file with its templates taken out and the version
// put back, which is that file byte for byte (the hash below is the 1.5.0 file's). The baseline trace is unchanged. If
// the pack changes in any other way (even an edit unrelated to templates), the hash stops matching: record the
// baseline again as the note above says and update BLUEWATCH_1_5_0.
const BLUEWATCH_1_5_0 = 'd367a6fdc2fc5e28bc2dcab8d078d71cfdf100daa7a5753e7eb6ee3a763d9343';
export const ERSVEIL = () => {
    const shipped = { text: readFileSync(BLUEWATCH_FIXTURE, 'utf8'), origin: 'ersveil.json' };
    const doc = JSON.parse(shipped.text);
    doc.version = '1.5.0';
    doc.content.rules[0].trainers = doc.content.rules[0].trainers.filter(trainer => trainer.open !== true);
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    if (createHash('sha256').update(text).digest('hex') !== BLUEWATCH_1_5_0) throw new Error('the Ersveil pack is no longer Ersveil 1.5.0 plus its trainer templates: record the unused-chat baseline again and set BLUEWATCH_1_5_0 to the new file\'s SHA-256');
    return { text, origin: shipped.origin };
};

/** name -> { seeds, steps, packs() } */
export const SCENARIOS = {
    plain: { seeds: [1, 2, 3, 4, 5, 6, 7, 8], steps: 45, packs: () => [] },
    riverside: { seeds: [11, 12, 13], steps: 40, packs: () => [RIVERSIDE()] },
    ersveil: { seeds: [21, 22], steps: 40, packs: () => [ERSVEIL()] },
    // Long enough for the store's checkpoints (a checkpoint every few replies) and several reloads and rebuilds.
    long: { seeds: [31], steps: 140, packs: () => [] },
};
