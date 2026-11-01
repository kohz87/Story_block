// The Ersveil pack's twelve cast members (examples/packs/ersveil, 2.4.0): they pass the cast check whole, stay inside every limit,
// start at places the pack names, carry their portraits (WebP, small), keep their secrets out of the lines the reader sees, and
// come in as one zip that the importer reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { checkCast } from '../../../src/v2/packs/cast.js';
import { CAST_LIMITS, METER_LIMITS, PORTRAIT_LIMITS, ZIP_LIMITS } from '../../../src/v2/packs/limits.js';
import { readPackZip } from '../../../src/v2/packs/bundle.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { fakeFiles } from './helpers/portraits.js';
import { sniffImage } from '../../../src/v2/packs/portraits.js';
import { zip } from './helpers/zip.js';

const folder = new URL('../../../examples/packs/ersveil/', import.meta.url);
const packText = readFileSync(new URL('pack.json', folder), 'utf8');
const pack = () => JSON.parse(packText);
const cast = () => pack().content.cast;
const chars = text => [...text].length;
const portraitBytes = name => new Uint8Array(readFileSync(new URL(`portraits/${name}`, folder)));

const IDS = ['temiwa', 'ysmeth', 'nysseth', 'rika', 'harrak', 'torka', 'lothar', 'gorm', 'nerissa', 'hush', 'asphodel', 'barney'];
const ROMANCEABLE = IDS.filter(id => id !== 'barney');

test('the cast is the twelve, in order, and the whole list passes the cast check with nothing dropped', () => {
    assert.deepEqual(cast().map(person => person.id), IDS);
    const problems = [];
    const checked = checkCast(cast(), 'ersveil', (code, path, message) => problems.push(`${code} ${path} ${message}`));
    assert.deepEqual(problems, []);
    assert.equal(checked.length, 12);
    for (const [index, person] of checked.entries()) {
        const raw = cast()[index];
        assert.equal(person.secrets.length, raw.secrets.length, `${person.id}: every secret kept`);
        assert.equal(person.stages.length, raw.stages.length, `${person.id}: every stage kept`);
        assert.equal(person.portrait, `${person.id}.webp`);
        assert.equal(person.canDieUnmet, false);
    }
});

test('every text sits inside the cast limits, and a secret has a rule (a meter, an event or both)', () => {
    for (const person of cast()) {
        const at = field => `${person.id}.${field}`;
        for (const field of ['about', 'look', 'voice', 'personality', 'history']) assert.ok(chars(person[field]) <= CAST_LIMITS[field], at(field));
        assert.ok(chars(person.start.place) <= CAST_LIMITS.place && chars(person.start.goal) <= CAST_LIMITS.goal && chars(person.start.routine) <= CAST_LIMITS.routine, at('start'));
        assert.ok(person.drawnTo.length >= 1 && person.drawnTo.length <= CAST_LIMITS.drawnTo, at('drawnTo'));
        assert.ok(Object.keys(person.fields).length <= CAST_LIMITS.fields && 'Soul Class' in person.fields, at('fields'));
        assert.ok(person.secrets.length >= 5 && person.secrets.length <= CAST_LIMITS.secrets, at('secrets'));
        for (const secret of person.secrets) {
            assert.ok(chars(secret.text) <= CAST_LIMITS.secretText && chars(secret.title) <= CAST_LIMITS.secretTitle, `${at('secrets')}: ${secret.title}`);
            assert.ok(Object.hasOwn(secret, 'when') || Object.hasOwn(secret, 'meter'), `${secret.title}: a rule`);
            assert.equal(Object.hasOwn(secret, 'meter'), Object.hasOwn(secret, 'at'), `${secret.title}: meter with at`);
            if (secret.when) assert.ok(chars(secret.when) <= CAST_LIMITS.secretWhen, `${secret.title}: when`);
        }
        for (const stage of person.stages) assert.ok(chars(stage.name) <= METER_LIMITS.name && (!stage.milestone || chars(stage.milestone) <= METER_LIMITS.milestone), `${person.id}: ${stage.id}`);
        for (const text of [person.about, person.look, person.voice, person.personality, person.history, ...person.secrets.map(secret => secret.text)]) assert.doesNotMatch(text, /[<>{}|]/, person.id);
    }
});

