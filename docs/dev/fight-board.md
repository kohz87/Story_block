# Fight board

The fight board is the reader's own exchange-by-exchange control of a Lean RPG fight. It is the Feature
`story-block.fight-board` (on by default; `story-block.rpg` still gates the RPG and the Fight tab). With the
board closed or the Feature off, the ordinary planner path is unchanged.

## Files

- `src/v2/lean-rpg/board/session.js`: opens, stages, undoes, discards and reconciles the chat-metadata session; keeps the last payload for a regenerate.
- `src/v2/lean-rpg/board/engine.js`: plays the recorded setup and choices on a private state copy with the Standard rules.
- `src/v2/lean-rpg/board/plan.js`: validates one action per standing member and turns it into a Standard plan, adding foe actions and automatic defence.
- `src/v2/lean-rpg/board/rules.js`: chooses a weapon's best eligible stat and the best usable defence skill.
- `src/v2/lean-rpg/board/flee.js`: rolls the AGI contest against the strongest standing foe group.
- `src/v2/lean-rpg/board/dice.js`: derives the fixed fight seed and each exchange's independent d20 stream.
- `src/v2/lean-rpg/board/flags.js`: reads target, area and defence defaults from a skill's words and keys explicit choices.
- `src/v2/lean-rpg/board/overrides.js`: declares the feature-gated `rpg.boardSkill` command and keeps reply-owned explicit flags.
- `src/v2/lean-rpg/board/commit.js`: the guarded `rpg.resolve` branch that replays the board, claims once and writes its hurts and gear wear.
- `src/v2/lean-rpg/board/note.js`: makes the complete settled account for the narrator from the recorded result.
- `src/v2/lean-rpg/board/awards.js`: reads the winning board result so a split fight pays its opening groups once.
- `src/v2/lean-rpg/board/view-data.js`: builds numbered action and target lines, including disabled reasons.
- `src/v2/lean-rpg/board/view.js`: draws the bars, log, target list, end card, undo/discard controls and keyboard handling.
- `src/v2/lean-rpg/board/skill-editor.js`: draws the three checkboxes inside the existing skill editor.
- `src/v2/lean-rpg/board/board.css`: the touch-first layout and sizing.

## Data flow

1. `openBoard` uses the carrier's `sid`, its discard count and the current rules, gear and weapons. The seed is
   `fightSeed(sid, attempt)`, so it is fixed before any reply exists.
2. `stageExchange` appends actions to the `rpgFightBoard` chat-metadata session and calls `playBoard` for the preview;
   it never writes the game state. Undo removes only unsent exchanges.
3. `precall.beforeGenerate` sees an open session (or a swipe's receipt / a regenerate's remembered payload) and emits an
   `rpg.resolve` prelude carrying `{ key, board, practice }`. The planner is not called. With no board it continues as before.
4. `resolveBoard` replays `playBoard` from the recorded setup and actions, checks its claim and witness guard, writes the
   resulting hurt fields and gear wear, and returns the ordinary `rpg.resolve` receipt with `data.v2.result`.
5. `afterReceive` records `rpgFightLast`. An open result starts the next segment at the next exchange offset and clears the
   carried actions; won, lost and fled delete the open session.
6. A swipe uses the receipt's own `replan.payload` (`priorBoard`), Re-read uses the stored prelude, and a regenerate uses
   `rpgFightLast`. `reconcileBoard` resets a segment's offset and order if its carrying receipt disappears.

## Stored data

- `chatMetadata.rpgFightBoard`: `{ id, origin, anchor, groups, setup, exchanges, carried?, base? }`. `setup` holds the fixed
  `seed`, `offset`, `rules`, `flags`, `weapons`, optional `gear` and optional carried `order`. This is unsent staging, not state.
