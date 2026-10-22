// B-a1-2 (a1, story-suite break pass 2): a change line inside a fenced code block, an indented code block
// or a Markdown blockquote in the story is taken as one of the reply's changes (capture.js strayLines, #123)
// and cut out of what the reader sees, leaving an empty fence. Quoted and code text is something shown (a
// note, a letter, an example of the format), never the reply's own change; it should stay in the story
// (and at most be told as STRAY), never pay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const HIDDEN = /<!--\s*STORY_SUITE_V2[\s\S]*?-->/g;
const shown = mes => String(mes).replace(HIDDEN, '');
const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const BLOCK = '<Changes>\n~ place Bluewatch Village\n</Changes>';

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

for (const [label, quoted] of [
    ['a ``` fence', '```\n+ coin 40\n```'],
    ['a ~~~ fence', '~~~\n+ coin 40\n~~~'],
    ['an indented code block', '    + coin 40'],
    ['a blockquote', '> + coin 40'],
]) {
    test(`a change line inside ${label} is not taken`, async t => {
        const host = await fresh(t);
        await host.send('What does the ledger say?', `He showed the ledger's format:\n\n${quoted}\n\n${BLOCK}`);
        assert.equal(coin(host), 0, 'quoted or code text pays nothing');
        assert.ok(shown(host.ctx.chat.at(-1).mes).includes('+ coin 40'), 'the quoted line stays shown');
    });
}
