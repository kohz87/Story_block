# Story Suite v2: pack format (pack.json)

A **pack** adds ready-made content to Story Suite: items with their numbers, creatures, shops,
crafting recipes and crafts, events, quests, races, talents, skills and ready-made characters for character
creation, places and routes for the map, terms for levels and XP, a ladder of quest ranks, ready-made NPC
meter sets, a calendar
for the story clock, a start state for new chats, a currency name, screens, layouts and a theme. A pack is one
JSON file of plain data. Nothing in a pack runs as code. This page is the reference for people who
make packs; the contract behind it is [SPEC.md §9 and §13](SPEC.md) and [MODULES.md §E and §F](MODULES.md).

A complete small example is [`examples/packs/riverside-starter/pack.json`](../../examples/packs/riverside-starter/pack.json);
a large one, with a map, a calendar, skills and a ready-made character, is the Ersveil starter pack
[`examples/packs/ersveil-bluewatch/pack.json`](../../examples/packs/ersveil-bluewatch/pack.json) ([ERSVEIL.md](ERSVEIL.md)).

## Installing

* **From a file**: Story Suite settings → **Packs** → **Import pack file**.
* **From a character card**: put the pack JSON in a lorebook entry of the card and add
  `[storysuite:pack]` to the entry's title (the *Title/Memo* field), for example
  `Riverside [storysuite:pack]`. The JSON can be wrapped in a ```` ```json ```` fence. **Disable the
  entry** (or give it no keys) so SillyTavern never puts the JSON into a prompt; Story Suite reads
  disabled entries too. The reader then clicks **Read from character lorebook** in the Packs
  section. Nothing from a card is installed without that click. Story Suite reads the lorebook
  linked to the card, or the one embedded in the card if it was never imported.

Installed packs are a library shared by every chat (`extension_settings.storySuite.packs`). Each can
be switched off or removed. Installing a pack with an id that is already installed replaces it in
place (an update) and keeps its on/off switch.

What a pack gives a chat is copied into that chat when used: an item's definition when the story
first names it, and the start state when the chat begins. Switching a pack off later doesn't change
a story already told.

## The file

```json
{
  "id": "riverside-starter",
  "version": "1.0.0",
  "name": "Riverside Starter",
  "author": "You",
  "description": "A small river village to begin in.",
  "requires": { "storyBlock": "^2", "capabilities": ["inventory", "scene"] },
  "currency": { "name": "pennies", "short": "p" },
  "economy": { "scale": 1 },
  "calendar": { "era": "CY", "months": [{ "name": "Dawnwane", "days": 30 }], "start": { "year": 611, "month": "Dawnwane", "day": 1 } },
  "content": { "items": [], "creatures": [], "shops": [], "recipes": [], "events": [], "quests": [],
               "races": [], "talents": [], "skills": [], "presets": [], "places": [], "routes": [],
               "terms": [], "ranks": [], "crafts": [], "meterPresets": [], "markets": [], "rules": [] },
  "start": { "scene": { … }, "inventory": { … } },
  "screens": [],
  "layouts": [],
  "theme": {}
}
```

| Field | Required | Rules |
|---|---|---|
| `id` | yes | 1–40 lowercase letters, digits or dashes, starting with a letter or digit. Unique among installed packs. |
| `version` | yes | Semantic version, like `1.0.0` or `1.1.0-beta.1`. |
| `name`, `author` | no | Text, at most 80 characters. `name` defaults to the id. |
| `description` | no | Text. |
| `requires.storyBlock` | yes | A version range: `^2`, `~2.1`, `2.x`, `>=2.0.0 <3`, `^1 \|\| ^2`. Story Block's alpha versions count as their release (2.0.0-alpha.3 counts as 2.0.0). |
| `requires.capabilities` | no | Names the pack needs, like `inventory`, `scene`, `party`, `combat`, `director`: a module id or a state area a module owns. If Story Block knows a name is missing, the pack is refused at install. If a module is switched off later, the list shows what is missing. |
| `currency` | no | `{ "name": "mark", "plural": "marks", "short": "mk" }`: a suggested name for the chat's one currency (MODULES §F1). `name` (the singular, "1 mark") can be up to 24 characters, the optional `plural` ("44 marks"; left out: the name with an s, and gold stays gold) up to 24, `short` up to 8. It is used only when the reader hasn't named the currency; the first enabled pack that suggests one counts, and its plural and short form go with it. Optional `coins` (MODULES §F108): see [Coins](#coins). |
| `economy` | no | `{ "scale": 100, "note": "One coin is a copper: a hundred to a gold piece." }`: the pack's money scale (below, MODULES §F104). Problems are `BAD_ECONOMY`. |
| `calendar` | no | The story clock's calendar (below). Problems are `BAD_CALENDAR`. |
| `weather` | no | Weather by season and region (below), read by Story Director's weather by rule. Problems are `BAD_WEATHER`. |
| `content` | no | Lists of records by kind (below). No other kinds. |
| `start` | no | The start state (below). |
| `screens` | no | Screens the pack adds, or restyles by id (below). |
| `layouts` | no | A list of layout objects for the layouts renderer (MODULES §E *layouts*). They are checked here as safe plain data only. |
| `theme` | no | CSS custom properties (SPEC §13.3): `{ "--ss-accent": "#3f7f8f" }`. Names start with `--`; values are plain CSS values. |

Any other top-level field is refused, so a misspelled field doesn't get silently ignored.

## IDs and references

Every content record gets an ID `pack.<pack id>/<slug>`, for example
`pack.riverside-starter/willow-rod`. The slug is the record's `slug` field if given, otherwise made
from its name ("Iron Sword (old)" → `iron-sword-old`). Events use their `id` field as the slug. Two
records of the same kind can't share a slug.

Inside a pack, an item is referred to (in shop stock, recipes, the start) by its **slug** or its
**name** or alias from the same pack, or by a full def ID: `pack.other-pack/iron-sword` or
`story/rope`. References are stored as full IDs.

## Content kinds

### items

These are inventory definitions (SPEC §7). Only these fields are allowed:

| Field | Default | Rules |
|---|---|---|
| `name` | required | 1–80 characters. |
| `slug` | from name | Lowercase letters, digits, dashes. |
| `aliases` | `[]` | Other names the story may use ("trout" for "Moonveil Trout"). |
| `kind` | `goods` | `goods`, `material`, `consumable`, `equipment`, `quest`, `money`. |
| `rarity` | `common` | `common`, `uncommon`, `rare`, `epic`, `legendary`. |
| `value` | `0` | Whole number ≥ 0 of the chat's one currency. |
| `stack` | `true` (`false` for equipment) | `false` keeps each piece as its own stack. Equipment never stacks. |
| `slot` | `null` | A short slot name (`weapon`, `tool` …) for equipment. |
| `stats` | `{}` | Names to whole numbers: `{ "STR": 2 }`. |
| `effect` | `{}` | An object, like `{ "heal": 20 }` (RPG Battle reads it). |
| `tags` | `[]` | Short words (`fish`, `fire`). |
| `note` | `""` | At most 500 characters. |
| `carry` | none | Whole number 1–1000: the carry capacity the item adds (see below). |

**Carry capacity.** An item with `carry` adds that much to what someone can carry while it is owned: a
member's own thing raises that member's capacity, a thing in the shared bag (a cart, a barge's hold) the
party's; equipment (a spatial ring, a harness) counts only while it is worn. RPG Battle's carry limit
(`items.carry`) adds it, and Story Block's Equip on… and loot checks ask the same query. Losing the item
lowers the capacity again: the party is then encumbered, and nothing is dropped. Only the pack sets it: a
story-made thing never has `carry`, whatever its note says (`+ item Bag of Holding | note: carry +500` is a
plain bag), and only a `pack.` def keeps it. The reader can name items that add capacity in RPG Battle's
settings (Items: *Items that add carry capacity*). Inventory shows "+80 carry" on such a thing.

```json
{ "name": "Pack Mule", "kind": "goods", "stack": false, "value": 800, "carry": 80 },
{ "name": "Spatial Ring", "kind": "equipment", "slot": "accessory", "rarity": "rare", "value": 5000, "carry": 100 }
```

**When the story names an item**, Story Block looks it up in this order:
1. an item the chat already has (by name or alias);
2. the enabled packs, in list order: first a full ID (`pack.x/slug`), then a name or alias match
   (case-insensitive), then a slug match ("Willow-Rod" → `willow-rod`); the pack higher in the list
   wins when two packs define the same name;
3. otherwise a new story item `story/<slug>` with default numbers.

### creatures, quests

These are free-form records for RPG Battle's bestiary and Story Director's quests: a `name`
(required), an optional `slug`, and any other plain fields those modules read (see their docs).

### races, talents

These are choices for the character creation wizard. Every chat creates its character before the story
starts (MODULES §F12). Only these fields are allowed:
`{ "id"?, "name", "note"?, "stats"?: { "DEX": 2, "VIT": -1 }, "tags"?: ["fey"] }`. `id` is a slug
(from the name if left out), `note` is at most 500 characters, `stats` are whole numbers (they can
be negative).

### skills

RPG Battle skill templates the creation wizard and ready-made characters can offer:
`{ "name", "slug"?, "type"?, "stat"?, "target"?, "element"?, "note"?, "tags"? }`.

| Field | Rules |
|---|---|
| `type` | `physical` (default), `magic`, `heal`, `buff` or `debuff`. |
| `stat` | A stat name in capitals (`DEX`, `INT`), or left out. |
| `target` | `one` (default), `all`, `self`, `ally` or `allies`. |
| `element` | One short lowercase word (`fire`), or left out. |
| `note`, `tags` | `note` at most 500 characters; `tags` a list of short words. |

No numbers: RPG Battle's rules set a skill's cost and power.

### presets (ready-made characters)

`{ "id"?, "name", "note"?, "race"?, "talents"?, "points"?, "skills"? }`: a character the creation
wizard can pre-fill. `race`, `talents` and `skills` name this pack's records (by id, slug, name or full
id) and
are kept as full ids; `points` are the stat points spent on top of the race and talents
(`{ "DEX": 3 }`, whole numbers ≥ 0). The name and background still come from the reader's persona
(MODULES §F22); a preset fills in race, talents, stats and skills only.

### places, routes

The map Story Director's atlas reads.

| Kind | Fields |
|---|---|
| `places` | `{ name, slug?, aliases?, region?, kind?, layer?, x, y, note?, hidden?, market?, tags? }`: `x`, `y` are numbers (map units; Ersveil: x east, y north, 1 unit = 10 km); `layer` is a plane such as `underground` ('' on the surface). `hidden: true` (or its alias `secret: true`) keeps the place off Story Director's map, and out of its search, until the story goes there; the record keeps `hidden: true` either way. `market` is its settlement type and `tags` its environment tags (at most 8), lowercase words, for its prices (see markets). |
| `routes` | `{ from, to, kind, km?, hours?, corridor?, slug?, note? }`: `from` and `to` name places of the same pack (by name, alias or slug) and are kept as their names; `km` and `hours` are numbers above 0. The id is made from from, to and kind unless a `slug` is given. A route joins two different places. |

### shops

`{ "name", "slug"?, "kind"?, "place"?, "stock": [ … ] }`, plus any other plain fields. Each
`stock` entry is an item reference, or `{ "item": ref, "qty"?: ≥1, "price"?: ≥0 }`.

### recipes

`{ "name", "slug"?, "makes": ref, "qty"?: ≥1 (default 1), "materials": [{ "item": ref, "qty"?: ≥1 }],
"fee"?: ≥0, "minutes"?: ≥0 }`, plus the crafting fields below and any other plain fields. `materials`
can't be empty.

```json
{ "name": "Minor Healing Draught", "makes": "Minor Healing Draught",
  "materials": [{ "item": "Bluecap Moss", "qty": 3 }, { "item": "Cleansing Spirits" }], "minutes": 120,
  "craft": "alchemy", "dc": 16, "station": "alchemy-table", "teaches": "the lay sealer at the Salt-and-Ash Yard" }
