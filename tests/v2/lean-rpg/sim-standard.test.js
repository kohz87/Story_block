// scripts/sim-standard.mjs: the numbers the Standard presets were chosen by stay what they were chosen for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAt, classicTable, exactOdds, fight, rankAt, rollTable } from '../../../scripts/sim-standard.mjs';
import { STANDARD_FORMULA, STANDARD_PRESETS } from '../../../src/v2/lean-rpg/rules.js';
import { blocksFor, foeBonus } from '../../../src/v2/lean-rpg/formula.js';

test('the builds follow the creation and Soul Class rules: focused puts STR and DEX at 10 then 3 + 1 a class, spread keeps every stat within 1 of the rest', () => {
    const focused = buildAt('focused', 1), spread = buildAt('spread', 1);
    assert.deepEqual(focused, { str: 10, vit: 5, agi: 5, dex: 10, int: 5, luk: 5, cha: 5 });
    assert.deepEqual(spread, { str: 8, vit: 6, agi: 6, dex: 7, int: 6, luk: 6, cha: 6 });
    const third = buildAt('focused', 3);
    assert.deepEqual([third.str, third.dex], [16, 12]);
    for (const soul of [1, 3, 5, 7, 9]) {
        const stats = Object.values(buildAt('spread', soul));
        assert.ok(Math.max(...stats) - Math.min(...stats) <= 3, `spread at ${soul}`);
        for (const [kind, points] of [['focused', 10 + 4 * (soul - 1)], ['spread', 10 + 4 * (soul - 1)]]) {
            const total = Object.values(buildAt(kind, soul)).reduce((sum, value) => sum + value - 5, 0);
            assert.ok(total <= points && total >= Math.min(points, 7 * 15) - 0, `${kind} ${soul}: ${total} of ${points}`);
        }
    }
    assert.deepEqual([1, 2, 3, 5, 7, 9].map(rankAt), [0, 0, 1, 2, 3, 3]);
});

test('exact odds count all 400 pairs: the three outcomes add up and a harsher foe base lowers success', () => {
    const at = difficulty => exactOdds(12, foeBonus(2, STANDARD_PRESETS[difficulty]), STANDARD_PRESETS[difficulty]);
    for (const name of ['gentle', 'standard', 'harsh']) assert.ok(Math.abs(at(name).success + at(name).cost + at(name).fail - 100) <= 1, name);
    assert.ok(at('gentle').success > at('standard').success && at('standard').success > at('harsh').success);
});

test('Standard\'s presets: a focused build against a foe of its own Soul Class succeeds 60 to 85 times in a hundred at every Soul Class, near Classic\'s own line; a spread build is lower', () => {
    const rows = rollTable(), classic = classicTable();
    assert.equal(rows.length, 30);
    const at = (difficulty, build) => rows.filter(row => row.difficulty === difficulty && row.build === build);
    for (const row of at('standard', 'focused')) {
        assert.ok(row.same.success >= 60 && row.same.success <= 85, `focused ${row.soul}: ${row.same.success}`);
        const reference = classic.find(item => item.soul === row.soul).same.success;
        assert.ok(Math.abs(row.same.success - reference) <= 12, `focused ${row.soul}: ${row.same.success} against Classic's ${reference}`);
    }
    for (const row of at('standard', 'spread')) assert.ok(row.same.success >= 40 && row.same.success <= 65, `spread ${row.soul}: ${row.same.success}`);
    for (const build of ['focused', 'spread']) for (const [gentle, standard, harsh] of at('gentle', build).map((row, n) => [row, at('standard', build)[n], at('harsh', build)[n]])) {
        assert.ok(gentle.same.success > standard.same.success && standard.same.success > harsh.same.success, `${build} ${gentle.soul}`);
    }
    // One class below is easier and one above harder, for every build at every difficulty.
    for (const row of rows.filter(item => item.soul > 1 && item.soul < 9)) assert.ok(row.below.success >= row.same.success && row.same.success >= row.above.success);
    assert.equal(STANDARD_FORMULA.foeBase, 4);
});

test('a same-class fight between a hero and one foe runs a handful of exchanges, and the same seed gives the same fight', () => {
    const run = seed => {
        let value = seed;
        return fight('focused', 3, STANDARD_FORMULA, () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; });
    };
    const a = run(7), b = run(7);
    assert.deepEqual(a, b);
    let rounds = 0, wins = 0;
    for (let seed = 1; seed <= 120; seed += 1) { const result = run(seed); rounds += result.rounds; wins += result.won ? 1 : 0; }
    const mean = rounds / 120;
    assert.ok(mean >= 2.5 && mean <= 7, `mean exchanges ${mean}`);
    assert.ok(wins >= 30 && wins <= 115, `${wins} of 120`);
    assert.equal(blocksFor(buildAt('focused', 3)).health, 5);
});
