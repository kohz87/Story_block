# Story Suite player guide

Story Block keeps your inventory, money and scene. Story Director adds checks, story-told quests, a calendar, map, World, Chronicle and arc planning. NPC State Delta adds dossiers for people in the story. Install Story Block first, then the optional modules, and reload SillyTavern.

## Starting a world

In **Settings → Tabs & Packs**, import a pack file. Start a fresh chat for its starting place and inventory. The [Ersveil open-world example](ERSVEIL.md) includes places, routes, a calendar, weather, events and data modules. [Pack authoring](PACKS.md) describes the format.

## Playing

The narrator writes a hidden `<Changes>` block. Each module checks its lines and records accepted changes alongside the reply. Swipe or delete a reply to take back its changes; after editing a reply, press **Re-read**. **Problems** explains refused lines.

On Home and in Inventory, tap the pencil beside a value, change it, then choose **Save** or **Cancel**.
Inventory also has **Add item** and its existing Drop action. The purse accepts a whole amount or mixed
coins such as `3 silver 5 copper`. Place, weather and the people present can be edited on Home or Scene.
Data-module layouts may show pencils next to editable fields. Edits ride on the latest reply, so a swipe
or delete of that reply takes them back.

Use **Settings → Features** to enable optional features. Assist's safety net can recover missed changes. Its pre-roll helper works with a module that supplies checks, such as Story Director.

In **Settings → Money**, Automatic means no limit: the story decides. Set a number to cap what one reply may give; the money scale is in the folded **Advanced** row. Names and values of coins are set on the same page.

## Removing Story Block from a chat

Story Block keeps change lists inside hidden reply comments and removes them from prompts while it runs. To continue a chat with Story Block switched off, add a SillyTavern regex script under **Extensions → Regex → New global script**:

Find Regex:

```
/<!--\s*STORY_SUITE_V2\b[\s\S]*?-->/g
```

Leave **Replace With** empty, select **AI Output**, and under Ephemerality select only **Alter Outgoing Prompt**. The replies retain their lists in case Story Block is reinstalled.
