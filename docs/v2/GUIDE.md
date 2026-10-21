# Story Suite v2: the player's guide

Story Suite v2 is four SillyTavern extensions that work together. The story is still written by the
model, but the numbers are kept by the extensions: what you carry, your money, your health, where you
are, the quests you've taken, every dice roll. The model tells the story around them, and can't make
them up or forget them.

* **Story Block** is the base. It keeps the place, who is there, your things and your money, and draws
  every screen. The other three need it.
* **RPG Battle** adds your character and party, dice checks, fights, trade and crafting.
* **Story Director** adds the story clock, quests and events.
* **NPC State Delta** adds what the people you meet know and feel, and their portraits.

Each one is optional except Story Block. Install only what you want.

v2 is a test version. It is a fresh start: it does not read chats or blocks from v1, and v1 and v2
should not be installed side by side.

## Installing

You need SillyTavern 1.19 or newer.

**Use a separate SillyTavern profile.** Keep your usual setup as it is and try v2 in its own place:

* the easiest way is a second SillyTavern user: in SillyTavern's `config.yaml` set
  `enableUserAccounts: true`, restart, and add a user (for example "v2") in **User Settings → Admin
  Panel**. Log in as that user for everything below; extensions you install there stay there;
* or a second copy of SillyTavern in another folder.

Then, logged in as that profile:

1. Open **Extensions → Install extension**.
2. Paste `https://github.com/kohz87/Story_block` and choose the branch **`v2`** (type `v2` in the branch
   box). Install.
3. Do the same for the others you want, each on its branch `v2`:
   `https://github.com/kohz87/rpg_battle`, `https://github.com/kohz87/Story_director`,
   `https://github.com/kohz87/npc_state_delta`.
4. Reload the page.

If your SillyTavern has no branch box, install it the usual way and switch it to `v2` from the
extension's folder (`git checkout v2`), or ask whoever set up your SillyTavern.

To update later, use **Extensions → Manage extensions → Update** as usual; the branch stays `v2`.

## Your first chat

**Set up your persona first** (SillyTavern's user persona): its name, description and avatar become
your character's name, background and portrait.

Open a chat with any character. The greeting shows as normal, but **before the story can go on you make
your character** (when RPG Battle is installed): a window opens where you pick a race and talents (if the
game has them) and spend points on your stats. Press **Create**. Until then the story waits; if you
close the window, sending a message opens it again.

With Story Block alone there is no character to make; you can start right away.

## The `<Changes>` block

At the end of each reply the model adds a short hidden list of what changed in the story:

```
<Changes>
+ item Moonveil Trout | qty: 1 | note: violet-streaked
- item Rope | qty: 1
+ coin 30 | from: the sealer
~ place Bluewatch Village | kind: settlement
+ present Fenna
</Changes>
```

You normally never see it: Story Block reads it, hides it, and changes your inventory, wallet and scene
to match. Each line is only a **suggestion**. The extensions check it against what is really there: you
can't lose a rope you don't have, a price is set by the rules and not by the model, and anything that
doesn't make sense is skipped and noted in the problems list instead of breaking the story.

It's the only block v2 asks for. If your preset also makes the model write a "World State" or other
blocks, turn those off in the preset: v2 doesn't read them.

## Buttons first

Anything the screens offer is a button, and a button is done by the code right away, not by the
model: using a potion, equipping a sword, dropping something, starting a fight, buying, selling. The
next reply is told what happened, with the exact numbers, and narrates it. A thing done once is told
once.

## Checks and modifiers

When you try something whose outcome isn't certain (sneaking past a guard, climbing a wet wall), the
model stops before the outcome and asks for a **check**: a d20 roll against a difficulty.

The check waits for you in RPG Battle. Your stat is already added. Before you roll you can add what
fits: a skill or ability you have, an item that helps, or your own bonus or penalty with a short
reason. Press **Roll**. The roll and every bonus are shown, and the next reply tells what happened.

If you just send your next message without rolling, the check is rolled for you first, with only the
automatic bonuses.

## Fights

When danger shows up, an **encounter** card appears with the foes and how tough they look. You choose:
**Fight** or let it pass. In a fight you take one action at a time (attack, a skill, an item, flee) and
the others act in turn. Rolls are fair and repeatable: the same fight played the same way goes the same
way. When it ends, loot, experience and the result are added for you, and the next reply narrates the
fight.

## Return in time

If your character dies, you're offered **Return**: the chat goes back to the moment just before that
fight started, with your character alive, as a new branch. The old timeline is kept in SillyTavern's
branches; the fight that killed you is not on the new one. The next reply knows you're back at that
moment.

## Quests

When someone offers you a job, it shows in the **Quests** screen with **Take on** and **Turn down**.
Active quests show their progress (wolves beaten, pelts carried). When the goal is met, go back to a
town or the person who gave the job and press **Finish**: the reward is paid once, and any items the
job asked for are handed over. One fight counts for one hunting quest; items you carry can count for
an item quest at the same time.

## Trade and crafting

Where there's a market (a town, or a trader present), the **Trade** screen lets you sell what you
carry and buy from what's on offer. Prices come from the rules and from the place, and money moves only
when you click. A smith or crafter can make something from your materials for a fee; you come back
when it's ready and **Collect** it.

There is one currency per chat, called gold unless you rename it in Story Block's settings (pennies,
crowns, Gil…). Whatever coin words the model writes, only the number counts.

