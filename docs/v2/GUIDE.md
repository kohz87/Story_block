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
   box). Install. **Story Block always comes first.**
3. Then do the same for the others you want, each on its branch `v2`:
   `https://github.com/kohz87/rpg_battle`, `https://github.com/kohz87/Story_director`,
   `https://github.com/kohz87/npc_state_delta`.
4. Reload the page.

If your SillyTavern has no branch box, install it the usual way and switch it to `v2` from the
extension's folder (`git checkout v2`), or ask whoever set up your SillyTavern.

To update later, use **Extensions → Manage extensions → Update** as usual; the branch stays `v2`.
**Update Story Block first, then the modules.** Each module says which Story Block it needs, and an
older Story Block refuses a newer module. When that happens, the page shows a red notice such as
*Story Suite: RPG Battle needs Story Block ≥ 2.0.0-beta.1; this is 2.0.0-alpha.2. Update Story Block to
use it.*, and that module's row in **Story Suite settings → Versions** says the same. Update Story Block
and reload the page. NPC State Delta is the exception: it keeps working on its own, without its meters,
Cast tab or Story Suite section, until Story Block is updated.

## Your first chat

**Set up your persona first** (SillyTavern's user persona): its name, description and avatar become
your character's name, background and portrait.

Open a chat with any character. The greeting shows as normal, but **before the story can go on you make
your character** (when RPG Battle is installed). Open the character window from any of these:

- **Create your character** on the *Before you start* card at the top of Home (Game view);
- **Create your character** on the Party tab (Story);
- **Create** on the status strip above the message box;
- or just send a message: the story waits, says why, and the window opens.

In the window you start from a pack's ready-made character (it fills in race, talents and points) or
your own, pick a race and talents (if the game has them) and spend points on your stats. **Random** on
the Talents step rolls talents for you: **Keep it** takes that roll. Press **Create**. To bring a
character you made before, use **Import character** on the first step and pick its file (made with
**Save character file** on your Party card). If you close the window, any of the buttons above opens it
again. Once your character exists the buttons and the card are gone.

With Story Block alone there is no character to make and no *Before you start* card; you can start
right away. Any other module that needs something first shows its reason on that card the same way.

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
extractor reads such replies instead and the note doesn't show, unless its call fails (an error or a
time-out): then nobody read the reply and the note comes back.

Lines the extensions couldn't use are listed faintly at the bottom of that reply's card, with the
reason: *not applied: − item Lantern | qty: 1 — There is no Lantern in the inventory.*

**Loot to pick from.** When the story lays things out rather than handing them over (a shelf, a chest,
a fallen foe's belt), the model writes `? loot Rusty Key, Lantern Oil x2, Torn Map — on the cellar shelf`.
Nothing is given yet: the reply's card shows the things as chips, and so does **To pick up** at the top of
the Inventory (handy with the cards off). Tick the ones you want and press **Take selected**; they go into
the party's bag. Each reply's loot is taken once, things you already
carry are left out, and what one reply may lay out is held to the same limits as what it may give. A
take you cannot carry is refused, and the loot stays there. Turn it off with **Pick what you take** in
the Features.

**Encumbered.** When the story gives the party more than it can carry, nothing is lost: the things are
kept, and the party is *encumbered* (AGI and DEX checks −2, and the model is told) until something is put
down. Your own takes, buys and hand-overs past the limit are still refused. Turn it off with
**Encumbered** in the Features; then a story line past the limit is refused instead.

## The story leads, buttons manage your things

Story actions happen in the story. You take a quest or drink a potion by saying so in your
message, and the story tells it. Code checks each change and sets the numbers in the same reply.
There are no buttons for story actions.

Buttons are for managing your things and the game: equipping a sword or taking it off, giving
something to a companion, dropping it, starting a fight, buying, selling. A button is done by the code
right away, not by the model. The next reply is told what happened, with the exact numbers, and
narrates it. A thing done once is told once.

## Checks and modifiers

When you try something whose outcome isn't certain (sneaking past a guard, climbing a wet wall), the
dice decide. You don't roll them yourself, and you don't wait.

* Before each reply, code rolls two d20s. The story gets them with a short table of your party's
  bonuses for each kind of check. Code builds that table from your stats, skills and gear.
* The story sets how hard the attempt is (easy 10, normal 15, hard 20, very hard 25), takes the first
  roll, adds the bonus and tells the outcome in the same reply. A second attempt in the same reply
  takes the second roll.
* A natural 20 always succeeds and a natural 1 always fails. Falling 1 or 2 short succeeds at a cost.
* Code works the result out again from the same dice and records it. The card under the reply shows
  each check with its roll and bonus. If the story told a different outcome than the dice give, the
  card says so.
* A reply holds at most two checks. A swipe brings fresh dice.

There is no Roll button, and nobody adds or changes a bonus by hand.

## Fights

When danger shows up, an **encounter** card appears with the foes and how tough they look. You choose:
**Fight** or let it pass. In a fight you take one action at a time (attack, a skill, an item, flee) and
the others act in turn. Rolls are fair and repeatable: the same fight played the same way goes the same
way. When it ends, loot, experience and the result are added for you, and the next reply narrates the
fight.

### Ranks, foes and companions

Your character has a **rank** from their level: F to S by default, or the pack's own ladder (Ersveil's
runs from F Registered to S Legend). Quests and the money a reply may give follow it.

