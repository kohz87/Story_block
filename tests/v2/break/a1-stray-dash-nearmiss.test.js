// B-a1-9 (a1, story-suite break pass 2): a change line written in the story near the block with a
// typographic op ("– coin 5" en dash, "− coin 5" minus sign, "＋ coin 5" fullwidth plus) or the kind in the
// plural ("+ coins 5") is neither taken nor told. capture.js strayClass only knows the ASCII ops
// /^([+\-~!?])/ and the kind word exactly, so these lines fall through to "not a change line" and stay in
// the story silently. SPEC: "A line close to one that is not taken (another op, a capital, no space or a
// colon after the op or kind, ...) is a Problem (STRAY)". Models write – and − for - all the time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const BLOCK = '<Changes>\n~ place Bluewatch Village\n</Changes>';

for (const line of ['– coin 5', '− coin 5', '＋ coin 5', '+ coins 5']) {
    test(`"${line}" near the block is told as STRAY`, async t => {
        t.mock.method(console, 'warn', () => {});
        const host = await createHost();
        t.after(() => host.close());
        await host.send('Hello.', 'The road.');
        await host.send('Go.', `The hall.\n\n${line}\n\n${BLOCK}`);
        assert.equal(host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0, 0, 'setup: not taken');
        const told = host.turn.problems().filter(item => item.code === 'STRAY').map(item => item.line);
        assert.deepEqual(told, [line], 'a close line that is not taken is told');
    });
}
