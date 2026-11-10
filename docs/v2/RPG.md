# RPG

The RPG is an optional part of Story Block for light combat and character growth. It keeps a party sheet
for you and each companion, rolls the dice for fights and checks, and raises each character's level and skill ranks as the
story goes on. It is off by default, and with it off Story Block works exactly as before and loads none of its code (a chat that holds RPG records loads it, so they replay as recorded).

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

With the feature on, the **Party** tab shows one card for each Character block: the name, the level (with the pack's rank or guild letter, see [Levels, XP and skill ranks](#levels-xp-and-skill-ranks)) and XP,
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
**N foes · M down**. With the Standard formula, a **Turn order** row sits under the header: who acts in which order this fight
(rolled once, at the start; a swipe rolls it again, Re-read keeps it), each with the total rolled, and a line for any
character who gets an opening action against a foe (a quick start). Under it are a card for each foe (name, level, a five-cell health bar, greyed when Down; tap the bar,
or its pencil, to set the foe's health from Down to Unhurt, the same way as on the Party card), a card for each character with the three stage bars, and **Last exchange**: the battle log of the latest
reply that was rolled. **See it in the story** closes the game view and scrolls the chat to that reply.

### The fight board

The board is on by default and is offered under the Standard rules. Its switch is in
**Settings → RPG** and **Settings → Features**. When a reply introduces foes, a line beneath it offers **Fight on the board** or
**Auto-fight**, and a dot marks the Fight tab while the offer is open. The board remains available in the Fight tab.

When you type an attack on a standing foe, the send is held with only those two choices (titled "This is an attack on <foes>"). Nothing waits on a model call. Choose one numbered line for each standing party member: Attack with
the equipped weapon, a skill with one target or every foe in reach, or Flee. Tap a line or press its number; when there is
more than one foe group, choose the target next, or press Esc to go back. A line that cannot be used stays visible with its
reason. Defence is automatic: the best usable defence skill, else the plain defence roll. Foes act by code.

**Auto** plays up to the cap's exchanges for you (the **Auto-fight cap** setting, 1 to 8 or **Until the end**, default 3) with ordinary attacks. It stops on a win, a loss, a badly hurt hero (2 or more Health blocks lost in one exchange; in a fight with doubled bars, a loss of a fifth of the bar, see [Doubled bars](#doubled-bars-new-chats)) or the cap, and it never flees. After it stops, **Auto again** plays on and **Send with this fight** sends the reply. A fight against foes that a fled or lost fight left starts from their exact bars; the board says "These foes are as you left them: N of M standing, with their bars from the last fight."

The bars stay above a scrolling battle log, and the next choices stay at the bottom on a phone. Each rolled exchange is final.
**Discard fight** asks first and gives the next opening a new seed. A changed sheet or equipment holds a staged board fight until
the original inputs are restored or the fight is discarded. While the reply is being written, wait until it finishes before changing that fight's sheet or gear.
If a reply is held after its inputs change, restore them to finish it, or discard the fight and regenerate it. A held reply survives a reload.
The log shows bar changes as words with the dice and totals. The board labels defence results as the defender's and sends each
recorded gear condition change to the narrator at its exchange. The end card says won, lost or fled, shows pending XP and practice,
and offers **Send with this fight** when a reply is waiting. The folded note shows what the narrator will be told.

When you send while exchanges are played, they become that reply's settled rolls: the narrator tells them first, then your
own action, and an unfinished fight stays open with its current bars.
A swipe of the narrated reply keeps the same fight, seed and actions; Re-read, reload, rewind, regenerate and a middle delete
replay the same result. A branch does not keep a staged fight if the reply that anchored it is absent. A won fight pays its XP once;
open, lost and fled fights pay none. With the board on, the narrator's fixed combat instructions omit rules already handled by code;
the roll notes still explain each narrated roll. With the board off, no dice are rolled before a reply.

With the Standard formula a foe group's health bar has `4 + floor(level/30)` blocks (levels 1 to 29 give 4, 30 to 59 give 5, 60 to 89 give 6, 90 to 99 give 7) and reads
"Scratched · 5 of 6"; the battle log shows the recorded turn order with its totals (`Turn order: Wessel 21 > Weir-drake 18`), the
quick start and its opening action, "<who> does not act: beaten before its turn" for a group or character beaten before its turn
(or down, or with nothing left to act on), the result word (Decisive, Decisive hit), "(area)" on an area attack, and the roll's
breakdown on tap, built from the recorded parts ("Physical: d20 17 + (AGI 10 + DEX 6/2)/2 = 6 + Expert 2 + Lv 14 ÷ 5 = 2 = 27 · vs
Weir-drake d20 9 + 3 + Lv 7 ÷ 5 = 1 = 13 · Weir-drake loses 1 block (5 of 6)").

## Making a character

**+ New character** opens a window with four steps and a summary of the character so far on top.

1. **Who.** The name (your persona's by default), whether this character is **You** or **A companion**, and who they
   are (up to 240 characters, which the narrator reads on every reply). A story has one You: the party shows you as the
   character named like your persona, so You takes that name and a companion cannot. A You also starts with your active
   persona's description in **Who they are** (its first 240 characters, never splitting a character), with the note
   "From your persona's description (the first 240 characters). Change it freely: this is what the AI reads." Only the
   active persona's description is read, never another persona or any other setting. It is only a start: a companion's
   box starts empty, switching to **A companion** empties it again while it is still the persona's text, and anything
   you type is yours. The **Starting level** (1 to 99, held to the story's level cap) is set here too.
2. **Stats.** The same steppers and radar as Spend points. On the **Standard** formula (the default) every stat starts at 5 and you have
   10 points to spend; a stat can go down to 3 to free a point and up to 10, and a line under the steppers says what the next points
   buy: `Health 5 blocks (VIT 5, next at 10) · Stamina 4 (AGI 5, next at 10) · Mana 4 (INT 5, next at 10) · Edge −2..+3 (next at LUK 7)` (the old-pin sizes; a new chat's Character shows 10 / 10 / 10 at stat 5, 12 at stat 10, see [Doubled bars](#doubled-bars-new-chats)). Points you leave unspent stay on the character for Spend points. Spend
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

A character can travel between chats as a file. It carries only what a new character can start from: the level, unspent
points, the seven stats, the skills (and, if you leave them on, the things the character carries and the money).
It never carries the name, whether they are You or a companion, who they are, XP, Health, Mana or Stamina, skill practice, or
anything about the story. Both buttons exist only while the RPG is on.

**Export.** **Export** on a character's card, next to **Spend points** and **Skills**, opens **Export <name>**:

- **Character** (always): the level, the unspent points, the seven stats and up to five skills (name, what it does, stat,
  Stamina or Mana, rank). A skill whose block has no stat of its own (an old Skills block) is saved without one: a stat is never guessed.
- **Inventory** (a checkbox, on): the things that character carries, as the Inventory tab lists them: names, counts and notes,
  with the kind and rarity each has. A You carries what is in the party's bag; any character also carries what the party
  actor of the same name holds, when a party module lists one. Nothing carried: the box is off.
- **Money** (a checkbox, on; only on your own You card): the purse as its value in the money's smallest unit, so another game's
  coins show the same value in their own words ("50" is 5 silver where silver is worth 10 and 50 crowns where there are no coins).

**Save** writes `<name>.character.json` (the name in lower case, letters and digits). The file is plain JSON:

```json
{ "storySuiteCharacter": 1, "level": 14, "points": 3,
  "stats": { "str": 14, "vit": 12, "agi": 11, "dex": 10, "int": 8, "luk": 9, "cha": 10 },
  "skills": [{ "name": "Iron Breath", "about": "Steadies the lungs.", "stat": "vit", "uses": "stamina", "rank": 2 }],
  "items": [{ "name": "Oilskin Coat", "qty": 1, "note": "waxed", "kind": "equipment", "rarity": "uncommon" }],
  "money": 50 }
```

`items` and `money` are there only when left on. `level` is 1 to 99. A file saved before Levels has only `soul` (Soul Class 1 to 9), which stands for the level 10n − 5; a file saved now also carries `soul` for older builds to read. A file is checked when it is read, with the RPG's own limits (level 1 to 99, or a Soul Class 1 to 9 in a file without a level,
points 0 to 60, stats 1 to 20, at most five skills with a rank from 0 to 3, names and text cut to the fields' lengths, at most 60
things with a count of 1 to 999, money a whole number up to 1,000,000,000, the whole file under 64 KB). A skill's `stat` may be missing or null; any other value that is not a stat refuses the file. Keys it does not know are ignored. A
file that does not pass is refused with one plain sentence ("This is not a saved character file.", "The file has no valid STR (1 to
20).") and nothing is filled.

**Import.** In **+ New character**, the Who step starts with **Start from a saved character … Import file…**. After a good file the
step shows "Imported from wessel.character.json: stats, 3 unspent points, Lv 14 and 2 skills", with **Undo import**, and:

- The **stats**, the **unspent points** (the pool the stats are spent from), the **level** and the **skills** are filled. The Stats
  and Skills steps show them and keep the usual rules: a stat can go down to 8 to free a point and up to 15 (a saved stat outside that stays
  where it was), a skill can be renamed or changed, a skill can be added or removed. Picking a skill template while imported skills are there asks "Replace the imported skills? Their ranks will be lost." with **Replace** / **Keep**. A skill the file gave with no stat shows an empty **Stat**, and the Review's "Fix this first" asks for it ("Iron Breath needs a stat."), like a missing "what it does" line. A skill's **rank** comes from the file and cannot
  be changed here; practice starts at 0.
- The **name**, **You or A companion** and **who they are** are not touched. XP is 0 and Health, Mana and Stamina start full.
- **Undo import** puts back what was there before the file (what was typed since stays). Closing the window without Create leaves nothing behind.
- The Review adds "Also adds: 3 things to the party's bag · 5 silver to the purse. One swipe of this reply takes it all back." for what the
  file had (the money in this chat's coins, with thousands separators, e.g. "10,000,000 gold"). It says "3 things carried by Ren" only when a party actor of that name will hold them.

**Create** makes the Character and Skills blocks as before (with the file's level, points, stats and ranks as their defaults) and
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

`about` is up to 240 characters, `class` is a Soul Class word from I to IX (still read: a companion starts at the level that class stands for, II at 15 up to IX at 85, I at 1) and `best` is one of str, vit, agi, dex, int, luk, cha;
the last two are optional. The line is in the narrator's instructions only while the RPG is on, the story has a Character block
and the setting is not Off; with the RPG off, nothing is told and nothing changes.

- **What is made.** A Character block (a companion) and an empty Skills block for that name, as one action of the reply: every
  stat 10 with the named best stat 14, no unspent points, Health, Mana and Stamina full, and the Soul Class as written but never
  above the highest Soul Class among those in the party. On the Standard formula every stat is 5 and the best stat 9, and each Soul
  Class above I adds the points per Soul Class (4), one at a time to the best stat and DEX in turn up to 20, then to VIT, AGI, INT, CHA,
  LUK and STR, so no point is left over. The skills fill in when the story has them learn something, as for
  anyone.
- **Ask.** The line makes nothing. The reply gets a card, "Mara joins the party", with **Add to party** (makes them as above),
  **Edit first** (opens the New character window filled in: name, about, class, the best stat raised to 14; you spend the
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

## Skill slots

**Combat and utility (new chats).** A Skills block with a `type1` field is typed: 11 slots, each with a `type<n>` of combat (default) or utility. Combat keeps the slots below (five, +1 at Lv 20, 40, 60, at most eight); utility has **three slots of its own**. The learn line takes an optional `type:`; the pool is the line's type, the first empty slot of it, and a refusal names the pool ("No free utility skill slot"). A utility skill has no target, area or defence, so it stays off the fight board, Auto and the defence pick; the narrator's tail lists it tagged "utility". The sheet shows "Combat skills 3 of 5" and "Utility skills 2 of 3" and a **Used for** switch (a full pool disables its option). Limits: `skillsFields 80`, `skillsKinds 22`; a block with no `type1` field (`skillsLegacyFields 56`) is all combat, eight slots, and never gains slots. A pack cast skill may carry `type: "utility"` (absent or `combat`: combat); it takes a utility slot on a join or return, a fourth one is left out (a return says so in Problems), and a pack without `type` joins as it always did. The pre-check's gate still reads utility skills. What follows is the combat rule, the only rule of an old block.

A character has five skill slots, a sixth from Lv 20, a seventh from Lv 40 and an eighth from Lv 60 (`skillSlots(level)` in `lean-rpg/names.js`). The `learn-N` and `practice-N` lines run N = 1..8; a learn line for a new skill goes to slot N if it is empty and open, else the first open slot, else it is refused with one Problems line that says when the next slot opens ("No free skill slot for X. The next slot opens at Lv 20."). A level drop never deletes a skill: the extra slots are kept, there are just no new learns. A character file holds up to eight skills; creation still starts at five. A Skills block made before 2.22 (five slots, no signature mark) is extended by Story Block itself, the first time it is needed: a learn line that would otherwise be refused for lack of a slot (every slot the block has is full) once the character's level has opened one the block lacks, or a returning cast member's skills to mark. A learn line that names a slot the block lacks while a lower one is free goes to the free one, and the block stays as it is. The block's pin is replaced by the same definition with the missing slots, kinds, rules and mark added (nothing removed or renamed; every skill keeps its rank and practice; its text is unchanged). The upgrade is part of that action's changes, so rebuild, reload and Re-read agree and a swipe takes it back. The Skills block's tail may say 47 tokens more for each skill it holds past five (the longest line one skill makes, a 40-character name and 120 of text, is 188 characters); an empty slot reserves nothing.

## Signature skills

A pack's cast entry may list `skills` (PACKS.md "The cast"). They are seeded **only on the join event**, under the pack as installed at that moment:

- a first join fills the first slots with the skills as written (name, what it does, stat, uses, rank), marks them in the Skills block's hidden `sig` field, and adds one tile for each to the join's receipt ("signature · Expert", "STR · Stamina"; the summary adds "+3 skills"). Free slots stay for the narrator. The RPG off: nothing is done.
- the story cannot rename or replace a signature skill: a `learn-N` line of its name is refused with one Problems line ("Harrak's Beacon Call is a signature skill: it keeps its name and slot."); a learn line with another name takes a free slot as for any skill. Practice and rank-ups work as for any skill. The reader's pencil still fixes the name and the wording, and the skill stays signature.
- leave and return keep rank and practice. A return fills only free slots, only with pack skills the person does not hold by name, so a member who joined before the pack had skills gets them on their next return and never gets duplicates; a skill they made themselves is never marked. A member who stays in the party is never changed by a pack update.
- the Skills view marks them with a lock after the rank pill (title "Signature skill, from the pack"), a legend entry and a sentence in the foot note, shown only when the card has one.
- replay: the state is replayed from the recorded changes, and the receipt records what was seeded. A Re-read of a join seeds what that join's Skills block was made with (the signature slots and the values in its definition, which the reader's pencil never touches); a Re-read of a return seeds the marked skills of the reply as it stood; neither asks the pack. A Re-read of a join made before 2.22 rebuilds the five-slot block that reply made; a Re-read of such a join or return seeds nothing and leaves its learn lines alone. A Re-read of an Ask offer offers the pack's skills as they are.
- Edit first: the wizard keeps the signature skills in front, as the pencil would: the name and what it does can be fixed, the stat, resource and rank cannot, and a signature skill cannot be taken out. The Skills block it makes is marked and its receipt tells the join with one tile for each skill.

## The Skills view

**Skills** on a character's card opens that character's skills in place of the cards (**Back to the party** returns). Each skill
shows its name, its rank, the stat and resource it uses, what it does, a mastery bar and the roll it makes now:
`Rolls with it: d20 +12 = VIT 12 → +6 · Expert +2 · Lv 14 ÷ 5 +2`. The bar has four cells, one more lit for each rank, with
the next one filling as practice grows; its colour follows the rank (Novice grey, Adept blue, Expert purple, Master green).
Empty slots show a dashed line and are filled when the story has the character learn a skill.

The pencil on a skill fixes its name or what it does, and, while the fight board is on, its three optional board choices:
**One foe**, **Every foe in reach** and **Automatic defence**. The defaults come from the skill's words (for example, a
description saying "every foe" sets area); the choices are stored on the reply that saved them, so a swipe or delete takes
the edit back. While the Fight board is on, renaming a skill keeps its saved board choices; without saved choices, the flags
continue to follow the skill's wording. Rank and practice only move through play, and a skill's stat and resource are fixed by its Skills block.

## Stage bars

Health, Mana and Stamina are words, not numbers, and each word is drawn as a bar that shows how full it is.

| Health | Mana | Stamina |
|---|---|---|
| Unhurt, Scratched, Hurt, Wounded, Badly wounded, Down | Fresh, Steady, Low, Drained, Empty | Fresh, Winded, Tired, Spent, Empty |

Stamina and Mana come back to Fresh when the character rests: the **Rest** button on the Character block sets both
to Fresh. Health only goes back up when the story heals it. (An old pin; a new Character has no rest button: the narrator writes `rest`, `full-rest` and `heal`, see [Recovery and XP on a new Character](#recovery-and-xp-on-a-new-character).)

### Standard formula: bars of blocks

This section is the **old-pin** rule: a Character pinned before the doubled bars (no `scale` mark) keeps it, with its old damage and costs. New chats use the doubled bars below.

With the Standard formula a bar is a row of **blocks**. The stored value counts the blocks left (Health 0 to 8, Stamina 0 to
7, Mana 0 to 7); how many blocks the bar has comes from the stats when it is read: **Health 4 + VIT/5, Stamina 3 + AGI/5, Mana
3 + INT/5**, rounded down (`formula.js blocksFor`). A foe group's Health is `4 + floor(level/30)` blocks (`foeBlocksByLevel`; the older `foeHealthBlocks` is `4 + class/3`). The Party card,
the Fight tab and the game view's header draw one cell for each block and read "Hurt · 4 of 6"; under the skills the card says how
many blocks each bar has and the stat that earns the next one ("Health 6 blocks (VIT 10, next at 15) · … · Edge −2..+3 (next at LUK
7) · Soak +3 (next at VIT 16)"; Soak is shown for a character with the doubled bars, from the VIT a roll uses, worn gear included, as the stat cell shows it).

The stage words are the same, spread over the bar: 0 blocks is the first word (Down, Empty), a full bar the last (Unhurt, Fresh),
every count in between the nearest of the words between (`blocks.js spreadWord`). The narrator reads and writes words, never block
counts: the prompt says "health Hurt", never "4 of 6", and a `~ dm character — … | kind: set-health | to: Hurt` line is turned into
blocks for the bar's size by the Character block's kind (the word at position i of n is `i/(n−1)` of the bar, rounded to the nearest
block).

A block that comes from spending points arrives **full**: the blocks already there are left as they were, and a Down character stays
Down. A lower stat shrinks the bar and holds the current value at the new size; it never knocks anyone Down (a bar is never smaller
than 4, 3 and 3 blocks). The Character block does this itself with one rule per bar and three hidden fields (`health-blocks`,
`stamina-blocks`, `mana-blocks`: the size each bar had when last settled), so it holds for every way a stat changes and replays the
same live, after a reload and after a rebuild.

A field says it is such a bar with `blocks` on its definition (`"blocks": "health" | "stamina" | "mana"` on a Character block's
bars, `"foe"` on a Foes block's `hurtN`); a field without it is a stage bar and is read as before. A kind's number
label may carry its own `names`, which is how the story's words reach a value its effect works out.

### Doubled bars (new chats)

A Character made in a new chat (the chooser, the wizard, an import, a first companion) is pinned with `scale: 2` on its three bars (`templates-bars.js scaledCharacter`; the frozen old Character is `characterV1For()`). Each bar is twice as long, and the stored value counts blocks left:
**Health 2 x (4 + VIT/5), Stamina 2 x (4 + AGI/5), Mana 2 x (4 + INT/5)**, the stat divided and rounded down (`formula.js blocksFor(stats, scale)`). A character made fresh starts at 10 / 10 / 10; the most is 16 each, at a base stat of 20. Bars read the base stats: gear never grows a bar. Pack-defined characters keep their own sizes; a pinned bar with no mark keeps the old sizes, byte for byte. Rules and prompts name stage words only, never a block count.

Look: every Health, Stamina and Mana bar (old pins too) is one smooth strip, red, green and blue, with the word and the number ("Hurt · 5/10"). The strip shortens with the value and dulls at 3/4 and at 1/3 (`view/widgets/dom.js barStep`, `lean-rpg/view/bars.css`; Stamina's green is `--ss-sp`, the same token as `--ss-tick`). Old stage bars get the number too.

A companion who joins an existing chat is made on that chat's sizes (`join.js joinScale`): an old party stays old, an empty party gets the new Character, and a Re-read keeps a first companion's original pin. There is no conversion of an existing chat.

**The fight mark `bars: 2`.** The board marks a fight (like `aoe` and `fix`) only when every sheet character is pinned at scale 2; the mark is in the fight's setup and result, and a mismatch with the pins reports a damaged save. Only in a marked fight:
- a single-target skill hits for 2 blocks (3 when decisive); a plain attack stays 1 (decisive 2); an area skill is unchanged;
- an area skill costs 2 of its resource and cannot be chosen with fewer than 2 left (the board says "Not enough ..."; Auto never picks it; mid-exchange it is rolled without the skill, as for an empty pool);
- Auto stops when a hero has lost a fifth of the bar (loss x 5 >= size);
- heals keep their number (1 block, 2 decisive); words keep their share of the bar.
**The fight mark `soak: 1`** (VIT soak). Set with `bars: 2` for a new board fight, and recorded in the setup, the result, the guard's predicate and its shape check (`soak` without `bars: 2` is a damaged save). On a party member's defence in a marked fight (with a skill or without, physical or magic), a foe's hit lands only if the foe beats the defender by more than `2 + S`, where `S = min(5, floor(effective VIT / 4))`. Effective VIT is what the fight rolls with: the stat plus worn gear (a broken piece gives nothing), held to 30. A decisive hit (a natural 20 by the foe, a natural 1 by the defender, or a lead of the decisive margin) always lands, at its usual damage. A hit that is soaked does no damage; the line records `soaked: S`, the battle log says "Glanced off", and the narrator is told "the blow glances off and does no harm" (no number). A defence with a skill pays its cost as ever. Only the party's defences soak; foes get none; bars, Health formula, costs and damage amounts are unchanged. `2 + 5 = 7` stays under the default decisive margin of 8, so at the cap the band is whole; a pack's decisive margin set from 4 to 7 makes a decisive hit land first, so the band is cut short at that margin. A fight recorded without `soak` (including one already fought on a marked pin) replays with no soak; the non-board (narrator-settled) path has no marks and no soak. Auto picks actions without predicting hits, so it needs no change.
A mixed party leaves the fight unmarked, and a pre-check opening (which rolls no bars) is never marked; an old recorded fight keeps its own rules.

## Rolls

With rolls on, the dice are rolled by code: the fight board's exchanges (the Standard formula is the only one). No model call plans them; a reply with no board fight goes out with the "no fight" line in its tail. The result is drawn as a battle log in the reply, with
one short line per action, for example `Wessel uses Short blade on Sluice Rat A — Success (26 vs 16)`. Tap a line to see the numbers.
It stands where the narrator wrote `[battle]` (else under the reply), and is drawn again when another extension redraws the
reply's text. A `[battle]` line with no rolls behind it (or with the RPG off) is hidden, never shown as text.
A foe's attack reads from the foe's side: **Hit** (red) when it gets through, **Grazed** (amber) when it costs you, **Blocked**
(green) when you stop it, with the foe's total first. The Status bars are coloured by stage, like the Party tab's.

**How long a reply's exchanges run.** The rolls for a reply keep going, exchange after exchange, until the first of these happens: the fight is
**won** (every foe group is Down), it is **lost** (every party member who has not Left is Down), it turns **heavy** (a party member has lost 2 or
more Health blocks in this reply, or went Down), the reader's **Most exchanges per reply** is reached (8 by
default), the roll cue no longer fits its budget, or, at the careful pace, one exchange is done. A Decisive result is still marked Decisive in the
log and still counts (a Decisive hit takes two blocks), but it no longer ends the reply. A foe group or a party member who is Down does not act in
the exchanges after, and the cue says so ("does not act: Down"). The cue's last line tells the narrator where the rolls end, and for a won fight
that code gives the XP for it (below). A roll made before this (its record has no
`flow`) stopped at the first Decisive round, at the pace (careful 1, normal 5, all 8) or at the cap of 5, and still reads, replays and Re-reads
exactly so; the log's stop word for it is `decisive`, `over`, `pace`, `cap` or `budget`, and for a new roll `won`, `lost`, `heavy`, `cap`,
`budget` or `pace`.

- **A skill brings its own stat and resource.** An action that uses a skill the character has rolls with that skill's stat
  and spends that skill's resource (stamina or mana). If the resource is Empty the action is rolled without the skill: same stat, rank 0.
- An action with no skill rolls the stat that fits it, at rank 0. If there is no stat at all (a skill from an old Skills block that has no
  stat of its own) the roll uses the character's best stat, untrained, and says so.
- **The narrator always gets the rolls.** The roll cue is kept whole when the notes are trimmed to fit, and is shortened to
  stay under 600 tokens (fewer exchanges first, then shorter check and refusal lines, then shorter names). Shortened names
  stay different from each other (a cut name keeps the end of the name when its beginning is the same as another's). A roll made
  by an older build, whose record has no dice version, is shortened the way it was then, so a Re-read tells what it told.
- **Foes.** A foe slot counts as filled with a name and a count above 0, in the Fight tab and for the board alike, and
  every Foes block in the story is read. A fight starts when a foe slot is set; while a Foes block exists and none stands, the reply's tail says so, and while foes stand only the clear-N kinds are offered.

- A **swipe** rolls again: the reply and its dice are new, and made with the numbers the settings say then.
- **Re-read** keeps the same dice, and the same numbers (see below).
- Changes made by a roll, and any level-up, appear under **Changed this reply**.

**Past rolls never change.** The numbers a roll was made with are recorded in the roll itself. A Re-read, a rebuild and
a reload roll it again with those numbers, never with today's settings. Changing the difficulty, or anything else on the
Settings page, only changes the rolls made after it.

## Settings → RPG

The page shows only while the RPG is on.

- **Stat formula.** The roll table of the Standard formula (see [The stat formulas](#the-stat-formulas)) and four numbers: where stats start, the points at creation, the stat points each level-up gives (1 every 3 levels) and the foe's base (`+ floor(level ÷ 5)`; Health `4 + floor(level ÷ 30)` blocks).
  Rolls already made keep the numbers they were made with.
- **Fight board.** Turn the board on or off here; this is the same switch as the one on Features. Under it, **Auto-fight cap** (`rpgAutoCap`, a slider from 1 to 8 or **Until the end**, default 3): the most exchanges **Auto** plays in one press.
- **Rolls.** **Automatic** or **Off**, as above.
- **Difficulty.** **Gentle**, **Standard**, **Harsh** or **Custom**. The presets move only the foe's base (2, 4 and 6) and how far short
  a roll may fall and still be "success at a cost"; **Custom** shows its thirteen numbers: **Foe's base** (0 to 15), **Level divisor** (3 to 8, 5 unset),
  **Stat adds** (half the stat, a third of the stat, or full above 10), **"At a cost" when short by** (0 to 5; 0 turns it off), **Decisive at a margin
  of** (4 to 15, or a natural 1 or 20) and **Most exchanges per reply** (1 to 8). A number outside its range is held to
  it, and a roll already made keeps its own. Under the numbers a bar shows the exact chances of success, success at a cost and fail for your own character (the
  persona's name, else the first Character block) with their best skill, against a foe of the same level, and it
  changes as you type.
- **Levels and practice.** **Level cap** (1 to 99, default 99; the pack's cap wins when it names one), **Practice per skill use** (1 to 5, default 3) and **XP rate** (50 to 300 %, in steps of 25, default 100), as in [Levels, XP and skill ranks](#levels-xp-and-skill-ranks).
- **What the narrator is told about combat.** The text of this chat's Combat rules block (up to 1200 characters, counted
  as you type). It is saved when you leave the box (or close the settings window with text still in it), as an edit of that
  block on the latest reply: swipe or delete that reply to take it back. A chat keeps a limited number of block versions;
  when it has kept as many as it can, the box says so in plain words. **Reset to the default** puts the template's text back (a Standard chat's
  default also explains the roll types and that code moves the Health bars for rolled hits). Each chat has its own text; a new chat
  starts from the default. A chat with no Combat rules block says so and offers **Add the Combat rules block**.
- **Companions who join.** **Ask**, **Automatically** or **Off**, as in [Companions who join](#companions-who-join).

With the RPG off none of this is read or sent.

## The stat formulas

**Standard** is the only formula: a chat plays on it, and a record with no formula replays as Standard. (The Classic formula and its settings are gone; a pack with `content.rpg.formula: "classic"` is refused as `BAD_CONTENT`. Old Classic rolls still replay as they were made.) Every roll records its formula and numbers (see "Past rolls
never change" above), so a change only moves the rolls made after it.
never change" above), so switching only changes the rolls made after it.

### Standard

A roll is one of five types. The level term is floor(level ÷ 5) (before Levels it was 2 × Soul Class); rank is 0 (Novice) to 3 (Master); the edge is what the situation earns (−3 to +3)
after luck. `(A + B/2)/2` is rounded down once, at the end.

| Roll | d20 plus |
|---|---|
| Physical | level term + (STR, or the skill's stat, + DEX/2)/2 + rank + edge |
| Magic | level term + (INT, or the skill's stat, + DEX/2)/2 + rank + edge |
| Defence | level term + (the higher of AGI and VIT + the lower/2)/2 + rank + edge; against a spell the higher of INT and VIT; a tie dodges |
| Social | level term + (CHA + INT/2)/2 + rank + edge |
| Check | level term + (the fitting stat + DEX/2)/2 + rank + edge: STR to climb or force, AGI to sneak, DEX for locks, INT for lore, VIT to endure |

A skill's own stat takes the main slot and nothing is added on top. A skill that uses Stamina is physical and one that uses Mana is magic,
unless the action is marked defence, social or a check. A skill whose resource is Empty is rolled without it: no skill, rank 0 and
the type's own stat.

- **Luck is a window on the edge.** The situation gives an edge from −3 to +3; LUK holds it inside a window and never lets it fall below the
  low end, and a best case (+3) reaches the high end: LUK 3–4 −3..+3, 5–6 −2..+3, 7–8 −1..+3, 9–10 −1..+3, 11–12 0..+3, 13–14 +1..+4,
  15–16 +2..+4, 17–18 +2..+5, 19–20 +3..+5. A fresh character (LUK 5) has −2..+3.
- **Foes.** A foe adds `foeBase + floor(its level ÷ 5)` to its d20 (the base is 2, 4 or 6 for Gentle, Standard and Harsh). A foe group has Health
  `4 + floor(level/30)` blocks and acts once a round whatever its count.
- **Hits.** A hit takes 1 block of Health from its target, a decisive hit 2 (a single-target skill in a fight marked `bars: 2` takes 2, decisive 3; see [Doubled bars](#doubled-bars-new-chats)). A party member's action hits on a success or a success at a cost;
  a foe's attack hits when the defender fails. Decisive is the winner's natural 20, the loser's natural 1, or a lead of 8. Code writes the
  new Health to the sheet and tells the narrator which bars it moved, in words ("Bars now: Wessel Hurt; Sluice Rats Down"), never to set
  them for a rolled hit, heal or skill cost. Bars are clamped to their size (`blocksFor`: old pin Health 4 + VIT/5, Stamina 3 + AGI/5, Mana 3 + INT/5; a pin with `scale: 2` has 2 x (4 + stat/5) for all three).
- **Skills cost a block.** Each time an action uses a skill (an attack, a heal, a defence with a skill, a check), code takes one block (2 for an area skill in a `bars: 2` fight) from that
  skill's resource: Stamina for a Stamina skill, Mana for a Mana skill, never below 0. With the resource empty, the action is rolled without the
  skill (no skill, rank 0, the type's own stat) and the log says so. A swipe, a Re-read and a rebuild agree with it like they do with hits.
- **Area.** An area skill rolls once against each standing foe group's own roll; each group's bar moves on its own.
- **Support.** A heal or a buff rolls against a difficulty (easy 10, normal 15, hard 20, very hard 25): a success gives 1 block, a decisive
  one 2, never past the bar. Someone who is Down can be mended.
- **Social and exploration in a fight** are rolled against the foe's roll and hurt nobody; outside a fight they are checks against the
  narrator's difficulty.
- **Turn order.** At the start of a fight each character rolls d20 + floor(level ÷ 5) + AGI/2 and each foe group d20 + floor(level ÷ 5); highest first, ties to
  the higher AGI, then to the party. The order is kept for the whole fight: each reply's roll carries it on (a swipe of a later reply keeps
  it; a swipe of the reply that began the fight rolls it again; a Re-read keeps it), and someone who arrives later rolls on entry. A group of the same name that arrives after the fight ended (beaten, or healthier than the fight left it) is a new fight: a new order and a quick start. A foe or
  a character who is beaten or Down before their turn does not act that round, and the fight ends in the roll when a side is gone.
- **Quick start.** A character who is 10 or more ahead of a foe in the order acts once against it before the first round, at the start of the
  fight only.
- **Creation.** Stats start at 5, with 10 points to spend, from 3 to 10; a companion's Soul Class above I gives 4 more points; a stat never goes above 20.
  Companions the story brings in are made on the same scale (see [Companions who join](#companions-who-join)).

The numbers behind the presets were chosen with `node scripts/sim-standard.mjs` (no network; measured on the Soul Class term, before Levels): at Standard a focused build (the skill's stat
and DEX at the creation maximum, then 3 and 1 points a class) succeeds about 61 times in a hundred against a foe of its own Soul Class at
Soul Class I and 72 to 79 from III to IX; a spread build succeeds about 43 to 52 times. A hero against one
foe of the same class ends the fight in about 4 to 6 exchanges (skill costs included); at Standard a focused build wins 62 to 81 of a hundred
such duels and a spread build 75 down to 25 from Soul Class I to IX.

A pack may name the formula and its numbers (`content.rpg.formula`, `content.rpg.numbers`); they are the default for a story whose reader
has not chosen a formula or a difficulty, and the reader's own choices win. Settings → RPG and the wizard's Stats step say "From the pack:
Ersveil" while the pack decides. Foe Health was `4 + class/3` blocks (the simulation chose it over `4 + class/2`, which left a focused build at Soul Class VII winning fewer than half its duels). With Levels it is `4 + floor(level/30)` blocks.

## Levels, XP and skill ranks

**Levels.** A character's level runs 1 to 99 (the Character block's `level`). At 100 XP the character goes up one level and the extra XP
carries over. The rise needs no confirm step and is said in "Changed this reply" ("Wessel reached Lv 15 (+1 point to spend)"). Every third
level (3, 6, 9 and so on) gives **1 stat point** to spend, and the Party card offers **Spend points**; the points never go above 60.
A character's level stops at its **cap**: the pack's `rpg.levelCap` when it names one, else the setting **Level cap** (1 to 99, default 99).
A character keeps the cap it was made with. At the cap, XP holds at 100 and nothing more is given. A block carries its own copy of its
rules, so a character made before a rule existed keeps the rule it has; give such a character points with the pencil on **Points** in its
Character block.

**Old chats and old blocks.** A Character block made before Levels has a Soul Class (I to IX) instead of a level. It reads as the level
10n − 5 (I is 5, IX is 85) for every rule: the roll term, the foe bars and the fight XP. A roll made before Levels has no `lv` mark and
replays exactly as it was recorded, with its Soul Class term. A new roll is stored in a slimmer form: it keeps the result, not the narrator's
cue text, which is rebuilt from the record when it is needed, so the replay reads the same.

**Ranks.** A pack may name rank bands in `rpg.ranks`: a list of `{ name, from, to }`, ascending, covering 1 to 99 (or a prefix), at most 20
names of up to 12 characters. A foe, or a character in a pack with no player-rank source, reads "Rank F · Lv 7", the band its level falls in
("Lv 7" alone when no band holds it). A pack's `rpg.playerRank` names a data-module field as the party's rank. Ersveil names the guild letter,
so a party member reads "Lv 14 · Guild F", and "Lv 14" alone while the guild field is empty (not registered).

**Practice.** Each use of a skill in a roll gives practice: 1 to 5 per use, set by **Practice per skill use** (default 3). Practice adds up per
skill in a reply and is held to 20 for a skill in one reply. At 100 practice a skill's rank goes up by one and practice starts again at 0.

**XP rate.** **XP rate** (Settings → RPG → Levels and practice) is 50 to 300 %, in steps of 25, default 100. Every XP gain to a character, the
fight's XP and the narrator's XP lines alike, is multiplied by it and rounded down, and is at least 1 when the gain was 1 or more. Each reply
records the rate it was made with, so a later change never moves a past reply.

**Skill ranks** run Novice, Adept, Expert, Master, and a Master keeps practice at 100.

**XP for a won fight is given by code (old pins).** When a reply takes the fight from "a foe group is still standing" to "every filled foe group is Down"
(by the dice, or by the narrator's own Foes lines), every party member who has not Left (a Down member too; a dead one is not paid) gets XP of their own, once for that fight. For each foe group a member gets `count × max(1, ceil(foe level ÷ 10)) × 2`, times 100 % plus 10 % for each level the foe is above the member (minus 10 % for each level below), held between 0 % and 200 %. The groups are added and rounded down; a total above 0 is held between 1 and 60, and a total of 0 gives no XP and no line. Level 5 against six level 5 foes gives 12 to each member; a level 25 member against them gives 0. The fight's groups are the ones that were standing when the reply began and are still on the Foes block, so a beaten group that stays on the block pays nothing again, and a later reply that fills a slot again and wins is a new fight. "Changed this reply" says so ("Astra +12 XP (fight won)"), a level-up follows the block's own rule, and a swipe, a Re-read, a delete in the middle, a rebuild and a reload all give the same XP. In that reply the narrator's own XP line for a party member is not used (one line in the Problems list says "XP for the fight is given by code; the narrator's XP line was not used."); XP lines in any other reply (a quest, a discovery) are the narrator's as before. A group the narrator clears from the block is gone, not Down (it fled, yielded or was taken), so the cue tells the narrator to leave a beaten group on the block, Down, in the reply it falls. The Combat rules text of a new chat says so too; a chat's stored text is not rewritten.

The narrator gives XP for other deeds with lines in the story (the XP rate applies to those too). The Combat rules text of an old pin says: XP for a won fight is given by code, other
deeds 5 to 40.

### Recovery and XP on a new Character

A Character pinned with `scale: 2` (`templates-recovery.js`, `data-modules/recovery.js`) has no `add-xp` kind: **XP comes from board fights only**, and the Combat rules text says nothing about XP lines. A narrator `add-xp` line is refused with one Problems note (code RECOVERY_REFUSED); the reader's own edit of XP stays.
- **Fight XP.** In a fight marked `bars: 2` each foe group pays `(15 + 2 x (count - 1)) x max(1, ceil(foe level / 10))`, times the level-gap percent as above; the groups are added, rounded down, held between 1 and 60 (0 pays nothing). One foe of the member's level gives 15, two give 17. A marked fight never holds a narrator XP line. A fight the narrator settled, a pre-check or narrator-won fight, and a mixed party are unmarked and pay the old sum.
- **Recovery.** Story kinds: `rest` (Stamina and Mana), `full-rest` (all three bars; refused when the last full rest was under 6 story hours earlier; no story clock means allowed; the minute is stored in the action, so rebuild and Re-read never ask the clock again) and `heal` (amount 1 to 3, one line a reply). There are no rest buttons: resting is narrative only (the sheet shows none, and a Character pinned earlier with Short rest and Full rest buttons shows none either; their recorded lines still replay). Hidden fields `rested-at` and `rested-known` keep the minute of the last full rest.
- **No story raising.** `set-health`, `set-stamina` and `set-mana` may lower a bar but a raise is refused with one note; only rest, full-rest and heal refill.

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
| **Character** | Name, who they are, Health, Mana, Stamina, the seven stats (1 to 20), points (1 more every third level), level, cap, XP, Alive, Left. The narrator sets Health, Mana, Stamina, XP and Alive; Left is set by a `- party` line; the reader sets stats and points. Rest refills Stamina and Mana. This row is the old pin; the new Character (`scale: 2`) has no narrator XP and gains the story's rest, full-rest and heal (no buttons), see [Recovery and XP on a new Character](#recovery-and-xp-on-a-new-character). The Standard formula's Character (`STANDARD_TEMPLATES`, `templatesFor`) keeps the blocks left in Health 0 to 8, Stamina 0 to 7 and Mana 0 to 7, stats start at 5 and a level-up gives points as above; see [Standard formula: bars of blocks](#standard-formula-bars-of-blocks). |
| **Skills** | Up to five skills (a new chat's typed block: eleven slots, each combat or utility, see [Skill slots](#skill-slots)), each with a name, what it does, the stat it rolls with, what it uses (stamina or mana), a rank and practice. The narrator names a skill with a learn line (name, what it does, stat, uses) and adds practice. Rank and practice cannot be typed in. |
| **Foes** | Up to four foe groups, one slot each (`level1` to `level4` for the level, which replaces `class1` to `class4`): the name, how many are left (0 means the slot is empty), the level and the group's health (Standard: 0 to 8 blocks, `4 + floor(level/30)` when the group arrives). |
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
  longer one is refused when the block is made. A Character's three bars may carry `scale: 2` (only 2, only on the `health`, `stamina` and `mana` bars, and all three together): they then hold up to 17 stages (`DM_LIMITS.scaledStages`) and the block marks a doubled-bars Character (see [Doubled bars](#doubled-bars-new-chats)). A Skills block with a `type1` field has up to 80 fields and 22 kinds (`skillsFields`, `skillsKinds`; a block without one keeps `skillsLegacyFields` 56).
- `prompt: false` is honoured for every field the RPG tells the narrator about: a skill's name, what it does, a foe's name or
  level, and `who`. The same holds for the rolls: a hidden foe name is "Foe 2" (its slot) there,
  a hidden skill name is not offered, and a hidden `who` is the block's own name. A hidden number (health, a stat, level, a
  rank, a foe's count, level or health, a skill's stat or resource) still counts for the dice; it is only left out of what the
  narrator is told: a check on a hidden stat reads "Wessel — Silent Trick, normal" (or "Wessel — check") with no
  stat named, a skill whose hidden resource is Empty is "cannot use Silent Trick: rolled without it", and a hidden skill stat
  missing from the sheet is "lacks the skill's stat". Whether something is hidden never changes the dice or how many rounds
  the cue tells: the cue is measured as if nothing were hidden (checks and refusals alike), and the hidden wording is never
  longer than the shown one. The replay witness holds the sheet numbers and the refusal texts as said, so hiding a field
  that changes a refusal's wording asks for a Re-read of that reply.
- A block with a `role` is made for the chat (`scope: chat`, one block for each person); a `role` on a block for a character is
  refused when the block is made, so the Party and Fight views always read the same blocks.
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
