// fix-encounter (user's live test): a reply wrote its `! encounter` line in the story, on its own line
// just before the <Changes> block, and no fight could start: only lines inside the block were read, and
// the line stayed in the shown text with no word about it. A change line written in the story near the
// block (capture.js strayLines) is now read with the block and hidden the same way, narrowly: a whole
// line that starts exactly as a kind's grammar line does and parses. A line close to one that is not
// taken is a Problem. Live, Re-read, swipes, Continue and the rebuild read the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRAY_PARAGRAPHS, extractBlock, grammarHeads, hideBlock, parseChanges, strayLines, stripBlock } from '../../src/v2/capture.js';
import { createStore } from '../../src/v2/store.js';
import { createHost } from '../../testkit/index.js';

const HIDDEN = /<!--\s*STORY_SUITE_V2[\s\S]*?-->/g;
const shown = mes => String(mes).replace(HIDDEN, '');
// Blank lines collapsed: taking a block out leaves the blank lines around it (as before this fix).
const paras = text => String(text).replace(/\n{3,}/g, '\n\n').trim();

// The user's reply (Story Block v2 with Story Director, RPG Battle, NSD and the Ersveil pack), as the
// model wrote it: the encounter line in the story, then the block.
const ENCOUNTER = '! encounter 8 Weir Rat — cellar pack | tier: weak | stakes: normal';
const REPLY = [
    'Minke pressed the iron key into your palm. "Cellar\'s under the Watch Granary. Mind the stairs."',
    '',
    'The stairs went down into the cool dark. The cellar was full of rats.',
    '',
    'None of them ran.',
    '',
    'Dozens of them sat upright on the burst sacks, their greasy grey flanks twitching in unison. Long, scabby tails dragged through the damp dust, scraping stone with a faint, dry drag. A cluster of eight huddled atop a burst hemp bale directly beneath the center tie-beam, their round black eyes fixed entirely on the bottom of the steps, whiskers quivering as their blunt snouts lifted toward the open air.',
    '',
    ENCOUNTER,
    '',
    '<Changes>',
    '+ quest Watch Granary Rats — clear the cellar | giver: Minke | goal: bring 40 rat tails to gate wardens | reward: 5 copper per dozen | due: Goldwane 13 | difficulty: easy',
    '~ place Watch Granary | kind: settlement | region: River Confederacy | with: Astra',
    '- present Minke',
    '</Changes>',
].join('\n');

// Stand-ins for RPG Battle's encounter and Story Director's quest: an offer and a quest per line,
// keyed by name (this repo's tests run without the other modules).
const fights = {
    id: 'fights',
    domains: { fights: { initial: () => ({ offers: {}, quests: {} }) } },
    capture: {
        kinds: {
            encounter: { grammar: '! encounter 3 Wolf — circling the camp | tier: trivial|weak|even|strong|deadly | stakes: normal|death' },
            quest: { grammar: '+ quest Name — what it is | giver: Name | goal: what to do' },
        },
        apply(ctx, line) {
            const state = ctx.draft('fights');
            if (line.kind === 'quest') {
                state.quests[line.name] = { giver: line.labels.giver ?? '' };
                return { summary: `Quest: ${line.name}.` };
            }
            const found = /^(\d+)\s+(.+)$/.exec(line.name);
            if (!found) ctx.fail('INVALID', `No foe could be read from "${line.name}".`);
            state.offers[found[2]] = { count: Number(found[1]), tier: line.labels.tier ?? 'even', at: ctx.query('scene.place')?.name ?? null };
            return { summary: `A fight with ${found[1]} ${found[2]} is offered.` };
        },
    },
    queries: { 'fights.offers': state => structuredClone(state.domains.fights.offers) },
};

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [fights] });
    t.after(() => host.close());
    await host.send('Hello.', 'The road to the Watch Granary.');
    return host;
}
const offers = host => host.head().domains.fights.offers;
const strays = host => host.turn.problems().filter(item => item.code === 'STRAY');
function rebuilt(host) {
    return createStore({ chat: () => host.ctx.chat, save: () => {} }).head();
}

