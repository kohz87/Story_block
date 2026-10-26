# Authoring kit: standing rules for any agent

You are helping an author turn their own world into a **Story Block pack**: a rules pack (classes, skills, foes, quests
and the rest) or a data module (a small rule that moves with the story). The author runs you in their own tool; this
folder is everything you need. These rules apply to every task here, whatever the tool.

If you also see developer notes for a repository around this folder (instruction files above it), they are for people who
change the extension itself. For this job, this file wins.

## What you work from

- The author's lore in `work/lore/`, and what they tell you. Nothing else is the world. Do not use what you know of
  other settings, and do not add lore of your own beyond what the lore leaves open; when you must invent, keep to the
  lore's tone and say so in `work/notes.md`.
- The references in `reference/`: `rules-v2.schema.json` (the closed format of a rules pack), `LIMITS.md` (every
  number), `PACK-FORMAT.md` (the pack file and its records), `DATA-MODULES-FORMAT.md`, and the examples. Read `LIMITS.md`
  and the format page for the task before you write anything.
- `examples/tiny-world/`: a one-page lore and the complete small pack made from it, to see the shape of a finished result. Never copy its names into another world.
- The prompts in `prompts/`: one per step. Do the steps in order, one at a time, unless the author asks for something else.

## Rules

1. **Work only from the lore and the references.** Never invent a field, an effect, an op or a mechanic the format does not
   have. If the lore wants something the format cannot express, use the closest thing the format has and write the
   difference in `work/notes.md`.
2. **Output only valid JSON files in `work/`** (UTF-8, two-space indent, a final newline, no comments, no trailing commas,
   no text outside the JSON). The author's drafts go in `work/pack.json` (or `work/<slug>.pack.json` for a data module).
   Never write outside `work/`.
3. **Keep existing slugs and names.** When the author already has a pack, keep every slug it has, and change a record only
   when asked. New records get new slugs: lowercase letters, digits and single hyphens.
4. **After every step, run the checker and fix every problem before you go on:**
   `node check.mjs work/pack.json --through N` for step N of a rules pack while it is unfinished, and
   `node check.mjs work/pack.json` (no `--through`) when it is finished and for every data module. (Every path in this kit is
   relative to this folder; from the repository root, put `authoring-kit/` in front of each.) Read each hint; fix the cause named, not the symptom. Never edit a
   number by guessing: the problem says which value is out of range, and `reference/LIMITS.md` says what the range is.
   The checker is the final word; if a prompt and the checker disagree, follow the checker and note it.
5. **Explain your choices in `work/notes.md`, not inside the JSON.** Keep it short: what you decided where the lore was
   silent, what the format could not hold, scores you were asked to show. The `note` fields in the JSON are one-line
   in-world descriptions only.
6. **No network, no installing anything.** Do not fetch pages, call services or add packages. Run only `node` on the
   scripts in this folder (`check.mjs`, `scripts/join.mjs`, `scripts/limits.mjs`). Do not read or change anything outside
   this folder, and never touch settings, keys or secrets of any tool.
7. **Do not edit the kit.** Leave `reference/`, `prompts/`, `scripts/`, `check.mjs` and this file as they are; they are
   shared. Do not commit the author's lore or drafts (`work/` is ignored by git on purpose).
8. **Ask the author only when it changes the structure** (which classes are the starting ones, whether a faction is a
   place or a class) and the lore does not say. Otherwise decide, and record the decision.
9. **Finish by checking.** A task is done when `node check.mjs <file>` prints `OK`. Then tell the author in a few lines what
   the file contains, what you decided for them, and how to import it (`README.md`, "Import").
