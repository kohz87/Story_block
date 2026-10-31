# RPG

The RPG is an optional part of Story Block for light combat and character growth. It keeps a party sheet
for you and each companion, rolls the dice for fights and checks, and raises Soul Class and skill ranks as the
story goes on. It is off by default, and with it off Story Block works exactly as before.

## Turning it on

Open **Settings → Features** and switch on **RPG**. A page of its own, **Settings → RPG**, appears under Features
(see [Settings → RPG](#settings--rpg)). With **Rolls: automatic** (the default) the dice are rolled for you; with
rolls **off**, the narrator still tells the story, but no dice are rolled and no battle log is drawn.

Make your characters with **New character** on the Party tab (see [Making a character](#making-a-character)). To build
a sheet by hand instead, use **Game view → Blocks**: choose **New block**, then a template from the **RPG** heading
(see [The four templates](#the-four-templates)). Make one Character block for each character in the party, and
one Skills block for each of them that has skills. Foes is one block for the foe groups in a fight. Combat rules is
one block for the whole chat and carries the combat text.

## The Party tab

With the feature on, the **Party** tab shows one card for each Character block: the name, the Soul Class and XP,
the three stage bars, the seven stats in a row and the skills with their ranks. When a character has unspent
points, the card offers **Spend points**, which opens the stat view with steppers under the point budget. **Stats**
opens the same view for the stats alone, and **Skills** opens the character's [Skills view](#the-skills-view). **+ New
character** in the header opens the wizard; with no character yet the tab says so and offers **Create your character**.

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
   character named like your persona, so You takes that name and a companion cannot.
2. **Stats.** The same steppers and radar as Spend points. Every stat starts at 10 and you have 6 points to spend. A
   stat can go down to 8 to free a point and up to 15. Points you leave unspent stay on the character for Spend points.
3. **Skills.** Start from a template (Guild fighter, River scout, Hedge mage, Field medic, Silver tongue, and the sets a
   pack adds) or write your own. Up to five skills, each with a name, what it does (up to 120 characters, which the
   narrator reads), the **Stat** it rolls with, what it **Uses** (stamina or mana) and what it **Starts at**: Novice, or
   Adept for one skill at most. Rank and practice are never typed in.
4. **Review.** Everything in one place. **Create** makes two blocks, the Character block (named for the character) and the
   Skills block ("Wessel's skills"), each with one action, so a creation costs two of the reply's changes. If the second
   cannot be made the first is taken back and nothing is left half made. The window says what is in the way in plain
   words, for example a name that is taken or a story that already has eight blocks.

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

**The roll rule.** A character's roll is `d20 + half the stat (rounded down) + skill rank + 2 × Soul Class + edge`, against
the foe's `d20 + 5 + 2 × the foe's class`. The rank is 0 for Novice up to 3 for Master, and the edge (from minus 3 to
plus 3) is what the situation earns, such as an ambush. That is the **Standard** difficulty; the numbers 5, 2 and
"half" can be changed in [Settings → RPG](#settings--rpg).

- **A skill brings its own stat and resource.** An action that uses a skill the character has rolls with that skill's stat
  and spends that skill's resource (stamina or mana), whatever the planning step wrote. If the resource is Empty the action
  is rolled without the skill: same stat, rank 0.
- An action with no skill rolls the stat the planning step picked, at rank 0. So does an action that names a skill the
  character does not have, and the log says so. If there is no stat at all (a skill the character lacks and none given, or a
  skill from an old Skills block that has no stat of its own) the roll uses the character's best stat, untrained, and says so.
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

The page has four cards, and shows only while the RPG is on.

- **Rolls.** **Automatic** or **Off**, as above.
- **Difficulty.** **Gentle**, **Standard**, **Harsh** or **Custom**. The presets change the foe's base and how far short
  a roll may fall and still be "success at a cost": Gentle is a base of 3 and a window of 3, Standard 5 and 2 (the rule
  above), Harsh 7 and 1. All three keep a Soul Class worth 2, half the stat, a decisive margin of 8 and at most 5 exchanges
  a reply. **Custom** shows the six numbers: **Foe's base** (0 to 15), **Soul Class adds** (×1, ×2 or ×3, for both sides),
  **Stat adds** (half the stat, or a third), **"At a cost" when short by** (0 to 5; 0 turns it off), **Decisive at a margin
  of** (4 to 15, or a natural 1 or 20) and **Most exchanges per reply** (1 to 8). A number outside its range is held to
  it. Under the numbers a bar shows the exact chances of success, success at a cost and fail for your own character (the
  persona's name, else the first Character block) with their best skill, against a foe of their Soul Class, and it
  changes as you type. A line under it gives the other presets for the same fight.
- **What the narrator is told about combat.** The text of this chat's Combat rules block (up to 1200 characters, counted
  as you type). It is saved when you leave the box (or close the settings window with text still in it), as an edit of that
  block on the latest reply: swipe or delete that reply to take it back. A chat keeps a limited number of block versions;
  when it has kept as many as it can, the box says so in plain words. **Reset to the default** puts the template's text back. Each chat has its own text; a new chat
  starts from the default. A chat with no Combat rules block says so and offers **Add the Combat rules block**.
- **Roll planner.** Your own instructions (up to 400 characters) for the short call that plans the dice, added after its
  fixed part. **Show the planner's full prompt** shows exactly what that call is sent for this chat, read-only: the format
  of its answer stays fixed so the dice can be read.

With the RPG off none of this is read or sent.

## Soul Class and skill ranks

These rise on their own, with no confirm step.

- **Soul Class** runs I to IX. At 100 XP the Soul Class goes up by one and XP starts again at 0. At IX, XP stops at 100.
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
| **Character** | Name, who they are, Health, Mana, Stamina, the seven stats (1 to 20), points, Soul Class, XP, Alive. The narrator sets Health, Mana, Stamina, XP and Alive; the reader sets stats and points. Rest refills Stamina and Mana. |
| **Skills** | Up to five skills, each with a name, what it does, the stat it rolls with, what it uses (stamina or mana), a rank and practice. The narrator names a skill with a learn line (name, what it does, stat, uses) and adds practice. Rank and practice cannot be typed in. |
| **Foes** | Up to four foe groups, one slot each: the name, how many are left (0 means the slot is empty), the Soul Class and the group's health. |
| **Combat rules** | The combat text, which the narrator reads on every reply, and the XP guidance. It has no fields. |

The combat text of this chat can be changed on [Settings → RPG](#settings--rpg). To read or change a template's rules, make a block from it, then use the block's actions menu to
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
  a hidden stat or skill is not offered, and a hidden `who` is the block's own name.
- Cards are shown in the order end, warn, info (at most 8 at a time), so the death notice always has a place.
- The story cannot kill a character directly: the stock Character has no line that sets `alive`. A character dies only through
  the reply-end latch, in a reply after the one that made them Down. The latch is settled by a `dm.settle` step that every
  reply with accepted lines records (it may change nothing), so a Re-read of an earlier reply plans it again. The last of
  the 32 actions a reply may hold is kept for it: the story's 32nd action is refused with a plain sentence.

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
