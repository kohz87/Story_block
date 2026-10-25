# E6b: active history and boundaries

Based on branch-point main c36b355d6616d91fe52a9d5995adfd17d6c69e06. The frozen signatures remain those of contract §8 and §2.

History uses the selected canonical sid **and swipeKey**. A return fades the whole target reply when its target is inside that reply, plus all messages through the restoring reply. Reader messages before the target reply remain active; reader messages after it fade. Raw chat is unchanged. All extraction, journal and native consumers must filter `messages` on `active`.

Cursor convention: the existing E6a cursor counts operations before the position. A nonzero op is inside a reply; op zero is the carrier boundary, excluding only later messages. The contract has no separate between-message cursor tag. No partial text slicing is attempted. An empty chat projects an empty history. `through` must identify the selected canonical pair.

Integration gap: SD/NSD out-of-band readers must consume this projection; this package cannot change those repositories' scanner/journal code. The host projection is tested with extraction, journal and native-reader filters.
