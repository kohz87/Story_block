# Pack format

A pack is a JSON object with an `id`, `version`, `requires` and `content`. Its `requires.storyBlock` is a version range; optional `requires.capabilities` lists capabilities the pack needs, such as `story-director`, `scene`, `inventory` or `data-modules-v1`.

Content can include places, routes, events, items, creatures, quests and data modules. A pack can also provide a calendar, weather, currency, screens and a start state, and a rank for the player's character: `"content": { "you": { "rank": { "label": "Guild rank" } } }` (label 1 to 30 plain characters, no `< > { }`; unknown keys under `content.you` are refused). Without it the game has no rank. See `DATA-MODULES-FORMAT.md` for data module fields and `LIMITS.md` for size bounds. The checker is the final authority: run `node check.mjs work/pack.json`.