test('the user\'s reply: the encounter line in the story makes the offer, is hidden, and Re-read and the rebuild agree', async t => {
    const host = await fresh(t);
    await host.send('I take the key and go down.', REPLY);
    const last = host.ctx.chat.length - 1;
    const mes = host.ctx.chat[last].mes;
    assert.deepEqual(Object.keys(offers(host)), ['Weir Rat'], 'the fight is offered');
    assert.equal(offers(host)['Weir Rat'].count, 8);
    assert.equal(offers(host)['Weir Rat'].tier, 'weak');
    assert.ok(host.head().domains.fights.quests['Watch Granary Rats'], 'the block\'s lines are read as before');
    assert.doesNotMatch(shown(mes), /encounter/, `the line is gone from the shown text: ${shown(mes)}`);
    assert.doesNotMatch(shown(mes), /<Changes>/);
    assert.ok(shown(mes).trimEnd().endsWith('toward the open air.'), 'the story ends where it did');
    assert.doesNotMatch(shown(mes), /\n\s*\n\s*\n/, 'no blank lines are left where the line stood');
    assert.deepEqual(parseChanges(extractBlock(mes)).lines.map(line => line.kind), ['quest', 'place', 'present', 'encounter'], 'kept hidden for Re-read, after the block');
    assert.deepEqual(strays(host), []);

    const live = structuredClone(host.head());
    assert.deepEqual(rebuilt(host), live, 'the rebuild from the records equals the live state');
    const again = await host.turn.reread(last);
    assert.equal(again.ok, true, again.message);
    assert.deepEqual(again.problems, []);
    assert.deepEqual(host.head(), live, 'Re-read reads what the live capture read');
    assert.equal(host.ctx.chat[last].mes, mes, 'and leaves the text as it was');
});

test('a reply saved before the fix (the line shown, the block hidden): Re-read takes the line and hides it', async t => {
    const host = await fresh(t);
    await host.send('I go down.', 'The cellar.');
    const last = host.ctx.chat.length - 1;
    // What the user's chat holds: the bare block was hidden, the encounter line was left in the story.
    const block = REPLY.indexOf('<Changes>');
    const saved = `${REPLY.slice(0, block).trimEnd()}\n\n<!-- STORY_SUITE_V2\n${REPLY.slice(block)}\n-->`;
    await host.st.editMessage(last, saved);
    const done = await host.turn.reread(last);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(Object.keys(offers(host)), ['Weir Rat']);
    const mes = host.ctx.chat[last].mes;
    assert.doesNotMatch(shown(mes), /encounter/);
    const once = structuredClone(host.head());
    assert.equal((await host.turn.reread(last)).ok, true);
    assert.deepEqual(host.head(), once, 'a second Re-read reads the same');
    assert.equal(host.ctx.chat[last].mes, mes);
    assert.deepEqual(rebuilt(host), once);
});

test('a reply with no block, ending in a change line: read and hidden', async t => {
    const host = await fresh(t);
    await host.send('Go.', `Wolves circle the camp.\n\n${'! encounter 3 Timber Wolf — circling | tier: even'}`);
    assert.deepEqual(offers(host), { 'Timber Wolf': { count: 3, tier: 'even', at: '' } });
    const mes = host.ctx.chat.at(-1).mes;
    assert.equal(shown(mes).trim(), 'Wolves circle the camp.');
    assert.equal(extractBlock(mes), '! encounter 3 Timber Wolf — circling | tier: even');
});

test('prose that only mentions an encounter, or writes a line like one inside a sentence, is never taken', async t => {
    const host = await fresh(t);
    const prose = [
        'The encounter with the rats was brief.',
        '',
        'He shouted "! encounter 3 Wolf" as a joke, and nobody laughed.',
        '',
        'Encounter 3 Wolf — circling the camp | tier: weak',
        '',
        'What she had on her:',
        '- coin purse with a hole in it',
        '- present for her mother',
        '- a lantern',
        '',
        '<Changes>',
        '~ place Watch Granary',
        '</Changes>',
    ].join('\n');
    await host.send('Go.', prose);
    assert.deepEqual(offers(host), {});
    const mes = host.ctx.chat.at(-1).mes;
    for (const line of ['The encounter with the rats was brief.', '"! encounter 3 Wolf"', 'Encounter 3 Wolf', '- coin purse with a hole in it', '- present for her mother']) {
        assert.ok(shown(mes).includes(line), `"${line}" stays in the story`);
    }
    assert.deepEqual(parseChanges(extractBlock(mes)).lines.map(line => line.raw), ['~ place Watch Granary']);
    // The bullets in a story paragraph are told (they look like lines), the mentions are not.
    assert.deepEqual(strays(host).map(item => item.line), ['- coin purse with a hole in it', '- present for her mother']);
    assert.equal(host.head().domains.inventory.wallets.party?.coin ?? 0, 0, 'no coin from a bullet');
});

