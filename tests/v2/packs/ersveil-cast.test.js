// The Ersveil pack's twelve cast members (examples/packs/ersveil, 2.9.1): they pass the cast check whole, stay inside every limit,
// start at places the pack names, carry their portraits (WebP, small), keep their secrets out of the lines the reader sees, and
// come in as one zip that the importer reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { checkCast } from '../../../src/v2/packs/cast.js';
import { CAST_BEHAVIOUR_LEVELS, CAST_BEHAVIOUR_LEVERS, CAST_LIMITS, METER_LIMITS, PORTRAIT_LIMITS, ZIP_LIMITS } from '../../../src/v2/packs/limits.js';
import { readPackZip } from '../../../src/v2/packs/bundle.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { fakeFiles } from './helpers/portraits.js';
import { sniffImage } from '../../../src/v2/packs/portraits.js';
import { zip } from './helpers/zip.js';
import { defaultFlags, healingSkill } from '../../../src/v2/lean-rpg/board/flags.js';

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
    const checked = checkCast(cast(), 'ersveil', (code, path, message) => problems.push(`${code} ${path} ${message}`), validatePack(JSON.parse(packText)).pack.content.items);
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
        for (const field of ['about', 'look', 'wears', 'voice', 'personality', 'withYou', 'history']) assert.ok(person[field] === undefined || chars(person[field]) <= CAST_LIMITS[field], at(field));
        assert.ok(chars(person.start.place) <= CAST_LIMITS.place && chars(person.start.goal) <= CAST_LIMITS.goal && chars(person.start.routine) <= CAST_LIMITS.routine, at('start'));
        assert.ok(person.drawnTo.length >= 1 && person.drawnTo.length <= CAST_LIMITS.drawnTo, at('drawnTo'));
        assert.ok(Object.keys(person.fields).length <= CAST_LIMITS.fields && 'Level' in person.fields, at('fields'));
        assert.ok(person.secrets.length >= 5 && person.secrets.length <= CAST_LIMITS.secrets, at('secrets'));
        for (const secret of person.secrets) {
            assert.ok(chars(secret.text) <= CAST_LIMITS.secretText && chars(secret.title) <= CAST_LIMITS.secretTitle, `${at('secrets')}: ${secret.title}`);
            assert.ok(Object.hasOwn(secret, 'when') || Object.hasOwn(secret, 'meter'), `${secret.title}: a rule`);
            assert.equal(Object.hasOwn(secret, 'meter'), Object.hasOwn(secret, 'at'), `${secret.title}: meter with at`);
            if (secret.when) assert.ok(chars(secret.when) <= CAST_LIMITS.secretWhen, `${secret.title}: when`);
        }
        for (const stage of person.stages) assert.ok(chars(stage.name) <= METER_LIMITS.name && (!stage.milestone || chars(stage.milestone) <= METER_LIMITS.milestone), `${person.id}: ${stage.id}`);
        for (const text of [person.about, person.look, person.wears, person.voice, person.personality, ...(person.behaviour ?? []), ...(person.mannerisms ?? []), person.withYou ?? '', person.history, ...person.secrets.map(secret => secret.text)]) assert.doesNotMatch(text, /[<>{}|]/, person.id);
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
    assert.equal(mine.id, 'my-candle');
    assert.deepEqual([mine.name, mine.needs], ['My candle', [{ meter: 'affection', at: 75 }, { meter: 'desire', at: 50 }]]);
    // Everyone starts at 0 (USER 5 Nov): a relationship is built in play, never handed out at the first meeting.
    for (const person of cast()) {
        for (const meter of ['trust', 'affection', 'desire', 'tension']) {
            if (person.meters[meter] !== undefined) assert.equal(person.meters[meter], 0, `${person.id}: ${meter} starts at 0`);
        }
    }
});

test('the thirteen secrets that open by a meter or by an event, whichever comes first, carry both rules', () => {
    const both = cast().flatMap(person => person.secrets.filter(secret => secret.meter && secret.when).map(secret => `${person.id}:${secret.at}`));
    assert.deepEqual(both, ['temiwa:50', 'temiwa:90', 'rika:50', 'rika:90', 'harrak:50', 'harrak:90', 'torka:90', 'lothar:90', 'gorm:90', 'nerissa:90', 'hush:90', 'asphodel:90', 'barney:90']);
    for (const person of cast()) assert.ok(person.secrets.length <= CAST_LIMITS.secrets, person.id);
    assert.deepEqual(cast().map(person => person.secrets.length), [7, 8, 7, 8, 6, 6, 8, 6, 6, 6, 5, 5]);
});

