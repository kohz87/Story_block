# Playing v2 in Ersveil

This page sets up a v2 chat in the Ersveil world with the **Ersveil example pack 1.0.0**
([`examples/packs/ersveil/pack.json`](../../examples/packs/ersveil/pack.json)) and its lorebook
([`examples/packs/ersveil/ersveil-lore.json`](../../examples/packs/ersveil/ersveil-lore.json)). A new
story begins in Bluewatch Village, at the Adventurer Guild office, with a plain travel kit and four silver.

The pack holds what the game counts: items, creatures, shops, recipes and crafts, events, Guild quests
and jobs, teachers, races, talents, one basic class with thirteen lines to choose from, the Guild ranks,
the map (places, routes, markets), the calendar, the weather, two NPC meter presets and three data
modules. The lorebook keeps only what the narrator alone uses. Neither copies the other.

The pack needs **Story Block 2.5 or newer and RPG Battle 2.3.0** (it asks for `rb-rules-v2` and
`data-modules-v1`). RPG Battle 2.2.0 cannot open its count-bounded job templates, so update both together.

Setup used for this guide: SillyTavern 1.19, with a large hosted model most of the time and a small local one now and then.

## 1. Extensions

Install these four (SillyTavern → Extensions → Install extension: paste the URL and install; there is no
branch to pick). If you have the v1 versions installed, remove them first or use a
separate SillyTavern profile; v2 doesn't read v1 chats or v1 blocks.

| Extension | URL |
|---|---|
| Story Block (the host) | https://github.com/kohz87/Story_block |
| RPG Battle | https://github.com/kohz87/rpg_battle |
| Story Director | https://github.com/kohz87/Story_director |
| NPC State Delta | https://github.com/kohz87/npc_state_delta |

## 2. Megumin

Keep Megumin Suite on with **only CoT and Writing Style** enabled. Turn everything else off: every
block (World State, Bonds, Character Sheet, Inner Chatter, CYOA, Story Tracker, Dice), Story Director,
NPC Bank, Combat, MVU, the Notebook.

You don't need the Megumin Story Director engine (`Megumin_V11_Story_Director_Engine.json`) for v2.
v2 never asks the model for World State, Director or other blocks (MODULES §F13, §F15). The only block
the model writes is `<Changes>`, and Story Block's own instruction asks for it.

## 3. Import the pack

