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

When nothing changed, the model leaves the block out. A reply without it gets a small note under its
text: *No change lines came with this reply, so nothing in it changed the story.* That's fine when
nothing happened. If something did (you picked up a rope, paid the ferryman), edit the reply, add the
lines in a `<Changes>` block at its end, and press **Re-read** on the note. With the after-reply
extractor on (Story Suite settings → **Features** → *Read changes from replies that forgot them*), the
extractor reads such replies instead and the note doesn't show.

Lines the extensions couldn't use are listed faintly at the bottom of that reply's card, with the
reason: *not applied: − item Lantern | qty: 1 — There is no Lantern in the inventory.*

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

Quests follow the story. Take a job on in your own words ("I'll do it"), and the **Quests** screen shows
it with its progress (wolves beaten, pelts carried) and a line that says where it stands: Offered, Not
yet, Ready, or Ready to turn in here. When the goal is met, go back to a town or the person who gave the
job and turn it in in the story: code checks the goal and the place in the same reply, pays the reward
once and hands over any items the job asked for, or the story is told why not yet. There are no quest
buttons. One fight counts for one hunting quest; items you carry can count for an item quest at the
same time.

## Trade and crafting

Where there's a market (a town, or a trader present), the **Trade** screen lets you sell what you
carry and buy from what's on offer. Prices come from the rules and from the place, and money moves only
when you click. A smith or crafter can make something from your materials for a fee; you come back
when it's ready and **Collect** it.

There is one currency per chat, called gold unless you rename it in Story Block's settings (pennies,
crowns, Gil…). Whatever coin words the model writes, only the number counts. If you delete a reply in the
middle of the chat, the coin and items it gained or spent are taken back, and the later replies' own gains
and spending stay.

## Swipe, delete, edit

Each reply carries its own changes.

* **Swipe** a reply and what it changed is taken back; the new swipe makes its own changes. Swipe back
  and the old ones return.
* **Delete** a reply and its changes go with it, including anything you clicked after it.
* **Branches** and checkpoints keep the state they had.
* **Editing** a reply's text doesn't change the state. An edited reply gets a note with **Re-read**:
  press it to read the reply's `<Changes>` again and replace what it changed.

Swiping the reply that told an action never does the action twice: the potion was drunk once.

## Screens: tabs, cards, the HUD and the full-screen view

The same screens can show in five places:

* **Tabs** in Story Block's panel: Inventory, Scene, and one per installed module (Party, Fight,
  Quests…).
* **Cards** under each reply, folded to one line, for example *Changed this reply: +1 Moonveil Trout,
  −1 Rope · +30 gold · to Bluewatch Village*. Open one to see the details. A card under an older reply
  shows the story as it was **at that reply**. The *Changed this reply* card (and Story Director's
  status card) show under every reply by default, folded, on phones too. **Features** → *Cards under
  replies* turns them all off at once.
* **The HUD** (status strip), a thin strip above the message box, for example your health and status at
  a glance. It's on by default; turn it off or on again with **Status strip above the message box** in
  **Extensions → Story Block**, or **Features** → *Status strip* (the same switch).
* **The full-screen game view**, with its own menu of screens: the **Game view** button in the Story
  Suite bar, or **Alt+G** (press it again, or Escape, to close). It opens on **Home**: your character and
  party, a fight under way, where you are and when, who is here, your purse and what you wear, and your
  quests. Each part shows only when the extension behind it is installed.
* **Windows** (dialogs) for things like making your character.

Everything follows your SillyTavern theme's colours. Cards, meters and screens move a little when they
open or change; if your system asks for reduced motion, they don't move at all.

The **Inventory** has a **Filter…** box: type part of a name to see only matching things, together with
the kind, rarity and *Equipped only* filters next to it.

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

* **Currency**: the name of the money in your chats, one coin ("mark"), its plural ("marks"; blank: the
  name with an s) and its short form.
* **Money one reply may give**: the most the story's `+ coin` lines of one reply can pay (0: the top quest
  reward for your character's rank, or 1000 per level). The rest is not paid, and **Problems** says so.
  A reply also gives at most 20 of one item, and goods worth at most twice that money, plus one notable
  gift (the potion an old man hands you) worth up to five times the goods.
