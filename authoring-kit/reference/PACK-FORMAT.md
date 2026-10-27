# Pack format: the short version

A pack is one JSON file of plain data. Nothing in it runs as code. This page is what an author or an agent needs to
write the parts a rules pack builds on. The numbers live in [LIMITS.md](LIMITS.md); the closed format of the rules
manifest is [rules-v2.schema.json](rules-v2.schema.json); the checker (`node check.mjs`) is the final word. The full
reference is `docs/v2/PACKS.md` in the Story Block repository.

## The file

```json
{
  "id": "lanternfall",
  "version": "1.0.0",
  "name": "Lanternfall",
  "author": "You",
  "description": "A lamp-lit market town.",
  "requires": { "storyBlock": "^2", "capabilities": ["rb-rules-v2"] },
  "currency": { "name": "mark", "plural": "marks", "short": "mk" },
  "content": { "items": [], "places": [], "ranks": [], "rules": [] }
}
```

- `id`: 1 to 40 lowercase letters, digits or dashes. `version`: like `1.0.0`. `name`, `author`: up to 80 characters.
- `requires.storyBlock`: a version range, normally `"^2"`.
- `requires.capabilities`: names the pack needs. A pack with `content.rules` lists `"rb-rules-v2"`; a pack with
  `content.dataModules` lists `"data-modules-v1"` (and `"story-director"` when a module reads the story clock).
- The checker knows these capability names: `rb-rules-v2`, `data-modules-v1`, `story-block`, `rpg-battle`, `story-director`,
  `npc-state-delta`, `inventory`, `scene`, `party`, `combat`, `director`, `quests`, `npc`. Any other name is an error
  (`MISSING_CAPABILITY`), usually a misspelling. If the author really has another module installed that provides it,
  run `node check.mjs <pack> --with-capability <name>`.
- Any other top-level field is refused, so a misspelling is never silently ignored. The top-level fields are `id`,
  `version`, `name`, `author`, `description`, `requires`, `currency`, `economy`, `calendar`, `weather`, `content`,
  `start`, `layouts`, `screens`, `theme`.
- `content` holds lists of records by kind. The kinds: `items`, `creatures`, `shops`, `recipes`, `events`, `quests`,
  `races`, `talents`, `skills`, `presets`, `places`, `routes`, `terms`, `ranks`, `crafts`, `meterPresets`, `markets`,
  `rules`, `dataModules`. A rules pack mostly needs `items`, `places`, `ranks`, `creatures`, `quests`, `shops`,
  `recipes`, `crafts` and the one `rules` manifest.

## Ids and references

Every record has a `slug`: lowercase letters, digits and single dashes, at most 64 characters, unique within its
kind. The record's id is `pack.<pack id>/<slug>`. Inside the rules manifest, skills, classes, items, foes, quests
and shops are referred to by their bare slug. Places and quest givers are the exception: they are written as full
ids, `pack.<pack id>/<slug>`.

| Reference | Written as |
|---|---|
| a class, skill, branch form, item, foe, quest, shop | the bare slug (`river-cut`) |
| a place (`turnInPlace`, a `visit` objective, a trainer's `place`, a shop's `place`) | `pack.<pack id>/<place slug>` |
| a quest giver | `null`, or `pack.<pack id>/<foe slug>` when the giver is a record in `content.creatures` |
| a quest objective id | `<quest slug>/<short-id>` (`granary-rats/kill`) |

## Currency and ranks

```json
"currency": { "name": "penny", "plural": "pennies", "short": "p",
  "coins": [ { "name": "penny", "value": 1 }, { "name": "silver", "value": 10 }, { "name": "gold", "value": 100 } ] }
```

Every price, value and reward the pack writes is a whole number of the **smallest** coin (value 1). A world with
one coin needs no `coins` list. Ranks are a ladder of quest ranks, lowest first:

```json
"ranks": [
  { "id": "F", "title": "Apprentice", "levels": [1, 10], "reward": [30, 300] },
  { "id": "E", "title": "Journeyman", "levels": [11, 20], "reward": [300, 1500] }
]
```

