// The three d20 a reply offers outside a fight: one seeded stream per reply, and the exact note the narrator reads.
// Pure: the same seed gives the same dice, so a Re-read can ask again without rolling anything new.

import { rng } from '../../rng.js';
import { FORMULA } from '../names.js';

/** How many dice one reply offers. */
export const CHECK_DICE_COUNT = 3;

/** The reply's dice, in order, from its uint32 seed: three whole numbers from 1 to 20. */
export function replyDice(seed) {
    const random = rng(seed);
    return Array.from({ length: CHECK_DICE_COUNT }, () => 1 + Math.floor(random() * FORMULA.die));
}

/** The exact prompt note from the approved mockup, with `dice` in the order they were rolled. */
export function offerLine(dice) {
    return `Dice for this reply, in order: ${(Array.isArray(dice) ? dice : []).join(', ')}. Use one for each attempt that can fail (yours or a party member's): d20 + stat part + skill rank against easy 10 (routine for a trained person), normal 15 (a real chance to fail), hard 20 (a skilled person often fails), very hard 25 (rarely done). The story must follow each result strictly. Report each: ? check Name | skill or stat | difficulty | die.`;
}
