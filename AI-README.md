# AI-README: Story Block 2.16.1

For AI assistants that read this repository. Plain facts, no marketing. For people, read [README.md](README.md). For rules
every change must keep, read [CLAUDE.md](CLAUDE.md). Depth lives in `docs/`; this file points there instead of copying.

## Purpose

Story Block is the host of Story Suite, a SillyTavern 1.19 extension (JavaScript ES modules, no dependencies, no build step).
It keeps story state (inventory, one currency, scene, mounts, reader edits, blocks, save points), captures the change lines
the narrator writes at the end of a reply, tells the narrator the state, and exposes an sdk so other modules add commands,
queries, screens and settings. Code sets every number; the story only proposes.

## Suite map

| Repo | Module id | Version | Owns |
|---|---|---|---|
| kohz87/Story_block (this) | `story-block` | 2.16.1 | The host: store, replay, command bus, `<Changes>` capture, prompt assembly, module registry, settings window, Game view, packs and portraits, save points. Core domains `scene` and `inventory`; optional RPG; blocks (data modules). |
| kohz87/Story_director | `story-director` | 2.9.1 | Story clock and calendar, quests, threads, map, trips, World, Chronicle, arc planning, standalone checks, the living cast (meets people by place and routine). Needs Story Block (>= 2.12.0). |
| kohz87/npc_state_delta | `npc-state-delta` | 1.7.1 | NPC dossiers, meters, stages, secrets, Cast and Dossiers screens, cast portraits. Needs Story Block; with Story Director it also follows the cast and Key people. |
| kohz87/Story_studio | (not an extension) | 0.6.0 | An offline single HTML page that writes and checks packs with Story Block's own checker. No install. |

Data flows one way: Studio writes a pack file; Story Block validates and stores it; Story Director reads what Story Block holds and NPC State Delta reads both,
through Story Block's queries (`packs.content`, `packs.calendar`, `packs.portrait`, ...). Story Block never calls a module
by name: modules register through `globalThis.StoryBlock.sdk.registerModule`, and each reads another module only through a
query with a fallback. Nothing flows back to Studio. Story Block's own tests that need the other repos skip when they are
not checked out beside it (see `CLAUDE.md`, "Known traps").

## Install & requirements

- SillyTavern: Extensions → Install extension → `https://github.com/kohz87/Story_block`. Install Story Block first, then
  Story Director, then (optional) NPC State Delta. Reload SillyTavern. Update Story Block before the modules.
- `manifest.json`: `loading_order` 25, `js: index.js`, `css: src/v2/view/host.css`, `generate_interceptor:
  storyBlockGenerationInterceptor`, no `requires`.
- Node: 24 in CI, 22 or later works locally. `npm test`, `npm run check`, `git diff --check` (see "File map").
- A pack may ask for a Story Block range and capabilities (`requires.storyBlock`, `requires.capabilities`). `data-modules-v1`
  is the host's own. `story-director`, `chronicle-lasting`, `scene` and `inventory` come from registered modules. A pack that
  asks for more than is installed is refused with a plain reason.
- The Ersveil sample pack 2.4.1 (`examples/packs/ersveil/`) needs Story Block ^2.16.0 and Story Director 2.3.0 or later.

## Concepts

- **Carrier**: a non-user message (greeting, reply). Only carriers hold state: `message.extra.storySuite`.
- **Record, checkpoint, ops, receipt**: a carrier's record holds `ops` (what changed), `receipts` (committed actions with a plain
  `summary`), `narrated` (receipts the reply told) and sometimes a `checkpoint` (full state at its start). State at reply N =
  latest valid checkpoint plus replayed ops. Replay never runs a command handler again. See `docs/v2/SPEC.md` §2.2.
- **Replay == live**: swipes, middle deletes, rewinds and reloads rebuild the same state. Per-reply bookkeeping is keyed by
  the carrier's `sid`, add-only. A block that no longer applies is skipped and listed alone.
- **Change lines / `<Changes>` block**: one hidden block at the end of a reply, one proposal per line, `op kind Name — text | label: value`.
  Story Block hides it and keeps a hidden comment `<!-- STORY_SUITE_V2 ... -->` in the message.
