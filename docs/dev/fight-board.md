# Fight board

The fight board lets the reader choose each exchange in a Lean RPG fight. The Feature
`story-block.fight-board` is on by default when the RPG is on. The board is offered only under Standard
rules; Classic uses the existing planner. A staged fight must be restored to Standard or discarded before
using Classic. When the board is off and no fight is staged, the ordinary planner path is unchanged.

## Files

- `src/v2/lean-rpg/board/session.js`: opens, stages, discards and reconciles the metadata session, saves the last payload, keeps the Send copy (`markSend`, `readSend`, `clearSend`) and the `rpgFightLinks` message links.
- `src/v2/lean-rpg/board/members.js`: splits a foe slot of 2–5 into numbered members and 6+ into even packs of at most 12 (bar, attacks, "about N left", area blocks), and collapses their final bars to ordinary count/hurt moves. A count of 1 is never split.
- `src/v2/lean-rpg/standard-foes.js`: prepares Standard foe attacks and optional alternate member-fight defenders.
- `src/v2/lean-rpg/standard/roster.js`: reads a Standard sheet into bars for characters, foe groups and skill resources.
- `src/v2/lean-rpg/standard/prepare.js`: `prepareStandard` and its helpers (acts, foe sides, checks, refusals and the witness).
- `src/v2/lean-rpg/standard/roll.js`: `rollStandard` (turn order, rounds, acts, area and outcomes) and its outcome helpers; `standard.js` re-exports them.
- `src/v2/lean-rpg/board/member-rolls.js`: supplies new-board hooks for pack attacks and area damage, rotation among standing targets and defence paid once per exchange.
- `src/v2/lean-rpg/board/engine.js`: plays the setup and exchanges on a private state copy and checks their input witness; in a new fight (`setup.members: 1`) it runs split groups as virtual foes and collapses them only when the fight ends.
- `src/v2/lean-rpg/board/plan.js`: validates member actions and makes a Standard plan with foe actions and automatic defence (a new fight: one attack per member, pack attacks, an area scoped to one group, defence paid once per exchange).
- `src/v2/lean-rpg/board/rules.js`: picks the attack stat and the best usable defence skill.
- `src/v2/lean-rpg/board/flee.js`: rolls the AGI contest against the strongest standing foe group.
- `src/v2/lean-rpg/board/dice.js`: derives the fight seed and each exchange's independent dice stream.
- `src/v2/lean-rpg/board/flags.js`: infers skill flags from wording and keys explicit choices.
- `src/v2/lean-rpg/board/overrides.js`: declares `rpg.boardSkill` and keeps reply-owned explicit flags.
- `src/v2/lean-rpg/board/commit.js`: replays and guards the board prelude, claims once and writes member results, hurts and wear.
- `src/v2/lean-rpg/board/note.js`: builds the settled account and word-based bar movements.
- `src/v2/lean-rpg/board/awards.js`: selects the opening foe groups for one win award.
- `src/v2/lean-rpg/board/view-data.js`: builds choices, member groups and target labels, and pending awards.
- `src/v2/lean-rpg/board/view.js`: renders the board, member and pack cards, keyboard handling and in-page discard confirmation.
- `src/v2/lean-rpg/board/skill-editor.js`: draws the three checkboxes in the skill editor.
- `src/v2/lean-rpg/board/board.css`: provides the touch layout and sizing.
- `src/v2/lean-rpg/board/offers.js`, `offer-line.js`, `start-view-data.js`: find the opening reply and draw its offer line (the Fight tab alert is the `badge` in `view/fight.js`).
- `src/v2/lean-rpg/board/start-controller.js`, `pause.js`, `fight-start.css`: draw the waiting choice and resume the reply.
- `src/v2/turn/fight-start.js`: binds a pending send to its anchor sid and message and detects possible new fights while planning.
- `src/v2/lean-rpg/board/prompt.js`: keeps fixed grammar quiet-sized and supplies fight flavour and manual grammar in the reply tail.
- `src/v2/data-modules/board-static.js`: the board's fixed grammar and XP-guide text, shared by `board/prompt.js` and `data-modules/part.js` (outside lean-rpg/ so the page-start closure stays lean).
- `src/v2/lean-rpg/board/action-gate.js`: holds only explicit attacks on a standing known foe.
- `src/v2/lean-rpg/board/settings.js`: draws the shared switch inside the Rolls card.
- `src/v2/lean-rpg/board/narrated-grammar.js`: supplies manual foe changes to the reply grammar.
- `src/v2/lean-rpg/precall.js`: selects a board segment or the planner and checks whether generation may proceed.
- `src/v2/turn/prompt-build.js`, `capture-flow.js`, `events.js`, `held-board.js` and `src/v2/commands.js`: preview, protect, capture and recover the prelude.
- `src/v2/lean-rpg/practice.js` and `fight.js`: award practice and win XP from recorded results.

