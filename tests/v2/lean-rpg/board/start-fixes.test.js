// Round 15: four fight-start bugs from real play (the bristle-boar contract).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { knownFoeAction } from '../../../../src/v2/lean-rpg/board/action-gate.js';
import { pauseViewData } from '../../../../src/v2/lean-rpg/board/start-view-data.js';
import { buildPanel, panelModel, readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { boardSession, markSend, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { pendingStart } from '../../../../src/v2/turn/fight-start.js';
import { dropOf } from '../../../../src/v2/lean-rpg/ambush.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';
import { character, foeBlock, setup, skillBlock } from '../helpers.js';

const A = 'I parked the cart and went around the tree using Obscure and hide under the shadow until the boars appear and approaches as I engage them.';
const B = 'I parked the cart and went around the tree using Obscure and hide under the shadow until the boars appear and approaches as I attack them.';
const boarSheet = { foes: [{ name: 'Bristle-boar', filled: true, hurt: 4 }], characters: [{ skills: [{ name: 'Obscure', about: 'Hide from sight.' }] }] };
const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const empty = () => ({ hero: { role: 'character', fields: character('Astra', { agi: 20 }) },
    skills: { role: 'skills', fields: skillBlock('Astra', [['Obscure', 2, 'agi', 'stamina', 'hide before the fight']]) },
    foes: { role: 'foes', fields: foeBlock([]) } });
// the planner finds the approach and the boars but gives no act of its own
const approachOnly = ['foe Bristle-boar | new | count: 2 | level: 2', 'check Astra | skill: Obscure | type: check | difficulty: normal | ambush'].join('\n');

test('F1/B2: a stale event opens nothing; the planner wait opens nothing, shows on the Fight tab dot, and a message with no fight never pops the screen', async t => {
    let finish;
    const callModel = () => new Promise(resolve => { finish = resolve; });
    const app = await page(t, { formula: 'standard', callModel });
    const { host, doc } = app;
    await begin(host);
    await makeBlocks(host, { character: { agi: 20 }, skills: { skill1: 'Obscure', stat1: 'agi', about1: 'hide before a fight' } });
    const foes = structuredClone(LEAN_RPG_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    const opened = () => Boolean(doc.querySelector('[data-ss-screen="story-block/fight"]'));
    host.events.emit('head', { index: host.store.headIndex(), reason: 'fight-start' });
    await settle();
    assert.equal(opened(), false, 'a fight-start event with nothing waiting opens nothing');
    const sending = host.send(A, 'The boars pass by.');
    await settle();
    assert.equal(opened(), false, 'the planner wait does not open the Fight screen');
    assert.equal(doc.querySelector('.rpg-fight-pause'), null);
    assert.ok(doc.querySelector('.ss-screenbar-alert'), 'the wait shows on the Fight tab dot');
    finish('none');
    assert.equal((await sending).aborted, undefined, 'no fight: the reply is sent');
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

for (const [name, text] of [['A (engage)', A], ['B (attack)', B]]) {
    test(`F2: message ${name} with new foes and only approach checks opens the pause`, async () => {
        const restore = seedCrypto(702), { host } = await setup({ blocks: empty(), board: true, answers: [approachOnly] });
        try {
            const stopped = await host.send(text, 'Not sent.');
            assert.equal(stopped.aborted, true);
            const pending = pendingStart(host.ctx.chatMetadata, host.ctx.chat);
            assert.equal(pending.mode, 'new');
            assert.equal(pending.result.opened[0].name, 'Bristle-boar');
            assert.equal(pending.result.rounds.length, 0, 'the opening rolls the approach only');
            assert.equal((pending.result.opening ?? []).length, 0);
        } finally { host.close(); restore(); }
    });
}

test('F2: approach checks with new foes but no engaging words stay on the ordinary path', async () => {
    const restore = seedCrypto(703), { host } = await setup({ blocks: empty(), board: true, answers: [approachOnly] });
    try {
        const sent = await host.send('I hide with Obscure and watch the boars.', 'They pass.');
        assert.equal(sent.aborted, undefined);
    } finally { host.close(); restore(); }
});

const fail = { kind: 'check', skill: 'Obscure', ambush: true, pc: { who: 'Astra', stat: 'dex', total: 5 }, dc: 15, outcome: 'fail' };
test('F3: a failed ambush check is shown as failed, with no ambush edge; initiative is its own label', () => {
    const base = { opened: [{ name: 'Bristle-boar', count: 2, level: 2 }], checks: [fail], ambush: { who: 'Astra', skill: 'Obscure', outcome: 'fail', success: false, total: 5, dc: 15 } };
    const lead = pauseViewData({ opening: { ...base, quickStart: [{ who: 'Astra', against: 'Bristle-boar' }] } });
    assert.equal(lead.checks[0].label, 'Astra · Obscure (DEX): FAIL 5 vs 15');
    assert.doesNotMatch(lead.edge, /^Edge: ambush/);
    assert.match(lead.edge, /no ambush \(the check failed\)/);
    assert.match(lead.edge, /Astra acts first \(initiative\)/);
    assert.doesNotMatch(lead.edge, /quick start/i);
    assert.equal(pauseViewData({ opening: base }).edge, 'Edge: no ambush (the check failed)');
    // a stale or carried ambush with a failed check is not an ambush
    const stale = pauseViewData({ opening: { ...base, ambush: { who: 'Astra', outcome: 'success', success: true, carried: true, total: 18, dc: 15 } } });
    assert.match(stale.edge, /no ambush/);
    // a worked ambush says so; a check list holding the other checks too shows all of them
    const won = pauseViewData({ opening: { opened: base.opened, checks: [{ ...fail, outcome: 'success', pc: { who: 'Astra', stat: 'dex', total: 18 } }, { kind: 'check', skill: 'Track', pc: { who: 'Astra', stat: 'int', total: 9 }, dc: 12, outcome: 'fail' }],
        ambush: { who: 'Astra', skill: 'Obscure', outcome: 'success', success: true, total: 18, dc: 15 } } });
    assert.equal(won.edge, 'Edge: ambush · Astra acts first');
    assert.equal(won.checks.length, 2);
    assert.match(won.checks[1].label, /FAIL 9 vs 12/);
});

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

test('F4: the board opening rolls only the approach; the first exchange is the reader\'s one action, with no extra opening action', async () => {
    const restore = seedCrypto(704), { host, callModel } = await setup({ blocks: empty(), board: true, answers: [`${approachOnly}\nact Astra | skill: Obscure | target: Bristle-boar | type: physical`] });
    try {
        const stopped = await host.send(A, 'Not sent.');
        assert.equal(stopped.aborted, true);
        const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat);
        assert.equal(pending.result.rounds.length, 0);
        assert.equal((pending.result.opening ?? []).length, 0, 'the planner\'s act is not rolled');
        assert.equal(pending.opening.payload.plan.acts.length, 0);
        const opening = host.turn.fightStartPreview();
        const sid = host.store.carrierSid(host.store.headIndex());
        const made = openBoard(meta, opening.state, { sid, rules });
        assert.equal(made.error, undefined);
        Object.assign(made.session.setup, { opening: structuredClone(pending.opening), approach: structuredClone(opening.result.checks), drop: dropOf(opening.result) });
        pending.choice = 'board';
        const staged = stageExchange(meta, opening.state, [{ who: 'Astra', kind: 'attack', target: 1 }]);
        assert.equal(staged.error, undefined);
        assert.ok(staged.preview.result.quickStart.length > 0, 'the lead is recorded');
        assert.equal(staged.preview.result.opening.length, 0, 'no automatic opening action');
        const acts = staged.preview.result.rounds[0].lines.filter(line => line.kind === 'act' && line.pc.who === 'Astra');
        assert.equal(acts.length, 1, 'the reader\'s one click rolls one attack');
        const rounds = structuredClone(staged.preview.result.rounds);
        host.settings.set('story-block', 'rpgPracticePerUse', 5);
        assert.equal(markSend(meta, pending, boardSession(meta)), true); // what the Send button does before it generates
        const sent = await host.st.generate('regenerate', { reply: 'The approach and fight.' });
        assert.equal(sent.aborted, undefined);
        const receipt = host.ctx.chat[sent.index].extra.storySuite.receipts.findLast(item => item.type === 'rpg.resolve' && item.replan?.payload?.board);
        assert.deepEqual(receipt.data.v2.result.rounds, rounds);
        assert.equal(receipt.data.v2.result.opening.length, 0);
        assert.equal(host.head().domains.dataModules.instances['pack.chat/skills'].chat.fields.practice1, 3, 'practised once');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'replay == live');
        assert.equal((await host.sdk.reread(sent.index)).ok, true);
        assert.deepEqual(host.ctx.chat[sent.index].extra.storySuite.receipts.findLast(item => item.type === 'rpg.resolve' && item.replan?.payload?.board).data.v2.result.rounds, rounds);
        await host.swipe('Again.');
        assert.equal(host.head().domains.dataModules.instances['pack.chat/skills'].chat.fields.practice1, 3, 'a swipe does not practise twice');
        assert.equal(callModel.calls.length, 1);
        assert.ok(!boardSession(meta) || boardSession(meta).anchor === host.store.carrierSid(host.store.headIndex()));
    } finally { host.close(); restore(); }
});

test('F4: Narrate it instead keeps the planner path, with its own opening action', async () => {
    const restore = seedCrypto(705), { host } = await setup({ blocks: empty(), board: true, answers: [`${approachOnly}\nact Astra | skill: Obscure | target: Bristle-boar | type: physical\nfoe Bristle-boar | target: Astra`] });
    try {
        assert.equal((await host.send(A, 'Not sent.')).aborted, true);
        pendingStart(host.ctx.chatMetadata, host.ctx.chat).choice = 'narrate';
        const sent = await host.st.generate('regenerate', { reply: 'A narrated fight.' });
        assert.equal(sent.aborted, undefined);
        const roll = host.ctx.chat[sent.index].extra.storySuite.receipts.find(item => item.type === 'rpg.resolve');
        assert.ok(roll.data.v2.result.rounds.length >= 1, 'the planner\'s plan is rolled as today');
    } finally { host.close(); restore(); }
});
