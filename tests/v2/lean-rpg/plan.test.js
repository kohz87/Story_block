// The plan (src/v2/lean-rpg/plan.js): its shape check, the pre-call's answer read against the sheet, and the held plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanHold, parsePlanAnswer, planIsEmpty, readSheet, validatePlan } from '../../../src/v2/lean-rpg/index.js';
import { PARTY, PLAN_ANSWER, sheetDomain } from './helpers.js';

const sheet = readSheet({ domains: { dataModules: sheetDomain(PARTY()) } });
const good = () => ({
    pace: 'normal',
    acts: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats', edge: 2, why: 'ambush' }],
    foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }, { slot: 2, hold: true }],
    checks: [{ who: 'Ren', stat: 'dex', difficulty: 'hard' }],
});

test('validatePlan accepts the shape and says what is wrong in plain words', () => {
    assert.deepEqual(validatePlan(good()), { ok: true, errors: [] });
    assert.deepEqual(validatePlan({ pace: 'careful' }), { ok: true, errors: [] });
    const bad = (change, text) => {
        const plan = good();
        change(plan);
        const { ok, errors } = validatePlan(plan);
        assert.equal(ok, false);
        assert.ok(errors.some(error => text.test(error)), `${text}: ${errors.join(' | ')}`);
    };
    bad(plan => { plan.pace = 'fast'; }, /pace must be careful, normal or all/);
    bad(plan => { plan.acts = 'no'; }, /acts must be a list/);
    bad(plan => { plan.acts = Array(7).fill(plan.acts[0]); }, /acts may hold at most 6/);
    bad(plan => { plan.acts[0].stat = 'wil'; }, /act 1 needs stat to be one of str, vit/);
    bad(plan => { plan.acts[0].who = ''; }, /act 1 needs who/);
    bad(plan => { plan.acts[0].edge = 4; }, /edge must be a whole number from -3 to 3/);
    bad(plan => { plan.acts[0].edge = 1.5; }, /edge must be a whole number/);
    bad(plan => { plan.acts[0].uses = 'rage'; }, /uses must be mana or stamina/);
    bad(plan => { plan.acts[0].damage = 9; }, /"damage", which a plan does not use/);
    bad(plan => { plan.foes[0].slot = 5; }, /foe 1 needs a slot from 1 to 4/);
    bad(plan => { plan.foes[1].hold = false; }, /hold must be true/);
    bad(plan => { delete plan.foes[0].defend; }, /foe 1 needs defend/);
    bad(plan => { plan.checks[0].difficulty = 'trivial'; }, /difficulty to be one of easy, normal, hard, very hard/);
    assert.equal(validatePlan(null).ok, false);
    assert.equal(validatePlan([]).ok, false);
    assert.equal(validatePlan('plan').ok, false);
});

test('planIsEmpty: only holds, or nothing at all, rolls nothing', () => {
    assert.equal(planIsEmpty({ pace: 'normal', acts: [], foes: [{ slot: 1, hold: true }], checks: [] }), true);
    assert.equal(planIsEmpty(good()), false);
});

test('the full answer is read into the plan', () => {
    const { plan, dropped } = parsePlanAnswer(PLAN_ANSWER, sheet);
    assert.equal(dropped, 0);
    assert.deepEqual(plan, {
        pace: 'normal',
        acts: [
            { who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats', edge: 2, why: 'ambush from the drain lip' },
            { who: 'Ren', skill: 'Spark', uses: 'mana', stat: 'int', target: 'Sluice Rats' },
        ],
        foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }],
        checks: [],
    });
    assert.equal(validatePlan(plan).ok, true);
});

test('none, in any dress, is no rolls; an answer with nothing readable is an error; an empty one too', () => {
    for (const answer of ['none', 'None.', '  none (just talk)', '**none**', '`none`', 'No rolls']) assert.deepEqual(parsePlanAnswer(answer, sheet), { none: true }, answer);
    assert.match(parsePlanAnswer('Wessel swings and the rat squeals.', sheet).error, /has no pace, act, foe or check line and is not "none"/);
    assert.deepEqual(parsePlanAnswer('', sheet), { error: 'the answer was empty' });
    assert.deepEqual(parsePlanAnswer(null, sheet), { error: 'the answer was empty' });
});

