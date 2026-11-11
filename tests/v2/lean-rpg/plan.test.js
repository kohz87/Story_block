// The plan (src/v2/lean-rpg/plan.js): its shape check, kept for replaying stored plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planIsEmpty, validatePlan } from '../../../src/v2/lean-rpg/index.js';

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
    bad(plan => { plan.foes[0].slot = 97; }, /foe 1 needs a slot from 1 to 96/);   // (slots count on across the chat's Foes blocks, up to six a block: B13; 96 holds a six-bar group's virtual slots too)
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

test('a plan act or check with a skill needs no stat of its own; without a skill it must have one', () => {
    const plan = body => ({ pace: 'normal', ...body });
    const act = extra => plan({ acts: [{ who: 'Wessel', target: 'Sluice Rats', ...extra }] });
    assert.deepEqual(validatePlan(act({ skill: 'Iron Breath' })), { ok: true, errors: [] });
    assert.deepEqual(validatePlan(act({ skill: 'Iron Breath', stat: 'vit', uses: 'stamina' })), { ok: true, errors: [] }, 'carried but not read');
    assert.deepEqual(validatePlan(act({ stat: 'str' })), { ok: true, errors: [] });
    assert.match(validatePlan(act({})).errors[0], /act 1 needs stat to be one of/, 'no skill, no stat');
    assert.match(validatePlan(act({ skill: 'Iron Breath', stat: 'wil' })).errors[0], /act 1 needs stat to be one of/, 'a stat that is given must be one of the seven');
    const check = extra => plan({ checks: [{ who: 'Ren', difficulty: 'hard', ...extra }] });
    assert.equal(validatePlan(check({ skill: 'Spark' })).ok, true);
    assert.equal(validatePlan(check({ stat: 'dex' })).ok, true);
    assert.match(validatePlan(check({})).errors[0], /check 1 needs stat/);
});
