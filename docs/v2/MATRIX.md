# Combination matrix

The matrix runs Story Block alone, with Story Director, with NPC State Delta, and with both modules. It exercises replies, actions, replay, features and the absence of optional peers.

```sh
npm run matrix -- --root /path/to/checkouts
node scripts/matrix.mjs --rows SB+SD,SB+SD+NSD
```

The sibling folders are `Story_block`, `Story_director` and `npc_state_delta`. A missing checkout is skipped; a failing case produces a nonzero exit. Use `--json` for machine-readable output.
