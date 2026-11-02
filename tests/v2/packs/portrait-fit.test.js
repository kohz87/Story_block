// Portraits over 64 KB are made smaller on import (portrait-fit.js, portraits.js): a PNG, JPEG or WebP of up to 10 MB is decoded, drawn
// with its long side at most 600 px, saved as WebP with the quality stepped down until it is 64 KB or less. A picture already that small is
// kept byte for byte. Node has no canvas, so the decoder and encoder are a fake with the browser one's shape; the browser's own is
// tried in a real browser by hand (see the stage 36 report).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { PORTRAIT_LIMITS, ZIP_LIMITS } from '../../../src/v2/packs/limits.js';
import { FitProblem, MAX_PIXELS, browserImageIo, fitPortrait, imageSize } from '../../../src/v2/packs/portrait-fit.js';
import { sniffImage } from '../../../src/v2/packs/portraits.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack } from './helpers/fixtures.js';
import { fakeFiles, fakeImageIo, jpg, picked, png, pngOf, webp } from './helpers/portraits.js';

const person = (id, portrait) => ({ id, name: id[0].toUpperCase() + id.slice(1), about: 'About.', look: 'Look.', start: { place: 'Docks', goal: 'A goal.' }, ...(portrait ? { portrait } : {}) });
const cast = (version, ...people) => pack({ version, content: { cast: people } });
const setup = (io = fakeImageIo(), options) => {
    const files = fakeFiles(options);
    const { part, packs } = createPacksPart({ settings: fakeSettings(), portraitFiles: files, portraitIo: io });
    const url = (id, file) => part.queries['packs.portrait']({}, { pack: id, file });
    const storedBytes = file => files.files.get(url('mini', file).slice('/user/files/'.length));
    return { files, packs, url, storedBytes, io };
};
const BIG = 3 * 1024 * 1024;