```

The crafting fields (MODULES §F102) are all optional and kept only when given. RPG Battle's crafting
reads them; its code sets every chance and every result, and the story only says what a character tries.

| Field | Rules |
|---|---|
| `craft` | The craft it is: `smithing`, `alchemy`, `leather`, `cooking`, `enchanting`, or a craft this pack declares in `crafts`. Any other craft is `UNKNOWN_REF`. |
| `dc` | How hard the check is: a whole number from 5 to 40. Left out, crafting sets it from what the recipe makes. |
| `station` | Where it is made: `forge`, `alchemy-table`, `campfire`, `inn`, `workbench`, or any other slug (`salt-yard`). Left out, the craft's stations count. |
| `minutes` | How long it takes (whole minutes ≥ 0), as before. |
| `stat` | The stats the check rolls with, overriding the craft's: 1 to 3 stat names joined by `+` (`STR+DEX`, `INT`), no stat twice. |
| `known` | `true`: every character knows it from the start (a basic recipe). Left out or `false`: it has to be learned. |
| `teaches` | Who teaches it, as text of 1 to 120 characters (`Hollis at the Gate Forge`). |

### crafts

The craft table says which stats a craft's check rolls with and where it can be worked. These are the
defaults:

| Craft | Stats | Stations |
|---|---|---|
| `smithing` | STR+DEX | forge |
| `alchemy` | INT | alchemy-table |
| `leather` | DEX | workbench, campfire, inn |
| `cooking` | VIT | campfire, inn |
| `enchanting` | INT+LUK | workbench, alchemy-table |

A pack's `crafts` adds crafts or changes one: `{ "id", "title", "stats", "stations"?, "note"? }`.

```json
"crafts": [{ "id": "alchemy", "title": "Alchemy", "stats": ["INT", "DEX"], "stations": ["alchemy-table"] },
           { "id": "fieldcraft", "title": "Fieldcraft", "stats": ["DEX"] }]
