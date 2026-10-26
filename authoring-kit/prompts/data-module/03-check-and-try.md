# Data module, step 3: check it and try it

## Check

```
node check.mjs work/<slug>.pack.json
```

It prints `OK` or a numbered list of problems, each with its path and a hint. What the codes mean:

| Code | What to do |
|---|---|
| `DM_SCHEMA` | a key is unknown, missing or the wrong shape; every object lists exactly the keys the format allows. Check the spelling, then `reference/DATA-MODULES-FORMAT.md`. |
| `DM_BOUNDS` | a default is outside its bounds, or a calculation can leave a field's bounds. Widen the field, or add `"bounds": "clamp"` to the `add`, or clamp the value. |
| `DM_LABEL` | a label is not one lowercase word, is `kind` or `who`, or is not an int, bool or enum; or an `oncePerReply` entry is not an enum label. |
| `DM_CONDITION` | a `when` does not give true or false; compare values of one type, with `eq`, `lt`, `and`, `not`. |
| `DM_BUDGET` | the module is too big for version 1 (see `reference/LIMITS.md`): fewer fields, kinds or rules. |
| `MISSING_CAPABILITY` / `BAD_REQUIRES` | the pack must list `"data-modules-v1"` in `requires.capabilities` (and `"story-director"` when it reads the story clock). |

Typical mistakes: a text field read in an expression (text is display only), a path to a map without its key
(`["standing"]` instead of `["standing", "guild"]`), a division by something that is not a positive literal, a timer
that is not an `add`, an `imports` alias a timer's `clock` does not name, a `check` or `grantCoin` effect (those need a
later version and are refused).

## Try it in SillyTavern

1. Import the pack: Settings, Tabs & Packs, **Import pack file**, and choose the file. The pack only goes into the
   library; nothing changes in any chat yet.
2. Open a chat and go to Settings, Tabs & Packs, **Data modules**. Pick the module, read the preview (fields, example
   lines, needs) and press **Enable for this chat**. For a per-character module, choose the characters to attach; for a
   timer, make sure the story clock is set.
3. Send the example lines from `work/<slug>-lines.md` one scenario step per reply, as the narrator would write them
   inside `<Changes>`. After each reply, look at the module's screen and at the changes card: the values should be the
   ones the scenario says, and a line that should be refused should show its reason with nothing applied.
4. Swipe or delete a reply to see its change undone; the module follows the story.

If you use Story Studio, its **Data modules** section checks the same definition as you type and has a simulator that plays
sample replies offline, which is the quickest way to find a wrong bound or a missing label before you try it in a chat.

## A chat keeps its own copy

Enabling a module pins a frozen copy of its definition in that chat. Editing the pack later does not change a chat that
already uses it. To change the rules of a running chat the module needs a migration (new fields with defaults only);
anything else needs a new module (a new slug) or a new chat.
