// Plays a sequence of board exchanges on a private copy of the sheet.
// The UI and the reply's resolver call this same function with the fixed setup and choices.
// It reads the existing Standard rules and writes only the returned copy and result.

import { applyGear, noteGear, wearGear } from '../gear.js';
import { condWord, gearAnswer, stepDown } from '../../domains/gear.js';
import { condOf, defCarry, ENCUMBERED_PENALTY } from '../../domains/inventory.js';
import { mountRows } from '../../domains/mounts.js';
import { hashJson } from '../../replay.js';
import { statPart } from '../formula.js';
import { readSheet } from '../read.js';
import { hasLevels, isStandard } from '../rules.js';
import { prepareStandard, rollStandard, summaryStd } from '../standard.js';
import { boardDice } from './dice.js';
import { fleeRoll } from './flee.js';
import { exchangePlan } from './plan.js';
import { attackStat } from './rules.js';

const gearQuery = state => (_name, args) => gearAnswer(state, args, { condOf, carryOf: defCarry, penalty: ENCUMBERED_PENALTY, mounts: mountRows(state) });

/** A segment's sheet and equipped pieces must still be the ones used to roll it. */
export function boardWitness(state, setup) {
    const domain = state?.domains?.dataModules, input = { sheet: readSheet(state), active: domain?.active ?? null, pins: domain?.pins ?? null };
    if (setup?.gear) {
        const query = gearQuery(state), inventory = state?.domains?.inventory;
        const owners = [...new Set(['party', ...Object.values(setup.gear.who ?? {}).flatMap(entry => entry.own ?? [])])].sort();
        input.gear = owners.map(owner => ({ owner, answer: query('inventory.gear', { owner }) }));
        input.equipped = Object.values(inventory?.stacks ?? {}).filter(stack => owners.includes(stack.owner) && stack.equipped)
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(stack => ({ id: stack.id, def: stack.def, owner: stack.owner, equipped: stack.equipped, cond: condOf(stack, inventory) }));
    }
    return hashJson(input);
}

/** Rebuild the recorded owners' bonuses and weapons from the private, worn-down inventory. */
export function equipmentForBoard(state, recorded, liveQuery = null) {
    const query = liveQuery ?? gearQuery(state), party = query('inventory.gear', { owner: 'party' }), who = {}, weapons = {};
    for (const [key, entry] of Object.entries(recorded.who)) {
        const add = {}, items = [], answers = entry.own.map(owner => query('inventory.gear', { owner }));
        // Wear changes condition and stat bonuses, but not the recorded carry penalty. A new
        // segment may refresh it from the live, feature-aware inventory query.
        let enc = liveQuery ? (party?.carry?.encumbered ? (party.carry.penalty || -2) : 0) : entry.enc ?? 0;
        for (const answer of answers) {
            for (const [stat, n] of Object.entries(answer.statBonus ?? {})) if (n) add[stat.toLowerCase()] = (add[stat.toLowerCase()] ?? 0) + n;
            for (const piece of Object.values(answer.slots ?? {})) {
                const stats = Object.fromEntries(Object.entries(piece?.stats ?? {}).filter(([, n]) => n).map(([stat, n]) => [stat.toLowerCase(), n]));
                if (piece && !piece.broken && Object.keys(stats).length) items.push({ name: piece.name.replace(/\s+/g, ' ').trim().slice(0, 80), stats });
            }
            if (liveQuery && !enc && answer.carry?.encumbered) enc = answer.carry.penalty || -2;
            if (!weapons[key] && answer.slots?.weapon && !answer.slots.weapon.broken) weapons[key] = answer.slots.weapon;
        }
        who[key] = { own: structuredClone(entry.own), ...(Object.keys(add).length ? { add } : {}), ...(enc ? { enc } : {}), ...(items.length ? { items: items.slice(0, 8) } : {}) };
    }
    return { gear: { v: recorded.v, who }, weapons };
}

// Only this private copy is mutated: the real event is written later by gear.wear on the reply.
function stagingWear(state, gear, options) {
    const query = gearQuery(state), inventory = state.domains.inventory;
    const ctx = { query, call(_type, { owner, slot, steps }) {
        const stacks = Object.values(inventory?.stacks ?? {}).filter(stack => stack.owner === owner);
        const at = place => stacks.filter(stack => stack.equipped === place).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
        const stack = at(slot === 'defence' ? (at('body') ? 'body' : 'off-hand') : slot);
        const before = condOf(stack, inventory), now = stepDown(before, steps);
        stack.cond = now;
        if (inventory.condLog) delete inventory.condLog[stack.id];
        return { data: { before, now } };
    } };
    return wearGear(ctx, gear, { ...options, condWord });
}

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
    if (setup.invalidated) return { error: 'The earlier fight was taken back. Restore that reply or discard this fight.' };
    if (setup.witness?.offset === setup.offset && setup.witness.hash !== boardWitness(state, setup))
        return { error: 'The sheet or gear changed after the fight was rolled. Restore it or discard the fight.' };
    const copy = structuredClone(state), domain = copy.domains.dataModules, rules = setup.rules;
    const rounds = [], opening = [], quickStart = [], idle = [], moved = new Map(), refused = [], wear = [];
    let order = setup.order ?? null, stop = 'open';
    for (const [at, choices] of exchanges.entries()) {
        if (stop !== 'open') return { error: 'The fight has already ended.' };
        const equipment = setup.wearVersion === 1 && setup.gear ? equipmentForBoard(copy, setup.gear) : { gear: setup.gear, weapons: setup.weapons };
        const number = setup.offset + at + 1, sheet = applyGear(readSheet(copy), equipment.gear);
        const built = exchangePlan(sheet, choices?.actions, setup.flags, number);
        if (built.error) return { error: built.error };
        const source = boardDice(setup.seed, number), flee = built.flee ? fleeRoll(built.flee, sheet.foes, rules, source('flee', 0)) : null;
        if (flee && flee.outcome !== 'fail') {
            rounds.push({ n: number, decisive: false, lines: [flee] });
            stop = 'fled';
            continue;
        }
        const prepared = prepareStandard(built.plan, sheet, rules, { maxOf: maxOf(domain), lv: hasLevels(rules), fix: true, then: true });
        weaponSides(prepared, sheet, equipment.weapons);
        const rolled = rollStandard(built.plan, prepared, source, rules, { carried: order, flow: 2, fix: true, then: true, board: true });
        const lines = rolled.rounds[0]?.lines ?? [];
        if (setup.wearVersion === 1 && equipment.gear) {
            noteGear([...rolled.opening, ...lines], equipment.gear);
            wear.push(...stagingWear(copy, equipment.gear, { opening: rolled.opening, rounds: [{ n: number, lines }], rules }));
        }
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
    return { state: copy, result: { rounds, opening, order: order ?? [], quickStart, idle, hurts, refused, stop, ...(wear.length ? { wear } : {}),
        summary: summaryStd([], rounds, refused) } };
}