```

| Field | Rules |
|---|---|
| `id` | Required slug: the craft as recipes write it. A default's id (`alchemy`) replaces that craft. |
| `title` | Required, 1–30 characters, no `\|`, `:`, `#`, `<`, `>` or line break. |
| `stats` | Required: 1 to 3 different stat names (`["INT", "DEX"]`). |
| `stations` | Up to 8 different station slugs. Left out or `[]`: the craft can be worked anywhere. |
| `note` | At most 200 characters. |

Only these fields are allowed, and a pack holds at most 12 crafts. A recipe in the same pack can name a
craft the pack declares. Query `packs.crafts` gives the whole table, with the enabled packs' crafts laid over the
defaults (the pack higher in the list wins when two declare the same craft).

### events

```json
{ "id": "rat-trouble", "after": "market-day", "when": "query('scene.place').name == 'Bluewatch Village'",
  "cue": "Hollis grumbles that weir rats have been at his nets again.", "once": true,
  "then": [{ "command": "wallet.receive", "payload": { "owner": "party", "amount": 5 } }] }
```

| Field | Rules |
|---|---|
| `id` | Required slug, unique in the pack. |
| `when` | The condition, 1–500 characters, in the events condition language (MODULES §E *events*). |
| `cue` | What the next reply is told when the event fires, 1–500 characters. |
| `once` | `true` (default) or `false`. |
| `after` | Optional id of another event in this pack that has to fire first. That event must be a `once` event (a repeating one never counts as having happened). Loops are refused. |
| `then` | Up to 8 `{ "command": "module.action", "payload": { … } }` steps run as commands. |

Only these fields are allowed. Whether a command exists, and what its payload means, is checked
when the event runs.

### terms, ranks

The words a world uses for levels and XP (MODULES §F25), suggested the way a pack suggests a currency:
RPG Battle reads them, and the reader's own terms in its settings win, field by field.

```json
"terms": [{ "name": "Soul Class", "levelName": "Soul Class", "xpName": "Soul Growth", "tiers": { "size": 10, "numerals": "roman" } }]
```

| Field | Rules |
|---|---|
| `id`, `name` | Optional. The slug comes from `id`, else the name, else `terms` (`terms-2` …). |
| `levelName` | The level word ("Level"), 1–30 characters. |
| `xpName` | The XP word ("XP"), 1–30 characters. |
| `tiers` | `true` (tiers of 10 levels, Roman numerals), or `{ "size"?: 1–999, "numerals"?: "roman" \| "arabic", "enabled"?: false }`: levels grouped into titled tiers ("Soul Class III" for levels 21–30). |

