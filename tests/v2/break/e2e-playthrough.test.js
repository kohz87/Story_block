// A scripted 30-reply Ersveil chat on the real suite (Story Block host + Story Director + NPC State Delta), with fixed reply
// texts that use each repo's own <Changes> grammar: travel and a place change, a six-group fight with a swarm on the board, a
// deed that ripples one power, new named people (a names check and a collision), NPC meters with via: tags (one repeated to
// backfire), a lie and a caught lie, a known secret, a taste, ties, a trust drop, a pulse roll, day changes (Earlier days),
// reputation and guild results, a quest. After every reply: no unexpected Problems, and a rebuild, a cold reload and a Re-read
// of that reply all equal the live state. At the end: a Re-read of every reply, a swipe of the last and a delete of a middle
// reply each equal a cold rebuild of the chat they leave.
// Which checkouts: helpers/suite.js (SUITE_SB / SUITE_SD / SUITE_NSD, else STORY_SUITE_ROOT, else the folders beside this one;
// skipped when Story Director or NPC State Delta is missing). To play against the batch branches:
//   SUITE_SD=<sd checkout> SUITE_NSD=<nsd checkout> node --test tests/v2/break/e2e-playthrough.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSuite, suiteHost } from './helpers/suite.js';

const loaded = await loadSuite();
const skip = loaded.skip ?? false;
const settle = () => new Promise(resolve => setImmediate(resolve));
// The first few paths where two states differ, so a failure names what moved instead of printing two walls of JSON.
function paths(a, b, at = '', out = []) {
    if (out.length >= 6 || JSON.stringify(a) === JSON.stringify(b)) return out;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) paths(a[key], b[key], `${at}/${key}`, out);
    } else out.push(`${at}: ${JSON.stringify(a)?.slice(0, 120)} -> ${JSON.stringify(b)?.slice(0, 120)}`);
    return out;
}
// A Re-read runs the reply's commands again, so the receipt ids it writes are new; everything else must be as it was.
const noIds = value => JSON.parse(JSON.stringify(value).replace(/"rc_[a-z0-9]+"/g, '"rc"'));
const same = (a, b, label) => { const found = paths(a, b); assert.equal(found.length, 0, `${label}\n${found.join('\n')}`); };
const DM = (mod, reason, kind, labels = '') => `+ dm ${mod} — ${reason} | kind: ${kind}${labels ? ` | ${labels}` : ''}`;

// Problems the script means to cause (code → step numbers it may show on). Any other Problem fails the step.
// (None so far: the names check and the backfire raise no Problem; Story Director's names check is not on its main yet.)
const EXPECTED = {};