test('a line close to the grammar is not taken; a Problem says why and the line stays shown', async t => {
    const host = await fresh(t);
    const close = ['! Encounter 8 Weir Rat | tier: weak', '+ encounter 8 Weir Rat | tier: weak', '!encounter 8 Weir Rat | tier: weak', '! encounter: 8 Weir Rat | tier: weak'];
    await host.send('Go.', `The rats wait.\n\n${close.join('\n')}\n\n<Changes>\n~ place Watch Granary\n</Changes>`);
    assert.deepEqual(offers(host), {});
    const told = strays(host);
    assert.deepEqual(told.map(item => item.line), close);
    for (const item of told) {
        assert.equal(item.index, host.ctx.chat.length - 1);
        assert.match(item.message, /was not used: it is in the story and does not start the way a encounter line does \("! encounter …"\); change lines go inside the <Changes> block/);
    }
    for (const line of close) assert.ok(shown(host.ctx.chat.at(-1).mes).includes(line));
    const turn = [];
    host.events.on('turn', event => turn.push(event));
    await host.turn.reread(host.ctx.chat.length - 1);
    assert.equal(turn[0].problems.filter(item => item.code === 'STRAY').length, close.length, 'Re-read tells them again');
});

test(`a change line further up than the last ${STRAY_PARAGRAPHS} story paragraphs is a Problem, not a change`, async t => {
    const host = await fresh(t);
    const far = ['Wolves.', '', ENCOUNTER, '', 'One.', '', 'Two.', '', 'Three.', '', 'Four.', '', '<Changes>', '~ place Watch Granary', '</Changes>'].join('\n');
    await host.send('Go.', far);
    assert.deepEqual(offers(host), {});
    assert.deepEqual(strays(host).map(item => item.line), [ENCOUNTER]);
    assert.match(strays(host)[0].message, /far from the end of the reply/);
    // Three story paragraphs back is still near; a paragraph of change lines is not counted.
    const near = ['Wolves.', '', ENCOUNTER, '', '+ quest Rats — the cellar', '', 'One.', '', 'Two.', '', 'Three.', '', '<Changes>', '~ place Watch Granary', '</Changes>'].join('\n');
    await host.swipe(near);
    assert.deepEqual(Object.keys(offers(host)), ['Weir Rat']);
    assert.ok(host.head().domains.fights.quests.Rats);
});

test('swipes: each swipe reads its own lines; swiping back restores the offer', async t => {
    const host = await fresh(t);
    await host.send('Go.', REPLY);
    const last = host.ctx.chat.length - 1;
    assert.deepEqual(Object.keys(offers(host)), ['Weir Rat']);
    await host.swipe('The cellar is quiet.\n\n<Changes>\n~ place Watch Granary\n</Changes>');
    assert.deepEqual(offers(host), {});
    await host.st.swipeTo(last, 0);
    host.store.rebuild();
    assert.deepEqual(Object.keys(offers(host)), ['Weir Rat']);
    assert.deepEqual(rebuilt(host), host.head());
});

test('Continue: a change line in the added text is read once; the old text is not read again', async t => {
    const host = await fresh(t);
    await host.send('Go.', 'The rats watch.\n\n<Changes>\n~ place Watch Granary\n</Changes>');
    const last = host.ctx.chat.length - 1;
    await host.cont(`\n\nThey rise as one.\n\n${ENCOUNTER}`);
    assert.deepEqual(Object.keys(offers(host)), ['Weir Rat']);
    const mes = host.ctx.chat[last].mes;
    assert.doesNotMatch(shown(mes), /encounter/);
    await host.cont('\n\nA squeak.');
    assert.equal(offers(host)['Weir Rat'].count, 8, 'not read twice');
    const live = structuredClone(host.head());
    assert.deepEqual(rebuilt(host), live);
    assert.equal((await host.turn.reread(last)).ok, true);
    assert.deepEqual(host.head(), live, 'Re-read after the Continues reads the same');
});

