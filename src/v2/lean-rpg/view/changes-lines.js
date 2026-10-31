// The RPG's lines in "Changed this reply" (mockup 12-auto-lines): "Rolled for you: 3 exchanges" from the reply's recorded
// rolls, and the automatic rises, "Wessel: Soul Class II → III" and "Iron Breath: Adept → Expert", worked out from the
// state before the reply and the reply's own (the class and rank rules raise them; the display names come from the
// fields' `names`). They come in the shape `replyCardLines` gives (ui-host.js adds them to the card's `moduleLines`).
// Pure: no DOM.

import { FORMULA, RESOLVE } from '../index.js';
import { RPG_STRINGS, fill } from '../strings.js';
import { rpgBlocks, readParty, skillsOf } from './party-data.js';

const C = RPG_STRINGS.changes;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => (Array.isArray(value) ? value : []);
const words = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 40) : '');
const line = fields => ({ module: 'story-block', icon: 'fa-circle-info', text: '', summary: '', flag: '', note: '', kind: 'line', tone: 'info', check: null, ...fields });

/**
 * What the reply's `rpg.resolve` receipt says it rolled: `{ exchanges, pairs }` ("Wessel vs Sluice Rat A") or null.
 * The rolls piece's summary is `{ exchanges, acts }`; a result with `rounds` is counted when it gives no summary.
 */
export function exchangesOf(record, problems = []) {
    const skipped = new Set(list(problems).flatMap(problem => list(problem?.receipts)));
    for (const receipt of list(record?.receipts)) {
        if (receipt?.type !== RESOLVE || skipped.has(receipt.id)) continue;
        const result = receipt.data?.v2?.result;
        if (!isRecord(result)) continue;
        const summary = isRecord(result.summary) ? result.summary : result;
        const rounds = list(result.rounds);
        const exchanges = Number.isSafeInteger(summary.exchanges) ? summary.exchanges : rounds.length;
        if (!(exchanges > 0)) continue;
        const acts = list(summary.acts).length ? list(summary.acts) : rounds.flatMap(round => list(round?.actions ?? round?.lines));
        const pairs = [];
        for (const act of acts) {
            if (!isRecord(act) || act.foe === true || act.side === 'foe') continue;
            const who = words(act.who), target = words(act.target);
            const pair = who && target ? `${who} vs ${target}` : '';
            if (pair && !pairs.includes(pair)) pairs.push(pair);
        }
        return { exchanges, pairs };
    }
    return null;
}

/**
 * The RPG's lines for one reply. `state` is the reply's state, `before` the one before it (null for the first reply: no
 * rises are told then), `record` the reply's record, `problems` the replay problems of that reply.
 */
export function rpgReplyLines({ state, before = null, record = null, problems = [], roleOf } = {}) {
    const out = [];
    const rolled = exchangesOf(record, problems);
    if (rolled) {
        const note = [rolled.pairs.slice(0, 2).join(' · '), C.rolledNote].filter(Boolean).join(' · ');
        out.push(line({ icon: 'fa-dice-d20', tone: 'info', text: fill(rolled.exchanges === 1 ? C.rolledOne : C.rolled, { n: rolled.exchanges }),
            summary: fill(rolled.exchanges === 1 ? C.rolledSummaryOne : C.rolledSummary, { n: rolled.exchanges }), note }));
    }
    if (!before) return out;
    const then = new Map(readParty(before, { roleOf }).map(character => [`${character.module}|${character.subject}`, character]));
    for (const character of readParty(state, { roleOf })) {
        const old = then.get(`${character.module}|${character.subject}`);
        if (!old || !(character.soul > old.soul)) continue;
        const bonus = FORMULA.classWeight * (character.soul - old.soul);
        out.push(line({ icon: 'fa-arrow-up', tone: 'good', text: fill(C.classUp, { who: character.name, from: old.soulName, to: character.soulName }),
            summary: fill(C.classSummary, { to: character.soulName }),
            note: character.xp === 0 ? fill(C.classNote, { xp: character.xp, bonus }) : fill(C.classNoteShort, { bonus }) }));
    }
    const skillsThen = new Map(rpgBlocks(before, { roleOf }).filter(block => block.role === 'skills').map(block => [`${block.module}|${block.subject}`, block]));
    const skillBlocks = rpgBlocks(state, { roleOf }).filter(block => block.role === 'skills');
    for (const block of skillBlocks) {
        const old = skillsThen.get(`${block.module}|${block.subject}`);
        if (!old) continue;
        const was = new Map(skillsOf(old).map(skill => [skill.slot, skill]));
        const who = words(block.fields.who);
        for (const skill of skillsOf(block)) {
            const earlier = was.get(skill.slot);
            if (!earlier || earlier.name !== skill.name || !(skill.rank > earlier.rank)) continue;
            out.push(line({ icon: 'fa-arrow-up', tone: 'good', text: fill(C.rankUp, { skill: skill.name, from: earlier.rankName, to: skill.rankName }),
                summary: fill(C.rankSummary, { skill: skill.name, to: skill.rankName }),
                note: who && skillBlocks.length > 1 ? fill(C.rankNoteWho, { who }) : C.rankNote }));
        }
    }
    return out;
}