The story can say how strong foes are: weak, even, strong or deadly next to your party, or a rank
("three wolves, rank D"). Code picks the foes' levels from that, never the model, and holds a rank far
beyond your party back to the strongest that still fits a deadly fight.

A companion who joins gets stats worked out by code from their level and role, never from numbers the
model writes. Their level is at most two above your character's.

## Return in time

If your character dies, you're offered **Return**: the chat goes back to the moment just before that
fight started, with your character alive, as a new branch. The old timeline is kept in SillyTavern's
branches; the fight that killed you is not on the new one. The next reply knows you're back at that
moment.

### Save points

On **Home** (the game view), **Save point** keeps this moment: give it a name (or leave it blank for
*Save point 1*, *2*…) and press Enter. Story Block makes a SillyTavern branch of the chat at the latest
reply and lists it under **Save points** with its name, its message and the date. **Return here** opens
that branch, with the story exactly as it was then; you can come back to the chat you left from
SillyTavern's chat list (or *Back to parent chat*). **Forget** only takes a save point off the list; the
branch stays in SillyTavern. A chat keeps up to 50. Save points are kept with the chat file, not in the
story, so a swipe, a deleted reply or a Return never takes one away. Turn them off in **Features** →
*Save points*.

## Quests

Quests follow the story. Take a job on in your own words ("I'll do it"), and the **Quests** screen shows
it with its progress (wolves beaten, pelts carried) and a line that says where it stands: Offered, Not
yet, Ready, or Ready to turn in here. When the goal is met, go back to a town or the person who gave the
job and turn it in in the story: code checks the goal and the place in the same reply, pays the reward
once and hands over any items the job asked for, or the story is told why not yet. There are no quest
buttons. One fight counts for one hunting quest; items you carry can count for an item quest at the
same time.

Every quest has a clear goal. When code can't count it (find the missing girl, win the mayor's
trust), the story says when it is met, and the quest shows Ready. **Details** on a quest shows its
goal, progress, reward, who gave it, when it is due and what has happened so far. A finished quest
stays in the list under Finished. New jobs come at a calm pace; a passer-by stays a passer-by.

### The days behind you

When a story day ends, Story Director writes a short digest of it from what code recorded: where you
went, quests taken and finished, fights, money in and out, which people's feelings reached a new
stage, and world news. The model writes none of it.

The **Days** screen lists the days, newest first. Open one to see its digest, or search them all. After
a time skip, the next reply gets one line about the last day, so the story remembers it. Story
Director's settings choose how many days are kept and can turn that reminder off. Turn the digest off
with **Day digest** in the Features.

## Using things in the story

