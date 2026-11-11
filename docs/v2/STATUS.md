# Story Suite v2: implementation status

State on 11 November 2026: **Story Block 2.31.1** (host), with **Story Director 2.13.0** and **NPC State Delta 1.15.0** as its modules
(each repo's own CHANGELOG has the exact releases) and **Story Studio 0.10.2** as the page for writing packs. The example pack is
**Ersveil 2.9.6**; it needs Story Block 2.31.1 or newer. Version numbers below the "Unreleased" heading of CHANGELOG.md are in the next release.

What Story Block provides today:

- The host: state store with replay (swipes, deletes, rewinds, reloads give the same state), saves and save points, the command bus,
  `<Changes>` capture and Re-read, prompt assembly with a static part and a short tail, the module SDK, Features, settings and the Game view.
- Core domains: scene (place, time of day, weather, who is here, mounts, Your look) and inventory with money, gear and signature items,
  shown as a grid or a list.
- Data modules ("blocks"): pack-defined or reader-made blocks with fields, rules and screens; the pack checker, templates, Enable all.
- The optional Lean RPG: characters, skills and levels, story checks (three dice a reply), and the fight board, where the reader chooses
  their character's actions and code rolls them (Standard rules; the narrated fight and the Classic rules phase out). Fights give XP per foe.
- Packs: places, routes, calendar, weather, events (including `decision` groups and Ripples), cast, name lists, coins, start state, layouts
  and screens, with the checks in `docs/v2/PACKS.md`; a lorebook import; portraits.
- Assist (two optional helper calls) and the timeline.

Story Director adds the clock, calendar, map, trips, quests, threads, World, Chronicle and arc planning. NPC State Delta adds a dossier
for each person met and runs alone or hosted. Every module works with any other absent.

Where things are written down: `README.md` (install and play), `CHANGELOG.md` (releases), `SPEC.md` (host interfaces), `MODULES.md` (module
APIs, §F decisions), `PACKS.md` (pack authoring), `RPG.md` and `GEAR.md` (the RPG and gear), `ERSVEIL.md` (the example world), `docs/dev/`
(area notes for agents) and the open follow-ups in the suite's TODO_NEXT.md.
