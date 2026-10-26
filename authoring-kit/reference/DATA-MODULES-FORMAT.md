# Data modules: the format, in short

A **data module** is a small, closed JSON definition that adds a rule to a chat without any code: a reputation
meter, a hunger clock, a counter the story moves. Story Block interprets it; it cannot run loops, functions, scripts
or network calls. It lives in a pack at `content.dataModules` (up to 8 per pack), and the pack lists
`"data-modules-v1"` in `requires.capabilities`.

Two complete, checked examples are in [data-modules/](data-modules/): `faction-standing.pack.json` (one shared
meter set, a reward, a title) and `survival-meters.pack.json` (per-character meters moved by the story clock). The
numbers are in [LIMITS.md](LIMITS.md); the checker (`node check.mjs <pack>`) is the final word. The full contract
is `docs/v2/DATA_MODULES.md` in the Story Block repository. Unknown keys anywhere are errors.

## The definition

```json
{ "slug": "reputation", "name": "Reputation", "schema": 1, "stateVersion": 1, "scope": "chat",
  "state": { }, "kinds": { } }
```

| Key | Meaning |
|---|---|
| `slug` | lowercase letters, digits and dashes, at most 40 characters; the module's id is `pack.<pack id>/<slug>` |
| `name` | one line, 1 to 80 characters |
| `schema` | always `1` |
| `stateVersion` | a whole number from 1; raise it when you add fields (see Migrations) |
| `scope` | `"chat"` (one shared instance) or `"character"` (one instance per attached character) |
| `state` | the fields the module owns |
| `kinds` | the lines the story may write, by name |
| optional | `imports`, `rules`, `timers`, `rewards`, `exports`, `screens`, `layouts`, `migrations` |

## State: the fields

Every field has a type and a default. Nothing else exists, and nothing grows.

| Type | Keys | Notes |
|---|---|---|
| `int` | `min`, `max`, `default` | whole numbers; default inside the bounds |
| `bool` | `default` | |
| `enum` | `values` (1 to 32 distinct), `default` | the default is one of the values |
| `text` | `max` (1 to 240), `default` | display only; an expression cannot read it |
| `map` | `keys` (1 to 16 slugs), `values` (an int, bool, enum or text schema) | fixed keys; every key starts at the default |

Field and key names: lowercase letters, digits and dashes, at most 40 characters.

## Kinds: what the story may say

The narrator writes a line in the story's `<Changes>` block, and the host sends it to the module:

```text
+ dm reputation — repaired the Guild's weir | kind: gain | faction: guild
```

`op module — reason | kind: <kind> | label: value ...` (a character-scoped module also takes `| who: <Name>`).
The module may be named by its bare slug when that is unique in the chat, else by `pack.<pack id>/<slug>`.

```json
"kinds": { "loss": {
  "op": "-",
  "labels": {
    "faction": { "type": "enum", "values": ["guild", "watch", "compact"] },
    "severity": { "type": "int", "min": 1, "max": 10 }
  },
  "oncePerReply": ["faction"],
  "when": ["le", ["arg", "severity"], 5],
  "refusal": "One slip costs at most 5.",
  "effects": [ { "op": "add", "path": ["standing", ["arg", "faction"]],
                 "value": ["mul", ["arg", "severity"], -1], "bounds": "clamp" } ]
} }
```

| Key | Meaning |
|---|---|
| `op` | the line's mark: `+` gained, `-` lost, `~` changed, `!` happened, `?` asks the code to decide |
| `labels` | the typed values the line carries, by name: `int` (`min`, `max`), `bool`, or `enum` (`values`). A label name is one lowercase word; `kind` and `who` are reserved. |
| `effects` | what happens, in order (see Effects); required |
| `when` | optional condition; when false the whole line is refused and nothing changes |
| `refusal` | optional text (up to 240 characters) shown when `when` is false |
| `oncePerReply` | optional list of enum labels: the same combination counts once per reply (default: the kind once per subject per reply) |
| `ui` | optional `true` lets a screen button run the kind too (`dm.act`) |

A line that names an unknown kind, misses a label, repeats one, or carries a value outside the label's bounds is
refused whole: nothing is guessed. Checks (`check`) inside a kind and the effects `grantCoin`, `grantItem` and
`grantXp` need data-modules v1.1; version 1 refuses them with a clear message.

## Expressions

An expression is a JSON array (an operator and its arguments) or a literal (number, `true`/`false`, a string value
of an enum). Whole numbers only; no floats, no conversion between types.

