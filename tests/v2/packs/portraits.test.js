// Pack portraits (portraits.js): images picked with a pack are stored outside settings, named by the pack's cast, queried by
// `packs.portrait`, replaced by a newer import, dropped when the pack stops naming them, removed with the pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { PORTRAIT_LIMITS } from '../../../src/v2/packs/limits.js';
import { sniffImage } from '../../../src/v2/packs/portraits.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack } from './helpers/fixtures.js';
import { fakeFiles, gif, jpg, picked, png, tooBig, webp } from './helpers/portraits.js';

const person = (id, portrait) => ({ id, name: id[0].toUpperCase() + id.slice(1), about: 'About.', look: 'Look.', start: { place: 'Docks', goal: 'A goal.' }, ...(portrait ? { portrait } : {}) });
const cast = (version, ...people) => pack({ version, content: { cast: people } });
const setup = options => {
    const files = fakeFiles(options);
    const settings = fakeSettings();
    const { part, packs } = createPacksPart({ settings, portraitFiles: files });
    const url = (id, file) => part.queries['packs.portrait']({}, { pack: id, file });
    return { files, settings, part, packs, url };
};

test('what a picture is comes from its first bytes, not its name', () => {
    assert.equal(sniffImage(png()), 'png');
    assert.equal(sniffImage(webp()), 'webp');
    assert.equal(sniffImage(jpg()), 'jpg');
    assert.equal(sniffImage(gif()), null);
    assert.equal(sniffImage(new Uint8Array(3)), null);
    assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('portraits picked with the pack are stored, shown at a safe URL, and the index is all that stays in settings', async () => {
    const { files, settings, packs, url } = setup();
    const image = webp(300);
    const result = await packs.install(cast('1.0.0', person('fenna', 'fenna.webp')), { files: [picked('fenna.webp', image)] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.portraits, { stored: ['fenna.webp'], refused: [], missing: [], dropped: 0 });
    const shown = url('mini', 'fenna.webp');
    assert.match(shown, /^\/user\/files\/storysuite-portrait-mini-[0-9a-f]{8}\.webp$/);
    assert.deepEqual([...files.files.keys()], [shown.slice('/user/files/'.length)]);
    assert.deepEqual(files.files.get(shown.slice('/user/files/'.length)), image);
    assert.deepEqual(Object.keys(settings.root.portraits.mini), ['fenna.webp']);
    assert.ok(!JSON.stringify(settings.root.packs).includes('storysuite-portrait'), 'the pack in settings holds no picture');
    // other asks
    assert.equal(url('mini', 'other.webp'), null);
    assert.equal(url('nope', 'fenna.webp'), null);
    assert.equal(url('mini', undefined), null);
});

test('a pack that names portraits no one picked is installed, and says which are missing', async () => {
    const { packs, url } = setup();
    const result = await packs.install(cast('1.0.0', person('fenna', 'fenna.webp'), person('sera', 'sera.png')), { files: [picked('sera.png', png())] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.portraits.missing, ['fenna.webp']);
    assert.equal(url('mini', 'fenna.webp'), null);
    assert.ok(url('mini', 'sera.png'));
});

test('refusals: too big, wrong type, a file the pack does not name, a name picked twice, an empty file; the pack still installs', async () => {
    const { files, packs, url } = setup();
    const result = await packs.install(cast('1.0.0', person('a', 'a.webp'), person('b', 'b.png'), person('c', 'c.jpg'), person('d', 'd.png')), {
        files: [picked('a.webp', tooBig()), picked('b.png', gif()), picked('c.jpg', jpg()), picked('stray.png', png()), picked('c.jpg', jpg(300)), picked('d.png', new Uint8Array(0))],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.portraits.stored, ['c.jpg']);
    const said = Object.fromEntries(result.portraits.refused.map(item => [item.file, item.message]));
    assert.match(said['a.webp'], /is 150 KB|is 151 KB/);
    assert.match(said['a.webp'], /at most 150 KB/);
    assert.match(said['b.png'], /not a WebP, PNG or JPEG image/);
    assert.match(said['stray.png'], /not named by any person in this pack/);
    assert.match(said['c.jpg'], /picked twice/);
    assert.match(said['d.png'], /is empty/);
    assert.equal(files.files.size, 1);
    assert.equal(url('mini', 'a.webp'), null);
    assert.ok(url('mini', 'c.jpg'));
});

test('the size limit is checked from the declared size before the file is read', async () => {
    const { packs } = setup();
    let read = false;
    const result = await packs.install(cast('1.0.0', person('a', 'a.webp')), { files: [{ name: 'a.webp', size: PORTRAIT_LIMITS.bytes + 1, read: async () => { read = true; return webp(); } }] });
    assert.equal(read, false);
    assert.equal(result.portraits.refused.length, 1);
});

test('a storage failure refuses that picture only; where nothing can store, every picture is refused with that reason', async () => {
    const flaky = setup({ failPut: name => name.includes('-mini-') && name.endsWith('.png') });
    const result = await flaky.packs.install(cast('1.0.0', person('a', 'a.webp'), person('b', 'b.png')), { files: [picked('a.webp', webp()), picked('b.png', png())] });
    assert.deepEqual(result.portraits.stored, ['a.webp']);
    assert.match(result.portraits.refused[0].message, /b\.png could not be saved \(the server answered 500\)/);
    const none = createPacksPart({ settings: fakeSettings() });
    const bare = await none.packs.install(cast('1.0.0', person('a', 'a.webp')), { files: [picked('a.webp', webp())] });
    assert.equal(bare.ok, true);
    assert.match(bare.portraits.refused[0].message, /file storage is not available/);
    assert.equal(none.part.queries['packs.portrait']({}, { pack: 'mini', file: 'a.webp' }), null);
});

test('a newer version replaces its portraits: a picked picture is a new file and the old one goes; one not picked stays while named; one no longer named goes', async () => {
    const { files, packs, url } = setup();
    await packs.install(cast('1.0.0', person('a', 'a.webp'), person('b', 'b.png')), { files: [picked('a.webp', webp(200, 1)), picked('b.png', png(200, 1))] });
    const firstA = url('mini', 'a.webp');
    const firstB = url('mini', 'b.png');
    assert.equal(files.files.size, 2);
    // 1.1.0: a.webp picked again (new picture), b.png not picked
    const update = await packs.install(cast('1.1.0', person('a', 'a.webp'), person('b', 'b.png')), { files: [picked('a.webp', webp(200, 2))] });
    assert.equal(update.action, 'updated');
    assert.notEqual(url('mini', 'a.webp'), firstA, 'a new picture is a new URL (no stale cache)');
    assert.equal(url('mini', 'b.png'), firstB, 'b stays while the pack names it');
    assert.equal(files.files.size, 2, 'the old a.webp file is gone');
    // 1.2.0: no longer names b.png
    const third = await packs.install(cast('1.2.0', person('a', 'a.webp'), person('b')));
    assert.equal(third.portraits.dropped, 1);
    assert.equal(url('mini', 'b.png'), null);
    assert.equal(files.files.size, 1);
    // the same picture again is not stored twice
    const puts = files.log.filter(([kind]) => kind === 'put').length;
    await packs.install(cast('1.3.0', person('a', 'a.webp'), person('b')), { files: [picked('a.webp', webp(200, 2))] });
    assert.equal(files.log.filter(([kind]) => kind === 'put').length, puts);
});

test('two names for one picture share a file until both are gone', async () => {
    const { files, packs, url } = setup();
    const same = png(200, 7);
    await packs.install(cast('1.0.0', person('a', 'a.png'), person('b', 'b.png')), { files: [picked('a.png', same), picked('b.png', same)] });
    assert.equal(files.files.size, 1);
    await packs.install(cast('1.1.0', person('a', 'a.png'), person('b')));
    assert.equal(files.files.size, 1, 'b.png is dropped but a.png still uses the file');
    assert.ok(url('mini', 'a.png'));
});

test('removing the pack removes its portraits and their index; another pack\'s stay', async () => {
    const { files, settings, packs, url } = setup();
    await packs.install(cast('1.0.0', person('a', 'a.png')), { files: [picked('a.png', png(200, 1))] });
    await packs.install({ ...cast('1.0.0', person('a', 'a.png')), id: 'other' }, { files: [picked('a.png', png(200, 1))] });
    assert.equal(files.files.size, 2);
    assert.equal(await packs.remove('mini'), true);
    assert.equal(files.files.size, 1);
    assert.equal(url('mini', 'a.png'), null);
    assert.ok(url('other', 'a.png'));
    assert.deepEqual(Object.keys(settings.root.portraits), ['other']);
    await packs.remove('other');
    assert.equal(files.files.size, 0);
});

test('a file that went missing from the server answers null after a check, until the pack is imported with it again', async () => {
    const files = fakeFiles();
    const made = createPacksPart({ settings: fakeSettings(), portraitFiles: files });
    const url = () => made.part.queries['packs.portrait']({}, { pack: 'mini', file: 'a.webp' });
    const image = webp();
    await made.packs.install(cast('1.0.0', person('a', 'a.webp')), { files: [picked('a.webp', image)] });
    assert.equal(await made.portraits.verify(), 0);
    files.files.clear();
    assert.ok(url(), 'not known to be gone before a check');
    assert.equal(await made.portraits.verify(), 1);
    assert.equal(url(), null);
    await made.packs.install(cast('1.0.0', person('a', 'a.webp')), { files: [picked('a.webp', image)] });
    assert.ok(url(), 'imported again, the file is stored again');
    assert.equal(files.files.size, 1);
});

test('a hand-edited index cannot point a portrait at any other file', async () => {
    const { settings, packs, url } = setup();
    await packs.install(cast('1.0.0', person('a', 'a.png')), { files: [picked('a.png', png())] });
    settings.root.portraits.mini['a.png'].stored = '../../secrets.json';
    assert.equal(url('mini', 'a.png'), null);
    settings.root.portraits.mini['a.png'].stored = 'storysuite-portrait-other-0123abcd.png';
    assert.equal(url('mini', 'a.png'), null, 'a stored name of another pack is not this pack\'s');
});
