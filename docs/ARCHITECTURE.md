# Story Block — architecture contract (v0.5)

Story Block is a SillyTavern extension. Every tracker the model maintains — Inventory,
Character Sheet, custom blocks, later World State, CYOA and Dice — is one **block
definition** handled by one engine. Built-ins are templates: ordinary definitions the
reader can edit, duplicate, disable, delete or reset.

The engine is a generalisation of Inventory Block (`kohz87/inventory-block`, GPL-3.0,
same author). Its code is the reference for every module below and may be ported
freely: `src/snapshot.js`, `src/prompt.js`, `src/tree.js`, `src/diff.js`, `src/ui.js`,
`src/megumin.js`, `index.js`, `style.css` and the tests under `tests/`. A checkout is at
`/home/user/inventory-block` (branch `main`).

Conventions: plain ES modules, no runtime or dev dependencies, 4-space indent, single
quotes, semicolons, Node 24 `node:test` + `node:assert/strict`. Comments explain *why*,
in the style of Inventory Block. `npm run check` syntax-checks `index.js` and `src/**`;
`npm test` runs `tests/*.test.js`. UI tests use a minimal fake DOM (see
`/home/user/inventory-block/tests/ui.test.js`); never add jsdom.

## 1. Block definition (`src/schema.js` — done)

```js
{
  id: 'inventory',          // stable unique id, [a-z0-9][a-z0-9_-]{0,47}
  name: 'Inventory',        // label in the card and the editor
  icon: '🎒',
  tag: 'Inventory',         // XML tag the model writes; unique (case-insensitive), not reserved
  enabled: true,            // off = not prompted, not parsed into the card, costs nothing
  visible: true,            // false = still prompted and stored, but no tab in the card
  kind: 'stateful' | 'turn' | 'lead',   // lead: this reply only, written before the story
  optional: false,          // written only when something calls for it; no warning when missing
  repeating: false,         // several tags in one reply read as one (latestBlockInText), folded on receive (mergeRepeats)
  rolls: { count: 0, sides: 20 },   // dice rolled before each reply into {{rolls}} (src/dice.js)
  format: 'rows' | 'fields' | 'text',
  display: 'plain' | 'tree' | 'fields' | 'scene' | 'choices' | 'dice' | 'chatter',
  prompt: '...',            // block instructions; placeholders {{user}} {{char}} (SillyTavern macros)
  when: { mode: 'always' | 'every' | 'keyword', every: 2, keywords: [], scanDepth: 2 },
  template: 'inventory' | null,   // built-in it came from, for "Reset to default"
  // text only
  layout: '',               // skeleton the model fills in ({{user}}/{{char}} substituted), e.g. World State
  // rows only
  columns: ['Item', 'Qty', 'Note'],   // exactly three column labels
  maxDepth: 3,                        // 1..5 levels of [A > B > C] category paths
  // fields only
  fields: [{ label: 'HP', type: 'meter' | 'number' | 'text' | 'list', max: 100, hint: '' }],
}
```

`normalizeBlock`, `normalizeBlocks`, `validateBlock`, `newBlockId`, `tagFromName` live in
`src/schema.js`. Templates and `defaultBlocks()` live in `src/templates.js`. Settings
store the ordered list as `extension_settings.storyBlock.blocks`; **array order is block
order** (prompt order and tab order).

Kinds:

- **stateful** — the newest valid copy in the chat is the current state. It is injected
  into every prompt and the model rewrites it in full each reply (omission means loss).
  Invalid or cut-off copies never replace the current state.
- **turn** — fresh each reply, never fed back to the model. The card shows the copy from
  the latest assistant reply only.

## 2. Formats (`src/formats/*.js`)

`src/formats/index.js` exports `FORMAT_MODULES` and `formatFor(def)`. Every format module
exports exactly:

```js
export const id;                        // 'rows' | 'fields' | 'text'
export function empty(def) -> state     // the state of a block nobody has written yet
export function isEmpty(state) -> boolean
export function parse(body, def) -> { ok: true, state } | { ok: false, error: string }
export function serialize(state, def) -> string
export function diff(previous, next, def) -> Change[]
export function rules(def) -> string    // format instructions for the model (plain text)
export function skeleton(def) -> string // example body for the prompt skeleton
```

