# Story Block 2.18.1 (draft release notes; the lead moves these into CHANGELOG.md)

## 2.18.1

- **The party roster.** The RPG now tells the rest of Story Block who is in the party: every Character block is a party
  member with an inventory of their own. Before, nothing in Story Block answered that, so all worn gear counted for the
  reader, the Party card's Inventory showed only the reader's pieces, and a pack NPC's signature gear was never handed out.
- **Members own and wear their own gear.** From the item's Edit, "Equipped by" lists the members; the Inventory tab names
  the wearer ("Equipped · Ren"); the Party card's Inventory button opens that member's slot card; a companion's worn pieces
  add to the companion's own rolls (not the reader's). The reader's gear stays in the party bag as it was.
- **Signature gear is handed out.** A pack NPC who joins with `+ party` (or the Ask card's Add to party) now receives their
  `gear` worn and bound to them, and `- party` / a later `+ party` stow and restore it, as 2.18.0 described. A rename while
  they are in the party changes nothing: the member is the block, not the name.
- **Nothing moves by itself.** Chats made with 2.18.0 replay exactly as written. Stacks owned by `party` stay the party's
  (the reader's) bag; a member's gear becomes theirs only when equipped to them from Edit, or granted on join.
- Fix: a roll's gear guard also checks whose pieces were counted (an owner that is another Character's) so a roll made over
  the wrong person's gear is rolled again when its reply is re-read.
- For module authors: a query marked `fallback: true` answers only while no module owns that name (the RPG's `party.actors`
  and `party.pc`); a module that answers `party.actors` itself, such as an old RPG Battle chat's, is asked instead, whichever
  registered first.
