// A saved character (src/v2/lean-rpg/charfile.js): the file Export writes and the wizard's Import reads. The shape, the round trip, what a file
// may hold (the RPG's own limits), every refusal in plain words, and what the draft takes from a good file (wizard-data.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAR_FILE, FILE_LIMITS, buildCharacterFile, fileNameOf, fileText, itemLine, itemsForFile, parseCharacterFile, skillLine, thingsWord } from '../../../src/v2/lean-rpg/charfile.js';
import { CREATION, STATS } from '../../../src/v2/lean-rpg/index.js';
import { buildDefinitions, newDraft, pointsLeft, readDraft, startStats, statBounds, withImport, withoutImport, withSkillPatch, adeptCount } from '../../../src/v2/lean-rpg/view/wizard-data.js';

const STAT_VALUES = { str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10 };
const SKILLS = [
    { name: 'Iron Breath', about: 'Steadies the lungs in a long fight.', stat: 'vit', uses: 'stamina', rank: 2 },
    { name: 'Spark', about: 'A small burst of light.', stat: 'int', uses: 'mana', rank: 0 },
];
const ITEMS = [
    { name: 'Bedroll', qty: 1 },
    { name: 'Oilskin Coat', qty: 1, note: 'waxed, a little too big', kind: 'equipment', rarity: 'uncommon' },
    { name: 'Torch', qty: 2 },
];
const sample = (extra = {}) => ({ soul: 2, points: 3, stats: STAT_VALUES, skills: SKILLS, ...extra });
const write = file => fileText(buildCharacterFile(file));
const good = file => { const read = parseCharacterFile(write(file)); assert.equal(read.ok, true, read.message); return read.file; };
const refused = (data, pattern) => {
    const read = parseCharacterFile(typeof data === 'string' ? data : JSON.stringify(data));
    assert.equal(read.ok, false, `refused: ${JSON.stringify(data)?.slice(0, 80)}`);
    assert.match(read.message, pattern);
    assert.deepEqual(Object.keys(read).sort(), ['message', 'ok'], 'a refusal carries a message and nothing else');
    return read.message;
};
const base = () => JSON.parse(write(sample({ items: ITEMS, money: 50 })));

test('the file: the marker first, the character, and the things and money only when they are given', () => {
    const plain = buildCharacterFile(sample());
    assert.deepEqual(Object.keys(plain), [CHAR_FILE, 'soul', 'points', 'stats', 'skills']);
    assert.equal(plain[CHAR_FILE], 1);
    assert.deepEqual(Object.keys(plain.stats), [...STATS]);
    const full = buildCharacterFile(sample({ items: ITEMS, money: 50 }));
    assert.deepEqual(Object.keys(full), [CHAR_FILE, 'soul', 'points', 'stats', 'skills', 'items', 'money']);
    assert.deepEqual(full.items[1], { name: 'Oilskin Coat', qty: 1, note: 'waxed, a little too big', kind: 'equipment', rarity: 'uncommon' });
    assert.deepEqual(full.items[0], { name: 'Bedroll', qty: 1 }, 'no empty note, kind or rarity written');
    assert.equal(buildCharacterFile(sample({ items: [], money: 0 })).money, 0, 'a purse of 0 is still a purse when it is asked for');
    assert.equal(fileText(plain).endsWith('\n'), true);
});

test('the file keeps no name, no "who they are", no XP, no health, no practice and nothing about the story', () => {
    const text = write(sample({ items: ITEMS, money: 50 }));
    const data = JSON.parse(text);
    assert.deepEqual(Object.keys(data), [CHAR_FILE, 'soul', 'points', 'stats', 'skills', 'items', 'money']);
    for (const key of ['name', 'who', 'about', 'xp', 'health', 'mana', 'stamina', 'practice', 'kind', 'left', 'alive', 'story']) assert.equal(Object.hasOwn(data, key), false, key);
    for (const skill of data.skills) assert.deepEqual(Object.keys(skill), ['name', 'about', 'stat', 'uses', 'rank'], 'no practice');
});

