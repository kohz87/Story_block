# Step 6: quests

## Fill in

| Placeholder | What to put |
|---|---|
| `{{WORLD_NAME}}` | your world |
| `{{PACK_ID}}` | the pack id (place references are `pack.{{PACK_ID}}/<place slug>`) |
| `{{QUEST_SOURCES}}` | the lore entries with jobs, guild work, story arcs, bounties, rumours |
| `{{QUEST_COUNT}}` | roughly how many quests, for example 20 to 30 |

## The prompt

```
Step 6. Rewrite the base pack's quests (if it has any) as schema-2 quest templates and add guild and story quests for
{{WORLD_NAME}} from {{QUEST_SOURCES}}, up to about {{QUEST_COUNT}}, spread over the ranks. Each quest:
{"slug","name","category":"main"|"side"|"bounty","giver":null,"turnInPlace":null or a place id,"requirements":[...],
"objectives":[1-8 of kill/collect/visit/story],"reward":{"coin","xp","items"},"durationMinutes":null or minutes,
"repeat":null or {"cooldownMinutes":0-525600},"chain":null or {"previous":<quest slug or null>,"next":<quest slug or null>}}.

- Objective ids are "<quest slug>/<short-id>". Objectives: kill {id,kind,foe,count}, collect {id,kind,def,count,consume},
  visit {id,kind,place}, story {id,kind,text}. A foe is a foe slug from step 5, an item an item slug from the pack, a
  place a full id "pack.{{PACK_ID}}/<place slug>".
- Requirements (at most 16): {kind:"level",min}, {kind:"stat",stat,min}, {kind:"quest",template},
  {kind:"item",def,qty}, {kind:"place",place}, {kind:"class",classes:[class slugs]}, {kind:"flag",key,value}.
- giver is null, or "pack.{{PACK_ID}}/<foe slug>" when the quest giver is a record in creatures. Do not write ids for
  people who are not records; name the giver in the objective's text or the quest's name instead.
- Rewards follow the pack's ranks: a quest's level is the min of its level requirement (1 if none), its rank is the first
  rank whose level range contains that level, and reward.coin lies inside that rank's reward range. xp rises with the
  quest's size but is not a coin amount: experience is flat (100 XP a level), so give a quest roughly a third of a level to
  two levels of XP (about 30 to 200 XP, a little more at higher ranks), whatever its coin.
  Reward items are item slugs (at most 8) and are worth less than the coin.
- A chain's later quests never pay less than the one before.
- Optional: an open quest template draws its reward from a range for its rank: "open": true, "rank": "<rank id>",
  "reward": {"coinMin","coinMax","xpMin","xpMax","items":[]} (coinMin/coinMax inside that rank's coin "reward" range; xpMin/xpMax
  inside the rank's "xp" range when the rank has one, else inside its coin "reward" range as before, which suits no rank
  whose coin is in the hundreds: give the ranks an "xp": [lo, hi] range, as step 0 explains, and keep the template's XP
  inside it),
  objectives without a fixed target ({"id","kind":"kill","count":3}), "repeat": null, "chain": null. Use two or three for
  generic guild jobs.
- A story that offers jobs in its own words is matched to these templates, so write one story, one hunt and one delivery
  template for each rank you use. An open kill or collect objective can also bound the count a job may ask for:
  "countMin" and/or "countMax" (whole numbers 1-999) beside "count", with countMin <= count <= countMax (a hunt that
  takes 1 to 8 foes: {"id","kind":"kill","count":3,"countMin":1,"countMax":8}). Both are optional; leave them out
  where the template's own count is the only one that makes sense. A pack that uses them needs "storyBlock": "^2.5" in
  requires.
- Give each open template an optional "offerType" saying which job it is for: "hunt", "cull", "gather", "deliver",
  "explore", "escort" or "task". Hunt and cull both use a kill objective, gather and deliver a collect objective, escort
  and task a story objective, so the type is how a cull finds your cull template and not your hunt template. The type must
  suit the template's first objective (hunt, cull: kill; gather, deliver: collect; explore: visit; escort, task: story),
  and only open templates have it. Two templates may share a type and rank; the first in the list is tried first. It needs
  "storyBlock": "^2.5" in requires and RPG Battle 2.3.0 to have an effect; without them the first template of the kind is
  used as before.
Output {"quests":[...]}. In a file: put it at content.quests of work/pack.json.
```

## Check

```
node check.mjs work/pack.json --through 6
```

It should print `OK through step 6`. Typical problems: `bad-ref` (a foe, item, place or giver that is not defined: places
need the full `pack.<id>/<slug>`), `bad-schema` (an objective with a missing field, a quest without all eleven fields),
`bad-schema` on an open quest whose coin range leaves the rank's reward range or whose xp range leaves the rank's xp range
(its reward range when the rank has no xp), `bad-schema` at an open objective's
`count` when it is not between its `countMin` and `countMax` (or at `countMax` when `countMin` is above it), `bad-schema` at `offerType` when it does not suit the first objective,
`envelope-unknown` at `offerType` on a quest that is not an open template.
