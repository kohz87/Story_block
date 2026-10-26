# work/

Your working folder. Everything here except this file is ignored by git, so your lore and drafts are never committed.

- `lore/` — put your lore files here (text, Markdown or JSON; whatever you already have).
- `base-pack.json` — the pack your rules are built on (items, places, ranks); see `prompts/rules-pack/00-base-pack.md`.
- `pack.json` — the pack being drafted. Check it with `node check.mjs work/pack.json`.
- `notes.md` — the agent's short notes about the choices it made.
- `steps/` — one file per step, only if you work in a plain chat and join the answers yourself (`node scripts/join.mjs`).