// One reply each: [player text, story, change lines]. Steps are numbered from 1.
const STEPS = [
    ['We look around the guild office.', 'Dust hangs in the lamplight of the Guild office. A bell rings over the door.', ['~ you rank: unregistered | wearing: oilskin coat, boots | condition: rested', '+ item Bedroll | qty: 1', '+ item Knife | qty: 1', '+ present Sister Temiwa']],
    ['I sign the ledger.', 'Temiwa watches as Astra signs the Guild ledger in a careful hand.', [DM('guild-membership', 'signed the ledger', 'register'), '~ npc Temiwa | trust: +3 | via: help']],
    ['I ask what she needs.', 'The clerk wants the cellar cleared of rats.', ['+ quest Granary Rats — the granary cellar is overrun | goal: clear the cellar | giver: Guild | reward: 5 silver | step: take the key']],
    ['We take the key.', 'The key is cold and heavy.', ['~ quest Granary Rats | step: go down to the cellar', '- item Knife | qty: 1', '+ item Rusty Knife | qty: 1', '~ place Bluewatch Village | kind: settlement']],
    ['I plan the road.', 'Astra counts the days to Auvoth on the frontier road.', ['~ trip Auvoth | by: foot', '! time +3h']],
    ['We walk.', 'The road is dry and the wind steady. By dusk the walls of Auvoth rise ahead.', ['~ place Auvoth | kind: settlement | region: River Confederacy', '~ weather clear, cold wind']],
    ['I look for the Pale Market.', 'Rika sells charms from a barge-stall at the Pale Market.', ['+ present Rika', '~ npc Rika | trust: +2 | via: gift', '+ coin 3 silver | from: Rika']],
    ['I buy bread.', 'Bread, hot and heavy, for two coppers.', ['- coin 2 | to: baker', '+ item Bread | qty: 2']],
    ['I talk to Temiwa about the cellar.', 'Temiwa admits she has no love for cellars.', ['~ taste Temiwa | likes: Honey cakes | from: she says they are her one weakness', '~ tie Temiwa | with: Rika | tag: +ally']],
    ['Rika tells me what she knows.', 'Rika leans close and lowers her voice about the Ledger.', ['~ know Rika | about: Astra | fact: the Grey Ledger watches the Pale Market | how: heard | secret: yes']],
    ['Someone lies to me.', 'Rika swears she never saw the ledger-men.', ['~ lie Rika | to: Astra | said: she never saw the ledger-men']],
    ['I press her.', 'Astra shows the ledger-man\'s receipt and Rika flushes.', ['~ lie Rika | to: Astra | said: she never saw the ledger-men | caught: yes', '~ npc Rika | trust: -6 | via: threat']],
    ['I give Temiwa a kind word.', 'Temiwa smiles into her hands.', ['~ npc Temiwa | trust: +4 | via: praise', '! time +1h']],
    ['I help her carry water.', 'Temiwa stumbles and Astra catches her.', ['~ npc Temiwa | trust: +4 | via: praise', '~ npc Temiwa | affection: +3 | via: help']],
    ['I praise her again.', 'She blushes harder, though the warmth is thin now.', ['~ npc Temiwa | trust: +4 | via: praise']],
    ['I praise her once more.', 'It sounds rehearsed and Temiwa frowns.', ['~ npc Temiwa | trust: +4 | via: praise', '~ npc Temiwa | desire: +2 | via: flirt']],
    ['A stranger arrives.', 'A tall stranger walks in, calling himself Elara.', ['+ present Elara']],
    ['Another Temiwa arrives.', 'A second woman gives her name as Temiwa Voss and sits.', ['+ present Temiwa Voss']],
    ['I leave the market.', 'The market empties as the lamps are lit.', ['- present Elara', '- present Temiwa Voss', '! time +10h']],
    ['I rest at the inn.', 'The night passes and a new day begins in Auvoth.', ['~ place Auvoth Inn | kind: indoors', '! time +9h']],
    ['I ask about the guild.', 'The examiner says the Guild owes Astra a letter.', [DM('guild-membership', 'passed the exam', 'promote', 'letter: E').replace('+', '~'), '~ time Goldwane 14, 8:00 am']],
    ['I tell the story of the cellar.', 'Astra clears the cellar in front of the whole market.', [DM('fame', 'cleared the cellar before a crowd', 'deed', 'region: auvoth | size: notable | witnessed: true'), '- quest Granary Rats — done']],
    ['I repay the Guild.', 'The Guild is pleased with Astra.', [DM('standing', 'finished the grain levy', 'gain', 'faction: guild | size: small')]],
    ['A mob shouts.', 'Astra insults a Highmark envoy; a ripple runs through the court.', [DM('standing', 'insulted the envoy', 'loss', 'faction: highmark | size: small').replace('+', '-'), '? check charisma — talk the crowd down | dc: normal']],
    ['A day passes.', 'Another quiet day, then a letter arrives from Bluewatch.', ['! time +16h', '~ npc Temiwa | trust: -10']],
    ['We find a nest.', 'In the lower tunnels Astra and her party meet six packs of foes.', ['! encounter']],
    ['The fight ends.', 'The tunnel is quiet again, dust settling.', ['~ place Auvoth Tunnels | kind: dungeon', '+ coin 15 | from: the nest']],
    ['We go home.', 'The road back to Bluewatch is long and cold.', ['~ place Bluewatch Village | kind: settlement', '! time +20h']],
    ['I rest by the fire.', 'The story ends for tonight, in the warm and the quiet.', ['~ you condition: warm and tired']],
    ['Morning comes.', 'Gossip about the cellar reaches Bluewatch before breakfast does.', ['! time +6h', '~ weather low fog']],
];

