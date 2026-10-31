// The RPG roll (src/v2/lean-rpg/resolve.js, cue.js): the formula and the odds, the outcome rule, the rounds and
// their stop rules, the cue and its budget, and what is refused. Pure: a sheet read from state, scripted dice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMULA, LIMITS, PACE, outcomeOf, prepare, readSheet, rollPrepared } from '../../../src/v2/lean-rpg/index.js';
import { cueTokens } from '../../../src/v2/lean-rpg/cue.js';
import { PARTY, character, foeBlock, sheetDomain, skillBlock } from './helpers.js';

const sheetOf = (blocks = PARTY()) => readSheet({ domains: { dataModules: sheetDomain(blocks) } });
const dice = (...values) => () => {
    if (!values.length) throw new Error('the script ran out of dice');
    return values.shift();
};
// A die that is never decisive on its own: Wessel 10 + 12 (STR 14, class II, Adept) = 22 against a foe's 10 + 7 = 17 is a margin of 5.
const calm = (n = 200) => dice(...Array.from({ length: n }, () => 10));
const wessel = (over = {}) => ({ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats', ...over });
const plan = (over = {}) => ({ pace: 'normal', acts: [wessel()], foes: [], checks: [], ...over });

test('the outcome rule: natural 20 succeeds, natural 1 fails, a total that reaches the other side succeeds, 1–2 short is at a cost', () => {
    assert.equal(outcomeOf(20, 2, 99), 'success');
    assert.equal(outcomeOf(1, 40, 3), 'fail');
    assert.equal(outcomeOf(10, 20, 20), 'success');
    assert.equal(outcomeOf(10, 21, 20), 'success');
    assert.equal(outcomeOf(10, 19, 20), 'cost');
    assert.equal(outcomeOf(10, 20 - FORMULA.costMargin, 20), 'cost');
    assert.equal(outcomeOf(10, 20 - FORMULA.costMargin - 1, 20), 'fail');
});

test('the odds of the formula: a Class II hero with STR 14 and an Adept skill (+12) against foes of rising class', () => {
    // d20 + 12 against d20 + 5 + 2×class, every pair of dice once. Success %, then success at a cost %.
    const odds = foeClass => {
        let success = 0, cost = 0;
        for (let pc = 1; pc <= 20; pc += 1) for (let foe = 1; foe <= 20; foe += 1) {
            const outcome = outcomeOf(pc, pc + 12, foe + FORMULA.foeBase + FORMULA.classWeight * foeClass);
            if (outcome === 'success') success += 1; else if (outcome === 'cost') cost += 1;
        }
        return [success / 4, cost / 4];
    };
    const table = { 1: [72.25, 6.25], 2: [65, 7.25], 4: [47.75, 9], 6: [31.25, 7.75], 8: [18.75, 5.75] };
    for (const [foeClass, expected] of Object.entries(table)) assert.deepEqual(odds(Number(foeClass)), expected, `class ${foeClass}`);
});

test('the formula in the numbers: d20 + stat/2 + 2×class + rank + edge against d20 + 5 + 2×class', () => {
    const prepared = prepare(plan({ acts: [wessel({ edge: 2 })] }), sheetOf());
    const result = rollPrepared(plan(), prepared, dice(14, 9));
    const [line] = result.rounds[0].lines;
    assert.deepEqual(line.pc, { who: 'Wessel', stat: 'str', statBonus: 7, classValue: 2, classBonus: 4, rank: 1, edge: 2, die: 14, total: 28 });
    assert.deepEqual(line.foe, { slot: 1, name: 'Sluice Rats', base: 5, classValue: 1, classBonus: 2, die: 9, total: 16 });
    assert.equal(line.outcome, 'success');
    assert.equal(line.skill, 'Iron Breath');
    assert.match(result.text, /Round 1: Wessel → Sluice Rats \(Iron Breath\): SUCCESS \(28 vs 16\)/);
    // An odd stat rounds down (STR 15 → 7), and the edge is clamped to ±3.
    const odd = sheetOf({ ...PARTY(), wessel: { role: 'character', fields: character('Wessel', { str: 15 }) } });
    const clamped = prepare(plan({ acts: [{ ...wessel(), edge: 3 }] }), odd);
    assert.equal(clamped.acts[0].pc.statBonus, 7);
    assert.equal(prepare({ pace: 'normal', acts: [{ ...wessel(), edge: 9 }] }, odd).acts[0].pc.edge, FORMULA.edgeMax);
});

test('the formula is pinned for every stat, Soul Class, rank and edge: d20 + floor(stat/2) + rank + 2×Soul Class + edge', () => {
    for (const stat of [1, 2, 7, 10, 15, 19, 20]) for (const soul of [1, 2, 5, 9]) for (const rank of [0, 1, 2, 3]) for (const edge of [-3, 0, 3]) {
        const party = PARTY();
        party.wessel.fields = character('Wessel', { str: stat, soul });
        party['wessel-skills'].fields = skillBlock('Wessel', [['Iron Breath', rank, 'str']]);
        const body = plan({ pace: 'careful', acts: [wessel({ edge })] });
        const [line] = rollPrepared(body, prepare(body, sheetOf(party)), dice(11, 4)).rounds[0].lines;
        assert.equal(line.pc.total, 11 + Math.floor(stat / 2) + rank + 2 * soul + edge, `STR ${stat}, class ${soul}, rank ${rank}, edge ${edge}`);
        assert.deepEqual([line.pc.statBonus, line.pc.classBonus, line.pc.rank, line.pc.edge], [Math.floor(stat / 2), 2 * soul, rank, edge]);
    }
});

test('a skilled act or check rolls with the skill\'s own stat; the plan\'s stat is ignored, and so is its uses', () => {
    const party = PARTY();
    party['wessel-skills'].fields = skillBlock('Wessel', [['Iron Breath', 2, 'vit', 'stamina'], ['Spark', 0, 'int', 'mana']]);
    const sheet = sheetOf(party);
    const body = plan({ acts: [wessel({ stat: 'str', uses: 'mana' }), { who: 'Wessel', skill: 'Spark', target: 'Sluice Rats' }],
        checks: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'cha', difficulty: 'normal' }] });
    const prepared = prepare(body, sheet);
    assert.deepEqual(prepared.acts.map(entry => [entry.skill, entry.pc.stat, entry.pc.statBonus, entry.pc.rank]), [['Iron Breath', 'vit', 6, 2], ['Spark', 'int', 4, 0]], 'VIT 12 and INT 8, not the STR 14 the plan said');
    assert.deepEqual([prepared.checks[0].pc.stat, prepared.checks[0].pc.statBonus], ['vit', 6]);
    assert.deepEqual(prepared.refused, []);
    // The skill's resource is the one that is checked: Iron Breath spends stamina however the plan's `uses` reads.
    party.wessel.fields = character('Wessel', { stamina: 0 });
    const spent = prepare(plan({ acts: [wessel({ stat: 'str', uses: 'mana' })] }), sheetOf(party));
    assert.deepEqual([spent.acts[0].skill, spent.acts[0].pc.stat, spent.acts[0].pc.rank, spent.refused.length], [null, 'vit', 0, 1], 'rolled without the skill, with its stat');
    // The line names the stat that was rolled: Iron Breath is STR on the default sheet.
    const skilled = plan({ pace: 'careful', acts: [{ who: 'Wessel', skill: 'Iron Breath', target: 'Sluice Rats' }] });
    assert.equal(rollPrepared(skilled, prepare(skilled, sheetOf()), calm()).rounds[0].lines[0].pc.stat, 'str');
});

