// st-adapter.js readCharacterLorebook: a card's embedded [storysuite:…] entries are read when its linked world lacks them or is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readCharacterLorebook } from '../../../src/v2/packs/st-adapter.js';

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
    assert.equal(failed.problem, '');
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