## Data flow

Before step 1, an explicit attack against a known standing foe holds the send without a planner call; ambiguous actions continue normally. With no foes, a planner opening is previewed with a
saved seed; its foes and checks are shown on the pause. **Narrate it instead** reuses that plan and seed. **Fight it on the board**
opens on the private post-approach sheet. Narration remains selectable while the planner is working, without starting another call. The saved opening prelude runs before the board prelude on the single narrated reply;
the approach checks earn practice and a successful ambush applies to the first exchange. Both previews and capture verify the inputs.

1. `openBoard` uses the opening carrier's `sid`, discard count, current Standard rules, gear and weapons. The
   seed is `fightSeed(sid, attempt)`, fixed before a reply exists.
2. `stageExchange` adds actions and a sheet/gear witness to the metadata session. `playBoard` previews on a
   private copy without changing the game state. The engine applies gear annotations and condition events in
   exchange order, and the commit records the same wear events.
3. `precall.beforeGenerate` chooses a staged segment, a swipe's receipt or a regenerate's cached payload and
   requests an `rpg.resolve` prelude. An existing receipt keeps its recorded rules. The host previews the
   prelude after other cues; a failed board preview stops the send. While the reply is in flight, reader
   edits that would change its witnessed sheet or gear are refused. Capture checks the witness before it
   commits the fight; the fight and the reply's own story lines then apply in order. If an input changed,
   the reply stays uncaptured. A saved marker restores the hold after reload: restore the inputs to finish
   capture, or discard the fight and regenerate the reply. Re-read cannot bypass a held fight.
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
  A new fight's first segment also holds `opening` (payload and seed), its `approach` checks and any ambush `drop`.
- `chatMetadata.rpgFightAttempts`: `{ [originSid]: discardCount }`, used to give the next opening a new seed.
- `chatMetadata.rpgFightLast`: the last `{ key, board, practice }`, used for regenerate.
- `chatMetadata.rpgFightSend`: the copy of the staged session made when "Send with this fight" is pressed; it releases the held reply.
- `chatMetadata.rpgFightStart`: the anchor sid, user-message hash, choice and, for a new fight, the original plan,
  seeded opening and result. It is cleared after the reply and ignored when its anchor or message is absent.
- `chatMetadata.rpgFightOffers`: hidden offer choices keyed by the reply that started each fight.
- Reader message `extra.rpgFightLinks`: add-only board-key links to the cached segment for regenerate.
- `chatMetadata.rpgFightHeld`: add-only `{ [replySid]: { current, staged } }`; `current` holds the
  prechecks, generation type, base text and receipt IDs needed to finish the reply. An empty reply gets a
  record with that sid before the marker is saved. The matching board receipt resolves the marker.
- `chatMetadata.rpgFightHeldDiscarded`: add-only `{ [replySid]: true }` when a held fight is discarded;
  the old reply remains held until regenerated or removed.
- `state.domains.dataModules.boardFlags`: scratch map `{ [sid]: { [entryId]: { id, key, flags, rev } } }`.
  A skill key includes its block, slot and folded name; the latest revision wins.
- Board receipts keep each segment's seed, actions, opening reply identity and input witness; each new-style
  claim is keyed by the carrier reply `sid`. The receipt's `replan.payload` keeps `{ key, board, practice }`;
  `result.board` keeps `{ id, seed, offset, groups }`, alongside rounds, order, hurts, wear and stop. The opening
  prelude has a separate claim keyed by its starting anchor and the narrated reply's sid.

## Decisions

