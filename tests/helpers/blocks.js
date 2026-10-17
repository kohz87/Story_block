// Normalized block lists for tests that need a settings-shaped list.
import { normalizeBlocks } from '../../src/schema.js';

export function blocksFromSettings(list) {
    return normalizeBlocks(list);
}