test('an act with no skill, or a skill the character lacks, rolls the plan\'s stat at rank 0; with no stat to roll with it is refused in plain words', () => {
    const sheet = sheetOf();
    const plain = prepare(plan({ acts: [{ who: 'Wessel', stat: 'dex', target: 'Sluice Rats' }], checks: [{ who: 'Ren', stat: 'cha', difficulty: 'easy' }] }), sheet);
    assert.deepEqual([plain.acts[0].skill, plain.acts[0].pc.stat, plain.acts[0].pc.rank, plain.acts[0].pc.statBonus], [null, 'dex', 0, 5]);
    assert.deepEqual([plain.checks[0].pc.stat, plain.checks[0].pc.rank], ['cha', 0]);
    const lacking = prepare(plan({ acts: [wessel({ skill: 'Lockpicking', stat: 'dex' })] }), sheet);
    assert.deepEqual([lacking.acts[0].skill, lacking.acts[0].pc.stat, lacking.acts[0].pc.rank], [null, 'dex', 0]);
    const none = prepare({ pace: 'normal', acts: [{ who: 'Wessel', skill: 'Lockpicking', target: 'Sluice Rats' }], checks: [{ who: 'Wessel', skill: 'Lockpicking', difficulty: 'easy' }] }, sheet);
    assert.deepEqual([none.acts.length, none.checks.length], [0, 0]);
    assert.deepEqual(none.refused.map(entry => entry.text), [
        'Wessel → Sluice Rats: not rolled (Wessel has no stat to roll with).',
        'Wessel — Lockpicking: not rolled (Wessel has no stat to roll with).',
    ]);
    // A Skills block with no stat on its skills (made before they were fields) takes the plan's stat.
    const party = PARTY();
    party['wessel-skills'].fields = { who: 'Wessel', skill1: 'Iron Breath', rank1: 1, practice1: 0 };
    const old = prepare(plan({ acts: [wessel({ stat: 'agi' })] }), sheetOf(party));
    assert.deepEqual([old.acts[0].skill, old.acts[0].pc.stat, old.acts[0].pc.rank], ['Iron Breath', 'agi', 1]);
});

