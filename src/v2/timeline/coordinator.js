// The timeline coordinator (contract §8; docs/v2/TIMELINE.md): save points, the restore protocol and the native
// participants' mutations, behind one host-local object, `sdk.timeline`.
//
// Everything that waits (a participant's checkpoint, a flush to the chat file) is a phase between two synchronous
// sections; each section changes the story (a block stored) and the journal (in the chat's metadata) together, so a
// crash between two phases leaves a state the next start reads whole: `recover()` finishes what was committed and
// aborts what was not. The journal is the only thing that decides.
//
//   make:     reserved -> checkpointed -> archived -> committed            (or discarded: the head moved; aborted: a crash)
//   restore:  preparing -> prepared -> committed -> acked -> complete      (or aborted before committed)
//   native:   prepared -> done                                             (or aborted before activation)
//
// Authority. Public callers (a button, a screen, a module through sdk.timeline) may make (a manual save), forget, list,
// read the status, the head and the history. Everything else (prepare, activate, abort, recover, nativeEvent,
// registerParticipant, a make of another kind) needs the host capability, an object only createTimeline's caller holds,
// or, for nativeMutation, the handle the host gave the participant when it registered it.

import { hashJson, isHash, isRecordId, sourceProblem } from '../replay.js';
import { createActiveHistory } from './active.js';
import { createArchive } from './archive.js';
import { createPrepare } from './coordinator-prepare.js';
import { createRead } from './coordinator-read.js';
import { createRestore } from './coordinator-restore.js';
import { HOST_DOMAIN } from './gate.js';
import { stateHash } from './host-block.js';
import { createParticipants } from './participants.js';
import { crashing, fail, isNotDurable, isObject, isStaleChat, makeId, notDurable, staleChat } from './util.js';

export { MANUAL_LIMIT } from './coordinator-prepare.js';
// The phases a journal entry ends in, by kind; any other is work to recover.
const ENDS = Object.freeze({ make: ['committed', 'discarded', 'aborted'], restore: ['complete', 'aborted', 'retracted'], 'native-mutation': ['done', 'aborted'], 'native-event': ['done', 'aborted'], selection: ['complete'] });
const settled = entry => (ENDS[entry.kind] ?? []).includes(entry.phase);

/**
 * createTimeline({ store, registry, metadata, chat?, barrier, announce?, query?, settings?, faults? }) →
 * { api, host, capability, attach(def), guard(view, info), available(hash), recover, makeCommand(payload), archive }.
 * * `metadata()`: the open chat's metadata object (the archive lives in it); `chat()`: its messages;
 * * `barrier(state, reason)`: raises or drops the host-wide restore barrier (registry.setRestore and the announcement);
 * * `announce(receipt)`: told of each block the host stores (the `committed` event);
 * * `query(name, args, state)`: a registered query over `state` (the clock, the atlas, the journal), or throws when there is none;
 * * `problem(entry)`: told of a Problem the host reader should see (faded messages that could not be hidden); `redraw(index, message)`: told when a
 *   message's hidden flag changed, so the page can draw it;
 * * `faults`: `{ at(phase) }`, awaited at every phase boundary (tests simulate a crash by throwing `crash()` there).
 */
