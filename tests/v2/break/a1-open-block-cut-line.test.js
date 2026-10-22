// B-a1-14 (a1, story-suite break pass 2): a reply cut off by the length limit (not stopped by the reader)
// inside its <Changes> block, in the middle of its last line ("+ item Ro"). The capture reads that
// unfinished line as written (only a reply the reader stopped has it left out: capture.js wholeLines /
// cutLine use `stopped`), so a story item "Ro" is made. The Continue that finishes the line ("pe | qty: 2")
// is read as a line of its own ("pe | qty: 2" is not a change line). The reader ends up with "Ro" x1
// instead of "Rope" x2. Hitting the length limit inside the block is the usual reason to press Continue.
// The same cuts an amount: "+ coin 5" + Continue "00" pays 5, not 500.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const items = host => host.sdk.query('inventory.items').map(item => `${item.name} x${item.qty}`).sort();

test('a block cut mid-line by the length limit, finished by Continue, reads the whole line once', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('I search.', 'You find things.\n\n<Changes>\n+ coin 5\n+ item Ro');
    await host.cont('pe | qty: 2\n</Changes>');
    assert.equal(host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0, 5, 'setup: the whole line before it is read');
    assert.deepEqual(items(host), ['Rope x2'], 'the finished line, not the cut half ("Ro") and not nothing');
});
