// Stage 50: practice for the skills a reply's rolls used is given by code (practice.js), the amount per use being the reader's setting (1 to 5, 3 unset,
// recorded with the roll): an act's skill and a defender's skill, summed per skill, held to 20 a reply; an untrained roll gives none; the narrator's practice
// line for a rolled skill is not used in that reply (one Problems line) and is used in another; a rank rises by the block's rules; a swipe, a Re-read, a
// middle delete, a rebuild and a reload agree; a later setting change moves no reply already made; a roll made before has no practice mark and gives none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { createFakeModel } from '../../../testkit/model.js';
import { LEAN_RPG_FEATURE, PRACTICE, PRACTICE_SETTING } from '../../../src/v2/lean-rpg/index.js';
import { practiceLines, rpgReplyLines } from '../../../src/v2/lean-rpg/view/changes-lines.js';
import { PRACTICE_HELD, usesOf } from '../../../src/v2/lean-rpg/practice.js';
import { PRECALL_HEAD, PRECALL_HEAD_STANDARD } from '../../../src/v2/lean-rpg/precall.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { reply, success } from '../data-modules/helpers.js';
import { rollReceipt } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const definitionOf = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
const PLAN = [
    'pace: careful',
    'act Astra | skill: Iron Breath | stat: STR | target: Rats',
    'foe Rats | target: Astra | defend: AGI | skill: Dodge',
].join('\n');
const LEARN = (n, name) => `~ dm skills — learned | kind: learn-${n} | name: ${name} | about: x. | stat: str | uses: stamina`;
const sheetFields = (host, slug) => host.head().domains.dataModules.instances[`pack.chat/${slug}`].chat.fields;

async function world(t, { perUse, answers = [PLAN] } = {}) {
    const model = createFakeModel([...answers]);
    const host = await createHost({ callModel: model, settings: { modules: { 'story-block': { rpgFormula: 'classic', ...(perUse === undefined ? {} : { [PRACTICE_SETTING]: perUse }) } } } });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Skills', 'Foes']) success(await host.sdk.command('dm.define', { definition: definitionOf(name) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 20 } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { who: 'Astra' } }));
    await host.send('Learn.', reply(LEARN(1, 'Iron Breath'), LEARN(2, 'Dodge'), LEARN(3, 'Spark').replace('stamina', 'mana'),
        '+ dm foes — why | kind: set-slot-1 | name: Rats | count: 2 | level: 5'));
    return { host, model };
}
const practice = host => { const f = sheetFields(host, 'skills'); return [f.practice1, f.practice2, f.practice3]; };
function agree(host) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story');
}
async function reloads(host) {
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live story');
}
const told = host => host.turn.problems().filter(problem => problem.message === PRACTICE_HELD);