To drink a potion or use a salve, just do it in the story ("I drink the draught", "I put the salve on
Wessel's arm"). The story writes the use as a change line, for example
`! use Healing Salve | on: Wessel`, and code applies the item's effect in the same reply, from the
item's own numbers. The bag shows one less.

If it can't be used (you're at full health, there's nothing to cure, it isn't in the bag), code keeps
it in the bag and the next reply is told why. During a fight, using something is your action for that
turn.

There is no Use button. **Equip**, **Take off** and **Give** stay in the Inventory, because they only
manage your things.

### Effects that wear off

Some things last a while: a blessing that sharpens your eyes, a potion's strength, a curse, or a
*Setback* after a failed quest. The story writes them as a change line, for example
`+ effect Hawk's Eye — the shrine's blessing | on: perception | for: 2h`, and ends one early with
`- effect Hawk's Eye`.

* Code sets the strength. An effect the story writes is always small (±1 on checks, a little in
  fights), and one reply can start only one. Each character keeps one story effect per kind of check;
  a new one replaces the old.
* Effects from items, quests and gear can be stronger, up to ±3 on a check in all.
* An effect fades on the story clock or after a number of replies, whichever comes first. A day at
  most. Deleting a reply or setting the clock back never makes one last longer.
* The model is told only the effects' names and short notes, never their numbers.

Turn them off with **Timed buffs and debuffs** in the Features.

## Trade

Where there's a market (a town, or a trader present), the **Trade** screen lets you sell what you
carry and buy from what's on offer. Prices come from item values and from the place, and money moves
only when you click. A smith or crafter can make something from your materials for a fee; you come back
when it's ready and **Collect** it. A key item can't be sold.

## Gear: wear, repair and refinement

Weapons and armour wear down. A piece is **good**, **worn** (85% of its stats), **tattered** (60%) or
**broken** (none, though it stays on). Armour wears with the damage you take in a fight, and a weapon a
little with each fight. The story can also say a piece suffered (`~ item Coat — torn by brambles |
wear: tear`); code decides how much. When a piece gets worse, the next reply is told.

* **Repair kits** patch a piece in the field: use one in the story ("I patch my coat"). Each patch
  takes a little off how good the piece can get until it is properly repaired.
* **A smith or tailor** repairs a piece to full for a fee: in the story (`! repair Chain Shirt | at:
  smith`) or on the Trade screen.
* **Refinement**: a smith can make a piece +1, +2 or +3 for materials and a fee. Each level adds 8% to
  its stats and shows in its name ("Iron Sword +2"). The +3 attempt can fail; then the materials and fee
  are spent and the piece stays +2.
* Repairing or refining a piece and then selling it never brings in more than selling it as it was.

The Inventory and the Party cards show each piece's condition and refinement. Turn these off with
**Gear wear and repair** and **Gear refinement** in the Features.

## Crafting

Crafting follows the story, like everything else. Say what you make and with what ("I brew a salve
from the moss"), and the story writes it as a change line, for example
`! craft Healing Salve | with: Bluecap Moss x2`. Companions craft too, with their own stats.

* **Dice.** The craft uses the reply's own dice, like a check. Code adds the character's stats for
  that craft, their skill in it, their tools and the materials' quality, against the recipe's
  difficulty.
* **Results.** Below the difficulty the craft fails and half the materials are lost. Just over it
  makes the item. Well over it makes a **fine** piece (stronger), and far over it, or a natural 20,
  a **masterwork**. A natural 1 loses everything and leaves you a botched piece.
* **Stations.** Smithing needs a forge, alchemy an alchemy table, cooking a campfire or an inn. Code
  reads them from where you are: a smith has a forge, an apothecary an alchemy table. Out in the wild,
  `at: campfire` makes a campfire.
* **Recipes.** Some recipes everyone knows. Others are learned in the story from someone who teaches
  them (`+ recipe Healing Salve | from: Hollis`). A recipe the story makes up is kept for this chat,
  with a difficulty code sets.
* **Carry limit.** If the party couldn't carry what the craft makes, the whole craft is refused and
  nothing is used up.
* **Value.** A made thing is worth what went into it. Key items count as worth nothing here.
* **Time.** With Story Director, a craft moves the story clock on by the recipe's time.

The **Crafting** screen shows each character's craft skills and recipes: the materials you have and
still need, the station, the difficulty and the chances. It has no buttons; you craft in the story.
Turn crafting off with **Crafting** in the Features.

## Economy and currency

There is one currency per chat. Its name is only a name: gold unless you rename it in Story Block's
settings (pennies, crowns, marks, Gil…), or the name a pack suggests. Renaming it changes no amounts.
Whatever coin words the model writes, only the number counts.

How much things cost and how much the story may pay come from the **pack**, not from the model:

* **Rewards.** The pack's quest rank ladder sets how much a quest of each rank pays. The top reward of
  your character's rank is also the most the story may hand out in one reply: coins it writes (a purse
  found, a tip) and the rewards of quests it made up, together. Without a pack ladder, Story Director's
  own F-to-S ladder is used, or 1000 per level.
