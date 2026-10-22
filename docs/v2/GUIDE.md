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

## What's new in beta.1

The first beta. In short, what changed for you (the full list is in
[RELEASES.md](RELEASES.md)):

* **Update Story Block first**, then the other three. A module newer than your Story Block says so in red
  and waits.
* **Switch mechanics on and off** in **Features**: one switch per mechanic, with a line on what it does.
  A switched-off mechanic is gone from the story, and nothing it made is lost.
* **Quests start when you take them on.** No more offers to accept: say you take the job, and the story
  writes it down as a quest that is under way at once. See [Quests](#quests).
* **Your world's words.** Name the XP word, the Level word and the rank ladder (Soul Class I to IX, F to
  SSS…) in RPG Battle's **Terms**, and your coins (copper, silver, gold) in Story Block's **Coins**. Every
  screen and note uses them. See [Ranks, foes and companions](#ranks-foes-and-companions) and
  [Economy and currency](#economy-and-currency).
* **Fights**: every foe the story writes is fought, in waves when there are many; quest fights bring
  enough foes for real progress; the fight card names the foes' rank and how dangerous the fight is. A
  fight line the model writes in the story itself, outside the `<Changes>` block, now starts the fight too.
* **Arc planning is back** (Story Director): **Plan arc** asks a planner model for the story's next arc,
  and you review it before it is used. People's plans, planned beats, clocks and secrets stay hidden on the
  Director tab until you press **Reveal**. See [Arc planning](#arc-planning-and-what-stays-behind-the-scenes).
* **Back from v1**: HP and MP come back with story time; the story can award experience (`+ xp major`);
  **Choices** (next moves as buttons that fill your message box) and **Inner chatter** (the people's
  unspoken thoughts, next to each person on the World screen), both off until you turn them on; the
  **weather** in a few words on Scene, Home and the reply's Status card (on).
* **Things and money**: gear wears and can be repaired and refined; crafting; one bag for the whole
  party with **Equip on…**; items like a backpack add carry capacity; prices depend on the place (a
  port, a mining town); a key item the story gives can't be sold.
* **Making your character** is easier to find: *Before you start* on Home and **Create your character**
  on the Party screen. Race and talent cards are buttons you can click again to take back.
* **Settings** are easier to find your way in: folds that keep their size, groups, lists you can type as
  text, a **Find a feature** box, the assist's connection as a dropdown, and **Diagnostics** with a report
  to paste into a bug report (no keys, no chat text).
* **Small contexts keep the conversation**: Story Suite takes at most 40 % of the context for itself. 8K
  tokens of context or more is recommended.
* **Saving is safer**: a late save never undoes a newer one, and closing the page saves what you have
  (or asks first when it can't).
* **NPC State Delta**: the Cast is in the game view too, and its settings are no longer three folds deep.
* **Your order of tabs**: move, hide and show the Story panel's tabs and the game view's screens in
  **Settings → Story Suite → Tabs** (one list for both). See [Your order of tabs](#your-order-of-tabs).
* **Text boxes follow your theme**: search boxes, text and number fields, lists and sliders in Story
  Suite's screens and settings take SillyTavern's theme colours, dark or light, instead of bright white.

What is still not right: see "Known issues" under 2.0.0-beta.1 in [RELEASES.md](RELEASES.md).

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

**Things that carry for you.** Some things add carry capacity while you have them: a pack mule (+80), a
share of a barge's hold (+200), a spatial ring while it is worn (+100). The pack says which (its items'
`carry`), or you do, in RPG Battle's settings (**Items that add carry capacity**, one per line:
`Spatial Ring: 100`). That list goes by name, so it counts for a thing the story gave you too: list
`Saddlebags: 60` and the story's Saddlebags add 60. The Inventory and the Party screen show "+80 carry".
What the story writes never adds capacity: a "bag of holding" the story invents is a plain bag unless you
list it. When you lose such a thing, your capacity
drops back; if you then carry too much you are encumbered, and nothing is dropped.

**Choices and thoughts.** With the features on (see [Choices and Inner chatter](#choices-and-inner-chatter)),
the block may also hold `? choice Climb the wall` (a next move you might make) and `~ chatter Minke: …he'd
better not die down there` (a thought nobody hears). They are for you alone and change nothing.

**Weather.** When the weather changes the story writes `~ weather cold drizzle, low fog` (a few words, at
most 60 characters). Story Block keeps the latest with the scene and shows it on **Scene**, Home's scene
panel and Story Director's Status card under the reply; the story is reminded of it with the place. It is
only a description: nothing in the rules reads it. A swipe, Re-read, a delete and a reload keep what the
remaining replies wrote. Turn it off in **Features → Story Block → Weather** (the fixed instructions then
lose its line: one slower reply).

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

Every foe the story writes is fought. At most 4 foes per party member stand on the field at once, 9 in
all (RPG Battle's settings *Fights: foes on the field per party member* and *… at most*); the rest come
in waves, each when the one before is down, and a boss takes the first place of its wave. A fight against
the foes a quest of yours is about brings enough of them for real progress (a third of the goal or more,
never more than is still missing), and the quest's item drops from each of them. A number the story
writes ("three cellar rats") is kept as written.

Between fights, HP and MP come back as story time passes (with Story Director's clock): a little every
story hour, and 6 hours or more at once is a full rest. The story can also award experience in words,
`+ xp minor`, `+ xp major` or `+ xp milestone` with the reason; code sets the amount from your level, at
most one big award and two small ones a reply. Turn recovery off with **Features** → *HP and MP come
back with story time*.

### Ranks, foes and companions

Your character has a **rank** from their level: F to S by default, or the pack's own ladder (Ersveil's
runs from F Registered to S Legend). Quests and the money a reply may give follow it.

**Your world's words.** One game says XP and Level, another Soul Growth and Soul Class; one ranks F to
SSS, another Soul Class I to IX. Set them in RPG Battle's settings, under **Terms**: the **XP word**, the
**Level word**, the **Rank ladder** (one rank a line from lowest to highest) and **Levels per rank** (10:
Soul Class I is levels 1–10, II is 11–20). A line may give its own first level instead, `Soul Class II: 15`,
which wins over Levels per rank. Under them a preview shows each rank with its levels
("Soul Class I: Lv 1–10 · II: 11–20 · …"). Empty means the pack's words, then the built-in ones. Every
screen, fight summary, note to the model and quest line uses them: the ladder is the one quest ranks, foe
ranks, your character's rank and a fight's tier all read, so a fight card says "Weir Rat ×8 · Soul Class I
· weak". A ladder is levels in bands, so it needs RPG Battle: without it Story Director keeps its quest
ranks from the pack, else F to S. (A ladder typed in Story Block's Terms before moves to RPG Battle's
by itself.)

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

Quests follow the story. Take a job on in your own words ("I'll do it"): the story writes it down as a
quest, and it is under way at once. There are no offers to accept and no Offered list; a job someone
only mentions stays in the story until you take it on. The **Quests** screen shows each quest with its
progress (wolves beaten, pelts carried) and a line that says where it stands: Not yet, Ready, or Ready
to turn in here. When the goal is met, go back to a town or the person who gave the
job and turn it in in the story: code checks the goal and the place in the same reply, pays the reward
once and hands over any items the job asked for, or the story is told why not yet. There are no quest
buttons. One fight counts for one hunting quest; items you carry can count for an item quest at the
same time.

Every quest has a clear goal. When code can't count it (find the missing girl, win the mayor's
trust), the story says when it is met, and the quest shows Ready. **Details** on a quest shows its
goal, progress, reward, who gave it, when it is due and what has happened so far. A finished quest
stays in the list under Finished. New jobs come at a calm pace; a passer-by stays a passer-by.

### The World screen and your journal

The **World** tab (also in the full-screen view) shows only what your character knows, in two views.
**Now**: where you are (the place, its kind and region, marked when the last reply moved you there; the
story time is at the top) and who is here. With NPC State Delta on, the people here are its own cards, the
ones its Cast tab used to show (portrait, mood, condition and outfit, meters); tap one to open the dossier.
Someone the scene lists but Delta has no dossier for yet is a name below the cards. Without NPC State Delta,
each person is a name. With **Inner chatter** on, each person's unspoken thought from the latest reply sits
in their card or under their name (nothing is drawn under the reply). It all follows the story as it
goes: a new reply, a swipe, a delete, or NPC State Delta finishing a scan, with no need to switch tabs.
Then the news, events and factions you have learned of, newest
first, and what you know is coming in the next 30 story days: your quests' due dates, dated events and
leads the story told you, and your pack's holidays. **Journal**: one entry per story day, newest first:
where you went, who you met, the news, quests taken on and finished, fights, money, and which people's
feelings reached a new stage, with a search box; the day under way shows as *today so far*.

What is behind the scenes (agendas, planned beats, clocks, secrets, the arc the planner made) never
shows on the World screen, revealed or not: that stays on the **Director** tab, behind **Reveal**.

When a story day ends, Story Director writes its journal entry from what code recorded; the model
writes none of it. After a time skip, the next reply gets one line about the last day, so the story
remembers it. Story Director's settings choose how many days are kept, how far ahead Upcoming looks,
and can turn that reminder off. Turn the journal off with **Day digest** in the Features, and the World
screen with **World view**.

With **Accept planned arcs automatically** on (Story Director → Arc planning, off by default), a planned
arc is used without review; the Director tab says quietly that an arc began, without naming it while
behind the scenes is hidden.

### Arc planning and what stays behind the scenes

Story Director can plan the story's next arc for you, as v1 did. On the **Director** tab's Arc panel,
**Plan arc** asks a planner model (on its own connection profile, Story Director's setting *Arc planning:
Planner connection*, or the chat's) for a few planned beats, people with their own plans, leads, clocks
and secrets. Nothing goes into the chat while it plans. The plan waits for you: read it, change its text if
you like, then **Accept**, **Plan again** or **Discard**. Accepted, it becomes the Director's own list of
what is coming, and the story is steered by it. **End arc** closes it. With *When to plan: By itself*, a
new plan is asked for when there is none, when the last one played out, or when the story stalls.

Code reads the plan strictly: only its labelled lines, a handful of each kind, no rewards, XP, ranks or
amounts, and dates worked out on your calendar. Swiping or deleting the reply you accepted it on takes it
back. Without RPG Battle the planner is asked for no fights. Arc planning needs Story Block 2.0.0-beta.1 or
newer; turn it off with **Features** → *Arc planning*.

So the plan doesn't spoil the story, the Director tab keeps people's plans, planned beats, clocks and
secrets **behind the scenes**: you see how many there are, and **Reveal** shows them (**Hide** hides them
again). The choice is per chat and remembered in this browser, and the card under each reply then names
none of them as *Next*. The story is told all of it either way. Story Director's setting *Behind the
scenes* turns the hiding off.

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

**Prices by place.** A place's prices come from what kind of settlement it is and where it lies, never from
what the story says they are:

* **Settlement type**: a hamlet or village is a little cheaper with little on the shelves, a city or
  capital dearer with more; an outpost or camp is dear with little. A town is the usual price.
* **Environment**: tags such as coastal, river, port, mountain, mining, forest, desert, farmland,
  frontier and swamp move the price of some things: fish is cheaper on the coast or a river, ore and metal
  in a mining or mountain town, grain on farmland; everything is dearer on the frontier or in a desert.
  Together they move one kind of thing by at most 30 %.
* **Where that comes from**: the place's line in the character's lorebook (`market: town; coastal, port`
  in the entry about the place), else the pack's map (its `market` and `tags`), else the scene's place kind
  ("village", "city"). Unknown: everything at the usual price. A pack can change the factors or add its
  own types and tags (PACKS.md "markets").

The Trade screen says why: *Town · coastal: fish −30 %*. Built-in prices follow the money scale; a pack's own
prices stay as written. Your own word for a place (cheap, fair, dear) still goes on top. **Guess prices
from place names** (off) brings back v1's guess from words in a place's name ("Harbour", "Royal").

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

**Coins.** Many worlds count money in coins of different worth: copper, silver and gold. Name them in
Story Block's settings, **Coins**, one a line, smallest first, with what each is worth in the smallest:
`copper: 1`, `silver: 10`, `gold: 100` (a plural after a slash: `penny/pennies: 1`). Empty: the pack's coins
(when you use the pack's currency), else the one name. Your wallet counts the smallest coin. The model is
told the coins in one line, and a money line may name one coin: `+ coin 3 silver` pays 30 copper, before
the limit on what one reply may give. A coin you didn't name, or two coins in one line
(`+ coin 3 silver 5 copper`), is not paid, and **Problems** says why. Amounts show in mixed coins
("3 silver 5 copper"), or in the smallest coin with **Coin display**.

*Why does the story say copper and silver when my currency is pennies?* The lorebook, the character card or
the pack's lore names those coins, and the model follows them. With only a currency name, Story Suite
knew nothing of them. Name the same coins under **Coins** (or keep the lore's words close to your
currency), and the story's coins and your wallet agree.

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
* **Money scale.** A pack can say how big its coin is next to the built-in amounts. Ersveil counts in
  copper, small coin, so its scale is 8. The scale only changes the built-in numbers (the default rank ladder,
  1000 per level), never the numbers the pack writes itself.
* **Your own numbers.** In Story Block's settings, **Money one reply may give** replaces the budget
  from the ranks, and **Money scale** replaces the pack's scale (100 for a world that counts in
  copper). Leave both at 0 to follow the pack.
* **Lorebooks** only give flavour to the model (what a coin looks like, who mints it). They never set
  prices or rewards. Keep the lorebook's money words close to the pack's coins so the story sounds right.

Ersveil, for example, pays 50 to 400 copper (5 silver to 4 gold) for an F-rank job, so one reply may give
at most 4 gold while your character is in that rank. A minor healing draught there is worth 3 silver.

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
  Quests…). On a phone the row of tabs scrolls sideways, and the tab you pick is scrolled into view.
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
  quests (each with Story Director's own status line: *Ready to turn in*, *Not yet: 2/3 wolves*), and
  your save points. Each part shows only when the extension behind it
  is installed. On a phone, the status strip scrolls sideways when it holds more than fits; the edge
  with more to see fades.
* **Inspector** (for testers and pack authors; off until you turn on **Features** → *State inspector*):
  a read-only screen and tab. Pick a reply to see its story state as a tree you can fold open and
  search, what changed since the reply before (path by path, and the stored ops), its receipts and its
  problems. It changes nothing.
* **Windows** (dialogs) for things like making your character.

### Your order of tabs

The tabs and the game view's screens come in one order: **Home** (game view), **Party**, **Inventory**,
**Quests**, **World**, **Map**, **Fight**, **Crafting**, **Trade**, **Scene**, **Chronicle**
(when it is on), then any other extension's screens, **Director** (the game master's view, with
what your character has not been told), and NPC State Delta's **Dossiers** last (the people present are on
the World screen). An order you saved before keeps Dossiers where you put Cast. With Story Director
installed, **Scene** starts hidden: World → Now shows the same place, time and people. Without it, Scene
shows the place, the weather and the people here, each with their Inner chatter thought. It is still listed in
Settings → Story Suite → Tabs to show again (and an order you saved before with Scene in it keeps it). Only the installed extensions' tabs show.

Change it in **Settings → Story Suite → Tabs**: every tab and screen of every installed extension, one row
each, with where it shows (*Story panel and game view*, or one of them). **Up** and **Down** move one
place (they are buttons, so Tab and Enter work too); untick **Shown** to hide one from both the panel's
tabs and the game view's menu. A hidden one stays in that list, so you can show it again there, and a
screen that opens by itself (a fight starting) still opens. **Home** is always first and always shown.
**Reset to default** puts back the order above with everything shown. The order is yours, in every
chat; an extension you install later puts its tabs at the end, and one you remove keeps its place for
when it comes back.

### Choices and Inner chatter

Two extras from Story Block v1, each off until you turn it on in **Features**:

* **Choices**: the story ends its reply with 2 to 4 short next moves, shown as buttons under the latest
  reply. A click puts the words in your message box (after anything you already typed) and does nothing
  else: you still send it, change it or write something of your own. Nothing happens in the story until
  you send. Once you answer, the buttons go; an older reply shows none.
* **Inner chatter**: short unspoken thoughts of the people in the scene (at most 3 a reply), shown next
  to each person: on Story Director's **World → Now**, or, without Story Director, on Story Block's
  **Scene** under each person here (the name, then the thought). Nothing is drawn under the reply, and
  they are not part of the story text. The story never hears
  them: they are left out of later prompts, unless you turn on **Settings → Story Block → Inner chatter →
  Send the last reply's thoughts back to the story** (then the thoughts of the reply you answered go with
  your next message as one short note).

Both are read from the reply itself, so a swipe shows that swipe's, Re-read and a reload show the same,
and they never change your things, money or the scene. A reply with more than the limit keeps the first
ones and lists the rest on its card as not used. Each feature adds one line to the fixed instructions
(one slower reply when you switch it).

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
scrolls; **Close** or Esc closes them. Each part is a fold you open and close: **Story Suite** (the
prompt size, **Show what's sent**, and **Tabs**: [your order of tabs](#your-order-of-tabs)), **Packs**,
**Features**, one fold per extension with settings, **Diagnostics**, **Versions**. Inside an extension's
fold, one line says how many of its features are on (*Features: 3 of 4 on — change*, which takes you to
them), then the extension's own panel if it has one (NPC State Delta's whole settings, with its own
groups; Story Block's **Assist**), then one smaller fold per group of settings (Story Director's
**Calendar**, for one), and **General** for the rest. Nothing is more than two folds deep. Folds stay as you left them while the page is open. A list (the months of a calendar) shows one
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
  What an extension sends on its own goes in a row of its own and in the total: NPC State Delta's
  dossiers (*NPC State Delta, sent by itself*, often 2,000–4,000 tokens).

* **Show what's sent** (under the prompt size): the exact text of the next reply's Story Suite part, as
  it would go out now: the instructions, this reply's part and what an extension sends on its own, each
  part with its extension and size, and lines left out to fit the budget counted. **Copy** copies all of
  it (each part headed in square brackets). It only reads: opening it sends nothing and changes nothing.

* **Share of the context** (Story Suite's own section, 40 % by default): the most of your context size
  (less the reply's length) that Story Suite's instructions and notes take together. SillyTavern fits
  extension prompts before the conversation, so a small context could otherwise leave no room for the chat
  itself. What an extension sends on its own (NPC State Delta's dossiers) counts toward it too. The notes
  for each reply are cut to fit; the instructions are never cut. If the instructions
  alone are too big for the share, you are told once per chat ("Your context size (4,095 tokens) is too
  small for Story Suite's instructions …"): raise the context size in SillyTavern's API settings (8K or more
  with all four extensions), or turn features off.

* **Currency**: the name of the money in your chats, one coin ("mark"), its plural ("marks"; blank: the
  name with an s) and its short form. **Coins** (smallest first, `silver: 10`) and **Coin display**
  (mixed coins or the smallest only); see [Economy and currency](#economy-and-currency).
* **Money one reply may give**: the most the story's `+ coin` lines of one reply can pay (0: worked out
  from your installed extensions: the top quest reward for your character's rank, or 1000 per level, or
  1000 when neither is installed, the last two times the money scale; see
  [Economy and currency](#economy-and-currency)). The rest is not paid, and **Problems** says so.
  A reply also gives at most 20 of one item, and goods worth at most twice that money, plus one notable
  item (the potion an old man hands you) worth up to five times the goods. That one is a **key item**
  (tagged "Key" in the Inventory): yours to use, equip or give away, but it can't be sold.
* **Terms** (RPG Battle's fold): the **XP word**, the **Level word**, the **Rank ladder** and **Levels per
  rank**, with a preview of the ranks' levels; see [Ranks, foes and companions](#ranks-foes-and-companions). A changed word
  changes the instructions the model gets once; otherwise they stay the same reply after reply.
* **Change lines per reply** (Story Suite's own section, with **Notes per reply**): the most change lines
  one reply may hold, 150 by default; any after them are not used.
* **Screens**: turn each card on or off, and pick which version of a screen to use (the default, the
  card's, or a pack's). **Reset to default** always brings back the standard one.
* **Packs** (second, right after Story Suite, even with no pack installed): import a pack file or read
  one from the character's lorebook, switch one off, remove one.
* **Features**: every optional part of every extension, each with an on/off switch and a line saying
  what it does (see below).
* Each module has its own section (combat, the story clock and calendar, NPCs).
* **Assist** (in Story Block's fold): **Connection profile for these calls**, the profile the two helpers'
  extra calls use (a cheaper model, say): *Same as chat*, or one of SillyTavern's Connection Manager
  profiles. With no profile yet it says so: make one in SillyTavern's Connection Manager
  (the plug icon, **Connection Profile**) and it is listed. A picked profile you delete later stays shown as
  missing and the helpers' calls fail until you pick another; they never use a different one quietly.
  NPC State Delta's **Scanner connection profile** works the same way for its scans.
* **Problems**: lines the model wrote that couldn't be used, and why. Useful when something you expected
  didn't happen.
* **Diagnostics** (just before Versions): a plain report for a bug report, shown before you share it, with
  **Copy report** and **Save report** (a .txt file). It lists the versions of SillyTavern and every Story
  Suite extension, the features that are on, each extension's settings, the prompt size and context size,
  the last 20 Problems, how saving is going, how many replies and records the chat holds and its size,
  recent Story Suite errors, and each extension's own lines (NPC State Delta: its scanner's profile and how
  its last call went). It never holds API keys, passwords, addresses or any of the chat's text: settings
  that name a key, token, password or address are left out, and quoted text keeps only its length.
  Below the report, folded until you open it, is **Events**: every event your packs define, its condition,
  whether it has happened, is due or waits, and what the last reply fired. It is for checking packs and
  shows what is coming, so it can spoil the story.
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

**Diagnostics**
(Settings → Diagnostics → **Copy report**, and paste it here. It has no keys and no chat text.)

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
