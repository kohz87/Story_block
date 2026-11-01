// A pack as one zip (zip.js, bundle.js): Story Studio's export, pack.json and a portraits/ folder. What it reads, and what it
// refuses in plain words: encrypted, zip64, several disks, a path with "..", a file the pack does not name, too much unpacked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readZip, ZipProblem } from '../../../src/v2/packs/zip.js';
import { readPackZip } from '../../../src/v2/packs/bundle.js';
import { ZIP_LIMITS } from '../../../src/v2/packs/limits.js';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { renderPacksPanel } from '../../../src/v2/packs/panel.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { fakeFiles, png, webp } from './helpers/portraits.js';
import { pack } from './helpers/fixtures.js';
import { zip } from './helpers/zip.js';

const person = (id, portrait) => ({ id, name: id[0].toUpperCase() + id.slice(1), about: 'About.', look: 'Look.', start: { place: 'Docks', goal: 'A goal.' }, portrait });
const packText = (...people) => JSON.stringify(pack({ content: { cast: people } }));
const text = value => new TextEncoder().encode(value);
const good = () => zip([
    { name: 'pack.json', bytes: text(packText(person('fenna', 'fenna.webp'), person('sera', 'sera.png'))) },
    { name: 'portraits/', bytes: new Uint8Array(0) },
    { name: 'portraits/fenna.webp', bytes: webp(500, 1), method: 'store' },
    { name: 'portraits/sera.png', bytes: png(500, 2) },
]);
const refusedWith = async (bytes, pattern) => {
    const result = await readPackZip(bytes);
    assert.equal(result.ok, false);
    assert.match(result.message, pattern);
};

test('a good zip: pack.json and the portraits it names, stored and deflated', async () => {
    const result = await readPackZip(good());
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(result.text).id, 'mini');
    assert.deepEqual(result.files.map(file => [file.name, file.size]), [['fenna.webp', 500], ['sera.png', 500]]);
    assert.deepEqual(await result.files[0].read(), webp(500, 1));
    assert.deepEqual(await result.files[1].read(), png(500, 2));
});

test('a zip is read by its central directory: names, sizes, folders left out', async () => {
    const entries = readZip(good());
    assert.deepEqual(entries.map(entry => entry.name), ['pack.json', 'portraits/fenna.webp', 'portraits/sera.png']);
});

test('a path that climbs out of the folder is refused (zip slip), as are absolute and backslash paths', async () => {
    const slip = name => zip([{ name: 'pack.json', bytes: text(packText(person('a', 'a.png'))) }, { name, bytes: png() }]);
    for (const name of ['portraits/../../evil.png', '../a.png', 'portraits/..', '/etc/a.png', 'portraits\\a.png', 'C:/a.png']) {
        await refusedWith(slip(name), /path that is not allowed/);
    }
    assert.throws(() => readZip(slip('a/../b.png')), ZipProblem);
});

test('too much unpacked: by the sizes the zip declares, and by what really comes out of a zip that lies', async () => {
    const big = new Uint8Array(ZIP_LIMITS.unpacked + 1);
    await refusedWith(zip([{ name: 'pack.json', bytes: text(packText(person('a', 'a.png'))) }, { name: 'portraits/a.png', bytes: big }]), /more than 4 MB/);
    // a small file whose directory claims a size smaller than the truth: the unpacking stops at the claim
    const lie = zip([{ name: 'pack.json', bytes: text(packText(person('a', 'a.png'))) }, { name: 'portraits/a.png', bytes: new Uint8Array(100_000), size: 1000 }]);
    const result = await readPackZip(lie);
    assert.equal(result.ok, true);
    await assert.rejects(result.files[0].read(), /larger than the zip says/);
});

test('a file that is not pack.json or a portrait the pack names refuses the whole zip', async () => {
    const withExtra = name => zip([{ name: 'pack.json', bytes: text(packText(person('a', 'a.png'))) }, { name: 'portraits/a.png', bytes: png() }, { name, bytes: text('x') }]);
    await refusedWith(withExtra('notes.txt'), /"notes.txt", which is not pack.json or a portrait the pack's cast names/);
    await refusedWith(withExtra('portraits/stray.png'), /"portraits\/stray.png"/);
    await refusedWith(withExtra('portraits/sub/a.png'), /"portraits\/sub\/a.png"/);
    await refusedWith(withExtra('__MACOSX/a'), /__MACOSX/);
    await refusedWith(zip([{ name: 'portraits/a.png', bytes: png() }]), /no pack.json/);
});

test('encrypted, zip64, split and unknown-method zips, damage, and things that are not zips', async () => {
    const files = [{ name: 'pack.json', bytes: text(packText(person('a'))) }];
    await refusedWith(zip([{ ...files[0], flags: 1 }]), /Encrypted/);
    await refusedWith(zip(files, { zip64Locator: true }), /Zip64/);
    await refusedWith(zip(files, { totalEntries: 0xffff }), /Zip64/);
    await refusedWith(zip(files, { disk: 1 }), /several disks/);
    await refusedWith(zip([{ ...files[0], crc: 1 }]), /damaged/);
    await refusedWith(text('this is not a zip file at all, just text'), /not a zip/);
    await refusedWith(new Uint8Array(5), /not a zip/);
    await refusedWith(zip(Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, n) => ({ name: `f${n}`, bytes: text('x') }))), /at most 40/);
    await refusedWith(zip([files[0], files[0]]), /twice/);
    const truncated = good().slice(0, 100);
    await refusedWith(truncated, /not a zip/);
    const archive = new Uint8Array(ZIP_LIMITS.archive + 1);
    await refusedWith(archive, /larger than 5 MB/);
});