test('the round trip: what is written is what is read, with the things and money exactly as left on', () => {
    const file = good(sample({ items: ITEMS, money: 50 }));
    assert.deepEqual(file, { soul: 2, points: 3, stats: STAT_VALUES, skills: SKILLS, items: ITEMS, money: 50 });
    const bare = good(sample());
    assert.deepEqual(Object.keys(bare), ['soul', 'points', 'stats', 'skills'], 'a file without them reads without them');
    assert.deepEqual(good(sample({ skills: [] })).skills, []);
    // Reading it again from its own text changes nothing.
    assert.equal(write(file), write(good(file)));
});

test('the limits are the RPG\'s own: Soul Class 1 to 9, points 0 to 60, stats 1 to 20, five skills, the fields\' lengths', () => {
    const edge = good({ soul: 9, points: 60, stats: Object.fromEntries(STATS.map(stat => [stat, 20])), skills: Array.from({ length: 5 }, (_, n) => ({ name: `S${n}`, about: 'a', stat: 'cha', uses: 'mana', rank: 3 })) });
    assert.deepEqual([edge.soul, edge.points, edge.stats.str, edge.skills.length, edge.skills[4].rank], [9, 60, 20, 5, 3]);
    const low = good({ soul: 1, points: 0, stats: Object.fromEntries(STATS.map(stat => [stat, 1])), skills: [] });
    assert.deepEqual([low.soul, low.points, low.stats.cha], [1, 0, 1]);
    // Text is one line, cut at the Skills fields' lengths (by whole characters), and control characters go.
    const long = good(sample({ skills: [{ name: `  ${'N'.repeat(60)}\n`, about: `${'a b '.repeat(60)}`, stat: 'str', uses: 'stamina', rank: 0 }] }));
    assert.equal([...long.skills[0].name].length, CREATION.skillName);
    assert.ok([...long.skills[0].about].length <= CREATION.skillAbout);
    assert.doesNotMatch(long.skills[0].about, /\n/);
    const emoji = good(sample({ skills: [{ name: '😀'.repeat(50), about: 'x', stat: 'str', uses: 'stamina', rank: 0 }] }));
    assert.equal([...emoji.skills[0].name].length, 40, 'cut by code points, never inside one');
    const things = good(sample({ items: [{ name: 'X'.repeat(80), qty: 999, note: 'n'.repeat(400) }] })).items[0];
    assert.deepEqual([[...things.name].length, things.qty, [...things.note].length], [60, 999, 300]);
    assert.equal(good(sample({ money: FILE_LIMITS.money })).money, 1_000_000_000);
});

test('unknown keys are ignored, not kept: a file cannot carry more than the character, its things and its purse', () => {
    const data = base();
    Object.assign(data, { name: 'Mallory', who: 'A dragon.', xp: 99, health: 0, evil: { deep: true }, __proto__: { polluted: true }, 'constructor': 'x' });
    data.stats.extra = 99;
    data.skills[0].practice = 77;
    data.skills[0].extra = 'x';
    data.items[0].owner = 'ac_12345678';
    data.items[0].value = 99999;
    const read = parseCharacterFile(JSON.stringify(data));
    assert.equal(read.ok, true);
    assert.deepEqual(Object.keys(read.file), ['soul', 'points', 'stats', 'skills', 'items', 'money']);
    assert.deepEqual(Object.keys(read.file.stats), [...STATS]);
    assert.deepEqual(Object.keys(read.file.skills[0]), ['name', 'about', 'stat', 'uses', 'rank']);
    assert.deepEqual(Object.keys(read.file.items[0]), ['name', 'qty']);
    assert.equal({}.polluted, undefined);
    // A kind or rarity this build does not know is left out; the thing itself is kept.
    const odd = parseCharacterFile(JSON.stringify({ ...base(), items: [{ name: 'Orb', qty: 1, kind: 'relic', rarity: 'mythic' }] }));
    assert.deepEqual(odd.file.items, [{ name: 'Orb', qty: 1 }]);
});