- `chatMetadata.rpgFightAttempts`: `{ [originSid]: discardCount }`; Discard increments it so the next opening gets a new seed.
- `chatMetadata.rpgFightLast`: the last `{ key, board, practice }`, used when a regenerate has already removed its old reply.
- `state.domains.dataModules.boardFlags`: `{ [sid]: { [entryId]: { id, key, flags, rev } } }`, a declared scratch map.
  `key` is the Character block plus skill slot and folded name. The latest `rev` wins. A newer edit may remove older keys
  for that same skill; that keyed remove is allowed, and deleting the newer reply restores the older entry.
- The receipt's `replan.payload` is the replay authority: `{ key, board, practice }`. `result.board` records `{ id, seed,
  offset, groups }`; the full result carries `rounds`, `opening`, `order`, `quickStart`, `idle`, `hurts`, `refused` and `stop`.

## Decisions

- Undo works only before sending. Swiping a narrated reply keeps the same setup, seed and actions; Discard before sending
  changes the next seed. A message sent mid-fight carries every played exchange as settled fact and the open fight continues.
  While a board is open, the planner is never called.
- Skill flags are optional. Defaults are inferred from the skill's name and wording and are not migrated into old sheets;
  explicit flags are edited in the Skills view and stored on the editing reply. `target` allows one foe, `area` every foe in
  reach, and `defence` makes the skill eligible for the best automatic defence.
- A plain attack uses the best eligible weapon stat (STR, or AGI/DEX for a light or finesse weapon). Flee is one AGI contest
  against the strongest group and the whole exchange. Foes choose a standing member in stable order.
- The board stops only on won, lost or fled. A win pays fight XP through `boardWin`; open, lost and fled fights pay none.
  Practice still follows each carried skill use.
- The settled note lists every exchange, outcome and bar movement and is passed as one pinned `[Happened]` cue, so cue fitting
  never drops a result. The board adds no static prompt text.

## Test map

- `awards.test.js`: practice and one XP award through a two-reply fight, swipe, Re-read, rewind, regenerate and middle delete.
- `commit.test.js`: the staged preview equals the committed receipt and a duplicate claim is refused.
- `dice.test.js`: the same opening and choices give the same dice; Discard changes the seed.
- `engine.test.js`: staged exchanges are deterministic and reversible; flee uses the strongest foe and ends only on success.
- `feature.test.js`: with no board open the planner request and roll are byte-identical, and the board adds no static prompt.
- `flags.test.js`: wording defaults, explicit overrides and the skill's keyed identity.
- `flow.test.js`: send, swipe and continuation of an open fight without calling the planner.
- `overrides.test.js`: skill editor writes, a later edit survives an earlier delete, and the older edit returns after the newer delete.
- `plan.test.js`: action shape, member coverage, target and area checks, resources and automatic defence.
- `replay.test.js`: open and won fights through swipe, Re-read, reload, rewind, regenerate and middle delete.
- `rules.test.js`: weapon stat and automatic defence choice.
- `view.test.js`: controls, keyboard, target lines, one roll, Undo, Discard, end cards and phone CSS.
- `tests/v2/qa/state-fuzz.test.js` and `delete-fuzz.test.js` carry board fights through replay and deletes;
  `tests/v2/prompt.test.js` covers one merged `[Happened]` block.

## Where to look when …

- **A swipe changes the fight:** check `priorBoard`, `rpgFightLast`, then `reconcileBoard` in `session.js`.
- **The same exchange rolls differently:** check `fightSeed`, the session `offset` and `exchangeSeed` in `dice.js`.
- **A middle delete skips the fight:** check `commit.js` `boardGuard` and the receipt's `replan.payload`.
- **The planner runs during a fight:** check the feature gate and session lookup in `precall.beforeGenerate`.
- **A fight pays XP twice or not at all:** check `fight.js` and `boardWin` in `awards.js`.
- **A skill is missing or cannot target:** check `flags.js`, `plan.js` and `view-data.js`.
- **The phone layout or a tap is wrong:** check `board.css` and `view.js`; the 600 px layout and safe-area inset are intentional.
- **A skill flag returns after a delete:** check the keyed prune in `overrides.js`, then the scratch declaration and replay in `DATA_MODULES.md`.
