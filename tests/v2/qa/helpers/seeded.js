// Seeded randomness for the QA tests: a small PRNG (mulberry32) for choosing fuzz steps, and a
// way to make the host's own crypto IDs and seeds follow it, so a failing seed replays exactly.
// Test code only; nothing here touches the product.

/** mulberry32: () => float in [0, 1) from a uint32 seed. */
export function prng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
    next.pick = list => list[Math.floor(next() * list.length)];
    next.chance = p => next() < p;
    return next;
}

/**
 * Replaces globalThis.crypto.getRandomValues and randomUUID with seeded versions (receipt IDs,
 * receipt seeds, record IDs all become reproducible). Returns restore().
 */
export function seedCrypto(seed) {
    const crypto = globalThis.crypto;
    const random = prng(seed ^ 0x9E3779B9);
    const had = { values: Object.hasOwn(crypto, 'getRandomValues'), uuid: Object.hasOwn(crypto, 'randomUUID') };
    const old = { values: crypto.getRandomValues, uuid: crypto.randomUUID };
    crypto.getRandomValues = array => {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
        return array;
    };
    crypto.randomUUID = () => {
        const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
    };
    return () => {
        if (had.values) crypto.getRandomValues = old.values; else delete crypto.getRandomValues;
        if (had.uuid) crypto.randomUUID = old.uuid; else delete crypto.randomUUID;
    };
}