A record names at least one of `levelName`, `xpName`, `tiers`; only these fields are allowed. A term is a
label in RPG Battle's blocks, so it can't hold `|`, `:`, `#`, `<`, `>` or a line break. A pack holds at
most 4 records; RPG Battle takes the first enabled pack's first record (`packs.content({ kind: 'terms' })`).

`ranks` is a ladder of quest ranks, **lowest first**, that Story Director reads for `quest.ranks` and RPG
Battle for foe strength:

```json
"ranks": [{ "id": "F", "title": "Registered", "levels": [1, 10], "reward": [50, 400] }, { "id": "E", "title": "Journeyman" }]
```

| Field | Rules |
|---|---|
| `id` | Required: the rank as the story writes it, 1–8 letters, digits, `+` or `-` (`F`, `SS`, `EG1`). Kept as written; unique in the pack, ignoring case. |
| `title` | Optional, 1–30 characters, the same rules as a term. |
| `levels` | Optional `[lowest, highest]`: whole levels from 1 to 999, the first not above the second. |
| `reward` | Optional `[lowest, highest]`: whole amounts ≥ 0 of the chat's one currency (its smallest unit). |

Only these fields are allowed, and a pack holds at most 12 ranks. Ranges may overlap, but a rank's
`levels` or `reward` can't start below the last rank before it that has one. `packs.content({ kind:
'ranks' })` lists every enabled pack's ladder one after another, each record with its `pack`, so a reader
takes one pack's ranks (the first that has any).

**The reader's ladder.** Story Block's settings have a **Rank ladder** under Terms: one rank a line,
lowest first ("Soul Class I" … "Soul Class IX", or `F`, `E` … `SSS`), optionally with the first level of
each ("Soul Class II: 11"). When it is set, `packs.content({ kind: 'ranks' })` answers with it instead of the
packs' ladders, so Story Director's quest ranks, RPG Battle's party and foe ranks and Story Block's coin
budget all use it, with or without each other. Its records are `{ id, title, levels?, reward?, pack: null,
reader: true }`: the title as typed, the id the short word the story writes (the line itself when it is one
short word, else its last word, "IX"; else R1, R2 …). A rank keeps the first enabled pack's levels at its
place (unless every line gives its first level), and pays the reward range of the pack's rank at its first
level (the last pack rank that starts at or below it), so renaming a ladder never changes what quests pay
and a longer ladder of narrower ranks never pays more at a level (a ladder renames and re-bands; it never
raises money). Past the pack's ranks, modules pay by level too (RPG Battle on the built-in F to S, times
the money scale). RPG Battle's Rank ladder hands each line with the first level it bands it at, so every
module reads the same bands.
Empty: the pack's ladder, then each module's built-in F to S. `packs.content({ kind: 'ranks', pack })` is
always that pack's own.

### markets

What sets a place's prices, read by RPG Battle's trade over its built-in factors. Two kinds of record:

```json
"markets": [
  { "type": "lock-town", "buy": 1.05, "sell": 0.95, "stock": [4, 6], "note": "toll towns on the river" },
  { "tag": "coastal", "prices": { "fish": 0.7, "salt": 0.9 } }
]
```

| Field | Rules |
|---|---|
| `type` | A settlement type, a lowercase word (`hamlet`, `village`, `town`, `city`, `capital`, `outpost`, `camp`, or the pack's own like `lock-town`). Defines a new one or overrides the built-in one. |
| `buy`, `sell` | A type's factors, 0.25–4 (1 = as usual): what things cost there, and what is paid for the party's. |
| `stock` | A type's `[least, most]` things one trader has, 1–20. |
| `tag` | An environment tag, a lowercase word (`coastal`, `river`, `port`, `mountain`, `mining`, `forest`, `desert`, `farmland`, `frontier`, `swamp`, or the pack's own). |
| `prices` | A tag's factor per item category, 0.25–4, at most 20: `fish`, `grain`, `ore`, `metal`, `timber`, `herbs`, `salt`, `cloth`, `gems`, or `all` for every thing. |
| `note` | Optional, at most 200 characters. |

A record is a type or a tag, never both; one of each name per pack, and the first enabled pack's wins.
A place gets its type and tags from its `market` and `tags` (places), or from a lorebook entry. RPG Battle
holds a place's tags together to ±30 % for any one category. Where nothing names a place's market, every
factor is 1.

**A lorebook entry's market line.** A World Info entry of the open character's lorebook can say what kind
of market its place is with one plain line in its content:

```
market: town; coastal, port
market: village; river; buy 0.9, sell 0.85
```

the settlement type, then its environment tags (comma separated, may be left out), then optionally the
place's own buy and sell factors (0.25–4). The place is the entry's title (Title/Memo), else its first key;
its other keys are other names for it. The entry stays an ordinary lorebook entry. Story Block reads the
lines when a chat opens and when **Read from character lorebook** is pressed in the Packs fold, never from
the story. For a place the lorebook names, its line comes first, then the pack's `market`/`tags`, then the
scene's place kind, then the built-in defaults. `packs.markets` gives modules all of it.

### meterPresets

Ready-made NPC meter sets for NPC State Delta (MODULES §F81, §F90). Each one has a few meters, the
words for stretches of each meter, an optional drift, and stages reached when the meters get there. The
reader picks a preset in NPC State Delta; a pack only offers them.

```json
"meterPresets": [{
  "id": "road-companion", "title": "Road Companion",
  "meters": [
    { "id": "loyalty", "name": "Loyalty", "min": -100, "max": 100, "start": 0,
      "describe": "Whether they stay when staying costs them.",
      "bands": [{ "at": -100, "word": "ready to leave" }, { "at": -30, "word": "doubtful" }, { "at": 10, "word": "with you" }] },
    { "id": "nerve", "name": "Nerve", "min": 0, "max": 100, "start": 50, "drift": { "toward": 50, "perDay": 5 } }
  ],
  "stages": [{ "id": "shield-mate", "name": "Shield-mate", "needs": [{ "meter": "loyalty", "at": 60 }, { "meter": "nerve", "at": 40 }],
               "milestone": "They would hold the line beside you." }]
}]
```

| Field | Rules |
|---|---|
| `id` | Required slug, unique in the pack. |
| `title` | Required, 1–40 characters, no `\|`, `:`, `#`, `<`, `>` or line break. |
| `meters` | Required, 1 to 6 meters (NPC State Delta's own cap): see below. |
| `stages` | Optional, at most 8: see below. |

A meter is `{ "id", "name", "min", "max", "start", "describe"?, "bands"?, "drift"? }`:

* `id`: a slug of at most 40 characters, unique in the preset, and not one of the words NPC State Delta
  keeps for itself (`stage`, `stages`, `disposition`, `name`, `meter`, `meters`, `reason`, `why`, `because`,
  `note`, `cause`). The story changes it with `~ npc Name | regard: +5`; code clamps the change.
* `name`: 1–40 characters, the same rules as a term (it's a label in the story's blocks).
* `min`, `max`, `start`: whole numbers from -1000 to 1000, `min` below `max`, `start` between them.
* `describe`: what the meter measures, at most 200 characters.
* `bands`: 1 to 8 `{ "at", "word" }`, lowest first, each `at` inside the range and above the one before.
  A band's word holds from its `at` up to the next band's. Words are 1–24 characters, as a term.
* `drift`: `{ "toward", "perDay" }`: each story day the meter moves `perDay` (a whole number ≥ 1) closer
  to `toward` (a value inside the range).

A stage is `{ "id", "name", "needs": [{ "meter", "at" }], "milestone"? }`. It's reached when every need
is met. An `at` of 0 or more is met at or above it, and a negative `at` at or below it (NPC State Delta's
rule for its own stages). `needs` holds 1 to 4 different meters of the same preset, each `at` inside that
meter's range. `milestone` (1–200 characters) is what the story is told when the stage is first reached.
Code moves stages; the story can't set one.

Only these fields are allowed, and a pack holds at most 4 presets.

### rules (a rules pack)

`content.rules` holds **one** manifest: RPG Battle's rules for the pack (classes, skills with their branch graph,
item rules, trainers). The format is the rules pack schema 2 of the [contract](contract/RB_CONTRACT.md) §7, checked
by `src/v2/packs/rules-v2.js`; this page only says how Story Block's loader treats it.

