# Build your first card on Story Block

A card can show the story's state (the place, the purse, your health) and react when it changes. This page does both in a few steps, using only the public API: [PUBLIC-API.md](PUBLIC-API.md). Nothing here changes the story; the public API only reads.

## 1. Install and switch on what you need

1. In SillyTavern, open **Extensions → Install extension** and paste `https://github.com/kohz87/Story_block`.
2. For the party values (`party.me.health`, levels), switch the RPG on: **Settings → Features → RPG** (see the [RPG guide](RPG.md)). With it off, the party paths have no value.
3. For values from a world pack (`blocks.<blockId>.<field>`), install the pack in **Settings → Tabs & Packs** and switch it on. The scene, the money and the items need nothing extra.

Start a chat and play one reply, so there is a state to read.

## 2. Show values in a status bar

`{{sb::path}}` writes a value of the story as text, in prompts, cards and regex scripts. A status bar is one regex script that turns a marker into a line of values:

```
📍 {{sb::scene.place}} · 💰 {{sb::money.text}} · ❤ {{sb::party.me.health}}
```

The ready-made script is in [examples/cards/status-bar](../../examples/cards/status-bar/README.md). To import it: open **Extensions → Regex**, press **Import**, and pick `status-bar.regex.json`. Then end your card's replies (or its narrator instruction) with the marker `[STATUS]`; the script replaces the marker with the line above when the message is shown. The line is only drawn on screen; the model never sees it.

## 3. Give a value a fallback

`{{sb::path::fallback}}` shows the fallback when the path is empty or hidden:

```
{{sb::scene.place::somewhere}} · {{sb::party.me.health::not playing}}
```

Without a fallback an empty path shows nothing. A list shows as a comma list (`{{sb::scene.present}}` gives `Ren, Mara`). An object has no text: use a leaf path such as `items.Healing Draught.qty`.

## 4. Find the paths

The full list of paths is in [PUBLIC-API.md](PUBLIC-API.md#paths). To see what exists in your chat right now, open the browser console and run:

```js
StoryBlock.api.paths()
```

## 5. React to a change from a script

A script can listen to `story:changed`. It runs after Story Block has saved the reply, and it gets a list of `{ path, from, to }`. This one reports a level-up:

```js
const api = StoryBlock.api;
await api.ready;
const off = api.on('story:changed', ({ changes }) => {
  for (const c of changes) {
    if (/^party\..+\.level$/.test(c.path) && c.to > c.from) {
      console.log(`Level up: ${c.path.split('.')[1]} is now level ${c.to}`);
    }
  }
});
// off();  // stops listening
```

Paste it into the browser console to try it, or put it in any extension that runs page scripts. A swipe, a delete or a reload sends `story:rebuilt` instead; read the paths again then. An error in your listener is caught and logged; it never breaks a reply.

## Ship your whole world inside the card

A card can carry its pack, its portraits and the settings it recommends in the card's own lorebook. Story Block notices them when a chat opens and offers them at the top of the Story panel: **Install** or **Not now**. Nothing is installed without that click, because card content comes from strangers.

Make three entries in the card's lorebook. Each is **disabled** (so SillyTavern never sends the JSON to the model) and is found by a tag in its **Title/Memo**. The content is JSON, plain or inside a ```json fence.

| Title/Memo contains | Content |
|---|---|
| `[storysuite:pack]` | the pack, exactly as `pack.json` (see PACKS.md) |
| `[storysuite:portraits]` | `{ "v": 1, "pack": "<pack id>", "version": "<pack version>", "files": { "<file name>": "data:image/webp;base64,…" } }` |
| `[storysuite:settings]` | `{ "v": 1, "settings": { "story-block.rpg": true, "story-block.gear": true } }` |

- **Pack.** Bump the pack's `version` to make players see an update offer ("This card has a newer …"). A pack that fails the checker is not offered; Settings → Diagnostics → Card offers says why. A pack that needs a module that is not installed (for example `chronicle-lasting` needs Story Director) is shown with "Needs Story Director for world events" and Install stays off until it is installed.
- **Portraits.** Name each file as the pack's cast names it (`"portrait": "fenna.webp"`). At most 24 files, 200 KB each and 3 MB together once decoded, webp, png or jpeg. `pack` and `version` must match the pack on the card. A name no cast member uses is skipped. Story Studio's Character card page builds this entry for you and shrinks the pictures to about 40 KB each.
- **Recommended settings.** Only these keys: `story-block.rpg` (true or false), `story-block.gear` (true or false), `story-block.rpgXpRate` (a whole number from 50 to 300 in steps of 25), `npc-state-delta.portraitPromptFormat` and `npc-state-delta.scanEvery` (NPC State Delta's own values and range). Anything else is skipped. The offer lists only the settings that differ from the player's own, as "Also apply: RPG on · Gear on", ticked by default, and applies them only with the click.
- **The consent click.** Install installs the pack, stores the portraits, turns the pack's data modules on in this chat (an update keeps the chat's own choice), applies the ticked settings, and then says exactly what it did. "Not now" is remembered for that card, pack id and version, so it asks once per version. A card with several packs gets one notice per pack, at most three. Group chats show no offer.
- **Missing extensions.** If a setting belongs to an extension that is not installed (NPC State Delta), its keys are dropped and a muted line says "Needs NPC State Delta for portraits and dossiers"; Install still works.

Story Studio's **Character card** page writes these three entries, the status bar's regex scripts and the card's other fields, and shows what each adds to the card's size.

## What a card never gets

A hidden value is never returned: not by `get`, not in `paths()`, not in a change list, not in a macro. That covers a data-module field the pack marks `prompt: false`, a block shown nowhere, and the RPG's values while the RPG is off. A hidden field reads as `undefined` (the fallback, in a macro). Your card cannot work around this.

## Limits

- Read-only. A card changes the story through the narrator's change lines or the screens, not through the API.
- Version 1 is a promise: names, arguments and payload shapes in PUBLIC-API.md do not change inside version 1; new paths and events may be added.
- `npc.<name>.<meter>` comes with NPC State Delta 1.10.0 or later (see [PUBLIC-API.md](PUBLIC-API.md#paths-from-modules)); without that module there are no `npc.*` paths.
- With SillyTavern's old macro engine, only a fixed set of paths has a macro and there is no fallback (listed in PUBLIC-API.md). Use SillyTavern 1.19 or later.
- A card cannot install or run code (SillyTavern does not allow it), so extensions themselves never ride in a card; a card can only say which ones it needs (see "Ship your whole world inside the card").
