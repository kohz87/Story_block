// The three d20 a reply offers outside a fight: one seeded stream per reply, and the exact note the narrator reads.
// Pure: the same seed gives the same dice, so a Re-read can ask again without rolling anything new. (The note's text lives in names.js, a shared helper, so the cue can tell it without loading this.)

import { rng } from '../../rng.js';
import { FORMULA, offerLine } from '../names.js';

/** How many dice one reply offers. */
export const CHECK_DICE_COUNT = 3;

/** The reply's dice, in order, from its uint32 seed: three whole numbers from 1 to 20. */
export function replyDice(seed) {
    const random = rng(seed);
    return Array.from({ length: CHECK_DICE_COUNT }, () => 1 + Math.floor(random() * FORMULA.die));
}

export { offerLine };

/** `rpg.dice`: the prelude's handler. The dice come from the receipt's seed (a swipe draws anew, a Re-read keeps them); the note is told from the record (cue.js), never stored as text. */
export function diceRecord(ctx) {
    if (ctx.cause !== 'system' || ctx.caller !== null) ctx.fail('REFUSED', 'The dice are rolled by Story Block before a reply, not by an action.');
    return { summary: '', narrate: false, data: { v2: { dice: { v: 1, list: replyDice(Math.floor(ctx.rng() * 4294967296) >>> 0) } } } };
}
