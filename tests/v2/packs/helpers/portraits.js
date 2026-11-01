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
