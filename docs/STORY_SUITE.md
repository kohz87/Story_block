# Story Suite

Story Suite is four repositories. **Story Block** (the host) owns state, change-line capture, replay, the prompt and the shared interface,
and carries the inventory, money, scene, data modules, packs and the optional Lean RPG with its fight board. **Story Director** provides the
clock, calendar, map, trips, quests, story threads, World, Chronicle and optional arc planning. **NPC State Delta** gives each person met a
dossier; it is optional and also runs on its own. **Story Studio** is a page opened in a browser (not an extension) for writing packs.

Modules register commands, queries, features and screens through Story Block's SDK, and each works with the others absent; when present,
they share people and social context through guarded queries. See `docs/v2/STATUS.md` for the current versions, `docs/v2/SPEC.md` and
`docs/v2/MODULES.md` for the module API, `docs/v2/ERSVEIL.md` for the example world, and the README for installation and play.