test('a foe attacks: the defender rolls with the defend stat, no skill, and the line reads for the defender', () => {
    const body = plan({ pace: 'careful', acts: [], foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }] });
    const result = rollPrepared(body, prepare(body, sheetOf()), dice(6, 15));
    const [line] = result.rounds[0].lines;
    assert.equal(line.kind, 'foe');
    assert.deepEqual([line.pc.stat, line.pc.statBonus, line.pc.rank, line.pc.total, line.foe.total, line.outcome], ['agi', 6, 0, 16, 22, 'fail']);
    assert.match(result.text, /Round 1: Sluice Rats attacks Wessel: FAIL for Wessel \(16 vs 22\)/);
    // A foe told to hold, and a foe line the plan does not name, roll nothing.
    assert.equal(prepare(plan({ acts: [], foes: [{ slot: 1, hold: true }] }), sheetOf()).foes.length, 0);
});

test('a check is one d20 against the difficulty, outside the rounds', () => {
    const checks = [{ who: 'Wessel', stat: 'dex', difficulty: 'hard' }];
    const result = rollPrepared(plan({ acts: [], checks }), prepare(plan({ acts: [], checks }), sheetOf()), dice(11));
    assert.equal(result.rounds.length, 0);
    assert.equal(result.stop, 'none');
    const [line] = result.checks;
    assert.deepEqual([line.pc.die, line.pc.total, line.dc, line.difficulty, line.outcome], [11, 20, LIMITS.dc.hard, 'hard', 'success']);
    assert.match(result.text, /^\[Rolls\] Code rolled these\. Tell them as given, and never invent a roll\.\nWessel — DEX \(DEX\), hard: SUCCESS \(20 vs 20\)$/);
    assert.deepEqual(result.summary, { exchanges: 0, acts: [{ kind: 'check', who: 'Wessel', target: null, skill: null, stat: 'dex', outcomes: ['success'] }], refused: 0 });
});

test('rounds: the smallest of the pace, the cap of five and the first decisive round', () => {
    const roundsFor = pace => {
        const body = plan({ pace });
        return rollPrepared(body, prepare(body, sheetOf()), calm()).rounds.length;
    };
    assert.deepEqual([roundsFor('careful'), roundsFor('normal'), roundsFor('all')], [1, PACE.normal, LIMITS.roundCap]);
    assert.ok(PACE.all > LIMITS.roundCap, 'the cap is what stops "all"');
    const stops = pace => { const body = plan({ pace }); return rollPrepared(body, prepare(body, sheetOf()), calm()).stop; };
    assert.deepEqual([stops('careful'), stops('normal'), stops('all')], ['pace', 'pace', 'cap']);
});

