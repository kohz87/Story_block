// (data-modules/, not lean-rpg/: act.js reads it at page start, before the RPG loads.)
// Recovery and XP rules of a marked Character (the one with `scale: 2` on its bars): what the narrator's lines may and may not do, and the notes
// the reader sees when one is not used. Pure: no state is written here. A pin without the mark never reaches these checks, so old chats are untouched.
//
//   * `add-xp` from the story: not used (XP comes from won fights, by code; the reader's own edit stays).
//   * `set-health`, `set-stamina`, `set-mana` may lower a bar, never raise it (a rest, a full rest or a heal does that).
//   * `full-rest` from the story: not twice within 6 story hours for one character (no story clock: allowed). On a reply captured under the `restFallback` rule
//     mark (turn/rule-marks.js) a refused one is decided as the same line with kind `rest` (the pin's own story rest kind; none: refused as before) (part/act.js).
//   * The recovery line: one short line after a marked Character's own lines (restLine, shown by grammarFor, outside the prompt and grammar caps); it names only the recovery kinds
//     the pin offers as story kinds, and the pin is not touched.
const BAR_FIELDS = ['health', 'stamina', 'mana'];

/** Story hours between two full rests of one character. */
export const FULL_REST_HOURS = 6;
/** The hidden fields that keep the story minute of the character's last full rest. */
export const RESTED_FIELD = 'rested-at';
export const RESTED_KNOWN = 'rested-known';
/** The upward-set kinds and the bar each writes. */
export const SET_KINDS = Object.freeze({ 'set-health': 'health', 'set-stamina': 'stamina', 'set-mana': 'mana' });

/** Whether a Character definition carries the mark (all three bars `scale: 2`). */
export const isMarkedCharacter = definition => definition?.role === 'character'
    && BAR_FIELDS.every(bar => definition.state?.[bar]?.scale === 2);

/** The two reader buttons an earlier marked Character was pinned with: never drawn now; their recorded lines still replay (part/act.js). */
export const hasRestButtons = definition => isMarkedCharacter(definition) && ['button-rest', 'button-full-rest'].every(kind => definition.kinds?.[kind]?.ui);

/** The story kinds a Character is told about, with what each restores (the story kinds are those a screen does not own: `ui` is not true). */
const RECOVERY_WORDS = Object.freeze([
    ['rest', 'rest (an hour or two) refills mana and stamina'],
    ['full-rest', `full-rest (a night's sleep, once in ${FULL_REST_HOURS} story hours) refills health, stamina and mana`],
    ['heal', 'heal (1 to 3) restores only health'],
]);
/** The story kind `name` of a definition, or null: it exists and a screen does not own it. */
export const storyKind = (definition, name) => (Object.hasOwn(definition?.kinds ?? {}, name) && definition.kinds[name]?.ui !== true ? definition.kinds[name] : null);

/** The one line that says what the recovery kinds this pin offers restore, shown after a marked Character's lines (views.js grammarFor); '' when it offers none. */
export const restLine = definition => {
    const named = RECOVERY_WORDS.filter(([name]) => storyKind(definition, name)).map(([, words]) => words);
    return named.length ? `Recovery: ${named.join('; ')}.` : '';
};

/** A name bounded to 40 characters, so a note built from it is never cut. */
export const shortName = who => [...String(who)].slice(0, 40).join('');

const NAME = { health: 'Health', stamina: 'Stamina', mana: 'Mana' };
/** The notes (Problems lines), named for the character. */
export const recoveryNote = {
    xp: who => `${who}: XP comes from fights only, so this line was not used.`,
    raised: (who, bar) => (bar === 'health' ? `${who}: Health was not raised. It needs a full rest or a heal.`
        : `${who}: ${NAME[bar]} was not raised. A short rest refills it.`),
    // (the receipt's own summary too: `changes` are the bars the short rest refilled, "Mana Low → Fresh")
    restFallback: (who, changes = []) => `${shortName(who)}: full rest too soon (under ${FULL_REST_HOURS} story hours), counted as a short rest${changes.length ? ` (${changes.join(', ')})` : ''}.`,
    fullRest: who => `${who}: full rest refused. The last one was under ${FULL_REST_HOURS} story hours ago.`,
};

/** Whether a story full rest is too soon: the clock reads `now` (story minutes, null = no clock) and `last` is the stored mark. */
export const fullRestTooSoon = (now, last, known = undefined) => Number.isSafeInteger(now) && Number.isSafeInteger(last)
    && (known === undefined ? last > 0 && now - (last - 1) < FULL_REST_HOURS * 60 : known === true && now - last < FULL_REST_HOURS * 60);