* **Quests the story made up** pay at your character's rank or lower, never higher, whatever rank the
  story wrote for them. When one reply's turn-ins would pay more than one reply may give, the first is
  paid and the rest stay Ready for the next reply. A pack's own quests pay the reward the pack sets,
  outside this limit.
* **Prices.** Each item in the pack has a value. Shops sell and buy by it.
* **Money scale.** A pack can say how big its coin is next to the built-in amounts. Ersveil's marks are
  small coin, so its scale is 8. The scale only changes the built-in numbers (the default rank ladder,
  1000 per level), never the numbers the pack writes itself.
* **Your own numbers.** In Story Block's settings, **Money one reply may give** replaces the budget
  from the ranks, and **Money scale** replaces the pack's scale (0.01 for a world that counts in
  copper). Leave both at 0 to follow the pack.
* **Lorebooks** only give flavour to the model (what a mark looks like, who mints it). They never set
  prices or rewards. Keep the lorebook's money words close to the pack's so the story sounds right.

Ersveil, for example, pays 50 to 400 marks for an F-rank job, so one reply may give at most 400 marks
while your character is in that rank. A minor healing draught there is worth 30 marks.

**Key items.** Now and then the story hands you something special, worth more than one reply may
normally give: the potion an old man presses into your hand, a sealed letter, a family blade. One reply
can give one such thing, and only one of it. It is a **key item**, tagged **Key** in the Inventory:

* it is always one item, in its own stack, never merged with others of the same name;
* you can use it, equip it or give it to a companion as usual;
* it can't be sold, and in crafting it counts as worth nothing.

If you delete a reply in the middle of the chat, the coin and items it gained or spent are taken back,
and the later replies' own gains and spending stay.

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
  quests (each with Story Director's own status line: *Ready to turn in*, *Not yet: 2/3 wolves*,
  *Offered — say you take it*), and your save points. Each part shows only when the extension behind it
  is installed. On a phone, the status strip scrolls sideways when it holds more than fits; the edge
  with more to see fades.
* **Inspector** (for testers and pack authors; off until you turn on **Features** → *State inspector*):
  a read-only screen and tab. Pick a reply to see its story state as a tree you can fold open and
  search, what changed since the reply before (path by path, and the stored ops), its receipts and its
  problems. It changes nothing.
* **Windows** (dialogs) for things like making your character.

Everything follows your SillyTavern theme's colours. Cards, meters and screens move a little when they
open or change; if your system asks for reduced motion, they don't move at all.

The **Inventory** has a **Filter…** box: type part of a name to see only matching things, together with
the kind, rarity and *Equipped only* filters next to it. It is the one place for the party's things: an
**Equipped** section lists what each character wears, with **Take off** (the piece stays in their pack).
**Equip on…** under a piece lists only the members who can wear it; picking one hands it over and puts it
on in one step, and whatever was in that slot goes back into their pack (for rings and other accessories,
the oldest one once all are worn: 2 by default, up to 3 by RPG Battle's rules). **Give…** hands a thing to
someone else in the party, or back to the party's bag. With RPG Battle, each row also shows what only it
knows: the slot and stats, who wears the piece, its condition and refinement, and for a potion what it
does and whom it would help now. There is no separate Items screen any more.

RPG Battle's **Party** screen has a card per member: their stats, what they wear (with condition and
refinement), their active effects, how much they carry, and when they are encumbered. A companion's
card has two switches: **In fights** (*On their own* or *You lead*) and **Stat points** (*By build* or
*By hand*). Your own card has **Save character file**, which saves your character to a file you can
import into another chat. The status strip shows when someone has points to spend, and the effects
under way.

