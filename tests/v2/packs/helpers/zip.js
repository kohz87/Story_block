// A zip writer for the tests (stored or deflate), with the switches the refusals need.
import { crc32, deflateRawSync } from 'node:zlib';

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

/**
 * `files`: `[{ name, bytes, method?: 'deflate' | 'store', flags?, size? (the size the directory claims), packed?, crc? }]`.
 * `options`: `{ disk, zip64Locator, totalEntries }` to make a zip the reader must refuse.
 */
export function zip(files, { disk = 0, zip64Locator = false, totalEntries = null } = {}) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
        const bytes = Buffer.from(file.bytes);
        const store = file.method === 'store' || bytes.length === 0;
        const data = store ? bytes : deflateRawSync(bytes);
        const method = store ? 0 : 8;
        const name = Buffer.from(file.name);
        const crc = file.crc ?? crc32(bytes);
        const flags = file.flags ?? 0;
        const size = file.size ?? bytes.length;
        const packed = file.packed ?? data.length;
        const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(packed), u32(size), u16(name.length), u16(0), name, data]);
        central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(packed), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
        parts.push(local);
        offset += local.length;
    }
    const directory = Buffer.concat(central);
    const total = totalEntries ?? files.length;
    const end = Buffer.concat([u32(0x06054b50), u16(disk), u16(disk), u16(total), u16(total), u32(directory.length), u32(offset), u16(0)]);
    const locator = zip64Locator ? Buffer.concat([u32(0x07064b50), u32(0), Buffer.alloc(8), u32(1)]) : Buffer.alloc(0);
    return new Uint8Array(Buffer.concat([...parts, directory, locator, end]));
}
