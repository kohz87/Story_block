# Prompt and context

What the model is told each reply, and the budget it fits in. Detail: SPEC §0.4–0.5, §4.1 (before the
reply), §4.3 (what the model is told), §5 (the prompt, context share, `ownPrompt`), §6 (Features and the
static part); REVIEW.md risky part §5.

## Rules

- Story Block is the only v2 code that calls `setExtensionPrompt` for the host and its modules. Two keys:
  `story_suite_static` (`STATIC_KEY`, IN_PROMPT system) and `story_suite_tail_1` (`TAIL_KEY`, IN_CHAT depth 0).
- **Static part byte-identical every reply of a chat:** the change-line header, each module's kind grammar
  (module-id order) and each module's `context.static()`. No names, counts, times or dice. It changes only
  with code, settings, packs or Features, and then once (one reply without the provider cache).
  New static lines only through a Feature (F100) or a setting.
- **Tail:** `[Happened]` (`HAPPENED`) lines for the untold receipts (summaries written by code with code's
  numbers; the first `MIN_HAPPENED` (5) always kept, the rest share half the tail budget), then each module's
  `context.tail(view)` → `{ lines, optional }` in `TAIL_ORDER` (scene, inventory, party, combat, trade,
  director), then other modules by id. Optional lines drop first, then from the last module back.
- Budgets: tail `DEFAULT_TAIL_BUDGET` 1,500 tokens (chars/4, `estimateTokens`); static + tail held to
  `contextShare` (default 40 %, 10–90) of the interceptor's context size; the tail never below
  `MIN_TAIL_BUDGET` (200). The static part is never trimmed: too big → `CONTEXT_SMALL` once per chat.
- A module sending its own prompt keys (NSD: `story_suite_tail_4_npc_state_delta…`) reports them through
  `ownPrompt(view)`; Story Block counts them toward the share but never sends them.
- `{{user}}` / `{{char}}` filled in first (`substituteNames`, one line, `MAX_NAME` 80); macros in story
  text defused (`defuseMacros`). A preset without the Main Prompt drops IN_PROMPT: the static part is put
  back at the start of the tail (`restoreMissing`). v1 keys (`V1_KEYS`) are cleared on load.
- Quiet and impersonate generations get both slots emptied. A Continue or a dry run commits no cues.
- Untold receipts are told once; a swipe of the reply that told them tells them again (its `narrated` starts empty).
- The model never sees JSON: modules render compact text views.
- The `Wallet (before this reply):` tail line says it is the purse before this reply (`WALLET_NOTE`, `domains/inventory/prompt.js`, exported by inventory.js), so a
  payment is not read as already counted; the ask for a coin line is said once, in the coin kind's grammar line.
  The Carried line leaves out where a thing was found (`promptNote`, `domains/inventory/prompt.js`); the stored note keeps it. The look
  is asked for once per chat, on the reply to the reader's first message (`view.chat.readers`, scene.js `askLook`). A receipt with a text
  in `data.told` (`TOLD`, inventory.js: a saved character's starting purse and kit, the reader's own corrections of
  the purse and the bag) is told under `[Happened]` as `summary (told)`; the reader's card shows the summary alone.
  The coin kind's grammar line asks for a coin line whenever {{user}} is paid or pays (`CORE_KINDS.coin`).
- `turn.previewFit()` → `{ parts, fit, own }` feeds the settings' prompt size and **Show what's sent**; it only reads.

## Key files and functions

- `src/v2/prompt.js`: `assemble`, `staticParts`, `tailOrder`, `contextFit`, `contextNotice`, `estimateTokens`,
  `TAIL_ORDER`, `DEFAULT_TAIL_BUDGET`, `DEFAULT_CONTEXT_SHARE`, `MIN_TAIL_BUDGET`, `STATIC_MARKER`.
- `src/v2/turn.js`: wires the parts below and the rest of the turn; `previewFit`, `OWN_PROMPT_PARTS`, `OWN_PROMPT_CHARS`.
- `src/v2/turn/prompt-build.js`: `interceptor`, `build`, `runCues` (`createPromptBuild`); `src/v2/turn/prompt-hooks.js`: `onPromptReady`, `onTextPromptReady` (`createPromptHooks`); `src/v2/turn/events.js`: the SillyTavern event handlers and `install` / `uninstall` (`createEvents`).
- `src/v2/turn/text.js`: the turn's pure text helpers (turn.js re-exports the public ones): `restoreMissing`, `contextRoom`, `substituteNames`,
  `defuseMacros`, `flatName`, `stripBattleMarker`, `quietMark`, `mapContent`, `contentText`, `within`.
- `src/v2/features.js`: `affectsStatic`, `PROMPT_HINT` (a feature that changes the static part says so).
- `src/v2/extras.js`: `chatterTail` (the optional `chatterInPrompt` tail line).

## Tests that guard it

- `tests/v2/prompt.test.js`, `tests/v2/qa/prompt.test.js` (static part byte-identical across replies with
  different state, layout, shared prefix), `whats-sent.test.js`, `features.test.js`, `turn.test.js`.
- Break findings: `b5b-prompt-hygiene`, `b1-capture-happened-budget`, `c3-features-whole-context-static`,
  `final-context-size-ignored` (suite), `final-context-size-sb`.
- Modules test their own statics the same way (identical bytes for two replies with different state).

## When you change it

- Compare the static text of two consecutive replies with different state byte for byte in a test.
- Keep tail lines short; give new lines a place in `optional` unless the reply must tell them.

## Kept hook lines
A module's `beforeGenerate` may return a tail line as `{ text, keep: true }` (`turn/prompt-build.js`): it reaches `prompt.js` as a pinned cue and is never dropped by the module or host budget. A module keeps at most `KEPT_LINES_MAX` (4) lines and `KEPT_CHARS_MAX` (4,000) characters this way; any more are passed as ordinary lines. Strings work as before; the RPG's no-rolls line stays pinned.
