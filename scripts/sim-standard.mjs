// Simulation of the Standard stat formula (no network, no SillyTavern): how often a roll succeeds, succeeds at a cost, fails and is
// decisive, for a focused and a spread build at Soul Class I, III, V, VII and IX against foes of the same class and one class either side, at
// each difficulty (Gentle, Standard, Harsh); and how many exchanges a fight between a hero and a foe of the same class lasts.
//
//   node scripts/sim-standard.mjs            the tables, as markdown
//   node scripts/sim-standard.mjs --json     the same numbers as JSON
//
// The single-roll odds are exact (all 400 pairs of dice through the engine's own `judge`); the fights run the real roll engine
// (src/v2/lean-rpg/standard.js) over a synthetic sheet with a seeded generator, so the same numbers come out every time.
import { blocksFor, foeBonus, foeHealthBlocks, pair, STAT_KEYS } from '../src/v2/lean-rpg/formula.js';
import { STANDARD_PRESETS, STANDARD_FORMULA, statShare } from '../src/v2/lean-rpg/rules.js';
import { FORMULA, PRESETS } from '../src/v2/lean-rpg/index.js';
import { positionalDice } from '../src/v2/lean-rpg/resolve.js';
import { judge, prepareStandard, rollStandard } from '../src/v2/lean-rpg/standard.js';

const CLASSES = [1, 3, 5, 7, 9];
const DIFFICULTIES = ['gentle', 'standard', 'harsh'];
const BUILDS = ['focused', 'spread'];
const FIGHTS = 1500;

// ---- the builds -------------------------------------------------------------------------------------------------------

/** A skill's rank by Soul Class: Novice at I and II, Adept at III and IV, Expert at V and VI, Master from VII (practice is slow, so ranks lag). */
export const rankAt = soul => Math.min(3, Math.floor((soul - 1) / 2));

const raise = (stats, order, max) => {
    const key = order.find(name => stats[name] < max);
    if (key) stats[key] += 1;
};

/**
 * The stats of a build at a Soul Class under `numbers` (formula.js STANDARD_NUMBERS):
 * - focused: creation puts the skill's stat (STR) and DEX at the creation maximum; each Soul Class spends 3 of its points on the skill's stat
 *   and 1 on DEX until they are full, then the rest on VIT, AGI, INT, CHA, LUK and STR;
 * - spread: creation gives STR +3, DEX +2 and every other stat +1; each Soul Class point goes to the lowest stat.
 */
export function buildAt(kind, soul, numbers = STANDARD_FORMULA) {
    const stats = Object.fromEntries(STAT_KEYS.map(key => [key, numbers.startStat]));
    const max = numbers.statMax;
    const spill = ['vit', 'agi', 'int', 'cha', 'luk', 'str'];
    if (kind === 'focused') {
        stats.str = numbers.createMax; stats.dex = Math.min(numbers.createMax, numbers.startStat + (numbers.createPoints - (numbers.createMax - numbers.startStat)));
        for (let level = 2; level <= soul; level += 1) {
            for (let n = 0; n < numbers.pointsPerSoul; n += 1) raise(stats, n < numbers.pointsPerSoul - 1 ? ['str', 'dex', ...spill] : ['dex', 'str', ...spill], max);
        }
    } else {
        stats.str += 3; stats.dex += 2; for (const key of ['vit', 'agi', 'int', 'cha', 'luk']) stats[key] += 1;
        for (let level = 2; level <= soul; level += 1) {
            for (let n = 0; n < numbers.pointsPerSoul; n += 1) raise(stats, [...STAT_KEYS].sort((a, b) => stats[a] - stats[b]), max);
        }
    }
    return stats;
}

// ---- single rolls -----------------------------------------------------------------------------------------------------

/** The exact odds of one roll: the party's d20 + `bonus` against the foe's d20 + `against`. → whole-percent { success, cost, fail, decisive } of 400 pairs. */
export function exactOdds(bonus, against, rules) {
    const count = { success: 0, cost: 0, fail: 0, decisive: 0 };
    for (let mine = 1; mine <= FORMULA.die; mine += 1) for (let theirs = 1; theirs <= FORMULA.die; theirs += 1) {
        const result = judge(mine, mine + bonus, theirs, theirs + against, rules);
        count[result.outcome] += 1;
        if (result.decisive) count.decisive += 1;
    }
    const percent = n => Math.round(n * 100 / (FORMULA.die * FORMULA.die));
    return { success: percent(count.success), cost: percent(count.cost), fail: percent(count.fail), decisive: percent(count.decisive) };
}

const bonusOf = (stats, soul, rules) => pair(stats.str, stats.dex) + rules.classWeight * soul + rankAt(soul);

export function rollTable() {
    const rows = [];
    for (const difficulty of DIFFICULTIES) {
        const rules = STANDARD_PRESETS[difficulty];
        for (const build of BUILDS) for (const soul of CLASSES) {
            const stats = buildAt(build, soul, rules), bonus = bonusOf(stats, soul, rules);
            const row = { difficulty, build, soul, bonus };
            for (const [name, shift] of [['same', 0], ['below', -1], ['above', 1]]) {
                const foeClass = Math.max(1, Math.min(9, soul + shift));
                row[name] = exactOdds(bonus, foeBonus(foeClass, rules), rules);
            }
            rows.push(row);
        }
    }
    return rows;
}

