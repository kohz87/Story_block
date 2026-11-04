// st-adapter.js readCharacterLorebook: a card's embedded [storysuite:…] entries are read when its linked world lacks them or is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readCharacterLorebook, saveSettingsNow } from '../../../src/v2/packs/st-adapter.js';

const embedded = (...titles) => ({ name: 'Embedded', entries: titles.map((comment, id) => ({ id, comment, content: `${comment} body`, keys: ['k'] })) });
const world = (...titles) => ({ entries: Object.fromEntries(titles.map((comment, uid) => [uid, { uid, comment, content: `${comment} world`, key: ['k'] }])) });

async function read(t, { linked, book, load }) {
    const character = { name: 'Ilsa', avatar: 'ilsa.png', data: { extensions: { world: linked }, character_book: book } };
    const ctx = { characters: [character], characterId: 0, loadWorldInfo: load };
    globalThis.SillyTavern = { getContext: () => ctx };
    t.after(() => { delete globalThis.SillyTavern; });
    return readCharacterLorebook();
}
const titles = got => got.entries.map(entry => `${entry.book}:${entry.title}`);

test('a linked world with no storysuite tags and an embedded pack: the embedded pack is added after the world\'s own entries', async t => {
    const got = await read(t, { linked: 'World', book: embedded('Lore', 'Ersveil [storysuite:pack]'), load: async () => world('Place', 'Other lore') });
    assert.deepEqual(titles(got), ['World:Place', 'World:Other lore', 'Embedded:Ersveil [storysuite:pack]']);
    assert.equal(got.problem, '');
});

test('a missing world file (an empty dummy, or a failed load) falls back to the embedded storysuite entries', async t => {
    const dummy = await read(t, { linked: 'Gone', book: embedded('Lore', 'P [storysuite:pack]', 'S [storysuite:settings]'), load: async () => ({ entries: {} }) });
    assert.deepEqual(titles(dummy), ['Embedded:P [storysuite:pack]', 'Embedded:S [storysuite:settings]']);
    const failed = await read(t, { linked: 'Gone', book: embedded('P [storysuite:pack]'), load: async () => { throw new Error('no file'); } });
    assert.deepEqual(titles(failed), ['Embedded:P [storysuite:pack]']);
    assert.equal(failed.problem, 'The lorebook "Gone" could not be loaded.', 'still told for the market lines and the Packs panel, as in 2.20.0');
    const nothing = await read(t, { linked: 'Gone', book: embedded('Lore'), load: async () => null });
    assert.equal(nothing.problem, 'The lorebook "Gone" could not be loaded.', 'no embedded tags: as before');
});

test('when the linked world has the pack it is used as today; the embedded one wins only for a tag the world lacks', async t => {
    const same = await read(t, { linked: 'World', book: embedded('Old [storysuite:pack]'), load: async () => world('New [storysuite:pack]') });
    assert.deepEqual(titles(same), ['World:New [storysuite:pack]']);
    const mixed = await read(t, { linked: 'World', book: embedded('Old [storysuite:pack]', 'S [storysuite:settings]'), load: async () => world('New [storysuite:pack]') });
    assert.deepEqual(titles(mixed), ['World:New [storysuite:pack]', 'Embedded:S [storysuite:settings]']);
});

test('a card with no linked world still reads its embedded book whole, as before', async t => {
    const got = await read(t, { linked: undefined, book: embedded('Lore', 'P [storysuite:pack]'), load: async () => world() });
    assert.deepEqual(titles(got), ['Embedded:Lore', 'Embedded:P [storysuite:pack]']);
    assert.equal(got.card, 'ilsa.png');
});

test('saveSettingsNow: ok when SillyTavern says its settings were saved, not ok when it does not, ok where there is no page', async t => {
    t.after(() => { delete globalThis.SillyTavern; });
    assert.deepEqual(await saveSettingsNow(), { ok: true, message: '' }, 'no SillyTavern: nothing to flush');
    const listeners = [];
    const make = save => ({ eventTypes: { SETTINGS_UPDATED: 'settings_updated' }, eventSource: { once: (type, fn) => listeners.push([type, fn]) }, saveSettings: save });
    let ctx = make(async () => { listeners.forEach(([, fn]) => fn()); });
    globalThis.SillyTavern = { getContext: () => ctx };
    assert.deepEqual(await saveSettingsNow(), { ok: true, message: '' });
    ctx = make(async () => {});   // SillyTavern swallowed a failed save (a toast, no event)
    const lost = await saveSettingsNow({ timeoutMs: 20 });
    assert.equal(lost.ok, false);
    assert.match(lost.message, /did not confirm/);
    ctx = make(async () => { throw new Error('offline'); });
    assert.match((await saveSettingsNow()).message, /offline/);
});

test('saveSettingsNow: a save that never answers ends at the timer (not stuck) and the listener is taken away', async t => {
    t.after(() => { delete globalThis.SillyTavern; });
    const listeners = new Set();
    const eventSource = { once: (type, fn) => listeners.add(fn), removeListener: (type, fn) => listeners.delete(fn) };
    globalThis.SillyTavern = { getContext: () => ({ eventTypes: { SETTINGS_UPDATED: 'settings_updated' }, eventSource, saveSettings: () => new Promise(() => {}) }) };
    const started = Date.now();
    const result = await saveSettingsNow({ timeoutMs: 30 });
    assert.equal(result.ok, false);
    assert.ok(Date.now() - started < 1000, 'ended at the timer');
    assert.equal(listeners.size, 0, 'the listener is gone');
});

const pack = (id, version) => JSON.stringify({ id, version, name: id });
const withPack = (title, id, version) => ({ id: 0, comment: title, content: pack(id, version), keys: [] });

test('pack entries are merged by pack id and the higher version wins: a stale linked world does not hide a card update; equal or older keeps the linked one', async t => {
    const newer = await read(t, { linked: 'World', book: { name: 'Embedded', entries: [withPack('P [storysuite:pack]', 'ersveil', '2.7.0')] }, load: async () => ({ entries: { 0: { uid: 0, comment: 'P [storysuite:pack]', content: pack('ersveil', '2.6.1'), key: [] }, 1: { uid: 1, comment: 'Place', content: 'Lore.', key: [] } } }) });
    assert.deepEqual(newer.entries.map(entry => [entry.book, entry.title, /^\{/.test(entry.content) ? JSON.parse(entry.content).version : null]), [['World', 'Place', null], ['Embedded', 'P [storysuite:pack]', '2.7.0']], 'the linked 2.6.1 is replaced by the embedded 2.7.0; the rest of the world is read as before');
    for (const embeddedVersion of ['2.6.1', '2.5.0']) {
        const kept = await read(t, { linked: 'World', book: { name: 'Embedded', entries: [withPack('P [storysuite:pack]', 'ersveil', embeddedVersion)] }, load: async () => ({ entries: { 0: { uid: 0, comment: 'P [storysuite:pack]', content: pack('ersveil', '2.6.1'), key: [] } } }) });
        assert.deepEqual(titles(kept), ['World:P [storysuite:pack]'], embeddedVersion);
    }
    const other = await read(t, { linked: 'World', book: { name: 'Embedded', entries: [withPack('Q [storysuite:pack]', 'other-pack', '1.0.0')] }, load: async () => ({ entries: { 0: { uid: 0, comment: 'P [storysuite:pack]', content: pack('ersveil', '2.6.1'), key: [] } } }) });
    assert.deepEqual(titles(other), ['World:P [storysuite:pack]', 'Embedded:Q [storysuite:pack]'], 'a different pack id is a second pack');
});
