// The "Check" card under a reply: one line per checked attempt, from result.js results. createElement and textContent only.

import { PRACTICE, RANK_NAMES } from '../names.js';

const OUTCOME = Object.freeze({ success: ['ok', 'Success'], cost: ['cost', 'Success at a cost'], fail: ['fail', 'Fail'] });

const el = (doc, tag, className = '', text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
};

const signed = value => (value < 0 ? `− ${Math.abs(value)}` : `+ ${value}`);

function lineNode(doc, result) {
    const line = el(doc, 'div', 'rpg-check-line');
    const who = el(doc, 'span', 'rpg-check-who');
    who.append(el(doc, 'span', 'rpg-check-name', result.who), doc.createTextNode(' · '), el(doc, 'span', 'rpg-check-what', result.what));
    if (result.utility) who.append(doc.createTextNode(' '), el(doc, 'span', 'rpg-check-util', 'utility'));
    const rank = result.rankName ?? RANK_NAMES[result.rank] ?? `Rank ${result.rank}`;
    const detail = result.skill ? `(${String(result.stat).toUpperCase()}, ${rank})` : `(${String(result.stat).toUpperCase()}, no skill)`;
    who.append(doc.createTextNode(' '), el(doc, 'span', 'rpg-check-muted', detail), doc.createTextNode(' · '), el(doc, 'span', 'rpg-check-difficulty', result.difficulty));

    const bonus = Number.isFinite(result.bonus) ? result.bonus : (result.statBonus ?? 0) + (result.rank ?? 0) + (result.classBonus ?? 0);
    const numbers = el(doc, 'span', 'rpg-check-num', `d20 ${result.die} ${signed(bonus)} = ${result.total} vs ${result.dc}`);
    const [tone, word] = OUTCOME[result.outcome] ?? OUTCOME.fail;
    const row = el(doc, 'span', 'rpg-check-result');
    row.appendChild(el(doc, 'span', `rpg-check-pill rpg-check-${tone}`, word));
    if (result.practice?.skill) {
        const n = Number.isInteger(result.practice.n) ? result.practice.n : 1;
        const gained = Number.isFinite(result.practiceGained) ? result.practiceGained : PRACTICE.perUse * n;
        row.append(doc.createTextNode(' '), el(doc, 'span', 'rpg-check-gain', `${result.practice.skill} +${gained} practice`));
    }
    line.append(who, numbers, row);
    return line;
}

/** The Check card for a list of result.js results. */
export function buildCheckCard(doc, results = []) {
    const root = el(doc, 'div', 'rpg-check rpg-check-card');
    root.setAttribute('data-variant', 'card');
    root.appendChild(el(doc, 'span', 'rpg-check-h', 'Check'));
    for (const result of Array.isArray(results) ? results : []) root.appendChild(lineNode(doc, result));
    return root;
}
