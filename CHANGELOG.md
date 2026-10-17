# Changelog

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
