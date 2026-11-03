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

## What a card never gets

A hidden value is never returned: not by `get`, not in `paths()`, not in a change list, not in a macro. That covers a data-module field the pack marks `prompt: false`, a block shown nowhere, and the RPG's values while the RPG is off. A hidden field reads as `undefined` (the fallback, in a macro). Your card cannot work around this.

## Limits

- Read-only. A card changes the story through the narrator's change lines or the screens, not through the API.
- Version 1 is a promise: names, arguments and payload shapes in PUBLIC-API.md do not change inside version 1; new paths and events may be added.
- `npc.<name>.<meter>` (NPC State Delta) is not in this release.
- With SillyTavern's old macro engine, only a fixed set of paths has a macro and there is no fallback (listed in PUBLIC-API.md). Use SillyTavern 1.19 or later.
- Blocks defined on the character card's own worldbook are a separate, later piece: for now, blocks come from a pack.