test('the first round with a natural 1 or 20, or a margin of 8 either way, is the last', () => {
    const body = plan();
    const run = (...values) => rollPrepared(body, prepare(body, sheetOf()), dice(...values, ...Array(40).fill(10)));
    // Round 1: 10 vs 10 (22 vs 17, a margin of 5); round 2: the foe rolls a 20; so the fight ends after round 2.
    const nat = run(10, 10, 10, 20);
    assert.deepEqual([nat.rounds.length, nat.stop, nat.rounds.map(round => round.decisive)], [2, 'decisive', [false, true]]);
    // A margin of 8: 13 → 25 against 10 → 17.
    const margin = run(10, 10, 13, 10);
    assert.deepEqual([margin.rounds.length, margin.stop], [2, 'decisive']);
    // A natural 1 on the party's die in round 1 ends it there.
    assert.equal(run(1, 10).rounds.length, 1);
    assert.match(nat.text, /Round 2 is decisive: stop there at the latest\. Stop earlier at the first stop point/);
    const calmRun = rollPrepared(body, prepare(body, sheetOf()), calm());
    assert.match(calmRun.text, /Round 5 is the last rolled: stop there at the latest\./);
});

test('the cue stays within its budget: rounds are cut to fit, never below one', () => {
    const party = PARTY();
    const names = ['Adalbert the Unwavering', 'Brunhilde of the Marches', 'Cornelius Featherstone', 'Dorothea Nightingale', 'Everard Longstride', 'Fenella of the Reeds'];
    for (const name of names) party[name] = { role: 'character', fields: character(name) };
    party.foes.fields = foeBlock([['Sluice Rat Vanguard of the Lower Drain', 6, 1], ['Sluice Rat Chieftain of the Lower Drain', 2, 2], ['Sluice Rat Sappers of the Lower Drain', 3, 1], ['Sluice Rat Archers of the Lower Drain', 3, 1]]);
    const acts = names.map(who => ({ who, stat: 'str', target: 'Sluice Rat Vanguard of the Lower Drain' }));
    const foes = [1, 2, 3, 4].map(slot => ({ slot, target: names[slot], defend: 'agi' }));
    const body = { pace: 'all', acts, foes, checks: [] };
    const result = rollPrepared(body, prepare(body, sheetOf(party)), calm(1000));
    assert.ok(result.rounds.length >= 1 && result.rounds.length < LIMITS.roundCap, `${result.rounds.length} rounds`);
    assert.equal(result.stop, 'budget');
    assert.ok(cueTokens(result.text) <= LIMITS.cueTokens, `${cueTokens(result.text)} tokens`);
    assert.match(result.text, /is the last rolled/);
});

test('what is refused, in plain words: an unknown name or foe, an empty slot, a stat the sheet lacks, someone who is Down', () => {
    const party = PARTY();
    party.moss = { role: 'character', fields: character('Moss', { health: 0 }) };
    party.dull = { role: 'character', fields: character('Dull', { str: null }) };
    const sheet = sheetOf(party);
    const cases = [
        [wessel({ who: 'Nobody' }), /Nobody → Sluice Rats: not rolled \(no character called Nobody\)\./],
        [wessel({ target: 'Dragon' }), /Wessel → Dragon: not rolled \(no foe called Dragon\)\./],
        [wessel({ who: 'Moss', skill: undefined }), /Moss → Sluice Rats: not rolled \(Moss is Down\)\./],
        [wessel({ who: 'Dull', skill: undefined }), /Dull → Sluice Rats: not rolled \(Dull has no STR on the sheet\)\./],
    ];
    for (const [act, text] of cases) {
        const body = plan({ acts: [{ ...act }, wessel({ skill: undefined })] });
        const prepared = prepare(body, sheet);
        assert.equal(prepared.acts.length, 1, 'the others still roll');
        const result = rollPrepared(body, prepared, calm());
        assert.match(result.text, text);
        assert.equal(result.summary.refused, 1);
    }
    const empty = sheetOf({ ...PARTY(), foes: { role: 'foes', fields: foeBlock([['Sluice Rats', 6, 1, 5], ['', 0, 1, 5]]) } });
    const body = plan({ acts: [], foes: [{ slot: 2, target: 'Wessel', defend: 'agi' }] });
    assert.match(rollPrepared(body, prepare(body, empty), calm()).text, /Foe 2 attacks Wessel: not rolled \(that foe slot is empty\)\./);
});