test('a large PNG and a large JPEG are stored as WebP of 64 KB or less, the long side asked at 600 px, quality stepped down', async () => {
    const { files, packs, url, storedBytes, io } = setup();
    const result = await packs.install(cast('1.0.0', person('a', 'a.png'), person('b', 'b.jpg')), { files: [picked('a.png', pngOf(2400, 1800, BIG)), picked('b.jpg', jpg(2 * 1024 * 1024))] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.portraits, { stored: ['a.png', 'b.jpg'], refused: [], missing: [], dropped: 0 });
    for (const file of ['a.png', 'b.jpg']) {
        assert.match(url('mini', file), /^\/user\/files\/storysuite-portrait-mini-[0-9a-f]{8}\.webp$/, 'stored under a .webp name, whatever it was picked as');
        const bytes = storedBytes(file);
        assert.equal(sniffImage(bytes), 'webp');
        assert.ok(bytes.length <= PORTRAIT_LIMITS.bytes, `${file}: ${bytes.length} bytes`);
    }
    assert.equal(files.files.size, 2);
    // the long side is capped at 600 and the quality goes down by the same steps as Story Studio's
    assert.deepEqual(io.calls.encoded.slice(0, 4), [[600, 0.85], [600, 0.7], [600, 0.55], [600, 0.4]]);
    assert.equal(io.calls.opened, 2);
    assert.equal(io.calls.closed, 2, 'each decoded picture is freed');
});

test('a picture of 64 KB or less is stored exactly as it came: byte for byte, never decoded, whatever its type or pixels', async () => {
    const { packs, url, storedBytes, io } = setup();
    const small = { 'a.webp': webp(PORTRAIT_LIMITS.bytes, 1), 'b.png': png(5000, 2), 'c.jpg': jpg(PORTRAIT_LIMITS.bytes - 1, 3), 'd.png': pngOf(4000, 4000, 900, 4) };
    const result = await packs.install(cast('1.0.0', ...Object.keys(small).map(file => person(file.split('.')[0], file))), { files: Object.entries(small).map(([name, bytes]) => picked(name, bytes)) });
    assert.deepEqual(result.portraits.stored.sort(), Object.keys(small));
    assert.equal(io.calls.opened, 0);
    for (const [file, bytes] of Object.entries(small)) {
        assert.deepEqual(storedBytes(file), bytes, file);
        assert.ok(url('mini', file).endsWith(`.${sniffImage(bytes)}`), 'the type is the picture\'s own');
    }
});

test('the same large picture imported again is the same stored file: nothing is put twice', async () => {
    const { files, packs, url } = setup();
    const big = pngOf(2400, 1800, BIG, 5);
    await packs.install(cast('1.0.0', person('a', 'a.png')), { files: [picked('a.png', big)] });
    const first = url('mini', 'a.png');
    const puts = files.log.filter(([kind]) => kind === 'put').length;
    await packs.install(cast('1.1.0', person('a', 'a.png')), { files: [picked('a.png', big)] });
    assert.equal(url('mini', 'a.png'), first);
    assert.equal(files.log.filter(([kind]) => kind === 'put').length, puts);
    assert.equal(files.files.size, 1);
});

test('a size limit of 10 MB is checked from the declared size before the file is read, and again on what was read', async () => {
    const { packs, files } = setup();
    let read = false;
    const over = PORTRAIT_LIMITS.source + 1;
    const result = await packs.install(cast('1.0.0', person('a', 'a.png'), person('b', 'b.png')), {
        files: [{ name: 'a.png', size: over, read: async () => { read = true; return png(); } }, { name: 'b.png', size: 100, read: async () => png(over) }],
    });
    assert.equal(read, false);
    assert.deepEqual(result.portraits.stored, []);
    assert.equal(result.portraits.refused.length, 2);
    for (const item of result.portraits.refused) assert.match(item.message, new RegExp(`^${item.file} is 10(\\.0)? MB; a portrait may be picked at up to 10 MB \\(it is made smaller to fit 64 KB\\)\\.$`));
    assert.equal(files.files.size, 0);
});

test('refused, naming the file: not a picture the browser can read, still over 64 KB at the lowest step, too many pixels, the encoder failing', async () => {
    const cases = [
        ['unreadable.png', fakeImageIo({ fail: new FitProblem('could not be read as a picture') }), /^unreadable\.png could not be read as a picture\.$/],
        ['stubborn.png', fakeImageIo({ bytesAt: () => 200 * 1024 }), /^stubborn\.png cannot be made small enough: a portrait may be at most 64 KB\.$/],
        ['broken.png', fakeImageIo({ failEncode: new Error('canvas lost') }), /^broken\.png could not be made smaller \(canvas lost\)\.$/],
    ];
    for (const [file, io, pattern] of cases) {
        const { files, packs, io: used } = setup(io);
        const result = await packs.install(cast('1.0.0', person('a', file)), { files: [picked(file, pngOf(2400, 1800, BIG))] });
        assert.equal(result.ok, true, file);
        assert.deepEqual(result.portraits.stored, [], file);
        assert.match(result.portraits.refused[0].message, pattern);
        assert.equal(result.portraits.refused[0].file, file);
        assert.equal(files.files.size, 0, file);
        assert.equal(used.calls.closed, used.calls.opened, `${file}: freed`);
    }
    // a header that claims more pixels than can be decoded is refused without opening the decoder
    const { packs, io } = setup();
    const huge = await packs.install(cast('1.0.0', person('a', 'huge.png')), { files: [picked('huge.png', pngOf(30000, 30000, BIG))] });
    assert.match(huge.portraits.refused[0].message, /^huge\.png has 30000 × 30000 pixels, which is too many to make smaller here \(at most 64 million\)\.$/);
    assert.equal(io.calls.opened, 0);
    assert.ok(30000 * 30000 > MAX_PIXELS);
});

test('a refused big picture does not stop the others or the pack; a wrong type is still refused from its first bytes', async () => {
    const { files, packs, url } = setup(fakeImageIo({ fail: null }));
    const gif = new Uint8Array(BIG);
    gif.set([...'GIF89a'].map(char => char.charCodeAt(0)));
    const result = await packs.install(cast('1.0.0', person('a', 'a.png'), person('b', 'b.webp'), person('c', 'c.png')), { files: [picked('a.png', pngOf(2400, 1800, BIG)), picked('b.webp', webp(100)), picked('c.png', gif)] });
    assert.deepEqual(result.portraits.stored, ['a.png', 'b.webp']);
    assert.match(result.portraits.refused[0].message, /c\.png is not a WebP, PNG or JPEG image/);
    assert.equal(files.files.size, 2);
    assert.ok(url('mini', 'a.png') && url('mini', 'b.webp'));
});

test('where there is no decoder, a picture over 64 KB is refused as before, with the 64 KB message', async () => {
    const { files, packs } = setup(null);
    const result = await packs.install(cast('1.0.0', person('a', 'a.png')), { files: [picked('a.png', png(PORTRAIT_LIMITS.bytes + 1))] });
    assert.match(result.portraits.refused[0].message, /^a\.png is 64 KB; a portrait may be at most 64 KB \(compress it and pick it again\)\.$/);
    assert.equal(files.files.size, 0);
});

test('fitPortrait: quality steps first, then fewer pixels, then it gives up with the file left to the caller to name', async () => {
    const io = fakeImageIo({ bytesAt: (side, quality) => (side <= 400 && quality <= 0.55 ? 1000 : 500 * 1024) });
    const out = await fitPortrait(io(png()), {});
    assert.equal(out.type, 'webp');
    const asked = io.calls.encoded;
    assert.deepEqual(asked.slice(0, 5), [[600, 0.85], [600, 0.7], [600, 0.55], [600, 0.4], [600, 0.3]]);
    assert.deepEqual(asked.at(-1), [asked.at(-1)[0], 0.55]);
    assert.ok(asked.at(-1)[0] <= 400);
    // a small picture is asked at its own size, not enlarged
    const small = fakeImageIo({ width: 200, height: 100, bytesAt: () => 70 * 1024 });
    await assert.rejects(fitPortrait(small(png())), error => error instanceof FitProblem && /cannot be made small enough: a portrait may be at most 64 KB$/.test(error.message));
    assert.equal(small.calls.encoded[0][0], 200);
    assert.ok(small.calls.encoded.at(-1)[0] >= 96);
});

test('imageSize reads the header of a PNG, JPEG and each kind of WebP, and answers null for what it cannot read', () => {
    assert.deepEqual(imageSize(pngOf(1234, 567), 'png'), { width: 1234, height: 567 });
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x02, 0x58, 3, 1, 0x22, 0, 0, 0, 0]);
    assert.deepEqual(imageSize(jpeg, 'jpg'), { width: 600, height: 300 });
    const riff = tag => { const bytes = new Uint8Array(40); bytes.set([...'RIFF'].map(c => c.charCodeAt(0)), 0); bytes.set([...'WEBP'].map(c => c.charCodeAt(0)), 8); bytes.set([...tag].map(c => c.charCodeAt(0)), 12); return bytes; };
    const x = riff('VP8X'); x.set([0x1f, 0x01, 0x00, 0xc7, 0x00, 0x00], 24);
    assert.deepEqual(imageSize(x, 'webp'), { width: 288, height: 200 });
    const l = riff('VP8L'); new DataView(l.buffer).setUint32(21, 99 | (49 << 14), true);
    assert.deepEqual(imageSize(l, 'webp'), { width: 100, height: 50 });
    const lossy = riff('VP8 '); new DataView(lossy.buffer).setUint16(26, 640, true); new DataView(lossy.buffer).setUint16(28, 480, true);
    assert.deepEqual(imageSize(lossy, 'webp'), { width: 640, height: 480 });
    assert.equal(imageSize(new Uint8Array(30), 'png') && 0, 0);
    assert.equal(imageSize(riff('JUNK'), 'webp'), null);
    assert.equal(imageSize(jpg(10), 'jpg'), null);
    assert.equal(imageSize(png(), null), null);
});

