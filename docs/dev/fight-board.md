# Fight board

The fight board lets the reader choose each exchange in a Lean RPG fight. The Feature
`story-block.fight-board` is on by default when the RPG is on. The board is offered only under Standard
rules; Classic uses the existing planner. A staged fight must be restored to Standard or discarded before
using Classic. When the board is off and no fight is staged, the ordinary planner path is unchanged.

## Files

- `src/v2/lean-rpg/board/session.js`: opens, stages, discards and reconciles the metadata session and saves the last payload.
- `src/v2/lean-rpg/board/engine.js`: plays the setup and exchanges on a private state copy and checks their input witness.
- `src/v2/lean-rpg/board/plan.js`: validates member actions and makes a Standard plan with foe actions and automatic defence.
- `src/v2/lean-rpg/board/rules.js`: picks the attack stat and the best usable defence skill.
- `src/v2/lean-rpg/board/flee.js`: rolls the AGI contest against the strongest standing foe group.
- `src/v2/lean-rpg/board/dice.js`: derives the fight seed and each exchange's independent dice stream.
- `src/v2/lean-rpg/board/flags.js`: infers skill flags from wording and keys explicit choices.
- `src/v2/lean-rpg/board/overrides.js`: declares `rpg.boardSkill` and keeps reply-owned explicit flags.
- `src/v2/lean-rpg/board/commit.js`: replays and guards the board prelude, claims once and writes hurts and wear.
- `src/v2/lean-rpg/board/note.js`: builds the settled account and word-based bar movements.
- `src/v2/lean-rpg/board/awards.js`: selects the opening foe groups for one win award.
- `src/v2/lean-rpg/board/view-data.js`: builds choices, target labels and pending awards.
- `src/v2/lean-rpg/board/view.js`: renders the board, keyboard handling and in-page discard confirmation.
- `src/v2/lean-rpg/board/skill-editor.js`: draws the three checkboxes in the skill editor.
- `src/v2/lean-rpg/board/board.css`: provides the touch layout and sizing.
- `src/v2/lean-rpg/precall.js`: selects a board segment or the planner and checks whether generation may proceed.
- `src/v2/turn/prompt-build.js`, `capture-flow.js`, `events.js` and `src/v2/commands.js`: preview, protect and capture the prelude.
- `src/v2/lean-rpg/practice.js` and `fight.js`: award practice and win XP from recorded results.

## Data flow

1. `openBoard` uses the opening carrier's `sid`, discard count, current Standard rules, gear and weapons. The
   seed is `fightSeed(sid, attempt)`, fixed before a reply exists.
2. `stageExchange` adds actions and a sheet/gear witness to the metadata session. `playBoard` previews on a
   private copy without changing the game state. The engine applies gear annotations and condition events in
   exchange order, and the commit records the same wear events.
3. `precall.beforeGenerate` chooses a staged segment, a swipe's receipt or a regenerate's cached payload and
   requests an `rpg.resolve` prelude. An existing receipt keeps its recorded rules. The host previews the
   prelude after other cues; a failed board preview stops the send. During the reply, commands that would
   change its witnessed sheet or gear are refused until capture finishes. If a changed input reaches capture,
   the reply is held until the input is restored; after Discard, regenerate that reply. This hold is in
   memory and does not survive reloading the page.
4. `resolveBoard` replays the setup and actions, checks the witness and claim, writes hurts and gear wear,
   and records the result on the reply. After capture, distinct rolled skills are sorted and split into
   guarded practice steps of at most 40 skills; each skill keeps its 20-point per-reply cap.
5. `afterReceive` saves the last payload. An open result starts the next segment at the next offset; won,
   lost and fled delete the open session. A narrated swipe retains a matching continuation, and a rewind
   restores saved initiative without rerolling a staged continuation.
6. A swipe reads its receipt's `replan.payload`; Re-read uses the stored prelude. A regenerate uses the last
   payload. An add-only link on the reader's message recovers its cached board segment for regeneration after
   an earlier deletion. `reconcileBoard` handles a missing carrying receipt.