test('meters and stages: the eleven romanceable use the companion preset, Barney the mentor (no desire); Trust only rises from stage to stage', () => {
    for (const person of cast()) {
        assert.equal(person.meters.preset, person.id === 'barney' ? 'mentor' : 'companion', person.id);
        assert.equal(person.meters.desire === undefined, person.id === 'barney', `${person.id}: Desire is on for the romanceable`);
        assert.equal(person.stages.length, 4, person.id);
        const trust = person.stages.map(stage => stage.needs.find(need => need.meter === 'trust')?.at).filter(at => at !== undefined);
        assert.deepEqual([...trust].sort((a, b) => a - b), trust, `${person.id}: Trust rises`);
        assert.equal(person.stages.at(-1).needs.some(need => need.meter === 'desire'), ROMANCEABLE.includes(person.id), `${person.id}: only a romantic top stage needs Desire`);
    }
    const mine = cast()[0].stages.at(-1);
    assert.deepEqual([mine.name, mine.needs], ['Mine', [{ meter: 'affection', at: 75 }, { meter: 'desire', at: 50 }]]);
    assert.equal(cast()[0].meters.tension, 10, 'Temiwa starts with some tension');
    const torka = cast().find(person => person.id === 'torka');
    assert.ok(torka.meters.trust <= 10 && torka.meters.tension >= 20, 'a rival: low trust, some tension');
});

test('the thirteen secrets that open by a meter or by an event, whichever comes first, carry both rules', () => {
    const both = cast().flatMap(person => person.secrets.filter(secret => secret.meter && secret.when).map(secret => `${person.id}:${secret.at}`));
    assert.deepEqual(both, ['temiwa:50', 'temiwa:90', 'rika:50', 'rika:90', 'harrak:50', 'harrak:90', 'torka:90', 'lothar:90', 'gorm:90', 'nerissa:90', 'hush:90', 'asphodel:90', 'barney:90']);
    for (const person of cast()) assert.ok(person.secrets.length <= CAST_LIMITS.secrets, person.id);
    assert.deepEqual(cast().map(person => person.secrets.length), [7, 8, 7, 8, 6, 6, 8, 6, 6, 6, 5, 5]);
});

test('the agreed fixes: Hush was freed about seventy years ago, Torka is 20, Soul Classes as the sheets set them', () => {
    const by = id => cast().find(person => person.id === id);
    const hush = by('hush').secrets.map(secret => secret.text).join(' ');
    assert.match(hush, /about seventy years ago/);
    assert.doesNotMatch(JSON.stringify(by('hush')), /a century ago/);
    assert.match(by('torka').look, /^Orc, 20:/);
    assert.equal(by('torka').fields.People, 'Orc, 20');
    assert.deepEqual(Object.fromEntries(cast().map(person => [person.id, person.fields['Soul Class']])),
        { temiwa: 'I', ysmeth: 'III', nysseth: 'IV', rika: 'II', harrak: 'V', torka: 'II', lothar: 'III', gorm: 'II', nerissa: 'II', hush: 'III', asphodel: 'III', barney: 'II' });
});

