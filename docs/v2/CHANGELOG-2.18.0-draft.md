# Story Block 2.18.0 (draft)

Draft notes for the gear release. Each line was checked against docs/v2/GEAR.md and this branch. Lines marked **[unconfirmed]** could not be confirmed and need a decision before release.

- **Gear in fights** is one switch in Settings → RPG (off by default). It counts only while the RPG is on.
- **Rarity budgets and stat bonuses.** Common 0, uncommon 1, rare 2, epic 3, legendary 4 stat points, at most two stats per piece. Effective stats may pass 20 but never 30.
- **Eight slots:** head, body, cloak, feet, weapon, off-hand and two accessories. A bag is no slot.
- **Carry** = 10 + 2 × STR + bags + mounts and carts. At 80 % load the state is Heavy. At 100 % the party is Encumbered: −2 AGI and DEX.
- **Wear** on decisive hits: Good → Worn → Torn → Broken. Repair with `repair: mend|restore`; `wear: ruin` breaks a piece.
- **Condition** shows in the prompt (for example "(worn)") and changes the item's value: 100 %, 75 %, 50 %, 20 %.
- **Battle log** gets gear lines (the stats a roll used) and wear lines.
- **Legendary** items only after a completed quest or a win against foes 10+ levels above the party.
- **Inventory tab** has the Carry card and the gear sections. **Party card** has an Inventory button that opens the slot card.
- **Signature gear** for pack NPCs: their gear is given and worn when they join the party. It stays bound to them, and they keep it when they leave and come back. With no party roster, nothing is given and a Problems line says so.
- **Ersveil** pack: 16 signature items, and each cast member's gear. **[unconfirmed]** The branch's Ersveil pack and docs are version 2.5.0, not 2.6.0.
- **Gear off** leaves everything as it was. **[unconfirmed]** The exact match to 2.17.0 is not checked here; GEAR.md states "exactly as without it" and "byte for byte".
