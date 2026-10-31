# Lean RPG

The Lean RPG is an optional part of Story Block for light combat and character growth. It keeps a party sheet
for you and each companion, rolls the dice for fights and checks, and raises Soul Class and skill ranks as the
story goes on. It is off by default, and with it off Story Block works exactly as before.

## Turning it on

Open **Settings → Features** and switch on **Lean RPG**. Then open **Settings → Lean RPG** to choose how rolls
work: **Rolls: automatic** (the default) or **off**. With rolls off, the narrator still tells the story, but no
dice are rolled and no battle log is drawn.

Build the sheets in **Game view → Blocks**: choose **New block**, then a template from the **Lean RPG** heading
(see [The four templates](#the-four-templates)). Make one Character block for each character in the party, and
one Skills block for each of them that has skills. Foes is one block for the foe groups in a fight. Combat rules is
one block for the whole chat and carries the combat text.

## The Party tab

With the feature on, the **Party** tab shows one card for each Character block: the name, the Soul Class and XP,
the three stage bars, the seven stats in a row and the skills with their ranks. When a character has unspent
points, the card offers **Spend points**, which opens the stat view with steppers under the point budget. **Stats**
opens the same view for the stats alone, and **Skills** opens the list of skills.

Edits made here ride on the latest reply, like any other pencil edit: swipe or delete that reply to take them back.

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
one short line per action, for example `Wessel → Sluice rat A: SUCCESS (26 vs 16)`. Tap a line to see the numbers.

- A **swipe** rolls again: the reply and its dice are new.
- **Re-read** keeps the same dice.
- Changes made by a roll, and any level-up, appear under **Changed this reply**.

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
| **Character** | Name, Health, Mana, Stamina, the seven stats (1 to 20), points, Soul Class, XP, Alive. The narrator sets Health, Mana, Stamina, XP and Alive; the reader sets stats and points. Rest refills Stamina and Mana. |
| **Skills** | The name, rank and practice of up to five skills. The narrator names a skill with a learn line and adds practice. |
| **Foes** | Up to four foe groups, one slot each: the name, how many are left (0 means the slot is empty), the Soul Class and the group's health. |
| **Combat rules** | The combat text, which the narrator reads on every reply, and the XP guidance. It has no fields. |

To read or change a template's rules or combat text, make a block from it, then use the block's actions menu to
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

Keep to the block limits: 16 fields and 16 kinds in one block, and text of up to 240 characters.
