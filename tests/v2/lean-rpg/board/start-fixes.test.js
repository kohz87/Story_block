// Round 15: fight-start bugs from real play (the bristle-boar contract).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { knownFoeAction } from '../../../../src/v2/lean-rpg/board/action-gate.js';
import { pauseViewData } from '../../../../src/v2/lean-rpg/board/start-view-data.js';
import { buildPanel, panelModel, readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { pendingStart } from '../../../../src/v2/turn/fight-start.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';
import { character, foeBlock, setup, skillBlock } from '../helpers.js';

const A = 'I parked the cart and went around the tree using Obscure and hide under the shadow until the boars appear and approaches as I engage them.';
const B = 'I parked the cart and went around the tree using Obscure and hide under the shadow until the boars appear and approaches as I attack them.';
const boarSheet = { foes: [{ name: 'Bristle-boar', filled: true, hurt: 4 }], characters: [{ skills: [{ name: 'Obscure', about: 'Hide from sight.' }] }] };
const empty = () => ({ hero: { role: 'character', fields: character('Astra', { agi: 20 }) },
    skills: { role: 'skills', fields: skillBlock('Astra', [['Obscure', 2, 'agi', 'stamina', 'hide before the fight']]) },
    foes: { role: 'foes', fields: foeBlock([]) } });
// the planner finds the approach and the boars but gives no act of its own
const approachOnly = ['foe Bristle-boar | new | count: 2 | level: 2', 'check Astra | skill: Obscure | type: check | difficulty: normal | ambush'].join('\n');

test('F1/B2: a stale event opens nothing, and a message with no fight never pops the screen', async t => {
    const app = await page(t, { formula: 'standard' });
    const { host, doc } = app;
    await begin(host);
    await makeBlocks(host, { character: { agi: 20 }, skills: { skill1: 'Obscure', stat1: 'agi', about1: 'hide before a fight' } });
    const foes = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    const opened = () => Boolean(doc.querySelector('[data-ss-screen="story-block/fight"]'));
    host.events.emit('head', { index: host.store.headIndex(), reason: 'fight-start' });
    await settle();
    assert.equal(opened(), false, 'a fight-start event with nothing waiting opens nothing');
    assert.equal((await host.send(A, 'The boars pass by.')).aborted, undefined, 'no fight: the reply is sent');
    await new Promise(resolve => setTimeout(resolve, 5));
    await settle();
    assert.equal(opened(), false, 'still nothing opened');
    assert.equal(doc.querySelector('.rpg-fight-pause'), null);
    assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
});

test('F1: message A with no fight found leaves no pause and sends the reply', async () => {
    const restore = seedCrypto(701), { host } = await setup({ blocks: empty(), board: true, answers: ['none'] });
    try {
        const sent = await host.send(A, 'The boars pass by.');
        assert.equal(sent.aborted, undefined);
        assert.equal(pendingStart(host.ctx.chatMetadata, host.ctx.chat), null);
        assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
    } finally { host.close(); restore(); }
});

test('F2: engage, assault, pounce, fall upon and the rest act on a known foe; talking and walking away do not', () => {
    for (const text of ['I engage them.', 'I engage the boars.', 'I wait, then as I engage them the boar squeals.', 'I assault the boar.', 'I pounce on the boar.', 'I fall upon the boars.',
        'I jump the boar.', 'I charge the boar.', 'I ambush the boars.', 'I lunge at the boar.', 'I attack them.', 'I strike the boar.'])
        assert.equal(knownFoeAction(text, boarSheet), true, text);
    for (const text of ['I talk about engaging the boars.', 'I walk away from the boars.', 'I will not engage them.', 'If I engage them we die.', 'I jump over the cart near the boars.',
        'The boars charge me.', 'I run from the boar.', 'I watch the boars.'])
        assert.equal(knownFoeAction(text, boarSheet), false, text);
});

test('F2: approach checks with new foes but no engaging words stay on the ordinary path', async () => {
    const restore = seedCrypto(703), { host } = await setup({ blocks: empty(), board: true, answers: [approachOnly] });
    try {
        const sent = await host.send('I hide with Obscure and watch the boars.', 'They pass.');
        assert.equal(sent.aborted, undefined);
    } finally { host.close(); restore(); }
});

const fail = { kind: 'check', skill: 'Obscure', ambush: true, pc: { who: 'Astra', stat: 'dex', total: 5 }, dc: 15, outcome: 'fail' };
test('F3: the battle log calls a turn-order lead initiative, and leaves it to the ambush line when the ambush worked', () => {
    const result = { checks: [{ ...fail, kind: 'check' }], rounds: [], order: [], quickStart: [{ who: 'Astra', against: 'Bristle-boar' }], ambush: { who: 'Astra', skill: 'Obscure', outcome: 'fail', success: false, total: 5, dc: 15 } };
    const roles = () => ({ name: 'Astra', party: true });
    const render = value => {
        const model = readResolve(value), panel = buildPanel(setupDom(), panelModel({ resolve: model, state: { domains: { dataModules: { instances: {}, active: {} } } }, before: null, roleOf: roles }));
        return panel;
    };
    try {
        const lost = render(result);
        assert.equal(lost?.querySelector?.('.rpg-bl-quick')?.textContent, 'Astra acts first (initiative) against Bristle-boar.');
        const worked = render({ ...result, ambush: { ...result.ambush, outcome: 'success', success: true } });
        assert.equal(worked?.querySelector?.('.rpg-bl-quick') ?? null, null);
    } catch (error) {
        assert.fail(`battle log render: ${error.message}`);
    }
});

// A fight narrated with no foes line gets one short tail cue on the next reply (turn/fight-start.js fightCue).
const FIGHT = 'He struck down the first cutpurse, slashed the second, and the wounded third ran.';
const dice = '? roll Astra | AGI | normal | 12';
const mes = (story, ...lines) => ({ mes: `${story}\n<Changes>\n${lines.join('\n')}\n</Changes>` });

test('fightCue: a fight in the prose with a roll and no foes line is told; each missing part stops it', async () => {
    const { fightCue, FIGHT_CUE } = await import('../../../../src/v2/turn/fight-start.js');
    assert.equal(fightCue(mes(FIGHT, dice, '+ item Rope')), FIGHT_CUE);
    assert.equal(fightCue(mes(FIGHT, dice, '+ dm foes - Ridge cutpurses x2 | kind: set-slot-1 | level: 3')), null, 'a foes line was written');
    assert.equal(fightCue(mes(FIGHT, dice, '+ dm Ridge cutpurses | kind: set-slot-1 | level: 3')), null, 'a set-slot line was written');
    assert.equal(fightCue(mes(FIGHT, dice), { foesNow: true }), null, 'a foe is already set');
    assert.equal(fightCue(mes(FIGHT, '+ item Rope')), null, 'no roll');
    assert.equal(fightCue(mes('He struck the table and sat down.', dice)), null, 'too few fight words');
    assert.equal(fightCue({ mes: FIGHT }), null, 'no block, no roll');
    assert.equal(fightCue(null), null);
    assert.equal(fightCue(mes('A dead tree leaned by the road, a sword hung over the hearth, and a bolt of lightning split the sky; blood-red dusk, an axe in the shed, arrows on the wall.', '? roll Astra | Stealth | normal | 12')), null, 'scene words and nouns with a Stealth roll are no fight');
});

test('the cue reaches the next reply\'s tail only with the RPG on and no foe set; the static prompt is unchanged', async t => {
    const { createHost } = await import('../../../../testkit/index.js');
    const { CORE_FEATURE } = await import('../../../../src/v2/features.js');
    const { TAIL_KEY, STATIC_KEY } = await import('../../../../src/v2/turn.js');
    const { FIGHT_CUE } = await import('../../../../src/v2/turn/fight-start.js');
    const run = async rpg => {
        const host = await createHost();
        t.after(() => host.close());
        if (rpg) host.features.set(CORE_FEATURE.leanRpg, true);
        await host.send('Begin.', 'Opening.');
        await host.send('I fight.', `${FIGHT}\n<Changes>\n${dice}\n</Changes>`);
        await host.send('Go on.', 'Quiet.');
        const last = key => host.st.promptLog.filter(entry => entry.key === key && entry.value).at(-1)?.value ?? '';
        return { tail: last(TAIL_KEY), staticText: last(STATIC_KEY) };
    };
    const on = await run(true), off = await run(false);
    assert.ok(on.tail.includes(FIGHT_CUE), 'RPG on: told');
    assert.ok(!off.tail.includes(FIGHT_CUE), 'RPG off: not told');
    assert.ok(!on.staticText.includes('under way'), 'the static prompt carries no cue');
});

test('a swipe of the reply after the fight gets the same cue as the first try', async t => {
    const { createHost } = await import('../../../../testkit/index.js');
    const { CORE_FEATURE } = await import('../../../../src/v2/features.js');
    const { TAIL_KEY } = await import('../../../../src/v2/turn.js');
    const { FIGHT_CUE } = await import('../../../../src/v2/turn/fight-start.js');
    const host = await createHost();
    t.after(() => host.close());
    host.features.set(CORE_FEATURE.leanRpg, true);
    await host.send('Begin.', 'Opening.');
    await host.send('I fight.', `${FIGHT}\n<Changes>\n${dice}\n</Changes>`);
    await host.send('Go on.', 'Quiet.');
    const tail = () => host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).at(-1)?.value ?? '';
    assert.ok(tail().includes(FIGHT_CUE), 'the first try: told');
    await host.swipe('Still quiet.');
    assert.ok(tail().includes(FIGHT_CUE), 'the swipe: told too');
    await host.send('And on.', 'Calm.');
    assert.ok(!tail().includes(FIGHT_CUE), 'two replies later: not told');
});

