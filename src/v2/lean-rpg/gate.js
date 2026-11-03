// The planner gate (prompt diet): the pre-call (precall.js) is a model call of its own, so it runs only when the dice may be wanted:
// (a) a fight is open (a foe group that is filled in and not Down), or (b) the reader's message reads as risky (the words below, or a
// skill the party has), or (c) the last reply opened foes: its Foes line is on the sheet before the next message, so (c) is (a).
// Otherwise there is no call and the reply goes on exactly as one the planner answered "none" to.
// Pure: the same sheet and message give the same answer on every swipe, regenerate and retry, so a replay never asks again.
import { fold } from './read.js';

// Verbs and nouns that mean an uncertain action: the planner's own words (attack, sneak, persuade, climb, lie, a parry, a dodge) and the
// Combat rules' (strike, wound, collapse). Each base word is read with its -s, -es, -ed, -d, -ing forms (and a doubled last letter: hit, hitting);
// IRREGULAR holds the forms that do not follow (struck, shot, fought, stole).
const BASE = [
    'attack', 'strike', 'stab', 'slash', 'hit', 'punch', 'kick', 'swing', 'smash', 'bash', 'fight', 'battle', 'duel', 'kill', 'slay', 'wound',
    'shoot', 'throw', 'hurl', 'cast', 'charge', 'ambush', 'grapple', 'wrestle', 'tackle', 'shove', 'disarm',
    'dodge', 'block', 'parry', 'evade', 'defend', 'brace', 'shield',
    'sneak', 'slip', 'hide', 'steal', 'pickpocket', 'lockpick', 'climb', 'jump', 'leap', 'swim', 'vault', 'scale',
    'persuade', 'convince', 'bluff', 'lie', 'deceive', 'threaten', 'intimidate', 'charm', 'seduce', 'haggle', 'bribe',
];
const IRREGULAR = ['struck', 'shot', 'fought', 'stole', 'stolen', 'slew', 'slain', 'threw', 'thrown', 'swung', 'swam', 'crept', 'sneaked', 'snuck', 'lying', 'spell', 'spells', 'spar', 'sparring', 'brawl', 'skirmish'];

const formsOf = base => {
    const last = base.at(-1), stem = base.endsWith('e') ? base.slice(0, -1) : base;
    return [base, `${base}s`, `${base}es`, `${base}ed`, `${base}d`, `${base}ing`, `${stem}ing`, `${base}${last}ed`, `${base}${last}ing`];
};
const WORDS = new Set([...BASE.flatMap(formsOf), ...IRREGULAR]);
// "pick a lock", "pick the lock", "picks locks", "picking the old lock"
const PICK_LOCK = /\bpick(?:s|ed|ing)?\s+(?:\p{L}+\s+){0,2}locks?\b/u;

const wordsOf = text => String(text ?? '').normalize('NFKC').toLowerCase().match(/\p{L}+(?:['’]\p{L}+)?/gu) ?? [];

/** Whether a fight is open on the sheet: some foe group is filled in and not Down. */
export const fightIsOpen = sheet => (sheet?.foes ?? []).some(foe => foe.filled && foe.hurt > 0);

/** Whether the reader's message reads as a risky action: a listed word, "pick a lock", or one of the party's skills (by its name) or a listed foe. */
export function riskyMessage(text, sheet = null) {
    const message = String(text ?? '');
    if (wordsOf(message).some(word => WORDS.has(word)) || PICK_LOCK.test(message.normalize('NFKC').toLowerCase())) return true;
    const folded = fold(message);
    const names = [...(sheet?.characters ?? []).flatMap(entry => entry.skills.map(skill => skill.name)), ...(sheet?.foes ?? []).filter(foe => foe.filled).map(foe => foe.name)];
    return names.some(name => { const key = fold(name); return key.length >= 4 && folded.includes(key); });
}

/** Whether the pre-call is to ask the model for this message. */
export const plannerWanted = (sheet, message) => fightIsOpen(sheet) || riskyMessage(message, sheet);
