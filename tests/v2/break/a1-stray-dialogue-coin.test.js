// B-a1-1 (a1, story-suite break pass 2): a line of dialogue that starts like a change line ("+ coin 5, she
// said, ...") is taken from the story as a change line (capture.js strayLines, #123): the coin is paid and
// the spoken line is cut out of the story and moved into the hidden comment. SPEC "Change lines written in
// the story": a mention in a sentence is neither taken nor told. The amount reader (money.js parseNumber)
// ignores the trailing words when the world has no coins, so the sentence pays as a bare "+ coin 5".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const HIDDEN = /<!--\s*STORY_SUITE_V2[\s\S]*?-->/g;
const shown = mes => String(mes).replace(HIDDEN, '');
const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

for (const [label, line] of [
    ['no block', null],
    ['with a block', '<Changes>\n~ place Bluewatch Village\n</Changes>'],
]) {
    test(`dialogue that starts like "+ coin 5" is story, not a change line (${label})`, async t => {
        const host = await fresh(t);
        const said = '+ coin 5, she said, and not one more.';
        await host.send('Pay me.', ['Fenna laughed at him.', '', said, ...(line ? ['', line] : [])].join('\n'));
        assert.equal(coin(host), 0, 'a sentence of dialogue pays nothing');
        assert.ok(shown(host.ctx.chat.at(-1).mes).includes(said), 'the spoken line stays in the story');
    });
}
