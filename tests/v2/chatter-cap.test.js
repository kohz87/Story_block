// Most chatter lines per reply (extras.js chatterCap, domains/index.js setting `chatterMax`): 1 to 10, 3 unless set. The
// grammar line names the cap; the capture and the strip use it; a reply keeps the cap it was read with (its hidden
// comment's `cap:chatter=N`), so a later setting changes nothing already read; a reply without a mark was read at 3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { CHATTER_FEATURE, CHATTER_MAX, chatterCap, chatterGrammar, displayLines } from '../../src/v2/extras.js';

const ON = { features: { [CHATTER_FEATURE]: true } };
const lines = n => Array.from({ length: n }, (_, i) => `~ chatter Npc${i + 1}: thought ${i + 1}`);
const block = (story, list) => `${story}\n\n<Changes>\n${list.join('\n')}\n</Changes>`;
const shown = (host, index = host.ctx.chat.length - 1) => (displayLines(host.ctx.chat[index].mes, { entryOf: word => host.registry.capture(word) }).chatter ?? []).length;
const staticText = host => host.st.requests.at(-1)?.chat?.[0]?.content ?? '';

async function fresh(t, max) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: ON });
    t.after(() => host.close());
    if (max !== undefined) host.settings.set('story-block', 'chatterMax', max);
    await host.send('Hello.', 'The road.');
    return host;
}

test('chatterCap: 1 to 10, else 3', () => {
    assert.deepEqual([1, 5, 10, 0, 11, 2.5, '4', null, undefined].map(chatterCap), [1, 5, 10, 3, 3, 3, 3, 3, 3]);
    assert.equal(CHATTER_MAX, 3);
});

for (const max of [1, 3, 10]) {
    test(`setting ${max}: the grammar line, the cap at capture and the strip`, async t => {
        const host = await fresh(t, max);
        assert.ok(staticText(host).includes(chatterGrammar(max)), 'the grammar line names the cap');
        assert.match(chatterGrammar(max), new RegExp(`one line for each NPC in the scene who has something on their mind, up to ${max} `));
        await host.send('Look.', block('Many voices.', lines(12)));
        assert.equal(shown(host), max, 'the strip shows the cap');
        const limited = host.turn.problems().filter(item => item.code === 'LIMITED');
        assert.equal(limited.length, 12 - max, 'every line past the cap is told');
        assert.equal(host.sdk.query('chatter.head').length, max);
    });
}

test('a reply keeps the cap it was read with: the setting changed later changes nothing; old replies are read at 3', async t => {
    const host = await fresh(t, 5);
    await host.send('Look.', block('Five.', lines(7)));
    const at = host.ctx.chat.length - 1;
    assert.match(host.ctx.chat[at].mes, /cap:chatter=5/);
    assert.equal(shown(host, at), 5);
    host.settings.set('story-block', 'chatterMax', 2);
    assert.equal(shown(host, at), 5, 'a lower setting later does not hide what was read');
    host.settings.set('story-block', 'chatterMax', 9);
    assert.equal(shown(host, at), 5, 'a higher one does not show lines that were refused');
    // A reply read at the usual 3 carries no mark; a reply from before the setting is read at 3 whatever the setting is.
    host.settings.set('story-block', 'chatterMax', 3);
    await host.send('More.', block('Three.', lines(5)));
    assert.doesNotMatch(host.ctx.chat.at(-1).mes, /cap:/);
    host.settings.set('story-block', 'chatterMax', 8);
    assert.equal(shown(host), 3, 'no mark: 3');
    // Replay: Re-read reads again with the setting then; a reload reads the marks.
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(shown(host, at), 7, 'Re-read at 8 keeps all seven lines');
    assert.match(host.ctx.chat[at].mes, /cap:chatter=8/);
    const other = await createHost({ settings: ON, st: { chat: host.ctx.chat } });
    t.after(() => other.close());
    assert.equal(shown(other, at), 7);
    assert.equal(shown(other), 3);
});

test('swipes and deletes keep each reply\'s own cap', async t => {
    const host = await fresh(t, 4);
    await host.send('Look.', block('Four.', lines(6)));
    const at = host.ctx.chat.length - 1;
    host.settings.set('story-block', 'chatterMax', 2);
    await host.swipe(block('Two.', lines(6)));
    assert.equal(shown(host, at), 2);
    await host.st.swipeTo(at, 0);
    assert.equal(shown(host, at), 4, 'the first swipe keeps its 4');
});
