# Step 5: foes

## Fill in

| Placeholder | What to put |
|---|---|
| `{{WORLD_NAME}}` | your world |
| `{{MONSTER_SOURCES}}` | the lore entries that name monsters, beasts, bandits, spirits, rivals (file names or headings) |
| `{{FOE_COUNT}}` | roughly how many foes, for example 30 to 40 |

## The prompt

```
Step 5. Rewrite the base pack's creatures (if it has any) as schema-2 foes and add the other common monsters and
opponents of {{WORLD_NAME}} that {{MONSTER_SOURCES}} name (dungeon and wilderness ones included), up to about
{{FOE_COUNT}} foes in total. Each foe: {"slug","name","tier":0-9,"level":1-99,"stats":{all 7 stats, each 1-99},
"skills":[1-3 skill slugs from step 2],"loot":[{"def":"<item slug>","chance":0-100,"qty":1-99}] (at most 8),
"loreTags":[...]} (at most 8 tags of 40 characters), and optionally "aliases":[...] (at most 8 different names of 1-80
characters: other names the story may use for this creature, such as "rats" for a swarm of cellar rats; never the name of
another creature, and never the creature's own name). Keep existing creature slugs. Loot uses item slugs from the pack.
Give a foe skills that fit its nature: a beast uses the plain strikes, a mage the spells; foes may use any skill of the
pack, including tier-0 ones. Match level and stats to the lore's danger ranks, and let the weakest foes be level 1 to 5.
Output {"creatures":[...]}. In a file: put it at content.creatures of work/pack.json.

Loot that needs an item the pack does not have: do not invent a slug. Add the item to content.items instead (name, kind,
value in the smallest coin, a one-line note), give it an item rule (step 4's format) and list the new items in
work/notes.md. In a chat, give the new items as a short list outside the JSON: they are added as items.
```

## Check

```
node check.mjs work/pack.json --through 5
```

It should print `OK through step 5`. Typical problems: `bad-ref` (a skill or loot slug that does not exist),
`bad-schema` (a missing stat, a level outside 1-99, more than 3 skills, a repeated alias or more than 8), `item-rule-mismatch` (a new item without a rule).