- Foe members (owner 6 Nov, mockup 29BShyZ8z7niWqttc3kcCH): a new fight (`setup.members: 1`) gives 2–5 foes their own bars and attacks and fights 6+ as packs of at most 12 (bar = one foe's bar + count ÷ 3, at most 12; attacks = 1 + count ÷ 6, at most 3, thinning with the bar and capped at its turn; an area hit takes a third of a pack's bar). Each real slot keeps one initiative die. The automatic defence is paid once per exchange and covers every attack. An area skill hits one picked group. XP is unchanged and paid from the original counts on a win. Within one fight the exact bars carry across replies (`setup.carriedMembers`, restored on rewind); split groups are written to the Foes block only when the fight ends (count = foes standing, health = the healthiest). A later, separate fight rebuilds from the block. Setups without `members` and the planner path are unchanged (`standard/roll.js` hooks are no-ops for them).
- Exchanges are final once rolled; Discard fight confirms before clearing the unsent fight and changes its
  next seed. A message sent mid-fight carries the exchanges already played and the fight stays open.
- A changed sheet or gear holds a staged fight until restored or discarded. The board is offered only under
  Standard rules; a recorded board receipt still replays with its saved rules.
- Flags default from skill wording; explicit flags live on the editing reply. While the board is on, a rename
  carries explicit flags to the new name. With the board off, this is a known limit.
- A plain attack uses the best eligible weapon stat. Flee uses AGI against the strongest standing group.
  Foes choose a standing member in stable order; defence is automatic.
- The end card shows XP for the original foe groups on a win and practice for the unsent segment; the folded
  narrator note includes defence outcomes, recorded gear wear and the battle marker; the aftermath follows the real outcome. A waiting reply gets a send button.
- The Feature keeps the static prompt at or below the quiet board-off size: it retains the opening foe line and trimmed XP guide.
  Combat flavour, the foe description and manual foe grammar go into the tail when a fight is relevant; Rolls off gets manual practice there.
  The fixed text does not follow fight state or Rolls. With the board off, the existing prompt is unchanged.

## Test map

- `members.test.js`, `members-fight.test.js`, and the member cases in `engine`, `plan`, `session`, `awards`, `view`, `view-data`, `standard`, `state-fuzz` and `delete-fuzz` tests: splitting, packs, carry and rewind, collapse, XP, pay-once defence, group area, pack attack cap, opening order and byte-identical old fights.
- `awards.test.js` covers batched practice, the per-skill cap, swipe and Re-read, and XP across a split fight.
- `commit.test.js` covers staged versus committed results, claims, gear wear, story lines during capture,
  reader edits in flight, and held-reply restore/discard after reload. `view.test.js` covers the hold notice.
- `dice.test.js`, `engine.test.js`, `plan.test.js` and `rules.test.js` cover seeds, final exchanges, flee,
  action validation, resources, weapon stats and automatic defence.
- `feature.test.js` covers planner and prompt identity, rules switches and receipt replay under Classic.
- `flags.test.js` covers wording defaults and keyed identity. `overrides.test.js` covers explicit and inferred
  flags on rename, replay, and deletion of either edit.
- `flow.test.js` and `replay.test.js` cover continuation, swipe, regenerate, reload, rewind and middle deletion.
- `action-gate.test.js`, `start-flow.test.js`, `start-ui.test.js` and `trim.test.js` cover the waiting choice, approach, branch, offer, settings and prompt.
- `note.test.js` and `view.test.js` cover defence, bar words, wear, controls, pending awards and discard.
- `touch.test.js` renders the board at 390×844 and 360×740 in the game view and the Story panel when
  the optional browser is available; choices and end-card controls must clear each bottom bar.
- `tests/v2/qa/state-fuzz.test.js` includes board fights; `delete-fuzz.test.js` creates winning board segments
  among deletable replies and checks deleted and replayed rounds, practice and XP.

## Where to look when …

- A swipe changes the fight: `priorBoard`, `rpgFightLast` and `reconcileBoard` in `session.js`.
- An exchange changes: `fightSeed`, the session offset, `boardWitness` and `equipmentForBoard`.
- A middle delete skips the fight: `boardGuard` and the receipt's `replan.payload`.
- A send is held or a planner runs: `canGenerate` and `beforeGenerate` in `precall.js`, then `prompt-build.js`.
- XP or practice is wrong: `fight.js`, `boardWin` and `practice.js`.
- A choice or flag is wrong: `flags.js`, `plan.js`, `overrides.js` and `view-data.js`.
- A phone tap or layout is wrong: `board.css`, `view.js` and `touch.test.js`; `host.css` and
  `mounts.css` expose the bar height, offset and safe-area clearance to the board.

### End card (6 Nov fixes)
- `board/view.js` `pressButton`: "Send with this fight" acts on the press itself (pointerdown, primary button or touch; a click
  still works for keyboards) and fires once, so a redraw between press and release cannot eat it. While the controller is
  sending (`start-controller.js` `sending()`), the card shows "Sending… the narrator is writing the reply." and the panel
  closes (`close` → `closeView`); if the reply does not start, the button comes back.
