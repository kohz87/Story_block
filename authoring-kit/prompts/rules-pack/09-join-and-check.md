# Step 9: join and check

The last step puts the pieces together, runs the full check and says how to use the pack.

## Fill in

| Placeholder | What to put |
|---|---|
| `{{PACK_ID}}` | the pack id |

## If you worked in files (an IDE or a command-line agent)

`work/pack.json` already holds everything. Ask the agent:

```
Run node check.mjs work/pack.json (no --through) and fix every problem it reports, then run it again until it prints OK.
Then check that: the manifest at content.rules[0] has slug "rules", schema 2 and a name; requires.capabilities lists
"rb-rules-v2"; every item has one item rule; every tier-3 skill has 8 written branches. Summarise in work/notes.md what
the pack contains (counts of classes, skills, branches, items, foes, quests, shops, recipes, trainers) and any choice you
made that the lore did not decide.
```

## If you worked in a plain chat (no files)

Save every answer as its own file in `work/steps/` (the JSON in the answer is enough; a fence around it is fine), and
save the base pack as `work/base-pack.json`. Name them so they sort in the order they were written, for example
`01-classes.json`, `02-skills-a.json`, `02-skills-b.json`, `03-branches-first-class.json`, `04-item-rules.json`,
`05-foes.json`, `06-quests.json`, `07-trainers-shops-recipes.json`. Then, from the `authoring-kit` folder:

```
node scripts/join.mjs work/base-pack.json work/steps/*.json --out work/pack.json
node check.mjs work/pack.json
```

`join.mjs` adds each list where it belongs (the rules manifest or `content`), replaces a record you gave again, and adds
`rb-rules-v2` to `requires.capabilities`. Fix what the checker reports by asking the chat for the corrected records
only, saving them as a new step file (later files replace earlier records with the same slug), and joining again.

## When it prints OK

- In SillyTavern: Settings, Tabs & Packs, **Import pack file**, and choose `work/pack.json`. Switch the pack on.
- Keep `work/pack.json` as your source. To change one thing later, edit the file and run the check again; the step
  prompts also work on a finished pack (ask for one class, one quest, one shop).
- Open the file in Story Studio if you want forms for it. Studio uses the same checker, so what passes here passes there.