| Expression | Meaning |
|---|---|
| `["get", path]` | a declared field of this instance; `path` is `["title"]` or `["standing", "guild"]` |
| `["arg", name]` | a label of the line (in a kind) |
| `["bind", name]` | a binding of the reward template (in a reward) |
| `["reward", name]` | a value the reward template picked |
| `["input", alias, field]` | a field of an import, such as `["input", "clock", "minutes"]` |
| `["timer", "periods"]` | whole periods elapsed in this timer run (in a timer's effects) |
| `["eq"/"ne"/"lt"/"le"/"gt"/"ge", a, b]` | comparison of the same type; ordering needs integers |
| `["and"/"or", a, b]`, `["not", a]` | logic |
| `["add"/"sub"/"mul"/"min"/"max", a, b]` | integer arithmetic |
| `["floorDiv", a, n]`, `["clamp", x, lo, hi]` | divide by a positive literal `n`; keep `x` between literals `lo` and `hi` |

Depth 6, 64 nodes per expression. A path segment may itself be an enum expression (`["arg", "faction"]`) when
every value of it names a declared key. A condition must produce true or false.

## Effects

Each effect object has `op` and exactly the fields named here, run in array order.

| Effect | Fields |
|---|---|
| `set` | `path`, `value` |
| `add` | `path`, `value`, optional `bounds`: `"reject"` (default, refuse the line when it would leave the field's bounds) or `"clamp"` |
| `clamp` | `path`, `min`, `max` (literals inside the field's bounds) |
| `reward` | `template`, `bind` (a value for every binding of the template) |
| `offer`, `award` | a reward held under a `key` until an `award` settles it |

The checker proves from the field bounds that every result fits; a calculation that can leave a field's bounds is
refused unless it is clamped.

## Rules

`rules: [ { "id", "when", "then": [effects] } ]` run once, in order, after a kind's effects (and after a timer).
A rule sees the effects before it, does not trigger other rules, and is simply skipped when `when` is false.
Use a boolean or enum field as a latch for something earned once.

## Rewards

The narrator names a template and a binding; the code picks the number.

```json
"rewards": { "favour": {
  "bindings": { "faction": { "type": "enum", "values": ["guild", "watch", "compact"] } },
  "values": { "amount": { "min": 1, "max": 5, "pick": "midpoint" } },
  "effects": [ { "op": "add", "path": ["standing", ["bind", "faction"]], "value": ["reward", "amount"], "bounds": "clamp" } ]
} }
```

`pick` is `min`, `max` or `midpoint`. A value may instead select a range by an enum binding:
`{ "binding": "tier", "table": { "low": {min, max, pick}, "high": {min, max, pick} } }` covering every value.
Reward effects cannot use `reward`, `offer` or `award` themselves.

## Timers

A timer moves fields as the story clock passes. It reads the clock through an import.

```json
"imports": { "clock": { "query": "director.time", "mode": "prefix", "projection": ["minutes"] } },
"timers": [ { "id": "needs", "clock": "clock", "every": 60,
  "effects": [ { "op": "add", "path": ["hunger"], "value": ["mul", ["timer", "periods"], 2], "bounds": "clamp" } ] } ]
```

Timer effects are `add` only. The survival example lists `"story-director"` in the pack's `requires.capabilities`
because its clock comes from there. `every` is 1 to 525,600 minutes. The module shows "Waiting" until the clock is set.

## Imports and exports

`imports: { alias: { query, mode, projection, args? } }`. The reviewed queries are `director.time` (projection
`["minutes"]`), `checks.policy` (projection `["actors.id", "actors.name"]`, for character scope) and
`dataModules.public` (`args`: `module` as a full id, `export`, and `who` for a character export; projection: the
export's fields). `mode` is `prefix` or `recorded`. `exports: { name: { "fields": [state field names] } }` makes
fields readable by other modules and nothing else.

## Screens

```json
"screens": [ { "id": "reputation", "title": "Reputation", "icon": "fa-flag", "mounts": ["tab", "card"],
  "layout": { "root": { "type": "col", "children": [
    { "type": "text", "label": "Guild", "bind": { "query": "dataModules.view",
      "args": { "module": "pack.my-pack/reputation" }, "path": "chat.standing.guild" } } ] } } } ]
```

A screen reads only its own module through `dataModules.view` (`chat.<field>` for chat scope, `characters` for a
list with `$item.name` and the fields for character scope) or a declared import. Layout nodes: `box`, `row`, `col`,
`grid`, `text`, `meter`, `badge`, `list`, `tabs`, `when`, `button` (a button may only run `dm.act` on a kind with
`ui: true`, with a `payload` of `module`, `kind`, `labels` and, for character scope, `who`). `mounts` are `tab`,
`screen`, `card`, `hud`, `dialog`.

## Migrations

Raising `stateVersion` is for adding fields only: `migrations: [ { "from": 1, "to": 2, "add": { "newfield": {schema} } } ]`
(adjacent versions, at most 4 steps, the field must be in `state` with exactly that schema). Removing, renaming,
retyping or narrowing a field, or changing a kind, rule or timer, needs a new module (a new slug).

## What a data module cannot do

Loops, recursion, functions, scripts, regular expressions, network or file access, the wall clock, raw patches,
reading another module's private state, writing another module's data, or making up characters, items or check
results. If the idea needs one of these, it is a code module.