* **Declare it.** A pack with `content.rules` must list `rb-rules-v2` in `requires.capabilities`. Story Block 2 has
  that capability itself (`HOST_CAPABILITIES`), so a pack that needs a host without it is refused with
  `MISSING_CAPABILITY` once the host knows its capabilities (and checked for form only while it does not). An older
  Story Block does not know the kind and refuses the pack with `UNKNOWN_KIND`.
* **Opt-in.** Only a pack with the manifest meets the checker. Without it, `creatures` and `quests` stay free-form
  records (see above) and nothing about them changes. With it, the checker owns the schema-2 shapes of `creatures`
  (foes), `quests`, `shops` and `recipes`: closed records (a legacy `moves`, `template`, `difficulty`, `detail` and the
  like are refused, never dropped), every reference resolved inside the pack (a skill, an item, a place, a foe), and the
  branch graph (24 written and 12 generated forms per advanced class) complete. Refusals keep the checker's own
  codes and paths (`bad-ref`, `branch-graph`, `numeric-only-branch`, `envelope-unknown`, `numeric-range` …; the list
  is `RULES_V2_ERROR_CODES`). Items and the old-format `content.skills` keep their strict old checks; a v2 skill lives
  inside the manifest. A recipe's `craft` must still be a default craft or one of the pack's `crafts`.
* **Stored form.** The manifest becomes a record like any other, `pack.<id>/rules` with `slug` and `pack`; the host's
  `id`, `slug` and `pack` sit beside the manifest, not in it. Nested slugs are written as full IDs (`pack.<id>/<slug>`);
  creatures, quests, shops and recipes are kept as the checker resolved them (references as full IDs, a recipe's
  `known` filled in). The raw pack is what stays in settings. `validatePack` also returns `rulesHash` and `packHash`.
  `currency` may carry `display` (`mixed` or `base`, default `mixed`) and an empty `coins` list in a rules pack; it is
  stored with `display`.
* **Order and codes.** Story Block checks the envelope and the records it owns first, with the host's real version and
  limits; the checker then takes the manifest and what it owns, and is not asked to repeat the envelope pass
  (`validateRulesPack(pack, { hostVersion, limits, envelope })`; standalone it does everything). Unsafe text is
  `UNSAFE_HTML` from `validatePack` whoever found it (the checker alone says `unsafe-markup`).
* **Whose text rule.** The checker's extra text ban (`<` and `>`, also as a character reference, and control
  characters) covers only what the checker owns: the manifest and the creatures, quests, shops and recipes it
  validates. Everything Story Block validates itself (the envelope with `requires.storyBlock` and the description,
  items, places, events with their `when` conditions, screens with `template` and `css`, theme, layouts) keeps Story
  Block's own safety rules, exactly as in an ordinary pack: a version range `>=2.0.0 <3`, a condition `gold > 5` or a
  screen template with tags is fine, a `<script>` or an `onerror=` is not. A pack Story Block accepts as an ordinary pack
  is accepted with a valid manifest added. The checker alone (Studio) checks everything it reads, a little more
  strictly outside what it owns: a character reference standing for `<` or `>` and `<` in a field name are refused.
