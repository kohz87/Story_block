// B-a1-11 (a1, story-suite break pass 2): hideBlock keeps a reply's change lines in an HTML comment and
// makes them comment-safe by turning every "--" into "- -" (capture.js commentSafe). That is not undone
// when the hidden block is read again, so a Re-read of an unedited reply reads different lines: models
// write "--" for a dash all the time ("+ item Rope -- frayed", "! encounter 3 Weir Rat -- cellar pack").
// Live: an item "Rope -- frayed" with note ""; Re-read: "- -" splits like " - ", the item is "Rope", and a
// note "tied -- twice" becomes "tied - - twice". The same holds for change lines taken from the story
// (#123), which are hidden the same way. SPEC: live, Re-read and the rebuild read the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const items = host => host.sdk.query('inventory.items').map(item => ({ name: item.name, note: item.note ?? '' }));

test('Re-read of an unedited reply with "--" in its change lines reads the same items', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Look.', 'A coil in the corner.\n\n<Changes>\n+ item Rope -- frayed\n+ item Lantern | note: tied -- twice\n</Changes>');
    const live = items(host);
    assert.equal(live.length, 2, 'setup: two items');
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.deepEqual(items(host), live, 'the same names and notes after the Re-read');
});
