// Seeded stories covering empty and world packs, swipes, deletes and long chats.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '..', '..', '..', '..');
const pack = (folder, origin) => ({ text: readFileSync(join(REPO, 'examples', 'packs', folder, 'pack.json'), 'utf8'), origin });
export const RIVERSIDE = () => pack('riverside-starter', 'riverside.json');
export const ERSVEIL = () => pack('ersveil', 'ersveil.json');

/** name -> { seeds, steps, packs() } */
export const SCENARIOS = {
    plain: { seeds: [1, 2, 3, 4, 5, 6, 7, 8], steps: 45, packs: () => [] },
    riverside: { seeds: [11, 12, 13], steps: 40, packs: () => [RIVERSIDE()] },
    ersveil: { seeds: [21, 22], steps: 40, packs: () => [ERSVEIL()] },
    // Long enough for the store's checkpoints (a checkpoint every few replies) and several reloads and rebuilds.
    long: { seeds: [31], steps: 140, packs: () => [] },
};