* **Reading it.** Query `packs.rules({ pack? })` → `[{ pack, version, id, name, manifest }]` for the enabled packs that
  have one (rules are never mixed across packs: the reader takes one); `packs.content({ kind: 'rules' })` gives the
  bare manifests; `packs.list` counts them (`counts.rules`) and tags the pack **Rules pack · RPG Battle**, also when
  it names Story Director too (its quests and places). The Packs list shows "1 rules set".

## Value guide

### Coins

A world that counts its money in coins of different worth names them in `currency.coins`, each worth a
whole number of the smallest:

```json
"currency": {
  "name": "penny", "plural": "pennies", "short": "p",
  "coins": [
    { "name": "penny", "plural": "pennies", "value": 1 },
    { "name": "silver", "value": 10 },
    { "name": "gold", "value": 100 }
  ]
}
```

* 1 to 8 coins; `name` up to 24 characters without digits, once each (names and plurals, ignoring case);
  `plural` optional (left out: a metal stays as it is, "15 copper"; "penny" → "pennies"; else an s);
  `value` a whole number from 1 to 1,000,000. Two coins may be worth the same ("copper" and "bronze": both
  are read, the first is shown). Give the smallest coin `value: 1`: it is the unit the wallet counts.
* Every number the pack writes (item `value`, shop `price`, rank `reward`, start money, event payouts) is
  in that smallest unit.
* The reader's own **Coins** setting beats the pack's coins, and a pack's coins are used only while its
  currency is (a reader who named their own currency gets no pack coins). Without coins, the one name: an
  amount the story writes in another coin word ("40 silver" where money is pennies) is refused, never read as
  that many of the chat's money (MODULES §F122).
* The model is told the coins in one static line; a money line may name one coin (`+ coin 3 silver` is 30)
  and code converts it before the reply's limits. Amounts show in mixed coins ("3 silver 5 pennies").
* Keep the pack's coins the ones your lorebook names: the model writes the coins the lore talks about.

### The money scale (`economy`)

The currency is only a name; the pack sets the economy. What a pack writes itself (its ranks' `reward`,
item `value`, shop `price`, start money, event payouts) is used exactly as written. The built-in defaults
that come from no pack are gold-scale: Story Block's story coin budget of 1000 × level (when no rank
reward applies), Story Director's default ranks, RPG Battle's default loot, coin and prices. A pack on another
scale says how many of its coins one of those defaults' coins is worth:

```json
"economy": { "scale": 100, "note": "One coin is a copper: a hundred to a gold piece." }
```

* `scale`: a number from 0.001 to 1000, default 1. Every built-in default money number is multiplied by
  it, rounded to a whole number, at least 1.
* `note`: what the scale means, at most 500 characters, for the reader.

The first enabled pack that has an `economy` sets it; scales aren't mixed. The reader can override it in
Story Block's settings (**Money scale**, 0 or blank: the pack's). Modules read the result with the query
`inventory.economy` → `{ scale, source: 'pack' | 'settings' | 'default' }`. Lorebooks carry flavour for the
model only, never numbers code uses. Ersveil sets `scale: 8`: it counts in copper, small coin, and its F jobs top
out at 400 copper where the built-in F rank tops out at 50. (A world counting in copper where the built-in
defaults are gold coins would say 100: a scale above 1 for a smaller coin, below 1 for a bigger one.)

### Rules for a pack's own numbers

Item values, shop prices, rewards and the start purse are all whole numbers of the chat's **one**
currency (MODULES §F1), so they have to be on one scale. Code compares them: RPG Battle sells and buys by
value, Story Director holds a reward inside its rank's range, and inventory caps how much a reply can
hand out by worth. An item that's worth fifty jobs breaks all three. Anchor the scale like this:

1. **Pick the smallest coin as 1.** Ersveil: copper is 1, silver 10, gold 100 (its `currency.coins`).
2. **Everyday goods and gear keep the world's prices.** Bread, a meal, a bunk, rope, a spear and a
   gambeson cost what the lore says in that coin. A day's unskilled wage should buy food and a bunk.
3. **Rank rewards set the play scale.** Give `ranks` a `reward` range. The lowest rank's jobs should
   pay a few days' wages: Ersveil's F jobs pay 50–400 copper.
4. **Consumables a fight uses are a fraction of a job.** A basic healing draught, salve or antidote
   costs no more than the lowest reward of the lowest rank, and at most a quarter of its highest
   (Ersveil: a minor healing draught is 30 copper, and 45 at the frontier). Stronger ones scale with the rank
   where they're needed: a fraction of that rank's lowest reward. If the world's own price list is far
   above that, as Ersveil's potions are (10–30 gold), use the play scale and say so in the pack's notes.
5. **Gear costs one to three jobs of its rank.** A starter weapon or armour piece is worth about one to
   three F jobs; gear for rank C about one to three C jobs.
6. **Loot sells for part of its value.** Materials keep the world's lot prices; shops buy at about half.
7. **Shops ask the value or more.** A `price` is the value, or a markup on it (Ersveil's frontier asks
   half again for imported goods), never less and at most about three times.
8. **Crafting doesn't mint money.** A recipe's output is worth at most about twice its materials plus
   its fee.
9. **Event payouts are small.** An event's `wallet.receive` is a tip, not a job: at most the lowest
   rank's lowest reward.

The Ersveil pack's tests (`tests/v2/packs/ersveil-values.test.js`) check its own numbers against these
rules, and are a model for a pack's own checks.