- `body` passed to `parse` is the **raw stored text** between `<Tag>` and `</Tag>`, still
  escaped; `parse` unescapes. `serialize` returns escaped text that `parse` reads back to
  an equal state (round-trip). Both use the shared rules in `src/formats/escape.js`
  (`escapeBody(text, tag)` / `unescapeBody(text)`): `-->`, `<Tag`/`</Tag` and
  `<Blocks`/`</Blocks` never appear raw in a stored body. Rows keeps Inventory Block's
  own extra escapes (`\|`, `\]`, leading-backslash names) on top.
- `parse` never throws. Errors are short, human-readable, and shown in the card.
- `Change` = `{ type: 'added' | 'removed' | 'changed' | 'moved', label: string, from?: string, to?: string, path?: string }`
  where `label` is what changed (item name, field label), `from`/`to` are display
  strings, `path` the category path for rows. `diff` returns `[]` when nothing changed or
  when the format has nothing structured to compare (text).

State shapes:

- **text** — `{ text: string }` (done in `src/formats/text.js`).
- **rows** — Inventory Block's state, unchanged:
  `{ categories: [{ name: 'Wagon > Food', items: [{ name, quantity, remark }] }] }`.
  Column labels come from `def.columns` (shown in the UI and the prompt rules only; the
  three-column structure is fixed in v0.1). `def.maxDepth` limits category nesting.
  Duplicate item names within a category reject the body, as in Inventory Block.
- **fields** — `{ entries: [{ label, type, raw, value, max?, items?, unknown? }] }` in
  definition order, followed by labels the model wrote that the definition does not have
  (`type: 'text', unknown: true`). `raw` is the value text as written; `value` is a number
  for meter/number (null when unreadable), a string for text; `items` is a string[] for
  list; `max` for meter. A body is valid when at least one defined label is present.

## 3. Transport and extraction (`src/envelope.js`)

A reply's blocks travel at the end of the assistant message in one hidden envelope:

```
<!-- STORY_BLOCKS_V1
<Blocks>
<Inventory>
Coin Pouch | 1 | 85 Gold
</Inventory>
<Scene_Notes>
The guards are on alert.
</Scene_Notes>
</Blocks>
-->
```

The model is asked to write the envelope exactly like this, so nothing raw shows while
it streams. Also accepted, and normalized into the envelope on receive:

- a bare `<Blocks>…</Blocks>` (what Megumin Suite and many presets produce);
- bare known block tags outside any envelope (`<Inventory>…</Inventory>`).

Read-only compatibility (never rewritten): Inventory Block's
`<!-- INVENTORY_BLOCK_V05\n<Inventory>…</Inventory>\n-->` snapshots are read as the
block whose tag is `Inventory`; old Megumin `<Blocks>` in earlier messages are read by
tag like any other occurrence.

API:

```js
export const ENVELOPE_MARKER = 'STORY_BLOCKS_V1';
export const CUT_MARKER = 'STORY_BLOCKS_V1_CUT';

// Every occurrence of every def's tag in `text`, in text order:
// [{ def, body, start, end, truncated }]. `body` is raw (escaped) text, trimmed.
// A tag opened and never closed before the end of `text` gives one truncated entry.
// Matching is case-insensitive on the tag name; attributes on the open tag are ignored.
export function extractBlocks(text, defs) -> Entry[]

// The newest complete, valid occurrence of `def` in one message text:
// { state, body, start, end } or null. Validity = formatFor(def).parse(body, def).ok.
export function latestBlockInText(text, def) -> object | null

// Scan assistant messages (not is_user, not is_system) from newest to oldest, before
// `beforeIndex` when given: { state, body, messageIndex } for the newest valid copy, or null.
export function latestBlockState(chat, def, { beforeIndex = null } = {}) -> object | null

// Baseline for a generation (port of inventoryForGeneration): Regenerate/Swipe exclude the
// last message only when it is an assistant reply. Returns the state, or formatFor(def).empty(def).
export function stateForGeneration(chat, def, type = 'normal') -> state

// Hide model-written blocks: a bare <Blocks>…</Blocks> or bare known tags become one hidden
// envelope at the same place (bodies escaped for the comment). A <Blocks> or envelope cut off
// before its end is hidden to the end of the text under CUT_MARKER. Idempotent; legacy
// INVENTORY_BLOCK_V05 comments are left alone. Returns { text, changed }.
export function normalizeTransport(text, defs) -> { text, changed }

// Continue after a cut: when a CUT envelope is followed by more text, unwrap it and join the
// continuation so normalizeTransport can re-hide the completed whole (port of rejoinContinuedCuts).
export function rejoinContinuation(text) -> string

// Remove every envelope (complete or CUT), every legacy INVENTORY_BLOCK_V05 comment, every bare
// <Blocks>…</Blocks> and every bare known tag of `defs`. Leaves the surrounding text intact.
export function stripBlocks(text, defs) -> string

// Write `body` (already serialized/escaped) as `def`'s block inside the message's envelope,
// replacing an existing copy; creates an envelope at the end of the text if there is none.
export function upsertBlock(text, def, body) -> string
```

