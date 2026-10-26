# Data module, step 1: from a plain description to a definition

A data module adds one small rule to a chat as plain data: a reputation meter, a hunger clock, a counter the story moves,
a title that is earned. Read `reference/DATA-MODULES-FORMAT.md` first (the agent will). If your idea needs loops, scripts,
the network, or things the story invents, it is a code module instead (`prompts/code-module/README.md`).

## Fill in

| Placeholder | What to put |
|---|---|
| `{{MODULE_IDEA}}` | your idea in plain words: what is tracked, what moves it, what the reader should see |
| `{{PACK_ID}}` | the id of the pack that will carry it: lowercase letters, digits and dashes, at most 40 characters |
| `{{MODULE_SLUG}}` | the module's short name: lowercase letters, digits and dashes, at most 40 characters |
| `{{WORLD_NAME}}` | your world, if the module uses its words (factions, places, needs); or "any" |
| `{{LORE_FILES}}` | the lore files the names should come from, or "none" |

## The prompt

```
Design a Story Block data module from this idea: {{MODULE_IDEA}}

Work from reference/DATA-MODULES-FORMAT.md, reference/LIMITS.md and the two examples in reference/data-modules/. Use the
names of {{WORLD_NAME}} from {{LORE_FILES}} where they apply. Do not invent mechanics the format does not have.

First write work/notes.md, short, with these headings:
1. What the module tracks: each field with its type (int, bool, enum, text, map), its bounds and its default. Prefer a few
   small fields. Numbers are whole numbers inside fixed bounds; nothing grows; text is only for display.
2. What the story may say: each "kind" (a line the narrator can write) with its mark (+ gained, - lost, ~ changed, !
   happened, ? asks the code to decide), its labels (one lowercase word each, typed: an enum of fixed choices, a small int,
   or a bool), and what it does to the fields. Keep kinds few and obvious; a narrator must be able to write them from a
   one-line grammar.
3. What the code decides, not the narrator: rewards the code sizes (a reward template with a range and a picker min, max
   or midpoint), conditions that refuse a line, rules that fire after (a title earned at a threshold, with a latch so it
   is earned once), timers that move fields as the story clock passes (needs the story clock).
4. Whether it is shared by the whole chat (scope "chat") or kept per character (scope "character", attached in setup).
5. What cannot be done: anything in the idea the format cannot express (loops, functions, text built from fields, new
   characters or items, rolls of its own). Say plainly how you changed the idea to fit, or what is left out.

Then write work/{{MODULE_SLUG}}.pack.json: a small pack whose content has only "dataModules": [ the definition ], with
"id": "{{PACK_ID}}", "version": "1.0.0", "name", "requires": {"storyBlock": "^2", "capabilities": ["data-modules-v1"]}
(add "story-director" to capabilities when a timer reads the story clock). The definition has slug "{{MODULE_SLUG}}",
name, schema 1, stateVersion 1, scope, state, kinds, and only the optional parts the idea needs (rules, rewards, timers,
imports, exports, screens).

Add a screen that shows the fields (see the examples), mounted as a tab and a card, reading only this module's own view.
Give a field and a kind names a player would recognise. Run: node check.mjs work/{{MODULE_SLUG}}.pack.json
```

## Check

`node check.mjs work/<slug>.pack.json` should print `OK`. If it prints `DM_` problems, step 3 (`03-check-and-try.md`)
says what each means. Go on to `02-lines.md` when it is OK.