// Words that are only in a person's secrets: none may be in what the reader or the narrator is told before they unlock.
const LOCKED = {
    temiwa: ['severa', 'slaver', 'reliquary', 'last rite', 'cloister'],
    ysmeth: ['durvald', 'fault', 'unlocked', 'barney', 'half-sibling'],
    nysseth: ['executor', 'hand of oblivion', 'contract', 'married', 'barney'],
    rika: ['somner', 'expedition', 'forty', 'tide', 'porter', 'leyline', 'deaths'],
    harrak: ['gate of battle cry', 'banish', 'war-brother', 'daughter', 'dying'],
    torka: ['blood-price', 'bone token', 'impostor', 'self-given'],
    lothar: ['forgery', 'necromancy', 'lovers', 'in love', 'died last winter'],
    gorm: ['citizen', 'forged', 'tremor', 'sealed order'],
    nerissa: ['betroth', 'nightingale', 'tide-archon', 'arranged', 'asphodel'],
    hush: ['lamp-thief', 'unmaking', 'grandmother', 'hundred years', 'seventy'],
    asphodel: ['hand-sized', 'borrowed', 'wilts', 'buried', 'betray'],
    barney: ['rigged', 'on purpose', 'debt-collector', 'penance', 'fever-house', 'ysmeth'],
};

test('what a secret says is not in the lines that are told from the start (about, look, voice, personality, history, goal, routine)', () => {
    assert.deepEqual(Object.keys(LOCKED), IDS);
    for (const person of cast()) {
        const told = [person.about, person.look, person.voice, person.personality, person.history, person.start.goal, person.start.routine].join(' ').toLowerCase();
        for (const word of LOCKED[person.id]) assert.equal(told.includes(word), false, `${person.id}: "${word}" is a secret`);
    }
});

test('the portraits: one WebP per person, a long side of at most 600 pixels, at most 62 KB (the import takes 64)', () => {
    const named = new Set(cast().map(person => person.portrait));
    assert.equal(named.size, 12);
    for (const name of named) {
        const bytes = portraitBytes(name);
        assert.equal(sniffImage(bytes), 'webp', name);
        assert.ok(bytes.length <= 62 * 1024 && bytes.length <= PORTRAIT_LIMITS.bytes, `${name}: ${bytes.length} bytes`);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const kind = String.fromCharCode(...bytes.slice(12, 16));
        let width; let height;
        if (kind === 'VP8 ') { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
        else if (kind === 'VP8X') { width = 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16); height = 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16); }
        else assert.fail(`${name}: unexpected WebP chunk ${kind}`);
        assert.ok(Math.max(width, height) <= 600 && Math.max(width, height) >= 400, `${name}: ${width}x${height}`);
    }
});

test('pack.json stays under 512 KB, and the pack with its twelve portraits is one zip the importer reads whole', async () => {
    assert.ok(Buffer.byteLength(packText) <= 512 * 1024, `pack.json is ${Buffer.byteLength(packText)} bytes`);
    const files = readdirSync(new URL('portraits/', folder)).sort();
    const bytes = zip([
        { name: 'pack.json', bytes: Buffer.from(packText) },
        { name: 'portraits/', bytes: new Uint8Array(0) },
        ...files.map(name => ({ name: `portraits/${name}`, bytes: portraitBytes(name), method: 'store' })),
    ]);
    assert.ok(bytes.length <= ZIP_LIMITS.archive);
    assert.ok(files.length + 2 <= ZIP_LIMITS.entries);
    const read = await readPackZip(bytes);
    assert.equal(read.ok, true, read.message);
    assert.equal(read.files.length, 12);
    assert.deepEqual(read.files.map(file => file.name).sort(), files);
    for (const file of read.files) assert.deepEqual(await file.read(), portraitBytes(file.name));
    assert.ok(statSync(new URL('portraits/', folder)).isDirectory());

    // Installed with the zip's pictures, every one is stored and the pack lists twelve people.
    const portraitFiles = fakeFiles();
    const made = createPacksPart({ settings: fakeSettings(), portraitFiles });
    const result = await made.packs.install(read.text, { source: 'file', origin: 'ersveil.zip', files: read.files });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.portraits.stored.length, 12);
    assert.deepEqual(result.portraits.refused, []);
    assert.equal(portraitFiles.files.size, 12);
    assert.equal(made.packs.list()[0].counts.cast, 12);
    assert.ok(made.part.queries['packs.portrait']({}, { pack: 'ersveil', file: 'hush.webp' }), 'a portrait is found by pack and file');
});