## 4. Prompt (`src/prompt.js`)

The reply's prompt carries one context section, delimited by
`STORY_BLOCKS_V1_CONTEXT_BEGIN` / `STORY_BLOCKS_V1_CONTEXT_END`:

```
STORY_BLOCKS_V1_CONTEXT_BEGIN
## Story Blocks
At the very end of your reply, after the story, write exactly one hidden envelope ...
(rules: order, close every tag, never visible narration, escapes, stateful = full rewrite)

### Inventory — <Inventory> (kept: rewrite the full current state)
<block prompt, {{user}}/{{char}} substituted>
Format: <formatFor(def).rules(def)>
Current state:
<Inventory>
<serialized current state, or "(empty — start it from the story)">
</Inventory>

### Scene Notes — <Scene_Notes> (this reply only)
<block prompt>
Format: <rules>

Write it exactly like this:
<!-- STORY_BLOCKS_V1
<Blocks>
<Inventory>
<skeleton(def)>
</Inventory>
<Scene_Notes>
<skeleton(def)>
</Scene_Notes>
</Blocks>
-->
STORY_BLOCKS_V1_CONTEXT_END
```

API:

```js
export const CONTEXT_BEGIN, CONTEXT_END;
// Enabled blocks whose `when` fires for this generation, in order. `every`: fires when the
// number of assistant replies so far is a multiple of when.every (counting the reply being
// written). `keyword`: fires when any keyword (case-insensitive, whole word) appears in the
// last when.scanDepth messages of `chat` (user or assistant, envelopes stripped).
export function activeBlocks(defs, chat, type = 'normal') -> defs
// entries: [{ def, state }] (state only for stateful). substitute(text) applies {{user}}/{{char}}
// to block prompts only — never to state, which must reach the model verbatim.
export function buildContext(entries, { substitute = text => text } = {}) -> string  // '' when entries is empty
export function hasContext(text) -> boolean
export function defuseMacros(text) -> string     // port: placeholder copy SillyTavern may macro-substitute
// Foreground prompt: strip every block (stripBlocks) and every old context section from the
// prompt history, then insert `context`. Chat completion (eventData.chat array): drop a system
// message that only held the placeholder, remove the placeholder region from a shared message,
// insert `context` as a system message after the leading system messages. Text completion
// (eventData.prompt string): replace the placeholder region in place, else prepend. Keep the
// shared array object (splice), as Inventory Block does. Returns { injected, kind, reason }.
export function injectContext(eventData, context, defs) -> object
export function promptCarriesContext(eventData) -> boolean
```

