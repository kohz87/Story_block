// What the next point of a stat buys under the Standard formula (formula.js): the bars grow a block every 5 points of VIT, AGI and INT, and
// luck steps at LUK 8 (back to 0), 13, 16 and 19. The creation Stats step and the Spend points sheet show it as one line, and the line follows
// the steppers as they move. Pure.
import { blocksFor, luckOf } from './formula.js';

const num = value => (Number.isFinite(value) ? Math.trunc(value) : 0);
const nextMultiple = (stat, max) => { const next = (Math.floor(num(stat) / 5) + 1) * 5; return next <= max ? next : null; };
const LUCK_STEPS = Object.freeze([8, 13, 16, 19]);

/** The stat value at which luck next rises, or null at the top (LUK 19 and over). */
export const nextLuckAt = (luk, max = 20) => LUCK_STEPS.find(step => step > num(luk) && step <= max) ?? null;

/**
 * The growth of a set of stats: `{ health, stamina, mana }` each `{ blocks, next }` (`next`: the stat value that gives one more block, null when
 * it cannot rise further under `max`, the stat maximum) and `luck` `{ value, next }`.
 */
export function growthOf(stats, max = 20) {
    const blocks = blocksFor(stats);
    return {
        health: { blocks: blocks.health, next: nextMultiple(stats?.vit, max) },
        stamina: { blocks: blocks.stamina, next: nextMultiple(stats?.agi, max) },
        mana: { blocks: blocks.mana, next: nextMultiple(stats?.int, max) },
        luck: { value: luckOf(stats?.luk), next: nextLuckAt(stats?.luk, max) },
    };
}

const signed = value => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0');

/**
 * "Health 6 blocks (next at VIT 15) · Stamina 5 (next at AGI 15) · Mana 4 (next at INT 10) · Luck 0 (next at LUK 13)", from the words `text`
 * (strings.js RPG_STRINGS.growth); a bar that cannot grow says so instead of a next stat.
 */
export function growthLine(stats, text, max = 20) {
    const growth = growthOf(stats, max);
    const next = (stat, at) => (at === null ? text.top : text.next.replace('{stat}', stat).replace('{n}', String(at)));
    return [
        text.health.replace('{n}', String(growth.health.blocks)).replace('{next}', next('VIT', growth.health.next)),
        text.stamina.replace('{n}', String(growth.stamina.blocks)).replace('{next}', next('AGI', growth.stamina.next)),
        text.mana.replace('{n}', String(growth.mana.blocks)).replace('{next}', next('INT', growth.mana.next)),
        text.luck.replace('{n}', signed(growth.luck.value)).replace('{next}', next('LUK', growth.luck.next)),
    ].join(' · ');
}
