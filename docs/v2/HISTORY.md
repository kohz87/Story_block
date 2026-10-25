# Active history and clock boundaries (E6b)

Parts 1 and 2 implement the retained-chat history and native head barrier. `sdk.timeline.history({through?})`
returns the frozen §8 shape. A restore whose target is inside a reply fades that entire reply, through the
restore carrier, including intervening reader messages. Raw chat stays readable. Prompt/extraction/journal/native
consumers must use the active projection; this host package cannot migrate consumers in other repositories.

One rule says which messages are faded (`activeLine` in the coordinator, the same one `history` answers from) and one
filter applies it (`src/v2/timeline/active.js`, asked for by name through `timeline.active(name)`): the chat-completion
request and the text-completion request (a faded reply's or reader message's text is cut from the request, matched from
the newest message back, so an older message with the same words is never mistaken for a newer one), the Inner chatter
tail line, the last reader message a module's view shows, and the late safety-net lines of the previous reply. The
capability reports `retainedChatRestore: true` only while every named reader (`ACTIVE_READERS`) has been wired. A
request whose text a front end changed beyond a speaker prefix cannot be matched and keeps the message: the host cannot
see what it cannot find.

Every head change runs one participant selection rule over exact surviving prefix witnesses and replayed state.
Until native participants acknowledge that selection the host returns `RESTORE_PENDING`. It settles before heads,
mutable commands, scanning or generation are exposed; checkpoint recovery and full replay must agree.

The barrier comes down, and the modules are announced ready, in one place (`lowerWhenSettled`), reached only through
`release`: the head's checkpoints are reconciled to a fixed point (bounded; each pass plans again), what was published
is made durable, and the final look (nothing outstanding in the journal, no selection needed) lowers the barrier in
the same synchronous step. A change that finishes after its reply was swiped or deleted, a restore taken back while
its participants switch, and a head change met while an operation runs all end this way. A participant is recorded as
standing on a restore's checkpoint as it acknowledges, and a restore is published for the head (its checkpoint bound
to the head's prefix) only if the story read whole still holds it in the same synchronous section; else it is
retracted, `activate` answers `STALE`, and the participants follow the selected head with the barrier up until they
confirm. A failed final save leaves the barrier up (`recover` or the retry finishes it).

`ctx.clockBoundary({minute,source}) -> {cursor,prefixHash}` is synchronous. Only Story Director's existing
`capture.time`, `director.seed`, `time.settle` and `director.advance` handlers, under story/system cause, may call it.
The source must be the root's actual Source. Emit each successive midnight while the transaction's draft clock
is exactly there, after expiry settlement. An unset initial clock creates no earlier day. No native I/O runs here.

The marker captures all current drafts, claims, proof pins, registered-domain versions and effective rule settings.
Thus a paid training session already staged at midnight is captured running/paid, before subsequent completion.
A prefix-only host check rejects markers on a changed root input, even if the owner guard only checks time.
The root stores `clockBoundaries` only on successful commit. Its event proofs use E5's allocator; marker cursor
identity derives from the root cursor returned by ctx-seams and the captured logical state/minute, with no second occurrence allocator.
Its cursor's op is a logical offset within the root, not an offset into the final domain-sorted diff. It is suitable
for history exclusion and target ordering; `store.prefixWitness` continues to describe physical block boundaries.

The async coordinator materializes day-start descriptors from committed markers, through the same durable make
path as other saves. It uses native prefix mappings at the root boundary, never a later native mutation. Where no
mapping exists it asks for a checkpoint and probes that live checkpoint again at commit. Historical selections
are checked again at commit. Publication is deferred until recovery/turn completion; an unpublished marker is not
an eligible snapshot. A failed root/guard publishes none. Re-read regenerates markers from the saved seed; a
changed capture gets a new marker identity and proof; old dependents retire. Reusing an already-published marker identity with different bytes fails `CONFLICT`.
The ordinary E5 limit of 32 proofs per root bounds a single advance's marker count (other root proofs count too).

Compatibility is checked against saved bytes from main: `c36b355` (the original branch point) for legacy chat and
reload of an old guarded chat, and `fa1853d` (the required merge) for newly-created guarded chat. The merged
ctx-seams work adds occurrences and changes IDs for newly-created guarded blocks; E6b adds no further bytes to
chats that never use the timeline. The fixtures exercise Continue, Re-read and swipe back.

Contract gaps and owner follow-ups:

- SD must emit markers and settle expiry at each boundary; this package supplies the host seam, not SD changes.
- NSD must journal every native mutation through its handle and retain immutable historical bytes. A module that
  changes native state outside that protocol violates the checkpoint guarantee.
- Consumers outside this repo must adopt active history for prompts, extraction, journal facts and native scanning.
- The frozen contract supplies no public RB activation-registration callback. RB owns its public query probes.
- Memory `none`/`full` and automatic death-target choice remain owner integration work; E6a's limitations apply.

`savepoint.contract({}) -> {api:2,snapshots,retainedChatRestore,participantsReady}` is a synchronous, read-only
capability projection. It creates no archive or checkpoint. A missing timeline or read-only store reports no snapshot
support; committed clock markers awaiting publication report retained-chat restore unavailable. Every installed native
participant must register successfully (NSD even with optional features off); callbacks in flight, unresolved selection,
restore barriers, and old restore journals lacking native prefix witnesses report participants not ready. The independent
modules remain usable when a capability is false. The RB bootstrap must reject a missing, thrown, null, malformed,
wrong-version or false capability answer as DEPENDENCY_UNAVAILABLE; its public query probe is tested as a consumer
fixture because the available real RB checkout has not yet implemented that bootstrap migration.

Callback bound: 10 seconds, already introduced with part 2, now applied through one runner to all registered
callbacks and nativeMutation.prepare alike. A timeout returns a failure and releases the host queue. That
participant's same-chat slot remains quarantined until the actual callback settles, preventing a late activation
from racing another selection. In-flight slots belong to their original metadata holder; late cleanup cannot
clear a different chat's slot. A committed restore stays barred on failure; a precommit preparation publishes no
journal/state. Callback cancellation is not a frozen participant method; owners must bind native work to its chat.

Retention decision: retain payloads older than the day before the newest, and old pre-restore pins, while retained
history can still select them. No deletion by calendar age is introduced. An earlier swipe can select an earlier day;
a manual/initial snapshot can retain an older anchor; old return records must still resolve their sealed batch and
pre-restore evidence. Safe reclamation therefore needs reachability across hidden swipes, immutable snapshot
payloads and native checkpoints, plus an owner checkpoint-release protocol (not supplied by the frozen contract).
That is not a small archive edit. Age-based pruning and unreferenced-cache collection remain an explicit performance
follow-up; tests assert older bytes/pins remain readable. This decision trades archive growth for replay consistency.
