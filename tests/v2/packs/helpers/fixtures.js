// Packs for the tests: the shipped example and small hand-made ones.
import { readFileSync } from 'node:fs';

const here = new URL('../../../../examples/packs/riverside-starter/pack.json', import.meta.url);
export const sampleText = readFileSync(here, 'utf8');
export const sample = () => JSON.parse(sampleText);

/** A minimal valid pack; `extra` is merged over it. */
export function pack(extra = {}) {
    return { id: 'mini', version: '1.0.0', requires: { storyBlock: '^2' }, content: {}, ...extra };
}

/** A pack with items, for resolution tests. */
export function itemsPack(id, items, extra = {}) {
    return pack({ id, content: { items }, ...extra });
}
