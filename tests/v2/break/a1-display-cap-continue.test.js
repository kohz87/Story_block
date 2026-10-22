// B-a1-4 (a1, story-suite break pass 2): the per-reply cap of a display kind (extras.js CHOICE_MAX 4,
// CHATTER_MAX 3) is counted afresh by each Continue (turn.js captureEach makes `shown` per capture
// call), while what is drawn (displayLines) reads the whole reply and keeps only the first 4 / 3. So a
// reply with 3 choices and a Continue with 2 more shows 4 and drops the 5th with no Problem: extras.js
// says "the first lines in reply order are kept, the rest get a Problem".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { displayLines } from '../../../src/v2/extras.js';

const B = lines => `\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('a choice past the cap, written by a Continue, is told (LIMITED) as it is not shown', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    host.features.set('story-block.choices', true);
    host.features.set('story-block.chatter', true);
    await host.send('Hello.', 'The road.');
    await host.send('Go.', 'The gate.' + B(['? choice Climb', '? choice Knock', '? choice Wait', '~ chatter Fenna: one', '~ chatter Fenna: two']));
    await host.cont(' Later.' + B(['? choice Run', '? choice Hide', '~ chatter Fenna: three', '~ chatter Fenna: four']));
    const shown = displayLines(host.ctx.chat.at(-1).mes, { entryOf: word => host.registry.capture(word), max: 150 });
    assert.deepEqual(shown.choice.map(item => item.text), ['Climb', 'Knock', 'Wait', 'Run'], 'setup: the first four are shown');
    assert.equal(shown.chatter.length, 3, 'setup: the first three thoughts are shown');
    const limited = host.turn.problems().filter(item => item.code === 'LIMITED').map(item => item.line);
    assert.ok(limited.includes('? choice Hide'), `the 5th choice is told, not dropped quietly (told: ${JSON.stringify(limited)})`);
    assert.ok(limited.includes('~ chatter Fenna: four'), 'the 4th thought is told, not dropped quietly');
});