test('a line that cannot be placed is dropped by itself; the rest stands', () => {
    const answer = [
        'Here is the plan:',
        '- act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats',
        '- act Nobody | stat: STR | target: Sluice Rats',
        '- act Ren | stat: WIL | target: Sluice Rats',
        '- act Ren | stat: INT | target: Dragon',
        '* check Ren | stat: DEX | difficulty: impossible',
        '* check Ren | stat: DEX | difficulty: very hard',
        '1. foe Sluice Rats | target: Nobody | defend: AGI',
        'foe Sluice Rats | target: Ren',
        'foe Sluice Rats | hold',
        'what even is this',
    ].join('\n');
    const { plan, dropped } = parsePlanAnswer(answer, sheet);
    assert.equal(dropped, 6, 'Nobody, WIL, Dragon, impossible, a foe aimed at Nobody, and the second line for slot 1');
    assert.deepEqual(plan.acts.map(act => act.who), ['Wessel']);
    assert.deepEqual(plan.checks, [{ who: 'Ren', stat: 'dex', difficulty: 'very hard' }]);
    assert.deepEqual(plan.foes, [{ slot: 1, target: 'Ren', defend: 'agi' }], 'a foe slot gets one line; a missing defend is AGI');
});

test('the edge is clamped to ±3, a bare reason is no edge, and a skill of none is no skill', () => {
    const acts = parsePlanAnswer([
        'act Wessel | stat: str | target: foe1 | edge: +9 a huge advantage',
        'act Ren | skill: none | stat: int | target: foe1 | edge: -7',
        'act Wessel | stat: str | target: foe1 | edge: from the ledge',
    ].join('\n'), sheet).plan.acts;
    assert.deepEqual(acts.map(act => [act.edge, act.why, act.skill]), [[3, 'a huge advantage', undefined], [-3, undefined, undefined], [undefined, undefined, undefined]]);
});

test('the pace word is read from a line; garbage is ignored; stats may be named in full', () => {
    assert.equal(parsePlanAnswer('pace: careful\nact Wessel | stat: strength | target: Sluice Rats', sheet).plan.pace, 'careful');
    assert.equal(parsePlanAnswer('Pace: ALL\nact Wessel | stat: STR | target: Sluice Rats', sheet).plan.pace, 'all');
    assert.equal(parsePlanAnswer('pace: sideways\nact Wessel | stat: STR | target: Sluice Rats', sheet).plan.pace, 'normal');
    assert.equal(parsePlanAnswer('act Wessel | stat: STR | target: Sluice Rats', sheet).plan.pace, 'normal', 'the default pace');
});

test('a plan of lines that name nothing rollable is no plan', () => {
    assert.deepEqual(parsePlanAnswer('pace: normal\nfoe Sluice Rats | hold', sheet), { none: true, dropped: 0 });
    assert.deepEqual(parsePlanAnswer('act Nobody | stat: STR | target: Sluice Rats', sheet), { none: true, dropped: 1 });
});

test('the held plan lives in the chat metadata, for that chat and that message only, and is cleared by clear()', () => {
    const metadata = {};
    const hold = createPlanHold({ metadata: () => metadata });
    assert.equal(hold.peek('chat', '1-abc'), null);
    hold.put('chat', '1-abc', good());
    assert.deepEqual(Object.keys(metadata), ['leanRpgPlan']);
    assert.deepEqual(hold.peek('chat', '1-abc'), { plan: good() });
    assert.deepEqual(hold.peek('chat', '1-abc'), { plan: good() }, 'peeking uses nothing up');
    assert.equal(hold.peek('chat', '2-abc'), null);
    assert.equal(hold.peek('other', '1-abc'), null);
    hold.put('chat', '3-abc', null);
    assert.deepEqual(hold.peek('chat', '3-abc'), { plan: null }, 'the model\'s "no rolls" is held too');
    hold.clear();
    assert.deepEqual(metadata, {});
    assert.equal(hold.peek('chat', '3-abc'), null);
    // A hold that was damaged is not given.
    metadata.leanRpgPlan = { chat: 'chat', key: '1-abc', plan: { pace: 'sideways' } };
    assert.equal(hold.peek('chat', '1-abc'), null);
});

test('without chat metadata the plan is held in memory', () => {
    const hold = createPlanHold();
    hold.put('chat', 'k', good());
    assert.deepEqual(hold.peek('chat', 'k'), { plan: good() });
    hold.clear();
    assert.equal(hold.peek('chat', 'k'), null);
    const throwing = createPlanHold({ metadata: () => { throw new Error('no chat'); } });
    throwing.put('chat', 'k', null);
    assert.deepEqual(throwing.peek('chat', 'k'), { plan: null });
});
