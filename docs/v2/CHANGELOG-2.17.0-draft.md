# Changelog draft: 2.17.0 (levels)

Draft for the lead to move into CHANGELOG.md when the release is cut. Not a release note yet.

## 2.17.0

- **Levels replace Soul Class.** A character has a level from 1 to 99 instead of Soul Class I to IX. At 100 XP the level goes
  up by one and the extra XP carries over. Every third level gives one stat point to spend. The level cap is 99 unless the
  pack names one (`rpg.levelCap`) or you set **Level cap** in Settings → RPG → Levels and practice (1 to 99).
- **Level drives the dice.** A roll adds floor(level ÷ 5) in place of 2 × Soul Class, on both formulas and for foes. The Custom
  numbers may use a divisor from 3 to 8. Foes have a level: `level: N` or `rank: <name>` in a fight line, or a level near the
  party's average when neither is given. A new foe's level is held to the party's highest + 10.
- **Foe Health and turn order.** Standard foe Health is 4 + floor(level ÷ 30) blocks. Initiative is d20 + floor(level ÷ 5)
  for foes, and the same plus AGI ÷ 2 for the party.
- **Fight XP by level.** A won fight gives each member XP from the gap between their level and each foe group's, held to 1 to 60.
  **XP rate** (Settings → RPG, 50 to 300 %, default 100) scales every XP gain, the fight's and the narrator's.
- **Practice.** **Practice per skill use** is 1 to 5 (default 3) and at most 20 a skill in a reply.
- **Ranks in packs.** A pack may name rank bands (`rpg.ranks`) and the party's rank field (`rpg.playerRank`). Foes read
  "Rank F · Lv 7"; a party member with a guild letter reads "Lv 14 · Guild F".
- **Older chats keep their rolls.** Rolls made before this version replay exactly as recorded. Old Character blocks read a
  Soul Class n as level 10n − 5. Character files carry `level`; files with only a Soul Class still import.
- **Lighter RPG.** The RPG's code loads only when the feature is on or the chat holds RPG records. New roll records are
  smaller (the narrator's cue text is rebuilt when needed, not stored).
- **Ersveil 2.5.0** (separate pack) adds the guild rank bands and the guild letter as the party's rank; it requires Story Block 2.17.0.
