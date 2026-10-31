// The Lean RPG templates as the block engine runs them: made with dm.define as the chooser does, then played by
// story lines. Class and rank rise by their rules, the death latch ends the story only for a character already
// Down, the end card follows, and live = reload = rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { reply, success, view, rebuilt } from '../data-modules/helpers.js';

const definition = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
// A line's sign is its kind's op: `+` for the add kinds (add-xp, practice-N), `~` for the set kinds.
const line = (slug, kind, extra = '') => `${/^(add-|practice-)/.test(kind) ? '+' : '~'} dm ${slug} — why | kind: ${kind}${extra}`;
const sheet = (host, slug) => view(host, `pack.chat/${slug}`).chat;
async function story(t, ...names) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    for (const name of names) success(await host.sdk.command('dm.define', { definition: definition(name) }));
    return host;
}

test('every template is made by dm.define, as the chooser makes it', async t => {
    const host = await story(t, 'Character', 'Skills', 'Foes', 'Combat rules');
    for (const slug of ['character', 'skills', 'foes', 'combat-rules']) assert.ok(sheet(host, slug), slug);
    assert.equal(sheet(host, 'character').soul, 1);
});

test('Character: 100 XP raises the Soul Class by one and starts XP again; a swipe takes it back', async t => {
    const host = await story(t, 'Character');
    await host.send('Fight.', reply(line('character', 'add-xp', ' | amount: 60')));
    await host.send('Fight on.', reply(line('character', 'add-xp', ' | amount: 50')));
    assert.deepEqual([sheet(host, 'character').soul, sheet(host, 'character').xp], [2, 0]);
    await host.swipe(reply(line('character', 'add-xp', ' | amount: 10')));
    assert.deepEqual([sheet(host, 'character').soul, sheet(host, 'character').xp], [1, 70]);
    rebuilt(host);
});

test('Character: the death latch, by stage name, and the end card', async t => {
    const host = await story(t, 'Character');
    await host.send('Hit.', reply(line('character', 'set-health', ' | to: Down')));
    assert.deepEqual([sheet(host, 'character').health, sheet(host, 'character').alive], [0, true], 'Down, not dead');
    await host.send('Hit again.', reply(line('character', 'set-health', ' | to: Down')));
    assert.equal(sheet(host, 'character').alive, false, 'already Down and still Down: the story ends');
    rebuilt(host);
    await host.swipe(reply(line('character', 'set-health', ' | to: Hurt')));
    assert.deepEqual([sheet(host, 'character').health, sheet(host, 'character').alive], [3, true]);
});

test('Skills: a named skill is practised to 100 and rises a rank; an unnamed one is refused', async t => {
    const host = await story(t, 'Skills');
    await host.send('Train.', reply(line('skills', 'practice-2', ' | amount: 10')));
    assert.equal(sheet(host, 'skills').practice2, 0, 'refused: no skill in slot 2');
    await host.send('Learn.', reply(line('skills', 'learn-1', ' | name: Iron Breath')));
    for (let i = 0; i < 5; i++) await host.send('Train.', reply(line('skills', 'practice-1', ' | amount: 20')));
    assert.deepEqual([sheet(host, 'skills').skill1, sheet(host, 'skills').rank1, sheet(host, 'skills').practice1], ['Iron Breath', 1, 0]);
    rebuilt(host);
});
