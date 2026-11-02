// Pictures and a file store for the portrait tests.
import { PORTRAIT_LIMITS } from '../../../../src/v2/packs/limits.js';

const fill = (head, size, seed = 0) => {
    const bytes = new Uint8Array(size);
    bytes.set(head);
    for (let i = head.length; i < size; i += 1) bytes[i] = (i * 31 + seed) & 0xff;
    return bytes;
};
const ascii = text => [...text].map(char => char.charCodeAt(0));
/** A "picture": the first bytes of a real PNG, WebP or JPEG, then filler. `seed` makes two pictures differ. */
export const png = (size = 200, seed = 0) => fill([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size, seed);
export const webp = (size = 200, seed = 0) => fill([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')], size, seed);
export const jpg = (size = 200, seed = 0) => fill([0xff, 0xd8, 0xff, 0xe0], size, seed);
export const gif = (size = 200) => fill(ascii('GIF89a'), size);
export const tooBig = () => webp(PORTRAIT_LIMITS.bytes + 1);

/** A picked file as the pack panel hands it over. */
export const picked = (name, bytes) => ({ name, size: bytes.length, read: async () => bytes });

/** An in-memory file store with the shape of st-adapter.js stPortraitFiles. */
export function fakeFiles({ failPut = null } = {}) {
    const files = new Map();
    const log = [];
    return {
        files, log,
        async put(name, bytes) {
            if (failPut && failPut(name)) throw new Error('the server answered 500');
            log.push(['put', name]);
            files.set(name, bytes);
        },
        async remove(name) { log.push(['remove', name]); files.delete(name); },
        async exists(names) { return Object.fromEntries(names.map(name => [name, files.has(name)])); },
        url: name => `/user/files/${name}`,
    };
}

/** A PNG-looking file of `size` bytes whose header says it is `width` × `height` pixels. */
export const pngOf = (width, height, size = 200, seed = 0) => {
    const bytes = png(Math.max(size, 33), seed);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
};

/**
 * A fake decoder and encoder with the shape of portrait-fit.js browserImageIo (there is no canvas in Node): `bytes → io`.
 * `width`/`height`: what every picture decodes to. `bytesAt(side, quality)`: how many bytes the encoder gives (default: the picture
 * is 300 KB at full quality and smaller with each step, so it fits at the fourth step (quality 0.4)). `fail`: an Error `size()` throws.
 * `calls` records what was asked: `opened` (pictures), `encoded` ([side, quality]), `closed`.
 */
export function fakeImageIo({ width = 2400, height = 1800, bytesAt = (side, quality) => Math.round(300 * 1024 * quality * quality * (side / 600)), fail = null, failEncode = null } = {}) {
    const calls = { opened: 0, encoded: [], closed: 0 };
    const make = bytes => {
        calls.opened += 1;
        return {
            async size() { if (fail) throw fail; return { width, height }; },
            async encode(side, quality) {
                calls.encoded.push([side, quality]);
                if (failEncode) throw failEncode;
                const out = webp(Math.max(bytesAt(side, quality), 12), bytes.length % 251);
                return { bytes: out, type: 'webp', width: Math.round(width * Math.min(1, side / Math.max(width, height))), height: Math.round(height * Math.min(1, side / Math.max(width, height))) };
            },
            close() { calls.closed += 1; },
        };
    };
    make.calls = calls;
    return make;
}