* **Change lines per reply** (Story Suite's own section, with **Notes per reply**): the most change lines
  one reply may hold, 150 by default; any after them are not used.
* **Screens**: turn each card on or off, and pick which version of a screen to use (the default, the
  card's, or a pack's). **Reset to default** always brings back the standard one.
* **Packs**: install, switch off, remove.
* **Features**: every optional part of every extension, each with an on/off switch and a line saying
  what it does (see below).
* Each module has its own section (combat, the story clock and calendar, NPCs).

### Features

Each extension's optional mechanics (wear and breakage, weather, a loot picker…) can be switched on or
off: in the **Features** list at the top of that extension's section, or all together on the
**Features** page of the Story Suite settings. Story Block's own are the **Status strip**, the **Cards
under replies**, and two helpers that each make one small extra model call, off until you turn them on:
*Roll checks before the reply* and *Read changes from replies that forgot them*.

* A feature that's off is gone from the story: the model isn't told about it, its lines are not used
  (Problems lists them quietly), its buttons, screens and tabs are hidden.
* Nothing is lost: what the story already holds for it is kept, and turning it on again brings it all
  back where it was.
* Your choices are yours, not the chat's: they hold in every chat until you change them.
* A feature marked *Changes the fixed prompt once (one slower reply)* changes the part of the prompt
  the model's provider keeps cached, so the next reply after the switch may take a little longer and
  cost a little more; the replies after it are fast again.
* **Problems**: lines the model wrote that couldn't be used, and why. Useful when something you expected
  didn't happen.

## When something looks wrong

* An item or coin the model mentioned didn't appear: look in **Problems**; the line may have been
  skipped (an unknown name, money you didn't have). You can always fix things with the buttons.
* The model narrates something the screens don't show: the screens are right. The next reply is told
  the real state.
* After editing a reply: use **Re-read** on it.
* A screen restyled by a pack or card looks broken: **Reset to default** in the screen settings.

## Removing Story Block from a chat

Story Block keeps each reply's change list in the reply itself, hidden in a comment
(`<!-- STORY_SUITE_V2 <Changes>…</Changes> -->`), and takes it out of the prompt while it runs. If you
switch Story Block off or uninstall it and go on with the same chat, those comments reach the model,
which may start writing change lines in its story text. To keep them out, add a SillyTavern regex
script (**Extensions → Regex → New global script**):

* **Find Regex**:

  ```
  /<!--\s*STORY_SUITE_V2\b[\s\S]*?-->/g
  ```

* **Replace With**: leave it empty.
* **Affects**: tick **AI Output**.
* **Ephemerality**: tick only **Alter Outgoing Prompt**, so the replies keep their lists (Story Block
  reads them again if you turn it back on) and only the prompt loses them.

## Slow disk? Raise SillyTavern's chat backup interval

SillyTavern rewrites the whole chat file on every save, and also writes a full **backup copy** of it,
at most once per *backup interval*. The default interval is 10 seconds, shorter than a reply, so in
practice every reply costs one or two extra full copies of the file on top of the saves. On a weak
server (a Raspberry Pi, a cheap VPS, an SD card or a network disk) that is what makes long chats slow.

What Story Suite's benchmark measured (docs/v2/PERFORMANCE.md, a 3,000-reply chat): the chat file is
about **31 MB** as built (v1 with a 3 KB state block: 24 MB), and a reply writes about **100 MB** in
full-file saves plus one backup copy (v1: 48 MB). The backup copy alone is one more full file per reply,
**31 MB** at that length.

Raise the interval to **5 minutes** in SillyTavern's `config.yaml` (in SillyTavern's folder) and restart
SillyTavern:

```yaml
backups:
  chat:
    throttleInterval: 300000
```

The value is in milliseconds (300000 = 5 minutes; the default is 10000). Backups then happen at most once
per 5 minutes per chat, whatever Story Suite and SillyTavern save in between, and you still keep a recent
copy. With long chats, also look at how many backups are kept: `backups.common.numberOfBackups` (default
50 per chat) and `backups.chat.maxTotalBackups` (default -1, keep all). Each backup is a full copy of
the chat, 20–30 MB for a 3,000-reply chat. These are the key names of SillyTavern 1.19's
`default/config.yaml`; older versions used other names (`chatBackupThrottleInterval`), which SillyTavern
moves to the new ones on start.

## Reporting a bug

Copy this into a GitHub issue on the extension that misbehaved (Story Block if you're not sure), fill
it in, and attach what it asks for:

```markdown
**What I did**
(The steps, from the last thing that worked: "Sent 'I buy the rope', pressed Use on the draught, swiped".)

**What I expected**
(What should have happened: "Rope in the Inventory and 5 gold less".)

**What happened**
(What happened instead, and any message or red notice you saw.)

**Screenshot**
(The screen, card or notice that shows it.)

**The chat's last two replies**
(Open each reply's edit box (the pencil) and copy its whole text, including the hidden
`<!-- STORY_SUITE_V2 … -->` part at the end, which holds the change lines.)

**Setup**
- SillyTavern version:
- Story Suite extensions and versions (Extensions → Story Block shows them):
- Model / API:
- Pack(s) in use:
- Phone or desktop, browser:
```

The **Problems** list in the settings and the browser console (F12, lines starting with
`[Story Suite]` or `[Story Block v2]`) help too: paste them if they mention the moment it went wrong.