test('the agreed fixes: Hush was freed about seventy years ago, Torka is 20, levels as the sheets set them', () => {
    const by = id => cast().find(person => person.id === id);
    const hush = by('hush').secrets.map(secret => secret.text).join(' ');
    assert.match(hush, /about seventy years ago/);
    assert.doesNotMatch(JSON.stringify(by('hush')), /a century ago/);
    assert.match(by('torka').look, /^Orc, about 190 cm:/);
    assert.equal(by('torka').fields.People, 'Orc, 20');
    assert.deepEqual(Object.fromEntries(cast().map(person => [person.id, person.fields.Level])),
        { temiwa: '4', ysmeth: '36', nysseth: '44', rika: '8', harrak: '56', torka: '6', lothar: '32', gorm: '22', nerissa: '24', hush: '48', asphodel: '30', barney: '14' });
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

test('what a secret says is not in the lines that are told from the start (about, look, wears, voice, personality, history, goal, routine)', () => {
    assert.deepEqual(Object.keys(LOCKED), IDS);
    for (const person of cast()) {
        const told = [person.about, person.look, person.wears, person.voice, person.personality, ...(person.behaviour ?? []), ...(person.mannerisms ?? []), person.withYou ?? '', person.history, person.start.goal, person.start.routine].join(' ').toLowerCase();
        for (const word of LOCKED[person.id]) assert.equal(told.includes(word), false, `${person.id}: "${word}" is a secret`);
    }
});

// `look` is the body; `wears` is what they usually wear and carry (USER 5 Nov). The words below name clothing and gear, so none may
// stay in a look. Checked by hand against the twelve: the only hit is Nysseth's "collar", in "a pale ring of scar around her throat
// where her collar was", which is the scar (a body mark), so it is allowed for her alone.
const CLOTHING = /\b(habit|robes?|coats?|cloaks?|armou?r|mail|boots?|sash|ribbons?|pendants?|censer|belts?|belted|veils?|hoods?|hooded|gloves|aprons?|tunics?|dress|scarf|jackets?|collars?|waistcoats?|skirts?|shirts?|blouse|corset|trousers|hats?|plate|earrings?|bracelets?|brooch|pouch|satchel|cutlass|hammer|axe|maul|knives|knife|spectacles)\b/i;
const BODY_WORDS_ALLOWED = { nysseth: ['collar'] };

test('every one of the twelve has a look (the body) and a wears (clothes and gear); no clothing word is left in a look', () => {
    for (const person of cast()) {
        assert.ok(typeof person.look === 'string' && person.look.length > 0, `${person.id}: look`);
        assert.ok(typeof person.wears === 'string' && person.wears.length > 0, `${person.id}: wears`);
        const hit = person.look.match(new RegExp(CLOTHING.source, 'gi'))?.filter(word => !(BODY_WORDS_ALLOWED[person.id] ?? []).includes(word.toLowerCase())) ?? [];
        assert.deepEqual(hit, [], `${person.id}: clothing words left in look`);
        assert.match(person.wears, CLOTHING, `${person.id}: wears names something worn or carried`);
    }
    // Round 2: scene backdrops (banners, a fort, a ship's deck, a harbour, maps "behind her") are portrait staging, in neither field; a manner
    // ("a seductive air") was personality; the owner's final Temiwa (10 Nov) lists it in her look, so her look has it and her personality still
    // says she does not mean it, inside its limit.
    for (const person of cast()) for (const text of [person.look, person.wears]) assert.doesNotMatch(text, /\bbehind (him|her|them)\b/i, person.id);
    const temiwa = cast().find(person => person.id === 'temiwa');
    assert.doesNotMatch(temiwa.look, /seductive/);
    assert.match(temiwa.personality, /Chaste and innocent in love/);
    assert.ok(chars(temiwa.personality) <= CAST_LIMITS.personality);
    assert.match(cast().find(person => person.id === 'nysseth').look, /scar around her throat where her collar was/);
    // Every cast key passes through the normalizer with wears kept (the pack checker keeps it in the entry).
    const checked = checkCast(cast(), 'ersveil', () => {}, validatePack(JSON.parse(packText)).pack.content.items);
    for (const person of checked) assert.equal(person.wears, cast().find(raw => raw.id === person.id).wears, person.id);
});

test('the portraits: one WebP per person, a long side of 1200 pixels at most, at most 150 KB (the import takes 150)', () => {
    const named = new Set(cast().map(person => person.portrait));
    assert.equal(named.size, 12);
    for (const name of named) {
        const bytes = portraitBytes(name);
        assert.equal(sniffImage(bytes), 'webp', name);
        assert.ok(bytes.length <= PORTRAIT_LIMITS.bytes, `${name}: ${bytes.length} bytes`);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const kind = String.fromCharCode(...bytes.slice(12, 16));
        let width; let height;
        if (kind === 'VP8 ') { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
        else if (kind === 'VP8X') { width = 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16); height = 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16); }
        else assert.fail(`${name}: unexpected WebP chunk ${kind}`);
        assert.ok(Math.max(width, height) <= PORTRAIT_LIMITS.side && Math.max(width, height) >= 1000, `${name}: ${width}x${height}`);
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

// The characters of each personality before it was split (the 12 of Story Block main, 5 Nov): each is now shorter, and what was in it went to
// behaviour (how they respond), mannerisms (habits) and withYou (anything about the player character).
const PERSONALITY_BEFORE = { temiwa: 600, ysmeth: 555, nysseth: 501, rika: 508, harrak: 480, torka: 579, lothar: 371, gorm: 450, nerissa: 518, hush: 340, asphodel: 445, barney: 430 };

test('every one of the twelve has its personality split: shorter than before, within 600, the player character only in withYou, levers valid', () => {
    assert.deepEqual(Object.keys(PERSONALITY_BEFORE), IDS);
    const you = /\b(you|your|yours|yourself|player)\b/i;
    for (const person of cast()) {
        assert.ok(chars(person.personality) <= CAST_LIMITS.personality && chars(person.personality) < PERSONALITY_BEFORE[person.id], `${person.id}: personality shorter`);
        assert.doesNotMatch(person.personality, you, `${person.id}: personality has no you/your`);
        assert.ok(Array.isArray(person.behaviour) && person.behaviour.length >= 1 && person.behaviour.length <= CAST_LIMITS.behaviour, `${person.id}: behaviour`);
        const seen = new Set();
        for (const line of person.behaviour) {
            const match = /^(\w+): (low|medium|high) - (.+)$/.exec(line);
            assert.ok(match, `${person.id}: "${line}" reads Lever: level - effect`);
            assert.ok(CAST_BEHAVIOUR_LEVERS.includes(match[1]) && CAST_BEHAVIOUR_LEVELS.includes(match[2]), `${person.id}: ${line}`);
            assert.ok(chars(match[3]) <= CAST_LIMITS.behaviourEffect, `${person.id}: ${line}`);
            assert.doesNotMatch(match[3], you, `${person.id}: behaviour is not toward the player (${line})`);
            assert.equal(seen.has(match[1]), false, `${person.id}: ${match[1]} once`);
            seen.add(match[1]);
        }
        assert.ok(person.mannerisms.length >= 1 && person.mannerisms.length <= CAST_LIMITS.mannerisms, `${person.id}: mannerisms`);
        for (const habit of person.mannerisms) assert.ok(chars(habit) <= CAST_LIMITS.mannerism, `${person.id}: ${habit}`);
        if (person.withYou !== undefined) assert.ok(chars(person.withYou) <= CAST_LIMITS.withYou, `${person.id}: withYou`);
    }
    // Who has something about the player character: the eight whose text named "you" or the player before.
    assert.deepEqual(cast().filter(person => person.withYou).map(person => person.id), ['temiwa', 'ysmeth', 'nysseth', 'harrak', 'torka', 'lothar', 'nerissa', 'asphodel']);
    // The checker keeps all three, in the form the pack wrote.
    const checked = checkCast(cast(), 'ersveil', () => {}, validatePack(JSON.parse(packText)).pack.content.items);
    for (const person of checked) {
        const raw = cast().find(entry => entry.id === person.id);
        assert.deepEqual([person.behaviour, person.mannerisms, person.withYou], [raw.behaviour, raw.mannerisms, raw.withYou], person.id);
    }
    // Temiwa, Shiba Inu dogfolk (owner, 10 Nov): soft and weary, no cruelty anywhere, no fox words anywhere in her text.
    const temiwa = cast().find(person => person.id === 'temiwa');
    assert.ok(temiwa.behaviour.some(line => line.startsWith('Mercy: high')));
    assert.equal(temiwa.mannerisms.some(line => /pain|cruel|sadis/i.test(line)), false);
    assert.doesNotMatch(JSON.stringify(temiwa), /\b(fox|foxes|vixen|russet|sadis\w*|cruel\w*|yandere|possessive)\b/i);
    assert.doesNotMatch(JSON.stringify(cast().find(person => person.id === 'torka')), /sadis/i);
    assert.match(temiwa.look, /^Dogfolk woman, about 160 cm\. Black dog ears with cream points.*waterfall/);
    assert.equal(temiwa.fields.People, 'Dogfolk woman, 21');
    assert.match(temiwa.wears, /Dark stockings with garters beneath, a buckled leather belt, a brass censer on chains\. Tail bound in a grey Church sash\./);
    assert.match(temiwa.personality, /^Dandere/);
    assert.deepEqual(temiwa.stages.map(stage => stage.name), ['Tolerates you', 'Talks while she stitches', 'Burns a candle for you', 'My candle']);
    assert.match(temiwa.secrets.find(secret => secret.title === 'Her reliquary').text, /first bandage she ever wound for you/);
    // Nerissa is deredere and Nysseth yandere (owner, 10 Nov), each still keeping what made them.
    assert.match(cast().find(person => person.id === 'nerissa').personality, /Deredere.*prankster.*homesick/s);
    const nysseth = cast().find(person => person.id === 'nysseth');
    assert.match(nysseth.personality, /Yandere.*soft, patient and sweet.*Durvald Seamrune/s);
});

// The owner's list (10 Nov): name, stat, uses, rank, type of each member's two skills, in order.
const SKILLS = {
    temiwa: [['Mending Prayer', 'int', 'mana', 'novice', 'combat'], ['Gentle Word', 'cha', 'stamina', 'novice', 'utility']],
    ysmeth: [['Lockwork', 'dex', 'stamina', 'expert', 'utility'], ['Binding Rune', 'int', 'mana', 'expert', 'combat']],
    nysseth: [["Grinder's Knives", 'dex', 'stamina', 'expert', 'combat'], ['Chain Cell Craft', 'int', 'stamina', 'expert', 'utility']],
    rika: [['Raw Bolt', 'int', 'mana', 'adept', 'combat'], ['Wild Surge', 'int', 'stamina', 'novice', 'combat']],
    harrak: [['Long Watch Cleave', 'str', 'stamina', 'expert', 'combat'], ['Hold the Line', 'vit', 'stamina', 'master', 'combat']],
    torka: [['Berserker Rush', 'str', 'stamina', 'novice', 'combat'], ['Maul Swing', 'str', 'stamina', 'novice', 'combat']],
    lothar: [['Iron Guard Cut', 'dex', 'stamina', 'expert', 'combat'], ['Shield of the Princess', 'vit', 'stamina', 'adept', 'combat']],
    gorm: [['Hammer Rune', 'str', 'stamina', 'adept', 'combat'], ['Toast and Tell', 'cha', 'stamina', 'adept', 'utility']],
    nerissa: [["Pilot's Hand", 'dex', 'stamina', 'adept', 'utility'], ['Harpoon Dive', 'agi', 'stamina', 'adept', 'combat']],
    hush: [['Silver Rain Veil', 'int', 'mana', 'expert', 'utility'], ["Mother's Hand", 'vit', 'stamina', 'adept', 'utility']],
    asphodel: [['Flower-Speech', 'int', 'mana', 'adept', 'utility'], ['Quiet Step', 'agi', 'stamina', 'adept', 'utility']],
    barney: [['Silver Patter', 'cha', 'stamina', 'adept', 'utility'], ['Dirty Trick', 'dex', 'stamina', 'adept', 'combat']],
};

test('every member has exactly the two skills (type and rank too) the owner listed; Mending Prayer heals and Wild Surge hits every foe on the fight board', () => {
    assert.deepEqual(Object.keys(SKILLS), IDS);
    for (const person of cast()) assert.deepEqual(person.skills.map(skill => [skill.name, skill.stat, skill.uses, skill.rank, skill.type]), SKILLS[person.id], person.id);
    const find = (id, name) => cast().find(person => person.id === id).skills.find(skill => skill.name === name);
    assert.equal(healingSkill(find('temiwa', 'Mending Prayer')), true);
    assert.equal(defaultFlags(find('rika', 'Wild Surge')).area, true);
    for (const person of cast()) for (const skill of person.skills) {
        if (skill.name !== 'Mending Prayer') assert.equal(healingSkill(skill) && person.id !== 'hush', false, `${person.id}: ${skill.name} is not a heal`);
        if (skill.name !== 'Wild Surge' && !['Long Watch Cleave'].includes(skill.name)) assert.equal(defaultFlags(skill).area, false, `${person.id}: ${skill.name} is not an area skill`);
    }
});
