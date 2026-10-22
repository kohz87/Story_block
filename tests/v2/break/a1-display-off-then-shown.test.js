// B-a1-5 (a1, story-suite break pass 2): with Choices off, a reply's `? choice` lines are told as
// FEATURE_OFF ("was not used: Choices is turned off"), but they stay in the hidden comment and
// displayLines reads them "for kinds that are on now": turned on later, the same reply shows those
// choices as buttons. What the reader was told was not used is shown after all; a reply captured while a
// display feature was off should show nothing for it (or not be told that it was not used).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { displayLines } from '../../../src/v2/extras.js';

test('choices told "not used" while Choices was off are not shown when it is turned on', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    host.features.set('story-block.choices', false);
    await host.send('Go.', 'The hall.\n\n<Changes>\n? choice Open the door\n? choice Go back\n</Changes>');
    const told = host.turn.problems().filter(item => item.code === 'FEATURE_OFF').map(item => item.line);
    assert.deepEqual(told, ['? choice Open the door', '? choice Go back'], 'setup: told as not used');
    host.features.set('story-block.choices', true);
    const shown = displayLines(host.ctx.chat.at(-1).mes, { entryOf: word => host.registry.capture(word), max: 150 });
    assert.deepEqual(shown.choice ?? [], [], 'lines told as not used are not shown later');
});