## Stored data

- `chatMetadata.rpgFightBoard`: `{ id, origin, anchor, groups, setup, exchanges, carried?, carriedKey?, base? }`.
  Setup includes `seed`, `offset`, `rules`, `flags`, `weapons`, optional `gear`, `order`, `witness` and wear version.
- `chatMetadata.rpgFightAttempts`: `{ [originSid]: discardCount }`, used to give the next opening a new seed.
- `chatMetadata.rpgFightLast`: the last `{ key, board, practice }`, used for regenerate.
- Reader message `extra.rpgFightLinks`: add-only board-key links to the cached segment for regenerate.
- `state.domains.dataModules.boardFlags`: scratch map `{ [sid]: { [entryId]: { id, key, flags, rev } } }`.
  A skill key includes its block, slot and folded name; the latest revision wins.
- Board receipts keep each segment's seed, actions, opening reply identity and input witness; each new-style
  claim is keyed by the carrier reply `sid`. The receipt's `replan.payload` keeps `{ key, board, practice }`;
  `result.board` keeps `{ id, seed, offset, groups }`, alongside rounds, order, hurts, wear and stop.

## Decisions

- Exchanges are final once rolled; Discard fight confirms before clearing the unsent fight and changes its
  next seed. A message sent mid-fight carries the exchanges already played and the fight stays open.
- A changed sheet or gear holds a staged fight until restored or discarded. The board is offered only under
  Standard rules; a recorded board receipt still replays with its saved rules.
- Flags default from skill wording; explicit flags live on the editing reply. While the board is on, a rename
  carries explicit flags to the new name. With the board off, this is a known limit.
- A plain attack uses the best eligible weapon stat. Flee uses AGI against the strongest standing group.
  Foes choose a standing member in stable order; defence is automatic.
- The end card shows XP for the original foe groups on a win and practice for the unsent segment; the folded
  narrator note includes defence outcomes and recorded gear wear by exchange. The note is a pinned tail cue;
  the board adds no static prompt text.

## Test map

- `awards.test.js` covers batched practice, the per-skill cap, swipe and Re-read, and XP across a split fight.
- `commit.test.js` covers staged versus committed results, claims, gear wear, changed inputs and host preflight.
- `dice.test.js`, `engine.test.js`, `plan.test.js` and `rules.test.js` cover seeds, final exchanges, flee,
  action validation, resources, weapon stats and automatic defence.
- `feature.test.js` covers planner and prompt identity, rules switches and receipt replay under Classic.
- `flags.test.js` covers wording defaults and keyed identity. `overrides.test.js` covers explicit and inferred
  flags on rename, replay, and deletion of either edit.
- `flow.test.js` and `replay.test.js` cover continuation, swipe, regenerate, reload, rewind and middle deletion.
- `note.test.js` and `view.test.js` cover defence, bar words, wear, controls, pending awards and discard.
- `touch.test.js` renders the board at 390×844 and 360×740 when the optional browser is available.
- `tests/v2/qa/state-fuzz.test.js` includes board fights; `delete-fuzz.test.js` creates winning board segments
  among deletable replies and checks deleted and replayed rounds, practice and XP.

## Where to look when …

- A swipe changes the fight: `priorBoard`, `rpgFightLast` and `reconcileBoard` in `session.js`.
- An exchange changes: `fightSeed`, the session offset, `boardWitness` and `equipmentForBoard`.
- A middle delete skips the fight: `boardGuard` and the receipt's `replan.payload`.
- A send is held or a planner runs: `canGenerate` and `beforeGenerate` in `precall.js`, then `prompt-build.js`.
- XP or practice is wrong: `fight.js`, `boardWin` and `practice.js`.
- A choice or flag is wrong: `flags.js`, `plan.js`, `overrides.js` and `view-data.js`.
- A phone tap or layout is wrong: `board.css`, `view.js` and `touch.test.js`.
