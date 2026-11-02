// Your look (MODULES §F126, src/v2/domains/scene.js): `~ you rank: … | wearing: … | condition: …` keeps {{user}}'s standing, what they wear and
// how they are as `scene.you = { rank, wearing, condition }` (each at most 120 code points, plain text, any part alone, an empty one clears it),
// read by the query `scene.you` → { rank, wearing, condition } (null while the feature is off), told to the narrator in one tail line,
// edited by the reader with `scene.you` (the pencils on Home), shown in the game view's header, under its feature
// `story-block.you` (on by default; its grammar line is in the static part only while it is on, which then stays byte-identical).
// It replays on Re-read, swipes, a middle delete and a reload like the weather, each part on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { YOU_CHARS, YOU_FEATURE, captureYou, initialScene, sceneTail, validateScene, youParts, youText } from '../../../src/v2/domains/scene.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { gameHeroProps } from '../../../src/v2/view/game-header.js';
import { checkInvariants } from '../qa/helpers/oracle.js';
import { setupDom } from '../view/mounts/helpers.js';

const block = (story, lines) => `${story}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const staticText = host => host.st.requests.at(-1)?.chat?.[0]?.content ?? '';
const tailText = host => host.st.requests.at(-1).chat.filter(message => message.role === 'system').slice(1).map(message => message.content).join('\n');
const lastIndex = host => host.ctx.chat.length - 1;
const settle = () => new Promise(resolve => setImmediate(resolve));
const NONE = { rank: '', wearing: '', condition: '' };

// A pack that gives {{user}}'s look a Rank (`content.you.rank`); without one a story has no Rank.
const rankPack = (id = 'guild', label = 'Guild rank') => ({ id, version: '1.0.0', requires: { storyBlock: '^2' }, content: { you: { rank: { label } } } });
// scene.you without the label's word, or null (what most of these tests compare).
const look = host => {
    const found = host.sdk.query('scene.you');
    if (!found) return found;
    const { rankLabel: _label, ...rest } = found;
    return rest;
};

async function fresh(t, { rank = true, ...options } = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    if (rank) assert.equal((await host.packs.packs.install(rankPack())).ok, true);
    await host.send('Hello.', block('The road to the harbour.', ['~ place Vell Harbour | kind: settlement']));
    return host;
}

// ---------------------------------------------------------------------------------------------------
// Reading one line

test('a part of the look is one plain line: markup, markdown and invisible characters out, cut at 120 code points; no words is empty', () => {
    assert.equal(YOU_CHARS, 120);
    assert.equal(youText('oilskin coat, boots'), 'oilskin coat, boots');
    assert.equal(youText('**grey** <b>wool</b>​ tunic, <img src=x onerror=alert(1)>boots‮ and a belt'), 'grey wool tunic, boots and a belt');
    assert.equal(youText('a < b > c'), 'a c');
    const long = youText('𐐷'.repeat(300));
    assert.equal(Array.from(long).length, YOU_CHARS);
    assert.ok(long.endsWith('…'));
    assert.ok(Array.from(long).slice(0, -1).every(point => point === '𐐷'), 'no character split in half');
    assert.equal(youText('x'.repeat(120)), 'x'.repeat(120), 'exactly the cap is kept whole');
    for (const empty of ['', '   ', '...', '—', '<i></i>', undefined, null]) assert.equal(youText(empty), '', `${String(empty)}: no words`);
    assert.deepEqual(youParts('~ you wearing: oilskin coat, boots | condition: tired and cold'), { wearing: 'oilskin coat, boots', condition: 'tired and cold' });
    assert.deepEqual(youParts('~ you rank: F-rank, Adventurer Guild (provisional) | wearing: a coat | condition: tired'), { rank: 'F-rank, Adventurer Guild (provisional)', wearing: 'a coat', condition: 'tired' });
    assert.deepEqual(youParts('~ you Standing: novice'), { rank: 'novice' });
    assert.deepEqual(youParts('~ you condition: tired'), { condition: 'tired' });
    assert.deepEqual(youParts('+ you **Wearing**: a grey coat'), { wearing: 'a grey coat' });
    assert.deepEqual(youParts('~ you rank: | wearing: | condition: '), { rank: '', wearing: '', condition: '' }, 'empty parts clear');
    assert.deepEqual(youParts('~ you worn: a hat | state: dizzy | mood: glad'), { wearing: 'a hat', condition: 'dizzy' }, 'a few other words for the parts; an unknown label is not used');
    assert.deepEqual(youParts('~ you wearing: a coat | boots | condition: cold'), { wearing: 'a coat, boots', condition: 'cold' }, 'a part with no label goes on the one before');
    assert.deepEqual(youParts('~ you hat: x'), {});
    assert.deepEqual(youParts('~ you'), {});
    assert.deepEqual(youParts(undefined), {});
});

test('the validator: no look is fine (an older chat); a look is a record of texts of at most 120 code points, each part optional', () => {
    assert.deepEqual(initialScene(), { place: { name: '', kind: '', region: '' }, present: [] }, 'absent until a reply writes one: older chats read as empty');
    const ok = initialScene();
    assert.deepEqual(validateScene(ok), []);
    for (const you of [NONE, { wearing: 'a coat' }, { condition: 'tired' }, { rank: 'F-rank' }, {}, { rank: 'r'.repeat(120), wearing: '𐐷'.repeat(120), condition: 'x'.repeat(120) }]) assert.deepEqual(validateScene({ ...ok, you }), [], JSON.stringify(you).slice(0, 40));
    assert.match(validateScene({ ...ok, you: 'coat' }).join(' '), /Your look is not a record/);
    assert.match(validateScene({ ...ok, you: [] }).join(' '), /not a record/);
    assert.match(validateScene({ ...ok, you: { wearing: 4 } }).join(' '), /Your wearing is not text/);
    assert.match(validateScene({ ...ok, you: { rank: 4 } }).join(' '), /Your rank is not text/);
    assert.match(validateScene({ ...ok, you: { rank: 'x'.repeat(121) } }).join(' '), /Your rank is longer than 120/);
    assert.match(validateScene({ ...ok, you: { condition: 'x'.repeat(121) } }).join(' '), /Your condition is longer than 120/);
});

// ---------------------------------------------------------------------------------------------------
// Capture on the real host

test('~ you keeps the parts in the scene; scene.you answers { wearing, condition }; either part alone; an empty one clears; no receipt is told', async t => {
    const host = await fresh(t);
    assert.deepEqual(look(host), NONE, 'empty until a reply writes one');
    assert.equal(host.head().domains.scene.you, undefined);
    await host.send('We walk.', block('Rain sets in.', ['~ you rank: F-rank, Adventurer Guild | wearing: oilskin coat, river-soaked boots | condition: tired, <b>cold</b>']));
    const receipt = host.store.receipts().at(-1)?.receipt ?? host.store.receipts().at(-1);
    assert.deepEqual(look(host), { rank: 'F-rank, Adventurer Guild', wearing: 'oilskin coat, river-soaked boots', condition: 'tired, cold' });
    assert.deepEqual(host.head().domains.scene.you, { rank: 'F-rank, Adventurer Guild', wearing: 'oilskin coat, river-soaked boots', condition: 'tired, cold' });
    assert.equal(receipt.narrate, false, 'never re-narrated');
    assert.deepEqual(host.turn.problems().filter(item => item.index === lastIndex(host)), []);
    // One part alone: the other stays.
    await host.send('On.', block('The coat dries.', ['~ you condition: warm again']));
    assert.deepEqual(look(host), { rank: 'F-rank, Adventurer Guild', wearing: 'oilskin coat, river-soaked boots', condition: 'warm again' });
    await host.send('On.', block('A new cloak.', ['+ you wearing: a borrowed cloak']));
    assert.deepEqual(look(host), { rank: 'F-rank, Adventurer Guild', wearing: 'a borrowed cloak', condition: 'warm again' });
    await host.send('On.', block('Promoted.', ['~ you rank: E-rank']));
    assert.deepEqual(look(host), { rank: 'E-rank', wearing: 'a borrowed cloak', condition: 'warm again' });
    // The same again changes nothing.
    const was = structuredClone(host.head().domains.scene.you);
    await host.send('On.', block('Same.', ['~ you rank: E-rank | wearing: a borrowed cloak | condition: warm again']));
    assert.deepEqual(host.head().domains.scene.you, was);
    // An empty value clears its part only.
    await host.send('On.', block('Bare.', ['~ you wearing:']));
    assert.deepEqual(look(host), { rank: 'E-rank', wearing: '', condition: 'warm again' });
    await host.send('On.', block('Fine.', ['~ you condition: ', '~ you wearing: a shirt']));
    assert.deepEqual(look(host), { rank: 'E-rank', wearing: 'a shirt', condition: '' });
    await host.send('On.', block('Unranked.', ['~ you rank:']));
    assert.deepEqual(look(host), { rank: '', wearing: 'a shirt', condition: '' });
    // The place, the weather and the people are not touched; the line is hidden like any change line.
    assert.equal(host.sdk.query('scene.place').name, 'Vell Harbour');
    assert.doesNotMatch(host.ctx.chat[lastIndex(host)].mes.replace(/<!--[\s\S]*?-->/g, ''), /\byou\b.*wearing/);
    assert.deepEqual(validateScene(host.head().domains.scene), []);
});

test('over-long text is cut at 120 code points, not refused', async t => {
    const host = await fresh(t);
    await host.send('We walk.', block('Rain.', [`~ you rank: ${'r'.repeat(300)} | wearing: ${'a long coat with many buttons, '.repeat(10)} | condition: ${'𐐷'.repeat(200)}`]));
    const { rank, wearing, condition } = look(host);
    assert.equal(Array.from(rank).length, YOU_CHARS);
    assert.equal(Array.from(wearing).length, YOU_CHARS);
    assert.ok(wearing.endsWith('…'));
    assert.equal(Array.from(condition).length, YOU_CHARS);
    assert.deepEqual(host.turn.problems().filter(item => item.index === lastIndex(host)), [], 'cut, not a Problem');
});

test('refused: a wrong op or no part named; nothing is saved', async t => {
    const host = await fresh(t);
    await host.send('We walk.', block('Rain.', ['~ you wearing: a coat']));
    const before = JSON.stringify(host.head().domains.scene);
    await host.send('On.', block('Nothing.', ['- you wearing: a coat', '~ you hat: red', '~ you']));
    const told = host.turn.problems().filter(item => item.index === lastIndex(host));
    assert.deepEqual(told.map(item => item.code).sort(), ['INVALID', 'INVALID', 'UNREADABLE'], 'a bare "~ you" is not a change line at all');
    const said = line => told.find(item => item.line === line)?.message;
    assert.match(said('- you wearing: a coat'), /use ~ you rank/);
    assert.match(said('~ you hat: red'), /no part of your look/);
    assert.equal(JSON.stringify(host.head().domains.scene), before);
    // captureYou on its own, with a line that carries no raw text (a module's call): the parsed fields are read.
    assert.throws(() => captureYou({ fail: (code, message) => { throw new Error(`${code}: ${message}`); }, draft: () => ({}) }, { op: '!', name: 'wearing: x' }), /INVALID: "!" you|INVALID: "! you"/);
});

// ---------------------------------------------------------------------------------------------------
// The feature

test('the feature: on by default with its grammar line in a byte-identical static part; off: no line, a quiet Problem, null, nothing captured', async t => {
    const host = await fresh(t);
    assert.equal(host.features.on(YOU_FEATURE), true);
    assert.equal(YOU_FEATURE, CORE_FEATURE.you);
    assert.equal(host.features.list().find(feature => feature.id === YOU_FEATURE).label, 'Your look');
    const on = staticText(host);
    const line = on.split('\n').find(item => item.startsWith('~ you '));
    assert.match(line, /^~ you rank: Guild rank \| wearing: what You has on \| condition: how You is \(only when one changes; each at most 120 characters\)$/, '{{user}} is the persona\'s name');
    await host.send('We walk.', block('Rain.', ['~ you wearing: a coat']));
    await host.send('On.', block('Fog.', ['~ you condition: damp']));
    assert.equal(staticText(host), on, 'the same bytes reply to reply, whatever the look');
    host.features.set(YOU_FEATURE, false);
    await host.send('On.', block('Snow.', ['~ you wearing: a hat | rank: Z']));
    const off = staticText(host);
    assert.notEqual(off, on, 'changed once');
    assert.doesNotMatch(off, /~ you /);
    const told = host.turn.problems().filter(item => item.index === lastIndex(host));
    assert.deepEqual(told.map(item => [item.code, item.quiet]), [['FEATURE_OFF', true]]);
    assert.equal(host.sdk.query('scene.you'), null, 'the query is off with it');
    assert.deepEqual(host.head().domains.scene.you, { rank: '', wearing: 'a coat', condition: 'damp' }, 'the line written while off changed nothing');
    assert.equal(look(host), null);
    assert.equal((await host.sdk.command('scene.you', { wearing: 'x' })).ok, false, 'the command is off with it');
    await host.send('On.', 'More snow.');
    assert.equal(staticText(host), off);
    assert.doesNotMatch(tailText(host), /wears|condition/, 'no tail line while off');
    host.features.set(YOU_FEATURE, true);
    await host.send('On.', 'Thaw.');
    assert.equal(staticText(host), on, 'back on: the old bytes');
    assert.deepEqual(look(host), { rank: '', wearing: 'a coat', condition: 'damp' });
});

test('the tail: one line for the narrator, rank first, only the parts that are set, only while the feature is on', async t => {
    const host = await fresh(t);
    await host.send('We walk.', 'We walk on.');
    assert.doesNotMatch(tailText(host), /wears|condition|rank/, 'nothing set: no line');
    await host.send('On.', block('Rain.', ['~ you rank: F-rank | wearing: oilskin coat | condition: tired']));
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^You: Guild rank F-rank; wears oilskin coat; condition tired$/m, '{{user}} becomes the persona\'s name');
    await host.send('On.', block('Bare.', ['~ you wearing:']));
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^You: Guild rank F-rank; condition tired$/m);
    await host.send('On.', block('Bare.', ['~ you rank: | wearing: a shirt | condition:']));
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^You: wears a shirt$/m);
    host.features.set(YOU_FEATURE, false);
    await host.send('On.', 'On.');
    assert.doesNotMatch(tailText(host), /wears/);
    // As pure data: with `you` on, after the Place and Present lines; empty parts left out; off by default of the function.
    const state = { domains: { scene: { ...initialScene(), place: { name: 'Vell Harbour', kind: '', region: '' }, present: ['Ren'], you: { rank: '', wearing: 'a coat', condition: '' } } } };
    assert.deepEqual(sceneTail(state, { you: true }), ['Place: Vell Harbour', 'Present: Ren', '{{user}}: wears a coat']);
    assert.deepEqual(sceneTail({ domains: { scene: { ...state.domains.scene, you: { rank: 'F', wearing: 'a coat', condition: '' } } } }, { you: true }), ['Place: Vell Harbour', 'Present: Ren', '{{user}}: wears a coat'], 'a rank with no pack that gives one is not told');
    assert.deepEqual(sceneTail(state), ['Place: Vell Harbour', 'Present: Ren']);
    assert.deepEqual(sceneTail({ domains: { scene: { ...initialScene(), you: NONE } } }, { you: true }), []);
    assert.deepEqual(sceneTail({ domains: { scene: { ...initialScene(), you: { condition: 'hurt', rank: 'F' } } } }, { you: true, rankLabel: 'Guild rank' }), ['{{user}}: Guild rank F; condition hurt']);
});

// ---------------------------------------------------------------------------------------------------
// The reader's edit

test('scene.you from the reader: each part replaces its own, empty clears, long is cut; the story is refused; an edit is marked', async t => {
    const host = await fresh(t);
    const run = payload => host.sdk.command('scene.you', payload);
    const first = await run({ rank: 'F-rank', wearing: 'a grey coat' });
    assert.equal(first.ok, true, first.message);
    assert.equal(first.receipt.data.edit, true);
    assert.equal(first.receipt.narrate, false);
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: 'a grey coat', condition: '' });
    assert.equal((await run({ condition: 'tired' })).ok, true);
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: 'a grey coat', condition: 'tired' });
    assert.equal((await run({ wearing: '' })).ok, true);
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: '', condition: 'tired' });
    assert.equal((await run({ rank: '' })).ok, true);
    assert.deepEqual(look(host), { rank: '', wearing: '', condition: 'tired' });
    assert.equal((await run({ wearing: `<i>${'w'.repeat(200)}</i>` })).ok, true);
    assert.equal(Array.from(look(host).wearing).length, YOU_CHARS);
    assert.equal(look(host).wearing.includes('<'), false);
    const same = await run({ condition: 'tired' });
    assert.equal(same.ok, true);
    assert.equal(same.receipt.data.same, true, 'the same again changes nothing');
    assert.equal((await run({})).ok, false, 'nothing to set');
    assert.equal((await run({ wearing: 4 })).ok, false, 'text only');
    assert.equal((await run({ rank: 4 })).ok, false, 'text only');
    assert.deepEqual(validateScene(host.head().domains.scene), []);
    // A module's call is the same command; the story itself writes `~ you` and is refused the command.
    const ctxFail = [];
    const { sceneCommands } = await import('../../../src/v2/domains/scene.js');
    const refused = (() => {
        try { sceneCommands['scene.you']({ cause: 'story', fail: (code, message) => { ctxFail.push(code); throw new Error(message); }, draft: () => ({}) }, { wearing: 'x' }); } catch (error) { return error.message; }
        return '';
    })();
    assert.deepEqual(ctxFail, ['REFUSED']);
    assert.match(refused, /~ you line/);
});

// ---------------------------------------------------------------------------------------------------
// Replay: Re-read, swipes, a middle delete, a reload

test('Re-read, swipes, a middle delete and a reload keep the look as a rebuild does, each part from the replies still there', async t => {
    const host = await fresh(t);
    await host.send('We walk.', block('Rain.', ['~ you rank: F-rank | wearing: a coat | condition: wet']));
    const first = lastIndex(host);
    await host.send('On.', block('Fog.', ['~ you condition: chilled']));
    const second = lastIndex(host);
    // Re-read of the unchanged reply.
    assert.equal((await host.turn.reread(second)).ok, true);
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: 'a coat', condition: 'chilled' });
    // A swipe has its own look; the other swipe without one rolls back to the reply before.
    await host.swipe(block('Sun.', ['~ you wearing: a straw hat']));
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: 'a straw hat', condition: 'wet' });
    await host.swipe('No change this time.');
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: 'a coat', condition: 'wet' });
    await host.st.swipeTo(second, 0);
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: 'a coat', condition: 'chilled' });
    checkInvariants(host, 'after the swipes');
    // Deleting the reply that first wrote the look: the later reply's part replays, the first's other part is gone with it.
    await host.st.deleteMessage(first);
    await host.st.deleteMessage(first - 1);
    assert.deepEqual(host.store.problems(), [], 'nothing skipped');
    assert.deepEqual(look(host), { rank: '', wearing: '', condition: 'chilled' });
    assert.deepEqual(validateScene(host.head().domains.scene), []);
    checkInvariants(host, 'after the middle delete');
    // Deleting the last one: nothing again.
    await host.st.deleteMessage(lastIndex(host));
    assert.deepEqual(look(host), NONE);
    // A fresh host over the saved chat (a reload) reads the same.
    await host.send('On.', block('Hail.', ['~ you rank: E-rank | wearing: a hood | condition: damp']));
    const other = await createHost({ st: { chat: host.ctx.chat, extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => other.close());
    assert.deepEqual(look(other), { rank: 'E-rank', wearing: 'a hood', condition: 'damp' });
    assert.deepEqual(other.head(), host.head());
});

test('an older chat with no look in its state reads empty, validates, and takes the first line', async t => {
    const host = await fresh(t);
    assert.equal('you' in host.head().domains.scene, false);
    assert.deepEqual(validateScene(host.head().domains.scene), []);
    assert.deepEqual(look(host), NONE);
    const other = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => other.close());
    await other.send('On.', block('Rain.', ['~ you condition: soaked']));
    assert.deepEqual(look(other), { rank: '', wearing: '', condition: 'soaked' });
});

// ---------------------------------------------------------------------------------------------------
// Home: the header's rows

test('the game view\'s header: props from the query (none while the feature is off or with no query), Wearing and Condition rows as plain lines, edited in the header\'s one editor', async t => {
    // The props: null query answer → no `you` at all.
    const props = answer => gameHeroProps({ state: { meta: { rev: 1 } }, query: name => (name === 'scene.you' ? answer : null) });
    assert.equal('you' in props(null), false);
    assert.equal(props({ rank: 'F', rankLabel: 'Guild rank', wearing: '', condition: '' }).you.rankLabel, 'Guild rank');
    assert.equal('you' in gameHeroProps({ state: { meta: { rev: 1 } }, query: () => { throw new Error('no query'); } }), false);
    assert.deepEqual(props({ rank: ' F ', rankLabel: 'Guild rank', wearing: ' a coat ', condition: '' }).you, { rank: 'F', rankLabel: 'Guild rank', wearing: 'a coat', condition: '', command: 'scene.you' });
    assert.deepEqual(props({ wearing: ' a coat ', condition: '' }).you, { wearing: 'a coat', condition: '', command: 'scene.you' }, 'no pack that gives a Rank: no rank part');
    assert.equal(props({ wearing: 'x'.repeat(300), condition: 'y' }).you.wearing.length, 120);

    const doc = setupDom(), form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const host = await createHost();
    assert.equal((await host.packs.packs.install(rankPack())).ok, true);
    const ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Look.', 'A quiet road.');
    assert.equal(ui.mounts.screen.open('story-block/home'), true);
    const row = () => doc.querySelector('.ss-gameview-hero .ss-hero-you');
    const part = name => row()?.querySelector(`.ss-hero-you-part[data-part="${name}"]`);
    // Nothing set yet: the rows are there with a dash (the header's Edit button sets them).
    assert.ok(row(), 'the rows are drawn while both are empty');
    assert.deepEqual(['rank', 'wearing', 'condition'].map(name => part(name).querySelector('.ss-hero-you-label').textContent), ['Guild rank', 'Wearing', 'Condition']);
    assert.deepEqual(['rank', 'wearing', 'condition'].map(name => part(name).querySelector('.ss-hero-you-text').textContent), ['—', '—', '—']);
    assert.deepEqual(row().querySelectorAll('.ss-hero-you-part').map(item => item.getAttribute('data-part')), ['rank', 'wearing', 'condition'], 'Rank first');
    assert.equal(row().querySelectorAll('button').length, 0, 'the rows are plain lines: no pencil (UI cleanup, Nov 2)');
    // The editor's Character group: Guild rank (the pack's word), Wearing, Condition.
    const editor = () => doc.querySelector('.ss-gameview-hero .ss-hero-editor');
    const field = label => editor().querySelectorAll('label').find(each => each.querySelector('span').textContent === label)?.querySelector('input');
    doc.querySelector('.ss-gameview-hero .ss-hero-edit').click();
    assert.deepEqual(editor().querySelectorAll('legend').map(node => node.textContent), ['Story', 'Character']);
    assert.deepEqual(['Guild rank', 'Wearing', 'Condition'].map(label => field(label)?.value), ['', '', '']);
    editor().querySelector('.ss-w-editable-cancel').click();
    // The story sets them: the rows show the words.
    await host.send('We walk.', block('Rain.', ['~ you rank: F-rank | wearing: oilskin coat, boots | condition: tired, cold']));
    assert.equal(part('rank').querySelector('.ss-hero-you-text').textContent, 'F-rank');
    assert.equal(part('wearing').querySelector('.ss-hero-you-text').textContent, 'oilskin coat, boots');
    assert.equal(part('condition').querySelector('.ss-hero-you-text').textContent, 'tired, cold');
    // The editor: one `scene.you` edit for the part that changed, and the row follows.
    doc.querySelector('.ss-gameview-hero .ss-hero-edit').click();
    assert.deepEqual(['Guild rank', 'Wearing', 'Condition'].map(label => field(label).value), ['F-rank', 'oilskin coat, boots', 'tired, cold']);
    field('Condition').value = 'rested';
    editor().querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: 'oilskin coat, boots', condition: 'rested' });
    assert.equal(host.store.receipts().at(-1)?.receipt?.type ?? host.store.receipts().at(-1)?.type, 'scene.you');
    assert.equal(part('condition').querySelector('.ss-hero-you-text').textContent, 'rested');
    // An empty save clears the part.
    doc.querySelector('.ss-gameview-hero .ss-hero-edit').click();
    field('Wearing').value = '';
    editor().querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(look(host), { rank: 'F-rank', wearing: '', condition: 'rested' });
    assert.equal(part('wearing').querySelector('.ss-hero-you-text').textContent, '—');
    // Off: no rows at all; on again: they return.
    host.features.set(YOU_FEATURE, false);
    assert.equal(row()?.hidden ?? true, true, 'hidden while the feature is off');
    host.features.set(YOU_FEATURE, true);
    assert.equal(row().hidden, false);
    assert.equal(part('condition').querySelector('.ss-hero-you-text').textContent, 'rested');
});

// ---------------------------------------------------------------------------------------------------
// Rank comes from a pack (`content.you.rank`): other kinds of game have none

test('no pack gives a Rank: none anywhere (no grammar word, no answer, no tail word, no Home line); `~ you rank:` drops only the rank part; the rest works', async t => {
    const host = await fresh(t, { rank: false });
    assert.equal(host.sdk.query('packs.youRank'), null);
    const line = staticText(host).split('\n').find(item => item.startsWith('~ you '));
    assert.equal(line, '~ you wearing: what You has on | condition: how You is (only when one changes; each at most 120 characters)');
    assert.doesNotMatch(staticText(host), /rank/i, 'the instructions never say rank');
    assert.deepEqual(host.sdk.query('scene.you'), { wearing: '', condition: '' }, 'no rank, no label in the answer');
    await host.send('We walk.', block('Rain.', ['~ you rank: F-rank | wearing: a coat']));
    const told = host.turn.problems().filter(item => item.index === lastIndex(host));
    assert.equal(told.length, 1, 'one plain Problem');
    assert.match(told[0].message, /This story has no rank/);
    assert.deepEqual(host.sdk.query('scene.you'), { wearing: 'a coat', condition: '' }, 'only the rank part was left out: the wearing is kept');
    assert.equal(host.head().domains.scene.you.rank, '', 'no rank saved');
    // The rank alone is still refused whole (nothing to keep).
    await host.send('Rain.', block('Rain.', ['~ you rank: F-rank']));
    assert.equal(host.turn.problems().filter(item => item.index === lastIndex(host)).length, 1);
    assert.deepEqual(host.sdk.query('scene.you'), { wearing: 'a coat', condition: '' });
    await host.send('On.', block('Rain.', ['~ you wearing: a coat | condition: wet']));
    assert.deepEqual(host.sdk.query('scene.you'), { wearing: 'a coat', condition: 'wet' });
    // An empty rank part, wearing and condition: wearing and condition apply, the rank part is one Problem.
    await host.send('On.', block('Rain.', ['~ you rank: | wearing: a hat | condition: dry']));
    assert.equal(host.turn.problems().filter(item => item.index === lastIndex(host)).length, 1);
    assert.deepEqual(host.sdk.query('scene.you'), { wearing: 'a hat', condition: 'dry' });
    await host.send('On.', block('Rain.', ['~ you wearing: a coat | condition: wet']));
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^You: wears a coat; condition wet$/m);
    assert.doesNotMatch(tailText(host), /rank/i);
    const refused = await host.sdk.command('scene.you', { rank: 'F-rank' });
    assert.equal(refused.ok, false, 'the reader\'s pencil does not exist either: the command refuses');
    assert.match(refused.message, /no rank/);
    assert.equal((await host.sdk.command('scene.you', { wearing: 'a hat' })).ok, true);
    // The header has no Rank part.
    assert.equal('rank' in gameHeroProps({ state: { meta: { rev: 1 } }, query: () => host.sdk.query('scene.you') }).you, false);
});

test('a pack with content.you.rank gives the Rank its word everywhere; the first enabled pack that has one wins; turned off, the Rank is hidden and its value kept', async t => {
    const host = await fresh(t, { rank: false });
    assert.equal((await host.packs.packs.install(rankPack('first', 'Guild rank'))).ok, true);
    assert.equal((await host.packs.packs.install(rankPack('second', 'Standing'))).ok, true);
    assert.deepEqual(host.sdk.query('packs.youRank'), { pack: 'first', label: 'Guild rank' }, 'the first enabled pack wins');
    await host.send('We walk.', block('Rain.', ['~ you rank: F-rank, Adventurer Guild | wearing: a coat']));
    assert.deepEqual(host.sdk.query('scene.you'), { rank: 'F-rank, Adventurer Guild', rankLabel: 'Guild rank', wearing: 'a coat', condition: '' });
    assert.equal(staticText(host).split('\n').find(item => item.startsWith('~ you ')), '~ you rank: Guild rank | wearing: what You has on | condition: how You is (only when one changes; each at most 120 characters)');
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^You: Guild rank F-rank, Adventurer Guild; wears a coat$/m);
    // The first pack off: the next one's word; both off: no Rank (the instructions change back), the value stays stored.
    assert.equal(await host.packs.packs.setEnabled('first', false), true);
    assert.equal(host.sdk.query('scene.you').rankLabel, 'Standing');
    assert.equal(await host.packs.packs.setEnabled('second', false), true);
    assert.deepEqual(host.sdk.query('scene.you'), { wearing: 'a coat', condition: '' });
    await host.send('On.', 'On.');
    assert.doesNotMatch(staticText(host), /rank/i);
    assert.doesNotMatch(tailText(host), /rank/i);
    assert.equal(host.head().domains.scene.you.rank, 'F-rank, Adventurer Guild', 'kept while no pack gives a Rank');
    // Turned on again: it is back.
    assert.equal(await host.packs.packs.setEnabled('first', true), true);
    assert.deepEqual(host.sdk.query('scene.you'), { rank: 'F-rank, Adventurer Guild', rankLabel: 'Guild rank', wearing: 'a coat', condition: '' });
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^You: Guild rank F-rank, Adventurer Guild; wears a coat$/m);
});

test('the Ersveil example pack gives the Rank the word "Guild rank"; its content.you checks like the rest of a pack', async t => {
    const ersveil = JSON.parse(readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8'));
    assert.deepEqual(ersveil.content.you, { rank: { label: 'Guild rank' } });
    const host = await fresh(t, { rank: false });
    assert.equal((await host.packs.packs.install(ersveil)).ok, true);
    assert.deepEqual(host.sdk.query('packs.youRank'), { pack: ersveil.id, label: 'Guild rank' });
    await host.send('I register.', block('The clerk writes it down.', ['~ you rank: F-rank, Adventurer Guild (provisional)']));
    assert.equal(host.sdk.query('scene.you').rankLabel, 'Guild rank');
    assert.equal(host.sdk.query('scene.you').rank, 'F-rank, Adventurer Guild (provisional)');
    // The validator: the shape, the label and unknown keys.
    const check = you => validatePack({ id: 'p', version: '1.0.0', requires: { storyBlock: '^2' }, content: { you } });
    assert.equal(check({ rank: { label: 'Guild rank' } }).ok, true);
    assert.deepEqual(check({ rank: { label: ' Guild   rank ' } }).pack.content.you, { rank: { label: 'Guild rank' } });
    assert.deepEqual(check({}).pack.content.you, {}, 'nothing to opt in to');
    const bad = (you, code, path) => {
        const result = check(you);
        assert.equal(result.ok, false, JSON.stringify(you));
        assert.ok(result.errors.some(error => error.code === code && error.path === path), `${JSON.stringify(you)}: ${JSON.stringify(result.errors.map(error => [error.code, error.path]))}`);
    };
    bad({ rank: { label: 'x'.repeat(31) } }, 'BAD_CONTENT', 'content.you.rank.label');
    bad({ rank: { label: '' } }, 'BAD_CONTENT', 'content.you.rank.label');
    bad({ rank: {} }, 'BAD_CONTENT', 'content.you.rank.label');
    bad({ rank: { label: 5 } }, 'BAD_CONTENT', 'content.you.rank.label');
    bad({ rank: { label: '<b>Rank</b>' } }, 'BAD_CONTENT', 'content.you.rank.label');
    bad({ rank: { label: '{{user}} rank' } }, 'BAD_CONTENT', 'content.you.rank.label');
    bad({ rank: { label: 'Rank', colour: 'red' } }, 'UNKNOWN_FIELD', 'content.you.rank.colour');
    bad({ rank: { label: 'Rank' }, title: 'x' }, 'UNKNOWN_FIELD', 'content.you.title');
    bad({ rank: 'Guild rank' }, 'BAD_CONTENT', 'content.you.rank');
    bad(['rank'], 'BAD_CONTENT', 'content.you');
    // A pack that does not use it normalizes as it always did (no `you` key).
    assert.equal('you' in validatePack({ id: 'p', version: '1.0.0', requires: { storyBlock: '^2' }, content: {} }).pack.content, false);
});
