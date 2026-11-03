// Your look fills itself early (src/v2/domains/scene.js youNote): while Wearing or Condition is empty and `story-block.you` is on, the tail
// (never the static part) carries one line asking the narrator to write the empty parts with a `~ you` line on this reply; once both are
// set the line is gone and the tail is as it was (prompt diet, stage 59: it is asked once per chat, on the reply to the reader's first message, not on every reply until set); the Rank is asked only when a pack gives a rank word and it is empty; off changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CORE_BUDGET, createCoreModule } from '../../../src/v2/domains/index.js';
import { YOU_FEATURE, initialScene, sceneTail, youNote } from '../../../src/v2/domains/scene.js';

const block = (story, lines) => `${story}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const staticText = host => host.st.requests.at(-1)?.chat?.[0]?.content ?? '';
const tailText = host => host.st.requests.at(-1).chat.filter(message => message.role === 'system').slice(1).map(message => message.content).join('\n');
const NOTE = /^Your look is not set yet: on this reply write ~ you (.*) for You, from the persona and what they carry\.$/m;
const rankPack = { id: 'guild', version: '1.0.0', requires: { storyBlock: '^2' }, content: { you: { rank: { label: 'Guild rank' } } } };
const stateWith = you => ({ domains: { scene: { ...initialScene(), ...(you ? { you } : {}) } } });

test('the note: the exact line, only the empty parts, the Rank only with a rank word and empty; none once wearing and condition are set', () => {
    assert.equal(youNote(undefined), 'Your look is not set yet: on this reply write ~ you wearing: … | condition: … for {{user}}, from the persona and what they carry.');
    assert.equal(youNote({ rank: '', wearing: '', condition: '' }), youNote(undefined));
    assert.equal(youNote({ rank: '', wearing: 'a coat', condition: '' }), 'Your look is not set yet: on this reply write ~ you condition: … for {{user}}, from the persona and what they carry.');
    assert.equal(youNote({ rank: '', wearing: '', condition: 'tired' }), 'Your look is not set yet: on this reply write ~ you wearing: … for {{user}}, from the persona and what they carry.');
    assert.equal(youNote(undefined, 'Guild rank'), 'Your look is not set yet: on this reply write ~ you rank: … | wearing: … | condition: … for {{user}}, from the persona and what they carry.');
    assert.equal(youNote({ rank: 'F', wearing: '', condition: '' }, 'Guild rank'), youNote(undefined), 'a rank that is set is not asked again');
    assert.equal(youNote({ rank: '', wearing: 'a coat', condition: 'tired' }, 'Guild rank'), '', 'an empty rank alone asks nothing');
    assert.equal(youNote({ rank: '', wearing: 'a coat', condition: 'tired' }), '');
    assert.equal(youNote({ wearing: 5, condition: ['x'] }), youNote(undefined), 'a part that is not text counts as empty');
});

test('the tail lines: the note comes after the look line, only with the feature on, and is not there once both parts are set', () => {
    assert.deepEqual(sceneTail(stateWith(null), { you: true }), [youNote(undefined)]);
    assert.deepEqual(sceneTail(stateWith(null)), [], 'feature off: nothing');
    assert.deepEqual(sceneTail(stateWith(null), { weather: true }), [], 'feature off: nothing');
    assert.deepEqual(sceneTail(stateWith({ rank: '', wearing: 'a coat', condition: '' }), { you: true }), ['{{user}}: wears a coat', youNote({ wearing: 'a coat' })]);
    assert.deepEqual(sceneTail(stateWith({ rank: '', wearing: 'a coat', condition: 'tired' }), { you: true }), ['{{user}}: wears a coat; condition tired']);
    assert.deepEqual(sceneTail(stateWith({ rank: '', wearing: 'a coat', condition: 'tired' }), { you: true, rankLabel: 'Guild rank' }), ['{{user}}: wears a coat; condition tired']);
});

test('a real flow: a new chat asks on its first reply, the reply fills the look, the next prompt has no note; the static part never changes', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road to the harbour.');
    assert.match(tailText(host), NOTE);
    assert.equal(tailText(host).match(NOTE)[1], 'wearing: … | condition: …', 'no pack gives a rank: wearing and condition only');
    assert.doesNotMatch(staticText(host), /Your look is not set/, 'the note is in the tail, not the static part');
    const staticBefore = staticText(host);
    await host.send('We walk.', block('Rain.', ['~ you wearing: oilskin coat | condition: cold and wet']));
    assert.doesNotMatch(tailText(host), /^Your look is not set yet/m, 'asked once per chat: the second message no longer carries it');
    await host.send('On.', 'On.');
    assert.deepEqual(host.sdk.query('scene.you'), { wearing: 'oilskin coat', condition: 'cold and wet' });
    assert.doesNotMatch(tailText(host), /Your look is not set/);
    assert.match(tailText(host), /^You: wears oilskin coat; condition cold and wet$/m);
    assert.equal(staticText(host), staticBefore, 'static bytes unchanged');
});

test('a part the reader set is never asked again or overwritten by the note; a reply that fills only one part leaves the note for the other', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    assert.equal((await host.sdk.command('scene.you', { wearing: 'a grey cloak' })).ok, true);
    await host.send('Hello.', 'The road.');
    assert.equal(tailText(host).match(NOTE)[1], 'condition: …', 'only the empty part is asked');
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^You: wears a grey cloak$/m);
    await host.send('On.', block('Mud.', ['~ you condition: muddy']));
    await host.send('On.', 'On.');
    assert.deepEqual(host.sdk.query('scene.you'), { wearing: 'a grey cloak', condition: 'muddy' });
    assert.doesNotMatch(tailText(host), /Your look is not set/);
});

test('with a pack that gives a Rank: it is asked too while empty; with the feature off nothing is asked and the look is left alone', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(rankPack)).ok, true);
    await host.send('Hello.', 'The road.');
    assert.equal(tailText(host).match(NOTE)[1], 'rank: … | wearing: … | condition: …');
    await host.send('On.', block('Rain.', ['~ you rank: F-rank | wearing: a coat']));
    await host.send('On.', 'On.');
    assert.doesNotMatch(tailText(host), /Your look is not set/, 'asked once per chat, even with a part still empty');
    host.features.set(YOU_FEATURE, false);
    await host.send('On.', 'On.');
    assert.doesNotMatch(tailText(host), /Your look is not set|~ you/);
    host.features.set(YOU_FEATURE, true);
    await host.send('On.', block('Dry.', ['~ you condition: dry']));
    await host.send('On.', 'On.');
    assert.doesNotMatch(tailText(host), /Your look is not set/, 'an empty rank alone asks nothing');
});

test('the note stays inside the core tail budget: with a long inventory the required lines still fit and the rest overflows', () => {
    const module = createCoreModule();
    const state = { domains: { scene: initialScene(), inventory: { defs: {}, stacks: {}, wallets: {}, nextId: 1 } } };
    for (let i = 0; i < 120; i += 1) {
        const id = `story/trinket-${i}`;
        state.domains.inventory.defs[id] = { id, name: `Trinket ${i}`, kind: 'misc', tags: [] };
        state.domains.inventory.stacks[`it_t${i}`] = { stack: `it_t${i}`, def: id, qty: 1, owner: 'party', equipped: null, note: '' };
    }
    const tail = module.context.tail({ state, query: () => null });
    const size = list => list.reduce((sum, item) => sum + item.length + 1, 0);
    assert.ok(tail.lines.includes(youNote(undefined)));
    assert.ok(tail.optional.length > 0, 'the long inventory does overflow');
    assert.ok(size(tail.lines) <= CORE_BUDGET * 2, `required part ${size(tail.lines)} chars`);
    assert.ok(size(tail.optional) <= CORE_BUDGET * 2 + 40);
});

test('the ask is made once per chat: a swipe of the first reply asks again, a later message and a swipe of it never do', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road to the harbour.');
    assert.match(tailText(host), NOTE);
    await host.swipe('The road, again.');
    assert.match(tailText(host), NOTE, 'a swipe of the first reply is the same prompt');
    await host.send('We walk.', 'Rain.');
    assert.doesNotMatch(tailText(host), /Your look is not set/);
    await host.swipe('Rain, again.');
    assert.doesNotMatch(tailText(host), /Your look is not set/);
});