// Stale foes (real run 2, reply 18): a Foes slot set at reply 3 and never touched again must not start a fight from an unrelated attack message 15 replies later.
const SET_BOARS = 'Boars rush out.\n<Changes>\n+ dm foes — a fight starts | kind: set-slot-1 | name: Bristle-boar | count: 3 | level: 3\n</Changes>';
async function staleChat(t, seed, fillers, { oldChat = false } = {}) {
    const restore = seedCrypto(seed);
    t.after(restore);
    const app = await page(t, { formula: 'standard', callModel: async () => 'none' });
    const { host } = app;
    await begin(host);
    await makeBlocks(host, { character: { agi: 20 }, skills: { skill1: 'Obscure', stat1: 'agi', about1: 'hide before a fight' } });
    const foes = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    await host.send('Boars are near.', SET_BOARS);
    for (let n = 0; n < fillers; n += 1) await host.send(`I walk on, step ${n}.`, 'The road goes on.');
    if (oldChat) for (const message of host.ctx.chat) if (message.extra?.storySuite?.rules) message.extra.storySuite.rules = message.extra.storySuite.rules.filter(name => name !== 'foesFresh');
    return app;
}

test('stale foes: 5 replies after the Foes line, an attack message is not held as a fight start', async t => {
    const { host } = await staleChat(t, 711, 5);
    const sent = await host.send('I attack the boar.', 'You swing at the rats.');
    assert.equal(sent.aborted, undefined, 'the message goes out');
    assert.equal(pendingStart(host.ctx.chatMetadata, host.ctx.chat), null);
});

test('stale foes: within 3 replies of the Foes line the attack is still held as a fight start', async t => {
    const { host } = await staleChat(t, 712, 2);
    assert.equal((await host.send('I attack the boar.', 'Not yet.')).aborted, true);
});

test('stale foes: an old chat (no foesFresh mark) keeps holding the attack against old foes', async t => {
    const { host } = await staleChat(t, 713, 5, { oldChat: true });
    assert.equal((await host.send('I attack the boar.', 'Not yet.')).aborted, true);
});

test('stale foes: a new Foes line on the way keeps the foes current', async t => {
    const { host } = await staleChat(t, 714, 4);
    await host.send('More boars.', SET_BOARS);
    assert.equal((await host.send('I attack the boar.', 'Not yet.')).aborted, true);
});
