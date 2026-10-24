# Story Suite v2: a reviewer's map

For whoever reviews v2 before beta (MODULES §F74). It says what v2 is, where to start reading, which parts
carry the most risk and why, and what is already known to be open. It does not repeat the contract: that is
[SPEC.md](SPEC.md), with the binding decisions in [MODULES.md §F](MODULES.md#f-decisions-from-the-first-reports-coordinator)
(they override older text in SPEC.md where they differ). Progress is in [STATUS.md](STATUS.md).

## What v2 is

Four SillyTavern extensions on their `v2` branches: **Story Block** (the host; this repository), **RPG
Battle**, **Story Director** and **NPC State Delta**. v1 kept the game state in blocks the model wrote and
the extensions repaired; v2 turns that around:

* **Code keeps the state, the model narrates.** The state is one JSON document (`{ v: 2, meta, domains }`),
  one domain per owner (`scene`, `inventory` here; `party`, `combat`, `director`… in the modules).
* **State lives in replies.** Each assistant reply (a *carrier*) holds the ops it caused in
  `message.extra.storySuite`, with a full checkpoint every so often. The state at any reply is a replay:
  checkpoint, then ops. Swiping or deleting a reply takes its changes back; a branch keeps its own.
* **Every change is a command** with a receipt (`sdk.command('item.use', …)`): a click, a captured change
  line or the host itself. Handlers are synchronous, write drafts of their own domains only, and get their
  randomness from the receipt's seed; the host diffs drafts into ops, validates, and appends.
* **The model writes one block**, `<Changes>`, at the end of a reply: one proposal per line
  (`+ item Rope | qty: 1`). Capture hands each line to the module owning its kind, which runs it as a
  `story` command and may refuse it. The block is then hidden in an HTML comment in the reply.
* **The prompt** has a byte-identical static part (the change-line grammar and each module's static text,
  for the provider's prompt cache) and a tail at depth 0 (`[Happened]` receipts and each module's view).
* **Screens are data** (templates or layouts, scoped CSS, query bindings), rendered by the host into tabs,
  cards under replies, a status strip, a full-screen game view and dialogs. Packs and cards may restyle them.
* **Packs** are JSON data (items, creatures, shops, quests, events, races, map, calendar, screens, themes),
  installed from a file or a card's lorebook. Nothing in a pack runs as code.

Player's view: [GUIDE.md](GUIDE.md). Release notes: [RELEASES.md](RELEASES.md).

## Where to start reading

In this order; each file opens with a comment that says what it does and why.

1. [SPEC.md](SPEC.md) §0–§6 (principles, state, commands, a turn, the prompt, modules) and MODULES.md §F.
2. `src/v2/runtime.js`: how the parts are wired, once, for SillyTavern (`index.js`) and for the testkit.
3. `src/v2/persist.js` and `src/v2/store.js`: carriers, checkpoints, replay, the head cache, saving.
4. `src/v2/ops.js`, `src/v2/check.js`, `src/v2/rng.js`, `src/v2/commands.js`: drafts to ops, validation,
   claims, receipts, preview/commit.
5. `src/v2/capture.js`, `src/v2/turn.js`: the `<Changes>` grammar, and the turn (interceptor, prompt events,
   `MESSAGE_RECEIVED` capture, swipes, deletes, chat changes).
6. `src/v2/prompt.js`: prompt assembly and the tail budget.
7. `src/v2/registry.js`, `src/v2/sdk.js`: what a module may register and the public sdk.
8. `src/v2/domains/`: the core domains, as the example of a module.
9. `src/v2/packs/` (validation and `safety.js`), `src/v2/view/` (screens registry, template renderer and
   sanitiser, CSS scoper, mounts, widgets), `src/v2/ui-host.js` (the page furniture).

Tests: `npm test` (Node's runner, no network, no browser). `testkit/` is a fake SillyTavern with the real
runtime (`createHost()`); `tests/v2/qa/` holds the QA suites (state fuzzing, ownership, security of packs,
templates, layouts, mounts and widgets, prompt layout). A `test.todo` there is a found problem, named after
what should happen.

## The riskiest parts

### 1. Store replay (`store.js`, `persist.js`)

Everything rests on "the state at reply N is the replay of what is stored up to N". Look at:

* **Swipes.** SillyTavern copies `extra` into a new swipe; a record carries `sid` + `swipe` so a copied
  record is ignored there (`readRecord`). Check swipe back and forth, swipe of the greeting, and swipe
  deletion.
* **Checkpoints** (every 20 carriers or 32 KB of ops today; PERFORMANCE.md proposes 100 / 128 KB). Replay
  must give the same state wherever the checkpoints fall (`state-fuzz.test.js` checks replay equals
  rebuild).
* **Deleting a reply in the middle.** Ops recorded after it may no longer apply; the store skips what fails
  and reports it. The open problems below are here.
* **The head cache** is checked against the chat on each read; a stale cache would show a wrong state
  without an error.
* **Saving** (§3.3): one save per burst, flushed before a generation; what happens when a save fails.

### 2. The command bus (`commands.js`, `ops.js`, `registry.js`)

* **Ownership.** `ctx.draft(domain)` only for the module's own domains (`NOT_OWNER`); `ctx.call` runs another
  module's command in the same transaction, and any failure rejects all of it (nothing saved).
* **Diff to ops** must be minimal, deterministic and complete (arrays replaced whole, no `move`/`copy`).
* **Claims** (`meta.claims`) make a reward pay once per line of history; a delete or swipe that takes the
  claim back must allow it again, and nothing else may.
* **Preview/commit**: a preview goes `STALE` when the head moved; commit must keep exactly the previewed
  result (the roll shown is the roll kept).
* **Internal commands** (`capture.*`, `module.init.*`, `events.fire`) must not be callable as a UI command
  from a screen button: see the open issues.

### 3. Capture (`capture.js`, `turn.js`, each module's `capture.apply`)

* The grammar is forgiving on purpose (dashes, labels, markdown, "none"); check that it never reads
  a line into the wrong kind or the wrong name.
* Lines of one reply run in order on the state the previous line left; a refused line is a problem
  entry, never an exception that loses the rest.
* Only the head carrier is captured, and only for its own generation (`session` in `turn.js`): quiet and
  impersonate generations, a continue, a swipe, a stopped generation and a reply edited later each have
  their own path. Re-read (replacing a reply's `story` receipts with a fresh capture) is the edit path.
* Hiding the block rewrites `mes` and the shown swipe; Re-read and the extractor read it back.

### 4. Templates, packs and their security (`view/template/`, `view/css.js`, `packs/safety.js`, `packs/validate.js`)

Packs and cards are untrusted. The defences are layered: pack validation at install (plain JSON only, no
unsafe keys, tags, attributes or URLs, size and depth limits), DOMPurify plus Story Block's own allow-list
at render, scoped and filtered CSS, ids and form names prefixed per screen, reserved SillyTavern classes and
control names refused, values bound through text only, URLs checked again after binding. See
[TEMPLATES.md §3](TEMPLATES.md#3-what-a-template-may-contain) and [PACKS.md](PACKS.md#safety-rules). Worth a
fresh pair of eyes: CSS that can load or exfiltrate (`url()`, `image-set()`, `@font-face`, custom properties
carrying URLs), SVG (`use`, `href`, paint servers), and whatever a screen button can make happen
(`data-command` runs a command through the public sdk with cause `ui`).

### 5. Prompt assembly (`prompt.js`, `turn.js` interceptor)

* The static part must be byte-identical for every reply of a chat (no names, counts, times or dice), or
  the provider's prompt cache is lost: `tests/v2/qa/prompt.test.js` and the live check (85% shared prefix).
* The tail's order and budget: optional lines drop first; untold receipts are told once, and a swipe of the
  reply that told them tells them again (that swipe's `narrated` starts empty).
* Presets without a Main Prompt drop `IN_PROMPT` text: the static part is then put back at the start of the
  tail, for the story's own prompt only.
* `{{user}}`/`{{char}}` substitution and v1 keys cleared on load.

## Known open issues

From [RELEASES.md](RELEASES.md) (2.0.0-alpha.1) and the QA todos:

* Deleting a reply in the middle of a chat can, in rare cases, let a one-time bonus be paid twice; a UI
  command committed onto a head carrier whose older ops no longer apply can be lost on rebuild
  (`tests/v2/qa/state-directed.test.js` todos).
* A save that fails before a reply should not drop that reply's capture (same file).
* Internal commands can be triggered from a pack's screen buttons (`capture.*`, `module.init.*`,
  `events.fire` from a UI cause; `tests/v2/qa/ownership.test.js` todos); pack/template hardening has
  landed (#71), the command-side fixes are in progress. Only install packs you trust until then.
* `checkOps` should refuse a value holding an own `__proto__` key; a change-line label named
  `constructor` should keep its value (ownership todos).
* Some fight edge cases can leave a fight unable to finish (companion at max level, someone leaving
  mid-fight); a draught drunk in a fight stays sellable until the fight ends (RPG Battle).
* Checks still wait for a Roll; the same-reply dice (like v1's, MODULES §F80) come next.
* Chat files are about 30% larger than v1's until storage tuning lands ([PERFORMANCE.md](PERFORMANCE.md)).
* Re-read has no runtime entry point yet (`sdk.reread(index)` is planned); the reply notes offer the button
  only when the runtime has it.
* "1 crowns"-style plurals; the Party screen's stat steppers don't share one budget; NPC State Delta logs a
  harmless 404 on new chats and keeps its floating button while hosted; first fights aren't balanced yet.