- **Kind**: the noun on a change line (`item`, `coin`, `place`, ...). A module owns a kind through `capture.kinds`.
- **Command / query**: commands change state (cause `story`, `ui` or `system`); queries read it. Both are named `domain.verb`.
- **Receipt cause**: `story` (a captured line), `ui` (the reader's click or edit), `system` (a cue or step the host runs).
- **Problem**: a refused or odd line, with a code (for example `CUT_OFF`, `STRAY`, `TOO_MANY`, `INVALID`). Never thrown at the reader;
  shown on the reply's card as "not applied" and in Diagnostics.
- **Re-read**: reads a reply's change lines again from its text, replacing that reply's story receipts. Reader actions on it stay.
- **Feature (F100)**: an optional mechanic with an id (`story-block.weather`), a default and a switch. Off means fully off: no grammar
  line, no prompt text, no screens, commands refused, state untouched. The choice is the reader's, not the chat's.
- **Static part / tail**: the two prompt parts Story Block sends. The static part (change-line instruction and each kind's one grammar
  line) is byte-identical every reply. The tail (`[Happened]` plus current state) is rebuilt each reply under a token budget.
- **Pack**: a JSON data file for a world (places, routes, calendar, weather, events, coins, start state, cast, data modules,
  screens). Data only; never code. A chat keeps the pack it began with.
- **Cast / portrait**: `content.cast` lists hand-written people. A portrait is an image file that comes beside the pack.
- **Data module / block**: a data-defined tracker (fields, buttons, rules, timers) with an interpreter and a 16-pin budget per chat.
  A reader makes a block in Settings → Blocks; a pack can carry one. Kind `dm`.
- **Reader edit / Edit**: a pencil or the header's one **Edit** form. It runs a `ui` command stored on the latest reply, so a swipe or
  delete of that reply takes it back.
- **Game view / Story panel / bar / More**: the full-screen screens; the side or bottom sheet with the same screens; the five or so
  tabs shown; every other screen. **Hero**: the header above every Game view screen.
- **Save point**: a named SillyTavern branch of the chat plus every module's checkpoint, made by the timeline coordinator.
- **Assist**: two optional helpers that make one extra model call each (safety net after a reply, check roll before one).
- **RPG**: an optional part (feature `story-block.rpg`, off by default): party sheet, rolls, battle log. Not the removed RPG Battle.

## Reader features

Where each lives in the UI. Screens are in the Game view (Alt+G, or the **Game view** button in the Story Suite bar above the
message box) and in the Story panel (**Story** button). Settings open from the **Suite** button or the wand menu.

- **Hero header** (`view/game-header.js`): name, story time (with Story Director), place, weather, who is here, rank, wearing, condition,
  and a Travel line while a Story Director trip is on. One **Edit** button opens `view/hero-edit.js`: Story (year, month, day, time,
  place, weather, here) and Character (rank, wearing, condition). Save sends only changed fields, in order: `director.clock`,
  `scene.place`, `scene.weather`, `scene.present`, `scene.you`; a refusal stops the rest.
- **Home** (`screens/home.js`): Purse and pack (editable purse), Quests card (from a quest module), Mounts card (only while the party
  has a mount), block cards, Save points row, "Before you start" when a module holds the story back, "Your character" with the RPG.
- **Inventory** (`screens/inventory.js`): things by kind with filter, show, rarity, equipped-only; Equip, Drop, **+ Add item**,
  pencil per item (name, count, note together), purse pencil, loot "To pick up" with **Take selected**.
- **Scene** (`screens/scene.js`): place, who is here, weather, inner chatter without Story Director. Starts hidden while another
  screen shows the same.
- **"This reply" card** (`view/mounts/card.js`, `screens/changes-card.js`, `reply-cards.js`): one card under each reply. Closed: one line per
  part. Open: each part under its own heading ("Changed this reply" is Story Block's; other modules add theirs). Lists "not applied" lines.
- **Notes under a reply** (`reply-notes.js`): "No change lines came with this reply", "This reply was edited" with **Re-read**.
- **Choices** (`extras-ui.js`): `? choice` buttons under the newest reply that only fill the message box. Feature, off by default.
- **Inner chatter** (`extras.js`): `~ chatter` thoughts shown next to people on World (or Scene). Feature, off by default.
- **Save points** (`screens/savepoints.js`, `timeline/`): Home → **Save point** (name it), **Return here**, **Forget**. Feature, on.
- **State Inspector** (`screens/inspector.js`): read-only tree of any reply's state, receipts, problems. Feature, off by default.
- **Status strip** (feature `story-block.hud`): strip above the message box, shown only when something can fill it.
- **Settings window** (`view/settings/`): Look, Features (Lean/Standard/Full presets), RPG (appears when the RPG is on), Money, Assist,
  Tabs & Packs (bar placement, packs, Prompt budgets and "What's sent each reply"), Blocks, Modules, Diagnostics. Opens on Features.
- **Packs** (`packs/panel.js`): Import pack file (one `.json`, a `.json` plus images, or one `.zip`), Read from character lorebook,
  switch on/off, Remove (asks first).
- **Blocks** (`screens/blocks*.js`, `data-modules/`): Settings → Blocks: New block, From a template, Edit, **Show as** (own tab, Home card,
  both, hidden), ⋯ (Save as template, Export as pack, Remove). Templates are shared across chats (at most 16).
- **Mounts** (`domains/mounts.js`): Home card with a pencil per mount; pace and "the party walks" note.
- **RPG** (`lean-rpg/`): Party and Fight tabs, New character wizard, spend points, export/import a character, battle log under a reply.
  See `docs/v2/RPG.md`.

## Settings

Reader settings live in `extension_settings.storySuite` (per SillyTavern user, not per chat).

Host settings (`sdk.js` `HOST_SETTINGS_DEFAULTS`):

| Name | Does | Default |
|---|---|---|
| `tailBudget` | Most tokens of notes added to each reply's prompt (100 to 20000) | 1500 |
| `contextShare` | Most of the context size the instructions and notes take together, % (10 to 90) | 40 |
| `maxChangeLines` | Most change lines one reply may hold (10 to 1000); the rest are one `TOO_MANY` Problem | 150 |
| `callQueue` | Story Suite's own model calls on the same connection profile run one at a time | on |
| `panelStyle` | `glass`, `solid` or `sillytavern` | `glass` |
| `glassStrength` | Panel density, % (30 to 90) | 50 |
| `font` | `nunito` (bundled) or `theme` | `nunito` |
| `textSize` | `100`, `110` or `120` (Story Suite's own text only) | `100` |

Story Block module settings (`CORE_SETTINGS`, assist, RPG; `sdk.settings('story-block')`):

| Name | Does | Default |
|---|---|---|
| `currency`, `currencyPlural`, `currencyShort` | The one coin's name, plural, short form | gold, "", "" |
| `coins` | Up to 8 coins as name and worth in the smallest ("copper: 1", "silver: 10") | empty (pack's, else `currency`) |
| `coinDisplay` | `mixed` ("3 silver 5 copper") or `base` | `mixed` |
| `economyScale` | Money scale 0.001 to 1000; 0 means the pack's, else 1 | `0` |
| `chatterInPrompt` | Send the answered reply's inner chatter back as one tail note | off |
| `assistProfile`, `assistExtractorProfile` | Connection Manager profile for the helpers' calls ("" is the chat's) | "" |
| `assistExtractorKinds` | Kinds the safety net may write (never coin, new items, XP, loot, heals) | `! time, ~ time, ~ place, + present, - present, ~ weather, ~ quest, - quest, ~ wound, - item` |
| `rpgRolls` | `automatic` or `off` | `automatic` |
| `rpgJoin` | Companions who join: `ask`, `auto` or `off` | `ask` |
| `rpgDifficulty` | `gentle`, `standard`, `harsh` or `custom`; also `rpgFormula` (`standard` default or `classic`), `rpgStandard`, `rpgCustom`, `rpgPlannerNote` | `standard` |

Features (ids; default on/off; Lean and Full say what the preset sets, "-" means outside presets):

| Id | Label | Default | Lean / Full |
|---|---|---|---|
| `story-block.hud` | Status strip | on | - |
| `story-block.cards` | Cards under replies | on | - |
| `story-block.preroll` | Roll checks before the reply | off | off / on |
| `story-block.extractor` | Safety net: read changes the reply forgot | off | - |
| `story-block.inspector` | State inspector | off | - |
| `story-block.savepoints` | Save points | on | - |
| `story-block.choices` | Choices | off | off / on |
| `story-block.chatter` | Inner chatter | off | off / on |
| `story-block.weather` | Weather | on | off / - |
| `story-block.you` | Your look | on | off / - |
| `story-block.mounts` | Mounts | on | off / - |
| `story-block.rpg` | RPG | off | - |
| `story-block.loot` | Pick what you take | on | off / - |
| `story-block.encumbrance` | Encumbered | on | - |

A feature that owns a grammar line changes the static prompt once when switched, so the provider's prompt cache starts over once.

## Data the model sees

Two extension prompts, set only by Story Block (`prompt.js`, `turn.js`). Quiet and impersonate generations get nothing and capture nothing.

- **`story_suite_static`** (in prompt, system): the change-line instruction, then one grammar line per kind that is on, then each module's
  static text. Byte-identical every reply of a chat; no names, counts, times or dice. Story Block adds "Code keeps the inventory, the
  wallet, the place and who is present: ..." and the currency sentence ("Money in this story is gold ..."). The instruction tells the
  narrator the block "does not count toward any reply length limit", to use only the kinds listed, and that no other state blocks exist.
- **`story_suite_tail_1`** (in chat, depth 0, system): `[Happened]` and one summary line per receipt the last reply has not told yet
  (the first five always; past half the budget the rest are one counted line), then each module's tail in a fixed order (scene,
  inventory, party, combat, trade, director, then other modules by id). Core tail lines, as sent: `Place: Auvoth (settlement, Compact Lands); clear`, `Present: Harrak`,
  `You: wears coat; condition tired` (only while set), `Mounts: Grey Mare (horse, 35 km/day, ridden)` (only with a mount), `Wallet: 22 gold`,
  `Carried: Lantern`, an encumbrance line when the party is over its carry limit, and, with the RPG on, its rolls cue and sheet.
  Open loot is shown to the reader on the reply's card; it is not in the tail.
  Optional lines drop first when the budget (`tailBudget`) or the context share (`contextShare`, never below 200 tokens) is exceeded.
  The static part is never trimmed; when it alone exceeds the share the reader is warned once per chat (`CONTEXT_SMALL`).
- **Never sent**: the hidden comment of past replies (stripped from prompts while Story Block runs), the reader's inner chatter unless
  `chatterInPrompt` is on, block fields a pack marks `prompt: false` (they still count for rules), raw state records, pack cast text
  (Story Block sends none; Story Director and NPC State Delta decide what of it is told), and anything from a feature that is off.
- The settings' **What's sent each reply** shows the exact text of every part, per module (`turn.previewFit()`); it sends and stores nothing.
- Extra calls (only when on): Assist's classifier and safety net, the RPG's planner. Each uses `sdk.callModel` with the connection profile
  setting, a 20 s limit, and never writes to the chat.

## Reply format the model writes

One hidden block at the end of the reply:

```
<Changes>
op kind Name — what happened | label: value
</Changes>
```

`+` gained, `-` gone, `~` changed, `!` happened, `?` asks code to decide. Reading is lenient: bullets and bold are ignored; a line over
2000 characters is a Problem; a block cut off mid-line never applies that last half line (`CUT_OFF`, kept so Continue can finish it).
A line written just before the block in the story, standing alone, is also read; one that is not clearly a change stays in the story
(`STRAY`). Kinds Story Block reads (grammar lines as sent):

```
+ item Name | qty: 1 | note: short detail          (- item Name | qty: 1 when used up or lost; ~ item Name | note: ...)
+ coin 30 | from: who                              (- coin 5 | to: who when paid; one number in the wallet's currency)
~ place Name | kind: settlement | region: wider area | with: who came along (the rest stay behind)
+ present Name   /   - present Name                (arrivals and departures)
~ weather cold drizzle, low fog                    (feature weather; at most 60 characters)
~ you wearing: ... | condition: ...                (feature you; a pack with content.you.rank adds a rank: part; each at most 120)
+ mount Name | kind: horse | count: 1 | pace: 35 | where: ridden by Name   (~ mount Name | condition: lame; - mount Name; at most 6)
? loot Thing, Other Thing x2 — where it lies       (feature loot; the reader chooses what to take)
? choice Climb the wall                            (feature choices; 2 to 4 a reply, display only)
~ chatter Name: a short unspoken thought           (feature chatter; display only)
! dm Module — reason | kind: name | label: value   (only for enabled data modules)
+ party Name | about: ... | class: I | best: int    (feature rpg, while Companions who join is not off)
```

Real example, as read by this version (each line gives the receipt after it):

```
<Changes>
+ item Lantern | qty: 1 | note: horn panes, burns a night on one fill    -> The party gains Lantern.
- coin 8 | to: the chandler                                              -> The party pays 8 gold — to the chandler (22 gold left).
~ place Auvoth | kind: settlement | region: Compact Lands | with: Rika    -> The scene moves to Auvoth with Rika.
+ present Harrak                                                         -> Harrak is here.
~ you wearing: rain-dark coat | condition: tired, hands salved           -> Your look: wearing rain-dark coat; condition tired, hands salved.
? loot Rope, Torch x2 — on the cellar shelf                              -> Loot to pick from (on the cellar shelf): Rope, Torch ×2.
</Changes>
```

Story Director's kinds (`? check`, `~ quest`, `~ time`, `~ trip`, ...) and NPC State Delta's are read by those modules, not here.
Grammar detail: `docs/v2/SPEC.md` §4.4; `docs/dev/capture-and-reread.md`.

## Pack format pointers

A pack is one JSON object. Fields Story Block reads (`packs/limits.js` is the source of truth):

- Top level: `id`, `version`, `name`, `author`, `description`, `requires`, `currency`, `economy`, `calendar`, `weather`, `content`, `start`,
  `layouts`, `screens`, `theme`. Any other key is refused.
- `content` kinds: `items`, `creatures`, `shops`, `recipes`, `events`, `quests`, `races`, `talents`, `skills`, `presets`, `places`, `routes`,
  `terms`, `ranks`, `crafts`, `meterPresets`, `markets`, `dataModules`, `rpg`, `cast`, and the object `you` (`you.rank.label`, 1 to 30 characters:
  gives your character a rank under that word).
- Events carry `id`, `when` (a condition, checked by the same parser the story uses), `cue`, `once`, `after`, `then`.
- `content.cast`: required `id`, `name`, `about`, `look`, `start.place`, `start.goal`; optional `aliases` (8), `voice`, `personality`, `history`,
  `portrait`, `start.routine`, `drawnTo` (6), `meters` (a preset id and starting values), `stages` (8), `fields` (6), `secrets` (8; each opens at a
  meter value, on a story event, or whichever comes first), `canDieUnmet`. Up to 64 people. Field detail: `docs/v2/PACKS.md` "The cast".
- Portraits: WebP, PNG or JPEG, 10 MB at most each, named by the cast, 32 files a pack. Stored at 150 KB or less (a bigger picture is shrunk
  in the browser to WebP, 1200 px long side). Kept as SillyTavern user files `user/files/storysuite-portrait-<pack>-<hash>.<ext>`.
  Query `packs.portrait({ pack, file })` gives a safe URL or null.
- Limits: one pack 512 KB; 32 installed packs, 2 MB together; nesting 16; 200 keys; 1000 list entries; strings 4000; 20 problems reported.
  A pack `.zip` holds `pack.json` and `portraits/` only (322 MB, 40 entries, no encryption, zip64 or `..` paths).
- Data modules: 8 definitions a pack, 16 pins a chat. See `docs/v2/DATA_MODULES.md`.
- Checker: `node authoring-kit/check.mjs <pack.json>` uses the same validation as the extension. Format and limits: `authoring-kit/reference/`.

## Commands/queries

For module authors. Register with `StoryBlock.sdk.registerModule(def)` (SPEC §6, MODULES.md); call with `sdk.command(type, payload)` (runs as
the reader, cause `ui`) and `sdk.query(name, args)`. Names as registered by this repo:

Commands:

- `inventory.add` / `inventory.edit` / `inventory.drop`: the reader's add, change (name, count, note) and drop of an item.
- `inventory.equip` / `inventory.unequip` / `inventory.split` / `inventory.merge` / `inventory.wear` / `inventory.repair`: bag management and condition.
- `inventory.grant` / `inventory.consume` / `inventory.transfer`: internal or module use (story, host, another module's command).
- `inventory.lootTake`: take ticked things from a reply's loot offer; claimed once per offer.
- `wallet.set` (reader sets the purse) / `wallet.pay` / `wallet.receive` (module use).
- `scene.place` / `scene.present` / `scene.weather` / `scene.you`: place (with who comes along), who is here, weather, rank/wearing/condition.
- `mounts.edit`: the reader's edit of a mount.
- `events.fire`: fire a pack event by id. `assist.precheck`: store a pre-rolled check on the reply.
- `savepoint.make`: via the timeline (named save point). `savepoint.restore`: internal, host only.
- `dm.define` / `dm.redefine` / `dm.remove` / `dm.pin` / `dm.migrate` / `dm.attach` / `dm.set` / `dm.act`: blocks and data modules; `dm.capture`, `dm.tick`,
  `dm.settle`: internal; `dm.join` and `rpg.joinNo`: the RPG's companion card; `rpg.resolve`: internal, the rolls of a planned reply.

Queries:

- `inventory.items` / `.find` / `.wallet` / `.counts` / `.definitions` / `.equipment` / `.loot` / `.condition` / `.encumbrance`: bag reads.
- `inventory.currency` / `.economy` / `.storyBudget`: the chat's coin, money scale, and the reply's story-paid money (no cap; budget is always null).
- `scene.place` / `scene.present` / `scene.weather` / `scene.you` / `scene.moved`: scene reads. `mounts.list` / `mounts.pace`: mounts and the party's pace.
- `packs.list` / `.content` / `.item` / `.itemDefs` / `.start` / `.calendar` / `.weather` / `.youRank` / `.crafts` / `.economy` / `.markets` / `.portrait`: installed packs.
- `events.status`: pack events. `assist.status`: helper run log. `story.evidence`: validated proof.
- `savepoint.contract` / `savepoint.list`: the timeline's capabilities and the save points.
- `dataModules.offers` / `.view` / `.public` / `.replayInputs` / `.actors` / `.setup` / `.presentation`: blocks and data modules.
- `rpg.joins` / `rpg.rolls`: the RPG's companion offers and a reply's rolls. `chatter.head` / `scene.chatter`: display-only thoughts.

Other sdk: `sdk.reread(index)`, `sdk.rewind`, `sdk.callModel(request)`, `sdk.timeline`, `sdk.dialog`, `sdk.features()`, `sdk.feature(id)`, `sdk.settings(id)`,
`sdk.modules()`, `sdk.preflight`, `sdk.on('committed' | 'head' | 'turn' | 'feature' | 'modules', fn)`. Contracts: `docs/v2/SPEC.md` §3, §6;
`docs/v2/MODULES.md`; `docs/v2/LIFECYCLE.md`.

## Storage

- **Per chat**: story state on the chat's replies, `message.extra.storySuite` (record, checkpoint, ops, receipts), plus a hidden comment with the
  change lines in the reply text. Save points: SillyTavern branches, and their manifest in the chat's metadata (`chatMetadata.storySuite.timeline`).
  Reader edits and the Edit form are ops on the latest reply. Blocks and pins live in the `dataModules` domain of the chat state.
  Domains: `scene` (place, present, weather, you, mounts), `inventory` (defs, stacks, wallets, aliases), `dataModules`, `savepoints`.
- **Per reader (all chats)**: `extension_settings.storySuite`: module settings, the feature choices (`features`), installed packs (`packs`), block
  templates, tab order and bar choices. Cards' "Later" choice is browser `localStorage`, never game state.
- **Files**: cast portraits as SillyTavern user files (see above). SillyTavern's Data Maid lists them as unused; deleting them removes the
  pack's pictures.
- Stored state is never deleted by a UI change, a preset, a switch or removing a feature. A deleted or swiped reply takes back its own ops only.
  Replay with a feature off reads the same stored lines. Details: `docs/v2/SPEC.md` §2.2, `docs/dev/saves-and-persist.md`, `docs/v2/PERFORMANCE.md`.

## File map

| Path | Purpose |
|---|---|
| `index.js`, `manifest.json` | Wires SillyTavern to the v2 runtime and mounts the UI; the generation interceptor |
| `src/v2/runtime.js`, `store.js`, `persist.js`, `chat-file.js` | Registry, settings, store, bus, turn; records and replay; saving |
| `src/v2/ops.js`, `check.js`, `commands.js`, `rng.js` | Ops, validators, command bus and claims, seeded rng |
| `src/v2/capture.js`, `turn.js`, `prompt.js` | `<Changes>` grammar and hiding; interceptor, capture, swipes, Re-read; static part and tail |
| `src/v2/registry.js`, `sdk.js`, `features.js` | Module definitions; the public sdk; Features |
| `src/v2/domains/` | `scene`, `inventory`, `money`, `mounts`, name matching: the core module |
| `src/v2/packs/` | Pack validation, safety, import, zip, portraits, lorebook, content queries |
| `src/v2/events/`, `assist/`, `timeline/` | Pack events; the two helpers; save points and the restore barrier |
| `src/v2/data-modules/`, `lean-rpg/` | Blocks and data modules; the optional RPG |
| `src/v2/screens/`, `view/` | Default screens; template renderer, widgets, settings window, Game view header, themes |
| `src/v2/ui-host.js`, `host-ui.js` | Bar, panel, drawer; settings folds |
| `src/`, `index.v1.js`, `docs/v1/` | Story Block 1, not loaded; kept for reference (`v1` branch) |
| `testkit/` | Fake SillyTavern and a whole host (`createHost`); vendored by the modules |
| `tests/`, `tests/v2/` | Tests (about 2,100): `qa/`, `break/`, `domains/`, `packs/`, `view/`, `screens/`, `ux/` |
| `examples/packs/` | `ersveil` (sample world, lorebook, 12 portraits), `riverside-starter`, `ersveil-factions`, `ersveil-survival` |
| `examples/fishing/` | A reference activity module |
| `authoring-kit/` | Prompts, references and the pack checker for drafting packs |
| `scripts/` | `check.mjs`, `sync-testkit.mjs`, benchmarks, fuzzers |
| `docs/v2/` | Specs: `SPEC.md`, `MODULES.md`, `PACKS.md`, `GUIDE.md`, `RPG.md`, `TIMELINE.md`, `REPLAY.md`, `PERFORMANCE.md`; `docs/dev/` area notes |

Commands: `npm test`, `npm run check`, `git diff --check`. Rules every change keeps: `CLAUDE.md` (code sets numbers, replay equals live, static
prompt byte-identical, every optional mechanic a Feature, no markup from text, no randomness or clock in state).

## Limits & known follow-ups

- One currency per chat, up to 8 coins. A stack that does not stack holds at most 50 pieces. Party mounts: at most 6.
- At most 150 change lines a reply by default; 16 blocks-and-modules pins and 8 blocks a chat; 16 block templates.
- A reply cut off inside its block loses its last half line (a Problem says how to recover). A chat's pack is the copy it began with.
- A change to `testkit/` or `src/v2/` can turn a module's tests red after its next re-sync; say so and re-sync.
- Open: one `test.todo` (C4-2, a save already on its way when a chat is renamed can write the old name again;
  `tests/v2/break/c4-rename-midsave.test.js`).
- Docs that lag the code: `docs/v2/STATUS.md` and `docs/STORY_SUITE.md` still describe older releases; `docs/v2/ERSVEIL.md` names pack
  2.4.0 where the file is 2.4.1. `CHANGELOG.md` is the record of what each release did.
- RPG Battle (the old separate extension) is not supported; its rules packs cannot be imported. This repo does not touch it.

## Version

Story Block 2.16.1 (`manifest.json`, `package.json`). Suite: Story Director 2.9.1, NPC State Delta 1.7.1, Story Studio 0.6.0.
Sample pack: Ersveil 2.4.1. History: `CHANGELOG.md`.
