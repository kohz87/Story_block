// The result of one validated check: the old check line's d20 + stat part + rank, against LIMITS.dc, with the rules'
// cost and decisive margins. A skilled check gives its skill one practice use; checks never give XP.

import { statPart } from '../formula.js';
import { FORMULA, LIMITS, RANK_NAMES } from '../names.js';
import { classTerm, STANDARD } from '../rules.js';
import { outcomeOf } from '../resolve/dice.js';

const whole = value => (Number.isInteger(value) ? value : null);

/** The class term the old check line added, when the member carries the class numbers it needs. */
function classBonusOf(member, rules) {
    if (Number.isInteger(rules?.levelDivisor)) return Number.isInteger(member?.level) ? classTerm(rules, member).classBonus : 0;
    return Number.isInteger(member?.soul) ? classTerm(rules, member).classBonus : 0;
}

/**
 * A validated check (`validateCheck`), its die (the same one) and the rules in force.
 * → { who, member, skill, stat, what, difficulty, dc, die, statBonus, classBonus, rank, bonus, total, outcome, decisive, practice }.
 */
export function resolveCheck(check, die, rules = STANDARD) {
    const numbers = { ...STANDARD, ...(rules && typeof rules === 'object' ? rules : {}) };
    const member = check.member;
    const skill = check.skill ?? null;
    const stat = skill ? cleanStat(skill.stat) : cleanStat(check.stat);
    const part = statPart('check', member.stats, { skillStat: skill ? stat : null, fittingStat: skill ? null : stat });
    const classBonus = classBonusOf(member, numbers);
    const rank = whole(skill?.rank) ?? 0;
    const total = die + part.value + classBonus + rank;
    const outcome = outcomeOf(die, total, check.dc, numbers);
    const decisive = outcome !== 'fail' && (die === FORMULA.die || total - check.dc >= (numbers.decisiveMargin ?? LIMITS.decisiveMargin));
    return {
        who: member.name, member, skill: skill ?? null, stat, what: skill?.name ?? stat.toUpperCase(), difficulty: check.difficulty, dc: check.dc,
        die, statBonus: part.value, classBonus, rank, rankName: RANK_NAMES[rank] ?? `Rank ${rank}`, bonus: part.value + classBonus + rank,
        total, outcome, decisive, utility: skill?.type === 'utility',
        practice: skill ? { who: member.name, skill: skill.name, n: 1 } : null,
    };
}

const cleanStat = value => String(value ?? '').trim().toLowerCase();
