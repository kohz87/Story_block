# Story Suite v2 releases

## 2.0.0-alpha.1 (2026-10-21)

**Story Suite v2, first alpha.** A fresh start: game state is JSON kept in each reply, every action is a command with a receipt, code sets every number and the model narrates. Built for test play, not for your real campaigns yet.

**Install (separate SillyTavern profile recommended, SillyTavern 1.19+):** switch Story Block, RPG Battle, Story Director and NPC State Delta to their `v2` branches. Player guide: `docs/v2/GUIDE.md` in Story Block. Test pack and setup for Ersveil: `docs/v2/ERSVEIL.md`. Status: `docs/v2/STATUS.md`.

**Verified live (SillyTavern 1.19, all four together):** replies are held until a character exists and the creation wizard opens; a reply's change lines create a quest offer and a fight offer; quest taken → fight won with loot and XP → quest paid by code; the next reply is told all of it in order; deleting messages rolls everything back; the fixed part of the prompt is byte-identical between replies (85% shared prefix).

**Known issues (next alpha):**
- Deleting a reply in the middle of a chat can, in rare cases, let a one-time bonus be paid twice.
- Internal commands can be triggered from a pack's screen buttons, and pack/template hardening is still in progress: only install packs you trust.
- Some fight edge cases can leave a fight unable to finish (companion at max level, someone leaving mid-fight); a draught drunk in a fight stays sellable until the fight ends.
- Checks still wait for a Roll; the same-reply dice (like v1's) come next.
- Chat files are about 30% larger than v1's until storage tuning lands.
- "1 crowns"-style plurals; the Party screen's stat steppers don't share one budget; NPC State Delta logs a harmless 404 on new chats and keeps its floating button while hosted; first fights aren't balanced yet.