async function playFight(host, hero) {
    const { STANDARD_TEMPLATES } = await loaded.at('src/v2/lean-rpg/templates.js');
    const defs = structuredClone(STANDARD_TEMPLATES.filter(entry => ['character', 'foes'].includes(entry.definition.role)).map(entry => entry.definition));
    const [pc, foes] = [defs.find(d => d.role === 'character'), defs.find(d => d.role === 'foes')];
    pc.slug = 'e2e-hero'; pc.name = 'E2E Hero';
    Object.assign(pc.state.who, { default: hero });
    for (const [key, value] of Object.entries({ str: 14, vit: 20, agi: 20, health: 8, level: 3 })) Object.assign(pc.state[key], { default: value });
    foes.slug = 'e2e-foes'; foes.name = 'E2E Foes';
    [['Cellar Rats', 12, 1], ['Bristle Boars', 3, 1], ['Tunnel Wolves', 2, 2], ['Ledger Crows', 1, 1], ['Hired Knife', 1, 3], ['Gate Goblins', 4, 1]].forEach(([name, count, level], i) => {
        Object.assign(foes.state[`foe${i + 1}`], { default: name }); Object.assign(foes.state[`count${i + 1}`], { default: count });
        Object.assign(foes.state[`level${i + 1}`], { default: level }); Object.assign(foes.state[`hurt${i + 1}`], { default: 4 });
    });
    for (const definition of defs) assert.equal((await host.sdk.command('dm.define', { definition })).ok, true, 'a board sheet is made');
    await stageBoard(host, hero);
}
// Open a board segment on the current head and stage the hero's attack (as the fuzz does before each send of a fight).
async function stageBoard(host, hero) {
    const { STANDARD_FORMULA } = await loaded.at('src/v2/lean-rpg/rules.js');
    const { openBoard, stageExchange } = await loaded.at('src/v2/lean-rpg/board/session.js');
    const opened = openBoard(host.ctx.chatMetadata, host.store.head(), { sid: host.store.carrierSid(host.store.headIndex()), rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
    assert.equal(opened.error, undefined, `the board opens: ${opened.error}`);
    assert.equal(stageExchange(host.ctx.chatMetadata, host.store.head(), [{ who: hero, kind: 'attack', target: 21 }]).error, undefined, 'the exchange stages');
}

const COUNTS = { reads: 0, problems: [] };
async function agree(host, label, index) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    same(JSON.parse(JSON.stringify(host.head())), JSON.parse(live), `${label}: a rebuild equals live`);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    await settle();
    same(JSON.parse(JSON.stringify(host.head())), JSON.parse(live), `${label}: a cold reload equals live`);
    const result = await host.turn.reread(index);
    assert.equal(result?.ok ?? true, true, `${label}: Re-read of ${index} answers ok (${result?.message ?? ''})`);
    same(noIds(host.head()), noIds(JSON.parse(live)), `${label}: a Re-read of reply ${index} equals live`);
    COUNTS.reads += 1;
}
const problemsOf = host => host.turn.problems().map(problem => `${problem.code}: ${String(problem.message ?? '').slice(0, 400)}`);
const unexpected = (list, step) => list.filter(text => !Object.entries(EXPECTED).some(([code, steps]) => text.startsWith(`${code}:`) && steps.includes(step)));

test('E2E: a 30-reply Ersveil playthrough keeps live, rebuild, reload, Re-read, swipe and delete in step', { skip, timeout: 240000 }, async t => {
    assert.equal(STEPS.length, 30, 'thirty scripted replies');
    t.mock.method(console, 'warn', () => {});
    const errors = [];
    t.mock.method(console, 'error', (...args) => { errors.push(args.map(String).join(' ')); });
    const host = await suiteHost(loaded, { seed: 7 });
    t.after(() => host.close());
    for (const id of ['story-block.rpg', 'story-block.gear']) host.features.set(id, true);
    const seen = [], known = new Set(), meters = {};
    // Every failed check is kept and the run goes on, so one run lists everything that is wrong; the test fails at the end if any.
    const failures = [];
    const soft = async (label, fn) => { try { await fn(); } catch (error) { failures.push(`${label}: ${String(error.message).split('\n').slice(0, 5).join(' | ').slice(0, 700)}`); } };
    const first = await host.send('Hello.', host.reply('The story begins at Bluewatch.', []));
    assert.ok(first, 'the opening reply');
    for (const offer of host.sdk.query('dataModules.offers')) {
        const done = await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash, subjects: [] });
        assert.equal(done.ok, true, `pin ${offer.module}: ${done.message}`);
    }
    const replyAt = [];
    for (const [n, [player, story, lines]] of STEPS.map((step, i) => [i + 1, step])) {
        const label = `reply ${n}`;
        if (n === 26) await playFight(host, 'Astra');
        if (n === 27) (await loaded.at('src/v2/lean-rpg/board/session.js')).discardBoard(host.ctx.chatMetadata);   // the reader leaves the fight
        const result = await host.send(player, host.reply(story, lines.filter(line => line !== '! encounter')));
        if (!(result.index >= 0)) {
            failures.push(`${label}: no reply was written (index ${result.index}); notices: ${JSON.stringify(host.st.notices.slice(-2))}; ${Object.keys(result).join(',')}`);
            continue;
        }
        replyAt.push(result.index);
        const list = problemsOf(host).filter(text => !known.has(text));   // the chat's Problems stay listed: only new ones count
        list.forEach(text => known.add(text));
        seen.push([n, list]);
        if (n >= 12 && n <= 16 || n === 25) meters[n] = host.q('npc.meters', { name: 'Temiwa' });
        await soft(label, () => assert.deepEqual(unexpected(list, n), [], 'unexpected Problems'));
        await soft(label, () => assert.deepEqual(errors.splice(0), [], 'something was thrown or logged as an error'));
        await soft(label, () => agree(host, label, result.index));
    }
    // The same praise to Temiwa in replies 13, 14 and 15 must give less each time (NPC State Delta's anti-lever gate).
    await soft('via backfire', () => {
        const gain = (a, b) => meters[b].meters.trust - meters[a].meters.trust;
        assert.ok(gain(14, 15) < gain(12, 13), `the third praise gave ${gain(14, 15)}, the first ${gain(12, 13)} (trust ${[12, 13, 14, 15, 16].map(n => meters[n].meters.trust)})`);
    });
    // The whole run's Problems, by reply, for the report (printed when the run is asked to: E2E_PRINT=1).
    if (process.env.E2E_PRINT) console.log(JSON.stringify(seen.filter(([, list]) => list.length), null, 1), JSON.stringify(meters).slice(0, 3000));
    // At the end: Re-read of every reply, one by one, each leaving the state as it was.
    const live = JSON.stringify(host.head());
    for (const index of replyAt) {
        await soft(`end Re-read ${index}`, async () => {
            const done = await host.turn.reread(index);
            assert.equal(done?.ok ?? true, true, `Re-read ${index}: ${done?.message ?? ''}`);
            same(noIds(host.head()), noIds(JSON.parse(live)), `Re-read of reply ${index} leaves the state as live`);
        });
    }
    // A swipe of the last reply with the same text: the chat, rebuilt cold, gives the head the swipe left.
    await soft('swipe', async () => {
        await host.swipe(host.reply(STEPS[29][1], STEPS[29][2]));
        await settle();
        const afterSwipe = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), afterSwipe, 'after a swipe of the last reply, a rebuild equals live');
        assert.deepEqual(unexpected(problemsOf(host), 30), [], 'a swipe of the last reply: unexpected Problems');
    });
    // A delete of a middle reply (the 15th and its player message): live equals a rebuild and a cold reload of what is left.
    await soft('delete', async () => {
        const at = replyAt[14];
        await host.st.deleteMessage(at);
        await host.st.deleteMessage(at - 1);
        await settle();
        const afterDelete = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), afterDelete, 'after a delete in the middle, a rebuild equals live');
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        assert.equal(JSON.stringify(host.head()), afterDelete, 'after a delete in the middle, a cold reload equals live');
    });
    await soft('end', () => assert.deepEqual(errors, [], 'nothing was thrown or logged as an error'));
    assert.deepEqual(failures, [], `${failures.length} check(s) failed`);
    assert.ok(COUNTS.reads >= 30);
});
