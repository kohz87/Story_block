// Turns one exchange of reader choices into an ordinary prepared fight plan.
// It validates the current sheet, skills and targets before automatic foe actions are added.
// It reads no DOM and writes no state; the board and the committed roll both use it.

import { fold } from '../read.js';
import { bestDefence } from './rules.js';
import { skillFlags, skillKey } from './flags.js';

const find = (entries, name, field) => entries.find(entry => fold(entry[field]) === fold(name));
const standing = character => character.alive !== false && character.health !== 0;
const up = foe => foe.filled && foe.hurt > 0;
const flagsFor = (flags, actor, skill) => flags?.[skillKey(actor.module, skill)];

/** The skills usable for an action, with the resource reason when one is empty. */
export function actionSkills(actor, flags = {}) {
    return (actor?.skills ?? []).flatMap(skill => {
        const scope = skillFlags(skill, flagsFor(flags, actor, skill));
        if (!scope.target && !scope.area) return [];
        const resource = skill.uses === 'mana' ? 'mana' : 'stamina';
        return [{ skill, ...scope, reason: actor[resource] === 0 ? `${resource === 'mana' ? 'Mana' : 'Stamina'} is Empty` : '' }];
    });
}

/** Build a Standard plan from one choice for each standing member, or one flee choice. */
export function exchangePlan(sheet, actions, flags = {}, number = 1) {
    const actors = (sheet?.characters ?? []).filter(standing), foes = (sheet?.foes ?? []).filter(up);
    if (!actors.length || !foes.length) return { error: 'The fight has already ended.' };
    if (!Array.isArray(actions) || !actions.length || actions.length > actors.length) return { error: 'Choose an action for each standing member.' };
    const fleeing = actions.length === 1 && actions[0]?.kind === 'flee';
    if (!fleeing && actions.length !== actors.length) return { error: 'Choose an action for each standing member.' };
    const seen = new Set(), acts = [];
    for (const action of actions) {
        if (!action || typeof action !== 'object' || !['attack', 'skill', 'flee'].includes(action.kind)) return { error: 'That action is not available.' };
        const actor = find(actors, action.who, 'who');
        if (!actor || seen.has(actor.key)) return { error: 'That member cannot act twice.' };
        seen.add(actor.key);
        if (action.kind === 'flee') {
            if (!fleeing) return { error: 'Flee is the whole exchange.' };
            continue;
        }
        const skill = action.kind === 'skill' ? find(actor.skills, action.skill, 'name') : null;
        if (action.kind === 'skill' && !skill) return { error: 'That skill is no longer on the sheet.' };
        const scope = skill ? skillFlags(skill, flagsFor(flags, actor, skill)) : { target: true, area: false };
        const area = action.area === true;
        if (area ? !scope.area : !scope.target) return { error: 'That skill cannot be used on that target.' };
        const resource = skill?.uses === 'mana' ? 'mana' : 'stamina';
        if (skill && actor[resource] === 0) return { error: `${resource === 'mana' ? 'Mana' : 'Stamina'} is Empty.` };
        const target = area ? foes[0] : foes.find(foe => foe.slot === action.target);
        if (!target) return { error: 'That foe is no longer standing.' };
        acts.push({ who: actor.who, ...(skill ? { skill: skill.name } : {}), target: `foe${target.slot}`, type: skill?.uses === 'mana' ? 'magic' : 'physical', ...(area ? { area: true } : {}) });
    }
    // Each foe picks a standing member in stable order; the defender's best available evasion is automatic.
    const attacks = foes.map((foe, at) => {
        const target = actors[(at + number - 1) % actors.length];
        const skill = bestDefence(target, item => flagsFor(flags, target, item));
        return { slot: foe.slot, target: target.who, ...(skill ? { skill: skill.name } : {}) };
    });
    return { plan: { formula: 'standard', pace: 'careful', acts, foes: attacks, checks: [] }, ...(fleeing ? { flee: find(actors, actions[0].who, 'who') } : {}) };
}
