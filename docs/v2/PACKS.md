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
               "terms": [], "ranks": [], "crafts": [], "meterPresets": [] },
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
| `currency` | no | `{ "name": "mark", "plural": "marks", "short": "mk" }`: a suggested name for the chat's one currency (MODULES §F1). `name` (the singular, "1 mark") can be up to 24 characters, the optional `plural` ("44 marks"; left out: the name with an s, and gold stays gold) up to 24, `short` up to 8. It is used only when the reader hasn't named the currency; the first enabled pack that suggests one counts, and its plural and short form go with it. |
| `economy` | no | `{ "scale": 0.01, "note": "One coin is a copper." }`: the pack's money scale (below, MODULES §F104). Problems are `BAD_ECONOMY`. |
| `calendar` | no | The story clock's calendar (below). Problems are `BAD_CALENDAR`. |
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
| `places` | `{ name, slug?, aliases?, region?, kind?, layer?, x, y, note?, hidden? }`: `x`, `y` are numbers (map units; Ersveil: x east, y north, 1 unit = 10 km); `layer` is a plane such as `underground` ('' on the surface). `hidden: true` (or its alias `secret: true`) keeps the place off Story Director's map, and out of its search, until the story goes there; the record keeps `hidden: true` either way. |
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

## Value guide

### The money scale (`economy`)

The currency is only a name; the pack sets the economy. What a pack writes itself (its ranks' `reward`,
item `value`, shop `price`, start money, event payouts) is used exactly as written. The built-in defaults
that come from no pack are gold-scale: Story Block's story coin budget of 1000 × level (when no rank
reward applies), Story Director's default ranks, RPG Battle's default loot, coin and prices. A pack on another
scale says how many of its coins one of those defaults' coins is worth:

```json
"economy": { "scale": 0.01, "note": "One coin is a copper: a hundred to a gold piece." }
```

* `scale`: a number from 0.001 to 1000, default 1. Every built-in default money number is multiplied by
  it, rounded to a whole number, at least 1.
* `note`: what the scale means, at most 500 characters, for the reader.

The first enabled pack that has an `economy` sets it; scales aren't mixed. The reader can override it in
Story Block's settings (**Money scale**, 0 or blank: the pack's). Modules read the result with the query
`inventory.economy` → `{ scale, source: 'pack' | 'settings' | 'default' }`. Lorebooks carry flavour for the
model only, never numbers code uses. Ersveil sets `scale: 8`: its marks are small coin, and its F jobs top out
at 400 marks where the built-in F rank tops out at 50.

### Rules for a pack's own numbers

Item values, shop prices, rewards and the start purse are all whole numbers of the chat's **one**
currency (MODULES §F1), so they have to be on one scale. Code compares them: RPG Battle sells and buys by
value, Story Director holds a reward inside its rank's range, and inventory caps how much a reply can
hand out by worth. An item that's worth fifty jobs breaks all three. Anchor the scale like this:

1. **Pick the smallest coin as 1.** Ersveil: 1 mark is the old copper; silver × 10, gold × 100.
2. **Everyday goods and gear keep the world's prices.** Bread, a meal, a bunk, rope, a spear and a
   gambeson cost what the lore says in that coin. A day's unskilled wage should buy food and a bunk.
3. **Rank rewards set the play scale.** Give `ranks` a `reward` range. The lowest rank's jobs should
   pay a few days' wages: Ersveil's F jobs pay 50–400 marks.
4. **Consumables a fight uses are a fraction of a job.** A basic healing draught, salve or antidote
   costs no more than the lowest reward of the lowest rank, and at most a quarter of its highest
   (Ersveil: a minor healing draught is 30 marks, and 45 at the frontier). Stronger ones scale with the rank
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
  "start": { "year": 611, "month": "Goldwane", "day": 12, "hour": 6, "minute": 40 }
}
```

`{ era?, months: [{ name, days }], start?: { year, month, day, hour?, minute? } }`:

* `era`: text of at most 24 characters (`CY`).
* `months`: 1 to 60 months in order, each `{ "name", "days" }` with a name of at most 40 characters (no
  two the same) and 1 to 400 days.
* `start`: when a new story begins. `start.month` is a month's name or its number (1 = the first month)
  and is kept as the name; `day` fits that month; `hour` 0–23 and `minute` 0–59 default to 0.

Any problem here is reported as `BAD_CALENDAR` and the pack is refused. Story Director reads the first
enabled pack's calendar (query `packs.calendar`) for its clock.

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
  `kind: 'places' | 'routes' | 'skills' | 'presets' | 'terms' | 'ranks' | 'crafts' | 'meterPresets'` like every
  kind (a pack without them normalizes exactly as before). Recipes carry their crafting fields only when given;
* query `packs.crafts` → the craft table: `[{ craft, title, stats, stations, note?, pack }]`, the default
  crafts (`pack: null`) with the enabled packs' crafts laid over them, then the packs' new crafts in pack
  order (also `craftsOf(packs)` and `DEFAULT_CRAFTS`, `STATIONS` from `src/v2/packs/index.js`);
* query `packs.calendar` → `{ pack, era, months, start }` from the first enabled pack with a calendar,
  or `null`;
* query `packs.economy` → `{ pack, scale, note }` from the first enabled pack with an `economy`, or `null`.
  Read the settled scale through Story Block's `inventory.economy` (it applies the reader's override);
* query `packs.item({ name })` and hook `item.resolve(name)` → the pack item def (SPEC §7 fields)
  for a story name, or `null`;
* query `packs.start` and hook `start()` → the merged start: `{ scene: { place, present },
  inventory: { items: [{ def, aliases, qty, note }], money }, currency, packs, problems }`, and
  `applyStart(state, start, { id, coin })` to write it into an initial state.
