# Capture and Re-read

How a reply's `<Changes>` block becomes state, and how Re-read does it again. Detail: SPEC §4.2 (after the
reply), §4.4 (grammar, display kinds), §4.5 (free-text actions), §2.2 (spans, block-level replay); MODULES §F
(F40 Re-read, F115 display kinds); REVIEW.md "The riskiest parts" §3.

## Rules

- One hidden block at the end of the reply: `op kind Name[ — text][ | label: value]*`, one line each.
  `+` gained, `-` lost, `~` changed, `!` happened, `?` asks code to decide (check, roll).
- The kind picks the owner module (`capture.kinds` in its definition). Unknown kinds are a Problem, never guessed.
- Each line runs **as a command** with cause `story` (`ctx.carrier = { index, swipe, sid, key }`, `ctx.chat`),
  in reply order, on the state the previous line left. A refused line is a Problem entry, never a throw.
- Code sets every number: a capture clamps and claims once (it caps nothing per reply: the story decides what it pays) (`meta.claims`). Model text never
  mints value. Per-reply tallies are keyed by `ctx.carrier.sid` (SPEC §2.2 "Per-reply bookkeeping").
- **afterCapture** (SPEC §4.2 step 3, MODULES §F121): once a capture kept a story line, each module's
  `afterCapture(view, { index, type })` hook may ask for `system` steps, run right after the reply's last
  story line and stored on it (receipt `afterCapture: true`). A Continue runs it again; a Re-read asks the
  hook again after the new lines (`stepSeeds` reuses the old steps' seeds; `store.replaceStory`'s `settled`).
- **Guarded blocks in a Re-read** (docs/v2/REPLAY.md): a story line or step that called `ctx.replayGuard` hands the
  store a `block`; `replaceStory`'s `blocks` keeps each as a block of its own, kept guarded blocks are asked
  again on the new story (inactive, not refused, when their guard fails), and guarded system steps with a
  `replan` on this and later replies are planned again (`rerun(state, receipt, { index, span })`).
- **Assist safety net** (MODULES §F123): after a reply, the extractor's lines run as story lines after the
  reply's own (`captureAssist`, receipt `assist: 'now'`), stored as `<Changes-assist>` in the hidden comment;
  a send waits ≤ `ASSIST_WAIT_MS`, a later answer is stored as `<Changes-assist-next>` and the next reply
  applies it after its own lines (`lateLines`, `assist: 'late'`). Re-read runs the stored lines, never the model.
- Only the head carrier is captured, for its own generation. Quiet and impersonate generations capture nothing.
  A Continue captures only its own new text (`continuation()`); a stopped reply drops an unfinished last line.
- **Stray lines:** change lines written in the story itself (outside the block) are taken from up to
  `STRAY_PARAGRAPHS` (3) paragraphs before the block, only when the paragraph holds nothing but change lines;
  a near miss is a Problem, never dropped quietly. `hideBlock` keeps taken lines in the hidden comment so
  the live capture and every Re-read read them in the same order.
- **Display kinds** (`? choice`, `~ chatter`): no command, no op, no receipt; shown from the hidden comment
  each time (`extras.js displayLines`), capped per reply (`LIMITED`), quiet `FEATURE_OFF` when off.
- **Re-read** (`sdk.reread(index)` → `turn.reread`): reads the reply's block again as its shown swipe has it
  now and swaps the carrier's `story` receipts (`store.replaceStory`). The reader's `ui` receipts and `system`
  steps stay after them (a step marked `replan` runs again). Seeds of matching lines are reused
  (`storySeeds`), so a roll does not change. Later replies are re-checked on top; if one no longer fits,
  nothing changes. `ctx.standing` is the reply's state before the Re-read.
- Editing a reply's text never re-captures by itself; Re-read is the edit path.
- Markup never comes from text: names flattened (`flatName`), lines cut by code points (`cutLine`,
  `MAX_LINE` 2000), the hidden marker defanged in story text (`defangMarker`).

## Key files and functions

- `src/v2/capture.js`: `parseChanges`, `lineBody`, `extractBlock`, `stripBlock`, `hideBlock`, `hasHidden`,
  `markOff`, `continuation`, `withoutReasoning`, `cutLine`, `grammarHeads`, `strayLines`, `STRAY_PARAGRAPHS`.
- `src/v2/turn.js`: `onMessageReceived`, `captureLines`, `captureEach`, `afterCapture`, `captureLate`, `readBlock`,
  `strayProblems`, `capped`, `storySeeds`, `stepSeeds`, `reread`.
- `src/v2/store.js`: `replaceStory(index, { ops, receipts })`, `append`, `setNarrated`.
- `src/v2/extras.js`: `readDisplayLine`, `displayLines`, `readChoice`, `readChatter`.
- `src/v2/domains/inventory.js`, `domains/money.js`, `domains/names.js`: the core kinds (`item`, coin forms) and name matching.

## Tests that guard it

- `tests/v2/capture.test.js`, `story-change-lines.test.js`, `continue-capture.test.js`, `after-capture.test.js`, `stray-reread.test.js`
  (random replies, stops and Continues: Re-read reads what the live capture read), `story-limits.test.js`,
  `story-budget.test.js`, `old-cap-chats.test.js`, `extras.test.js`, `tests/v2/domains/capture.test.js`.
- Break findings: `tests/v2/break/a1-stray-*`, `a1-reread-double-dash`, `a2-reread-after-vouched-click`,
  `b1-capture-*`, `b1r2-capture*`, `c2-continue-split-block`, `c2-cut-mid-reasoning`, `c2-spoof-marker-reread`,
  `c4-slow-reread`, `confirm-stray-echo-twice`, `confirm-close-tag-in-line-leaks`, `fix-reread-vouched`.
- Fuzz: `tests/v2/qa/state-fuzz.test.js`, `qa/delete-fuzz.test.js` (add a new kind to the generator).

## When you change it

- A new kind: grammar line (goes into the static part, so it must not vary), `apply` as a command, Feature tag
  if optional, tests for success, every refusal, swipe/delete rollback, Re-read parity, claims.
- Run `node --test --test-reporter=dot tests/v2/capture.test.js tests/v2/stray-reread.test.js` while working,
  then the full `npm run test:dot` once.
