# Packs

A pack is a JSON file containing world data. It can provide places, routes, a calendar, weather, events, currency, starting state, screens and data modules. The [Ersveil open-world example](../../examples/packs/ersveil/pack.json) shows a larger pack; [Ersveil](ERSVEIL.md) describes how to play it.

A pack can give your character a **rank** with `"content": { "you": { "rank": { "label": "Guild rank" } } }` (the label is 1 to 30 plain characters). Only a story with such a pack has a Rank in Your look: Home shows it first under the label ("Guild rank"), Story Director's Status card has a row for it, and the narrator is told to write `~ you rank: …`. The first enabled pack that declares it wins. With no such pack there is no rank anywhere and `~ you rank:` is not used; a rank already kept stays and returns when the pack is on again. The Ersveil example uses "Guild rank".

Import a file under **Settings → Tabs & Packs → Import pack file**. A pack with an existing id replaces that installed pack. Start a new chat to use its starting state.

For the format and limits, see the [authoring-kit reference](../../authoring-kit/reference/PACK-FORMAT.md) and [limits](../../authoring-kit/reference/LIMITS.md). [Data modules](DATA_MODULES.md) covers their definitions and examples. The authoring kit's checker uses Story Block's own pack validation.

Rules packs for RPG Battle cannot be imported. Keep existing RPG Battle chats on the previous versions.