export function createTimeline({ store, registry, metadata, chat = () => [], barrier = () => {}, announce = null, query = null, settings = () => ({}), faults = null, problem = null, redraw = null }) {
    // The timeline's state: one object, so the parts of the timeline can share it (`s.name`).
    const s = {
        // The chat the running operation began in (operations run one at a time): every write and every clean-up of it is bound to that
        // chat, and when another one is open it touches nothing there (`staleChat`, answered STALE).
        scope: null,
        capability: Object.freeze({ timeline: 'story-block' }),
        handles: new Map(),
        broken: new Map(),  // module -> why its participant declaration was not registered
        sessionId: null,
        busy: Promise.resolve(),
        running: new Map(),
        // In-memory state belongs to one chat. A block stored and not yet told is owed to the listeners once the chat file has it, and
        // carries the chat and the receipt it was stored with; the barrier this raised carries the chat it was raised for. On a change of
        // chat what belongs to another is dropped (`settle`), and before anything is told the chat and the receipt are looked at again.
        owed: [],  // [{ stored, holder, id }]
        barrierOwner: null,  // the chat whose restore or native change raised the barrier (null: not raised by the timeline)
        barrierEarly: false,  // raised by `settle` as the chat opened, before its recovery had its turn (not by a running operation)
        hideFailed: new WeakSet(),  // chats (by their holder) where a faded message could not be hidden or shown
        witnessHashes: new WeakMap(),
    };
    const archive = createArchive({ metadata, touch: () => store.touch?.(), bound: () => s.scope?.holder ?? null });
    const participants = createParticipants({ chat: () => archive.holder() });
    // (this run's id, made when first needed: a chat that never uses the timeline draws nothing from the random source)
    const session = () => (s.sessionId ??= makeId('ss'));
    // Operations started and not ended, by the chat they were made for: they own that chat's journal entries. A chat's work is its own.
    const runningIn = holder => s.running.get(holder) ?? 0;
    const bump = (holder, by) => { if (runningIn(holder) + by > 0) s.running.set(holder, runningIn(holder) + by); else s.running.delete(holder); };

    // ---- helpers -----------------------------------------------------------------------------------------

    // One thing at a time: a make, a prepare, an activate or a recover starts when the one before it has ended.
    // Work carries its chat from the moment it is made (`holder`, taken when it is queued, not when its turn comes): if another chat is
    // open when its turn comes, it is STALE and does not run. The queue is one line for the whole host, so two chats' work never
    // overlaps, but nothing in it is anonymous.
    const scoped = async (fn, holder) => {
        settle();
        if (archive.holder() !== holder) return fail('STALE', 'Another chat was opened before this was done; nothing was changed in the chat that is open now.');
        s.scope = { holder };
        try {
            const out = await fn();
            await reconcile();
            return out;
        } finally { s.scope = null; }
    };
    const exclusive = fn => {
        settle();
        const holder = archive.holder();
        bump(holder, 1);
        const run = s.busy.then(() => scoped(fn, holder), () => scoped(fn, holder));
        s.busy = run.then(() => {}, () => {});
        run.then(() => bump(holder, -1), () => bump(holder, -1));
        return run;
    };
    const guarded = async fn => {
        try { return await fn(); } catch (error) {
            if (crashing(error)) throw error;
            if (isNotDurable(error)) return fail('FAILED', error.message);
            if (isStaleChat(error)) {
                // The chat this began in is gone: what it owes is not told, and a barrier it raised does not hold the chat that is open.
                settle();
                return fail('STALE', error.message);
            }
            return fail('FAILED', `The timeline failed: ${error?.message ?? error}`);
        }
    };
    // Whatever waits (a phase boundary, a participant's answer) ends by looking at the chat again: the code after it reads and writes the
    // chat the operation began in, or does not run.
    const point = async phase => {
        if (faults && typeof faults.at === 'function') await faults.at(phase);
        here();
    };
    const callParticipant = async (module, name, input) => {
        const answer = await participants.call(module, name, input);
        here();
        return answer;
    };
    const stillHere = () => s.scope === null || archive.holder() === s.scope.holder;
    const here = () => { if (!stillHere()) throw staleChat(); };
    // The one way anything is made durable: the chat file has what the journal and the story say, or this throws (the caller's
    // failure; nothing after it runs, nothing is retried as if it had worked, nothing is announced). The blocks the host stored
    // are told only now, once the file has them. `context` opens the sentence the caller is given when the save fails.
    const durable = async (context = 'The chat could not be saved') => {
        here();
        try { await store.flush(); } catch (error) {
            if (crashing(error)) throw error;
            here();   // (a save that failed because the chat was left is the chat's change, not a failed save)
            throw notDurable(`${context}: ${error?.message ?? error}`);
        }
        here();
        // Told now, and only what is still this chat's and still in it (a reply deleted meanwhile took its receipt with it).
        const told = s.owed;
        s.owed = [];
        if (told.length) {
            const holder = archive.holder();
            let ids = null;
            try { ids = new Set(store.receipts().map(entry => entry.receipt.id)); } catch { ids = new Set(); }
            for (const each of told) if (each.holder === holder && ids.has(each.id)) each.stored.tell();
        }
    };
    // A clean-up after a failure that is not itself a durable step: the journal word it writes rides with the next save (a
    // restart reads the unsettled entry and does the same), so a save that fails here changes nothing about what is answered.
    const quietly = async fn => {
        try { await fn(); } catch (error) {
            if (crashing(error) || isStaleChat(error)) throw error;
            if (!isNotDurable(error)) throw error;
        }
    };
    const owe = stored => { s.owed.push({ stored, holder: archive.holder(), id: stored.receipt.id }); return stored; };
    // The host's restore barrier, raised or dropped only for the chat the operation is in, and remembered as that chat's.
    const raise = reason => { here(); s.barrierOwner = archive.holder(); s.barrierEarly = false; barrier('pending', reason); };
    const isHost = auth => auth === s.capability || auth?.capability === s.capability;
    // A change that is outstanding: a restore committed and not complete, a native change prepared and not done (`ignore`: the one being settled).
    const pendingEntry = (ignore = null) => archive.entries().find(entry => entry.id !== ignore && entry.kind === 'restore' && ['committed', 'participants-pending', 'acked'].includes(entry.phase))
        ?? archive.entries().find(entry => entry.id !== ignore && entry.kind === 'selection' && entry.phase !== 'complete')
        ?? archive.entries().find(entry => entry.id !== ignore && ['native-mutation', 'native-event'].includes(entry.kind) && entry.phase === 'prepared')
        ?? null;
    const pendingNow = () => {
        settle();
        return registry.restore?.().state === 'pending' || pendingEntry() !== null;
    };
    // A module that declared a participant the host could not register holds the timeline: a save or a restore without it would
    // leave its native state out of step with the story (fail closed).
    const brokenProblem = () => {
        const [module, why] = [...s.broken.entries()][0] ?? [];
        return module ? `the participant ${module} could not be registered (${why}), so its native state cannot be saved or restored` : '';
    };
    const pointsOf = state => (isObject(state?.domains?.[HOST_DOMAIN]?.points) ? state.domains[HOST_DOMAIN].points : {});

    // The clock, the scene and the journal day a descriptor shows.
    const ask = (name, args, state) => {
        if (typeof query !== 'function') return null;
        try { return query(name, args, state) ?? null; } catch { return null; }
    };
    // Story Block's own readers of earlier messages (the chatter queries, the module view, the late lines) ask this
    // (src/v2/timeline/active.js), by name; the capability counts the names. A generation request is not one of them: faded messages
    // leave it because they are hidden (below).
    const activeHistory = createActiveHistory({ faded: () => activeLine().at });

    // One selection rule for every head change. Prefix identity AND replayed state must match;
    // no revision, positional fallback or nearest-swipe rebinding is allowed.
    // The hash of a witness's state, worked out once per state object: the store hands out the same deep-frozen state while the chat is unchanged.
    function witnessStateHash(state) {
        if (!state || typeof state !== 'object' || !Object.isFrozen(state)) return stateHash(state);
        let hash = s.witnessHashes.get(state);
        if (hash === undefined) s.witnessHashes.set(state, hash = stateHash(state));
        return hash;
    }
    function selectionPlan(limit = null) {
        if (!archive.exists()) return {};
        return withWholePrefixes(() => (store.witnessScope ?? (read => read()))(() => {
            const result = { ...archive.baseline() };
            const through = limit ? store.prefixWitness(limit) : null;
            if (limit && !through) throw new Error('The marker root no longer has a unique prefix.');
            for (const module of participants.modules()) {
                const candidates = [];
                for (const mapping of archive.prefixes(module)) {
                    if (!mapping.boundary || !mapping.after) continue;
                    const witness = store.prefixWitness(mapping.boundary.cursor);
                    if (witness && (!through || witness.index < through.index || (witness.index === through.index && witness.op <= through.op)) && witness.prefixHash === mapping.boundary.prefixHash && witnessStateHash(witness.state) === mapping.boundary.stateHash) {
                        candidates.push({ mapping, index: witness.index, op: witness.op });
                    }
                }
                candidates.sort((a, b) => a.index - b.index || a.op - b.op || a.mapping.seq - b.mapping.seq);
                if (candidates.length) result[module] = candidates.at(-1).mapping.after;
            }
            return result;
        }));
    }
    function withWholePrefixes(fn) {
        const was = registry.restore();
        if (was.state !== 'pending') return fn();
        registry.setRestore('idle', '');
        try { store.lifecycleChanged?.(); return fn(); }
        finally { registry.setRestore(was.state, was.reason); store.lifecycleChanged?.(); }
    }
    const selectionNeeded = () => hashJson(selectionPlan()) !== hashJson(archive.selection());
    // The reading half (coordinator-read.js), wired once everything it calls is defined (`selectionNeeded` is the last const it needs).
    const { settle, release, reconcile, minuteOf, sceneOf, headNow, head, listNow, list, status, activeLine, syncHidden, history } = createRead(s, { store, registry, chat, barrier, problem, redraw, archive, participants, durable, here, ask, pointsOf, pendingEntry, pendingNow, raise, nativeSelectionProblem, selectionNeeded, selectHead, withWholePrefixes });
    // The making and preparing half (coordinator-prepare.js), wired once everything it calls is defined: `headNow`, `minuteOf` and `sceneOf` are the
    // reading half's (just above). `complete` is the restoring half's, wired next; `finish` calls it only when it runs, so it is given as a function.
    const { makeNow, forget, availability, abortEntry, prepare, finish } = createPrepare(s, { store, registry, settings, announce, archive, participants, ask, brokenProblem, callParticipant, complete: entry => complete(entry), durable, headNow, here, minuteOf, owe, pendingNow, point, pointsOf, quietly, sceneOf, selectionPlan, session, stillHere });
    // The restoring half (coordinator-restore.js), wired after the making and preparing half it calls.
    const { complete, activate, abort, recover, unmaterializedMarkers } = createRestore(s, { store, registry, announce, problem, archive, participants, abortEntry, availability, durable, finish, finishNative, finishSelection, headNow, here, makeNow, owe, pendingEntry, pendingNow, point, pointsOf, publishRestore, raise, release, selectionNeeded, session, stillHere, syncHidden, withWholePrefixes });

    // Owners may declare a native dependency through a synchronous, read-only hook. Check it only after
    // checkpoint selection, on the whole selected story, while the barrier still holds every public reader.
    function nativeSelectionProblem() {
        const events = Object.freeze(archive.entries().filter(entry => entry.kind === 'native-event' && entry.phase === 'done')
            .map(({ event, npc, participant }) => Object.freeze({ event, npc, participant })));
        if (!events.length) return null;
        return withWholePrefixes(() => {
            const state = store.head();
            for (const { moduleId, fn } of registry.hookEntries('nativeSelection')) {
                let answer;
                try { answer = fn({ state, query: (name, args) => ask(name, args, state) }, { events }); }
                catch { answer = null; }
                if (typeof answer?.then === 'function') { Promise.resolve(answer).catch(() => {}); answer = null; }
                if (answer?.ok === true) continue;
                return typeof answer?.reason === 'string' && answer.reason ? answer.reason
                    : `The records needed by ${moduleId} could not follow the selected story. Restore a save point from before the change, or put the changed reply back.`;
            }
            return null;
        });
    }

    async function selectHead() {
        if (!selectionNeeded()) return { ok: true };
        const desired = selectionPlan();
        if (availability(Object.values(desired))) { raise('The selected story needs records that are unavailable. Restore a save point from before the change, or put the changed reply back.'); return fail('SNAPSHOT_UNAVAILABLE', 'The participants needed by this head are unavailable.'); }
        const entry = archive.add({ id: makeId('hs'), kind: 'selection', phase: 'prepared', desired, slots: {} });
        raise('The selected story is waiting for its records. If this continues, restore a save point from before the change, or put the changed reply back.');
        await durable();
        return finishSelection(entry);
    }

    async function finishSelection(entry) {
        raise('The selected story is waiting for its records. If this continues, restore a save point from before the change, or put the changed reply back.');
        await durable();
        for (const [module, target] of Object.entries(entry.desired)) {
            const registered = participants.get(module);
            if (!registered || registered.schema !== target.schema) return fail('SNAPSHOT_UNAVAILABLE', `The participant ${module} is unavailable for the selected head.`);
            let slot = archive.get(entry.id).slots[module];
            if (!slot) {
                const prepared = await callParticipant(module, 'prepare', { return: entry.id, checkpoint: target.checkpoint, hash: target.hash });
                if (!prepared.ok) return prepared;
                if (prepared.hash !== target.hash) return fail('CONFLICT', 'The participant prepared other selected bytes.');
                slot = { prepared: prepared.prepared, ack: false };
                archive.patch(entry.id, { slots: { ...archive.get(entry.id).slots, [module]: slot } });
                await durable();
            }
            if (!slot.ack) {
                const done = await callParticipant(module, 'activate', { return: entry.id, prepared: slot.prepared });
                if (!done.ok) return done;
                if (done.checkpoint !== target.checkpoint || done.hash !== target.hash) return fail('CONFLICT', 'The participant selected other bytes.');
                archive.patch(entry.id, { slots: { ...archive.get(entry.id).slots, [module]: { ...slot, ack: true } } });
                await durable();
            }
        }
        // A head may move during any callback: settle this durable selection, then plan again.
        archive.select(entry.desired);
        archive.patch(entry.id, { phase: 'complete' });
        await durable();
        return { ok: true };
    }

    // ---- native mutations and events ---------------------------------------------------------------------

    const prefixKey = (cursor, prefixHash) => [archive.lineage(), cursor.sid, cursor.swipeKey, cursor.block, cursor.op, prefixHash].join('|');

    function publish(entry) {
        const key = prefixKey(entry.boundary.cursor, entry.boundary.prefixHash);
        const seq = archive.bumpNative();
        archive.putPrefix(entry.participant, key, {
            seq, participant: entry.participant, tx: entry.id, source: entry.source ?? null, schema: entry.after.schema,
            before: entry.before, after: entry.after, selected: 'after', boundary: entry.boundary,
        });
        archive.remember([entry.before]);
        archive.select({ ...archive.selection(), [entry.participant]: entry.after });
        archive.patch(entry.id, { phase: 'done' });
    }

    // After a restore every participant's selected checkpoint is the one it acknowledged, for the prefix the story now ends at.
    function publishRestore(entry) {
        const now = headNow();
        if (!now) return;
        const key = prefixKey(now.cursor, now.prefixHash);
        const beforeKey = prefixKey(entry.boundary.cursor, entry.boundary.prefixHash);
        archive.remember(entry.before);
        for (const item of entry.before) archive.putPrefix(item.module, beforeKey, {
            seq: archive.bumpNative(), participant: item.module, tx: entry.id, schema: item.schema,
            before: null, after: item, selected: 'after', boundary: entry.boundary,
        });
        let moved = false;
        for (const [module, slot] of Object.entries(entry.participants ?? {})) {
            if (!slot.ack || archive.prefix(module, key)?.tx === entry.id) continue;
            archive.putPrefix(module, key, {
                seq: archive.bumpNative(), participant: module, tx: entry.id, source: null, schema: slot.schema, before: null,
                after: { module, checkpoint: slot.ack.checkpoint, hash: slot.ack.hash, schema: slot.schema }, selected: 'after', boundary: { cursor: now.cursor, prefixHash: now.prefixHash, stateHash: stateHash(now.state) },
            });
            moved = true;
        }
        if (moved) archive.select(Object.fromEntries(Object.entries(entry.participants).map(([module, slot]) => [module, { module, checkpoint: slot.ack.checkpoint, hash: slot.ack.hash, schema: slot.schema }])));
    }

    // The activation of a native entry, or its recovery after a crash: whatever the participant's own status says it did.
    // A mutation names the checkpoint it will switch to (`after`); an event learns it from the participant's ack.
    async function finishNative(entry) {
        const module = entry.participant;
        // The journal is in the chat file before the participant is asked to change anything: a change with no journal behind it
        // is one no restart could finish or undo (this is also what a retry after a failed save does first).
        await durable();
        const asked = await callParticipant(module, 'status', { return: entry.id });
        let answer = null;
        if (asked.ok && asked.status === 'active') answer = asked;
        else if (asked.ok && asked.status === 'aborted') {
            archive.patch(entry.id, { why: `the participant ${module} reports it aborted` });
            return fail('CONFLICT', `The participant ${module} aborted a change the journal committed; it is held until it is reconciled.`);
        }
        if (!answer) {
            const done = entry.kind === 'native-event'
                ? await callParticipant(module, 'applyEvent', { event: entry.event, nativeKey: entry.nativeKey, kind: entry.eventKind })
                : await callParticipant(module, 'activate', { return: entry.id, prepared: entry.preparedId });
            // (`unprepared`: the participant has nothing prepared under that id, which `recover` may let go for a native mutation)
            if (!done.ok) return done.code === 'NOT_FOUND' && entry.kind === 'native-mutation' ? { ...done, unprepared: true } : done;
            if (entry.kind === 'native-event' && done.event !== entry.event) return fail('CONFLICT', 'The participant acknowledged another event.');
            answer = done;
        }
        let settled = entry;
        if (!entry.after) settled = archive.patch(entry.id, { after: { module, checkpoint: answer.checkpoint, hash: answer.hash, schema: entry.before.schema } });
        else if (answer.checkpoint !== entry.after.checkpoint || answer.hash !== entry.after.hash) {
            return fail('CONFLICT', `The participant ${module} answered other bytes than the change prepared.`);
        }
        publish(settled);
        // Told done only when the file has it; a failed save is the caller's failure (a retry of the same event answers once it is saved).
        // The barrier comes down in `release`, once the participants stand on the selected head: the reply this change stood on may be
        // gone by now. (A selection that cannot be confirmed yet leaves the barrier up for a recovery; the change itself is done.)
        await release(settled.id);
        return { ok: true, checkpoint: settled.after.checkpoint, hash: settled.after.hash };
    }

    const participantShape = (item, module) => isObject(item) && item.module === module && typeof item.checkpoint === 'string' && item.checkpoint && isHash(item.hash) && Number.isInteger(item.schema) && item.schema >= 0;

    async function nativeMutation(input, who) {
        if (!isObject(input) || Object.keys(input).some(key => !['participant', 'source', 'expectedHead', 'prepare'].includes(key))) return fail('INVALID', 'nativeMutation takes { participant, source, expectedHead, prepare }.');
        if (typeof input.participant !== 'string' || input.participant !== who) return fail('REFUSED', 'Only the registered participant makes its own native mutations.');
        if (!participants.has(who)) return fail('NOT_FOUND', `The participant ${who} is not registered.`);
        const why = sourceProblem(input.source);
        if (why) return fail('INVALID', `source: ${why}.`);
        if (!isHash(input.expectedHead)) return fail('INVALID', 'expectedHead is the head hash.');
        if (typeof input.prepare !== 'function') return fail('INVALID', 'prepare is a function.');
        if (pendingNow()) return fail('RESTORE_PENDING', 'A restore is in progress.');
        const first = headNow();
        if (!first) return fail('NOT_FOUND', 'There is no story state.');
        if (first.headHash !== input.expectedHead) return fail('STALE', 'The head moved since it was read; the change was not made.');
        if (input.source.sid !== first.cursor.sid || input.source.swipeKey !== first.cursor.swipeKey) return fail('STALE', 'That source is not the reply at the head.');
        // The participant makes both checkpoints durable on its side and gives back what it made, without showing the new state.
        let made;
        try { made = await participants.run(who, () => input.prepare());
            here(); } catch (error) {
            if (crashing(error)) throw error;
            if (isStaleChat(error)) throw error;
            return fail('FAILED', `The participant ${who} could not prepare its change: ${error?.message ?? error}`);
        }
        if (!isObject(made) || !participantShape(made.before, who) || !participantShape(made.after, who) || typeof made.prepared !== 'string' || !made.prepared) {
            return fail('INVALID', 'prepare gives { before, after, prepared }, both checkpoints whole.');
        }
        await point('native.prepared');
        const tx = makeId('nm');
        // The chat, the head and the participant are looked at again, and the journal follows with nothing awaited between.
        const same = stillHere();
        const again = same ? headNow() : null;
        const registered = participants.get(who);
        if (!same || !again || again.headHash !== first.headHash || !registered || registered.schema !== made.before.schema || registered.schema !== made.after.schema) {
            await callParticipant(who, 'abort', { return: tx, prepared: made.prepared });
            here();
            if (!registered || registered.schema !== made.before.schema || registered.schema !== made.after.schema) return fail('SNAPSHOT_UNAVAILABLE', `The participant ${who} is not registered at the schema of the change.`);
            return fail('STALE', 'The head moved while the change was prepared; it was cancelled before it was shown.');
        }
        archive.add({ id: tx, kind: 'native-mutation', phase: 'prepared', session: session(), participant: who, source: structuredClone(input.source), expectedHead: first.headHash,
            before: structuredClone(made.before), after: structuredClone(made.after), preparedId: made.prepared, boundary: { cursor: structuredClone(first.cursor), prefixHash: first.prefixHash, stateHash: stateHash(first.state) } });
        raise('A native change is finishing; every part must agree before the story goes on.');
        await durable();
        await point('native.journaled');
        return finishNative(archive.get(tx));
    }

    async function nativeEvent(input) {
        if (!isObject(input) || Object.keys(input).some(key => !['event', 'participant', 'kind', 'npc', 'expectedHead'].includes(key))) return fail('INVALID', 'nativeEvent takes { event, participant, kind, npc, expectedHead }.');
        if (typeof input.event !== 'string' || !input.event || typeof input.participant !== 'string' || !isRecordId(input.npc) || !isHash(input.expectedHead)) return fail('INVALID', 'nativeEvent names the event, the participant, the npc and the head.');
        if (input.kind !== 'confirmed-death') return fail('INVALID', 'The only native event is a confirmed-death.');
        // The same event again with the same meaning is answered from the journal; another meaning is a CONFLICT.
        const prior = archive.event(input.event);
        if (prior) {
            if (prior.participant === input.participant && prior.npc === input.npc && prior.kind === input.kind) {
                const entry = archive.get(prior.tx);
                if (entry?.phase === 'done') {
                    await durable();   // (a delivery whose save failed is not acknowledged until the file has it)
                    return { ok: true, event: input.event, checkpoint: entry.after.checkpoint, hash: entry.after.hash, ack: true };
                }
                if (entry?.phase === 'prepared') {
                    raise('A native change is finishing; every part must agree before the story goes on.');
                    const done = await finishNative(entry);
                    return done.ok ? { ok: true, event: input.event, checkpoint: done.checkpoint, hash: done.hash, ack: true } : done;
                }
            }
            return fail('CONFLICT', 'That event was delivered already with another meaning.');
        }
        const target = participants.get(input.participant);
        if (!target || typeof target.applyEvent !== 'function') return fail('REFUSED', `The participant ${input.participant} takes no native events.`);
        if (pendingNow()) return fail('RESTORE_PENDING', 'A restore is in progress.');
        const first = headNow();
        if (!first) return fail('NOT_FOUND', 'There is no story state.');
        if (first.headHash !== input.expectedHead) return fail('STALE', 'The head moved since it was read; the event was not delivered.');
        // The native identity: an np_ id is resolved by the participant's own query; one it does not know holds the death.
        // The query must be the participant's own: another module's answer to "who is this npc" is not the participant's word.
        if (registry.queryOwner?.('npc.identity') !== input.participant) return fail('REFUSED', `The participant ${input.participant} does not own npc.identity, so it cannot take a death by an npc id.`);
        const identity = ask('npc.identity', { id: input.npc }, first.state);
        if (!isObject(identity) || identity.id !== input.npc || typeof identity.nativeKey !== 'string' || !identity.nativeKey) {
            return fail('REFUSED', 'The native target of that death is unknown, so the death is held rather than guessed.');
        }
        // The participant gives back the checkpoint before and after, durable on its side.
        const before = await callParticipant(input.participant, 'checkpoint', { cursor: first.cursor, headHash: first.headHash });
        if (!before.ok) return before;
        // The head, its source, the chat and the participant are looked at again after the wait; the journal follows with nothing awaited between.
        here();
        const again = headNow();
        if (!again || again.headHash !== first.headHash) return fail('STALE', 'The head moved while the participant made its checkpoint; the event was not delivered.');
        const registered = participants.get(input.participant);
        if (!registered || before.schema !== registered.schema) return fail('SNAPSHOT_UNAVAILABLE', `The participant ${input.participant} saved another checkpoint schema than it registered.`);
        const tx = makeId('nm');
        archive.putEvent(input.event, { participant: input.participant, npc: input.npc, kind: input.kind, nativeKey: identity.nativeKey, tx });
        archive.add({ id: tx, kind: 'native-event', phase: 'prepared', session: session(), participant: input.participant, event: input.event, eventKind: input.kind, nativeKey: identity.nativeKey, npc: input.npc,
            expectedHead: first.headHash, before: { module: input.participant, checkpoint: before.checkpoint, hash: before.hash, schema: before.schema }, after: null,
            boundary: { cursor: structuredClone(first.cursor), prefixHash: first.prefixHash, stateHash: stateHash(first.state) } });
        raise('A native change is finishing; every part must agree before the story goes on.');
        await durable();
        await point('native.journaled');
        const done = await finishNative(archive.get(tx));
        return done.ok ? { ok: true, event: input.event, checkpoint: done.checkpoint, hash: done.hash, ack: true } : done;
    }

    // ---- registration ------------------------------------------------------------------------------------------

    function register(spec) {
        return participants.register(spec);
    }

    // The host registers a module's participant when it registers the module: `def.participant` is
    // { schema, checkpoint, prepare, activate, abort, status, applyEvent?, attach? }. `attach(handle)` is given the
    // module's own handle (`head()` and `nativeMutation(input)`), the only way a module reaches nativeMutation.
    function attach(def) {
        if (def?.participant === undefined || s.handles.has(def.id) || s.broken.has(def.id)) return null;
        // The identity is the registering module's, whatever the declaration says: a declaration that names another module is refused.
        let done;
        if (!isObject(def.participant)) done = fail('INVALID', `The participant of ${def.id} is not a record.`);
        else if (def.participant.module !== undefined && def.participant.module !== def.id) done = fail('INVALID', `The participant of ${def.id} names another module (${String(def.participant.module)}).`);
        else done = register({ ...def.participant, module: def.id });
        if (!done.ok) {
            s.broken.set(def.id, done.message);
            return done;
        }
        const handle = Object.freeze({
            head: () => head(),
            nativeMutation: input => exclusive(() => guarded(() => nativeMutation(input, def.id))),
        });
        s.handles.set(def.id, handle);
        if (typeof def.participant.attach === 'function') {
            try { def.participant.attach(handle); } catch (error) { console.warn(`[Story Suite] ${def.id}'s participant could not take its handle`, error); }
        }
        return done;
    }

    // ---- the guard of the host's own blocks --------------------------------------------------------------

    /** The host's `hooks.replayGuard`: its blocks are asked again on the story before them (host-block.js). */
    function guard({ state }, { guard: asked }) {
        const predicate = asked?.predicate;
        if (!isObject(predicate)) return { ok: false, reason: 'its guard names no predicate' };
        if (asked.inputHash !== hashJson({ predicate, stateHash: stateHash(state) })) return { ok: false, reason: 'the story before it is not the story it was made on' };
        switch (predicate.kind) {
            case 'make': return !predicate.marker || state?.meta?.proofs?.[predicate.marker.proof] === predicate.marker.pin ? { ok: true } : { ok: false, reason: 'the clock marker no longer belongs to the active prefix' };
            // (a restore carries what it installs in its own changes: replaying it needs no archive)
            case 'restore': return { ok: true };
            case 'forget':
                return isObject(pointsOf(state)[predicate.snapshot]) ? { ok: true } : { ok: false, reason: 'the save point it forgets is not there' };
            case 'complete':
                return state?.domains?.[HOST_DOMAIN]?.returns?.[predicate.return]?.status === 'committed' ? { ok: true } : { ok: false, reason: 'the return it completes is not committed' };
            default: return { ok: false, reason: `it names a predicate (${predicate.kind}) that this host does not know` };
        }
    }

    // Synchronous §2 capability projection. Reading it creates no archive or participant checkpoint.
    // Installed NSD needs its native participant even when its optional UI/social features are off.
    function contract() {
        const snapshots = archive.holder() !== null && store.readOnly?.() == null;
        const declarations = registry.modules().filter(def => def.participant !== undefined || def.id === 'npc-state-delta');
        const installed = declarations.every(def => participants.has(def.id) && !s.broken.has(def.id));
        const oldWitnesses = archive.entries().some(entry => entry.kind === 'restore' && entry.phase !== 'aborted' && !entry.boundary);
        const participantsReady = installed && participants.ready() && !brokenProblem() && !oldWitnesses && registry.restore?.().state !== 'pending' && !selectionNeeded() && !nativeSelectionProblem();
        // (a restore fades earlier messages: retained-chat restore is offered only while Story Block's own readers of earlier messages filter
        // them, and not for a chat where a faded message could not be hidden)
        const retainedChatRestore = snapshots && unmaterializedMarkers().length === 0 && activeHistory.wired() && !s.hideFailed.has(archive.holder());
        return { api: 2, snapshots, retainedChatRestore, participantsReady };
    }

    // ---- the public adapter of savepoint.make ------------------------------------------------------------

    /** sdk.command('savepoint.make', payload): the receipt envelope of §3, after the checkpoints and the head check. */
    function makeCommand(payload) {
        if (!isObject(payload) || Object.keys(payload).some(key => key !== 'name')) return Promise.resolve(fail('INVALID', 'savepoint.make takes { name? } and nothing else.'));
        return exclusive(() => guarded(async () => {
            const made = await makeNow({ kind: 'manual', ...(payload.name !== undefined ? { name: payload.name } : {}) }, { host: false, cause: 'ui' });
            return made.ok ? { ok: true, receipt: made.receipt } : made;
        }));
    }

    // ---- the API -----------------------------------------------------------------------------------------------

    const needsHost = (auth, what) => (isHost(auth) ? null : fail('REFUSED', `${what} needs the host's authority; a caller cannot supply it.`));
    const strip = result => {
        if (!result.ok) return result;
        const { receipt, ...rest } = result;
        void receipt;
        return rest;
    };

    const api = {
        head: () => head(),
        make: (input, auth) => exclusive(() => guarded(async () => strip(await makeNow(input, { host: isHost(auth), cause: isHost(auth) ? 'system' : 'ui' })))),
        list: () => list(),
        status: () => status(),
        history: input => history(input),
        forget: input => exclusive(() => guarded(() => forget(input))),
        registerParticipant: async (spec, auth) => needsHost(auth, 'registerParticipant') ?? register(spec),
        prepare: async (input, auth) => needsHost(auth, 'prepare') ?? exclusive(() => guarded(() => prepare(input))),
        activate: async (input, auth) => needsHost(auth, 'activate') ?? exclusive(() => guarded(() => activate(input))),
        abort: async (input, auth) => needsHost(auth, 'abort') ?? exclusive(() => guarded(() => abort(input))),
        recover: async (input, auth) => needsHost(auth, 'recover')
            ?? (isObject(input) && Object.keys(input).length === 0 ? exclusive(() => guarded(() => recover())) : fail('INVALID', 'recover takes {}.')),
        nativeEvent: async (input, auth) => needsHost(auth, 'nativeEvent') ?? exclusive(() => guarded(() => nativeEvent(input))),
        nativeMutation: async () => fail('REFUSED', 'Only the registered participant makes native mutations, through the handle the host gave it when it registered.'),
    };
    // The same, with the host's authority already given (what the runtime and its host code use).
    const host = Object.freeze({
        make: input => api.make(input, s.capability),
        registerParticipant: spec => api.registerParticipant(spec, s.capability),
        prepare: input => api.prepare(input, s.capability),
        activate: input => api.activate(input, s.capability),
        abort: input => api.abort(input, s.capability),
        recover: () => api.recover({}, s.capability),
        nativeEvent: input => api.nativeEvent(input, s.capability),
        /** The batch result pinned with a restore, → { id, hash, bytes (the sealed result as its owner gave it), resolvedBy, return, prepared, deathEvents, manifestHash, preRestore: { payload, proofs } | null, aborted } | null. */
        pin(id) {
            const pin = archive.pin(id);
            if (!pin) return null;
            const kept = archive.payload(pin.preRestore);
            return structuredClone({ ...pin, preRestore: kept ? { payload: kept.payload, proofs: kept.proofs } : null });
        },
        /** The journal's entries, oldest first (read only). */
        journal: () => structuredClone(archive.entries()),
        /** The participant prefix map entry for a participant and the cursor and prefix hash of a head, or null. */
        prefix: (participant, cursor, prefixHash) => structuredClone(archive.prefix(participant, prefixKey(cursor, prefixHash))),
        participants: () => participants.modules(),
    });

    return Object.freeze({
        api: Object.freeze(api),
        host,
        capability: s.capability,
        attach,
        guard,
        makeCommand,
        recover: () => exclusive(() => guarded(() => recover())),
        /** A chat was opened: what belongs to the one before it is dropped (the host calls it before it recovers). */
        settle,
        available: hash => archive.hasPayload(hash),
        /** Internal turn hint: unchanged roots must keep Sources once native checkpoints depend on their prefixes. */
        hasNativeChanges: () => archive.entries().some(entry => ['native-event', 'native-mutation'].includes(entry.kind)),
        /** Whether the journal holds work no operation owns (a crashed make, a restore left half way): the host recovers it. */
        needsRecovery: () => runningIn(archive.holder()) === 0 && ((archive.exists() && (archive.entries().some(entry => !settled(entry)) || selectionNeeded())) || unmaterializedMarkers().length > 0
            || (s.barrierOwner !== null && s.barrierOwner === archive.holder())),
        archive,
        /** The active-history reader one of Story Block's own readers of earlier messages asks for by name (active.js ACTIVE_READERS): → { messages, faded }. */
        active: name => activeHistory.reader(name),
        pending: pendingNow,
        /** Points of `state` with their bytes checked, in target order (the savepoint.list query). */
        points: state => listNow(state),
        contract,
    });
}
