# Step 1: the class tree

## Fill in

| Placeholder | What to put |
|---|---|
| `{{WORLD_NAME}}` | your world |
| `{{CLASS_SOURCES}}` | the lore entries that describe classes, professions, orders or magic traditions (file names or headings) |
| `{{START_CLASSES}}` | how many starting (tier 0) classes, 3 to 5 is a good size; or "as the lore supports" |

## The prompt

```
Step 1. From {{CLASS_SOURCES}}, design the class tree for {{WORLD_NAME}}. Output {"classes":[...]} where each class is
{"slug","name","tier","parent","skills":[3 skill slugs],"note"}. In a file: put it at content.rules[0].classes of
work/pack.json (create the rules manifest {"slug":"rules","name":"<World> rules","schema":2} first if it is not there).

Checked by the program:
- At most 40 classes in total. Tiers 0-3. Tier 0 classes have parent null; every other class's parent is a class exactly
  one tier lower; every chain ends at tier 3 (a class with no children must be tier 3).
- Every class has exactly 3 skill slugs (the skills themselves come in step 2), each owned by exactly one class, each
  at most 52 characters.
- A tier 3 class costs 24 written branches (cap 1000 in all), so the tree can hold at most 37 tier 3 classes; fewer is
  better.

Design guidance (not checked): {{START_CLASSES}} tier-0 classes (the starting classes the lore supports), each
branching to 1-3 tier-1 classes, and so on up to tier 3. Five to twelve tier-3 classes is a typical size; a world with more has a lot to write in step 3.
Put a one-line lore note (at most 240 characters) on each class. Where the lore names a promotion or a path between
classes, follow it. Also output, after the classes, a short plain list (outside the JSON, in work/notes.md) of which lore
entries each tier-0 class comes from.

Optionally add "statLabels": {"STR": "...", ...} (a name of 1-80 characters for any of the seven stats) to the manifest if
the lore calls the stats something else. Do not rename the stat keys themselves.
```

## Check

```
node check.mjs work/pack.json --through 1
```

`--through 1` lets the checker judge the tree while the skills do not exist yet. It should print `OK through step 1`.
Typical problems: `tier-chain` (a parent of the wrong tier, or a leaf that is not tier 3), `class-skills` (not exactly
3 skills, or one skill in two classes), `bad-schema` (a slug with capitals or spaces).
