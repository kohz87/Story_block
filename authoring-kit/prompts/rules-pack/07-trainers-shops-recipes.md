# Step 7: trainers, shops and recipes

## Fill in

| Placeholder | What to put |
|---|---|
| `{{WORLD_NAME}}` | your world |
| `{{PACK_ID}}` | the pack id |
| `{{TRAINER_SOURCES}}` | the lore entries about guild halls, academies, temples and masters who teach |
| `{{SHOP_SOURCES}}` | the lore entries about markets, traders and crafts |

## The prompt

```
Step 7. (a) Trainers: one per place the lore says teaches (guild halls, academies, temples, masters), from
{{TRAINER_SOURCES}}, each {"slug","name","place":"pack.{{PACK_ID}}/<place slug>","skills":[1-30 skill slugs they teach],
"fee":<whole number of the smallest coin, at least 1, at most 1000000>,"minutes":60,"eventTemplates":[]}. A trainer
teaches skills of the classes that place stands for; a fee is the price of a training session and follows the pack's
numbers (a few days of the lowest rank's wages for a tier-0 skill; more for higher tiers).
(c) Optional, trainer templates: teachers the story may meet anywhere (a wandering swordsman, a retired sergeant,
a hedge witch), from {{TRAINER_SOURCES}}. Each {"slug","name","open":true,"rank":"<a rank id from content.ranks>",
"skills":[1-30 skill slugs],"fee":{"coinMin":<at least 1>,"coinMax":<at most 1000000, not below coinMin>},
"minutes":60,"eventTemplates":[]}. A template has no "place": it stands where the story offers it, with
"+ trainer Name | like: <slug>". Its name says what kind of teaching it is ("Blade drills"), never who teaches.
List the skills of one class and the class above it on the same line; the story may narrow the list, never add to
it. Keep the fee range near the fixed trainers' fees for the same tiers; code rolls the fee inside it when a trainer
is offered. Write two to four templates, or none.
(b) Shops and recipes, from {{SHOP_SOURCES}}: rewrite the pack's shops and recipes (if it has any) in the schema-2 shapes
and add the shops and crafts the lore names, keeping existing slugs.
 - shop: {"slug","name","place":"pack.{{PACK_ID}}/<place slug>","kind":"<slug, at most 40 characters>","stock":[1-100 of
   {"item":"<item slug>","qty":1-999,"price":whole number}]}.
 - recipe: {"slug","name","craft":"<craft>","makes":"<item slug>","qty":1-99,"materials":[1-8 of {"item","qty":1-99}],
   "fee":whole number,"minutes":0-1440,"dc":5-40,"stat":"DEX" or "STR+DEX" (one to three different stats joined by +),
   "known":true|false} and optionally "station" and "teaches" (up to 120 characters, who teaches it).
   "craft" is one of smithing, alchemy, leather, cooking, enchanting, or a craft declared in content.crafts.
 - Prices: a stock price is the item's value, or a markup on it up to about 3 times, never less. A recipe's output is worth
   at most about twice its materials plus its fee. The shop's place must stand where the lore puts the market.
Output {"trainers":[...],"shops":[...],"recipes":[...]}. In a file: trainers (fixed ones and templates in the same list) go
to content.rules[0].trainers, shops to content.shops, recipes to content.recipes of work/pack.json (and a new craft to content.crafts).
```

## Check

```
node check.mjs work/pack.json
```

This is the first step that finishes the pack, so run it without `--through`. It should print `OK` and two hashes.
Typical problems: `bad-ref` (a skill, item or place that is not defined), `bad-schema` (a trainer fee of 0, `minutes` other
than 60, a recipe `stat` that is not a stat sum), `UNKNOWN_REF` (a recipe whose `craft` is not a default craft or declared),
`envelope-unknown` on a template's `place` (templates have none), `bad-schema` on a template whose fee is one number, whose
coinMin is above coinMax, or whose rank is not in content.ranks.