## Packs

A **pack** is a ready-made setting in one file: items with their prices and effects, creatures, shops,
recipes, quests, events, races and talents, a starting place and purse, a currency name, and its own
look for the screens. Packs are data only; nothing in them can run code.

* **Install from a file:** Story Suite settings → **Packs** (the second fold, right under Story Suite)
  → **Import pack file**. With no pack installed, the game view's **Home** has an **Import a pack**
  button that opens the settings right there.
* **From a character card:** some cards carry a pack in their lorebook. Story Suite asks first: click
  **Read from character lorebook** in the Packs section.

You can switch a pack off or remove it at any time. A story already told keeps what it got from the
pack.

**Trying Ersveil.** Story Block comes with the Ersveil starter pack
(`examples/packs/ersveil-bluewatch/pack.json` in Story Block's folder). Import it with **Import pack
file** in the Packs section, like any pack. Switch off other packs that set a start or a currency.
[ERSVEIL.md](ERSVEIL.md) walks through the rest: the lorebooks, the persona, the first message and the
ready-made character.

## Settings

Open the settings with **Settings** on the Story Suite bar above the message box, **Story Suite** in the
wand menu, or **Extensions → Story Block → Settings**. They open over the whole window in one column that
scrolls; **Close** or Esc closes them. Each part is a fold you open and close: **Story Suite**, **Packs**,
**Features**, one fold per extension with settings, **Versions**. Inside an extension's fold, one line
says how many of its features are on (*Features: 3 of 4 on — change*, which takes you to them), then one
smaller fold per group of settings (Story Director's **Calendar**, for one), and **General** for the
rest. Folds stay as you left them while the page is open. A list (the months of a calendar) shows one
line per entry, `[January] [31] ×`: × removes that line, **Add** adds one.

A list of names and numbers can also be typed as text: **Edit as text** turns it into a box with one
entry per line, the parts split by a colon. Story Director's **Months** opens that way, so a calendar
of 13 months (or 10, or 5) is just typed:

```
Frostmoon: 30
Thawing: 28
Day of Ash: 1
```

It's read when you leave the box. A line that can't be used (a month with 0, negative or no days, a
missing colon) is named under the box, *Line 3 ("Day of Ash: 0"): Days must be at least 1.*, and nothing
changes until every line reads. **Edit as rows** goes back to one line per entry.

* **Prompt size** (in the **Story Suite** fold): what Story Suite adds to the prompt of the next reply in
  the open chat, counted now and never sent. The instructions (the same every reply, so the prompt cache
  keeps them), this reply's part against **Notes per reply** (the budget above it), the total, and each
  extension's share. It uses SillyTavern's tokenizer when there is one ("312 tokens"), else an estimate
  at four characters a token ("about 312 tokens"). It counts again when you switch a feature or change
  the budget. After a reply it also shows your **context size** and **Story Suite's share** of it.

* **Share of the context** (Story Suite's own section, 40 % by default): the most of your context size
  (less the reply's length) that Story Suite's instructions and notes take together. SillyTavern fits
  extension prompts before the conversation, so a small context could otherwise leave no room for the chat
  itself. The notes for each reply are cut to fit; the instructions are never cut. If the instructions
  alone are too big for the share, you are told once per chat ("Your context size (4,095 tokens) is too
  small for Story Suite's instructions …"): raise the context size in SillyTavern's API settings (8K or more
  with all four extensions), or turn features off.

* **Currency**: the name of the money in your chats, one coin ("mark"), its plural ("marks"; blank: the
  name with an s) and its short form.
* **Money one reply may give**: the most the story's `+ coin` lines of one reply can pay (0: worked out
  from your installed extensions: the top quest reward for your character's rank, or 1000 per level, or
  1000 when neither is installed, the last two times the money scale; see
  [Economy and currency](#economy-and-currency)). The rest is not paid, and **Problems** says so.
  A reply also gives at most 20 of one item, and goods worth at most twice that money, plus one notable
  item (the potion an old man hands you) worth up to five times the goods. That one is a **key item**
  (tagged "Key" in the Inventory): yours to use, equip or give away, but it can't be sold.
* **Change lines per reply** (Story Suite's own section, with **Notes per reply**): the most change lines
  one reply may hold, 150 by default; any after them are not used.
* **Screens**: turn each card on or off, and pick which version of a screen to use (the default, the
  card's, or a pack's). **Reset to default** always brings back the standard one.
* **Packs** (second, right after Story Suite, even with no pack installed): import a pack file or read
  one from the character's lorebook, switch one off, remove one.
* **Features**: every optional part of every extension, each with an on/off switch and a line saying
  what it does (see below).
* Each module has its own section (combat, the story clock and calendar, NPCs).
* **Problems**: lines the model wrote that couldn't be used, and why. Useful when something you expected
  didn't happen.
* **Versions** (last): every Story Suite extension installed, its version and the Story Block it says
  it needs. One that is out of step (it needs a newer Story Block, was made for a newer one, clashes
  with another, or is installed twice) says so with one sentence on how to fix it.

### Features

Each extension's optional mechanics (wear and breakage, weather, a loot picker…) can be switched on or
off in the **Features** fold of the Story Suite settings: one smaller fold per extension, A to Z, its
title saying how many are on ("3 of 4 on"), and a **Find a feature** box at the top that keeps only the
features whose name or description has what you type, across every extension. An extension's own fold
links to its features with one line. Story Block's own are the **Status strip**, the **Cards
under replies**, **Save points** (on), the **State inspector** (off), and two helpers that each make one
small extra model call, off until you turn them on: *Roll checks before the reply* and *Read changes
from replies that forgot them*. A feature that needs another extension (the pre-roll needs one that
keeps checks, like RPG Battle) shows greyed out, with the reason, until that extension is installed.

* A feature that's off is gone from the story: the model isn't told about it, its lines are not used
  (Problems lists them quietly), its buttons, screens and tabs are hidden.
* Nothing is lost: what the story already holds for it is kept, and turning it on again brings it all
  back where it was.
* Your choices are yours, not the chat's: they hold in every chat until you change them.
* A feature marked *Changes the fixed prompt once (one slower reply)* changes the part of the prompt
  the model's provider keeps cached, so the next reply after the switch may take a little longer and
  cost a little more; the replies after it are fast again.

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

## Raise SillyTavern's chat backup interval to at least 5 minutes

We recommend a chat backup interval of **at least 5 minutes**. Every backup is a full copy of the
chat file, and long Story Suite chats are large, so short intervals mean many large copies.

SillyTavern rewrites the whole chat file on every save, and also writes a full **backup copy** of it,
at most once per *backup interval*. The default interval is 10 seconds, shorter than a reply, so in
practice every reply costs one or two extra full copies of the file on top of the saves. On a weak
server (a Raspberry Pi, a cheap VPS, an SD card or a network disk) that is what makes long chats slow.

What Story Suite's benchmark measured (docs/v2/PERFORMANCE.md, a 3,000-reply chat): the chat file is
about **15 MB** (v1 with a 3 KB state block: 24 MB), and a reply writes about **49 MB** in full-file
saves plus one backup copy (v1: 48 MB). The backup copy alone is one more full file per reply, **15 MB**
at that length, so on a slow disk it is one of the largest costs left.

Raise the interval to **5 minutes or more** in SillyTavern's `config.yaml` (in SillyTavern's folder) and restart
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
the chat, about 15 MB for a 3,000-reply chat. These are the key names of SillyTavern 1.19's
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
