// What a card carries besides its pack: the `[storysuite:portraits]` and `[storysuite:settings]` entries (lorebook.js tags, card.js formats and limits).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findPackEntries, findPortraitEntries, findSettingsEntries, isPortraitsTitle, isSettingsTitle } from '../../../src/v2/packs/lorebook.js';
import { CARD_LIMITS, CARD_SETTING_KEYS, portraitsPackOf, readPortraitsEntry, readSettingsEntry } from '../../../src/v2/packs/card.js';
import { gif, png, webp, jpg } from './helpers/portraits.js';
import { cardPack, dataUri } from './helpers/card.js';

const pack = cardPack({ portraits: ['fenna.webp', 'sera.png', 'tam.jpg'] });
const entry = files => JSON.stringify({ v: 1, pack: pack.id, version: pack.version, files });

test('the two new tags are found beside the pack tag, in any case and spacing, plain or in a json fence', () => {
    const entries = [
        { book: 'b', uid: 1, title: 'Pack [storysuite:pack]', content: '{}' },
        { book: 'b', uid: 2, title: 'x [ StorySuite : Portraits ]', content: '```json\n{"v":1}\n```' },
        { book: 'b', uid: 3, title: '[storysuite:settings] recommended', content: '{"v":1}' },
        { book: 'b', uid: 4, title: 'Ordinary lore', content: 'nothing' },
    ];
    assert.equal(isPortraitsTitle(entries[1].title), true);
    assert.equal(isSettingsTitle(entries[2].title), true);
    assert.equal(isPortraitsTitle(entries[0].title), false);
    assert.deepEqual(findPackEntries(entries).map(item => item.origin), ['lorebook:b#1']);
    assert.deepEqual(findPortraitEntries(entries), [{ origin: 'lorebook:b#2', title: 'x', text: '{"v":1}' }]);
    assert.deepEqual(findSettingsEntries(entries), [{ origin: 'lorebook:b#3', title: 'recommended', text: '{"v":1}' }]);
});

test('a good portraits entry gives zip-import style files, webp, png and jpeg alike', async () => {
    const got = readPortraitsEntry(entry({ 'fenna.webp': dataUri(webp(300)), 'sera.png': dataUri(png(300), 'png'), 'tam.jpg': dataUri(jpg(300), 'jpeg') }), pack);
    assert.equal(got.ok, true);
    assert.deepEqual(got.lines, []);
    assert.deepEqual(got.files.map(file => [file.name, file.size]), [['fenna.webp', 300], ['sera.png', 300], ['tam.jpg', 300]]);
    assert.deepEqual(await got.files[0].read(), webp(300));
    assert.equal(portraitsPackOf(entry({})), 'sealcrown');
    assert.equal(portraitsPackOf('nope'), null);
});

test('a portraits entry is refused whole when it is not JSON, not v 1, for another pack or version, or has no files', () => {
    const lines = text => readPortraitsEntry(text, pack);
    for (const text of ['not json', JSON.stringify({ v: 2, pack: pack.id, version: pack.version, files: {} }), JSON.stringify({ v: 1, pack: 'other', version: pack.version, files: {} }),
        JSON.stringify({ v: 1, pack: pack.id, version: '9.9.9', files: {} }), JSON.stringify({ v: 1, pack: pack.id, version: pack.version })]) {
        const got = lines(text);
        assert.equal(got.ok, false, text);
        assert.equal(got.lines.length, 1, 'one line');
        assert.match(got.lines[0], /^Card portraits for sealcrown were not used: /);
    }
});

test('limits: at most 24 files, 200 KB each, 3 MB together; a file over its limit is skipped with a line, too many or too much refuses the entry', () => {
    const many = Object.fromEntries(Array.from({ length: CARD_LIMITS.files + 1 }, (_, i) => [`p${i}.webp`, dataUri(webp(50))]));
    const big = readPortraitsEntry(entry(many), { ...pack, content: { cast: Object.keys(many).map(name => ({ portrait: name })) } });
    assert.equal(big.ok, false);
    assert.match(big.lines[0], /there are 25 pictures; at most 24/);
    const one = readPortraitsEntry(entry({ 'fenna.webp': dataUri(webp(CARD_LIMITS.fileBytes + 1)), 'sera.png': dataUri(png(500), 'png') }), pack);
    assert.equal(one.ok, true);
    assert.deepEqual(one.files.map(file => file.name), ['sera.png']);
    assert.match(one.lines[0], /^Card portrait fenna\.webp skipped: it is 200 KB; at most 200 KB/);
    const exact = readPortraitsEntry(entry({ 'fenna.webp': dataUri(webp(CARD_LIMITS.fileBytes)) }), pack);
    assert.equal(exact.files.length, 1, '200 KB exactly is allowed');
    const names = Array.from({ length: 16 }, (_, i) => `q${i}.webp`);
    const total = readPortraitsEntry(entry(Object.fromEntries(names.map((name, i) => [name, dataUri(webp(CARD_LIMITS.fileBytes - 1000, i))]))), { ...pack, content: { cast: names.map(name => ({ portrait: name })) } });
    assert.equal(total.ok, false);
    assert.match(total.lines[0], /more than 3072 KB together/);
});

test('every name must be a portrait the pack\'s cast names, and every file a real picture of the type its address says; others are skipped with a line', () => {
    const got = readPortraitsEntry(entry({
        'stranger.webp': dataUri(webp(100)),               // no cast member names it
        'fenna.webp': dataUri(gif(100)),                    // bytes are a gif
        'sera.png': dataUri(webp(100), 'png'),              // bytes are not the type claimed
        'tam.jpg': 'https://example.com/tam.jpg',           // not a data: address
    }), pack);
    assert.equal(got.ok, true);
    assert.deepEqual(got.files, []);
    assert.equal(got.lines.length, 4);
    assert.match(got.lines[0], /stranger\.webp skipped: no cast member of the pack names that file/);
    assert.match(got.lines[1], /fenna\.webp skipped: its bytes are not a webp, png or jpeg/);
    assert.match(got.lines[2], /sera\.png skipped: its bytes are not the type its address says/);
    assert.match(got.lines[3], /tam\.jpg skipped: it is not a base64 data: address/);
});

test('the settings entry keeps the allow-listed keys and skips the rest with a line; a bad entry is refused', () => {
    assert.deepEqual(CARD_SETTING_KEYS, ['story-block.rpg', 'story-block.gear', 'story-block.rpgXpRate', 'npc-state-delta.portraitPromptFormat', 'npc-state-delta.scanEvery']);
    const got = readSettingsEntry(JSON.stringify({ v: 1, settings: { 'story-block.rpg': true, 'story-block.tailBudget': 9999, 'other.thing': 1, 'npc-state-delta.scanEvery': 5 } }));
    assert.equal(got.ok, true);
    assert.deepEqual(got.values, { 'story-block.rpg': true, 'npc-state-delta.scanEvery': 5 });
    assert.equal(got.lines.length, 2);
    assert.match(got.lines[0], /story-block\.tailBudget skipped: it is not one a card may recommend/);
    for (const bad of ['nope', '{"v":2,"settings":{}}', '{"v":1}', '[]']) assert.equal(readSettingsEntry(bad).ok, false, bad);
});
