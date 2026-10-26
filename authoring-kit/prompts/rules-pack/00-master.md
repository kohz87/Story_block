# Rules pack, master prompt (send this first)

A rules pack gives a world its RPG Battle rules: a class tree, skills, skill branches, item rules, foes, quests,
trainers, shops and recipes. You work through it in steps (`01` to `07`), then tune and join (`08`, `09`).

## Fill in

Replace every `{{...}}` below, in the prompt and in each step, before you send it (or tell your agent the values once
and ask it to use them).

| Placeholder | What to put |
|---|---|
| `{{WORLD_NAME}}` | the name of your world or setting |
| `{{LORE_FILES}}` | your lore files, for example `work/lore/world.md, work/lore/places.md` (or "the text I pasted") |
| `{{PACK_ID}}` | the pack's id: lowercase letters, digits and dashes, at most 40 characters (`lanternfall`) |
| `{{BASE_PACK}}` | the pack the rules are built on, for example `work/base-pack.json`; use `none` if you have none yet and start with `00-base-pack.md` |

## How you work

- **With an agent that reads and writes files** (an IDE or a command-line agent): it starts by copying the base pack to
  `work/pack.json`, which it keeps as the one file; each step adds its part to it. After every step it runs `node check.mjs work/pack.json --through N` and fixes
  everything the checker reports before the next step.
- **In a plain chat** (no files): ask for one JSON answer per step, save each as `work/steps/NN-name.json`, and at
  the end join them with `node scripts/join.mjs` (see `09-join-and-check.md`).

Attach or paste first: `reference/rules-v2.schema.json`, `reference/LIMITS.md`, `reference/PACK-FORMAT.md`,
`reference/example-rules-pack.json`, the base pack, and your lore files. `examples/tiny-world/` (a one-page `lore.md` and the
complete small pack made from it) shows what the finished result looks like.

## The prompt (copy everything in the box)

```
You are converting the setting {{WORLD_NAME}} into an RPG Battle "rules pack" (schema 2) for Story Block. The
attached rules-v2.schema.json is the exact, closed format: every object has only the listed fields, every field listed
as required must be present, and nothing else is allowed. example-rules-pack.json shows a tiny valid pack (its names
are placeholders: never copy them). {{BASE_PACK}} is the pack this builds on: its items, places, ranks, creatures,
shops, recipes and quests are already written; KEEP their slugs and names exactly and build on them (if it says
"none", the base pack is written first, from 00-base-pack.md). The lore ({{LORE_FILES}}) is the source of truth for
names, classes, skills, places, factions, monsters and prices. Use the lore's own names and terms; invent only what the
lore leaves open, and keep it consistent with the lore's tone. Do not use anything you know about other settings.

Hard rules (the checker refuses anything else):
- Output ONLY JSON: a file, or one JSON code block per answer. No comments inside the JSON, no trailing commas.
- Slugs: lowercase letters, digits and single hyphens (e.g. "river-warden"), at most 64 characters; a skill's slug at
  most 52 characters. Names 1-80 characters. Notes at most 240 characters. No "<" or ">" anywhere in the text.
- References between records use the referenced record's bare slug (e.g. a class lists its skills by skill slug).
- Place references are full ids, not bare slugs: "pack.{{PACK_ID}}/<place slug>", using the place slugs of the base pack
  (e.g. "pack.{{PACK_ID}}/market-town"). A quest giver is null, or "pack.{{PACK_ID}}/<foe slug>" when the giver is a
  record in creatures; never invent an id for a person who is not a record. Quest objective ids are
  "<quest slug>/<short-id>".
- Stats are STR, VIT, AGI, DEX, INT, LUK, CHA. Stat values 1-99.
- Classes: tiers 0-3. Tier 0 classes have parent null; every other class's parent is a class exactly one tier lower.
  Every class has exactly 3 skills, and each skill belongs to exactly one class. Every chain ends at tier 3. At most
  40 classes and 120 skills in all.
- Skill "base" form: type is one of physical, magic, heal, buff, debuff. cost is {mp, sp, cooldown}: a physical skill
  uses sp > 0 and mp 0; every other type uses mp > 0 and sp 0 (the checker requires the other pool to be 0);
  cooldown 0-10. 1 to 4 effects. unit is null unless the skill summons (then {kind: "summon" or "pet", class, statShare
  10-100, poolShare 10-100, rounds 1-60}).
- Effects:
  damage {op:"damage", target:"one"|"all", power 1-1000, element, damageType:"physical"|"magic"};
  heal/shield {op:"heal"|"shield", target:"self"|"ally"|"allies", power, element, damageType:null};
  condition {op:"condition", target, kind, chance 1-100, rounds 1-6} - poison/burn/bleed/stun/daze/slow/weaken target
  "one"|"all" (foes), regen/guard target "self"|"ally"|"allies";
  stat {op:"stat", target, stat, amount -10..10 not 0, rounds 1-6} - positive amounts target friends, negative foes.
  element is one of none, fire, ice, lightning, poison, holy.
- POWER BUDGET (the checker computes this; stay at or under it):
  score of one effect: damage/heal/shield = ceil(power/10); condition = ceil(chance/25) x rounds;
  stat = 2 x |amount| x rounds; then x 3 if the target is "all" or "allies" (x 1 otherwise). Add the effects, plus 12
  if unit is not null.
  Budget for a skill's base form: tier 0 -> 12, tier 1 -> 24, tier 2 -> 36, tier 3 -> 48.
  Each path step adds 12: a tier-3 step-1 form -> 60, a step-2 form -> 72.
  Example: a tier-0 single-target physical strike with power 100 scores 10 (fits 12); the same against "all" scores 30
  (too high for tier 0 - needs tier 2).
- GENERATED POWER-UP: the engine itself writes one extra form ("-g") under each tier-3 base and step-1 form: it adds
  +20 power to the first damage/heal/shield effect (else +1 to the first stat amount's size, else +1 round on the
  first condition). Keep that effect at power 980 or less (stat amounts at most 9 in size, condition rounds at most 5)
  so the power-up is legal, and leave room for it in the budget.
- Money is whole numbers of the pack's smallest coin. Follow the base pack's existing prices and ranks.
```

## After the master prompt

Send step `01-classes.md`, then each following step, one at a time, in order. Do not skip the check after each step.
If the checker and a prompt ever disagree, the checker is right: follow it, and tell your agent to note the difference
in `work/notes.md`.