1. Story Suite settings → **Packs** → **Import pack file** → `examples/packs/ersveil/pack.json`.
   The message says "Installed Ersveil." and the list shows what the pack adds: "124 items, 69 creatures,
   20 shops, 21 recipes, 7 events, 54 quests, 10 races, 8 talents, 320 places, 350 routes, 1 term set,
   7 ranks, 2 crafts, 2 meter presets, 31 markets, 1 rules set, start state, 4 coins, a money scale, a
   calendar, 84 weather tables". The pack also carries 3 data modules; they are not in that line and
   stay off until you enable them ([§6](#6-the-three-data-modules)).
2. Switch off any other pack with a start state or a currency (for example `riverside-starter`). The
   first enabled pack that has one sets the start place and suggests the currency.
3. Start a **new character timeline**. A chat takes the pack it begins with and keeps that copy.

Chats that were started on the old **Ersveil: Bluewatch Starter** pack (`ersveil-bluewatch`, up to 1.6.0)
keep their pinned copy and play on unchanged, whatever you import later. Importing Ersveil 1.0.0 does not
touch them, and the old pack's id is a different pack, so it is not replaced either.

## 4. Import the lorebook

* SillyTavern → World Info → **Import World Info** → `examples/packs/ersveil/ersveil-lore.json`. It is a
  SillyTavern World Info book named **Ersveil Lore**, 170 entries.
* Make it active for the chat (attach it to the narrator card, or set it as a global book). Leave
  Vector Storage's "Enabled for all entries" off.
* The book does not hold prices or numbers the game counts; those come from the pack. Edit the book freely;
  it is not read by code.

## 5. Narrator card and first message

* **Character card:** a narrator card, for example name `Ersveil` with the description
  "{{char}} narrates Ersveil and plays every person in it except {{user}}."
* **Persona:** your own character. There are no ready-made characters in this pack: you choose race,
  talents and class on RPG Battle's character screen (see below).
* **First message:** write your own opening at Bluewatch Village. The story starts at the Guild office,
  so open there, or let the narrator walk you in.

## 6. The three data modules

The pack ships three chat-scoped data modules. None is on by default and no narrator line turns one on;
you enable each in the chat you want it in:

1. Story Suite settings → **Tabs & Packs** → **Data modules**.
2. Find the module, check the preview, and press **Enable for this chat**.

| Module | What it keeps |
|---|---|
| Standing with the powers | Your standing, -100 to 100, with each of ten powers (kinds `gain` and `loss`). Screen: Standing. |
| Fame by region | How well known you are, 0 to 100, in each of sixteen regions (kinds `deed` and `spread`). Screen: Fame. |
| Adventurer Guild membership | Registration, your letter (F to S), dues and years as a member (kinds `register`, `dues`, `contract`, `promote`, `yearend`). Screen: Guild. |

Once a module is enabled the narrator is told its `! dm …` lines; a refused line changes nothing. They need
no Story Director and no model call of their own. See [DATA_MODULES.md](DATA_MODULES.md) for the format.

## 7. Playing

**Start state.** A new chat begins at **Bluewatch Village / Guild Office**. You carry a plain travel kit
(travel outfit, knife, waterskin, bedroll, 3 trail rations, 2 torches, flint and steel) and **40 copper**,
shown as "4 silver".

**Clock.** The pack's calendar is the Compact Year: era `CY`, twelve months of 30 days, and the story
starts on **CY 611, Goldwane 12, 06:40**. Story Director's atlas and clock read it with the query
`packs.calendar`. If the Director tab shows no time after the first reply, let the story write
`~ time Goldwane 12, 06:40 am`. The time-based events and the deadlines of jobs wait until the story
clock is set. The pack also has weather tables for each of four seasons.

**Character creation.** Before the first reply RPG Battle asks you to create your character
(MODULES §F12). Choose one of the pack's 10 races and its talents (8 are offered, among them
**Physical Affinity** and **Mana Affinity**) and spend the points. Every character is
**one basic class, Awakened**, with three skills: a basic weapon strike, a body-reinforcement skill and a
small mana skill. At **level 10** you pick **one of 13 class lines** (each has its own three further
tiers, 40 classes in all). A promotion needs all three skills of your class at a set mastery: **3** for the
promotion at level 10 and **5** for the ones at levels 20 and 30 (the pack's `promotionMastery` `[3, 5, 5]`,
[PACKS.md](PACKS.md#rules-a-rules-pack)). So the first choice, of a line, comes at level 10 once the three
skills of Awakened reach mastery 3.

**Currency.** Three coins are named: **copper** (1), **silver** (10) and **gold** (100); the pack also
accepts "bronze" as a second name for copper. The wallet counts copper, every price and reward is a whole
number of copper, amounts show as "3 silver 5 copper", and the narrator may write `+ coin 3 silver` (30
copper). The pack sets the money scale to **8**: copper is a small coin, so the built-in default loot and
rewards scale up to match. Change **Money scale** in Story Block's settings if it feels too rich or too
poor. If you have named your own currency in the chat, clear it or set Story Block's **Coins** to
`copper: 1`, `silver: 10`, `gold: 100`.

**Jobs and teachers.** The Guild's jobs and the teachers you meet are not a fixed list. Of the pack's 54
quests, 49 are **open quest templates** (hunt, cull, gather, deliver, explore, escort and story tasks for
each Guild rank F to S, seven for every rank) and 5 are fixed. Of its 29 teachers, 13 are **open trainer templates**, one for
each class line's school of teaching, and 16 are fixed teachers at named places (the Guild branch drill
at the Bluewatch office is one). With RPG Battle's **Jobs from the story** setting on (the default), the
narrator offers a job or a teacher in its own words (`+ quest …`, `+ trainer …`) and code settles the
numbers: the template, the count inside the pack's bounds, the coin and XP from the rank's range, the
deadline. A job carries a rank, and a rank pays an XP range of its own. RPG Battle's README explains the
whole flow, the three outcomes (kept, adjusted, dropped) and what you see on the reply card: see
[How quests and trainers work](https://github.com/kohz87/rpg_battle#how-quests-and-trainers-work).
The Assist safety net never offers jobs or teachers; only the narrator does.

**Events.** The pack has 7 world events; each fires when its condition on place, story time or
quest state is met. **Settings → Diagnostics → Events** lists them with their conditions (they can spoil
the story, so they are folded there).

**Map.** 320 places and 350 routes (km, or hours inside a settlement), with 31 markets that set what a
place sells and at what price. Story Director's atlas and Story Block's Map tab read them.

**Crafting, shops and meters.** 20 shops and 21 recipes with 2 crafts (the pack's alchemy rolls INT and DEX;
fieldcraft is DEX and works anywhere). Two NPC meter presets for NPC State Delta: **Frontier Regard**
(*Regard* and *Owed*) for locals, **Road Companion** (*Loyalty* and *Nerve*) for someone who travels with
you.

**The after-reply extractor (Assist).** Leave it **off** with a large model: it
follows the `<Changes>` instruction well enough, and the extractor costs a second call per reply. Turn it **on** for
a small local model if you see replies where something clearly changed (an item
picked up, coin paid, a place left) but no `<Changes>` lines came with it.

## 8. Updating or replacing the pack

* To get a later version of the pack, import the new file (same id `ersveil`: it replaces the old one
  in place and keeps its on/off switch), then start a new character timeline. A chat that already began keeps the version
  it was pinned to.
* The old **Ersveil: Bluewatch Starter** 1.6.0 file is no longer in `examples/`. It lives on in Story Block's
  tests (`tests/v2/packs/fixtures/ersveil-bluewatch-1.6.0.json`). You only need it to start a new chat on that
  version, which this page does not cover.
* Changing values in the pack: keep this page, `tests/v2/packs/ersveil-pack.test.js` and the pack's
  version in step ([PACKS.md](PACKS.md) has the value guide for pack makers).

## 9. Pack format additions (for pack makers)

The pack uses content kinds that were added for it. [PACKS.md](PACKS.md) describes the format.

| Kind | Fields |
|---|---|
| `places` | `{ name, slug?, aliases?, region?, kind?, layer?, x, y, market?, note? }`: `x`, `y` are numbers (map units; Ersveil: x east, y north, 1 unit = 10 km); `layer` is a plane such as `underground` ('' on the surface). |
| `routes` | `{ from, to, kind, km?, hours?, corridor?, slug?, note? }`: `from` and `to` name places of the same pack (by name, alias or slug) and are kept as their names; `km` and `hours` are numbers above 0. The id is made from from, to and kind unless a `slug` is given. |
| `skills` | RPG Battle skill templates `{ name, slug?, type?, stat?, target?, element?, note?, tags? }`: type `physical`, `magic`, `heal`, `buff` or `debuff`; target `one`, `all`, `self`, `ally` or `allies`. No numbers: RPG Battle's rules set them. |
| `presets` | Ready-made characters `{ id?, name, note?, race?, talents?, points?, skills? }`. This pack has none. |
| top-level `calendar` | `{ era?, months: [{ name, days }], start?: { year, month, day, hour?, minute? } }`: `start.month` is a name or a number (1 = the first month) and is kept as the name. Problems are `BAD_CALENDAR`. |

Queries: `packs.content({ kind: 'places' | 'routes' | 'skills' | 'presets' })` like every kind, and
`packs.calendar` → `{ pack, era, months, start }` from the first enabled pack with a calendar, or
null. A pack without these kinds normalizes exactly as before.