Background prompts (quiet generations, other extensions' raw calls) are **not modified**
in v0.1: other extensions such as NPC State Delta read `<World_State>` evidence from the
history they send.

## 5. Runtime (`index.js`)

Port of Inventory Block's lifecycle (v0.6.7): session prepared on
`GENERATION_AFTER_COMMANDS`, armed by the `storyBlockGenerationInterceptor` generate
interceptor, placeholder registered with `setExtensionPrompt` (in-chat depth 0 system role
for chat completion, in-prompt for text completion), foreground detection by placeholder
markers with a fallback, watchdog, status line in settings. On `MESSAGE_RECEIVED`: rejoin
continuation, normalize transport, save, warn (toastr) when an enabled stateful block was
requested but missing, invalid or cut off. Re-render the card on receive, swipe, edit,
delete, chat change and render events. Exposes the tab API (section 6) as
`globalThis.StoryBlock`.

### Plugin API (`src/plugin.js`, v0.6)

`globalThis.StoryBlock` (`apiVersion: 1`) for other extensions:

| Member | Does |
|---|---|
| `listBlocks()` | Every definition (the reader's and plugins'): `[{ id, tag, name, kind, format, display, enabled, visible, optional }]`; kept blocks report `kind: 'kept'` and `owner` |
| `getBlock(tagOrId, { beforeIndex })` | Newest valid copy: `{ id, tag, text, state, messageIndex }` or null |
| `blockForGeneration(tagOrId, type)` | The copy a generation of `type` will be shown (a swipe/regenerate sees the one before the reply it replaces) |
| `blockInText(text, tagOrId)` | The block as written in one message's text (repeats merged), or null |
| `setBlockText(messageIndex, tagOrId, text)` | Replace a block in an assistant message (inside the envelope); resolves to true when it changed. For a kept block, `text` is plain text, refused (throws) when the block's format cannot read it, and stamped as the extension's copy |
| `registerBlock({ id, tag, name })` | A transport-only block: moved into the envelope, hidden, kept out of the prompt's history, never prompted, no tab. `{ ok, error }`. Registering a plugin's own id again replaces it |
| `registerBlock({ kept: true, id, tag, owner, name?, icon?, short?, format?, display?, fields?, promptNote?, diceModifier? })` | A kept block (v0.7), see below |
| `unregisterBlock(id)` | |
| `onReply(cb)` | After each reply is received and normalized: `cb({ chatId, messageIndex })`; returns unsubscribe |
| `onUpdate(cb)` | On every refresh (reply, swipe, edit, delete, chat change); returns unsubscribe |
| `registerTab(tab)` | A sidebar/card tab: `{ id, label, icon, order, render(pane, ctx), isAvailable?(ctx), key?(ctx), badge?(ctx) }`. `key` keeps an unchanged pane; `badge` is the count on the tab |

A throwing listener is logged and skipped.

#### Kept blocks (v0.7)

A block another extension keeps and the model only reads (RPG Battle's Character and Party
sheets). `pluginBlockDef` (`src/plugin.js`) builds it with `normalizeBlock` and checks it with
`validateBlock`, plus: `owner` required; `format` `'fields' | 'text'` (default `fields` when
`fields` are given); `display` `'fields' | 'plain'` (default by format; `fields` needs the
fields format); every field has a label and a known type. The definition is
`{ ...normalizeBlock(…), kind: 'stateful', visible: true, optional: true, prompt: '', plugin: true, kept: true, owner, promptNote, diceModifier }`.
`stateful` underneath means view, snapshots and swipe baselines treat its newest valid copy
as its state, as for any stateful block.

- **Only stamped copies count.** `upsertBlock` writes a kept block's tag as
  `<Character kept="RPG Battle">`. `ownCopy(entry, def)` (`src/envelope.js`) accepts only such
  copies, and `latestBlockInText` and `view.blockStatusInText` use it, so a copy the model wrote
  is never the current state. The model never sees the stamp: envelopes are stripped from the
  prompt history and the current state is shown in plain tags.
- **Dropped on receive.** `dropForeignCopies(text, defs)` removes unstamped kept copies (after
  `normalizeTransport` has moved bare ones into the envelope), and any envelope that held nothing
  else. It runs in `normalizeMessageTransport`, so on receive, edit, swipe, render and Rescan.
- **Prompt.** The runtime adds `{ def, state, body }` for each kept block that has a copy
  (before the reply a swipe/regenerate replaces) ahead of the active blocks. `buildContext`
  shows these entries first, as `### Name — <Tag> (kept by Owner: read it, never write it)`, then the
  `promptNote`, then `Current state:` with the stored body in plain tags. It adds the rule
  'Blocks marked "read it, never write it" are kept by another extension…', and leaves them
  out of the skeleton envelope and of the "kept: rewrite" rule. With only kept entries, no envelope is asked for.
  Each kept entry's `diceModifier` is added as a line of the instructions of a block whose
  `template` is `'dice'`. The stored prompt is never changed.
- **Receive.** Kept blocks are never in the missing/invalid warning.
- **Display.** A tab like the reader's blocks (`tabView`; none until written, since it is
  optional). `onEdit` is omitted, and `renderFrame` shows `span.story-block-kept` ("kept by Owner")
  for any `def.kept`. Kept blocks are not in `settings.blocks`, so the settings editor never lists them.

### Story Suite (`src/suite.js`, `src/handshake.js`, v0.8)

