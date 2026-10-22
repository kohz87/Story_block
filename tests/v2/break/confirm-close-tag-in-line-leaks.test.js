// Confirm soak (C-3): a `</Changes>` written inside a change line (a name or label the model wrote, e.g.
// `| who: </Changes>`) closes the block there. The block's later lines and its real closing tag are then
// left in the story the reader sees. Seen live in the soak (message 466): "? choice Head back to the
// Guild office", "? choice Check the granary cellar" and a bare "</Changes>" shown under the reply.
// Drops into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';

const REPLY = [
    'Fenna waits for your answer.',
    '',
    '<Changes>',
    '+ present Fenna | note: </Changes>',
    '+ item Torch | qty: 1',
    '? choice Head back to the Guild office',
    '? choice Check the granary cellar',
    '</Changes>',
].join('\n');
const shown = host => host.ctx.chat.at(-1).mes.split('<!-- STORY_SUITE_V2')[0];

for (const choices of [false, true]) {
    test(`C-3: a close tag inside a line leaves no block text in the story (choices ${choices ? 'on' : 'off'})`, async () => {
        const host = await createHost();
        try {
            host.features.set(CORE_FEATURE.choices, choices);
            await host.send('I wait.', REPLY);
            const story = shown(host);
            assert.ok(!/<\/?Changes>/i.test(story), `the story shows a block tag:\n${story}`);
            assert.ok(!/^\? choice/m.test(story), `the story shows a choice line:\n${story}`);
            assert.ok(!/^\+ item/m.test(story), `the story shows a change line:\n${story}`);
        } finally { host.close(); }
    });
}
