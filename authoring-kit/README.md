# Authoring kit

Draft a Story Block pack with your own AI, on your own machine. The kit is prompts, instructions, references and a
checker. It has no AI page, asks for no keys and makes no network calls: you run it in the coding agent or chat you
already use, and Story Block's own checker tells you when the result is valid.

**What you can make**

- **A rules pack**: classes, skills with their branches, item rules, foes, quests, trainers, shops and recipes for your
  world (`prompts/rules-pack/`).
- **A data module**: a small rule that moves with the story, such as a reputation meter or a hunger clock
  (`prompts/data-module/`).
- A code module: see `prompts/code-module/README.md`.

## Quick start

1. **Get the kit.** Clone Story Block (`git clone https://github.com/kohz87/Story_block`) and use its `authoring-kit`
   folder, or take the `authoring-kit` folder from the Story Studio download or repository. You need Node 22 or newer
   for the checker, nothing else.
2. **Put your lore in `authoring-kit/work/lore/`** (create the folder). Text, Markdown or JSON, whatever you have. It is
   never committed: git ignores everything in `work/` except its README.
3. **Open the `authoring-kit` folder in your agent** (below) and tell it:
   - for a rules pack: *"Follow AGENTS.md and draft a rules pack from my lore. The world is called X, the pack id is
     x-world."*
   - for a data module: *"Follow AGENTS.md and make a data module from this idea: ..."*

   The agent works through the prompts in order. To drive it yourself, send the prompt files one at a time
   (`00-master.md`, then `01` to `07`, then `09`) and fill in their `{{placeholders}}`.
4. **Check until it prints OK.** From the `authoring-kit` folder:

   ```
   node check.mjs work/pack.json
   ```

   (From the repository root, write `node authoring-kit/check.mjs work/pack.json`.) Each problem has a path, the
   checker's message and a one-line hint. A rules pack that is still being drafted is checked step by step with
   `--through N` (for example `--through 3`); only the finished pack is checked without it.
5. **Import.** In SillyTavern open Settings, Tabs & Packs, **Import pack file**, and choose your file. For a data module,
   open a chat, go to Settings, Tabs & Packs, **Data modules** and press **Enable for this chat**.

## Your tool

| Tool | How |
|---|---|
| **Claude Code** | `cd authoring-kit` and start `claude`. It reads `CLAUDE.md`, which points to `AGENTS.md`. |
| **Cursor** | File, Open Folder, choose `authoring-kit`. Use the agent chat. Cursor reads `AGENTS.md` from the folder; if yours does not, begin with "read AGENTS.md first". |
| **Gemini CLI** or **Antigravity** | `cd authoring-kit` and start `gemini` (it reads `GEMINI.md`), or open the folder as the workspace in Antigravity and start an agent task. Begin with "follow AGENTS.md". |
| **Codex CLI** | `cd authoring-kit` and start `codex`. It reads `AGENTS.md`. |
| **Any chat model, copy and paste** | No files needed on its side. Attach or paste `reference/rules-v2.schema.json`, `reference/LIMITS.md`, `reference/PACK-FORMAT.md`, your lore and `prompts/rules-pack/00-master.md`; then send `01` to `07` one at a time, saving each answer in `work/steps/`. Join them with `node scripts/join.mjs work/base-pack.json work/steps/*.json --out work/pack.json` and check the result (`09-join-and-check.md`). |

No Node? Open the pack in Story Studio instead: its Problems list is the same checker.

## Tips

- Small steps, checked each time. The checker's messages say what to change; do not tune numbers by hand.
- Keep your slugs. Other records refer to them, and a chat that already uses your pack keeps its own copy.
- Ask for notes. The agent writes its decisions to `work/notes.md`, so you can see where it filled gaps in your lore.
- Your lore goes only where your chosen tool sends it. The kit itself never sends anything anywhere.

## What is in the folder

```
AGENTS.md  CLAUDE.md  GEMINI.md        standing rules for the agent (the other two point to AGENTS.md)
check.mjs                              the checker: node check.mjs <pack.json> [--through 1..7]
prompts/rules-pack/                    00-master, 00-base-pack, 01-classes ... 07-trainers-shops-recipes,
                                       08-reward-tuning, 09-join-and-check
prompts/data-module/                   01-design, 02-lines, 03-check-and-try
prompts/code-module/README.md          where code modules come from
reference/                             the format: schema, LIMITS.md, PACK-FORMAT.md, DATA-MODULES-FORMAT.md, examples
scripts/                               join.mjs (join step files), limits.mjs (regenerates reference/LIMITS.md)
examples/tiny-world/                   a one-page lore.md and the pack the kit makes from it
work/                                  your lore and drafts (ignored by git)
```

Try the checker on the example first: `node check.mjs examples/tiny-world/pack.json` prints `OK`.