test('a bad file is a plain error and nothing else, and reading never throws', () => {
    refused('', /empty/);
    refused('   \n', /empty/);
    refused('{ not json', /not a saved character/);
    refused('[1, 2]', /not a saved character file/);
    refused('"text"', /not a saved character file/);
    refused('null', /not a saved character file/);
    refused({ soul: 2 }, /not a saved character file/);
    refused({ ...base(), [CHAR_FILE]: 2 }, /newer version/);
    refused({ ...base(), [CHAR_FILE]: '1' }, /newer version/);
    refused({ ...base(), soul: 0 }, /Soul Class/);
    refused({ ...base(), soul: 10 }, /Soul Class/);
    refused({ ...base(), soul: 2.5 }, /Soul Class/);
    refused({ ...base(), points: -1 }, /unspent points \(0 to 60\)/);
    refused({ ...base(), points: 61 }, /unspent points/);
    refused({ ...base(), points: '3' }, /unspent points/);
    refused({ ...base(), stats: null }, /all seven stats/);
    refused({ ...base(), stats: [] }, /all seven stats/);
    for (const stat of STATS) {
        refused({ ...base(), stats: { ...STAT_VALUES, [stat]: 21 } }, new RegExp(`no valid ${stat.toUpperCase()} \\(1 to 20\\)`));
        refused({ ...base(), stats: { ...STAT_VALUES, [stat]: 0 } }, new RegExp(stat.toUpperCase()));
    }
    const { dex: _dex, ...lacking } = STAT_VALUES;
    refused({ ...base(), stats: lacking }, /DEX/);
    refused({ ...base(), skills: 'many' }, /at most 5/);
    refused({ ...base(), skills: Array.from({ length: 6 }, () => SKILLS[0]) }, /at most 5/);
    refused({ ...base(), skills: [SKILLS[0], { ...SKILLS[1], rank: 4 }] }, /Skill 2 in the file is not valid/);
    refused({ ...base(), skills: [{ ...SKILLS[0], stat: 'hp' }] }, /Skill 1/);
    refused({ ...base(), skills: [{ ...SKILLS[0], uses: 'rage' }] }, /Skill 1/);
    refused({ ...base(), skills: [{ ...SKILLS[0], name: '   ' }] }, /Skill 1/);
    refused({ ...base(), skills: [null] }, /Skill 1/);
    refused({ ...base(), skills: [{ ...SKILLS[0], rank: 1.5 }] }, /Skill 1/);
    refused({ ...base(), items: 'a bedroll' }, /at most 60/);
    refused({ ...base(), items: Array.from({ length: 61 }, () => ITEMS[0]) }, /at most 60/);
    refused({ ...base(), items: [ITEMS[0], { name: 'Rope', qty: 0 }] }, /Thing 2 in the file is not valid/);
    refused({ ...base(), items: [{ name: 'Rope', qty: 1000 }] }, /Thing 1/);
    refused({ ...base(), items: [{ name: '', qty: 1 }] }, /Thing 1/);
    refused({ ...base(), items: [{ qty: 1 }] }, /Thing 1/);
    refused({ ...base(), money: -5 }, /money in the file is not a whole number from 0 to 1,000,000,000/);
    refused({ ...base(), money: 2.5 }, /money/);
    refused({ ...base(), money: '50' }, /money/);
    refused({ ...base(), money: 1_000_000_001 }, /money/);
    refused(`{"${CHAR_FILE}":1,"pad":"${'x'.repeat(FILE_LIMITS.bytes)}"}`, /too big/);
    for (const odd of [undefined, null, 5, {}, [], true]) assert.equal(parseCharacterFile(odd).ok, false);
});

test('the file name: the character\'s name, lower case, letters and digits, then .character.json', () => {
    assert.equal(fileNameOf('Wessel'), 'wessel.character.json');
    assert.equal(fileNameOf('  Ren the Younger!  '), 'ren-the-younger.character.json');
    assert.equal(fileNameOf('../../etc/passwd'), 'etc-passwd.character.json', 'no path comes out of a name');
    assert.equal(fileNameOf('!!!'), 'character.character.json');
    assert.equal(fileNameOf(''), 'character.character.json');
    assert.equal(fileNameOf('Åsa Müller'), 'åsa-müller.character.json');
    assert.ok([...fileNameOf('x'.repeat(100))].length <= 40 + '.character.json'.length);
});

