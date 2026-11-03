// Stage 50: practice for the skills a reply's rolls used is given by code (practice.js), the amount per use being the reader's setting (1 to 5, 3 unset,
// recorded with the roll): an act's skill and a defender's skill, summed per skill, held to 20 a reply; an untrained roll gives none; the narrator's practice
// line for a rolled skill is not used in that reply (one Problems line) and is used in another; a rank rises by the block's rules; a swipe, a Re-read, a
// middle delete, a rebuild and a reload agree; a later setting change moves no reply already made; a roll made before has no practice mark and gives none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { createFakeModel } from '../../../testkit/model.js';
import { LEAN_RPG_FEATURE, PRACTICE, PRACTICE_SETTING } from '../../../src/v2/lean-rpg/index.js';
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
    const model = createFakeModel(['none', ...answers]);
    const host = await createHost({ callModel: model, settings: { modules: { 'story-block': { rpgFormula: 'classic', ...(perUse === undefined ? {} : { [PRACTICE_SETTING]: perUse }) } } } });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Skills', 'Foes']) success(await host.sdk.command('dm.define', { definition: definitionOf(name) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 20 } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { who: 'Astra' } }));
    await host.send('Learn.', reply(LEARN(1, 'Iron Breath'), LEARN(2, 'Dodge'), LEARN(3, 'Spark').replace('stamina', 'mana'),
        '+ dm foes — why | kind: set-slot-1 | name: Rats | count: 2 | class: 1'));
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

test('the planner heads ask for a defending skill whenever one fits (Classic and Standard)', () => {
    assert.match(PRECALL_HEAD, /When a defender has a skill that fits defending \(a dodge, a step, a parry, a shield, an evasion, a ward\), name it on the foe line\./);
    assert.match(PRECALL_HEAD_STANDARD, /Name a defender's fitting skill on the foe line \(a dodge, a step, a parry, a shield, an evasion, a ward\)\./);
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

test('the narrator\'s practice line for a rolled skill is not used in that reply (one Problems line), is used in another, and for a skill not rolled stands', { skip }, async t => {
    const { host } = await world(t, { perUse: 3, answers: [PLAN, 'none'] });
    await host.send('I strike.', reply('+ dm skills — practised Iron Breath | kind: practice-1 | amount: 20', '+ dm skills — practised Spark | kind: practice-3 | amount: 10'));
    assert.deepEqual(practice(host), [3, 3, 10], 'code 3 for Iron Breath, not 23; Spark was not rolled, so its 10 stands');
    assert.equal(told(host).length, 1);
    await host.send('Training.', reply('+ dm skills — practised Iron Breath | kind: practice-1 | amount: 15'));
    assert.deepEqual(practice(host), [18, 3, 10], 'another reply: the narrator\'s line is the narrator\'s');
    assert.equal(told(host).length, 1);
    agree(host);
    await reloads(host);
});

test('rank-up: practice past 100 by code raises the rank by the block\'s rule and starts again', { skip }, async t => {
    const { host } = await world(t, { perUse: 5, answers: ['none', 'none', 'none', 'none', 'none', PLAN] });
    for (const amount of [20, 20, 20, 20, 18]) await host.send('Training.', reply(`+ dm skills — practised Iron Breath | kind: practice-1 | amount: ${amount}`));
    assert.equal(sheetFields(host, 'skills').practice1, 98);
    await host.send('I strike.', reply());
    const f = sheetFields(host, 'skills');
    assert.deepEqual([f.rank1, f.practice1], [1, 0], '98 + 5 = 103: Adept, practice starts again');
    agree(host);
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