A rank id is up to 8 letters, digits, `+` or `-`. `levels` is the character levels the rank is for, `reward` the
coin a quest of that rank pays, in the smallest coin.

### Numbers that hold together

Code compares prices, values and rewards, so a pack's numbers stay on one scale:

1. The smallest coin is 1. Everyday goods keep the world's own prices in that coin.
2. The lowest rank's jobs pay a few days' wages.
3. A basic healing consumable costs no more than the lowest reward of the lowest rank, and at most a quarter of its
   highest.
4. Gear costs one to three jobs of the rank it is for.
5. A shop's `price` is the item's `value`, or a markup on it, never less and at most about three times.
6. A recipe's output is worth at most about twice its materials plus its fee.
7. A quest's reward lies inside its rank's `reward` range.

## Items

```json
{ "slug": "reed-tonic", "name": "Reed Tonic", "kind": "consumable", "rarity": "common", "value": 15,
  "effect": { "heal": 20 }, "tags": ["potion"], "note": "Bitter, green and quick." }
```

| Field | Rules |
|---|---|
| `name` | required, 1 to 80 characters |
| `slug` | lowercase letters, digits and dashes; made from the name when left out |
| `kind` | `goods`, `material`, `consumable`, `equipment`, `quest`, `money` (default `goods`) |
| `rarity` | `common`, `uncommon`, `rare`, `epic`, `legendary` |
| `value` | whole number from 0, in the smallest coin |
| `slot` | for equipment, one of `weapon`, `offhand`, `head`, `body`, `legs`, `feet`, `accessory-1`, `accessory-2` |
| `stats` | stat names to whole numbers: `{ "STR": 2 }` |
| `effect` | an object such as `{ "heal": 20 }` |
| `tags` | short words (up to 40 characters each) |
| `note` | up to 500 characters |
| `aliases`, `stack`, `carry` | optional; see the Story Block docs |

In a rules pack every item also has exactly one **item rule** in the manifest (see the rules prompts).

## Places

```json
{ "slug": "lanternfall", "name": "Lanternfall", "region": "The Slow River", "kind": "settlement",
  "x": 0, "y": 0, "market": "town", "tags": ["river"], "note": "A market town lit by a thousand lamps." }
```

`x` and `y` are numbers on the map (the author chooses the unit; say what it is in the notes). `kind`, `region`,
`layer`, `aliases`, `hidden`, `market` (a settlement type such as `village`, `town`, `city`) and `tags` (up to 8
lowercase environment words such as `river`, `port`) are optional.

## Crafts and recipes

A recipe's `craft` is one of the default crafts (`smithing`, `alchemy`, `leather`, `cooking`, `enchanting`) or a
craft the pack declares:

```json
"crafts": [ { "id": "fieldcraft", "title": "Fieldcraft", "stats": ["DEX"] } ]
```

A craft has an `id` (a slug), a `title` (1 to 30 characters, none of `| : # < >`), 1 to 3 different `stats`, and
optional `stations` and `note`.

## The records a rules pack closes

When a pack carries `content.rules`, its `creatures`, `quests`, `shops` and `recipes` follow the closed shapes of
the rules schema (no extra fields). Examples that pass the checker:

```json
{ "slug": "reed-wisp", "name": "Reed Wisp", "tier": 0, "level": 1,
  "stats": { "STR": 3, "VIT": 4, "AGI": 8, "DEX": 6, "INT": 7, "LUK": 5, "CHA": 2 },
  "skills": ["ember-spark"], "loot": [ { "def": "marsh-reed", "chance": 60, "qty": 1 } ], "loreTags": ["marsh"],
  "aliases": ["wisp", "marsh light"] }
```