test('a reply the reader stopped: its unfinished last line is not taken', async t => {
    const host = await fresh(t);
    await host.send('Go.', 'The rats.\n\n! encounter 8 Weir R', { stopped: true });
    assert.deepEqual(offers(host), {});
    assert.match(strays(host)[0]?.message ?? '', /stopped in the middle of it/);
    assert.ok(shown(host.ctx.chat.at(-1).mes).includes('! encounter 8 Weir R'));
});

test('a kind whose feature is off has no head: its line stays in the story', async t => {
    t.mock.method(console, 'warn', () => {});
    const gated = { ...fights, features: [{ id: 'fights.on', label: 'Fights', describe: 'Fights.', default: true }], capture: { ...fights.capture, kinds: { ...fights.capture.kinds, encounter: { ...fights.capture.kinds.encounter, feature: 'fights.on' } } } };
    const host = await createHost({ modules: [gated] });
    t.after(() => host.close());
    host.features.set('fights.on', false);
    await host.send('Go.', `Rats.\n\n${ENCOUNTER}`);
    assert.deepEqual(offers(host), {});
    assert.ok(shown(host.ctx.chat.at(-1).mes).includes(ENCOUNTER));
});

test('grammarHeads: every op a grammar line writes for its kind, nothing else', () => {
    const heads = grammarHeads([
        { kind: 'encounter', grammar: '! encounter 3 Wolf — circling the camp | tier: weak' },
        { kind: 'present', grammar: '+ present Name when someone arrives, - present Name when they leave' },
        { kind: 'coin', grammar: '+ coin 30 | from: who (- coin 5 | to: who when paid)' },
        { kind: 'market', grammar: '! market <place> — what is short; ~ market <place> — supplies back' },
        { kind: 'npc', grammar: '~ npc Name | trust: +N | affection: -N' },
    ]);
    assert.deepEqual([...heads].sort(), ['! encounter', '! market', '+ coin', '+ present', '- coin', '- present', '~ market', '~ npc']);
});

test('strayLines, extractBlock, hideBlock and stripBlock agree, and without heads nothing changes', () => {
    const heads = grammarHeads([{ kind: 'encounter', grammar: '! encounter 3 Wolf' }, { kind: 'present', grammar: '+ present Name, - present Name' }]);
    const mes = `Story.\n\n**${ENCOUNTER}**\n- present Minke\n\n<Changes>\n~ place Granary\n</Changes>\n\nAfter.\n\n+ present Astra`;
    const found = strayLines(mes, heads);
    assert.deepEqual(found.taken.map(line => line.line), [`**${ENCOUNTER}**`, '- present Minke', '+ present Astra']);
    assert.deepEqual(found.problems, []);
    const body = extractBlock(mes, 'Changes', null, { heads });
    assert.deepEqual(parseChanges(body).lines.map(line => `${line.op} ${line.kind}`), ['~ place', '! encounter', '- present', '+ present']);
    const hidden = hideBlock(mes, 'Changes', { heads });
    assert.equal(paras(shown(hidden)), 'Story.\n\nAfter.');
    assert.equal(extractBlock(hidden), body, 'the hidden text reads the same without heads');
    assert.equal(extractBlock(hidden, 'Changes', null, { heads }), body);
    assert.equal(paras(stripBlock(mes, 'Changes', { heads })), 'Story.\n\nAfter.');
    // Without heads (the prompt history, other readers): as before.
    assert.equal(extractBlock(mes), '~ place Granary');
    assert.ok(stripBlock(mes).includes(ENCOUNTER));
    // Reasoning is not story: a line drafted in it is not taken.
    assert.deepEqual(strayLines(`<think>\n${ENCOUNTER}\n</think>\nStory.`, heads).taken, []);
});
