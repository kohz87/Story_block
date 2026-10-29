# Story Suite player guide

Story Block keeps your inventory, money and scene. Story Director adds checks, story-told quests, a calendar, map, World, Chronicle and arc planning. NPC State Delta adds dossiers for people in the story. Install Story Block first, then the optional modules, and reload SillyTavern.

## Starting a world

In **Settings → Tabs & Packs**, import a pack file. Start a fresh chat for its starting place and inventory. The [Ersveil open-world example](ERSVEIL.md) includes places, routes, a calendar, weather, events and data modules. [Pack authoring](PACKS.md) describes the format.

## Playing

The narrator writes a hidden `<Changes>` block. Each module checks its lines and records accepted changes alongside the reply. Swipe or delete a reply to take back its changes; after editing a reply, press **Re-read**. **Problems** explains refused lines.

On Home and in Inventory, tap the pencil beside a value, change it, then choose **Save** or **Cancel**.
Each inventory item's pencil opens its name, count and note together. Inventory also has **Add item**
and its existing Drop action. For things kept as separate pieces, count changes the total of that
kind for its owner; name and note change the selected piece. The purse accepts a whole amount or mixed
coins such as `3 silver 5 copper`. Place, weather and the people present can be edited on Home or Scene;
the weather pencil appears while the weather feature is on. In **Settings → Tabs & Packs**, a pinned
data module lists its editable fields under **Fields**, including a set for each attached character.
Data-module layouts may also show pencils. Edits ride on the latest reply, so a swipe or delete of that
reply takes them back.

Use **Settings → Features** to enable optional features. Assist's safety net can recover missed changes. Its pre-roll helper works with a module that supplies checks, such as Story Director.

## Making a block

Open **Game view → Blocks**, choose **New block**, then **Empty block** or a saved template. Name it,
add text, number, choice or list fields, and say what it is for. Choose a tab, a Home card or both.
You can add buttons and rules; a timer needs Story Director's clock and can add to a number field.
Each field and each button uses one of the 16 available slots; rules and timers do not use these
slots. Save with the latest reply, then use the pencils and buttons on the block. The narrator can
update its fields with the story lines shown in Setup.

The block's actions menu can edit it, save its definition as a template, export a pack, or remove it.
Templates are shared across your chats, without the current values; manage them under **Settings →
Tabs & Packs → Block templates**. Swipe or delete the reply that created, changed or removed a block
to take that action back. A chat can have up to eight blocks, and blocks and pack modules share the
16-pin budget, including retained pins. Definitions and their generated story kinds must fit the
data-module limits.

In **Settings → Money**, Automatic means no limit: the story decides. Set a number to cap what one reply may give; the money scale is in the folded **Advanced** row. Names and values of coins are set on the same page.

## Removing Story Block from a chat

Story Block keeps change lists inside hidden reply comments and removes them from prompts while it runs. To continue a chat with Story Block switched off, add a SillyTavern regex script under **Extensions → Regex → New global script**:

Find Regex:

```
/<!--\s*STORY_SUITE_V2\b[\s\S]*?-->/g
```

Leave **Replace With** empty, select **AI Output**, and under Ephemerality select only **Alter Outgoing Prompt**. The replies retain their lists in case Story Block is reinstalled.