```json
{ "slug": "ash-for-the-guild", "name": "Ash for the Guild", "category": "bounty", "giver": null,
  "turnInPlace": "pack.lanternfall/lamp-tower", "requirements": [ { "kind": "level", "min": 2 } ],
  "objectives": [
    { "id": "ash-for-the-guild/collect", "kind": "collect", "def": "gloam-ash", "count": 3, "consume": true },
    { "id": "ash-for-the-guild/visit", "kind": "visit", "place": "pack.lanternfall/lamp-tower" } ],
  "reward": { "coin": 140, "xp": 90, "items": [ { "def": "ward-charm", "qty": 1 } ] },
  "durationMinutes": null, "repeat": null, "chain": null }
```

```json
{ "slug": "lamp-stall", "name": "The Lamp Stall", "place": "pack.lanternfall/lanternfall", "kind": "general-goods",
  "stock": [ { "item": "trail-bread", "qty": 20, "price": 3 }, { "item": "reed-tonic", "qty": 6, "price": 18 } ] }
```

```json
{ "slug": "reed-tonic", "name": "Reed Tonic", "craft": "alchemy", "makes": "reed-tonic", "qty": 1,
  "materials": [ { "item": "marsh-reed", "qty": 2 }, { "item": "lamp-oil", "qty": 1 } ],
  "fee": 0, "minutes": 30, "dc": 8, "stat": "INT", "known": true }
```

Quest requirements are `{kind:"level",min}`, `{kind:"stat",stat,min}`, `{kind:"quest",template}`,
`{kind:"item",def,qty}`, `{kind:"place",place}`, `{kind:"class",classes:[...]}` or `{kind:"flag",key,value}`.
Objectives are `kill` (`foe`, `count`), `collect` (`def`, `count`, `consume`), `visit` (`place`) and `story` (`text`).

An **open quest template** is a quest whose reward is a range for its rank instead of fixed numbers:
`"open": true`, `"rank": "F"`, `"reward": { "coinMin", "coinMax", "xpMin", "xpMax", "items": [] }`, objectives
without a fixed target (`{ "id", "kind": "kill", "count": 3 }`), and `repeat` and `chain` both `null`. Its coin and
xp bounds lie inside the named rank's `reward` range. A kill or collect objective of a template may also write
`countMin` and `countMax` (whole numbers 1 to 999) beside its `count`, with `countMin <= count <= countMax`; they bound
the count a job made from the template may ask for, and both are optional. A template may also write `offerType`
(`hunt`, `cull`, `gather`, `deliver`, `explore`, `escort` or `task`): the kind of job it is for, which RPG Battle 2.3.0
uses to choose between templates that share an objective kind (a cull and a hunt both kill). Its first objective must suit
it (hunt, cull: kill; gather, deliver: collect; explore: visit; escort, task: story); a quest with a fixed reward refuses it.

A foe may list `aliases` (at most 8 different names of 1 to 80 UTF-16 units) that the story may use for it, and the rules
manifest (`content.rules[0]`) may carry `offerWords`: lists named `hunt`, `cull`, `gather`, `deliver`, `explore`, `escort`, `task`, `easy`,
`normal`, `hard` and `nightmare`, each of at most 40 lower-case words of 1 to 24 UTF-16 units, which add the words of
your language or setting to the ones an offer line is read with. All three are optional. An alias may not equal, apart
from capitals and spacing, any creature's name or slug (its own included), another creature's alias or another alias of
the same creature, and needs a visible character. A pack that uses `countMin`/`countMax`, `offerType`, `aliases` or `offerWords`
needs `"storyBlock": "^2.5"` in `requires`.

The rules manifest (`content.rules[0]`) may also carry `promotionMastery`: exactly 3 whole numbers, each 1 to 5, for the
mastery all three of a class's skills need for the promotions at levels 10, 20 and 30, in that order. Left out it means
`[5, 5, 5]` (the top mastery for every promotion). It needs `"storyBlock": "^2.5"` in `requires` and RPG Battle 2.3.0 to have an
effect; RPG Battle 2.2.0 ignores it and every promotion still needs 5 of 5.

## Text rules

Names, notes and every other text in a rules pack may not contain `<` or `>` (or an HTML character reference for
them), or line breaks and control characters. Keep text plain.