test('a skill whose mana or stamina is Empty is refused and the action is rolled without it; the resource is the skill\'s own', () => {
    const party = PARTY();
    party.wessel.fields = character('Wessel', { stamina: 0 });
    party.ren.fields = character('Ren', { mana: 0, str: 8, int: 16 });
    const sheet = sheetOf(party);
    const stamina = prepare(plan({ acts: [wessel()] }), sheet);
    assert.deepEqual([stamina.acts[0].skill, stamina.acts[0].pc.rank, stamina.acts[0].pc.stat], [null, 0, 'str'], 'rolled without the skill, with its stat');
    assert.deepEqual(stamina.refused.map(entry => entry.text), ['Wessel cannot use Iron Breath (Stamina Empty): rolled without it.']);
    // Spark uses mana on Ren's sheet, so Empty mana refuses it whatever the plan says; a plan's `uses` is not read for a skill she has.
    for (const uses of [undefined, 'stamina', 'mana']) {
        const spark = prepare(plan({ acts: [{ who: 'Ren', skill: 'Spark', ...(uses ? { uses } : {}), target: 'Sluice Rats' }] }), sheet);
        assert.deepEqual([spark.acts[0].skill, spark.refused[0].text], [null, 'Ren cannot use Spark (Mana Empty): rolled without it.'], String(uses));
    }
    // With the mana back, and Ren's stamina Empty instead, Spark is fine: it never touches stamina.
    party.ren.fields = character('Ren', { stamina: 0, str: 8, int: 16 });
    const fine = prepare(plan({ acts: [{ who: 'Ren', skill: 'Spark', uses: 'stamina', target: 'Sluice Rats' }] }), sheetOf(party));
    assert.deepEqual([fine.acts[0].skill, fine.refused.length], ['Spark', 0]);
    const result = rollPrepared(plan(), stamina, calm());
    assert.match(result.text, /Wessel cannot use Iron Breath \(Stamina Empty\): rolled without it\./);
    assert.match(result.text, /Wessel → Sluice Rats: SUCCESS/, 'no skill is named on the line');
});

test('a skill rank is the number added: Novice 0, Adept 1, Expert 2, Master 3', () => {
    const party = PARTY();
    party['wessel-skills'].fields = skillBlock('Wessel', [['Iron Breath', 3]]);
    assert.equal(prepare(plan(), sheetOf(party)).acts[0].pc.rank, 3);
});

test('the summary for the reply: exchanges, and each action with what happened in every round', () => {
    const body = plan({ pace: 'careful', acts: [wessel(), { who: 'Ren', skill: 'Spark', stat: 'int', target: 'Sluice Rats' }], foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }] });
    const result = rollPrepared(body, prepare(body, sheetOf()), calm());
    assert.deepEqual(result.summary, {
        exchanges: 1,
        acts: [
            { kind: 'act', who: 'Wessel', target: 'Sluice Rats', skill: 'Iron Breath', stat: 'str', outcomes: ['success'] },
            { kind: 'act', who: 'Ren', target: 'Sluice Rats', skill: 'Spark', stat: 'int', outcomes: ['success'] },
            { kind: 'foe', who: 'Sluice Rats', target: 'Wessel', skill: null, stat: 'agi', outcomes: ['success'] },
        ],
        refused: 0,
    });
});

test('a skill the character does not have is rolled untrained, and the cue says so', () => {
    const body = plan({ acts: [wessel({ skill: 'Iron Breth' })], checks: [{ who: 'Ren', skill: 'Lockpicking', stat: 'dex', difficulty: 'easy' }] });
    const prepared = prepare(body, sheetOf());
    assert.deepEqual([prepared.acts[0].skill, prepared.acts[0].pc.rank, prepared.checks[0].skill, prepared.checks[0].pc.rank], [null, 0, null, 0]);
    const result = rollPrepared(body, prepared, calm());
    assert.match(result.text, /Wessel has no skill called Iron Breth: rolled untrained\./);
    assert.match(result.text, /Ren has no skill called Lockpicking: rolled untrained\./);
    assert.match(result.text, /Wessel → Sluice Rats: SUCCESS/);
    assert.equal(result.summary.refused, 2);
});
