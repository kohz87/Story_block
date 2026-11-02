// Bug hunt (stage 41), packs/index.js refreshLore. A chat of another character opened while the first one's lorebook is still
// being read: the second ask got the read already on its way (the first character's), so the market places of the character that
// is open were those of the one before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { fakeSettings } from '../packs/helpers/fake-settings.js';

const entry = (title, type) => ({ book: 'World', uid: 1, title, keys: [], content: `market: ${type}` });

test('bh1: a lorebook read for the chat opened after a slow one is its own, not the earlier chat\'s', async () => {
    let open = 'Mara';
    const books = { Mara: [entry('Saltcliff', 'town')], Odo: [entry('Dunmere', 'hamlet')] };
    const gates = [];
    const part = createPacksPart({
        settings: fakeSettings(),
        readLorebook: () => {
            const who = open;                     // the character open when the read begins
            return new Promise(resolve => gates.push(() => resolve({ character: who, entries: books[who], problem: '' })));
        },
    });
    const first = part.refreshLore();            // chat of Mara opens: her lorebook is being read (slow)
    open = 'Odo';
    const second = part.refreshLore();           // chat of Odo opens before that read ended
    while (gates.length) { gates.shift()(); await new Promise(resolve => setImmediate(resolve)); }
    await Promise.all([first, second]);
    assert.deepEqual(part.part.queries['packs.markets']().places.map(place => place.place), ['Dunmere']);
});
