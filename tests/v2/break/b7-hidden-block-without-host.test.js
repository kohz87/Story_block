// B-b7-combos-10: Story Block hides a captured <Changes> block by rewriting the reply's text into an
// HTML comment (`<!-- STORY_SUITE_V2 <Changes>…</Changes> -->`, turn.js hideBlock) and strips it from
// the prompt only while it runs (onPromptReady stripHistory). With Story Block switched off or
// uninstalled mid-chat, every earlier reply still carries its block in `mes`, and SillyTavern sends
// it to the model. The block stays in the reply on purpose (Re-read and a reinstall read it again);
// the guide (docs/v2/GUIDE.md, "Removing Story Block from a chat") gives the reader a SillyTavern
// regex script that keeps it out of the prompt. This checks that the documented regex does that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createHost } from '../../../testkit/index.js';

const GUIDE = new URL('../../../docs/v2/GUIDE.md', import.meta.url);

// The guide's "Find Regex" line, as SillyTavern reads it: /pattern/flags.
function guideRegex() {
    const line = readFileSync(GUIDE, 'utf8').split('\n').map(text => text.trim()).find(text => /^\/<!--.*STORY_SUITE_V2.*\/[gimsuy]*$/.test(text));
    assert.ok(line, 'the guide gives the regex for readers who remove Story Block');
    const [, pattern, flags] = /^\/(.*)\/([gimsuy]*)$/.exec(line);
    return new RegExp(pattern, flags);
}

test('the guide\'s regex takes a captured reply\'s hidden change block out of the text SillyTavern sends', async () => {
    const host = await createHost();
    await host.send('Any work?', 'Hollis nods at the cellar.\n<Changes>\n+ item Rope | qty: 1\n~ place Bluewatch | kind: settlement\n</Changes>');
    await host.send('I go down.', 'The cellar is damp.\n<Changes>\n+ item Lamp | qty: 1\n</Changes>');
    assert.equal(Object.values(host.head().domains.inventory.stacks).length, 2, 'captured');
    const regex = guideRegex();
    const replies = host.ctx.chat.filter(message => !message.is_user).slice(-2);
    for (const reply of replies) {
        assert.match(reply.mes, /STORY_SUITE_V2/, 'the reply keeps its hidden block (Re-read, a reinstall)');
        const sent = reply.mes.replace(regex, '');
        assert.doesNotMatch(sent, /STORY_SUITE_V2|<Changes>|\+ item/, 'nothing of the block is left');
        assert.equal(sent.trim(), reply.mes.slice(0, reply.mes.indexOf('<!--')).trim(), 'the story text is kept as written');
    }
    host.close();
});