test('the planner heads name a defender\'s skill on the foe line only when the message asks for it (Classic and Standard)', () => {
    // (PINNED CHANGE, USER option A: the line used to say a fitting skill always goes on the foe line)
    assert.match(PRECALL_HEAD, /Name a defender's skill on a foe line only if the message asks to defend with it; else leave skill out\./);
    assert.match(PRECALL_HEAD_STANDARD, /Name a defender's skill on a foe line only if the message asks to defend with it; else leave skill out\./);
    for (const head of [PRECALL_HEAD, PRECALL_HEAD_STANDARD]) assert.doesNotMatch(head, /fitting skill/);
    for (const head of [PRECALL_HEAD, PRECALL_HEAD_STANDARD]) assert.doesNotMatch(head, /plausibly fits/);
});

for (const perUse of [1, 3, 5]) {
    test(`practice per use ${perUse}: an act's skill and a defender's skill each get it, an untrained roll none, and the roll records the value`, { skip }, async t => {
        const { host } = await world(t, { perUse });
        await host.send('I strike.', reply());
        const at = host.ctx.chat.length - 1;
        assert.equal(rollReceipt(host, at).data.v2.result.practice, perUse, 'recorded with the roll');
        const uses = usesOf(rollReceipt(host, at).data.v2.result);
        assert.deepEqual(uses.map(use => [use.skill, use.n]), [['Dodge', 1], ['Iron Breath', 1]]);
        assert.deepEqual(practice(host), [perUse, perUse, 0], 'Spark was not rolled');
        assert.deepEqual(told(host), []);
        agree(host);
        await reloads(host);
    });
}

test('a later setting change moves no reply already made; a swipe rolls anew with the value then; Re-read keeps the recorded value', { skip }, async t => {
    const { host } = await world(t, { perUse: 2, answers: [PLAN, PLAN, PLAN, PLAN, PLAN] });
    await host.send('I strike.', reply());
    assert.deepEqual(practice(host), [2, 2, 0]);
    host.settings.set('story-block', PRACTICE_SETTING, 5);
    agree(host);
    assert.deepEqual(practice(host), [2, 2, 0], 'a rebuild with the new setting changes nothing');
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.deepEqual(practice(host), [2, 2, 0], 'Re-read keeps the value the roll was made with');
    await host.send('Again.', reply());
    assert.deepEqual(practice(host), [7, 7, 0], 'the next reply uses 5');
    await host.swipe(reply());
    assert.deepEqual(practice(host), [7, 7, 0], 'the swipe takes the credit back and rolls anew at 5');
    await host.st.deleteMessage(host.ctx.chat.length - 2);
    agree(host);
    await reloads(host);
});

test('the setting out of range or missing is 3; the payload mark is the value, so a roll with none gives none', { skip }, async t => {
    const { host } = await world(t, { perUse: 9 });
    await host.send('I strike.', reply());
    assert.deepEqual(practice(host), [3, 3, 0]);
    const record = rollReceipt(host, host.ctx.chat.length - 1);
    assert.equal(record.data.v2.result.practice, PRACTICE.perUse);
    // A roll recorded before (no `practice` in it) is read by the hook as giving nothing.
    const { rollOf } = await import('../../../src/v2/lean-rpg/practice.js');
    const old = structuredClone(record);
    delete old.data.v2.result.practice;
    assert.equal(rollOf([old]), null);
});

test('the cap: six uses of one skill at 5 are held to 20; an untrained roll (no skill, or a skill the character lacks) gives nothing', { skip }, async t => {
    const plan = ['pace: careful', 'act Astra | skill: Iron Breath | stat: STR | target: Rats', 'check Astra | skill: Iron Breath | difficulty: easy', 'check Astra | skill: Iron Breath | difficulty: easy',
        'check Astra | skill: Iron Breath | difficulty: easy', 'check Astra | skill: Fencing | stat: DEX | difficulty: easy', 'foe Rats | target: Astra | defend: AGI'].join('\n');
    const { host } = await world(t, { perUse: 5, answers: [plan] });
    await host.send('Go.', reply());
    assert.deepEqual(practice(host), [20, 0, 0], '4 uses × 5 = 20; Dodge was not named; Fencing is lacked');
});

const REFUSED = 'Practice comes from rolled skill uses';
const refusals = host => host.turn.problems().filter(problem => problem.message.includes(REFUSED));

test('with the RPG on and Rolls automatic the narrator\'s practice line is refused, with a Problems line, for a rolled skill and for one not rolled; only the code practises', { skip }, async t => {
    const { host } = await world(t, { perUse: 3, answers: [PLAN, 'none'] });
    await host.send('I strike.', reply('+ dm skills — practised Iron Breath | kind: practice-1 | amount: 20', '+ dm skills — practised Spark | kind: practice-3 | amount: 10'));
    assert.deepEqual(practice(host), [3, 3, 0], 'code 3 for Iron Breath and for Dodge; the narrator\'s 20 and 10 changed nothing');
    assert.equal(refusals(host).length, 2, 'one Problems line for each refused line');
    assert.equal(told(host).length, 0, 'nothing to put back: the lines never applied');
    await host.send('Training.', reply('+ dm skills — practised Iron Breath | kind: practice-1 | amount: 15'));
    assert.deepEqual(practice(host), [3, 3, 0], 'a reply with no roll: the line is refused too (no farming)');
    assert.equal(refusals(host).length, 3);
    agree(host);
    await reloads(host);
});

test('with Rolls off the narrator\'s practice line works exactly as before', { skip }, async t => {
    const { host } = await world(t, { perUse: 3, answers: [] });
    host.settings.set('story-block', 'rpgRolls', 'off');
    await host.send('I strike.', reply('+ dm skills — practised Iron Breath | kind: practice-1 | amount: 20', '+ dm skills — practised Spark | kind: practice-3 | amount: 10'));
    assert.deepEqual(practice(host), [20, 0, 10]);
    assert.equal(refusals(host).length, 0);
    agree(host);
});

const LINE20 = '+ dm skills — practised Iron Breath | kind: practice-1 | amount: 20';

test('a reply captured before the rule (Rolls off) keeps its accepted practice line on Re-read, an edit, a rebuild and a reload, even after Rolls goes automatic', { skip }, async t => {
    const { host } = await world(t, { perUse: 3, answers: ['none', 'none'] });
    host.settings.set('story-block', 'rpgRolls', 'off');
    await host.send('Training.', reply(LINE20));
    const at = host.ctx.chat.length - 1;
    assert.equal(sheetFields(host, 'skills').practice1, 20);
    assert.equal(host.ctx.chat[at].extra.storySuite.practiceRule, undefined, 'no mark: it was not captured under the rule');
    host.settings.set('story-block', 'rpgRolls', 'automatic');
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(sheetFields(host, 'skills').practice1, 20, 'a Re-read keeps the practice the player had');
    await host.st.editMessage(at, reply(LINE20.replace('amount: 20', 'amount: 12')));
    assert.equal(sheetFields(host, 'skills').practice1, 20, 'an edit of the old message does not take its practice away either');
    agree(host);
    await reloads(host);
    assert.equal(sheetFields(host, 'skills').practice1, 20);
    assert.equal(refusals(host).length, 0);
});

test('a reply captured under the rule is marked on its record; its Re-read, an edit, a rebuild and a reload keep refusing the line, and the mark survives', { skip }, async t => {
    const { host } = await world(t, { perUse: 3, answers: ['none', 'none'] });
    await host.send('Training.', reply(LINE20));
    const at = host.ctx.chat.length - 1;
    assert.equal(sheetFields(host, 'skills').practice1, 0);
    assert.equal(host.ctx.chat[at].extra.storySuite.practiceRule, 'rolls');
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(sheetFields(host, 'skills').practice1, 0, 'a Re-read refuses it again');
    assert.equal(host.ctx.chat[at].extra.storySuite.practiceRule, 'rolls');
    await host.st.editMessage(at, reply(LINE20.replace('amount: 20', 'amount: 7')));
    assert.equal(sheetFields(host, 'skills').practice1, 0, 'an edit of it too');
    agree(host);
    await reloads(host);
    assert.equal(host.ctx.chat[at].extra.storySuite.practiceRule, 'rolls', 'the mark is saved with the reply');
    // a reply with no practice line is not marked (nothing is written for it)
    await host.send('Walking.', reply('~ place Docks'));
    assert.equal(host.ctx.chat.at(-1).extra?.storySuite?.practiceRule, undefined);
});

test('rank-up: practice past 100 by code raises the rank by the block\'s rule and starts again', { skip }, async t => {
    const { host } = await world(t, { perUse: 5, answers: [PLAN] });
    // (the practice is brought to 98 with Rolls off, where the narrator's line still works; then Rolls goes automatic and a roll gives the last 5)
    host.settings.set('story-block', 'rpgRolls', 'off');
    for (const amount of [20, 20, 20, 20, 18]) await host.send('Training.', reply(`+ dm skills — practised Iron Breath | kind: practice-1 | amount: ${amount}`));
    assert.equal(sheetFields(host, 'skills').practice1, 98);
    host.settings.set('story-block', 'rpgRolls', 'automatic');
    await host.send('I strike.', reply());
    const f = sheetFields(host, 'skills');
    assert.deepEqual([f.rank1, f.practice1], [1, 0], '98 + 5 = 103: Adept, practice starts again');
    agree(host);
});

test('the reply card tells the practice code gave, in the fight XP line\'s style, from the step\'s receipt; a swipe takes it away', { skip }, async t => {
    const { host } = await world(t, { perUse: 3, answers: [PLAN, PLAN] });
    await host.send('I strike.', reply());
    const record = host.ctx.chat.at(-1).extra.storySuite;
    assert.deepEqual(practiceLines(record).map(line => line.text), ['Astra\'s Dodge +3 practice (rolled)', 'Astra\'s Iron Breath +3 practice (rolled)']);
    assert.equal(practiceLines(record)[0].summary, 'Astra\'s Dodge +3');
    assert.deepEqual(rpgReplyLines({ state: host.head(), before: null, record }).map(line => line.text).filter(text => /practice/.test(text)), ['Astra\'s Dodge +3 practice (rolled)', 'Astra\'s Iron Breath +3 practice (rolled)'], 'the card shows them beside the rolls');
    assert.deepEqual(practiceLines({ receipts: [] }), []);
    assert.deepEqual(practiceLines({ receipts: [{ type: 'rpg.practice', id: 'x', data: { v2: { result: { practice: { skills: [{ who: 'A', skill: 'S', amount: 0 }, { who: '', skill: 'S', amount: 2 }] } } } } }] }), [], 'nothing without a name or an amount');
    await host.swipe('Again.');
    assert.equal(practiceLines(host.ctx.chat.at(-1).extra.storySuite).length, 2, 'the swiped reply has its own');
});

test('a roll made before practice by code has no mark and gives nothing, byte for byte as it was', { skip }, async t => {
    const { host } = await world(t, { perUse: 3 });
    await host.send('I strike.', reply());
    const at = host.ctx.chat.length - 1;
    const record = host.ctx.chat[at].extra.storySuite;
    // Strip the mark from the payload the way a payload made on an older build lacks it, and run the hook's reading of it.
    const { rollOf, usesOf: uses } = await import('../../../src/v2/lean-rpg/practice.js');
    const result = structuredClone(rollReceipt(host, at).data.v2.result);
    assert.ok(uses(result).length > 0);
    delete result.practice;
    assert.equal(rollOf([{ type: 'rpg.resolve', data: { v2: { result } } }]), null);
    assert.ok(record.receipts.some(receipt => receipt.type === 'rpg.practice'), 'the new roll has its step');
});
