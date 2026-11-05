// Story Suite v2: the state store (SPEC §2, §12). State lives in carriers; this module replays it.
//
// * State at carrier N = the latest checkpoint at or before N, then every carrier's `ops` from there
//   through N. Head state = state at the last carrier. Rebuilding replays stored ops only; it never runs a
//   command handler.
// * A carrier that gets its first record also gets a checkpoint (the state before its own ops) when 100
//   carriers have passed since the last checkpoint, or the ops since then exceed 128 KB of JSON. Older
//   chats have them every 20 carriers / 32 KB: a checkpoint is read wherever it is.
// * Writes go to the head carrier (actions after reply N belong to reply N, so swiping or deleting reply N
//   takes them back) and only ever touch `extra.storySuite` and the matching `swipe_info` extra.
// * Each record is kept once (persist.js): the shown swipe's copy in `swipe_info` only on the last
//   carrier and on carriers with more than one swipe. When a reply gets its first record, the carrier
//   before it drops that copy, and the carrier `receiptKeep` back drops its receipts' `data`; a rebuild
//   does the same over the whole chat (so an older chat shrinks with its next save) and gives the last
//   carrier its copy back. Neither changes any state: replay reads `message.extra` only.
// * Told and untold (§4.1 step 2): a receipt is told once a carrier at or after its own lists its ID in
//   `narrated`. Untold receipts are the `narrate: true` ones that no such carrier lists, oldest first. "At
//   or after" rather than "after" so a cue committed on the head carrier while it is being re-generated
//   (a swipe) counts as told by that same carrier.
// * Replay goes block by block (`spans`: one block per stored receipt, one for a Re-read's story changes):
//   a block that no longer applies (a middle reply deleted, a hand-edited chat) is skipped and reported
//   alone; its receipts' revs still count. Everything stored before and after it still applies, so a
//   command committed onto such a carrier survives the next rebuild, and so does its claim.
// * Guarded blocks (docs/v2/REPLAY.md, contract §6): a block a module attached a guard to (ctx.replayGuard)
//   has a span with more than `{ n, story }`: its id, module, source, guard, claims, boundaries, operation,
//   recorded inputs, result and replan. On replay such a block is applied only when its source still
//   matches its carrier, its claims are the ones its ops make and the owner's `hooks.replayGuard` says
//   yes on the state before it; then its ops and its claims go in together, else neither (it stays stored
//   and inactive, REPLAY_PREREQUISITE). A span without an `id` is a legacy block and replays as before.
// * Proof (docs/v2/EVIDENCE.md, contract §6): a block that gives proof keeps it on its span (`evidence`) and pins
//   it in `meta.proofs` with the same ops; the span must hold exactly the proof its ops pin, or it is not
//   applied. `store.proofs()` lists the stored proof of the chat in source order; which of it is active is what
//   the state pins (evidence.js), so a skipped block, a deleted reply or another swipe publishes nothing.
// * The carrier source map (`record.source`, contract §4): each record carries the canonical pair of its
//   logical message and swipe, worked out from its stored `sid` and persisted with it.
// * Every state handed out is deep-frozen. The head and the checkpoints are cached; the cache is checked
//   against the chat on each read, and `rebuild()` drops it.

import { apply as applyOps } from './ops.js';
import {
    KEY, RECEIPT_KEEP, carrierIndexes, carryRecord, createSaver, dropCopy, isCarrier, lastCarrier, newRecordId,
    readRecord, swipeOf, writeRecord,
} from './persist.js';
import { hashJson, isMetaSpan, replayInputsOf } from './replay.js';
import { clockWriteProblem } from './timeline/boundary.js';
import { allocator, occurrenceOf, spanOperationKey } from './evidence.js';
import { gateProblem } from './timeline/gate.js';
import {
    CHECKPOINT_EVERY, CHECKPOINT_BYTES, isObject, touchesHostDomain, hostBlock, revOf, deepFreeze,
    NO_LONGER_DONE, readerSetup,
} from './store/constants.js';
import { hasMeta, payloadHashOf } from './store/digest.js';
import { createTombs } from './store/tombs.js';
import { createSources } from './store/sources.js';
import { createGuards } from './store/guards.js';
import { createWalk } from './store/walk.js';
import { createReplayBlocks } from './store/replay-blocks.js';
import { createMemo } from './store/memo.js';
import { createRead } from './store/read.js';
export { CHECKPOINT_EVERY, CHECKPOINT_BYTES, CHECKPOINT_MIN_GAP, NO_LONGER_DONE, deepFreeze } from './store/constants.js';

/**
 * @param {object} options
 * @param {() => object[]} options.chat     the live chat array (SillyTavern's `chat`)
 * @param {(target, options) => Promise<void>} options.save  saves the open chat; it must start writing
 *     before it returns (see createSaver). `target` = { chatId, place, carrier } of the newest change.
 * @param {() => string} [options.chatId]    the open chat's ID (SillyTavern's getCurrentChatId)
 * @param {() => *} [options.place]          where the open chat is saved (kept in a change's target for rescue)
 * @param {(target, entries) => Promise<void>} [options.rescue]  writes changes made in a chat that is no
 *     longer open into that chat's file; `entries` = [{ message, index }] of the messages written
 * @param {{ holds, fresh, restore, forget }} [options.confirm]  after a write timed out: reads the stamped
 *     file back, so a late write of the timed-out one is found and put right (persist.js createSaver)
 * @param {{ get(chatId), set(chatId, value) }} [options.memo]  keeps a suspect chat's read-backs over a reload
 * @param {() => number} [options.now]       accepted for the §12 interface; the store keeps no clock
 * @param {(state, ops) => object} [options.apply]  defaults to ops.js; tests inject a fake
 * @param {(error) => void} [options.onSaveError]   told when a scheduled (not flushed) save fails, once until one works
 * @param {object} [options.timers]          { setTimeout, clearTimeout } for tests
 * @param {number} [options.checkpointEvery] / [options.checkpointBytes]  thresholds (default 100 / 128 KB)
 * @param {number} [options.receiptKeep]     carriers back (the head is 0) from which receipts drop `data` (200)
 * @param {() => string} [options.recordId]  ID of a new carrier record
 * @param {(state, domains: string[]) => string[]} [options.validate]  the domains' validators, run on a
 *   state whose counts were moved by a replay (ops.js rebaseOps), and on every replayed block's touched
 *   domains; a problem the block brings skips that block
 * @param {(domain: string) => string[]} [options.scratch]  a domain's per-reply scratch fields (ops.js)
 * @param {() => object|null} [options.metadata]  the open chat's metadata, saved with the chat: the archive of deleted
 *   source-map ids lives in `storySuite.sourceArchive` (without it the archive is kept in memory only)
 *
 * `attachGuard(check, mark?)` (the command bus calls it): `check(state, { guard, source, block, operation,
 * recorded })` → `{ ok: true } | { ok: false, reason }` is how a guarded block is asked on replay (a throw or any
 * other answer fails closed); `mark()` → text that changes when the answer could (a module registered).
 */