## Swipe, delete, edit

Each reply carries its own changes.

* **Swipe** a reply and what it changed is taken back; the new swipe makes its own changes. Swipe back
  and the old ones return.
* **Delete** a reply and its changes go with it, including anything you clicked after it.
* **Branches** and checkpoints keep the state they had.
* **Editing** a reply's text doesn't change the state. To read an edited reply's `<Changes>` again,
  use **Re-read** on that reply.

Swiping the reply that told an action never does the action twice: the potion was drunk once.

## Screens: tabs, cards, the HUD and the full-screen view

The same screens can show in five places:

* **Tabs** in Story Block's panel: Inventory, Scene, and one per installed module (Party, Fight,
  Quests…).
* **Cards** under each reply, folded to one line, for example *Changed this reply: +1 Moonveil Trout,
  −1 Rope · +30 gold · to Bluewatch Village*. Open one to see the details. A card under an older reply
  shows the story as it was **at that reply**. Cards are off until you turn them on, one by one, in the
  settings.
* **The HUD**, a thin strip above the message box, for example your health and status at a glance.
* **The full-screen game view**, with its own menu of screens. It opens on **Home**: your character and
  party, a fight under way, where you are and when, who is here, your purse and what you wear, and your
  quests. Each part shows only when the extension behind it is installed.
* **Windows** (dialogs) for things like making your character.

Everything follows your SillyTavern theme's colours.

## Packs

A **pack** is a ready-made setting in one file: items with their prices and effects, creatures, shops,
recipes, quests, events, races and talents, a starting place and purse, a currency name, and its own
look for the screens. Packs are data only; nothing in them can run code.

* **Install from a file:** Story Suite settings → **Packs** → **Import pack file**.
* **From a character card:** some cards carry a pack in their lorebook. Story Suite asks first: click
  **Read from character lorebook** in the Packs section.

You can switch a pack off or remove it at any time. A story already told keeps what it got from the
pack.

## Settings

Open **Extensions → Story Block**, or the Story Suite overlay when two or more are installed.

* **Currency**: the name of the money in your chats (and its short form).
* **Screens**: turn each card on or off, and pick which version of a screen to use (the default, the
  card's, or a pack's). **Reset to default** always brings back the standard one.
* **Packs**: install, switch off, remove.
* Each module has its own section (combat, the story clock and calendar, NPCs).
* **Problems**: lines the model wrote that couldn't be used, and why. Useful when something you expected
  didn't happen.

## When something looks wrong

* An item or coin the model mentioned didn't appear: look in **Problems**; the line may have been
  skipped (an unknown name, money you didn't have). You can always fix things with the buttons.
* The model narrates something the screens don't show: the screens are right. The next reply is told
  the real state.
* After editing a reply: use **Re-read** on it.
* A screen restyled by a pack or card looks broken: **Reset to default** in the screen settings.
