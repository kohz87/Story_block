# Story Block 2.6.1

Story Block is the Story Suite host for SillyTavern. It keeps the inventory, purse and scene, reads the story's change lines and shows the result in tabs and cards. [Story Director](https://github.com/kohz87/Story_director) adds checks, quests, a clock, a map and story planning; [NPC State Delta](https://github.com/kohz87/npc_state_delta) adds NPC dossiers. Both are optional.

## Install

Install Story Block through **Extensions → Install extension**, then optionally install Story Director and NPC State Delta. Reload SillyTavern after installation. Update Story Block before its modules.

To try the open-world example, import [`examples/packs/ersveil/pack.json`](examples/packs/ersveil/pack.json) in **Settings → Tabs & Packs → Import pack file**, then start a new chat. [Ersveil](docs/v2/ERSVEIL.md) explains the world and its data modules.

RPG Battle is no longer supported; its rules packs cannot be imported. Existing RPG Battle chats should stay on the previous versions.

## Playing

The story can propose items, coins, scene changes and other facts in a hidden `<Changes>` block. Story Block checks and records them with the reply, so swipes and deletes take their changes back. After editing a reply, use **Re-read**.

The story decides how much money and how many items a reply gives: there is no per-reply cap. In **Settings → Money** you set the coins and the money words; the money scale is in the folded **Advanced** row.

The optional Assist safety net can read missed changes, and its pre-roll helper can prepare checks when a module such as Story Director provides them. Turn features on in **Settings → Features**.

## Making packs and modules

Packs can describe places, routes, calendars, weather, events and data modules. See the [pack guide](docs/v2/PACKS.md), [data modules](docs/v2/DATA_MODULES.md), and the [authoring kit](authoring-kit/README.md). Modules use the generic SDK to register commands, queries, features, screens and widgets.

For more, see the [player guide](docs/v2/GUIDE.md), [changelog](CHANGELOG.md), and [licence](LICENSE). Icons include [Phosphor Icons](ICONS-CREDITS.md).
