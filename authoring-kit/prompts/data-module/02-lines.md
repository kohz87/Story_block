# Data module, step 2: the narrator's lines

A data module only moves when the story writes one of its **lines**. The narrator never sees your JSON: Story Block
generates a one-line grammar for each kind from your declarations, and puts that in the narrator's instructions. This
step makes sure those lines are easy to write, and gives you lines to try.

## What a line looks like

Inside the story's `<Changes>` block, one line per change:

```text
<Changes>
+ dm reputation — repaired the Guild's weir | kind: gain | faction: guild
</Changes>
```

The parts: the **mark** (`+ - ~ ! ?`, the kind's `op`), the word `dm`, the **module** (its bare slug when that is unique
in the chat, else `pack.<pack id>/<slug>`), a dash and a short **reason** in plain words, then `| kind: <kind>` and one
`| label: value` for each label of that kind. A character-scoped module also takes `| who: <Name>` (an attached
character). Labels are typed, so a value is one of an enum's choices, a whole number inside the bounds, or true or false.

The grammar the narrator is shown is made from the declaration, for example:

```text
+ dm reputation — reason | kind: gain | faction: guild|watch|compact
- dm reputation — reason | kind: loss | faction: guild|watch|compact
! dm survival — reason | kind: rest | who: attached actor | hours: 1..8
```

## What is refused

A line is refused whole, with nothing applied, when the kind is unknown, a label is missing or repeated, a value is
outside its choices or bounds, the module is not enabled in the chat, `who` names no attached character, the same
`oncePerReply` combination is used twice in one reply, or the kind's `when` is false (its `refusal` text is shown). A
refusal is never turned into a story fact.

## Fill in

| Placeholder | What to put |
|---|---|
| `{{MODULE_FILE}}` | the pack file with the module, for example `work/reputation.pack.json` |
| `{{MODULE_SLUG}}` | the module's slug |

## The prompt

```
Read the data module in {{MODULE_FILE}}. For each kind, write the exact line a narrator would write, using the grammar
above, and check the design against these questions; change the module (not the story) when the answer is no:
1. Can a narrator write each kind from its one-line grammar without reading anything else? If a kind needs more than three
   labels, or a label that is an arbitrary number, simplify it: fewer labels, smaller ranges, an enum of named choices.
2. Do the label names and enum values read as words from the story ("faction: guild", "hours: 6"), all lowercase,
   one word each, never "kind" or "who"?
3. Does every kind that should only count once per reply have oncePerReply set (list the enum labels that identify the
   repeat)?
4. Does every refusal text say what to fix, in under 240 characters ("Rest needs 1 to 8 hours already narrated.")?
5. Where a kind lets the narrator ask for a reward, does the code (a reward template with a range) decide the number,
   rather than the narrator writing it?

Then write work/{{MODULE_SLUG}}-lines.md with, for each kind: the grammar line, two or three example lines that should
be accepted (with the field values before and after), and one line that should be refused (with why). Order the examples as
a short scenario for three separate replies, as the worked examples in reference/data-modules/ are. Use only the
module's own names. Run node check.mjs {{MODULE_FILE}} again if you changed it.
```

## Examples to learn from

`reference/data-modules/faction-standing.pack.json`: a chat-wide module. `gain` asks for a code-sized reward
(`+ dm reputation — repaired the Guild's weir | kind: gain | faction: guild` adds the template's midpoint, 3); `loss`
subtracts a fixed 5 and clamps; a rule earns the title "Guild Friend" once at 6. `faction: crown` is refused. A second
`gain` for the guild in the same reply is refused as already counted.

`reference/data-modules/survival-meters.pack.json`: a per-character module on the story clock. A timer raises hunger and
fatigue every 60 story minutes; `! dm survival — ate supper | kind: meal | who: the guide` lowers hunger by 20, `! dm
survival — slept at the camp | kind: rest | who: the guide | hours: 6` lowers fatigue by 60 (clamped at 0), and `hours: 9` is
refused (the label allows 1 to 8).
