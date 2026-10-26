# Step 2: the skills (base forms)

## Fill in

| Placeholder | What to put |
|---|---|
| `{{WORLD_NAME}}` | your world |
| `{{SKILL_SOURCES}}` | the lore entries that name techniques, spells, songs, arts (file names or headings) |

## The prompt

```
Step 2. For every skill slug named in step 1, write the skill: {"slug","name","note","base":{"type","stat","cost",
"effects","unit"}}. Output {"skills":[...]}; do it in batches of up to 30 skills per answer, in class order, and say
"continue" until all are done. In a file: add them to content.rules[0].skills of work/pack.json. Use the lore's names for
techniques and spells ({{SKILL_SOURCES}}) where they exist.

Each skill's base form must fit the budget of its class's tier (tier 0 -> 12, 1 -> 24, 2 -> 36, 3 -> 48):
- type is physical, magic, heal, buff or debuff; stat is one of STR, VIT, AGI, DEX, INT, LUK, CHA.
- cost is {mp, sp, cooldown}: a physical skill uses sp > 0 and mp 0; every other type uses mp > 0 and sp 0; cooldown
  0-10.
- 1 to 4 effects; unit is null unless the skill summons.
- Effects: damage {op,target:"one"|"all",power 1-1000,element,damageType:"physical"|"magic"}; heal/shield {op,target:
  "self"|"ally"|"allies",power,element,damageType:null}; condition {op:"condition",target,kind,chance 1-100,rounds 1-6}
  (poison, burn, bleed, stun, daze, slow, weaken target "one"|"all"; regen, guard target "self"|"ally"|"allies");
  stat {op:"stat",target,stat,amount -10..10 not 0,rounds 1-6} (positive targets friends, negative foes).
  element is one of none, fire, ice, lightning, poison, holy.
- Score of one effect: damage/heal/shield = ceil(power/10); condition = ceil(chance/25) x rounds; stat = 2 x |amount| x
  rounds; x 3 if the target is "all" or "allies"; plus 12 once if unit is not null. Sum them; stay at or under the
  tier's budget.
- A tier-3 skill's base form also gets a generated power-up (+20 power on its first damage/heal/shield effect, else +1
  on its first stat amount, else +1 round on its first condition): keep that first power at 980 or less, stat amounts
  at 9 or less in size and condition rounds at 5 or less.

Show, after each skill (outside the JSON, in work/notes.md or as a plain line), its computed score, for example
"river-cut: damage 100 one -> 10 / 12". Give each skill a note of at most 240 characters and keep it lore-flavoured.
Skills of one class should feel different from one another (a strike, a defence, a utility), and higher tiers should be
stronger and stranger than lower ones.
```

## Check

```
node check.mjs work/pack.json --through 2
```

It should print `OK through step 2`. Typical problems: `budget-closure` (a score above the tier's budget: lower power,
chance or rounds, or use `one` instead of `all`), `mp-sp-conflict` (a physical skill with mp, or another type with sp),
`bad-effect` (a heal that targets `one`, a harmful condition that targets `self`), `bad-rules` (a tier 3 skill whose
first power is above 980).