`src/suite.js` is the shared registry (`globalThis.StorySuite`), byte-identical in Story Block,
Story Director, NPC State Delta and RPG Battle; never edit it here alone. The contract, areas and
owners are in [STORY_SUITE.md](STORY_SUITE.md). `src/handshake.js` is Story Block's pure side:

| Export | Does |
|---|---|
| `offeredAreas(blocks)` / `blockAreas(def)` | Areas the enabled blocks offer, by `template` (duplicates keep it): `world-state` (or display `scene`) → `scene`, `timeline`; `inventory` (or tag `Inventory`) → `items`; `character-sheet` → `stats`; `dice`, `dice-everyone` (or display `dice`) → `rolls`. Kept and plugin blocks offer nothing |
| `normalizeSourceChoices(value)` | `settings.sourceOfTruth`: `{ scene, timeline, items, stats, rolls }`, each `'auto' \| 'mine' \| 'theirs'`, default `'auto'` |
| `deferredTo(area, choice, suite)` | `{ id, name }` of the extension Story Block defers to, or null while it is the source of truth (`isSourceOfTruth`) |
| `statsNotice(def, choices, suite)` | The Character Sheet's "RPG Battle owns stats…" note, or '' |
| `keepsOwnRolls(choice, suite)` | True only when the reader chose `mine` for rolls while another extension offers them: kept blocks' `diceModifier`s are then left out of the prompt |
| `sourceStatus(area, …)` | The settings line under each choice ("Now: RPG Battle", "Inventory is off") |

The runtime announces `{ id: 'story-block', name: 'Story Block', version, owns, api: { listBlocks, getBlock } }`
on load, when the block list changes and on chat change (only when the offer changed, or the
registry lost the entry), and subscribes once to `onChange` to redraw the settings section and
the tabs. A tab's display gets `def.deferNote`, which `renderNotices` shows as
`div.story-block-notice.is-deferred`; nothing else about the block changes. SillyTavern has no
disable hook (turning an extension off reloads the page), so there is no `withdraw` call.

## 6. Card and displays (`src/ui/*`)

One card under the **latest assistant message**, one tab per visible enabled block that
has something to show, plus tabs other extensions register.

```js
// src/ui/card.js
// tabs: [{ id, label, icon, render(pane) }] in order. Re-mounting keeps the selected tab
// (by id) and does not rebuild panes whose content key is unchanged.
export function mountCard(messageElement, tabs, { uiKey, compatMarkup = true } = {}) -> HTMLElement | null
export function unmountCard(root = document)        // remove every Story Block card
export function createTabRegistry() -> { register(tab), unregister(id), list() }
// tab: { id, label, icon, order?, render(pane, { messageId, message }), isAvailable?({ messageId, message }) }
```

DOM: `div.story-block-card` containing `div.story-block-tabs` (buttons
`button.story-block-tab[data-tab-id]`) and `div.story-block-panel` (panes
`div.story-block-pane[data-tab-id]`). With `compatMarkup`, the same elements also carry
Megumin Suite's classes (`meg-blocks`, `meg-blocks-tabs`, `meg-blocks-tab`,
`meg-blocks-panel`, `meg-block-body`, collapse `meg-blocks-collapse`, collapsed card
`meg-blocks-shut`) so extensions that already mount into Megumin's card (NPC State Delta,
see `/home/user/kohz87/npc_state_delta/index.js` around lines 4460–4660) attach a tab
without changes. Tab switching must also hide panes that such extensions added.

Displays (`src/ui/displays/<name>.js`), each:

```js
export function render(pane, { def, state, previousState, changes, error, truncated, onEdit, uiKey })
```

- `plain` — escaped text, line breaks kept, `**bold**` and `*italic*` allowed.
- `tree` — rows: Inventory Block's tree + drill-down + search + change strip
  (port `src/ui.js`, `src/tree.js`), using `def.columns` labels and `def.maxDepth`.
- `scene` — text blocks in Megumin's World State layout, parsed by `src/scene.js`
  (`parseScene`, `diffScene`); falls back to plain. `view.changesFor` uses `diffScene` for
  these blocks, so badges and the strip see scene changes (never secrets).
- `choices` — a numbered list as buttons (`src/choices.js`: `parseChoices`, `fillInput`);
  falls back to plain. Choices never appear in the "This turn" strip.