test('the things a character carries as the file keeps them: counts added up per name, note, kind and rarity, at most 60, odd rows left out', () => {
    const rows = [
        { name: 'Torch', qty: 1, note: '', kind: 'goods', rarity: 'common' }, { name: 'torch', qty: 1, note: '', kind: 'goods', rarity: 'common' },
        { name: 'Torch', qty: 1, note: 'half burnt', kind: 'goods', rarity: 'common' }, { name: 'Sword', qty: 1, note: '', kind: 'equipment', rarity: 'rare' },
        { name: '', qty: 1 }, { name: 'Ghost', qty: 0 }, null, { name: 'Odd', qty: 1, kind: 'relic', rarity: 'mythic' },
    ];
    assert.deepEqual(itemsForFile(rows), [
        { name: 'Torch', qty: 2, kind: 'goods', rarity: 'common' }, { name: 'Torch', qty: 1, note: 'half burnt', kind: 'goods', rarity: 'common' },
        { name: 'Sword', qty: 1, kind: 'equipment', rarity: 'rare' }, { name: 'Odd', qty: 1 },
    ]);
    const many = Array.from({ length: 90 }, (_, n) => ({ name: `Thing ${n}`, qty: 1 }));
    assert.equal(itemsForFile(many).length, 60);
    assert.deepEqual(itemsForFile(null), []);
    assert.equal(itemsForFile([{ name: 'Coin', qty: 900 }, { name: 'Coin', qty: 900 }])[0].qty, 999, 'a count stays inside the file\'s limit');
    assert.equal(itemLine({ name: 'Torch', qty: 2 }), 'Torch ×2');
    assert.equal(itemLine({ name: 'Oilskin Coat', qty: 1, note: 'waxed' }), 'Oilskin Coat (waxed)');
    assert.equal(skillLine({ name: 'Iron Breath', rank: 2 }), 'Iron Breath (Expert)');
    assert.deepEqual([thingsWord(1), thingsWord(4)], ['1 thing', '4 things']);
});

// ---- what the draft takes from a good file -------------------------------------------------------------------------------------------

const typed = () => ({ ...newDraft({ persona: 'Wessel' }), name: 'Ren', kind: 'companion', about: 'A ferry hand from Low Quay.', stats: { ...newDraft().stats, str: 12 } });

test('an import fills the stats, the unspent points, the Soul Class and the skills with their ranks, and touches nothing else', () => {
    const before = typed();
    const { draft } = withImport(before, good(sample()));
    assert.deepEqual([draft.name, draft.kind, draft.about], ['Ren', 'companion', 'A ferry hand from Low Quay.'], 'name, You or companion and who they are stay');
    assert.deepEqual(draft.stats, STAT_VALUES);
    assert.equal(draft.soul, 2);
    assert.deepEqual(draft.from, { stats: STAT_VALUES, points: 3 });
    assert.deepEqual(draft.skills.map(skill => [skill.name, skill.stat, skill.uses, skill.rank]), [['Iron Breath', 'vit', 'stamina', 2], ['Spark', 'int', 'mana', 0]]);
    assert.equal(pointsLeft(draft), 3, 'the file\'s unspent points are what is left to spend');
    assert.deepEqual(Object.keys(draft).sort(), ['about', 'from', 'kind', 'name', 'set', 'skills', 'soul', 'stats'], 'no XP, health or anything else appears');
    assert.equal(withImport({ ...before, soul: 4 }, good(sample({ soul: 1 }))).draft.soul, undefined, 'Soul Class I is the start: no soul on the draft');
    assert.deepEqual(before, typed(), 'the draft that was given is not changed');
});

