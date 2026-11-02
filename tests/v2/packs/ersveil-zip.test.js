// examples/packs/ersveil.zip (built by scripts/build-example-zip.mjs) can never drift from examples/packs/ersveil/: its pack.json and
// portraits are the files in the folder byte for byte, Story Block's own readPackZip accepts it, and rebuilding gives the same bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { readPackZip } from '../../../src/v2/packs/bundle.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { readZip } from '../../../src/v2/packs/zip.js';
import { buildErsveilZip } from '../../../scripts/build-example-zip.mjs';
import { fakeSettings } from './helpers/fake-settings.js';
import { fakeFiles } from './helpers/portraits.js';

const packs = new URL('../../../examples/packs/', import.meta.url);
const folder = new URL('ersveil/', packs);
const zipBytes = () => new Uint8Array(readFileSync(new URL('ersveil.zip', packs)));
const bytesOf = path => new Uint8Array(readFileSync(new URL(path, folder)));

test('the shipped zip is exactly what the build script gives (run `node scripts/build-example-zip.mjs` when the pack or a portrait changes)', () => {
    assert.ok(Buffer.from(zipBytes()).equals(Buffer.from(buildErsveilZip())), 'examples/packs/ersveil.zip is out of date');
});

test('the zip lists pack.json first, then portraits/<file> for the twelve pictures, and nothing else', () => {
    const names = readZip(zipBytes()).map(entry => entry.name);
    const portraits = readdirSync(new URL('portraits/', folder)).sort();
    assert.equal(portraits.length, 12);
    assert.equal(names[0], 'pack.json');
    assert.deepEqual(names.slice(1).sort(), portraits.map(name => `portraits/${name}`));
});

test('its pack.json and every portrait are the files in examples/packs/ersveil/, byte for byte', async () => {
    const read = await readPackZip(zipBytes());
    assert.equal(read.ok, true, read.message);
    assert.equal(read.text, readFileSync(new URL('pack.json', folder), 'utf8'));
    assert.deepEqual(read.files.map(file => file.name).sort(), readdirSync(new URL('portraits/', folder)).sort());
    for (const file of read.files) {
        const real = bytesOf(`portraits/${file.name}`);
        assert.equal(file.size, real.length, file.name);
        assert.ok(Buffer.from(await file.read()).equals(Buffer.from(real)), `${file.name} differs from the file in the folder`);
    }
});

test('Story Block installs the shipped zip: twelve portraits saved, twelve people in the cast', async () => {
    const read = await readPackZip(zipBytes());
    assert.equal(read.ok, true, read.message);
    const portraitFiles = fakeFiles();
    const made = createPacksPart({ settings: fakeSettings(), portraitFiles });
    const result = await made.packs.install(read.text, { source: 'file', origin: 'ersveil.zip', files: read.files });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.portraits.stored.length, 12);
    assert.deepEqual(result.portraits.refused, []);
    assert.equal(portraitFiles.files.size, 12);
    assert.equal(made.packs.list()[0].counts.cast, 12);
});
