// Plays a sequence of board exchanges on a private copy of the sheet.
// The UI and the reply's resolver call this same function with the fixed setup and choices.
// It reads the existing Standard rules and writes only the returned copy and result.

import { applyGear } from '../gear.js';
import { statPart } from '../formula.js';
import { readSheet } from '../read.js';
import { hasLevels, isStandard } from '../rules.js';
import { prepareStandard, rollStandard, summaryStd } from '../standard.js';
import { boardDice } from './dice.js';
import { fleeRoll } from './flee.js';
import { exchangePlan } from './plan.js';
import { attackStat } from './rules.js';

const maxOf = domain => (module, field) => {
    const max = domain?.pins?.[domain?.active?.[module]?.hash]?.definition?.state?.[field]?.max;
    return Number.isSafeInteger(max) ? max : Infinity;
};

function weaponSides(prepared, sheet, weapons) {
    for (const entry of prepared.acts) {
        if (entry.skill) continue;
        const actor = sheet.characters.find(character => character.key === entry.actor.slice(2));
        if (!actor) continue;
        const stat = attackStat(actor, weapons?.[actor.key]);
        const part = statPart('physical', actor.stats, { skillStat: stat });
        entry.pc = { ...entry.pc, stat: part.main, second: part.second, mainValue: actor.stats[part.main], secondValue: actor.stats[part.second], statBonus: part.value };
    }
}

function applyHurts(domain, hurts) {
    for (const hurt of hurts) {
        const fields = domain?.instances?.[hurt.module]?.chat?.fields;
        if (fields && Object.hasOwn(fields, hurt.field)) fields[hurt.field] = hurt.to;
    }
}

/** Run the saved setup and choices; errors leave the caller's state untouched. */
export function playBoard(state, setup, exchanges) {
    if (!state?.domains?.dataModules || !Number.isInteger(setup?.seed) || setup.seed < 0 || setup.seed > 0xFFFFFFFF || !isStandard(setup?.rules)
        || !Number.isInteger(setup.offset) || setup.offset < 0 || !Array.isArray(exchanges) || exchanges.length > 99) return { error: 'The fight setup is damaged.' };
    const copy = structuredClone(state), domain = copy.domains.dataModules, rules = setup.rules;
    const rounds = [], opening = [], quickStart = [], idle = [], moved = new Map(), refused = [];
    let order = setup.order ?? null, stop = 'open';
    for (const [at, choices] of exchanges.entries()) {
        if (stop !== 'open') return { error: 'The fight has already ended.' };
        const number = setup.offset + at + 1, sheet = applyGear(readSheet(copy), setup.gear);
        const built = exchangePlan(sheet, choices?.actions, setup.flags, number);
        if (built.error) return { error: built.error };
        const source = boardDice(setup.seed, number), flee = built.flee ? fleeRoll(built.flee, sheet.foes, rules, source('flee', 0)) : null;
        if (flee && flee.outcome !== 'fail') {
            rounds.push({ n: number, decisive: false, lines: [flee] });
            stop = 'fled';
            continue;
        }
        const prepared = prepareStandard(built.plan, sheet, rules, { maxOf: maxOf(domain), lv: hasLevels(rules), fix: true, then: true });
        weaponSides(prepared, sheet, setup.weapons);
        const rolled = rollStandard(built.plan, prepared, source, rules, { carried: order, flow: 2, fix: true, then: true, board: true });
        const lines = rolled.rounds[0]?.lines ?? [];
        rounds.push({ n: number, decisive: rolled.rounds[0]?.decisive === true, lines: flee ? [flee, ...lines] : lines, ...(rolled.rounds[0]?.idle?.length ? { idle: rolled.rounds[0].idle } : {}) });
        opening.push(...rolled.opening);
        quickStart.push(...rolled.quickStart);
        idle.push(...rolled.idle);
        refused.push(...prepared.refused);
        order = rolled.order;
        applyHurts(domain, rolled.hurts);
        for (const hurt of rolled.hurts) {
            const previous = moved.get(hurt.id);
            moved.set(hurt.id, { ...hurt, from: previous?.from ?? hurt.from });
        }
        if (rolled.stop === 'won' || rolled.stop === 'lost') stop = rolled.stop;
    }
    const hurts = [...moved.values()].filter(hurt => hurt.from !== hurt.to);
    return { state: copy, result: { rounds, opening, order: order ?? [], quickStart, idle, hurts, refused, stop,
        summary: summaryStd([], rounds, refused) } };
}
