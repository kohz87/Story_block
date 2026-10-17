# Changelog

## 0.3.0

World State and Choices.

- **World State template** (off by default): a kept block in Megumin Suite's World State layout, label for label — time, place and weather; {{user}}'s outfit, position and condition; everyone present with outfit, position, mood, agenda and secret; off-screen activity; unresolved threads, planted seeds, consequence timers, arc and scene phase. Chats that already carry Megumin World States pick up their last one.
- **Scene board display:** chips for time, place and weather, a card per person (yours marked), secrets hidden until you reveal them, threads and timers, and arc and scene phase as a small rail. Its badge and the "This turn" strip report who joined or left and which moods, positions or outfits changed — never secrets. Anything the board can't read falls back to plain text.
- **Choices template** (off by default, tag `CYOA`): four suggested actions each reply, as buttons. A click adds the choice to what you have typed in the message box; Shift-click (or the row's send button on touch screens) sends it. A choice starting with "/" is never sent automatically.
- **Layouts for free-text blocks:** a text block can carry a layout — the skeleton the model fills in — editable under Layout in the block editor. `{{user}}` and `{{char}}` are filled in there as in prompts.
- **NPC State Delta:** reads story dates from Story Block's World State. Its scan cleaner does not yet see the World State text inside Story Block's hidden envelope (a fix on NPC State Delta's side is needed); a test tracks it.

## 0.2.0

The blocks move into a sidebar.

- **Sidebar.** On wide screens it docks in the free space beside the chat and stays open (unpin it to use it as a drawer). On tablets and narrower desktops it slides in from the right over a dimmed chat; on phones it is a bottom sheet that opens at about two-thirds height and drags up to full height. Esc, the close button, a tap outside or a swipe closes it, and an edge handle with this turn's change count opens it again.
- **Change badges.** Each block's tab shows how many things the latest reply changed in it.
- **"This turn" strip** (off by default; Settings → "This turn" strip): one line under the latest reply listing what it changed — losses and gains coloured, problems flagged — and tapping it opens the sidebar on that block.
- **Display setting.** "Show blocks in" switches between the sidebar and v0.1's card under the latest reply. The card keeps the Megumin-compatible markup, so extensions that mount into Megumin Suite's card (NPC State Delta) still work there; in the sidebar they need Story Block's tab API.

## 0.1.0

First release: Inventory Block's engine generalized to any number of user-defined blocks.

- **Block definitions.** Every block — template or custom — has a name, icon, tag, kind
  (stateful or per-turn), format (rows, fields, free text), display (tree list, meters &
  fields, plain), prompt, and a "when" rule (every reply, every N replies, keyword).
- **Templates:** Inventory (enabled), Character Sheet and Scene Notes (off by default).
- **One hidden `<Blocks>` envelope per reply**, with bare `<Blocks>` and bare block tags
  accepted and hidden on receive. Cut-off envelopes are hidden and rejoined by Continue.
- **Stateful blocks** inject their newest valid state into every reply's prompt; invalid,
  missing or cut-off copies never replace it, and the reader is warned.
- **Prompt lifecycle from Inventory Block v0.6.7:** placeholder-based detection of the
  reply's own prompt (in-chat for chat completion, so presets without a Main Prompt work),
  fallback, watchdog, and a status line in settings. Other extensions' background prompts
  are left untouched.
- **Card:** one tabbed card under the latest reply, change strip for rows and fields, Edit
  per block, a public tab API (`globalThis.StoryBlock.registerTab`) and Megumin-compatible
  markup for extensions that already mount into Megumin Suite's card.
- **Settings editor:** enable, show, reorder, edit, duplicate, delete, reset templates, add
  blocks, import/export JSON, token estimate per block.
- **Compatibility:** reads Inventory Block `INVENTORY_BLOCK_V05` snapshots and Megumin
  Suite `<Blocks>` already in a chat.
