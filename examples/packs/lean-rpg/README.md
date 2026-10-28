# Lean RPG (interim)

`pack.json` here (id `lean-rpg`, version 0.1.0) is a small character sheet made only of **data modules v1**: no new
code, no RPG Battle. It needs Story Block 2.5 and Story Director (each sheet belongs to a Story Director character).
It works on its own or beside the open-world Ersveil pack (`examples/packs/ersveil`): their five data modules pin
together in one chat, and the lore words (Soul Class, Iron Breath, Spark) are Ersveil's.

Two modules, each **attached per character**:

* **Character** (`character`): health in words (unhurt, grazed, hurt, wounded, badly-wounded, down), mana and
  stamina in words (fresh, steady, tired, spent, empty), **Soul Class I to IX** with XP to 100, six stats (STR,
  DEX, CON, INT, WIS, CHA, 1 to 20, start 10) with their dice bonus (half the stat, rounded down: STR 14 (+7)) and
  unspent stat points (start 6). Its **Sheet** tab shows "Soul Class II · XP 34/100" and a **+1** / **−1** beside
  each stat.
* **Skills** (`skills`): sixteen skills (Strike, Guard, Iron Breath, Spark, Archery, Stealth, Tracking, Survival,
  First Aid, Monster Lore, Runes, Alchemy, Riding, Haggling, Locks, Listening), each novice, adept, expert or master
  with progress to 20. Its **Skills** tab lists them.

## Setting it up

1. Settings → **Tabs & Packs** → **Import pack file** → this `pack.json` (and Ersveil's, if you play there).
2. Make the character in Story Director (its Setup, or the Checks settings: a character with a name).
3. Settings → **Tabs & Packs** → **Data modules**: **Enable for this chat** on Character and on Skills, ticking the
   character to attach (or attach them later there).

## What the narrator writes

Story Block tells the narrator these lines once the modules are on. `who` is the character's name. Examples:

```text
~ dm character — a spear through the thigh | kind: health | who: Wessel | to: wounded
~ dm character — the long climb | kind: stamina | who: Wessel | to: tired
~ dm character — pushed mana into the blade | kind: mana | who: Wessel | to: spent
+ dm character — survived the ambush | kind: xp | who: Wessel | amount: 20
+ dm character — a hard lesson | kind: points | who: Wessel | amount: 1
+ dm skills — drilled breathing at dawn | kind: practice | who: Wessel | skill: iron-breath | xp: 3
```

* **XP**: 1 to 30 per line, one line per reply. At 100 the Soul Class goes up by one (to IX at most), 100 is taken
  off and the rest kept, and the character gets **2 stat points**. At IX the XP stops at 100.
* **Points**: the narrator may give 1 to 3, one line per reply.
* **Practice**: 1 to 5 progress per skill per reply. At 20 the skill ranks up and the progress starts again from
  what was left over; a master stays at 20/20.

## Spending points from the sheet

**+1** spends a point on a stat (refused with no points left or at 20); **−1** takes one back (refused at 1). You
can press several in a row; the sheet is drawn again after each. Every button press is a change of its own on the
latest reply, like any other sheet button.

## Limits (data modules v1)

* **Skills come from the pack's list.** A `dm` line has no free text, so the sixteen names are fixed here; a skill
  the story invents has no row.
* **The lines are the long `dm` format** above; the narrator must write the kind and its labels exactly. A line
  outside the bounds is refused and changes nothing (the Problems list says why).
* **Class-up and rank-up are automatic**: rules in the module, never the narrator's to write.
* **No dice yet.** The dice bonus is shown for the story to use; checks inside data modules come with v1.1.
* **A rank is a number inside** (0 novice … 3 master), shown as a word: v1 cannot step a word along in one line,
  and sixteen skills times three steps would need more rules than v1 allows.
* **A point spent and taken back on the same value** in one reply (+1, −1, +1 on STR 11) is refused the third time
  as already applied; send a reply first. The buttons send the value they show, so a stale sheet is refused too.
* **The narrator could write `raise` / `lower` lines as well** (v1 has no sheet-only kinds); it is told the lines
  like the others.
* The narrator sees each sheet in the prompt's tail, cut to 100 tokens (the skills' progress may be cut short).

## A combat prompt to go with it

Paste this into SillyTavern's World Info (a constant entry) or the Author's Note:

```
[COMBAT SYSTEM]
No Plot Armor: combat follows physical reality and the lore. Size, skill, numbers, reach, armor, terrain, preparation and Soul Class all matter. Against a stronger foe, {{user}} loses unless a believable edge exists: ambush, terrain, numbers, poison, preparation.
Exchanges: a fight is told exchange by exchange, each with clear cause, cost and consequence, in the order things happen. Most fights are short; one exchange may be the whole fight. Never skip the moment that decides it.
Weight & Risk: every strike, miss, wound and hesitation carries impact. Injury, fatigue, fear and pain carry into the next exchange and the next scene.
Believable Outcomes: fights end when logic demands it: death, surrender, retreat, capture or collapse. NPCs take those exits when the fight turns against them. Victory must be earned; survival must be justified.
```
