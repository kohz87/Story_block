// Packs read from a card's lorebook: picking tagged entries, the SillyTavern adapter over a
// fake world-info API, and installing what was found.
import test from 'node:test';
import assert from 'node:assert/strict';
import { entryText, findPackEntries, isPackTitle } from '../../../src/v2/packs/lorebook.js';
import { readCharacterLorebook } from '../../../src/v2/packs/st-adapter.js';
import { createInstalled } from '../../../src/v2/packs/installed.js';
import { installFakeSillyTavern, worldInfo } from './helpers/fake-st.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack, sampleText } from './helpers/fixtures.js';

test('tagged titles, in any case and spacing', () => {
    assert.equal(isPackTitle('Riverside [storysuite:pack]'), true);
    assert.equal(isPackTitle('[StorySuite: Pack] Riverside'), true);
    assert.equal(isPackTitle('Riverside pack'), false);
    assert.equal(isPackTitle(undefined), false);
});

test('entry text: plain or in a code fence', () => {
    assert.equal(entryText('  {"id":"x"}  '), '{"id":"x"}');
    assert.equal(entryText('```json\n{"id":"x"}\n```'), '{"id":"x"}');
    assert.equal(entryText('```\n{"id":"x"}```'), '{"id":"x"}');
    assert.equal(entryText(null), '');
});

test('only tagged entries are taken, in order, with their origin', () => {
    const found = findPackEntries([
        { book: 'Mara lore', uid: 0, title: 'The mill', content: 'A mill by the weir.' },
        { book: 'Mara lore', uid: 3, title: 'Riverside [storysuite:pack]', content: '```json\n{"id":"a"}\n```' },
        null,
        { book: 'Mara lore', uid: 5, title: '[storysuite:pack]', content: '{"id":"b"}' },
    ]);
    assert.deepEqual(found, [
        { origin: 'lorebook:Mara lore#3', title: 'Riverside', text: '{"id":"a"}' },
        { origin: 'lorebook:Mara lore#5', title: '', text: '{"id":"b"}' },
    ]);
    assert.deepEqual(findPackEntries('nope'), []);
});

test('the adapter reads the card\'s linked lorebook, disabled entries included', async () => {
    const st = installFakeSillyTavern({ books: { 'Mara lore': worldInfo([{ comment: 'Mill', content: 'x', disable: false }, { comment: 'Riverside [storysuite:pack]', content: sampleText }]) } });
    try {
        const read = await readCharacterLorebook();
        assert.equal(read.problem, '');
        assert.equal(read.character, 'Mara');
        assert.deepEqual(read.entries.map(entry => [entry.book, entry.uid, entry.title]), [['Mara lore', 0, 'Mill'], ['Mara lore', 1, 'Riverside [storysuite:pack]']]);
        assert.deepEqual(st.calls.loads, ['Mara lore']);
    } finally {
        st.uninstall();
    }
});

test('the adapter falls back to the embedded character book', async () => {
    const character = { name: 'Mara', data: { extensions: {}, character_book: { name: 'Embedded', entries: [{ id: 7, comment: '[storysuite:pack]', content: '{}' }, { name: 'Old style', content: 'y' }] } } };
    const st = installFakeSillyTavern({ character });
    try {
        const read = await readCharacterLorebook();
        assert.deepEqual(read.entries, [
            { book: 'Embedded', uid: 7, title: '[storysuite:pack]', keys: [], content: '{}' },
            { book: 'Embedded', uid: 1, title: 'Old style', keys: [], content: 'y' },
        ]);
    } finally {
        st.uninstall();
    }
});

test('the adapter says plainly why nothing was read', async () => {
    assert.match((await readCharacterLorebook()).problem, /not available/);
    let st = installFakeSillyTavern({ character: null });
    try {
        assert.match((await readCharacterLorebook()).problem, /Open a chat with a character/);
    } finally { st.uninstall(); }
    st = installFakeSillyTavern({ loadFails: true });
    try {
        assert.match((await readCharacterLorebook()).problem, /could not be loaded/);
    } finally { st.uninstall(); }
    st = installFakeSillyTavern({ books: {} });
    try {
        assert.match((await readCharacterLorebook()).problem, /could not be loaded/, 'a missing book');
    } finally { st.uninstall(); }
    st = installFakeSillyTavern({ character: { name: 'Bare', data: { extensions: {} } } });
    try {
        assert.match((await readCharacterLorebook()).problem, /Bare has no lorebook/);
    } finally { st.uninstall(); }
});

test('importing from the lorebook installs each good pack and reports each bad one', async () => {
    const st = installFakeSillyTavern({
        books: {
            'Mara lore': worldInfo([
                { comment: 'Riverside [storysuite:pack]', content: '```json\n' + sampleText + '\n```' },
                { comment: 'Broken [storysuite:pack]', content: '{ "id": "broken", ' },
                { comment: 'Evil [storysuite:pack]', content: JSON.stringify(pack({ id: 'evil', name: '<script>x</script>' })) },
                { comment: 'Not a pack', content: JSON.stringify(pack({ id: 'ignored' })) },
            ]),
        },
    });
    try {
        const settings = fakeSettings();
        const installed = createInstalled({ settings });
        const read = await readCharacterLorebook();
        const { found, results } = await installed.importLorebook(read.entries);
        assert.equal(found, 3);
        assert.deepEqual(results.map(result => [result.title, result.ok, result.ok ? result.action : result.errors[0].code]), [
            ['Riverside', true, 'installed'], ['Broken', false, 'NOT_JSON'], ['Evil', false, 'UNSAFE_HTML'],
        ]);
        assert.deepEqual(installed.list().map(entry => [entry.id, entry.source, entry.origin]), [['riverside-starter', 'lorebook', 'lorebook:Mara lore#0']]);
        assert.equal(settings.saves, 1, 'only the good pack was saved');
        const again = await installed.importLorebook(read.entries);
        assert.equal(again.results[0].action, 'unchanged', 'reading the same card twice changes nothing');
        assert.equal(settings.saves, 1);
    } finally {
        st.uninstall();
    }
});
