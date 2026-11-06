// Builds the board's numbered action and target lines from its staged sheet.
// It reads skill flags and current bars; the view only renders the returned plain data.
// Unusable skills stay visible with a reason and cannot be chosen.

import { STAGES, stageWord } from '../names.js';
import { readSheet } from '../read.js';
import { applyGear } from '../gear.js';
import { actionSkills } from './plan.js';
import { attackStat, bestDefence } from './rules.js';
import { skillKey } from './flags.js';

export function boardChoices(state, setup, chosen = []) {
    const sheet = applyGear(readSheet(state), setup?.gear), actors = sheet.characters.filter(actor => actor.alive !== false && actor.health !== 0);
    const actor = actors.find(entry => !chosen.some(action => action.who === entry.who));
    const foes = sheet.foes.filter(foe => foe.filled && foe.hurt > 0);
    if (!actor) return { sheet, actors, foes, actor: null, choices: [] };
    const weapon = setup?.weapons?.[actor.key], stat = attackStat(actor, weapon).toUpperCase();
    const choices = [{ label: `Attack${weapon?.name ? ` with ${weapon.name}` : ''} (${stat})`, action: { who: actor.who, kind: 'attack' } }];
    for (const { skill, target, area, reason } of actionSkills(actor, setup?.flags)) {
        const detail = [skill.stat?.toUpperCase(), skill.uses === 'mana' ? 'Mana' : 'Stamina'].filter(Boolean).join(', ');
        const base = `${skill.name}${skill.about ? `: ${skill.about}` : ''} (${detail})`;
        if (target) choices.push({ label: `${base}${area ? ' — one foe' : ''}`, reason, action: { who: actor.who, kind: 'skill', skill: skill.name } });
        if (area) choices.push({ label: `${base} — every foe`, reason, action: { who: actor.who, kind: 'skill', skill: skill.name, area: true } });
    }
    choices.push({ label: 'Flee', action: { who: actor.who, kind: 'flee' } });
    const defence = bestDefence(actor, skill => setup?.flags?.[skillKey(actor.module, skill)]);
    return { sheet, actors, foes, actor, choices, defence: defence?.name ?? null };
}

export function targetLabel(foe) {
    const size = foe.size ?? 5, health = stageWord(STAGES.health, foe.hurt, size);
    return `${foe.name} (Lv ${foe.level}, ${health})`;
}