/** Classic at its Standard difficulty, for the same builds (a hero's STR is the skill's stat there): the line the Standard formula is tuned against. */
export function classicTable() {
    const rules = PRESETS.standard, classic = { ...rules, formula: undefined };
    return CLASSES.map(soul => {
        const stats = buildAt('focused', soul), bonus = statShare(stats.str, classic) + classic.classWeight * soul + rankAt(soul);
        return { soul, bonus, same: exactOdds(bonus, classic.foeBase + classic.classWeight * soul, classic) };
    });
}

// ---- fights -----------------------------------------------------------------------------------------------------------

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const sheetOf = (stats, soul, foeClass, heroHealth, foeHealth) => ({
    problems: [],
    characters: [{ module: 'h', who: 'Hero', key: 'hero', health: heroHealth, mana: 4, stamina: 4, stats, soul, alive: true, hidden: [],
        skills: [{ slot: 1, name: 'Strike', about: '', rank: rankAt(soul), practice: 0, stat: 'str', uses: 'stamina', hidden: [] }] }],
    foes: [{ slot: 1, module: 'f', name: 'Foe', count: 1, class: foeClass, hurt: foeHealth, filled: true, hidden: [] }],
});

/** One fight to the end (a reply at a time, the way the story would): { rounds, replies, won }. */
export function fight(build, soul, rules, random) {
    const stats = buildAt(build, soul, rules);
    const size = blocksFor(stats).health;
    let heroHealth = size, foeHealth = foeHealthBlocks(soul), carried = null, rounds = 0, replies = 0;
    const plan = { formula: 'standard', pace: 'all', acts: [{ who: 'Hero', skill: 'Strike', target: 'Foe' }], foes: [{ slot: 1, target: 'Hero' }], checks: [] };
    const loose = { ...rules, roundCap: 8 };
    while (heroHealth > 0 && foeHealth > 0 && replies < 60) {
        const prepared = prepareStandard(plan, sheetOf(stats, soul, soul, heroHealth, foeHealth), loose);
        const rolled = rollStandard(plan, prepared, positionalDice(Math.floor(random() * 4294967296) >>> 0), loose, { carried });
        rounds += rolled.rounds.length; replies += 1;
        carried = rolled.order.map(({ id, name, total, agi, party }) => ({ id, name, total, agi, party }));
        for (const hurt of rolled.hurts) { if (hurt.kind === 'char') heroHealth = hurt.to; else foeHealth = hurt.to; }
    }
    return { rounds, replies, won: foeHealth === 0 };
}

export function fightTable() {
    const rows = [];
    for (const difficulty of DIFFICULTIES) for (const build of BUILDS) for (const soul of CLASSES) {
        const rules = STANDARD_PRESETS[difficulty], random = seeded(soul * 1000 + build.length * 17 + difficulty.length);
        let rounds = 0, wins = 0, replies = 0;
        for (let n = 0; n < FIGHTS; n += 1) { const result = fight(build, soul, rules, random); rounds += result.rounds; replies += result.replies; wins += result.won ? 1 : 0; }
        rows.push({ difficulty, build, soul, exchanges: Math.round(rounds * 10 / FIGHTS) / 10, replies: Math.round(replies * 10 / FIGHTS) / 10, heroWins: Math.round(wins * 100 / FIGHTS) });
    }
    return rows;
}

// ---- output -----------------------------------------------------------------------------------------------------------

const odds = o => `${o.success}/${o.cost}/${o.fail} d${o.decisive}`;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

function markdown(rolls, classic, fights) {
    const out = [];
    out.push('# Standard formula simulation', '', `Presets: ${DIFFICULTIES.map(name => `${name} foeBase ${STANDARD_PRESETS[name].foeBase}`).join(', ')}; foeClassWeight ${STANDARD_FORMULA.foeClassWeight}; Soul Class worth ${STANDARD_FORMULA.classWeight}.`, '');
    out.push('Each cell: success / at a cost / fail in per cent, then d = decisive per cent of rolls. Rank by Soul Class: ' + CLASSES.map(soul => `${ROMAN[soul]} ${rankAt(soul)}`).join(', ') + '.', '');
    for (const difficulty of DIFFICULTIES) {
        out.push(`## ${difficulty[0].toUpperCase()}${difficulty.slice(1)}`, '', '| Build | Soul Class | Bonus | vs same class | vs one below | vs one above |', '|---|---|---|---|---|---|');
        for (const row of rolls.filter(item => item.difficulty === difficulty)) out.push(`| ${row.build} | ${ROMAN[row.soul]} | +${row.bonus} | ${odds(row.same)} | ${odds(row.below)} | ${odds(row.above)} |`);
        out.push('');
    }
    out.push('## Classic at its Standard difficulty (focused build, same class), for comparison', '', '| Soul Class | Bonus | success / at a cost / fail |', '|---|---|---|');
    for (const row of classic) out.push(`| ${ROMAN[row.soul]} | +${row.bonus} | ${row.same.success}/${row.same.cost}/${row.same.fail} |`);
    out.push('', `## A hero against one foe of the same class (${FIGHTS} fights each)`, '', 'Exchanges are rounds rolled until one side is down; a reply holds up to the decisive round.', '',
        '| Difficulty | Build | Soul Class | Exchanges | Replies | Hero wins % |', '|---|---|---|---|---|---|');
    for (const row of fights) out.push(`| ${row.difficulty} | ${row.build} | ${ROMAN[row.soul]} | ${row.exchanges} | ${row.replies} | ${row.heroWins} |`);
    return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const rolls = rollTable(), classic = classicTable(), fights = fightTable();
    console.log(process.argv.includes('--json') ? JSON.stringify({ rolls, classic, fights }, null, 1) : markdown(rolls, classic, fights));
}
