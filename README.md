# Story Block 2.5.1

> Story Block 2.5.1 and RPG Battle 2.3.0 (they ship together); Story Director 2.1.0; NPC State Delta 1.3.0.

## What it is

Story Block is the **host** of Story Suite v2 for SillyTavern. It keeps the story's state (your bag, your
purse, where you are, who is here), reads a short hidden list of changes at the end of each reply, and
shows the result on tabs, cards and a status strip. Code sets every number; the story only proposes.

The other three Story Suite extensions plug into it and add their own tabs and rules:
[RPG Battle](https://github.com/kohz87/rpg_battle) (party, fights, trade),
[Story Director](https://github.com/kohz87/Story_director) (dice checks, clock, quests, World, map, arc) and
[NPC State Delta](https://github.com/kohz87/npc_state_delta) (a dossier for every NPC). Story Block works
alone: you get the inventory, the purse and the scene.

## Install

Tested with **SillyTavern 1.19**. In **Extensions → Install extension**, install in this order, then reload:

1. [Story Block](https://github.com/kohz87/Story_block)
2. [Story Director](https://github.com/kohz87/Story_director)
3. [RPG Battle](https://github.com/kohz87/rpg_battle)
4. [NPC State Delta](https://github.com/kohz87/npc_state_delta)

To start with the bundled **Ersveil 1.6.0** rules pack, open a fresh chat and follow **Setup → Pin Ersveil Rules → Create**,
then choose your character's options. Existing chats load and rebuild unchanged; legacy chats stay unpinned.

Report bugs in [this repo's Issues](https://github.com/kohz87/Story_block/issues), with steps to reproduce.

For the old Story Suite v1, install the `v1` branch of the same repo instead: paste the URL and type `v1` as the branch.

Story Block needs no other extension (`requires` is empty). RPG Battle, Story Director and NPC State Delta
each ask for Story Block 2.0.0-beta.2 or later (`requires: storyBlock >=2.0.0-beta.2`). When you update, update
Story Block first; an older Story Block shows a red notice and waits. Step-by-step help is in the [guide](docs/v2/GUIDE.md#installing).

## What you get

Every optional piece has a switch in **Settings → Features** (use the **Find a feature** box). A feature that
is off is gone from the story; nothing it made is lost.

- **Inventory** (tab and game-view screen): one bag for the whole party, with Equip on…, Give… and **Use on…**
  for consumables (it lists who a dose would help, with a module such as RPG Battle). No switch.
- **Your purse and coins:** one currency per chat, or coins such as copper, silver and gold with prices by place.
  Settings → **Story Block** section: **Currency**, **Coins**, **Money one reply may give**. A coin word the chat does not
  know is refused with a Problem, never paid as the wrong coin.
- **Pick what you take** (loot chips on the card under a reply; `story-block.loot`, on) and **Encumbered**
  (over the carry limit; `story-block.encumbrance`, on).
- **Scene** (tab): place, kind, region, the weather and who is here (with **Inner chatter** on, each person's thought). It starts **hidden** when
  Story Director's World screen is installed (World shows the same); show it again in Settings → Tabs & Packs.
- **Weather** (Scene, Home's scene panel, the status card; `story-block.weather`, on): the story notes it with a
  `~ weather` line when it changes. A module can also set it by rule: the `scene.weather` command, and a pack may
  carry a weather table by season and region. Story Director's calendar weather uses it. Descriptive only.
- **Changed this reply** (card under every reply, folded; `story-block.cards`, on): what the reply changed.
  Modules add their own lines, such as RPG Battle's checks with the die and its bonuses.
- **Status strip** above the message box (`story-block.hud`, on) and **Save points** on Home
  (`story-block.savepoints`, on). The read-only **State inspector** is off (`story-block.inspector`).
- **Choices** (`story-block.choices`, off): two to four next moves under the latest reply, in a folded row (open it to see the buttons).
  **Inner chatter** (`story-block.chatter`, off): unspoken thoughts, shown on World, or on Scene without Story Director.
- **Assist safety net** (*Safety net: read changes the reply forgot*, `story-block.extractor`, **off**): one cheap
  call after each reply keeps time, place, who came or went, weather, quest progress or a hand-over the story
  told but its change lines missed. It never adds coin, items, XP, jobs or teachers (`+ quest`, `+ trainer`). Lines it adds are marked "(assist)" and stored,
  so Re-read never calls the model again. A send waits for it at most 1.5 s; a later answer is used on the next reply.
- **Pre-roll, strict mode** (*Roll checks before the reply*, `story-block.preroll`, **off**): one cheap call reads
  your message and code fixes the check's stat and difficulty and rolls it before the reply. It needs a module that
  keeps checks (RPG Battle); the check table is the default way and needs no extra call.
- **One call at a time per connection** (setting **Run extra calls one at a time per connection**, on): Delta's
  scan, the arc planner and Assist take turns on the same connection profile.
- **Tabs, in this order:** Home (game view), Party, Inventory, Quests, World, Map, Fight, Crafting, Trade, Scene,
  Chronicle, other extensions' tabs, Director, and **Dossiers last**. Only installed extensions show. Move, hide or
  show them in Settings → **Tabs & Packs**.
- **Packs** (Settings → Tabs & Packs): import a world pack (items, races, places, shops, recipes, events, ranks, calendar, weather…).
  The bundled example is **Ersveil 1.0.0** (`examples/packs/ersveil/pack.json`): the whole world (320 places, 350 routes, 13 class
  lines from one shared start), 49 open quest templates and 13 open trainer templates for generative offers, and three data
  modules. Its lean lorebook is `examples/packs/ersveil/ersveil-lore.json`. It needs RPG Battle 2.3.0; [ERSVEIL.md](docs/v2/ERSVEIL.md) is the walk-through.
- **Settings → Diagnostics:** a report to paste into a bug report (no keys, no chat text), a **Model calls** line
  with the queue, and **Events**, a folded list of the packs' events and their conditions. Events can spoil the
  story, so it sits here.

## Data modules

Packs can ship small game systems as data: fields, narrator `dm …` lines, rules, rewards fixed at capture,
story-time timers and screens. Import either worked example pack — [Ersveil faction reputation](examples/packs/ersveil-factions/pack.json)
or [Ersveil survival](examples/packs/ersveil-survival/pack.json) (needs Story Director; attach a character in Setup) — then enable it
for this chat in **Settings → Tabs & Packs → Data modules**. Lines can use short module names such as `reputation` or `survival`.
See [Data modules](docs/v2/DATA_MODULES.md) for the format and both worked examples. Checks inside modules and coin/item/XP grants are planned for v1.1.

## Make a pack with your own AI

The [authoring kit](authoring-kit/README.md) is a folder of prompts, instructions, references and a checker for drafting a
rules pack or a data module for your own world in the coding agent or chat you already use: Claude Code, Cursor, Gemini CLI
or Antigravity, Codex CLI, or any chat by copy and paste. It has no AI page, no keys and no network code. Put your lore in
`authoring-kit/work/lore/`, let your agent follow `AGENTS.md`, and run `node check.mjs work/pack.json` in that folder until it
prints OK; that is Story Block's own checker. Then import the file in **Settings → Tabs & Packs**.

## How a turn works

1. Before each reply, Story Block adds a short note to the prompt: the same fixed instructions every time, plus
   a few lines about where things stand now.
2. The model writes the reply and ends it with a hidden list:

   ```
   <Changes>
   + item Moonveil Trout | qty: 1
   - item Rope | qty: 1
   + coin 30 | from: the sealer
   ~ place Bluewatch Village | kind: settlement
   </Changes>
   ```
3. Code reads each line as a suggestion, checks it against what is really there and applies it, or notes it
   under **Problems**. Numbers are clamped and capped per reply; model text never makes coin, items or XP.
4. **Swipe, delete, Re-read and reload stay correct:** the state is kept as JSON with each reply, so a swipe or a
   deleted reply takes its changes back. If you edit a reply's text, press **Re-read** to read its block again.

With a pinned rules pack, a quest offer can add `| like: <template>`; the reader can also choose **Make this a quest**. Code fixes the reward from the template's range at offer time. A foe variant uses `! encounter <name> | like: <foe>`; new pinned encounters follow their danger label.

Details: [GUIDE](docs/v2/GUIDE.md) (the `<Changes>` block, Checks, Screens) and [SPEC](docs/v2/SPEC.md)
(§4 the turn, §2.2 storage and replay, §5 the prompt).

## How modules connect

Story Block is the hub. Modules never import each other: each one registers with Story Block
(`sdk.registerModule(def)`) and plugs into the same few sockets, so any module can feed another module or the
narration, as long as both sides agree on a name and a shape.

| Socket | In the module's `def` | What it is for |
|---|---|---|
| **Queries** | `queries` | Read another module's data by name (`party.pc`, `director.time`, `npc.portrait`). Read-only. A query no installed module answers throws, so a module asks inside a guard (as the game view's header does) and simply skips what isn't there. |
| **Commands** | `commands` | Ask a module to change something (spend points, use an item on someone). The owning module checks and applies it, and the change is recorded with that message, so a swipe, a delete or a rollback undoes it. |
| **State** | `domains` | Each module owns its part of the saved state. Nobody writes into another module's part directly; they send it a command. |
| **What the narrator reads** | `context` (`static`, `tail`, `budget`, `parts`) | Each module adds its part of what is sent with each reply. Story Block orders the parts and keeps them inside one token budget (the "What's sent each reply" bar). |
| **What the narrator writes** | `capture` | The record lines in a reply's hidden list. Story Block hands each line to the module that owns it, which checks it before anything changes. |
| **Reacting** | `hooks`, `sdk.on(event, fn)` | Run when something happens, such as after a reply is read (settle a fight, pay a quest). |
| **On screen** | `screens`, `tabs`, `widgets`, `settings` | A module's screens appear in the bottom bar, the Story panel and the game view with the shared look; its settings appear in Story Suite's settings window. |
| **Switches** | `features` | Parts a reader can turn on and off; other modules can ask whether one is on (`sdk.feature(id)`). |
| **Cards under replies** | `cards` (`{ <id>: { for(state, message, ctx) → card \| null } }`) | A card under the head (newest) assistant reply, in the reply's strip, asked once on the head's state: a title, rows and up to three buttons that send a command or open a screen. Story Block draws it and keeps the Later state; WIDGETS.md, "Cards under replies". |
| **Tabs shown while active** | `screens` or `tabs`, `active(state, ctx) → { on, badge? }` | A screen or tab that shows only while `on`; with a `badge` it takes the last pinned slot on a phone, with a red dot. Off, it is hidden from the bars and still opens by id (WIDGETS.md). |

Three rules keep this safe:

1. **Ownership.** A module changes only its own state. Everything else goes through the owner's commands, which
   keeps swipes and rollbacks correct.
2. **One budget.** Everything sent to the narrator shares one token budget, so a module that says too much gets
   trimmed, not the story.
3. **Names are contracts.** A query's or a command's name and shape are an agreement between modules. RPG Battle,
   Story Director and NPC State Delta each answer the ones the others use; a different module can take one's place
   by answering the same names in the same shapes.

Details: [MODULES](docs/v2/MODULES.md) (what each module provides), [SPEC](docs/v2/SPEC.md) (the turn, storage and
the prompt) and [WIDGETS](docs/v2/WIDGETS.md) (the shared building blocks).

## Settings

Open **Settings** on the Story Suite bar above the message box, **Story Suite** in the wand menu, or
**Extensions → Story Block → Settings**. The ones that matter:

| Setting | Where | Default |
|---|---|---|
| Notes per reply (tokens) | Story Suite | 1500 |
| Share of the context (%) | Story Suite | 40 (8K context or more is recommended) |
| Change lines per reply | Story Suite | 150 |
| Currency, Coins, Coin display | Story Block section | one currency |
| Money one reply may give | Story Block section | 0 (worked out from your rank) |
| Run extra calls one at a time per connection | Story Suite | on |
| Connection profile for these calls / for the safety net | Story Block → Assist | same as chat |
| Show what's sent, Prompt size | Story Suite | read-only |

## Known issues in this beta

- The **Changed this reply** card does not yet list money or items paid by a step that runs after the reply's
  last line (a quest turn-in payout) or a weather change from the calendar; it can say "No changes" for them.
  The Inventory and Scene are right.
- The Assist safety net's late answer is applied on the next reply, marked "(assist, from the previous reply)".
- In a chat saved before this update, a quest Finish click can still be paid twice on Re-read of that reply.
- Saving: a timed-out save that reaches the server more than about five minutes late is not caught, and with two
  browser tabs on one chat the tab that saves last wins. Renaming a chat while it saves could leave a copy.
- Story Block 1's custom blocks are not read in v2; custom trackers are planned after the beta.
- The settings overlay and some cards (tall portraits, one choice per row) are still being redesigned.

The full list, with the modules' own issues, is in [RELEASES](docs/v2/RELEASES.md).

## Credits

Icons: [Phosphor Icons](https://phosphoricons.com), MIT License. See [ICONS-CREDITS.md](ICONS-CREDITS.md).

## Links

- [Player guide](docs/v2/GUIDE.md), [Changelog](CHANGELOG.md), [Releases and known issues](docs/v2/RELEASES.md)
- [SPEC](docs/v2/SPEC.md), [MODULES](docs/v2/MODULES.md), [PACKS](docs/v2/PACKS.md), [Status](docs/v2/STATUS.md)
- Developers: [docs/dev](docs/dev/) and [CLAUDE.md](CLAUDE.md)
- History, decisions and the after-beta list: `suite-notes/` in
  [kohz87/inventory-block](https://github.com/kohz87/inventory-block/tree/claude/hopeful-babbage-tipaw8/suite-notes)

Licence: [AGPL-3.0](LICENSE). RPG Battle and Story Director are MIT-licensed, so you can start your own module from either of them.