export function createStore({
    chat, save, now = null, apply = applyOps, onSaveError = null, timers = globalThis,
    checkpointEvery = CHECKPOINT_EVERY, checkpointBytes = CHECKPOINT_BYTES, recordId = newRecordId, validate = null,
    chatId = () => undefined, place = () => null, rescue = null, scratch = null, receiptKeep = RECEIPT_KEEP,
    confirm = null, memo = null, metadata = () => null, marked = () => false, replayEnv = () => '',
} = {}) {
    if (typeof chat !== 'function') throw new TypeError('createStore needs a chat() function.');
    if (typeof apply !== 'function') throw new TypeError('createStore needs an apply(state, ops) function.');
    void now;
    // The store's state: one object, so the parts of the store can share it (`s.name`).
    const s = {
        frozenCheckpoints: new WeakMap(),
        checkpointBytesOf: new WeakMap(),
        cache: null,  // { key, state, problems }
        lastWrite: null,  // { message, swipe, sid, rev } of the last record written, for save verification
        holding: 0,  // inside batch(): swipe_info copies wait until it ends
        held: new Set(),
        known: null,  // the carriers (message objects) the last good head was built from
        writes: 0,
        unsaved: new Map(),  // message → { index, chatId, n }: records written since their chat was saved
        reserved: new WeakMap(),  // message → { swipe, sid }: a record ID handed out before the record
        epoch: 0,
        lineMemo: null,  // { epoch, key, receipts?, untold? }
        atMemo: new Map(),  // index → { arr, epoch, from, refs: [message, record, swipe, mes][], state }
        witnessGen: null,  // the generation of timeline witnesses kept now (see witnessGeneration)
        counts: { replays: 0, recordsRead: 0, lineScans: 0, witnessMisses: 0 },
        guardCheck: null,
        guardMark: null,
        guardSeen: false,  // a guarded block was replayed or written: the mark is looked at on each read
        applying: null,  // while the head is replayed: { list, index }, where the proof of each block that applies is put
        walkProofs: null,  // while a Re-read or a reconcile plans blocks: Map id → { proof, block } of what it has planned
        lastMark: '',
        replanFrom: Infinity,  // the first carrier seen holding a guarded step with a replan, or revs to number on (none: nothing to reconcile)
        fallback: null,  // the initial state ensureInitial was given, frozen
        noted: null,  // the kept-aside start the reader was last told about
        tombs: new Set(),
        tombMeta: undefined,  // the metadata object the set was read from
        idIndex: null,  // { arr, chat, swipeKeys: Map<sw_ id, stored sid>, evidences: Map<ev_ id, stored sid>, logicals: Map<sr_ id, Set<message>> }
        bodies: new WeakMap(),
        links: new WeakMap(),
        staged: null,  // index → the record a Re-read / reconcile has worked out and not stored yet: prefix hashes follow it
        tail: null,  // { arr, upTo, length, hash }
        spineDigests: new WeakMap(),
        spineLinks: new WeakMap(),
        guardFaults: null,
        receiptCopies: new WeakMap(),
        witnessScoped: null,  // { gen, epoch }
    };
    // Guarded replay (REPLAY.md): how a block's guard is asked, and the mark that says the answer may differ.
    // A first record that is a future version's or damaged is never written over (REPLAY.md "Preserved
    // records"): while the chat has no other state, the head is this empty state, read-only.

    // Every record goes through here, so a save can be checked against the last one written, and a change
    // left in a chat that is no longer open can be found again (rescue).
    function write(message, record) {
        const there = message.extra?.[KEY];
        const kind = rawKind(there);
        if (KEPT_ASIDE.has(kind)) throw new Error(`The story record on this reply ${WHY[kind](there)}; it is kept as it is and not written over.`);
        s.epoch++;
        if (s.holding) s.held.add(message);
        const keep = keeps(message);
        if (s.tail && s.tail.arr[s.tail.upTo] !== message) s.tail = null;      // a reply before the head changed
        const given = withSource(message, record);
        if (isObject(given.source)) noteIds(idsOf(list()), message, given.source, given.sid);
        if (Array.isArray(given.spans)) for (const span of given.spans) if (isMetaSpan(span)) idsOf(list()).blocks.add(span.id);
        const stored = writeRecord(message, given, { mirror: !s.holding && keep });
        if (!keep) dropCopy(message);
        s.lastWrite = { message, swipe: stored.swipe, sid: stored.sid, rev: stored.rev };
        s.unsaved.set(message, { index: list().indexOf(message), chatId: chatId(), n: ++s.writes });
        return stored;
    }

    function forget(id, upTo) {
        for (const [message, entry] of s.unsaved) if (entry.chatId === id && entry.n <= upTo) s.unsaved.delete(message);
    }

    // B-b2-timeline-1: the chat a change belongs to, taken when it is made, and checked right before the
    // save starts. SillyTavern opens another chat by emptying this same array, then setting the new
    // chat's name, then reading it from the server: a save in between would write the wrong chat.
    function target() {
        const arr = list();
        return { chatId: chatId(), place: place(), carrier: arr[lastCarrier(arr)] ?? null };
    }
    function check(change) {
        const arr = list();
        if (chatId() !== change.chatId) return { moved: 'another chat is open' };
        if (!arr.length) return { wait: 'a chat is being opened' };
        if (change.carrier && !arr.includes(change.carrier)) {
            let left = false;
            for (const [message, entry] of s.unsaved) {
                if (entry.chatId !== change.chatId) continue;
                if (arr.includes(message)) left = true;
                // The same chat read again (a reload, or opened again before the save): the change goes
                // onto the same message as read back, when it still is that message.
                else if (carryRecord(message, arr[entry.index])) {
                    s.unsaved.delete(message);
                    s.unsaved.set(arr[entry.index], { ...entry, n: ++s.writes });
                    s.cache = null;
                    forgetMemos();
                    left = true;
                }
            }
            return left ? '' : { gone: 'the reply that held the change is no longer in the chat' };
        }
        return '';
    }

    // SPEC §3.3: after a save, the carrier last written must still hold the rev it was given. If
    // something replaced it while the save ran, the save counts as failed (the story stays marked
    // unsaved and the reader is told); the next save writes the chat as it is then.
    const verify = {
        before: () => s.lastWrite,
        after(token) {
            if (!token) return '';
            const arr = list();
            const index = arr.indexOf(token.message);
            if (index < 0) return '';   // deleted, or another chat: nothing of this one to check
            const message = token.message;
            const extra = swipeOf(message) === token.swipe ? message.extra : message.swipe_info?.[token.swipe]?.extra;
            let rev = extra?.[KEY]?.rev;
            // C1-2: an earlier swipe deleted since moved the record to another index (restamp): it is
            // found by its record ID, shown or in its swipe's copy.
            if (rev !== token.rev && typeof token.sid === 'string' && extra?.[KEY]?.sid !== token.sid) {
                const held = [message.extra, ...(Array.isArray(message.swipe_info) ? message.swipe_info.map(info => info?.extra) : [])]
                    .map(where => where?.[KEY]).filter(record => isObject(record) && record.sid === token.sid);
                if (held.some(record => record.rev === token.rev)) return '';
                if (held.length) rev = held[0].rev;
            }
            if (rev === token.rev) return '';
            if (s.lastWrite === token) s.lastWrite = null;
            return `The story was saved, but message ${index} no longer holds its latest changes (change ${rev ?? 'none'} instead of ${token.rev ?? 'none'}); the story stays marked unsaved.`;
        },
    };
    const saver = createSaver({
        save: (change, options) => {
            const upTo = s.writes;
            return Promise.resolve(save(change, options)).then(result => {
                forget(change ? change.chatId : chatId(), upTo);
                return result;
            });
        },
        rescue: typeof rescue === 'function' ? (change, options = {}) => {
            const entries = [...s.unsaved].filter(([, entry]) => entry.chatId === change.chatId)
                .map(([message, entry]) => ({ message, index: entry.index }));
            return Promise.resolve(rescue(change, entries, options)).then(result => {
                forget(change.chatId, Infinity);
                return result;
            });
        } : null,
        target, check, onError: onSaveError, timers, verify, confirm, memo,
    });

    const list = () => {
        const arr = chat();
        return Array.isArray(arr) ? arr : [];
    };

    // The parts of the store that moved to src/v2/store/ (each is given the state holder `s` and the store functions it calls).
    const { rawKind, KEPT_ASIDE, WHY, preservedAt, readOnlyMessage, keptNow, writable, archive, bury2, idsOf, noteIds } = createTombs(s, { chatId, metadata, current: (...args) => current(...args), list });
    const { sourceFor, withSource, reservedSid, occurrenceFor, carrierSid, sourceAt, allocateOccurrence } = createSources(s, { recordId, list, archive, idsOf });
    const { markNow, seeGuards, faultsNow, blocksBefore, replayLegacy, guardHolds, blockIntact, replayGuarded, attachGuard } = createGuards(s, { chatId, metadata, list, step: (...args) => step(...args), forgetMemos: (...args) => forgetMemos(...args) });

    // (`step` is given to the guards as a wrapper that looks it up when it runs: it comes from createWalk, wired below, which needs the guards' functions.)

    // The one classifier every path uses (replay, Re-read, reconcile, rewind): a block is guarded when the host marked it
    // so: its span has an id, or its receipt carries the host's `guarded` mark (a receipt's data.v2 is the module's own
    // and never makes a block guarded). Whatever is left of its metadata, a guarded block is never taken for a legacy one.
    // `receipts`: one receipt or all those the block stands for (a block whose span is gone may stand for several: every one counts).
    const isGuardedBlock = (span, receipts) => isMetaSpan(span) || [receipts].flat().some(receipt => receipt?.guarded === true);

    // QUARANTINE, decided once per record, here, before anything runs: a guarded receipt that names none of its record's
    // changes (an older build renumbered the changes apart from it) means what it guarded cannot be told, so the record
    // applies nothing at all (every block, whether its span survived or not, stays stored and inactive), is never planned
    // again and is never cut down by a rewind. Replay, Re-read, reconcile and truncate (so rewind) all ask this.
    const quarantined = record => {
        const revs = new Set(record.ops.filter(op => op?.path === '/meta/rev').map(op => op.value));
        return record.receipts.some(receipt => receipt?.guarded === true && !revs.has(receipt.rev));
    };
    const ORPHAN = 'a guarded receipt of this reply names none of its stored changes, so what it guarded cannot be told';

    // The receipts whose changes are in `ops` (each receipt's ops end with its `/meta/rev` op), in the record's order.
    const receiptsFor = (record, ops) => {
        const revs = new Set(ops.filter(op => op?.path === '/meta/rev' && Number.isInteger(op.value)).map(op => op.value));
        return record.receipts.filter(receipt => revs.has(receipt?.rev));
    };

    // What a record holds, as a hash: its swipe key and each block's id and ops. Records are never changed in
    // place (each write puts a new one), so it is worked out once per record.
    function bodyDigest(record) {
        let digest = s.bodies.get(record);
        if (!digest) {
            s.bodies.set(record, digest = hashJson({
                k: record.source?.swipeKey ?? record.sid ?? null,
                // (a guarded block by all of its metadata: guard, recorded inputs, evidence, claims, boundaries, result)
                b: blockParts(record).map(({ ops, span }) => [isMetaSpan(span) ? hashJson(span) : null, hashJson(ops)]),
            }));
        }
        return digest;
    }

    // The hash of everything on the carriers before `upTo` (block contents, swipe keys and, for carriers with
    // guarded blocks, their text), chained from the first; each link is kept per record while its input stays.
    // The hash before the head reply, kept for the next guarded block on it: valid while nothing but that reply is written
    // (write() drops it), the chat is the same array of the same length, and nothing is staged.
    function chainHash(arr, upTo) {
        if (!s.staged && s.tail && s.tail.arr === arr && s.tail.upTo === upTo && s.tail.length === arr.length) return s.tail.hash;
        const hash = chainHashUncached(arr, upTo);
        if (!s.staged) s.tail = { arr, upTo, length: arr.length, hash };
        return hash;
    }
    function chainHashUncached(arr, upTo) {
        let hash = '';
        for (let i = 0; i < upTo && i < arr.length; i++) {
            if (!isCarrier(arr[i])) continue;
            const record = s.staged?.get(i) ?? readRecord(arr[i]);
            if (!record) continue;
            const text = hasMeta(record) ? payloadHashOf(arr[i]) : null;
            const hit = s.links.get(record);
            if (hit && hit.prev === hash && hit.text === text) {
                hash = hit.out;
                continue;
            }
            const out = hashJson({ p: hash, d: bodyDigest(record), t: text });
            s.links.set(record, { prev: hash, text, out });
            hash = out;
        }
        return hash;
    }

    // The exact prefix a checkpoint was made over (the gate of trust, REPLAY.md "Checkpoints and covers"): a hash chained over
    // every record before it as it is shown now, from the first: all of replay.js replayInputsOf (everything replay reads
    // from a record), the text of records that hold guarded blocks, and the first record's own starting point. Each link is kept per record while its input stays, so a read costs a lookup
    // per record and a change costs the records from it on.
    function spineDigest(record) {
        let digest = s.spineDigests.get(record);
        if (!digest) s.spineDigests.set(record, digest = hashJson(replayInputsOf(record)));
        return digest;
    }
    function spineStep(prev, record, message, first) {
        const text = hasMeta(record) ? payloadHashOf(message) : null;
        const hit = s.spineLinks.get(record);
        if (hit && hit.prev === prev && hit.text === text && hit.first === first) return hit.out;
        const out = hashJson({ p: prev, d: spineDigest(record), t: text, c: first ? hashJson(record.checkpoint ?? null) : null });
        s.spineLinks.set(record, { prev, text, first, out });
        return out;
    }
    // The prefix hash in front of carrier `upTo`; `at(i)` gives the record to use for carrier i (a Re-read passes the ones it is
    // about to write).
    function spineBefore(arr, upTo, at = i => readRecord(arr[i])) {
        let hash = '';
        let first = true;
        for (let i = 0; i < upTo && i < arr.length; i++) {
            if (!isCarrier(arr[i])) continue;
            const record = at(i);
            if (!record) continue;
            hash = spineStep(hash, record, arr[i], first);
            first = false;
        }
        return hash;
    }

    // The identity of a checkpoint's window (chain): the records it covers, with the swipe keys, block
    // contents and text of the ones that hold guarded blocks. undefined when none does (nothing to add to
    // `covers`). `at(i)` gives the record to use for carrier i (a Re-read passes the ones it is about to write).
    function windowHash(arr, members, at = i => readRecord(arr[i])) {
        let guarded = false;
        const entries = members.map(i => {
            const record = at(i);
            if (!hasMeta(record)) return record?.sid ?? null;
            guarded = true;
            return { s: record.sid, k: record.source?.swipeKey ?? null, p: payloadHashOf(arr[i]), d: bodyDigest(record) };
        });
        return guarded ? hashJson(entries) : undefined;
    }

    const arr0 = index => list()[index];

    const intactReason = (record, ops, span, receipt) => {
        try { blockIntact(record, ops, span, receipt); return null; } catch (error) { return error.message; }
    };

    // The walk and replay parts (store/walk.js, store/replay-blocks.js) call each other: createWalk is given the replay functions it
    // calls as wrappers that look them up when they run, because createReplayBlocks is wired right after it and is given the real ones.
    const { stamp, advanced, walkSuffix, keeps, settleAll, settleBehind, checkpointState, step, chain, problemText, rawSidAt, packProblems, unpackProblems } = createWalk(s, {
        apply, receiptKeep, scratch, validate, list, current: (...args) => current(...args), blocksBefore, markNow, seeGuards, chainHash, spineBefore, spineStep, windowHash,
        replay: (...args) => replay(...args), replayBlocks: (...args) => replayBlocks(...args), appliedOf: (...args) => appliedOf(...args),
        proofBefore: (...args) => proofBefore(...args), packOwners: (...args) => packOwners(...args), listProofs: (...args) => listProofs(...args),
    });
    const { replay, replayRecord, replayBlocks, rerunBlock, skipped, headKey, stillHolds, proofsBefore, proofBefore, packOwners, listProofs, appliedOf } = createReplayBlocks(s, {
        ORPHAN, quarantined, receiptsFor, isGuardedBlock, arr0, intactReason, ownedAlready, publish, asOps: (...args) => asOps(...args), blockParts: (...args) => blockParts(...args),
        receiptsOf: (...args) => receiptsOf(...args), lineOf: (...args) => lineOf(...args), current: (...args) => current(...args), list,
        guardHolds, occurrenceFor, withSource, replayGuarded, replayLegacy, advanced, chain, checkpointState, problemText, stamp, step, unpackProblems,
    });

    // What a story line is, apart from where it stands in the reply: the command and the line as written.

    // The span of a guarded block about to be stored on carrier `index` as `record` (which has its source),
    // after the blocks `earlier` ([{ ops, span }]) and `offset` ops: the host stamps the id (kept when the
    // block is planned again), the source, the claims its ops make and the boundary it starts at. `block` is
    // what the bus handed over: { module, source, guard, operation, recorded, result, id? }.
    // The proof of a block that has applied, for the guards asked on the rest of a Re-read or a reconcile (walkProofs). Called only
    // after the block applied: a block that was refused or collided publishes nothing.
    // The first of `evidence`'s proofs whose id a block that has applied already owns in `state`, else undefined. A block planned again that
    // would give such an id is refused before it applies and before it publishes: replacing a block's own ids never exempts another owner.
    function ownedAlready(state, evidence) {
        const pins = state?.meta?.proofs;
        return isObject(pins) && Array.isArray(evidence) ? evidence.find(proof => Object.hasOwn(pins, proof?.id)) : undefined;
    }

    function publish(span, at = s.applying?.index) {
        if (s.walkProofs && isMetaSpan(span) && Array.isArray(span.evidence)) for (const proof of span.evidence) s.walkProofs.set(proof.id, Object.freeze({ proof, block: span.id, index: at }));
    }



    const sameKey = (a, b) => Object.keys(a).every(name => a[name] === b[name]);


    // The memo and read parts (store/memo.js, store/read.js). The parts wired before them call the memo functions through wrappers
    // that look them up when they run (`current`, `forgetMemos`, `asOps`, `blockParts`, `receiptsOf`, `lineOf`), because createMemo needs their
    // results and is wired after them, where `sameKey` exists. `api` is only used for `api.sourceAt(...)`, which is looked up when it runs.
    const { current, retain, carrierAt, memoAt, frozenReceipts, forgetMemos, witnessKeyOf, markSeen, witnessGeneration, lineOf, baseFor, stateBefore, take, sidFor, carriedTo, spansOf, spansFor, blockParts, receiptsOf, asOps, prefixWitnessUncached } = createMemo(s, {
        KEPT_ASIDE, WHY, api: { sourceAt: (...args) => api.sourceAt(...args) }, appliedOf, archive, blocksBefore, chain, chainHash, chatId, checkpointBytes,
        checkpointEvery, checkpointState, headKey, list, markNow, marked, metadata, packOwners, packProblems, preservedAt, proofBefore, proofsBefore,
        rawKind, rawSidAt, recordId, replay, replayEnv, replayRecord, sameKey, settleBehind, sourceFor, spineBefore, stillHolds, windowHash,
    });
    const { head, at, headIndex, opsAt, changesAt, problems, readOnly, startOver, keepEarliest, ensureInitial, proofs, blockAt, replansFrom, boundaryProblems, payloadHashAt, boundary, timelineMarkers, prefixWitness, witnessScope, witnessMemoSize, witnessFresh } = createRead(s, {
        api: { sourceAt: (...args) => api.sourceAt(...args) }, blockParts, blocksBefore, carriedTo, chainHash, current, faultsNow, forgetMemos, idsOf, keptNow,
        list, listProofs, markSeen, memoAt, prefixWitnessUncached, preservedAt, rawKind, readOnlyMessage, reservedSid, saver, sidFor, sourceFor, spansFor,
        witnessGeneration, witnessKeyOf, write,
    });

    const api = {
        // head, at, headIndex, opsAt, changesAt, problems, readOnly, startOver, keepEarliest, ensureInitial: store/read.js
        head, at, headIndex, opsAt, changesAt, problems, readOnly, startOver, keepEarliest, ensureInitial,

        // carrierSid, sourceAt and allocateOccurrence: store/sources.js
        carrierSid, sourceAt, allocateOccurrence,

        // proofs, blockAt, replansFrom, boundaryProblems, payloadHashAt, boundary, timelineMarkers, prefixWitness, witnessScope, witnessMemoSize, witnessFresh: store/read.js
        proofs, blockAt, replansFrom, boundaryProblems, payloadHashAt, boundary, timelineMarkers, prefixWitness, witnessScope, witnessMemoSize, witnessFresh,

        /** Marks the chat as changed outside its records (the timeline's archive in the chat's metadata): the next save writes it. */
        touch() {
            saver.touch();
        },

        /**
         * The modules' lifecycle changed (a module turned ready or dormant, the `modules` event): the checkpoints over guarded
         * blocks that were made under other owners no longer hold (chain), so the head is replayed again from before them with
         * the guards asked, and only then does the caller publish a head. Guarded blocks before the checkpoint a replay would
         * start from are found by that replay. → true when the chat holds guarded blocks.
         */
        lifecycleChanged() {
            s.lastMark = markNow();
            s.cache = null;
            forgetMemos();
            current();
            return s.guardSeen;
        },

        // attachGuard: store/guards.js
        attachGuard,

        // `block` (what the command bus hands over for a guarded transaction, REPLAY.md): { module, source, guard,
        // operation, recorded, result }. The host stamps the block id, the claims its ops make and the boundary
        // it starts at, and the record keeps all of it on the block's span, written together with the ops.
        append({ ops, receipt = null, block = null } = {}) {
            const arr = list();
            const index = lastCarrier(arr);
            if (index < 0) throw new Error('There is no reply in this chat to hold the change yet.');
            writable();
            const base = current().state;
            if (!base) throw new Error('This chat has no story state yet.');
            const added = asOps(ops);
            if (receipt !== null && !isObject(receipt)) throw new TypeError('A receipt must be an object.');
            if (block !== null && !isObject(block)) throw new TypeError('A block must be an object.');
            if (!added.length && !receipt) return;
            const clock = clockWriteProblem(block, added);
            if (clock) throw new Error(clock);
            if (added.some(touchesHostDomain) && !hostBlock(block?.module, block?.operation?.type)) throw new Error('The savepoints are the host\'s own; only its blocks write them.');
            if (block?.guard) {
                // A guard that replay would turn away (another epoch, other rules) is not stored: live and replay agree.
                const gate = gateProblem(base, block.guard);
                if (gate) throw new Error(`The guarded change cannot be stored: ${gate}.`);
            }
            const next = step(base, added);       // throws on a bad op: nothing is written
            const taken = take(arr, index, base);
            // (what a quarantined record would hold is never applied: a change put on it would be lost on the next replay)
            if (!taken.fresh && quarantined(taken.record)) throw new Error(`This reply's story record is kept as it is and nothing is added to it: ${ORPHAN}.`);
            const { message } = taken;
            const record = withSource(message, taken.record);
            if (typeof receipt?.id === 'string' && record.receipts.some(known => known?.id === receipt.id)) {
                throw new Error(`Receipt ${receipt.id} is already stored on this reply.`);
            }
            const spans = spansFor(record);
            const story = receipt?.cause === 'story';
            const span = block
                ? stamp(arr, index, record, block, added, receipt, blockParts({ ...record, spans, ops: record.ops }), record.ops.length)
                : null;
            if (span) guardHolds(base, span, message);
            write(message, {
                ...record,
                ops: [...record.ops, ...added],
                receipts: receipt ? [...record.receipts, structuredClone(receipt)] : record.receipts,
                spans: [...spans, { n: added.length, story, ...(span ?? {}) }],
                ...(span ? { source: advanced(record.source, [span]) } : {}),
                rev: revOf(next),
            });
            saver.touch();
            retain(arr, next, undefined, s.cache?.applied && span?.evidence?.length
                ? [...s.cache.applied, ...span.evidence.map(proof => Object.freeze({ proof, block: span.id, index }))] : undefined);
        },

        // The state a Re-read of carrier `index` runs its lines on: its own checkpoint when it starts
        // one, else the state after the carrier before it (null without one). Frozen.
        before(index) {
            const arr = list();
            const message = carrierAt(arr, index);
            return baseFor(arr, index);
        },

        // Re-read: the carrier's `story` receipts and their ops are replaced; ui and system receipts stay,
        // after the new story ops. A kept block whose rev (its `/meta/rev` op and its receipt) is not after
        // the new story ops' last one is numbered on from it, so no two receipts on the carrier share one.
        // A kept system step marked `replan` (its receipt's `replan: { payload }`, B-a1-13: planned from the
        // story state, like a story-time heal) is not applied again as it was: `rerun(state, receipt, { index,
        // span })` runs it again on the state as it now stands at its place (→ { ok, ops, receipt, block? });
        // when it is not done, its block goes. `settled` ([{ ops, receipt, block? }], system steps; SPEC §4.2
        // step 3): the reply's afterCapture steps as the Re-read ran them again after the new story lines.
        // They take the place of the kept blocks whose receipt is marked `afterCapture` and go right after
        // the new story ops, before the reader's actions; without `settled` such a block is kept as any other
        // system step. `blocks` ([{ n, block?, receipt }], one per story line, `n` its ops): what the lines'
        // guarded transactions handed over (REPLAY.md), so each of them is stored as a block of its own.
        // The kept blocks are replayed as a rebuild replays them (step with `replayed: true`): a guarded one
        // whose guard no longer holds stays stored and inactive instead of stopping the Re-read.
        // Later carriers are replayed on top so their checkpoints stay true (and their guarded system blocks
        // that carry a `replan` are planned again with `rerun`, REPLAY.md "Reconciling"); if any later change
        // no longer applies, nothing is written and this throws.
        replaceStory(index, { ops, receipts = [], rerun = null, settled = null, blocks: lines = null } = {}) {
            writable();
            const arr = list();
            const message = carrierAt(arr, index);
            if (!Array.isArray(receipts) || receipts.some(receipt => !isObject(receipt) || (receipt.cause !== 'story' && !(receipt.cause === 'system' && receipt.beforeGenerate === true)))) {
                throw new TypeError('Re-read takes story receipts and generated-reply preludes only.');
            }
            if (settled !== null && (!Array.isArray(settled) || settled.some(ran => !isObject(ran?.receipt) || ran.receipt.cause !== 'system'))) {
                throw new TypeError('Re-read\'s afterCapture steps are system steps, each { ops, receipt }.');
            }
            const before = stateBefore(arr, index);
            const base = baseFor(arr, index);
            if (!base) throw new Error('This chat has no story state yet.');
            const taken = take(arr, index, before).record;
            const record = withSource(message, taken);
            const spans = spansOf(record);
            if (!spans) throw new Error('The story changes on this reply cannot be told apart from the others.');
            // The kept blocks, each with its receipt when they line up one to one (every append stores one).
            const blocks = [];
            let at = 0;
            for (const span of spans) {
                if (!span.story) blocks.push({ ops: record.ops.slice(at, at + span.n), span });
                at += span.n;
            }
            let keptReceipts = record.receipts.filter(receipt => receipt?.cause !== 'story').map(receipt => structuredClone(receipt));
            // A quarantined record applies nothing and is not rewritten: decided on the record as stored, before the story
            // receipts are filtered out or anything is renumbered.
            if (quarantined(record)) throw new Error(`This reply's story record is kept as it is and not read again: ${ORPHAN}.`);
            const paired = keptReceipts.length === blocks.length;
            // The old afterCapture steps go when the Re-read ran them again (only told apart one to one).
            const resettle = Array.isArray(settled) && paired;
            if (resettle) {
                for (let n = blocks.length - 1; n >= 0; n -= 1) {
                    if (keptReceipts[n]?.afterCapture !== true) continue;
                    blocks.splice(n, 1);
                    keptReceipts.splice(n, 1);
                }
            }
            const fresh = asOps(ops);
            let state;
            const fail = error => new Error(`The new story changes and this reply's other changes do not fit together: ${error?.message ?? error}`);
            try {
                state = step(base, fresh);
            } catch (error) {
                throw fail(error);
            }
            // The kept blocks' revs follow the new story ops' last one (they ran after the old ones).
            let rev = [...fresh].reverse().find(op => op?.path === '/meta/rev' && Number.isInteger(op.value))?.value ?? revOf(base);
            const nextOps = [...fresh];
            const nextReceipts = [];
            const nextParts = [];     // [{ ops, span }] of the record being built, for the boundaries' prefix hashes
            // (the occurrences the blocks built so far hold, so a kept step that starts giving proof takes one nobody has)
            const keptAlloc = allocator(record, key => nextParts.reduce((most, part) => (occurrenceOf(part.span) !== null && spanOperationKey(part.span) === key ? Math.max(most, occurrenceOf(part.span) + 1) : most), 0));
            const storySpans = [];
            // The new story lines: each guarded one a block of its own, the others together as one (as before).
            const replacedIds = new Set(spans.filter(span => span.story && isMetaSpan(span)).map(span => span.id));
            const pieces = Array.isArray(lines) && lines.length && lines.every(piece => Number.isInteger(piece?.n) && piece.n >= 0)
                && lines.reduce((sum, piece) => sum + piece.n, 0) === fresh.length && lines.some(piece => piece.block || piece.receipt?.beforeGenerate === true) ? lines : null;
            if (pieces) {
                let offset = 0;
                let upTo = base;         // the state before the piece
                for (const piece of pieces) {
                    const own = fresh.slice(offset, offset + piece.n);
                    const story = piece.receipt?.beforeGenerate !== true;
                    if (piece.block) {
                        let span;
                        try {
                            span = { n: piece.n, story, ...stamp(arr, index, record, piece.block, own, piece.receipt, nextParts, offset) };
                            guardHolds(upTo, span, message);
                        } catch (error) {
                            throw fail(error);
                        }
                        publish(span, index);     // the lines applied to the state before this point
                        storySpans.push(span);
                        nextParts.push({ ops: own, span });
                    } else if (storySpans.length && storySpans.at(-1).story === story && !isMetaSpan(storySpans.at(-1))) {
                        storySpans.at(-1).n += piece.n;
                        nextParts.at(-1).ops = [...nextParts.at(-1).ops, ...own];
                    } else {
                        const span = { n: piece.n, story };
                        storySpans.push(span);
                        nextParts.push({ ops: own, span });
                    }
                    upTo = step(upTo, own);
                    offset += piece.n;
                }
            } else {
                const span = { n: fresh.length, story: true };
                storySpans.push(span);
                nextParts.push({ ops: fresh, span });
            }
            const keptSpans = [];
            const keptProblems = [];       // this reply's blocks that stay off (the checkpoints after it carry them)
            const moved = new Map();
            // The afterCapture steps run again, right after the new story ops (their revs follow them).
            for (const ran of resettle ? settled : []) {
                const blockOps = asOps(ran.ops);
                const before = state;
                try {
                    state = step(state, blockOps);
                } catch (error) {
                    throw fail(error);
                }
                const own = [...blockOps].reverse().find(op => op?.path === '/meta/rev' && Number.isInteger(op.value))?.value;
                if (Number.isInteger(own)) rev = Math.max(rev, own);
                let span = { n: blockOps.length, story: false };
                if (ran.block) {
                    try {
                        span = { ...span, ...stamp(arr, index, record, ran.block, blockOps, ran.receipt, nextParts, nextOps.length) };
                        guardHolds(before, span, message);
                        publish(span, index);     // applied (step above)
                    } catch (error) {
                        throw fail(error);
                    }
                }
                nextOps.push(...blockOps);
                keptSpans.push(span);
                nextParts.push({ ops: blockOps, span });
                nextReceipts.push(structuredClone(ran.receipt));
            }
            for (const [n, { ops: block, span: was }] of blocks.entries()) {
                const receipt = paired ? keptReceipts[n] : null;
                // A reply-bound block goes when its reply is read again, its receipt with it (as a delete or a swipe takes it);
                // what was built on it is replayed below without it. The reader's own chat-block setup stays (readerSetup).
                if (was.guard?.replyBound === true && !readerSetup(was, paired ? (receipt ? [receipt] : []) : receiptsFor({ receipts: keptReceipts }, block))) {
                    if (!paired) for (const gone of receiptsFor({ receipts: keptReceipts }, block)) keptReceipts.splice(keptReceipts.indexOf(gone), 1);
                    continue;
                }
                let blockOps;
                let kept = receipt;
                let again = null;      // the block as planned again, when it was
                const asks = typeof rerun === 'function' && !(isMetaSpan(was) && intactReason(record, block, was, receipt)) && ((isMetaSpan(was) && was.guard && was.replan && receipt) || (receipt?.replan && !isGuardedBlock(was, paired ? receipt : receiptsFor({ receipts: keptReceipts }, block))));
                if (asks) {
                    let out = null;
                    try { out = rerunBlock(rerun, state, receipt, index, was, nextParts, keptAlloc); } catch { out = null; }
                    // A guarded step goes only when its owner says it is no longer done; when it cannot be asked it stays.
                    if (!out?.ok && isMetaSpan(was) && !(out?.ok === false && out.code === NO_LONGER_DONE)) {
                        // (it could not be asked: the block stays exactly as it was, replayed below as any kept block is)
                    } else if (!out?.ok) continue;
                    else if (ownedAlready(state, out.block?.evidence)) {
                        // (it would give a proof id a block that applied already owns: refused; the block stays as it was, replayed below)
                    } else {
                        again = out;
                        blockOps = asOps(out.ops);
                        kept = { ...structuredClone(out.receipt), id: receipt.id, ...(receipt.beforeGenerate === true ? { beforeGenerate: true } : {}) };
                        const own = [...blockOps].reverse().find(op => op?.path === '/meta/rev' && Number.isInteger(op.value))?.value;
                        if (Number.isInteger(own)) rev = Math.max(rev, own);
                    }
                }
                if (!again) {
                    blockOps = block.map(op => {
                        if (op?.path !== '/meta/rev' || !Number.isInteger(op.value)) return op;
                        if (op.value > rev) {
                            rev = op.value;   // already after the new story ops: kept as it is
                            return op;
                        }
                        rev += 1;
                        moved.set(op.value, rev);
                        return { ...op, value: rev };
                    });
                }
                // A kept guarded block is asked again here (its guard may not hold on the new story): then
                // it stays stored and inactive. A block planned again is applied as a live command is.
                const meta = isMetaSpan(was);
                const heldBy = state;     // the state before this block
                const guarded = isGuardedBlock(was, paired ? receipt : receiptsFor({ receipts: keptReceipts }, block));       // (the one classifier: a stripped span is still a guarded block)
                let applied = true;      // the block applied: only then is its proof the guards' to see
                try {
                    state = again ? step(state, blockOps) : guarded ? replayGuarded(state, record, blockOps, was, message, receipt) : replayLegacy(state, blockOps);
                } catch (error) {
                    if (!guarded || again) throw fail(error);
                    applied = false;
                    state = skipped(state, blockOps);
                    keptProblems.push({ index, block: storySpans.filter(each => each.n).length + keptSpans.filter(each => each.n).length, receipts: receiptsOf({ receipts: keptReceipts }, block), why: String(error?.message ?? error), code: 'REPLAY_PREREQUISITE' });
                }
                let span = { n: blockOps.length, story: false };
                try {
                    if (again?.block) {
                        span = { ...span, ...stamp(arr, index, record, { ...again.block, ...(meta ? { id: was.id, source: { ...again.block.source, ordinal: was.source.ordinal } } : {}) }, blockOps, kept, nextParts, nextOps.length) };
                        guardHolds(heldBy, span, message);
                    } else if (meta && !again) {
                        if (intactReason(record, block, was, receipt)) {
                            // Not intact (damaged, another reply's, claims that are not its changes'): it stays exactly as stored, inactive.
                            span = { ...was, n: blockOps.length };
                        } else {
                            // A Re-read moves a kept block's position and nothing else: its cursor and prefix hash follow where it stands now,
                            // but its payload hash, evidence, claims, guard, source and results are the ones it was stored with.
                            const placed = stamp(arr, index, record, { module: was.module, source: was.source, guard: was.guard, operation: was.operation, recorded: was.recorded, result: was.result, evidence: was.evidence, occurrence: was.occurrence, id: was.id }, blockOps, kept, nextParts, nextOps.length);
                            span = { ...was, n: blockOps.length, story: false,
                                boundaries: was.boundaries.map((boundary, at) => (at === 0 ? { ...boundary, cursor: placed.boundaries[0].cursor, prefixHash: placed.boundaries[0].prefixHash } : boundary)) };
                        }
                    }
                } catch (error) {
                    throw fail(error);
                }
                if (applied) publish(span, index);
                nextOps.push(...blockOps);
                keptSpans.push(span);
                nextParts.push({ ops: blockOps, span });
                if (kept) nextReceipts.push(kept);
            }
            // Every kept receipt follows its ops through every rev they moved to (once: by the rev it had), the guarded one too.
            for (const receipt of keptReceipts) if (moved.has(receipt.rev)) receipt.rev = moved.get(receipt.rev);
            if (!paired) nextReceipts.push(...keptReceipts);
            const allSpans = [...storySpans, ...keptSpans];
            const rewritten = {
                ...record,
                ops: nextOps,
                receipts: [...structuredClone(receipts), ...nextReceipts],
                spans: allSpans,
                source: advanced(record.source, allSpans),
                rev: revOf(state),
            };
            const writes = [[message, rewritten]];
            // Later blocks that were already skipped stay skipped (a guarded block that is inactive is asked again);
            // one that applied before must still apply.
            const prior = [...replay(arr, index - 1).problems.filter(problem => problem.index < index), ...keptProblems];
            const walked = walkSuffix(arr, state, index + 1, { rerun, overlay: new Map([[index, rewritten]]), prior });
            writes.push(...walked.writes);
            for (const [target, next] of writes) write(target, next);
            saver.touch();
            forgetMemos();
            s.cache = null;   // rebuilt on the next read, with the blocks that stay skipped reported
        },

        // Plans the guarded system blocks that carry a `replan` again, from carrier `index` to the head, on the
        // state as it stands at each one's place (REPLAY.md "Reconciling"): after a swipe, a delete or a
        // rollback changed what they depended on. `rerun(state, receipt, { index, span })` is as in replaceStory
        // (→ { ok, ops, receipt, block? }). All or nothing: the old ops, claims and receipts of a block are
        // removed as the new ones are put in, or the block goes when it is not done any more; a later change
        // that no longer applies throws and nothing is written. → { changed: boolean }.
        reconcile(index, { rerun = null } = {}) {
            writable();
            const arr = list();
            const message = carrierAt(arr, index);
            if (typeof rerun !== 'function') return { changed: false, planned: 0, removed: 0 };
            const base = baseFor(arr, index);
            if (!base) throw new Error('This chat has no story state yet.');
            const walked = walkSuffix(arr, base, index, { rerun, overlay: new Map() });
            if (!walked.any) return { changed: false, planned: 0, removed: 0 };
            for (const [target, next] of walked.writes) write(target, next);
            saver.touch();
            forgetMemos();
            s.cache = null;
            return { changed: true, planned: walked.planned, removed: walked.removed };
        },

        // `reply`: the record is of a received message Story Block captured (never a greeting): it is marked `reply: true`.
        setNarrated(index, ids, { reply = false } = {}) {
            if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
                throw new TypeError('Narrated receipts must be a list of receipt IDs.');
            }
            writable();
            const arr = list();
            const head = current();
            const atHead = index === head.key.index;
            const { message, record, fresh } = take(arr, index, atHead ? head.state : undefined);
            const rev = fresh ? revOf(atHead ? head.state : stateBefore(arr, index)) : record.rev;
            write(message, { ...record, narrated: [...new Set(ids)], ...(rev === undefined ? {} : { rev }), ...(reply && marked() ? { mv: 1, reply: true } : {}) });
            saver.touch();
            if (atHead) retain(arr, head.state, head.problems);
        },

        /**
         * Marks the reply at `index` as captured under the rule that skill practice comes only from rolls: `practiceRule: 'rolls'` on its record, kept
         * with the reply (a Re-read, an edit, a rebuild and a reload keep it). Only replies with a story practice line get it (turn.js); an older reply
         * has none and keeps its practice lines. Not a replay input.
         */
        setPracticeRule(index) {
            writable();
            const arr = list();
            const head = current();
            const atHead = index === head.key.index;
            const { message, record, fresh } = take(arr, index, atHead ? head.state : undefined);
            if (record.practiceRule === 'rolls') return;
            const rev = fresh ? revOf(atHead ? head.state : stateBefore(arr, index)) : record.rev;
            write(message, { ...record, practiceRule: 'rolls', ...(rev === undefined ? {} : { rev }) });
            saver.touch();
            if (atHead) retain(arr, head.state, head.problems);
        },

        // Every stored receipt on the current line of history, in chat order: [{ index, receipt }]
        // (the carriers the head is built from; frozen copies).
        receipts() {
            const arr = list();
            const memo = lineOf(arr);
            if (memo.receipts) return memo.receipts;
            s.counts.lineScans++;
            const out = [];
            let started = false;
            for (const i of carrierIndexes(arr)) {
                const record = readRecord(arr[i]);
                if (record?.checkpoint) started = true;
                if (!started || !record) continue;
                for (const receipt of frozenReceipts(record)) out.push(Object.freeze({ index: i, receipt }));
            }
            memo.receipts = Object.freeze(out);
            return memo.receipts;
        },

        // Return in time (MODULES §F17): drops the head carrier's receipts with rev >= beforeRev and
        // their ops, so the head is the state just before the first of them. Each receipt's ops end with
        // its `/meta/rev` op, which is where they are cut. Only the head carrier (nothing after it holds
        // state that depends on it). Returns { dropped: receipt ids, rev }.
        // `{ dryRun: true, chat? }` works it all out and writes nothing, on `chat` (messages, default the
        // chat) if given: rewind asks it on the messages its branch will hold before it branches.
        truncate(index, beforeRev, { dryRun = false, chat: messages = null } = {}) {
            if (!dryRun) writable();
            const arr = dryRun && Array.isArray(messages) ? messages : list();
            if (index !== lastCarrier(arr)) throw new RangeError(`Message ${index} is not the last reply that keeps the story, so its changes cannot be taken back alone.`);
            if (!Number.isInteger(beforeRev) || beforeRev < 1) throw new TypeError('beforeRev must be a whole number of 1 or more.');
            const message = carrierAt(arr, index);
            const record = readRecord(message);
            if (!record) return { dropped: [], rev: revOf(arr === list() ? current().state : stateBefore(arr, index + 1)) };
            if (quarantined(record)) throw new Error(`This reply's story record cannot be cut down: ${ORPHAN}.`);
            const chunks = [];
            let start = 0;
            record.ops.forEach((op, at) => {
                if (op?.path === '/meta/rev') {
                    chunks.push({ ops: record.ops.slice(start, at + 1), rev: op.value });
                    start = at + 1;
                }
            });
            if (start < record.ops.length) chunks.push({ ops: record.ops.slice(start), rev: null });
            const cut = chunks.findIndex(chunk => chunk.rev === null || chunk.rev >= beforeRev);
            const kept = cut < 0 ? chunks : chunks.slice(0, cut);
            const keptRevs = new Set(kept.map(chunk => chunk.rev));
            const receipts = record.receipts.filter(receipt => keptRevs.has(receipt?.rev));
            const dropped = record.receipts.filter(receipt => !keptRevs.has(receipt?.rev)).map(receipt => receipt?.id);
            const base = baseFor(arr, index);
            if (!base) throw new Error('This chat has no story state yet.');
            const ops = kept.flatMap(chunk => chunk.ops);
            const byRev = new Map(receipts.map(receipt => [receipt.rev, receipt]));
            // A kept block that was a guarded one keeps its span's record (id, guard, claims, …).
            const was = new Map();
            let from = 0;
            for (const span of spansFor(record)) {
                if (isMetaSpan(span)) was.set(`${from}:${span.n}`, span);
                from += span.n;
            }
            let offset = 0;
            const spans = kept.map(chunk => {
                const old = was.get(`${offset}:${chunk.ops.length}`);
                offset += chunk.ops.length;
                return { ...(old ?? {}), n: chunk.ops.length, story: byRev.get(chunk.rev)?.cause === 'story' };
            });
            // C1-3: the kept changes are replayed as a rebuild replays them (block by block, by the
            // replay rules: a remove of what a deleted reply added is passed over), so a chat that
            // replays fine is not refused. A kept block that still does not apply refuses the rewind.
            const problems = [];
            const earlier = (dryRun ? [] : current().problems).filter(problem => problem.index < index);     // (read before anything is written)
            const state = replayRecord(base, { ...record, ops, spans, receipts }, index, problems, null, message);
            // (a guarded block whose guard no longer holds stays stored and inactive; it does not refuse)
            const refusing = problems.filter(problem => problem.code !== 'REPLAY_PREREQUISITE');
            if (refusing.length) throw new Error(refusing[0].why);
            if (dryRun) return { dropped, rev: revOf(state) };
            write(message, {
                ...record,
                ops,
                receipts,
                spans,
                narrated: record.narrated.filter(id => !dropped.includes(id)),
                rev: revOf(state),
            });
            saver.touch();
            // Only this carrier was rewritten: earlier problems stay, and so do those of its kept blocks that are off.
            retain(arr, state, [...earlier, ...problems], null);
            return { dropped, rev: revOf(state) };
        },

        untold() {
            const arr = list();
            const memo = lineOf(arr);
            if (memo.untold) return memo.untold;
            s.counts.lineScans++;
            const records = [];
            for (const i of carrierIndexes(arr)) {
                const record = readRecord(arr[i]);
                if (record?.checkpoint || (records.length && record)) records.push(record);
            }
            const told = new Set();
            const out = [];
            for (let r = records.length - 1; r >= 0; r--) {
                for (const id of records[r].narrated) told.add(id);
                const receipts = records[r].receipts;
                for (let k = receipts.length - 1; k >= 0; k--) {
                    if (receipts[k]?.narrate === true && !told.has(receipts[k].id)) out.push(receipts[k]);
                }
            }
            memo.untold = deepFreeze(structuredClone(out.reverse()));
            return memo.untold;
        },

        /**
         * How much replay work the store has done (for tests that count work rather than time): `replays`
         * (state rebuilt from a checkpoint), `recordsRead` (carriers replayed), `lineScans` (whole-chat
         * passes for receipts or untold), `witnessMisses` (timeline witnesses worked out, not found in the memo). A copy.
         */
        work() {
            return { ...s.counts };
        },

        rebuild() {
            s.frozenCheckpoints = new WeakMap();
            const previous = s.idIndex;
            s.idIndex = null;
            s.cache = null;
            forgetMemos();
            // The record copies and old receipts are settled over the whole chat, and a record whose
            // swipe moved is stamped again (settleAll).
            if (settleAll(list())) saver.touch();
            // Ids this session knew of this chat that are no longer in it were deleted: they are archived. The index is
            // (re)built on every rebuild, so what is there now is the baseline of the next one (a store just opened over
            // saved records has one from its first rebuild); another chat's ids are never carried over.
            const now = idsOf(list());
            if (previous && previous.arr === list() && previous.chat === now.chat) bury2(previous, now);
            current();
        },

        /** Is this canonical sid, swipe key or evidence id archived (its reply or swipe was deleted)? It confers no eligibility. */
        archived(id) {
            return archive().has(id);
        },
        /** The archive: the ids that were deleted, sorted. */
        archiveList() {
            return [...archive()].sort();
        },

        // Runs `fn` (it may be async) with the swipe_info copies of every record it writes held back,
        // then copies each once: a reply's change lines are stored one by one (each must apply on its
        // own), but a long block is not copied once per line (B1-1).
        async batch(fn) {
            s.holding += 1;
            try {
                return await fn();
            } finally {
                s.holding -= 1;
                if (!s.holding) {
                    // The copies are written again as they are: a head cached before stays the head.
                    const arr = list();
                    const kept = s.cache && sameKey(s.cache.key, headKey(arr)) ? s.cache : null;
                    for (const message of s.held) {
                        const record = message.extra?.[KEY];
                        if (!record) continue;
                        if (keeps(message, arr)) writeRecord(message, record);
                        else dropCopy(message);
                    }
                    s.held.clear();
                    if (kept) retain(arr, kept.state, kept.problems);
                }
            }
        },

        /**
         * B-b2-timeline-r2-2: chat `from` was renamed `to` (SillyTavern's CHAT_RENAMED). A change not yet
         * saved, or left for its old chat's file, goes into the renamed chat's file instead: the old one
         * is gone, and a renamed open chat is read back as new messages, which looks like another chat.
         */
        renamed(from, to) {
            if (typeof from !== 'string' || typeof to !== 'string' || !from || !to || from === to) return false;
            let moved = saver.renamed(from, to);
            for (const entry of s.unsaved.values()) {
                if (entry.chatId !== from) continue;
                entry.chatId = to;
                moved = true;
            }
            if (moved && saver.dirty()) saver.schedule();
            return moved;
        },

        scheduleSave(ms = 400) { saver.schedule(ms); },
        /**
         * Puts off a save that was only scheduled (not one already running): the turn's cues before a reply
         * are saved with the reply's own save, one write of the chat file instead of two. The change stays
         * dirty; the caller saves it (or schedules it again) when the reply comes or the generation ends.
         */
        deferSave() { saver.defer(); },
        /**
         * The turn's save (docs/v2/PERFORMANCE.md, "Long chats"): the reply's capture and the reader's actions
         * after it are written once, a moment after the last of them (persist.js IDLE_MS, at most IDLE_MAX_MS
         * after the first). Only where a change left behind by a chat switch can still be put into its own
         * chat's file (a chat file and `rescue`): then → true. Elsewhere (no chat file this page can write,
         * e.g. a temporary chat) → false, and the caller saves at once as before.
         */
        saveIdle(wait, max) {
            let where = null;
            try { where = typeof rescue === 'function' ? place() : null; } catch { where = null; }
            if (!where) return false;
            saver.idle(wait, max);
            return true;
        },
        /** True when changes are saved by the turn's idle save here (see saveIdle). */
        idleSaves() {
            try { return typeof rescue === 'function' && !!place(); } catch { return false; }
        },
        /** Saves now (a reader's action is saved at once); → Promise<true | false>, never throws: a failure is told and tried again. */
        saveSoon(options) { return saver.saveSoon(options); },
        /** The page is closing: the newest state goes out at once, even past a save still on its way. */
        saveUrgent(options) { return saver.urgent(options); },
        /** True while a save of the open chat is on its way. */
        inFlight() { return saver.inFlight(); },
        /** True while a timed-out write's file is still to be read back. */
        suspect() { return saver.suspect(); },
        /** A chat was opened: read-backs a reload of the page left for it go on (persist.js createSaver.resume). */
        resume() { return saver.resume(target()); },
        flush() { return saver.flush(); },
        dirty() { return saver.dirty(); },
        /** True while saves are failing (until one works again). */
        failing() { return saver.failing(); },
    };
    // A Re-read and a reconcile plan blocks that are stored only when they are all planned: for their length the proof
    // those blocks give is laid over the stored (store.proofs), so a step planned again, and the guards asked on the
    // way, see the proof of the blocks planned before it and not the old bytes of the blocks they replace.
    for (const name of ['replaceStory', 'reconcile']) {
        const inner = api[name];
        api[name] = (...args) => {
            const outer = s.walkProofs;
            s.walkProofs = new Map();
            try { return inner.apply(api, args); } finally { s.walkProofs = outer; }
        };
    }
    return api;
}
