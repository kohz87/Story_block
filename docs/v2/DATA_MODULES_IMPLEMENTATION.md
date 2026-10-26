# Data modules implementation status

`stage6/data-modules` starts at main `cc0b793` and first merges the approved design branch
at `073404f`. [DATA_MODULES.md](DATA_MODULES.md), especially its approved decisions, is the contract.

## Step 1: shared checker

Delivered: `validatePack` recognizes `content.dataModules` and requires `data-modules-v1`.
The host capability list includes that name. Import is authoring support at this WIP boundary;
the runtime is not registered yet and importing a definition does not enable it in any chat.

Studio can import these pure exports from `src/v2/data-modules/check.js` or `src/v2/packs/index.js`:

- `DM_DESCRIPTORS`, `DM_LIMITS`, `DM_DIAGNOSTICS`, `DATA_MODULES_CAPABILITY`.
- `validateDataModules(definitions, {packId, capabilities, definitions: dependencyCatalog})`.
- `validateDataMigration(oldCheckedDefinition, targetCheckedDefinition)`.
- `dataModuleDefaults(stateSchema)` and `dataModuleHash(checkedDefinition)`.

`validatePack` remains the whole-pack authority. Its `dataModuleDefinitions` option supplies a catalog
of already checked definitions for cross-pack public imports. Imports inside the same pack resolve
without that option. An unresolved dependency/export refuses instead of allowing untyped reads.
The catalog is read-only and does not become part of the importing pack. At pin time, the runtime
must resolve the catalog against the chat's frozen active definitions and check cycles again.

Definitions normalize their optional collections, kind claims/conditions/UI flag, import args,
reward conditions and add bounds. Raw exports remain detached copies of the authored data.
Definition identity includes normalized mechanics, imports, presentation, interpreter and limits.
Pack identity is separate; data definitions affect pack identity but not RB's rules marker.
Old packs acquire neither a `dataModules` collection nor new hash properties.

The checker covers closed objects, scalar/default/map schemas, fixed AST arity, type and interval
analysis, dynamic enum paths, typed bindings and references, conditions, one-pass rules, rewards
and offers, SD-minute timer constraints, public adapters/exports/cycles, renderer presentation,
additive migration compatibility, and the static count/size limits. Runtime-only budgets are exported
now; enforcing visits, per-reply roots, patches, durable spans, retained pins, subjects and offers
belongs to steps 2–3. Duplicate *line* labels and transaction refusals likewise belong to capture.
SD check declarations/expressions and all three grant effects refuse with `needs data-modules v1.1`.

The fixtures under `tests/v2/data-modules/fixtures/` include the exact two complete JSON examples
and stable refusal vectors for all five `DM_*` codes. Tests include exact UTF-8 definition/expanded
instance size boundaries, AST and collection limits, malformed-property sweeps, shared diagnostics,
old normalization and rules hash compatibility. They do not claim runtime/replay proof.

## Format clarification

The approved design permits enum-selected reward range tables without specifying their JSON spelling.
The shared descriptor uses the following alternative to a plain `{min,max,pick}` value:

```json
{"binding":"tier","table":{"low":{"min":1,"max":2,"pick":"min"},"high":{"min":3,"max":5,"pick":"midpoint"}}}
```

`binding` names a declared enum binding; `table` must cover its values exactly once, with each
branch checked as a normal range. Table keys use the scalar binding's string representation.
This is a wire-format clarification, not an additional effect or picker. It is shared with Studio
through `DM_DESCRIPTORS.rangeTable`; no separate editor schema is introduced.

## Remaining delivery

2. Merge the interpreter part into Story Block: deferred domain, capture, reader commands,
   SD adapters, frozen offers/pins, budgets, UI refusal reporting and Setup/presentation.
3. Add guard dispatch, prefix witnesses, reply-bound lifecycle, tick re-planning, frozen pin
   isolation, restore barriers and the differential byte-identity property.
4. Prove both examples with real SD, lifecycle scenarios, replay fuzz, lone-clone and side-by-side
   suites, matrix and final diff checks after the runtime is implemented.

Do not advertise end-to-end data modules as shipped until these steps are complete.
