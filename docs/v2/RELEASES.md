# Story Suite v2 releases

## 2.0.0-beta.1 (draft)

**Not released yet.** These notes grow as each beta wave merges. Still for test play only.

**Update Story Block first, then the modules.** Every beta module needs Story Block 2.0.0-beta.1 or later.
An older Story Block refuses it with a red notice, for example *Story Suite: RPG Battle needs Story Block
≥ 2.0.0-beta.1; this is 2.0.0-alpha.2. Update Story Block to use it.*, and the module's row in **Story
Suite settings → Versions** says the same. NPC State Delta keeps working on its own until Story Block is
updated.

### What's new since alpha.2

**Features: switch optional mechanics on and off** (F100, Story Block #96)
- Story Suite settings have a **Features** page, and each extension's section has its own Features list.
- Each optional mechanic has a switch and one line saying what it does.
- A feature that's off is gone from the story: the model isn't told about it, its lines aren't used, and its buttons and screens are hidden.
- Nothing is lost. Turning a feature on again brings back what the story already held.
- Your switches hold in every chat.
- Story Block's own: Status strip, Cards under replies (both on), and two helpers that make one small extra model call each (both off).

**Inventory: Equip on…, loot to pick from, encumbered** (F99, Story Block #104)
- The Inventory is the one bag for the whole party. Each character has an **Equipped** section with **Take off**.
- **Equip on…** lists only the members who can wear a piece. It hands the piece over and puts it on in one step. Whatever was in that slot goes back into their pack.
- **Give…** hands a thing to someone else in the party.
- **Loot to pick from** (feature *Pick what you take*, on): the story can lay things out (`? loot …`). The card under the reply shows them as chips, and you take the ones you want.
- **Encumbered** (feature *Encumbered*, on): what the story gives past the carry limit is kept, and the party is encumbered (AGI and DEX checks −2) until something is put down.
- Item names are matched more loosely: "a handful of berries" finds Berries.
- Pieces can carry a condition, for RPG Battle's wear rules.

**Tools for testers** (F92, F93, Story Block #105)
- **State inspector** (feature, off): a read-only screen with any reply's story state, what changed, its receipts and its problems.
- **Save points** (feature, on): **Save point** on Home keeps the moment as a named SillyTavern branch, listed with **Return here**.
- **Versions**: the last fold in Story Suite settings lists each extension, its version and the Story Block it needs. One that is out of step says how to fix it.
- Meters can show stage marks, a ceiling and the last change. Home shows each quest with Story Director's own status line.

**Money: the pack sets the scale** (F104, Story Block #99, #103; RPG Battle #92; Story Director #89)
- The currency is only a name. The pack's rank ladder sets quest rewards and the most one reply may give. Item values set prices.
- A pack can set a money scale (`economy.scale`). It multiplies only the built-in amounts (the default rank ladder, 1000 per level), never what the pack writes. **Money scale** in Story Block's settings overrides it.
- Lorebooks carry flavour only, never numbers.
- **Ersveil 1.2.0:** potions are now on the play scale (Minor Healing Draught 30 marks, Healing Salve 12), the money scale is 8, and 7 recipes and 2 NPC meter presets are added.
- With Story Block alone, a pack's own rank ladder now sets the coin budget (Ersveil: 400 marks at F).

**Quests the story made up pay inside one reply's budget** (RX-E-1, Story Director #89, #91)
- Every quest reward except a pack quest's own counts as story money. One reply pays at most the party rank's top in such rewards, clicks after the reply included. A turn-in past that stays Ready for the next reply.
- A rank the story writes for a quest can lower its reward, never raise it.
- Pack quests keep their pack reward, outside this budget.

**Ranks, foes, companions and timed effects** (F86, F91, RPG Battle #92)
- Your character's rank follows the pack's ladder, or F to S. The story can name a foe's rank (`rank: D`), and code picks the level inside that band, near yours.
- Companions' stats come from a formula by level and role, never from the model's numbers.
- **Timed buffs and debuffs** (feature, on): `+ effect Name | on: perception | for: 2h`. Code sets the strength (±3 on checks in all), and the effect fades on the story clock. At most 3 new effects per reply. A failed quest can bring a *Setback*.
- How many points each member has to spend is ready for the screens.

**Day digest** (Story Director #90)
- When a story day ends, code writes a digest of it from the receipts: places, quests, fights, money, NPC stages and world news. The model writes none of it.
- A new **Days** screen lists the days with search. After a time skip, the next reply gets one line about the last day.
- Feature *Day digest*, on.

**NPC State Delta: fewer model calls while hosted** (NSD #191, #192)
- Prompt alignment (audit steps 12–13, approved): the model sees whole stored values instead of shortened copies, and group chats keep the cached rules.
- While Story Block hosts NSD, an ordinary reply makes no extra model calls. The relationship passes are skipped because the story's `~ npc` lines move the meters, and backfills run only on the catch-up schedule or when you press Scan.
- Backfills never hold a reply back from showing. A reply admits at most 4 new people at once.
- Swipes and regenerates keep the cached rules.

**Smaller chat files** (storage tuning, Story Block #108)
- Checkpoints every 100 replies or 128 KB, each record kept once, and receipts more than 200 replies back keep everything but their data.
- A 3,000-reply chat file goes from about 33 MB to about 15 MB. A reply now writes about as much as v1 did, counting SillyTavern's own save and one backup.

**Key items and one story-money budget** (Story Block #109, #111; RPG Battle #94; Story Director #94)
- The one notable thing a reply's story may give past the goods budget is a **key item**: always one, in its own stack, tagged **Key** in the Inventory. It can be used, equipped and given, but not sold, and it counts as worth 0 in crafting and commissions.
- One reply has one story-money budget, shared by its `+ coin` lines and the quest rewards the story wrote, clicks after the reply included. The budget honours **Money one reply may give**.

**Gear: wear, repair and refinement** (RPG Battle #88; Story Block #110)
- Pieces are good, worn (85% of stats), tattered (60%) or broken (none). Armour wears with damage taken, weapons a little each fight, and the story can say a piece suffered (`| wear: scuff|tear|ruin`). Code sets the amount.
- Repair kits patch a piece in the field. A smith or tailor repairs it to full for a fee.
- A smith refines a piece to +1, +2 or +3 (+8% stats a level). The +3 attempt can fail.
- Repairing or refining a piece and then selling it never brings in more than selling it as it was.
- Deleting a reply takes back exactly its wear, fees and materials.
- Features *Gear wear and repair* and *Gear refinement*, both on.

**Crafting** (F102, RPG Battle #89; Story Director #93)
- Story-driven: `! craft X | with: …`. The craft uses the reply's own dice, and code adds stats, craft skill, tools and material quality against the recipe's difficulty.
- Results: fail (half the materials lost), made, fine, masterwork, or botched on a natural 1.
- Stations come from the place, and companions craft with their own stats. Recipes are known from the pack or learned in the story (`+ recipe … | from: …`).
- If the party couldn't carry the result, the whole craft is refused and nothing is used.
- A made thing is worth what went into it, and key items count as 0. With Story Director, the clock moves on by the recipe's time (`director.advance`).
- Feature *Crafting*, on.

**RPG Battle screens** (RPG Battle #90)
- One bag: the Items screen is gone. Story Block's Inventory rows show RPG Battle's details (slot, stats, wearer, condition, refinement, what a potion would do).
- Party cards show what each member wears, their effects, their carry load and when they are encumbered. A companion has **In fights** and **Stat points** switches, and your card has **Save character file**.
- A read-only **Crafting** screen. The status strip shows points to spend and effects under way.
- Creation wizard: **Random** only on the Talents step (with **Keep it**), "Points left" said once, and **Import character** on the first step.

**Fights: balance wave C** (RPG Battle #93, #95, #96)
- A tier (weak, even, strong, deadly) now means the same danger for every creature, headcount and level, lone foes included. Each creature's power is measured and evened out.
- No one is stunned two turns running: a second stun dazes instead (−2 on the next action). A story stun costs one turn.
- A boss fight is never below strong.
- A story effect is always small and one per reply. Effects can't be stretched by deletes or a clock set back. Encumbered means −2 to AGI and DEX in checks and fights.
- Built-in loot coin follows the pack's money scale.

**NPC meters, wave C** (NPC State Delta #193)
- Stage ladders: a rung can need several meters and a story milestone (`+ milestone Mira — saved her brother`). There's no promotion during a conflict, and a demotion needs a few replies in a row.
- Per-NPC ceilings and floors, meter presets from packs, optional drift per story day (feature, off), band words in the prompt instead of numbers.
- Hidden notes can show a title while locked ("🔒 Her past — unlocks at Trust 60").
- Features *stages* and *presets* on, *drift* off.

**Story Director**
- Works without RPG Battle: the pack's or the built-in ladder sets the budget (#93, #94).
- The day digest and quest history keep their facts before old receipts are trimmed (#95).

**Fixes**
- The after-reply extractor ignores closed reasoning, as capture does (Story Block #101).
- Feature follow-ups (Story Block #106): a dialog of a switched-off screen doesn't open, settings of a switched-off feature are hidden, and a feature that needs another module shows as unavailable until that module is there.
- From the beta fuzz run (Story Block #112, #113): a save that hangs counts as failed after 20 s and is retried, a slow Re-read waits instead of giving up, a rewind after a middle delete replays correctly, a Continue whose block was split is read, and Equip on… respects the carry limit.

**Player guide**
- "Checks and modifiers" now tells the same-reply dice (F80). The old Roll button is gone from the guide.
- New sections: "Using things in the story" (F96) and "Economy and currency".
- Quests are described as story-led, with no quest buttons (F94, F95).
- The Ersveil pack is set up with **Import pack file** in the Packs panel.
- We recommend a SillyTavern chat backup interval of at least 5 minutes.
- New sections: ranks, foes and companions; effects that wear off; the day digest; money scale and quest pay in "Economy and currency"; update Story Block first.

### Known issues

- Fixed since alpha.2's list:
  - high written quest ranks (Story Director #89, #91);
  - save cost, now halved by storage tuning (#108);
  - balance (RPG Battle #96);
  - `+ item` past the carry limit, which now makes the party encumbered (#104).
- The rest of alpha.2's list still holds: see "Known issues" under 2.0.0-alpha.2 below.
- The story's `rank:` on a foe is read, but the fight instructions don't mention it yet.
- Deleting a reply in the middle of a day that already has its digest leaves that digest as it was written.

### Module versions

| Module | `v2` head | Version | `requires` |
|---|---|---|---|
| Story Block | (at the beta candidate) | 2.0.0-beta.1 | — |
| RPG Battle | (at the beta candidate) | 2.0.0-beta.1 | `storyBlock >=2.0.0-beta.1` |
| Story Director | (at the beta candidate) | 2.0.0-beta.1 | `storyBlock >=2.0.0-beta.1` |
| NPC State Delta | (at the beta candidate) | (see its bump PR) | `storyBlock >=2.0.0-beta.1` |

## 2.0.0-alpha.2 (2026-10-22, baseline)

**The alpha.2 baseline.** This records where all four modules stand after the feature freeze (F103), two break rounds and their fixes. **Beta is now in progress, built in waves A–E.** The queued features below are being built as part of beta, and the full combined test moves to beta.

Still for test play only. Don't use it for your real campaigns yet.

### What's new since alpha.1

**Quests follow the story** (F82–F88, F94, F95)
- There are no quest buttons now. You take a job in your own words ("I'll take the rat job").
- When the story turns a quest in, code checks the goal and the place in the same reply.
  - If both are met, it pays the reward once.
  - If not, the quest stays open and the next reply is told why.
- Every quest needs a goal. Code counts goals it can count, like foes beaten or items carried. For other goals, the story says when they are met.
- The Quests screen shows where each quest stands (Offered, Not yet, Ready, Ready to turn in here), with a Details pop-up.
- Rewards stay inside the quest's rank. A pack can set its own rank ladder; Ersveil's runs from F Registered to S Legend.
- New quests come at a slower pace.

**Checks in the same reply** (F80)
- Two d20s are rolled before each reply. The model sees them with a modifier table that code builds.
- The story uses the dice and narrates the outcome. Code works the result out again and records it.
- If the story's result doesn't match the dice, the card under the reply flags it.
- A reply can hold at most two checks, and a swipe brings fresh dice. There is no Roll button any more.

**Using items in the story** (F96)
- The story writes `! use Healing Salve | on: Wessel` and code applies the item's effect.
- If code refuses (full HP, not in the bag), the item stays in the bag and the story is told why.
- During a fight, a use becomes your fight action.

**RPG Battle**
- Fights always settle. A draught is used up at the moment it is drunk.
- During a fight, every view shows the same HP.
- Loot uses the pack's items and joins stacks you already have.
- Party:
  - There is a carry limit, and the party size is capped.
  - You can switch companions' growth and control on or off.
  - You can export your character to a file and import it again.
- Trade: the market can run short of goods, and pack shops (like Watch Stores) are used. Sale prices follow item value.
- A fight's tier (weak, even, strong…) is a threat budget for the whole group. Extra foes past the budget hang back, and the fight's receipt says so.

**Story Director**
- **Chronicle:** world events and factions. Up to three events still under way are in each reply's notes.
- **Map:**
  - Every known place is drawn, including places not visited yet.
  - You can pan and zoom (with the wheel, by dragging, by pinching, or with the keys).
  - Search finds places even when you misspell them.
  - A place's details show how long the trip takes.
- The Director header shows the story clock.

**NPC State Delta**
- NPCs have meters: trust, affection, desire and tension, plus up to six meters of your own.
  - Meters have stages, and hidden notes unlock when a meter passes a set value.
  - The story moves a meter with `~ npc Fenna | trust: +10`, and code holds it inside the meter's limits.
- The meters show in the Cast tab.
- When Story Block v2 is installed, NSD steps aside: its own launcher and in-chat cast are hidden.
- Its code was cleaned up in 16 PRs. Its prompts are byte for byte the same as before.

**Story Block**
- Under each reply you now see:
  - a note when it held no change lines, with a Re-read button;
  - the lines code did not apply (for example "1 line not applied").
- Other UI changes:
  - Home comes first in the navigation.
  - Times use the story's calendar.
  - Alt+G opens the game view.
  - There is a status strip, and reduced motion is respected.
- Saving:
  - A save always goes to the chat it belongs to.
  - A failed save never drops your turn.
  - Each reply writes the chat file one time fewer than before.
- Deleting a reply in the middle of a chat takes back only that reply's changes. Counts move correctly, and later replies keep theirs.
- Updating a module keeps its data. Modules state which Story Block version they need (`requires`), and the version is now 2.0.0-alpha.2.
- Limits:
  - One reply can give only so much in money and goods.
  - Change lines are read in linear time.
  - Screens and templates have depth caps.
  - Change blocks drafted inside the model's reasoning are ignored.
- Packs can now hold `terms` and `ranks`.

### Break rounds

**Round 1 (b1–b7).**
- Six reports found 87 problems:
  - capture: 17
  - timeline: 11
  - economy: 20
  - combat: 14
  - robustness: 13
  - versions and combos: 12
- All 87 are fixed.
- b5-security was stopped early and replaced by b5b-robust. The 1500-reply soak (b6) filed no report.

**Round 2 (re-break on the fixed code).**
- Round 1's fixes held, with a few exceptions:
  - capture: some fixes held only mostly;
  - economy: 8 of 20 held only mostly;
  - robustness: two fixes came back and were fixed again;
  - versions and combos: one fix is partial and one was docs-only.
- 44 new findings:

  | Run | New | By severity |
  |---|---|---|
  | b1 capture | 14 | 2 crit, 5 high, 4 med, 3 low |
  | b2 timeline | 3 | 1 high, 2 med |
  | b3 economy | 7 | 1 crit, 3 high, 3 med |
  | b4 combat | 8 | 2 high, 2 med, 1 low, plus 3 balance questions |
  | b5b robustness | 8 | 4 med, 4 low |
  | b7 combos | 4 | 1 high, 1 med, 2 low |

- 41 are fixed:
  - Story Block #86–#91
  - RPG Battle #85–#87
  - Story Director #86–#87
  - NPC State Delta #190
- The 3 balance questions are decided (below) and are being built in beta wave C.
- The main lesson from round 2: anything a later reply writes is now kept by reply ID. Each repo's CI now runs a "delete a middle reply" fuzz test.

**Round 3 (confirmation, stopped early so beta could start).**
- Capture (b1): all 14 round-2 findings hold; nothing new.
- Economy (b3): all 7 round-2 findings hold; nothing new. A 300-step conservation checker ran clean on 12 honest seeds and 8 of 12 cheat seeds.
- Timeline (b2) and the long soak (b6) were wound down; what they found goes into the combined beta round.

**Fixed after the live test:** the Packs panel refused the Ersveil pack (Story Block #94), and quest payouts said "50 mark" instead of "50 marks" (Story Director #88).

### Known issues

- **A big fight offer can be cut down:**
  - A weak offer can field fewer foes than the story wrote. The rest hang back, and the fight's receipt says so.
  - A hunting quest that asked for all of them then needs another story encounter.
- **NPC State Delta:**
  - The Cast tab shows only NPCs that have a dossier. A meter the story sets for someone without one shows only after a scan or a manual add.
  - A new chat logs a harmless 404 once per page load.
- **Save cost grows with the chat.** Each action you take is saved before you get an answer, and the whole chat file is written each time:

  | Chat length | File size | One save |
  |---|---|---|
  | 50 messages | 0.13 MB | 13 ms |
  | 500 messages | 1.2 MB | 97 ms |
  | 3000 messages | 7.3 MB | 551 ms |

  Storage tuning (checkpoints, records kept once, receipt trimming) is being built for beta.
- **Two browser tabs on one chat:** the tab that saves last wins.
- **Switching chats while a reply streams in:** SillyTavern throws its own TypeError (not ours).
- **Change lines:**
  - `+ item` ignores the carry limit; only raising a count with `~` checks it.
  - If a reply is cut off by the length limit and its half-written last line still makes sense, that line is read.
- **Balance** (being fixed in beta wave C):
  - Lone foes miss their targets.
  - A group's size is weighed but not the creatures' power.
  - Weak and deadly don't scale at level 20.
- **High written quest ranks:** a story-vouched quest written as `rank: S` is held to one rank above the party, which can still pay up to 3000 in one reply at levels 1–6 (about 7.5× the per-reply coin budget). Under review.
- **Docs:** the player guide's "Checks and modifiers" section still describes the old Roll button.

### Decisions made

1. **Save cost:** storage tuning.
2. **RPG Battle balance:** each tier plus a power value per creature (lone foes included), checked by a level-band simulation, with a stun rule and a floor for bosses. The party's build is not looked at.
3. **NSD prompt changes:** steps 12–13 and the group-chat role words are approved.
4. **NSD one-pass calls:** relationship passes are skipped while Story Block hosts NSD; a backfill runs only on its schedule or when you ask.
5. **NPC revival:** the model's output never brings an NPC back.
6. **Two tabs on one chat:** the last writer wins (accepted).
7. **The frozen feature queue:** all of it goes ahead, in beta waves A–E.

### How to test

1. Use a separate SillyTavern profile on SillyTavern 1.19 or later.
2. Install Story Block, RPG Battle, Story Director and NPC State Delta from their `v2` branches.
3. Set up Ersveil with `docs/v2/ERSVEIL.md`.
4. Player guide: `docs/v2/GUIDE.md`. Status: `docs/v2/STATUS.md`.

**Live test of this baseline (SillyTavern 1.19, mock model, Ersveil pack):**
- These work:
  - Replies are held until a character exists, and the creation wizard opens; the pack's ready-made character works.
  - One reply's change lines reach all four modules.
  - Quest:
    - A quest offer is taken in the reader's own words.
    - The fight starts from the Fight button and finishes on Auto.
    - The story turns the quest in, and code pays 50 marks; the next reply is told.
  - A check uses the dice rolled before the reply, and a wrong narrated result is flagged.
  - The story uses a salve and the character gets +10 HP.
  - A chat switch right after a button press loses nothing.
  - These follow correctly: a swipe, deleting a middle reply (the state matches a rebuild from the saved file), and going back in time (a branch).
  - The fixed part of the prompt is byte-identical in every request; requests share a prefix of about 83% (median).
  - The NSD Cast tab shows meters and leaves other tabs alone.
  - The map's search and zoom work, and so does the Chronicle tab.
  - The page logs no unexpected errors.
- This failed: the pack import, now fixed in Story Block #94.

**Versions in this baseline:**

| Module | `v2` head | Version | `requires` |
|---|---|---|---|
| Story Block | c93d9b6 | 2.0.0-alpha.2 | — |
| RPG Battle | 924b9a3 | 2.0.0-alpha.1 (bumped when tagged) | `storyBlock >=2.0.0-alpha.2` |
| Story Director | 5b44f3b | 2.0.0-alpha.1 (bumped when tagged) | `storyBlock >=2.0.0-alpha.2` |
| NPC State Delta | 676d30f | 1.2.19 | `storyBlock >=2.0.0-alpha.2` |

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
