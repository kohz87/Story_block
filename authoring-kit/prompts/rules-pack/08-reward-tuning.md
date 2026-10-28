# Step 8 (optional): tune quest rewards to their rank

Run this on a finished pack when the quest rewards feel off, or after changing the ranks. It edits only the `reward` of
quests, and nothing else.

## Fill in

| Placeholder | What to put |
|---|---|
| `{{PACK_FILE}}` | the pack file to edit, for example `work/pack.json` |

## The prompt

```
Edit only {{PACK_FILE}}. Change only the "reward" of quests in content.quests; change nothing else (no slugs, names,
objectives, requirements, other kinds, formatting style).

The pack's content.ranks give each rank a level range ("levels": [min, max]) and a coin range ("reward": [min, max]), and
may give an experience range ("xp": [min, max]). Experience is flat (100 XP a level at every level), so a quest's XP is not
scaled from its coin: a quest is worth roughly a third of a level to two levels, about 30 to 200 XP, a little more at higher
ranks.
For each quest:
1. Its level is the "min" of its {"kind":"level"} requirement, or 1 if it has none.
2. Its rank is the FIRST rank in content.ranks (in file order, lowest first) whose level range contains that level.
3. reward.coin must lie inside that rank's coin range. If it already does, leave it. If it's outside, set it to the
   nearest end of the range, then round to a whole number ending in 0 (stay inside the range).
4. reward.xp: if its rank has an "xp" range, xp must lie inside it (move it to the nearest end if not, ending in 0). If the
   rank has none: if you changed coin, scale xp by the same factor (new coin / old coin), round to a whole number ending
   in 0, and keep it at least 10; if you didn't change coin, leave xp.
5. reward.items: leave as they are, unless the total value of the items (each item's "value" in content.items x qty) is
   more than the new coin - then remove the most valuable item rows until it isn't, and list what you removed.
6. Quests with a "chain" keep their order: a later quest in a chain never pays less coin than the one before it (if the
   rule above would make it, raise it to the previous quest's coin, still inside its own rank's range).
7. An open quest (one with "open": true) has coinMin, coinMax, xpMin and xpMax instead; leave those alone unless they are
   outside the rank's ranges, and then bring them inside: the coin pair inside the rank's coin "reward" range, the xp pair
   inside the rank's "xp" range (or its coin "reward" range when the rank has no "xp").

Output the edited file in place, then a short table: quest slug | level | rank | old coin -> new coin | old xp -> new xp,
only for quests you changed, plus any item rows removed. Keep the JSON valid (2-space indent, final newline).
```

## Check

```
node check.mjs {{PACK_FILE}}
```

It must still print `OK`. Rewards outside the rank are not a checker error for fixed quests, so look at the table the
agent prints: it is the proof that the rewards moved.