- `dice` — roll lines (`src/dice.js`: `parseDice`, `checkRolls`) as cards with a die that
  spins once (`animate`), the outcome, and the honesty check against the rolls stamped on
  the block (`stampRolls`/`readRolls`, `<Dice rolls="12, 5, 19">`); falls back to plain.
- `chatter` — `Name: line` text (`src/chatter.js`: `parseChatter`, `speakerHue`) as a whisper
  thread (two or more speakers) or a pull quote (one); falls back to plain.
- `fields` — meters as bars (`value/max`), numbers, text, lists as chips; changed entries
  marked from `changes`.

Every display shows `error` (the block is invalid; the last valid state is shown) and
`truncated` notices, and an **Edit** button when `onEdit` is given. Never use innerHTML
with model text; build nodes and set `textContent`.

### Sidebar and "This turn" strip (v0.2)

`settings.display` chooses where blocks are shown: `'sidebar'` (default) or `'card'` (the
v0.1 card above). The runtime builds the same tab list for both and `src/mount.js` hands it
to one of them.

```js
// src/ui/sidebar.js — one aside#story_block_sidebar on <body>, plus #story_block_scrim and
// the edge handle #story_block_handle. Tabs as above plus `short` (rail label) and `badge`.
export function mountSidebar(tabs, { uiKey, meta, pinned, onPinnedChange })
export function unmountSidebar()
export function openSidebar(tabId = null)
export function closeSidebar()
export function sidebarMode()        // 'docked' | 'drawer' | 'sheet'
export function layoutMode({ viewportWidth, chatRect, blockedRight, pinned, coarse })  // pure

// src/ui/strip.js — button.story-block-strip under the latest reply (settings.showTurnStrip, off by default).
export function mountStrip(messageElement, items, { onOpen, showQuiet })
export function unmountStrip(root = document)

// src/turn.js — pure: badge counts and strip items from view.js views.
export function turnCount(view)
export function turnItems([{ view, tabId }]) -> [{ tabId, block, text, tone: 'up'|'down'|'neutral'|'warn' }]
```

Layout: phone (≤ 640 px, or a coarse pointer ≤ 800 px) → bottom sheet; a pinned sidebar
with ≥ 324 px free beside SillyTavern's `#sheld` (minus an open right drawer) → docked in
that gutter; otherwise a drawer from the right. Recomputed on mount, resize, a
ResizeObserver on `#sheld` and a MutationObserver on the nav panels' class/style.

## 7. Settings editor (`src/ui/editor.js`)

```js
// Renders the whole settings panel into `container`:
// block list (enable toggle, visible toggle, move up/down, edit, duplicate, delete),
// "Add block" (blank or from a template), "Reset to default" for template blocks,
// Import / Export JSON, a status line slot (#story_block_status), and an estimated
// token cost per block. Calls onChange(blocks) with the full normalized list after every change.
export function renderSettings(container, { blocks, templates, onChange, estimateTokens })
// Modal/inline form for one definition. Validates with validateBlock(def, allBlocks) and
// shows every error before calling onSave(def).
export function openBlockEditor(def, { blocks, onSave, onCancel, container })
export function exportBlocks(blocks) -> string               // pretty JSON { version: 1, blocks }
export function importBlocks(json, existing) -> { blocks, errors }   // normalized, merged by id
```

## 8. Work packages and file ownership

| Package | Files it owns |
|---|---|
| core (lead) | `src/dice.js`, `src/view.js`, `src/scene.js` + `src/choices.js` (written by the ui package), `src/turn.js`, `src/mount.js`, `src/body-editor.js`, `src/schema.js`, `src/templates.js`, `src/formats/index.js`, `src/formats/text.js`, `src/formats/escape.js`, `src/formats/rows.js`, `src/formats/tree.js`, `index.js`, `docs/`, `README.md`, `CHANGELOG.md`, manifest/package/CI |
| fields | `src/formats/fields.js`, `tests/formats-fields.test.js` |
| engine | `src/envelope.js`, `src/prompt.js`, `tests/envelope*.test.js`, `tests/prompt*.test.js` |
| ui | `src/ui/card.js`, `src/ui/sidebar.js`, `src/ui/strip.js`, `src/ui/displays/*.js`, `src/ui/dom.js`, `style.css`, `tests/ui-*.test.js` |
| editor | `src/ui/editor.js`, `tests/editor*.test.js` (editor styles live at the end of `style.css`) |

Write only your own files. Do not run git commands that change the repository.