## Calendar

```json
"calendar": {
  "era": "CY",
  "months": [{ "name": "Dawnwane", "days": 30 }, { "name": "Goldwane", "days": 30 }],
  "start": { "year": 611, "month": "Goldwane", "day": 12, "hour": 6, "minute": 40 },
  "holidays": [{ "name": "Lantern Night", "month": "Goldwane", "day": 2 }]
}
```

`{ era?, months: [{ name, days }], start?: { year, month, day, hour?, minute? }, holidays?: [{ name, month, day }] }`:

* `era`: text of at most 24 characters (`CY`).
* `months`: 1 to 60 months in order, each `{ "name", "days" }` with a name of at most 40 characters (no
  two the same) and 1 to 400 days.
* `start`: when a new story begins. `start.month` is a month's name or its number (1 = the first month)
  and is kept as the name; `day` fits that month; `hour` 0–23 and `minute` 0–59 default to 0.
* `holidays`: at most 60 named days that come back every year, each `{ "name", "month", "day" }` and nothing
  else. `month` is a month's name (any case) or its number and is kept as the name; `day` fits that month.
  The name is kept on one line, invisible and control characters taken out, cut to 60 characters; a name
  that leaves nothing is refused. A calendar without holidays (or with an empty list) has no `holidays`.
  Story Director's World screen lists those coming within its Upcoming range while the chat runs on this
  pack's calendar. (The Ersveil pack names none: its lore gives seasons and festivals but no dated holidays.)

Any problem here is reported as `BAD_CALENDAR` and the pack is refused. Story Director reads the first
enabled pack's calendar (query `packs.calendar`) for its clock.

## Weather

```json
"weather": {
  "seasons": [{ "name": "winter", "months": ["Frostfall", "Deepwinter", "Icewane"] },
              { "name": "summer", "months": ["Highsun", "Goldwane", "Haywane"] }],
  "tables": [{ "season": "winter", "region": "Shornmarch", "weather": ["hard frost, clear sky", "snow on the wind"] },
             { "season": "winter", "weather": ["sleet and grey cloud", "cold, still and clear"] },
             { "weather": ["mild and overcast"] }]
}
```