// ---- browserImageIo, over a fake window ----

function fakeWindow({ webpOk = true, failDecode = false } = {}) {
    const log = { bitmaps: 0, closed: 0, canvases: [], types: [] };
    const win = {
        Blob: class { constructor(parts) { this.parts = parts; } },
        async createImageBitmap() {
            if (failDecode) throw new Error('bad');
            log.bitmaps += 1;
            return { width: 2000, height: 1000, close() { log.closed += 1; } };
        },
        document: {
            createElement() {
                const canvas = {
                    width: 0, height: 0,
                    getContext: () => ({ drawImage() {} }),
                    toBlob(done, type, quality) {
                        log.types.push([type, quality]);
                        const asked = type === 'image/webp' && !webpOk ? 'image/png' : type;
                        done({ type: asked, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
                    },
                };
                log.canvases.push(canvas);
                return canvas;
            },
        },
    };
    return { win, log };
}

test('browserImageIo draws the picture scaled to the side asked and saves WebP; one decode serves every step; close frees it', async () => {
    const { win, log } = fakeWindow();
    const io = browserImageIo(win)(png());
    assert.deepEqual(await io.size(), { width: 2000, height: 1000 });
    const out = await io.encode(600, 0.7);
    assert.equal(out.type, 'webp');
    assert.deepEqual([log.canvases[0].width, log.canvases[0].height], [600, 300]);
    assert.deepEqual(log.types, [['image/webp', 0.7]]);
    await io.encode(5000, 0.5);
    assert.deepEqual([log.canvases[1].width, log.canvases[1].height], [2000, 1000], 'never enlarged');
    assert.equal(log.bitmaps, 1);
    io.close();
    assert.equal(log.closed, 1);
});

test('browserImageIo saves JPEG where the browser cannot save WebP, and says so in plain words when it cannot read the picture', async () => {
    const { win, log } = fakeWindow({ webpOk: false });
    const out = await browserImageIo(win)(png()).encode(600, 0.8);
    assert.equal(out.type, 'jpg');
    assert.deepEqual(log.types.map(([type]) => type), ['image/webp', 'image/jpeg']);
    const bad = browserImageIo(fakeWindow({ failDecode: true }).win)(png());
    await assert.rejects(bad.size(), error => error instanceof FitProblem && error.message === 'could not be read as a picture');
    const none = browserImageIo({})(png());
    await assert.rejects(none.size(), error => error instanceof FitProblem && /this browser cannot read pictures/.test(error.message));
});

test('the stored limit stays 64 KB and a full pack of 10 MB portraits fits the zip limits', () => {
    assert.equal(PORTRAIT_LIMITS.bytes, 64 * 1024);
    assert.equal(PORTRAIT_LIMITS.source, 10 * 1024 * 1024);
    assert.ok(PORTRAIT_LIMITS.perPack * PORTRAIT_LIMITS.source + 512 * 1024 <= ZIP_LIMITS.archive);
    assert.ok(PORTRAIT_LIMITS.perPack * PORTRAIT_LIMITS.source + 512 * 1024 <= ZIP_LIMITS.unpacked);
    assert.ok(PORTRAIT_LIMITS.perPack + 2 <= ZIP_LIMITS.entries);
    assert.ok(ZIP_LIMITS.entry >= PORTRAIT_LIMITS.source);
});
