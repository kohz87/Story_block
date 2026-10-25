# E6b: active history and boundaries

Based on branch-point main c36b355d6616d91fe52a9d5995adfd17d6c69e06. The frozen signatures remain those of contract §8 and §2.

History uses the selected canonical sid **and swipeKey**. A return fades the whole target reply when its target is inside that reply, plus all messages through the restoring reply. Reader messages before the target reply remain active; reader messages after it fade. Raw chat is unchanged. All extraction, journal and native consumers must filter `messages` on `active`.

Cursor convention: the existing E6a cursor counts operations before the position. A nonzero op is inside a reply; op zero is the carrier boundary, excluding only later messages. The contract has no separate between-message cursor tag. No partial text slicing is attempted. An empty chat projects an empty history. `through` must identify the selected canonical pair.

Integration gap: SD/NSD out-of-band readers must consume this projection; this package cannot change those repositories' scanner/journal code. The host projection is tested with extraction, journal and native-reader filters.

Participant selection uses one rule (`selectionPlan`): select the last surviving prefix with the exact canonical pair, operation boundary, prefix hash and replayed state hash; otherwise use the first known native baseline. Changed or ambiguous prefixes are retired, never rebound by position/revision. A restore checkpoints the native state it replaces before preparation. Its surviving before-prefix and committed after-prefix both enter the map. Deleting a dependency invalidates the whole witness, including the checkpoint it justified.

Selections use the existing prepare/activate callbacks with a host-assigned `hs_` return identity. The selected checkpoints and every acknowledgment are journaled through `durable()`. A moving head is replanned to a fixed point with a 32-pass bound. Opening a chat, selecting a swipe, deleting a reply and Re-read settle before publishing the new head; a pending selection holds generation, commands, queries and scans. No native inverse changes are used. Status now reports the baseline checkpoint even before the first native change.

Every async participant callback has a 10-second bound, including native mutation preparation. A timed-out registered callback is quarantined until its promise settles; callbacks cannot be cancelled by the frozen interface. A failed activation retains the barrier. A hung callback releases the host queue so other chats can recover. Owners must bind their own native I/O to their chat, as required by the participant contract. An already-running native callback cannot be cancelled on chat switch by this interface.

Old E6a archives without prefix witnesses cannot safely reconstruct arbitrary native ancestry. They retain their existing data; downstream release must require fresh participant-coordinated timelines. No checkpoint is inferred from an old numeric revision.