// ---- through the Packs panel and an install ----

const doc = installFakeDom();
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const fileOf = (name, bytes, type = '') => ({ name, type, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => new TextDecoder().decode(bytes) });
function mount() {
    const files = fakeFiles();
    const made = createPacksPart({ settings: fakeSettings(), portraitFiles: files });
    const root = doc.createElement('div');
    renderPacksPanel(root, { packs: made.packs, readLorebook: async () => ({ character: '', entries: [], problem: '' }), doc });
    const pick = async list => { const input = root.querySelector('.ss-packs-file'); input.files = list; input.dispatch('change'); for (let n = 0; n < 200 && !texts(root, '.ss-packs-message')[0]; n += 1) await tick(); };
    return { files, made, root, pick };
}

test('the Packs panel imports a pack zip: the pack, its portraits, and a line that says so', async () => {
    const { files, made, root, pick } = mount();
    assert.equal(root.querySelector('.ss-packs-file').multiple, true);
    await pick([fileOf('ersveil-cast.zip', good(), 'application/zip')]);
    assert.deepEqual(texts(root, '.ss-packs-message'), ['Installed mini. 2 portraits saved.']);
    assert.equal(files.files.size, 2);
    assert.ok(made.part.queries['packs.portrait']({}, { pack: 'mini', file: 'sera.png' }));
});

test('the Packs panel: a bad zip imports nothing and says why; a zip picked with other files is not guessed at', async () => {
    const { files, made, root, pick } = mount();
    await pick([fileOf('bad.zip', zip([{ name: 'pack.json', bytes: text(packText(person('a', 'a.png'))) }, { name: 'portraits/../x.png', bytes: png() }]))]);
    assert.deepEqual(texts(root, '.ss-packs-message'), ['bad.zip was not imported.']);
    assert.match(texts(root, '.ss-packs-errors li')[0], /path that is not allowed/);
    await pick([fileOf('a.zip', good()), fileOf('pack.json', text(packText()))]);
    assert.match(texts(root, '.ss-packs-errors li')[0], /Pick the \.zip alone/);
    assert.equal(made.packs.list().length, 0);
    assert.equal(files.files.size, 0);
});

test('the Packs panel: pack.json picked with images; images the pack does not name are listed as not used', async () => {
    const { files, root, pick } = mount();
    await pick([fileOf('pack.json', text(packText(person('a', 'a.png')))), fileOf('a.png', png(300)), fileOf('x.png', png(300, 5)), fileOf('y.gif', text('GIF89a......'))]);
    assert.deepEqual(texts(root, '.ss-packs-message'), ['Installed mini. 1 portrait saved. 2 images not used.']);
    assert.equal(texts(root, '.ss-packs-errors li').length, 2);
    assert.equal(files.files.size, 1);
});

test('the Packs panel: portraits not picked are counted, never named (their file names are the unmet people\'s names)', async () => {
    const { root, pick } = mount();
    const people = ['cassian-orrel', 'mira-vane', 'tobias-kell'].map(id => person(id, `${id}.webp`));
    await pick([fileOf('pack.json', text(packText(...people))), fileOf('mira-vane.webp', webp(300))]);
    const message = texts(root, '.ss-packs-message')[0];
    assert.equal(message, 'Installed mini. 1 portrait saved; 2 portraits not picked; the people show without a picture until you add them.');
    const everything = `${message} ${texts(root, '.ss-packs-errors li').join(' ')}`;
    for (const hidden of ['cassian', 'orrel', 'tobias', 'kell', 'Cassian', 'Tobias']) assert.ok(!everything.includes(hidden), hidden);
    const one = mount();
    await one.pick([fileOf('pack.json', text(packText(person('lone-wolf', 'lone-wolf.png'))))]);
    assert.equal(texts(one.root, '.ss-packs-message')[0], 'Installed mini. 1 portrait not picked; that person shows without a picture until you add it.');
    assert.ok(!texts(one.root, '.ss-packs-message')[0].includes('lone'));
});
