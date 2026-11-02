# Story Suite player guide

Story Block keeps your inventory, money and scene. Story Director adds checks, story-told quests, a calendar, map, World, Chronicle and arc planning. NPC State Delta adds dossiers for people in the story. Install Story Block first, then the optional modules, and reload SillyTavern.

## Starting a world

In **Settings → Tabs & Packs**, import a pack file. Start a fresh chat for its starting place and inventory. The [Ersveil open-world example](ERSVEIL.md) includes places, routes, a calendar, weather, events and data modules. [Pack authoring](PACKS.md) describes the format.

## Playing

The narrator writes a hidden `<Changes>` block. Each module checks its lines and records accepted changes alongside the reply. Swipe or delete a reply that is not the oldest remaining one to take back its changes; deleting the oldest remaining replies carries their state forward. After editing a reply, press **Re-read**. **Problems** explains refused lines.

On Home and in Inventory, tap the pencil beside a value, change it, then choose **Save** or **Cancel**.
Each inventory item's pencil opens its name, count and note together. Inventory also has **Add item**
and its existing Drop action. For things kept as separate pieces, count changes the total of that
kind for its owner; name and note change the selected piece. The purse accepts a whole amount or mixed
coins such as `3 silver 5 copper`. Place, weather and the people present can be edited on Scene, and
in the header above every screen of the game view, whose one **Edit** button (top right; beside your name on a phone) opens one editor with the story's date and time (when Story Director is on and gives a calendar), the place, the weather (while the weather feature is on) and who is here as a comma-separated list, and, under "Character", what you are wearing, your condition and (in a game whose pack gives you one such as Ersveil's "Guild rank") your rank (**Your look**, on under **Settings → Features**). **Save** changes only what you changed, from the latest reply on; **Cancel** or Escape leaves everything as it was. A date Story Director refuses (such as "Goldwane has 30 days.") is named under the fields and nothing else is saved until you fix it; the story clock may be set earlier than it was. The story sets your look when it changes (`~ you rank: … | wearing: … | condition: …`), you can set or clear them yourself, and Story Director's Status card under each reply shows them (Story Director 2.4.0). In **Settings → Tabs & Packs**, a pinned
data module lists its editable fields under **Fields**, including a set for each attached character.
Data-module layouts may also show pencils. Edits ride on the latest reply: swipe or delete that reply
to take them back when it is not the oldest remaining reply. Deleting the oldest remaining reply carries
its edits forward with the rest of its state.

The narrator also keeps the party's **mounts** (horses, mules, carts: up to six rows, a group such as "Guild remounts ×4" is one
row). While there is one, Home shows a **Mounts** card with each row's kind, condition and where it is, its pace in km a day,
and how fast the party travels: the slowest mount's pace, or 20 km a day on foot when there are fewer mounts than riders (with the
RPG on, every party member who has not left counts as a rider). The pencil beside a mount edits its name, kind, how many,
pace, condition and where; like other pencils it rides on the latest reply. Switch it off in **Settings → Features → Mounts**:
the narrator is then not told about mounts and the card is hidden. With Story Director 2.5's **Trips**, the header above
every screen of the game view also gets a **Travel** line (the mode, the pace and the mount that sets it, the leg and the
arrival) under Wearing and Condition while a trip is on.

**Settings → Look** sets the panel style, glass strength, font and **Text size** (Normal, 110% or 120%): the larger sizes make the Game view, the cards under replies, the dialogs and the settings window bigger at once; SillyTavern's own chat text keeps its size (use its Font scale for that). Use **Settings → Features** to enable optional features. Assist's safety net can recover missed changes. Its pre-roll helper works with a module that supplies checks, such as Story Director.

## Making a block

Open **Settings → Blocks** (the Game view has no Blocks tab; blocks belong to the story that is open, so the page
needs a chat). Choose **New block** for an empty one, or **From a template** for a saved template. Name it,
add text, number, choice or list fields, and say what it is for. Choose **Show as**: its own tab, a card on Home,
both, or Hidden. A hidden block has no tab and no card but still works for the story: the narrator can update its
fields, and its rules and buttons run.
You can add buttons and rules; a timer needs Story Director's clock and can add to a number field.
Each field and each button uses one of the 16 available slots; rules and timers do not use these
slots. Save with the latest reply, then use the pencils and buttons on the block. The narrator can
update its fields with the story lines shown in Setup.

Each block has a row on the page with its name, a line of what it holds and where it shows, a **Show as** choice
you can change at once, **Edit** (the editor above, with the tab name and icon) and a **⋯** menu to save its
definition as a template, export a pack, or remove it (it asks first). A block shown as its own tab keeps that
tab in the Game view, and a Home card stays on Home; both have the same menu, and their **Edit fields** opens
the editor in Settings → Blocks. The RPG's blocks are listed too, marked **RPG** and shown by the Party and Fight
tabs while the RPG is on, so their Show as is locked.
Templates are shared across your chats, without the current values; manage them under **Settings →
Tabs & Packs → Block templates**. Swipe or delete the reply that created, changed or removed a block
to take that action back. A chat can have up to eight blocks, and blocks and pack modules share the
16-pin budget, including retained pins. Definitions and their generated story kinds must fit the
data-module limits.

An exported block keeps its tab, Home card and buttons when its pack is imported and enabled. Edit
fields, Save as template and Remove are available on blocks made in the current chat. Chats made before
this page keep their blocks and where they showed.

The story decides how much money and how many items a reply gives; there is no per-reply cap. In **Settings → Money** you set the names and values of coins and the money words; the money scale is in the folded **Advanced** row.

## RPG

The optional RPG adds a party sheet, automatic dice for fights and checks, and Soul Class and skill ranks that rise as the story goes on. Switch it on under **Settings → Features**, then make Character, Skills, Foes and Combat rules blocks from the **RPG** templates. The [RPG guide](RPG.md) covers the Party tab, the stage bars, rolls, death and undo, and how to change the templates.

## Removing Story Block from a chat

Story Block keeps change lists inside hidden reply comments and removes them from prompts while it runs. To continue a chat with Story Block switched off, add a SillyTavern regex script under **Extensions → Regex → New global script**:

Find Regex:

```
/<!--\s*STORY_SUITE_V2\b[\s\S]*?-->/g
```

Leave **Replace With** empty, select **AI Output**, and under Ephemerality select only **Alter Outgoing Prompt**. The replies retain their lists in case Story Block is reinstalled.