- End-card buttons are full width and stacked with an 8 px gap (`board.css`, `.rpg-board-ended`).
- `board/note.js` `barMovement`: a bar that moved within one word ("Tired → Tired") is left out of the note and the log.
- Tests: `tests/v2/lean-rpg/board/end-card.test.js`.
- Where to look when "Send needs two presses" again: anything that redraws the Fight widget on a head/save event
  (`view/index.js` `fightStart.changed()`), and `pressButton`.

### Fight start fixes (round 15, 6 Nov)
- The Fight screen opens at 'fight-start' only while a pause is really waiting for this message (`view/index.js`, `fightStart.current()`).
  The planner wait opens it (the working pause); when the planner finds no fight the screen that wait opened is closed again.
  Where to look when "the Fight page opens on an old fight": the `events.on('head')` block in `view/index.js`, `onPlanning` in `runtime.js`.
- Engage words: `fight-start.js` `ACTION` (starts the planner wait) and `ENGAGE`/`engagesFight` (a planner answer with new foes and approach
  checks but no act still opens the pause, `precall.js` beforeGenerate); `board/action-gate.js` `ATTACK` for known foes.
  Where to look when "engage/pounce/… did not start the fight".
- The pause edge (`board/start-view-data.js` `edgeText`) claims an ambush only when an ambush check succeeded and says "acts first (initiative)"
  for a turn-order lead; every approach check is listed with its real result. The Fight log's lead line (`strings.js` `quickStartLine`) says
  the same and is left out when the ambush worked (`view/battle-log.js`).
- A board exchange records the quick-start lead but rolls no opening action (`standard/roll.js` opening loop, `board` option); the reader's own
  action is the first roll. "Narrate it instead" keeps the planner's plan and its opening action.
- Tests: `tests/v2/lean-rpg/board/start-fixes.test.js`.

### Send carries the staged fight (round 16, 6 Nov)
- "Send with this fight" (`board/start-controller.js` `send`) copies the staged session beside the waiting message (`board/session.js` `markSend`, metadata key `rpgFightSend`: anchor reply, message hash, board payload) and
  refuses the send with a reason when it cannot (anchor or exchanges missing). `precall.js` `canGenerate`/`beforeGenerate` take the board from the live session, else from this copy (`readSend`), so the
  planner can never stand in for a staged fight; `afterReceive`, Narrate and Discard clear the copy.
  Where to look when "the reply shows one planner round instead of my exchanges": `readSend`, `markSend`, the board branch of `beforeGenerate`.
- The planner wait ("Working out the fight…") opens no screen; it shows on the Fight tab dot (`view/index.js` 'fight-start' handler opens only for a ready pause).
- Tests: `tests/v2/lean-rpg/board/send-board.test.js` (replaces the round-15 F1 close logic; its test and two start-ui tests were changed to the no-pop rule).

## Send carries every staged exchange (round 17)

- "Send with this fight" generates as a `regenerate`. `precall.js` `beforeGenerate` used to prefer the cached payload (`rpgFightLast`, same anchor) over the
  staged session, so a stale one-exchange payload from an earlier send replaced the reader's 2–4 exchanges (reply, prompt and battle log showed exchange 1 only).
  Now a staged session with exchanges on this anchor (else the Send copy, `rpgFightSend`) wins over the cache; its key and practice come from the staged
  fight, not the cache. Swipe still reads its own receipt; Regenerate/Re-read of a captured reply still use the cache. Tests: `send-board.test.js` (path c,
  stale cache ×2), `flow.test.js` (path b ×3).

## The waiting reply is held until Send (round 17b)

- `precall.js` `canGenerate` held the waiting reply only while the board had no exchange, so the first staged exchange released it: the narrator got "Exchange 1" only
  while the reader kept playing. Now, with the reader's choice 'board' on this anchor, every commit attempt (regenerate or normal) stays held unless `rpgFightSend`
  (written by "Send with this fight", `markSend`) holds a copy with as many exchanges as the board now has. Narrate / Discard follow the normal rules.
- Where to look when "the reply went out after the first exchange": `canGenerate` (hold) in `precall.js`, `send()` in `board/start-controller.js`, `markSend` in `board/session.js`.
- Test: `send-board.test.js` "one exchange on the board does not release the waiting reply".