`{ seasons?, tables }` (MODULES §F122): the weather Story Director sets each story day (Status card, Scene,
the tail's Place line) when the story writes none.

* `seasons`: at most 12 `{ "name", "months" }`, the name at most 24 characters, `months` 1 to 60 of the
  calendar's month names (a month in one season only). Left out: the year is split into winter, spring, summer
  and autumn by where a month falls (the last and first twelfth of the year are winter's middle).
* `tables`: 1 to 120 `{ "season"?, "region"?, "weather": [ … ] }`, each `weather` 1 to 24 texts of at most 60
  characters ("cold drizzle, low fog"). Story Director takes the table for the season and the scene's region
  (the region's name, any case; a region containing it counts), else the season's table without a region,
  else the region's without a season, else one with neither, else its own temperate table.
* Nothing in it is a number or a rule: weather is descriptive only.

Read with the query `packs.weather` → `{ pack, seasons, tables }` from the first enabled pack with one, or
`null`. Any problem is reported as `BAD_WEATHER` and the pack is refused.

## Start state

When a new chat begins, the enabled packs' start states are merged into the initial state:

```json
"start": {
  "scene": { "place": { "name": "Bluewatch Village", "kind": "settlement", "region": "the Lowmere" },
             "present": ["Hollis"] },
  "inventory": { "items": ["willow-rod", { "item": "Hemp Line", "qty": 3, "note": "spare" }],
                 "money": 50 }
}
```

* `scene.place`: `name` (required), `kind`, `region`. The first enabled pack with a place sets it.
* `scene.present`: names. Every name is listed once across packs.
* `inventory.items`: references to items **defined by a pack** (not `story/…`), with `qty` ≥ 1 and an
  optional `note`. They go to the party. The same item with the same note adds up across packs. An
  item that doesn't stack gets one stack per piece.
* `inventory.money`: a whole number of the chat's one currency, like item values. It goes into the
  party's wallet. Amounts from several packs add up.

## Screens

A pack can add screens or restyle a module's screen by giving its id (SPEC §13; the reader's own
choice and the card's come first). Fields:

| Field | Rules |
|---|---|
| `id` | A module's screen id to restyle (`rpg-battle/party`), or the pack's own (`riverside-board`). Unique in the pack. |
| `title`, `icon` | Text, at most 80 characters (`icon` is a Font Awesome name like `fa-users`). |
| `mounts` | Any of `tab`, `screen`, `card`, `hud`, `dialog`. |
| `template` | The HTML template (SPEC §13.2), up to 64 KB. Either it or `layout` is required. |
| `layout` | A layout tree `{ "root": … }` instead of a template. |
| `css` | Up to 64 KB. `url()` only to `https:` or image data; no `@import`, `expression()`, `behavior`, `-moz-binding`, `<` or backslashes. |
| `theme` | CSS custom properties, as the pack's `theme`. |
| `data` | Named queries: `{ "pc": { "query": "party.pc" } }`. |
| `steps` | Dialog wizard steps: `[{ "id", "title", "template" }]`. |

Templates follow the same safety rules as all pack text (below). Story Block sanitises them again
when it renders them.

## Safety rules

A pack is untrusted data. It is refused if anywhere in it (values and field names):

* something is not plain JSON data: a function, a class instance, a getter, `undefined`, NaN or
  Infinity, or an object that contains itself;
* a field is named `__proto__`, `constructor` or `prototype`;
* text contains a tag that can run code or load a page (`<script`, `<iframe`, `<frame`, `<object`,
  `<embed`, `<applet`, `<link`, `<meta`, `<base`, `<style`), a form with an `action`, an event
  attribute inside a tag (`<img onerror=…>`), or a script link (`javascript:`, `vbscript:`,
  `data:text/html`, `data:image/svg`), also when hidden with entities or spaces. Inline SVG and
  plain form fields are allowed;
* a `src`, `href`, `url`, `image`, `img` or `background` field is anything other than an `https:` link
  or a PNG, JPEG, GIF or WebP `data:` URL;
* a theme value contains `url(`, `expression(`, `@import`, `<`, `>`, braces, `;` or `\`.

Plain text may still contain `<` and `>` (conditions compare with them, and `<b>` is shown as text).
Story Suite shows every pack string as text and never as HTML.

## Limits

| What | Limit |
|---|---|
| One pack | 512 KB |
| All installed packs | 2 MB, at most 32 packs |
| Nesting | 16 levels |
| One list (records of a kind included) | 1000 entries |
| One object | 200 fields |
| One text | 4000 characters (field names 80); a screen's `template` or `css` 64 KB |

## Error codes

The importer lists up to 20 problems per pack, each in plain words with where it was found.

| Code | Meaning |
|---|---|
| `NOT_JSON`, `NOT_OBJECT`, `TOO_LARGE` | Not one JSON object of an allowed size. |
| `NOT_PLAIN`, `UNSAFE_KEY`, `UNSAFE_HTML`, `UNSAFE_URL` | Breaks the safety rules. |
| `TOO_DEEP`, `TOO_LONG`, `TOO_MANY` | Over a limit. |
| `UNKNOWN_FIELD`, `UNKNOWN_KIND` | A field or content kind that doesn't exist. |
| `BAD_ID`, `BAD_VERSION`, `BAD_FIELD`, `BAD_CURRENCY` | Top-level fields. |
| `BAD_REQUIRES`, `HOST_VERSION`, `MISSING_CAPABILITY` | `requires`. |
| `BAD_CONTENT`, `BAD_RECORD`, `DUPLICATE`, `UNKNOWN_REF` | Content records and references. |
| `BAD_START`, `BAD_SCREENS`, `BAD_LAYOUTS`, `BAD_THEME` | `start`, `screens`, `layouts`, `theme`. |
| `BAD_CALENDAR` | `calendar`. |
| `BAD_ECONOMY` | `economy`. |
| `bad-ref`, `branch-graph`, `tier-chain`, `numeric-range` … | A pack with `content.rules`: the rules checker's own codes (see rules). |

`content.crafts`, `content.meterPresets` and a recipe's crafting fields use the content codes
(`BAD_CONTENT`, `BAD_RECORD`, `DUPLICATE`, `UNKNOWN_FIELD`, `UNKNOWN_REF`).

## For module authors

The packs part (`src/v2/packs/index.js`) offers these through Story Block's core module:

* query `packs.list` → the installed packs: `{ id, version, name, author, description, enabled,
  source, origin, counts, hasStart, missing, problem }[]`;
* query `packs.content({ kind, pack? })` → a flat list of records of a content kind from the enabled
  packs, each with `id` (`pack.<pack>/<slug>`), `slug` and `pack`. Events come as
  `{ id, pack, slug, when, cue, once, after, then }` with `after` as a full id. Also
  `kind: 'screens'`, `'layouts'`, `'theme'` → `[{ pack, tokens }]` and `'currency'` → `[{ pack, name, short, plural? }]`;
  `kind: 'places' | 'routes' | 'skills' | 'presets' | 'terms' | 'ranks' | 'crafts' | 'meterPresets' | 'markets'` like every
  kind (a pack without them normalizes exactly as before). Recipes carry their crafting fields only when given.
  `kind: 'ranks'` is the reader's Rank ladder when it is set (records with `reader: true`, see "terms, ranks");
* query `packs.markets` → `{ types, tags, places }`: the enabled packs' `markets` types and tags (the first
  pack's per name) and the places with a market, the lorebook's `market:` lines first (`from: 'lorebook'`),
  then the packs' places with `market` or `tags` (`from: 'pack'`): `{ place, aliases, type, tags, buy?,
  sell?, from, pack? }`;
* query `packs.crafts` → the craft table: `[{ craft, title, stats, stations, note?, pack }]`, the default
  crafts (`pack: null`) with the enabled packs' crafts laid over them, then the packs' new crafts in pack
  order (also `craftsOf(packs)` and `DEFAULT_CRAFTS`, `STATIONS` from `src/v2/packs/index.js`);
* query `packs.calendar` → `{ pack, era, months, start, holidays? }` from the first enabled pack with a calendar,
  or `null`;
* query `packs.weather` → `{ pack, seasons, tables }` from the first enabled pack with a `weather` table, or
  `null` (see Weather);
* query `packs.economy` → `{ pack, scale, note }` from the first enabled pack with an `economy`, or `null`.
  Read the settled scale through Story Block's `inventory.economy` (it applies the reader's override);
* query `packs.rules({ pack? })` → `[{ pack, version, id, name, manifest }]` for the enabled packs with a rules
  manifest, in list order (see rules). `kind: 'rules'` of `packs.content` gives the bare manifests;
* query `packs.item({ name })` and hook `item.resolve(name)` → the pack item def (SPEC §7 fields)
  for a story name, or `null`;
* query `packs.start` and hook `start()` → the merged start: `{ scene: { place, present },
  inventory: { items: [{ def, aliases, qty, note }], money }, currency, packs, problems }`, and
  `applyStart(state, start, { id, coin })` to write it into an initial state.
