# RPG

The RPG is an optional part of Story Block for light combat and character growth. It keeps a party sheet
for you and each companion, rolls the dice for fights and checks, and raises Soul Class and skill ranks as the
story goes on. It is off by default, and with it off Story Block works exactly as before.

## Turning it on

Open **Settings → Features** and switch on **RPG**. A page of its own, **Settings → RPG**, appears under Features
(see [Settings → RPG](#settings--rpg)). With **Rolls: automatic** (the default) the dice are rolled for you; with
rolls **off**, the narrator still tells the story, but no dice are rolled and no battle log is drawn.

Make your characters with **New character** on the Party tab (see [Making a character](#making-a-character)); in a new
chat Home and the first Send ask you to make yours (see [A new chat](#a-new-chat)). To build
a sheet by hand instead, use **Settings → Blocks**: choose **From a template**, then a template from the **RPG** heading
(see [The four templates](#the-four-templates)). Make one Character block for each character in the party, and
one Skills block for each of them that has skills. Foes is one block for the foe groups in a fight. Combat rules is
one block for the whole chat and carries the combat text.

## The Party tab

With the feature on, the **Party** tab shows one card for each Character block: the name, the Soul Class and XP,
the three stage bars, the seven stats in a row and the skills with their ranks. When a character has unspent
points, the card offers **Spend points**, which opens the stat view with steppers under the point budget. **Stats**
opens the same view for the stats alone, and **Skills** opens the character's [Skills view](#the-skills-view). **Export**
saves the character to a file (see [Export / Import a character](#export--import-a-character)). **+ New
character** in the header opens the wizard; with no character yet the tab says so and offers **Create your character**.

A companion who left the party (see [Companions who join](#companions-who-join)) keeps their card, greyed, with a **Left** tag.

Edits made here ride on the latest reply, like any other pencil edit: swipe or delete that reply to take them back.

## The Fight tab

The Fight tab takes the place of the Foes block's own tab, and shows only while a foe slot is filled. The header reads
**Fight · <place>** (the scene's place, when there is one) with two pills: **Exchange N**, from the latest rolls, and
**N foes · M down**. Under it are a card for each foe (name, Class, a five-cell health bar, greyed when Down; tap the bar,
or its pencil, to set the foe's health from Down to Unhurt, the same way as on the Party card), a card for each character with the three stage bars, and **Last exchange**: the battle log of the latest
reply that was rolled. **See it in the story** closes the game view and scrolls the chat to that reply.

## Making a character

**+ New character** opens a window with four steps and a summary of the character so far on top.

1. **Who.** The name (your persona's by default), whether this character is **You** or **A companion**, and who they
   are (up to 240 characters, which the narrator reads on every reply). A story has one You: the party shows you as the
   character named like your persona, so You takes that name and a companion cannot. A You also starts with your active
   persona's description in **Who they are** (its first 240 characters, never splitting a character), with the note
   "From your persona's description (the first 240 characters). Change it freely: this is what the AI reads." Only the
   active persona's description is read, never another persona or any other setting. It is only a start: a companion's
   box starts empty, switching to **A companion** empties it again while it is still the persona's text, and anything
   you type is yours.
2. **Stats.** The same steppers and radar as Spend points. On the **Standard** formula (the default) every stat starts at 5 and you have
   10 points to spend; a stat can go down to 3 to free a point and up to 10, and a line under the steppers says what the next points
   buy: `Health 5 blocks (next at VIT 10) · Stamina 4 (next at AGI 10) · Mana 4 (next at INT 10) · Luck −1 (next at LUK 8)`. On **Classic**
   every stat starts at 10 with 6 points to spend, from 8 to 15. Points you leave unspent stay on the character for Spend points. Spend
   points shows the same line and keeps it up to date as you move the steppers.
3. **Skills.** Start from a template (Guild fighter, River scout, Hedge mage, Field medic, Silver tongue, and the sets a
   pack adds) or write your own. Up to five skills, each with a name, what it does (up to 120 characters, which the
   narrator reads), the **Stat** it rolls with, what it **Uses** (stamina or mana) and what it **Starts at**: Novice, or
   Adept for one skill at most. Rank and practice are never typed in.
4. **Review.** Everything in one place. **Create** makes two blocks, the Character block (named for the character) and the
   Skills block ("Wessel's skills"), each with one action, so a creation costs two of the reply's changes. If the second
   cannot be made the first is taken back and nothing is left half made. The window says what is in the way in plain
   words, for example a name that is taken or a story that already has eight blocks. When the chat has no
   [Combat rules](#the-four-templates) block and/or no Foes block, Create also makes the missing ones from the stock
   templates (one more action each, on the same reply, so one swipe takes everything back), and the Review says
   "Also adds: Combat rules, Foes" (only the ones missing). A chat that has them already adds nothing. If the chat has no
   room (the eight-block limit) or the reply has no actions left, the character is still made; the Review says which block
   will not be added, and after Create the window stays to say which one was not added and where to add it later
   (**Settings → RPG → Add the Combat rules block**, or **Settings → Blocks**). A chat that was already started is left as
   it is until you make a character in it.

**Start from a saved character.** The Who step begins with an **Import file…** row; see
[Export / Import a character](#export--import-a-character) for what a file brings and what **Create** then adds.

The Stats step is one card: the steppers in an even grid (the stat above, its stepper below) with the radar beside it, or
two columns of steppers and the radar below on a phone. The points left show once, in the summary row at the top.

## Export / Import a character

A character can travel between chats as a file. It carries only what a new character can start from: Soul Class, unspent
points, the seven stats, the skills (and, if you leave them on, the things the character carries and the money).
It never carries the name, whether they are You or a companion, who they are, XP, Health, Mana or Stamina, skill practice, or
anything about the story. Both buttons exist only while the RPG is on.

**Export.** **Export** on a character's card, next to **Spend points** and **Skills**, opens **Export <name>**:

- **Character** (always): the Soul Class, the unspent points, the seven stats and up to five skills (name, what it does, stat,
  Stamina or Mana, rank). A skill whose block has no stat of its own (an old Skills block) is saved without one: a stat is never guessed.
- **Inventory** (a checkbox, on): the things that character carries, as the Inventory tab lists them: names, counts and notes,
  with the kind and rarity each has. A You carries what is in the party's bag; any character also carries what the party
  actor of the same name holds, when a party module lists one. Nothing carried: the box is off.
- **Money** (a checkbox, on; only on your own You card): the purse as its value in the money's smallest unit, so another game's
  coins show the same value in their own words ("50" is 5 silver where silver is worth 10 and 50 crowns where there are no coins).

**Save** writes `<name>.character.json` (the name in lower case, letters and digits). The file is plain JSON:

```json
{ "storySuiteCharacter": 1, "soul": 2, "points": 3,
  "stats": { "str": 14, "vit": 12, "agi": 11, "dex": 10, "int": 8, "luk": 9, "cha": 10 },
  "skills": [{ "name": "Iron Breath", "about": "Steadies the lungs.", "stat": "vit", "uses": "stamina", "rank": 2 }],
  "items": [{ "name": "Oilskin Coat", "qty": 1, "note": "waxed", "kind": "equipment", "rarity": "uncommon" }],
  "money": 50 }
```

`items` and `money` are there only when left on. A file is checked when it is read, with the RPG's own limits (Soul Class 1 to 9,
points 0 to 60, stats 1 to 20, at most five skills with a rank from 0 to 3, names and text cut to the fields' lengths, at most 60
things with a count of 1 to 999, money a whole number up to 1,000,000,000, the whole file under 64 KB). A skill's `stat` may be missing or null; any other value that is not a stat refuses the file. Keys it does not know are ignored. A
file that does not pass is refused with one plain sentence ("This is not a saved character file.", "The file has no valid STR (1 to
20).") and nothing is filled.

**Import.** In **+ New character**, the Who step starts with **Start from a saved character … Import file…**. After a good file the
step shows "Imported from wessel.character.json: stats, 3 unspent points, Soul Class II and 2 skills", with **Undo import**, and:

- The **stats**, the **unspent points** (the pool the stats are spent from), the **Soul Class** and the **skills** are filled. The Stats
  and Skills steps show them and keep the usual rules: a stat can go down to 8 to free a point and up to 15 (a saved stat outside that stays
  where it was), a skill can be renamed or changed, a skill can be added or removed. Picking a skill template while imported skills are there asks "Replace the imported skills? Their ranks will be lost." with **Replace** / **Keep**. A skill the file gave with no stat shows an empty **Stat**, and the Review's "Fix this first" asks for it ("Iron Breath needs a stat."), like a missing "what it does" line. A skill's **rank** comes from the file and cannot
  be changed here; practice starts at 0.
- The **name**, **You or A companion** and **who they are** are not touched. XP is 0 and Health, Mana and Stamina start full.
- **Undo import** puts back what was there before the file (what was typed since stays). Closing the window without Create leaves nothing behind.
- The Review adds "Also adds: 3 things to the party's bag · 5 silver to the purse. One swipe of this reply takes it all back." for what the
  file had (the money in this chat's coins, with thousands separators, e.g. "10,000,000 gold"). It says "3 things carried by Ren" only when a party actor of that name will hold them.

**Create** makes the Character and Skills blocks as before (with the file's Soul Class, points, stats and ranks as their defaults) and
then, as more changes of the same reply:

- one `inventory.add` for each thing the file carried, to the new character's owner (a You: the party's bag; a companion: the party
  actor of that name when a party module lists one, else the party's bag). A thing that is new to this chat is made with the kind and
  rarity the file kept; one the chat already has is the chat's own and is not changed;
- the purse raised by the file's money.

All of it rides on the latest reply like the blocks do, so one swipe takes it all back, and a reload or rebuild gives the same story. The
usual limits apply: the carry limit, the eight-block limit, the reply's block actions. Anything that cannot be added is named in the window,
for example "Ren is in the party. Not added: Torch ×2 (The party cannot carry that much.); the money (…)." and the character is still made. If the
character itself cannot be made, none of the file's things or money are added.

## A new chat

With the RPG on and no character for you in the story (a character named like your persona), Story Block asks you to make
one, in two places. Neither is there with the RPG off, and neither changes anything a reply is told.

- **Home** shows a **Your character** card at the top: "The RPG is on, and this story has no character yet. Make yours to roll
  for what you do; your persona fills in the name and who you are." **Create your character** opens the New character window.
  **Not now** hides the card for this chat (kept in the chat's own metadata, not in the game, so a swipe or a rewind does not
  touch it); the Party tab's own **Create your character** stays. The card is gone as soon as you have a character, and a
  story that has only companions still shows it.
- **The first Send** is held. When you press Send (or Enter, where SillyTavern sends on Enter) with a message in the box, the
  message stays in the box and **Make your character first** opens, with your message quoted. **Send without the RPG for now**
  sends it as usual, with no dice for that reply, and the chat is never asked again (the Home card still reminds you).
  **Create your character, then send** opens the New character window and sends the message when you press Create; if you
  close the window instead, the text is still in the box and the next Send asks again. Closing the dialog also leaves the text
  in the box. On a phone the dialog is a bottom sheet. Only a normal Send is held: a swipe, a regenerate, a continue, an
  impersonation, a quiet or dry run, an empty box and a slash command are not.

A new chat that has no Combat rules block or Foes block gets them when its first character is made: by **Create** in the
wizard, or by Add to party when that is the story's first character (see [Companions who join](#companions-who-join)).
Nothing is added to a chat before that.

## Companions who join

When the story says someone joins the party for good, the narrator writes one line, and Story Block can make their character.
**Settings → RPG → Companions who join** says what it does with it: **Ask** (the default), **Automatically** or **Off**.

```
+ party Mara | about: a hedge-witch from Kvildal | class: I | best: int
- party Mara
```

`about` is up to 240 characters, `class` is a Soul Class from I to IX and `best` is one of str, vit, agi, dex, int, luk, cha;
the last two are optional. The line is in the narrator's instructions only while the RPG is on, the story has a Character block
and the setting is not Off; with the RPG off, nothing is told and nothing changes.

- **What is made.** A Character block (a companion) and an empty Skills block for that name, as one action of the reply: every
  stat 10 with the named best stat 14, no unspent points, Health, Mana and Stamina full, and the Soul Class as written but never
  above the highest Soul Class among those in the party. On the Standard formula every stat is 5 and the best stat 9, and each Soul
  Class above I adds the points per Soul Class (4), one at a time to the best stat and DEX in turn up to 20, then to VIT, AGI, INT, CHA,
  LUK and STR, so no point is left over. The skills fill in when the story has them learn something, as for
  anyone.
- **Ask.** The line makes nothing. The reply gets a card, "Mara joins the party", with **Add to party** (makes them as above),
  **Edit first** (opens the New character window filled in: name, about, Soul Class, the best stat raised to 14; you spend the
  rest) and **No** (dismisses it). The card is read from the reply's own record, so a swipe or a delete takes it away and nothing
  is kept in the game for it.
- **Automatically.** They are made at once and listed in "Changed this reply" ("Mara joined the party"). Like every other line of
  the reply it is taken back by a swipe or a delete, and a Re-read makes it the same way.
- **The first character.** Normally the wizard has made yours first. When Add to party (or an automatic join) makes the story's very
  first character, the Combat rules and Foes blocks the chat lacks are made in the same action, as far as they fit.
- **`- party Mara`.** Marks that companion as **Left**: kept on the Party tab, greyed, no longer rolled for, never deleted. A line that names
  your own character (the one named like your persona) is refused with one line in the Problems list: only companions leave. A later
  `+ party Mara` brings the same person back (with the sheet they left with), whatever the setting says. A sheet made before the
  **Left** field existed cannot be marked, and the line says so.
- **Refused plainly**, with one line in the Problems list and nothing made: the name is already in the party, the party is full
  (8 characters, counting those who left; a story holds at most 8 blocks of its own, and a companion takes two, so the blocks
  usually run out first), there is no room for two more blocks, or the reply has used all the block actions it can take. A class
  that is not I to IX, a `best` that is not a stat and a line with no name are refused the same way.

## The Skills view

**Skills** on a character's card opens that character's skills in place of the cards (**Back to the party** returns). Each skill
shows its name, its rank, the stat and resource it uses, what it does, a mastery bar and the roll it makes now:
`Rolls with it: d20 +12 = VIT 12 → +6 · Expert +2 · Soul Class II +4`. The bar has four cells, one more lit for each rank, with
the next one filling as practice grows; its colour follows the rank (Novice grey, Adept blue, Expert purple, Master green).
Empty slots show a dashed line and are filled when the story has the character learn a skill.

The pencil on a skill fixes its name or what it does, and nothing else: rank and practice only move through play (a swipe takes
them back), and a skill's stat and resource are fixed by its Skills block.

## Stage bars

Health, Mana and Stamina are words, not numbers, and each word is drawn as a bar that shows how full it is.

| Health | Mana | Stamina |
|---|---|---|
| Unhurt, Scratched, Hurt, Wounded, Badly wounded, Down | Fresh, Steady, Low, Drained, Empty | Fresh, Winded, Tired, Spent, Empty |

Stamina and Mana come back to Fresh when the character rests: the **Rest** button on the Character block sets both
to Fresh. Health only goes back up when the story heals it.

## Rolls

With rolls on, the narrator's next reply is planned first. The planning step reads what you wrote, picks the actions
and checks for the reply, and the dice are rolled for them. The result is drawn as a battle log in the reply, with
one short line per action, for example `Wessel uses Short blade on Sluice Rat A — Success (26 vs 16)`. Tap a line to see the numbers.
A foe's attack reads from the foe's side: **Hit** (red) when it gets through, **Grazed** (amber) when it costs you, **Blocked**
(green) when you stop it, with the foe's total first. The Status bars are coloured by stage, like the Party tab's.

**The roll rule (Classic).** The rest of this section describes the **Classic** formula; the Standard one, the default, is described in
[The stat formulas](#the-stat-formulas). A character's roll is `d20 + half the stat (rounded down) + skill rank + 2 × Soul Class + edge`, against
the foe's `d20 + 5 + 2 × the foe's class`. The rank is 0 for Novice up to 3 for Master, and the edge (from minus 3 to
plus 3) is what the situation earns, such as an ambush. That is the **Standard** difficulty; the numbers 5, 2 and
"half" can be changed in [Settings → RPG](#settings--rpg). "Half the stat" can also be "a third of the stat", or
**full above 10**: the stat minus 5 (a stat of 10 adds 5, 14 adds 9, 20 adds 15, 8 adds 3). Whichever is chosen is the stat's
bonus everywhere: checks, attacks and defence.

- **A skill brings its own stat and resource.** An action that uses a skill the character has rolls with that skill's stat
  and spends that skill's resource (stamina or mana), whatever the planning step wrote. If the resource is Empty the action
  is rolled without the skill: same stat, rank 0.
- An action with no skill rolls the stat the planning step picked, at rank 0. So does an action that names a skill the
  character does not have, and the log says so. If there is no stat at all (a skill the character lacks and none given, or a
  skill from an old Skills block that has no stat of its own) the roll uses the character's best stat, untrained, and says so.
- **A skill can count when you defend.** When a foe attacks, the planning step may name one of the defender's skills if it
  plausibly fits (a parry, a dodge, a shield, a counter-draw): `foe Sluice Rat A | target: Astra | defend: AGI | skill: Iaijutsu`.
  It is resolved like an action's skill: the skill's own stat wins over `defend`, its rank adds, an Empty resource rolls without
  it (with the same plain note), and a skill the defender does not have is rolled untrained with the `defend` stat. The cue and
  the battle log name it (`Sluice Rat A attacks Astra (Iaijutsu) — Blocked (24 vs 18)`). With no skill the defender rolls the `defend`
  stat at rank 0, as before; a roll made before this existed reads and tells exactly as it did. A stat or resource the pack hides
  still counts and is not named.
- **Each action has dice of its own.** The dice belong to the action's place in the plan, so an action that is refused (a
  character who is Down) or comes back later never moves another action's dice. A plan whose every line names nobody on the
  sheet counts as a failed plan, not as "no rolls": the narrator is told to keep the fight undecided.
- **The narrator always gets the rolls.** The roll cue is kept whole when the notes are trimmed to fit, and is shortened to
  stay under 600 tokens (fewer exchanges first, then shorter check and refusal lines, then shorter names). Shortened names
  stay different from each other (a cut name keeps the end of the name when its beginning is the same as another's). A roll made
  by an older build, whose record has no dice version, is shortened the way it was then, so a Re-read tells what it told.
- **Foes.** A foe slot counts as filled with a name and a count above 0, in the Fight tab and for the planning step alike, and
  every Foes block in the story is read.

- A **swipe** rolls again: the reply and its dice are new, and made with the numbers the settings say then.
- **Re-read** keeps the same dice, and the same numbers (see below).
- Changes made by a roll, and any level-up, appear under **Changed this reply**.

**Past rolls never change.** The numbers a roll was made with are recorded in the roll itself. A Re-read, a rebuild and
a reload roll it again with those numbers, never with today's settings. Changing the difficulty, or anything else on the
Settings page, only changes the rolls made after it.

## Settings → RPG

The page has six cards, and shows only while the RPG is on.

- **Stat formula.** **Standard** or **Classic** (see [The stat formulas](#the-stat-formulas)), with the roll table of the one in force
  and four numbers: where stats start, the points at creation, the points each Soul Class gives and the foe's base (`4 + 3×class` on
  Standard). A chat that never chose is on Standard. Rolls already made keep the formula and numbers they were made with.
- **Rolls.** **Automatic** or **Off**, as above.
- **Difficulty.** **Gentle**, **Standard**, **Harsh** or **Custom**. On the Standard formula the presets move only the foe's base (2, 4 and
  6) and **Custom** shows its thirteen numbers; the paragraph below is Classic's. The presets change the foe's base and how far short
  a roll may fall and still be "success at a cost": Gentle is a base of 3 and a window of 3, Standard 5 and 2 (the rule
  above), Harsh 7 and 1. All three keep a Soul Class worth 2, half the stat, a decisive margin of 8 and at most 5 exchanges
  a reply. **Custom** shows the six numbers: **Foe's base** (0 to 15), **Soul Class adds** (×1, ×2 or ×3, for both sides),
  **Stat adds** (half the stat, a third of the stat, or full above 10), **"At a cost" when short by** (0 to 5; 0 turns it off), **Decisive at a margin
  of** (4 to 15, or a natural 1 or 20) and **Most exchanges per reply** (1 to 8). A number outside its range is held to
  it. Under the numbers a bar shows the exact chances of success, success at a cost and fail for your own character (the
  persona's name, else the first Character block) with their best skill, against a foe of their Soul Class, and it
  changes as you type. A line under it gives the other presets for the same fight.
- **What the narrator is told about combat.** The text of this chat's Combat rules block (up to 1200 characters, counted
  as you type). It is saved when you leave the box (or close the settings window with text still in it), as an edit of that
  block on the latest reply: swipe or delete that reply to take it back. A chat keeps a limited number of block versions;
  when it has kept as many as it can, the box says so in plain words. **Reset to the default** puts the template's text back (a Standard chat's
  default also explains the roll types and that code moves the Health bars for rolled hits). Each chat has its own text; a new chat
  starts from the default. A chat with no Combat rules block says so and offers **Add the Combat rules block**.
- **Roll planner.** Your own instructions (up to 400 characters) for the short call that plans the dice, added after its
  fixed part. **Show the planner's full prompt** shows exactly what that call is sent for this chat, read-only: the format
  of its answer stays fixed so the dice can be read.

- **Companions who join.** **Ask**, **Automatically** or **Off**, as in [Companions who join](#companions-who-join).

With the RPG off none of this is read or sent.

## The stat formulas

A chat plays on one of two formulas, chosen in [Settings → RPG](#settings--rpg). **Standard** is the default for a chat that never chose.
**Classic** is the formula described under [Rolls](#rolls), exactly as it was. Every roll records its formula and numbers (see "Past rolls
never change" above), so switching only changes the rolls made after it.

### Standard

A roll is one of five types. Class is 2 × Soul Class; rank is 0 (Novice) to 3 (Master); the edge is what the situation earns (−3 to +3)
after luck. `(A + B/2)/2` is rounded down once, at the end.

| Roll | d20 plus |
|---|---|
| Physical | class + (STR, or the skill's stat, + DEX/2)/2 + rank + edge |
| Magic | class + (INT, or the skill's stat, + DEX/2)/2 + rank + edge |
| Defence | class + (the higher of AGI and VIT + the lower/2)/2 + rank + edge; against a spell the higher of INT and VIT; a tie dodges |
| Social | class + (CHA + INT/2)/2 + rank + edge |
| Check | class + (the fitting stat + DEX/2)/2 + rank + edge: STR to climb or force, AGI to sneak, DEX for locks, INT for lore, VIT to endure |

A skill's own stat takes the main slot and nothing is added on top. A skill that uses Stamina is physical and one that uses Mana is magic,
unless the planner marks the action defence, social or a check. A skill whose resource is Empty is rolled without it: no skill, rank 0 and
the type's own stat.

- **Luck.** LUK 13 gives +1, 16 gives +2, 19 gives +3, and 7 or less gives −1. A bad edge shrinks toward 0 by good luck (never past 0) and a
  good edge grows by it; bad luck does the opposite. An even situation is left alone.
- **Foes.** A foe adds `foeBase + 3 × its class` to its d20 (the base is 2, 4 or 6 for Gentle, Standard and Harsh). A foe group has Health
  `4 + class/2` blocks and acts once a round whatever its count.
- **Hits.** A hit takes 1 block of Health from its target, a decisive hit 2. A party member's action hits on a success or a success at a cost;
  a foe's attack hits when the defender fails. Decisive is the winner's natural 20, the loser's natural 1, or a lead of 8. Code writes the
  new Health to the sheet and tells the narrator which bars it moved, in words ("Health now: Wessel Hurt; Sluice Rats Down"), never to set
  them for a rolled hit or heal. Bars are clamped to their size (`blocksFor`: Health 4 + VIT/5, Stamina 3 + AGI/5, Mana 3 + INT/5).
- **Area.** An area skill rolls once against each standing foe group's own roll; each group's bar moves on its own.
- **Support.** A heal or a buff rolls against a difficulty (easy 10, normal 15, hard 20, very hard 25): a success gives 1 block, a decisive
  one 2, never past the bar. Someone who is Down can be mended.
- **Social and exploration in a fight** are rolled against the foe's roll and hurt nobody; outside a fight they are checks against the
  narrator's difficulty.
- **Turn order.** At the start of a fight each character rolls d20 + class + AGI/2 and each foe group d20 + 2 × class; highest first, ties to
  the higher AGI, then to the party. The order is kept for the whole fight: each reply's roll carries it on (a swipe of a later reply keeps
  it; a swipe of the reply that began the fight rolls it again; a Re-read keeps it), and someone who arrives later rolls on entry. A foe or
  a character who is beaten or Down before their turn does not act that round, and the fight ends in the roll when a side is gone.
- **Quick start.** A character who is 10 or more ahead of a foe in the order acts once against it before the first round, at the start of the
  fight only.
- **Creation.** Stats start at 5, with 10 points to spend, from 3 to 10; each Soul Class gives 4 more points; a stat never goes above 20.
  Companions the story brings in are made on the same scale (see [Companions who join](#companions-who-join)).

The numbers behind the presets were chosen with `node scripts/sim-standard.mjs` (no network): at Standard a focused build (the skill's stat
and DEX at the creation maximum, then 3 and 1 points a class) succeeds about 61 times in a hundred against a foe of its own Soul Class at
Soul Class I and 72 to 79 from III to IX, near Classic's own 52 to 81; a spread build succeeds about 43 to 52 times. A hero against one
foe of the same class ends the fight in about 4 to 6 exchanges.

A pack may name the formula and its numbers (`content.rpg.formula`, `content.rpg.numbers`); they are the default for a story whose reader
has not chosen a formula or a difficulty, and the reader's own choices win.

## Soul Class and skill ranks

**Renaming it.** The Character block's Soul Class field can be renamed (Settings → Blocks → Edit, or a pack's template): a different
label such as "Level" and different names such as 1 to 9. Everywhere the RPG shows it, it uses the field's own label and names from
that character's Character block, and falls back to "Soul Class" and I to IX: the Party card, the Skills roll line, "Changed this reply",
the New character window, the companion card and its refusals, Settings → RPG (the odds line and "Soul Class adds" use your own
character's block), the battle log and the roll planner's party list (`Wessel (Level 3)`). A new character made by the window or by a
`+ party` line copies the template, so it keeps "Soul Class" unless a pack's template renamed it. With the default names nothing is
different from before, in the screens or in what the narrator and the planner are sent.

These rise on their own, with no confirm step.

- **Soul Class** runs I to IX. At 100 XP the Soul Class goes up by one, XP starts again at 0 and the character gets **3 points to spend**
  on stats (the points never go above 60). "Changed this reply" says so ("+3 points to spend"), and the Party card offers **Spend points**.
  At IX, XP stops at 100 and nothing more is given. The 3 points are part of the Character template's rise rule, so they apply to
  characters made from 2.9.1 on, including companions who join. A block carries its own copy of its rules, so a character made earlier
  keeps the rule it has and gets no points with a rise; give an older character points with the pencil on **Points** in its Character block.
- **Skill ranks** run Novice, Adept, Expert, Master. At 100 practice a skill's rank goes up by one and practice starts
  again at 0. A Master keeps practice at 100.

The narrator gives XP and practice with lines in the story. The Combat rules block suggests how much: a small fight
5 to 15 XP, a hard fight 20 to 40, a boss 50 or more, and 5 to 20 practice for each use of a skill.

## Down and death

A character at 0 health is **Down**. If a character is still Down at the end of the reply after that, the
character dies: their Alive field turns off and **The story ends here** appears under the reply. Being Down for
one reply is not death, so a fight that ends with someone Down can still be healed.

To take a death back, swipe or delete the reply that ended the story. Story Block then restores the character's
state from before that reply.

## The four templates

Each template is a block definition. Its fields are named so that the RPG can read them; you change its values
with the pencils on the block.

| Template | What it holds |
|---|---|
| **Character** | Name, who they are, Health, Mana, Stamina, the seven stats (1 to 20), points (3 more with each Soul Class rise), Soul Class, XP, Alive, Left. The narrator sets Health, Mana, Stamina, XP and Alive; Left is set by a `- party` line; the reader sets stats and points. Rest refills Stamina and Mana. |
| **Skills** | Up to five skills, each with a name, what it does, the stat it rolls with, what it uses (stamina or mana), a rank and practice. The narrator names a skill with a learn line (name, what it does, stat, uses) and adds practice. Rank and practice cannot be typed in. |
| **Foes** | Up to four foe groups, one slot each: the name, how many are left (0 means the slot is empty), the Soul Class and the group's health. |
| **Combat rules** | The combat text, which the narrator reads on every reply, and the XP guidance. It has no fields. |

A new chat gets a Combat rules block and a Foes block when you make its first character (see [A new chat](#a-new-chat)),
so the Fight tab and the combat text work without adding them by hand. The combat text of this chat can be changed on [Settings → RPG](#settings--rpg). To read or change a template's rules, make a block from it, then use the block's actions menu to
export it as a pack file. The pack file holds the definition as JSON; edit it and import the pack. A block made from
a template is its own copy in the chat, so changing a template later does not change blocks already made.

### For pack authors

The templates are in `src/v2/lean-rpg/templates.js`. They use these keys, which the block engine adds for them:

- `role` on a definition: `character`, `skills`, `foes` or `rules`. Only blocks with a role are read by the RPG.
- `names` on a number field: a name for each value, such as `{ "1": "I", "2": "II" }`. Stored values stay numbers.
- `prompt: false` on a field: keeps the field out of the narrator's lines, so the narrator cannot set it. Rules and
  the reader can.
- `functions`: `card` for a card under the reply (tone `info`, `warn` or `end`, a title of up to 60 characters and
  text of up to 240), and `reply-end` for effects settled once at the end of each reply.

- `edit: false` on a field: the reader cannot change it with a pencil (the Skills block's rank and practice).

A block with a `role` is held to these rules, and is told like any other block while the RPG is switched off:

- A field drawn as a bar (`health`, `mana`, `stamina`, a foe's `hurt1` to `hurt4`) has at most 10 stages, counted up from 0; a
  longer one is refused when the block is made.
- `prompt: false` is honoured for every field the RPG tells the narrator about: a skill's name, what it does, a foe's name or
  Soul Class, and `who`. The same holds for the roll planning step and the rolls: a hidden foe name is "Foe 2" (its slot) there,
  a hidden skill name is not offered, and a hidden `who` is the block's own name. A hidden number (health, a stat, Soul Class, a
  rank, a foe's count, class or health, a skill's stat or resource) still counts for the dice; it is only left out of what the
  planner and the narrator are told: a check on a hidden stat reads "Wessel — Silent Trick, normal" (or "Wessel — check") with no
  stat named, a skill whose hidden resource is Empty is "cannot use Silent Trick: rolled without it", and a hidden skill stat
  missing from the sheet is "lacks the skill's stat". Whether something is hidden never changes the dice or how many rounds
  the cue tells: the cue is measured as if nothing were hidden (checks and refusals alike), and the hidden wording is never
  longer than the shown one. The replay witness holds the sheet numbers and the refusal texts as said, so hiding a field
  that changes a refusal's wording asks for a Re-read of that reply.
- A block with a `role` is made for the chat (`scope: chat`, one block for each person); a `role` on a block for a character is
  refused when the block is made, so the Party and Fight views and the roll planner always read the same blocks.
- Cards are shown in the order death notice (an `end` card of a `character` block), other end cards, warn, info (at most 8 at a
  time), so the death notice always has a place.
- The story cannot kill a character directly: the stock Character has no line that sets `alive`. A character dies only through
  the reply-end latch, in a reply after the one that made them Down. The latch is settled by a `dm.settle` step that every
  reply with accepted lines records (it may change nothing), so a Re-read of an earlier reply plans it again. Room is kept
  for these steps: one action of the 32 and the evaluation visits the blocks' own reply-end functions can take, for each
  character, so eight Characters leave the story its normal room; past that, the story's last action is refused with a plain sentence.

Keep to the block limits: 32 fields and 16 kinds in one block (a block with a `role` counts only its kinds against the 16),
and text of up to 240 characters. The narrator is told up to 100 tokens of each block, 300 for a block with a `role`. A block
with a `role` is told compactly: a value at its default is left out, a Skills block is one line per skill with the empty
slots left out, and a Foes block lists only the groups in the fight.

### Skill sets in a pack

A pack can add skill sets to the New character window. They sit under `content.rpg.skillSets`, up to 12 sets, each with
up to 5 skills, and show on the Skills step as "From the *pack name* pack":

```json
{ "content": { "rpg": { "skillSets": [ {
    "name": "Sealwarden recruit",
    "about": "Trained at the Depths gates to hold a line and read the seals.",
    "skills": [
        { "name": "Spear", "about": "Holding a line with a long spear.", "stat": "str" },
        { "name": "Ward-reading", "about": "Reading the seals on a door.", "stat": "int", "uses": "mana" }
    ] } ] } } }
```

A set has a name (up to 40 characters, unique in the pack), an optional `about` (up to 160) and 1 to 5 skills. A skill has a
name (up to 40, unique in its set), `about` (1 to 120, what it does: the narrator reads it), `stat` (`str`, `vit`, `agi`,
`dex`, `int`, `luk` or `cha`) and `uses` (`stamina`, the default, or `mana`). Sets never carry ranks: every skill starts at
Novice, and the reader may start one at Adept.