test('the usual rules still hold after an import: points are spent from the file\'s pool, a stat stays within 8 to 15 or where it came from, ranks do not move', () => {
    const file = good(sample({ stats: { ...STAT_VALUES, str: 18, cha: 3 } }));
    const { draft } = withImport(typed(), file);
    assert.deepEqual([statBounds(draft, 'str'), statBounds(draft, 'cha'), statBounds(draft, 'vit'), statBounds(newDraft(), 'vit')], [[8, 18], [3, 15], [8, 15], [8, 15]]);
    const spent = readDraft({ ...draft, stats: { ...draft.stats, vit: 15, dex: 8 } });
    assert.equal(pointsLeft(spent), 3 - 3 + 2, 'VIT +3 and DEX -2');
    const clamped = readDraft({ ...draft, stats: { ...draft.stats, str: 20, cha: 1 } });
    assert.deepEqual([clamped.stats.str, clamped.stats.cha], [18, 3], 'a hand-made draft is held to the bounds');
    assert.deepEqual(startStats(draft), file.stats, 'Reset goes back to the file\'s stats');
    assert.deepEqual(startStats(newDraft()), Object.fromEntries(STATS.map(stat => [stat, 10])));
    // A rank is the file's: it survives reading the draft, a skill edit, and is not the one Adept a new skill may have.
    const edited = withSkillPatch(draft, 0, { name: 'Iron Lung', about: 'Better wind.' });
    assert.deepEqual([edited.skills[0].name, edited.skills[0].rank], ['Iron Lung', 2]);
    assert.equal(readDraft(edited).skills[0].rank, 2);
    assert.equal(adeptCount(draft), 0, 'imported ranks are not the Adept start');
    assert.equal(readDraft({ ...draft, from: undefined }).skills[0].rank, undefined, 'without an import there is no rank to carry');
    assert.equal(readDraft({ ...draft, from: { stats: { str: 1 }, points: 3 } }).from, undefined, 'a half-made import record is dropped');
    assert.equal(readDraft({ ...draft, from: { stats: STAT_VALUES, points: 999 } }).from.points, 60);
});

test('Undo import puts back what was there before, and keeps what was typed since', () => {
    const before = typed();
    const made = withImport({ ...before, soul: 3, set: 'guild-fighter' }, good(sample()));
    const typedAfter = { ...made.draft, name: 'Ren Marsh', about: 'Changed.' };
    const back = withoutImport(typedAfter, made.before);
    assert.deepEqual([back.stats, back.soul, back.set, back.from, back.skills], [before.stats, 3, 'guild-fighter', undefined, []]);
    assert.deepEqual([back.name, back.about, back.kind], ['Ren Marsh', 'Changed.', 'companion']);
    assert.equal(withoutImport(withImport(before, good(sample())).draft, withImport(before, good(sample())).before).soul, undefined);
});

test('Create writes the file\'s ranks into the Skills block, its points and Soul Class into the Character block, and the name stays the reader\'s', () => {
    const { draft } = withImport({ ...typed(), name: 'Ren' }, good(sample()));
    const { character, skills } = buildDefinitions(readDraft(draft), { used: [] });
    const c = character.state, s = skills.state;
    assert.deepEqual([c.who.default, c.about.default, c.soul.default, c.points.default, c.xp.default, c.health.default, c.str.default, c.int.default], ['Ren', 'A ferry hand from Low Quay.', 2, 3, 0, 5, 14, 8]);
    assert.deepEqual([s.skill1.default, s.rank1.default, s.stat1.default, s.skill2.default, s.rank2.default, s.uses2.default, s.practice1.default, s.skill3.default, s.rank3.default], ['Iron Breath', 2, 'vit', 'Spark', 0, 'mana', 0, '', 0]);
    assert.equal(s.rank1.edit, false, 'rank is still a field only play moves');
    // Unspent points are what is left of the pool after the reader's changes.
    const spent = readDraft({ ...draft, stats: { ...draft.stats, str: 15, vit: 13 } });
    assert.equal(buildDefinitions(spent, { used: [] }).character.state.points.default, 1, 'STR +1 and VIT +1 out of 3');
});
