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
coins such as `3 silver 5 copper`. Place, weather and the people present can be edited on Home or Scene;
the weather pencil appears while the weather feature is on. In **Settings → Tabs & Packs**, a pinned
data module lists its editable fields under **Fields**, including a set for each attached character.
Data-module layouts may also show pencils. Edits ride on the latest reply: swipe or delete that reply
to take them back when it is not the oldest remaining reply. Deleting the oldest remaining reply carries
its edits forward with the rest of its state.

Use **Settings → Features** to enable optional features. Assist's safety net can recover missed changes. Its pre-roll helper works with a module that supplies checks, such as Story Director.

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

In **Settings → Money**, Automatic means no limit: the story decides. Set a number to cap what one reply may give; the money scale is in the folded **Advanced** row. Names and values of coins are set on the same page.

## RPG

The optional RPG adds a party sheet, automatic dice for fights and checks, and Soul Class and skill ranks that rise as the story goes on. Switch it on under **Settings → Features**, then make Character, Skills, Foes and Combat rules blocks from the **RPG** templates. The [RPG guide](RPG.md) covers the Party tab, the stage bars, rolls, death and undo, and how to change the templates.

## Removing Story Block from a chat

Story Block keeps change lists inside hidden reply comments and removes them from prompts while it runs. To continue a chat with Story Block switched off, add a SillyTavern regex script under **Extensions → Regex → New global script**:

Find Regex:

```
/<!--\s*STORY_SUITE_V2\b[\s\S]*?-->/g
```

Leave **Replace With** empty, select **AI Output**, and under Ephemerality select only **Alter Outgoing Prompt**. The replies retain their lists in case Story Block is reinstalled.
