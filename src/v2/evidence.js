// Story Suite v2: proof and evidence (docs/v2/EVIDENCE.md, contract §6 "Proof submission" and "story.evidence").
//
// A module that owns a kind of proof (Story Director: visit, acceptance, event; RPG Battle: kill, use, rescue,
// story) calls `ctx.proof({ kind, payload, parents? })` inside a command. The host checks who is asking, what
// the payload is and what the reader really said, stamps the id, the Source and the payload hash, keeps the
// proof on the span of the block the command makes (`span.evidence`) and pins it in the state
// (`meta.proofs[id]`, written by the same ops as the block). The pin is what makes a proof ACTIVE: a block
// that does not apply, a reply that was deleted or a swipe that is not shown leave no pin, so the proof is
// not there. `story.evidence` shows a proof only while its bytes still match its pin, its owner and kind
// still match the table below, its payload is still closed and well formed, and every parent is visible too.
//
// This file is pure: it reads no chat and no registry. The command bus (commands.js) calls `submitProof`, the
// store (store.js) calls `recordEntries` and `evidenceProblem`, and `createEvidenceQuery` is the query the
// core module registers.

import { isId } from './check.js';
import { escapeKey } from './ops.js';
import { canonicalJson, deriveId, hashJson, isPlainJson, isRecordId, sourceProblem } from './replay.js';

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const utf8 = new TextEncoder();

/** Who may give each kind of proof (contract §6): the module id that owns it. */
export const OWNERS = Object.freeze({
    visit: 'story-director', acceptance: 'story-director', event: 'story-director',
    kill: 'rpg-battle', use: 'rpg-battle', rescue: 'rpg-battle', story: 'rpg-battle',
});
export const KINDS = Object.freeze(Object.keys(OWNERS));
export const STATS = Object.freeze(['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA']);

/** The structural caps; the contract names none, so these are the host's (EVIDENCE.md "Caps"). */
export const LIMITS = Object.freeze({
    opaqueBytes: 4096,     // a payload the contract leaves to B3/B6 (normalized JSON, UTF-8 bytes)
    selection: 120,        // code points of an acceptance's `selection`
    words: 240,            // code points of an acceptance's `words`
    parents: 8,            // parents of one proof
    perRoot: 32,           // proofs one command (its root transaction) may give
    ids: 500,              // ids one story.evidence call may ask for
});

const PROOF_KEYS = ['id', 'source', 'owner', 'kind', 'payload', 'payloadHash', 'parents'];
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

// ---------- payloads ----------

// Plain text: nothing at the ends, no control characters, 1..max code points.
const textProblem = (value, max) => {
    if (typeof value !== 'string' || !value) return 'is text';
    if (value.trim() !== value) return 'has no space at either end';
    if (CONTROL.test(value)) return 'has no control characters';
    if ([...value].length > max) return `is at most ${max} characters`;
    return '';
};

const exactKeys = (payload, keys) => Object.keys(payload).length === keys.length && keys.every(key => Object.hasOwn(payload, key));

/** An acceptance (contract §6): `{ thread, selection }` (the reader's pick) or `{ thread, words }` (what they said). */
function acceptanceProblem(payload) {
    if (!isRecordId(payload.thread)) return 'its thread is a record id like th_k3f9a2qz';
    const keys = Object.keys(payload).filter(key => key !== 'thread');
    if (keys.length !== 1 || (keys[0] !== 'selection' && keys[0] !== 'words')) return 'it names its thread and either a selection or the reader\'s words, nothing else';
    const why = textProblem(payload[keys[0]], keys[0] === 'selection' ? LIMITS.selection : LIMITS.words);
    return why ? `its ${keys[0]} ${why}` : '';
}

/** The check Story Director asks evidence for (contract §6): `{ check, actor, stat, dc }`, an `event` proof. */
function checkProblem(payload) {
    if (!exactKeys(payload, ['check', 'actor', 'stat', 'dc'])) return 'a check is { check, actor, stat, dc } and nothing else';
    if (!isRecordId(payload.check)) return 'its check is a record id';
    if (!isId(payload.actor)) return 'its actor is an id';
    if (!STATS.includes(payload.stat)) return `its stat is one of ${STATS.join(', ')}`;
    if (!Number.isInteger(payload.dc) || payload.dc < 1 || payload.dc > 40) return 'its dc is a whole number from 1 to 40';
    return '';
}

// A payload the contract leaves to a later package (B3/B6, Story Director's own events and visits): any plain
// JSON object, not empty, within the byte cap. Whether it means anything is its owner's to check.
function opaqueProblem(payload) {
    if (!Object.keys(payload).length) return 'it has nothing in it';
    if (utf8.encode(canonicalJson(payload)).length > LIMITS.opaqueBytes) return `it is more than ${LIMITS.opaqueBytes} bytes`;
    return '';
}

/** '' when `payload` is a closed payload for `kind`, else why not. Structure only: intent is `intentProblem`. */
export function payloadProblem(kind, payload) {
    if (!isObject(payload) || !isPlainJson(payload)) return 'its payload is a plain JSON record';
    if (kind === 'acceptance') return acceptanceProblem(payload);
    if (kind === 'event' && Object.hasOwn(payload, 'check')) return checkProblem(payload);
    return opaqueProblem(payload);
}

/**
 * What names a proof inside one root (contract §6: the same key with a changed payload is a CONFLICT): an
 * acceptance is its thread, a check is its check id; a payload nobody shaped is its own key, so a different
 * payload is simply another proof.
 */
export function payloadKey(kind, payload) {
    if (kind === 'acceptance') return `thread:${payload.thread}`;
    if (kind === 'event' && Object.hasOwn(payload, 'check')) return `check:${payload.check}`;
    return `payload:${hashJson(payload)}`;
}

const said = text => String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * '' when the host saw the reader's intent the proof claims, else why not (REFUSED). An acceptance by
 * `selection` is the reader's own action in a screen (cause `ui`); one by `words` must be said in the reader's
 * message the host gave this reply (`chat.lastUser`), never in the reply's narration (`chat.reply`).
 */
export function intentProblem(kind, payload, { cause, chat }) {
    if (kind !== 'acceptance') return '';
    if (Object.hasOwn(payload, 'selection')) {
        return cause === 'ui' ? '' : 'a selection is the reader\'s own pick in a screen, and this did not come from one';
    }
    const spoken = said(chat?.lastUser);
    if (!chat || !spoken) return 'the host saw no message from the reader for this reply, and narration cannot accept for them';
    return spoken.includes(said(payload.words)) ? '' : 'the reader\'s message the host saw does not say that (narration cannot accept for the reader)';
}

// ---------- stored proofs ----------

/** '' when `proof` is a whole, closed Proof of an owner that may give its kind, else why not. */
export function proofProblem(proof) {
    if (!isObject(proof) || !exactKeys(proof, PROOF_KEYS)) return 'a proof is { id, source, owner, kind, payload, payloadHash, parents } and nothing else';
    if (!isRecordId(proof.id) || !proof.id.startsWith('pf_')) return 'its id is pf_xxxxxxxx';
    const source = sourceProblem(proof.source);
    if (source) return source;
    if (typeof proof.kind !== 'string' || !Object.hasOwn(OWNERS, proof.kind)) return `"${proof.kind}" is not a kind of proof`;
    if (proof.owner !== OWNERS[proof.kind]) return `${proof.owner} does not own "${proof.kind}" proof`;
    const payload = payloadProblem(proof.kind, proof.payload);
    if (payload) return payload;
    if (proof.payloadHash !== hashJson(proof.payload)) return 'its payload hash is not its payload\'s';
    if (!Array.isArray(proof.parents) || proof.parents.length > LIMITS.parents || new Set(proof.parents).size !== proof.parents.length
        || !proof.parents.every(id => isRecordId(id) && id !== proof.id)) return 'its parents are a short list of other proof ids';
    return '';
}

/**
 * The pin of a proof in `meta.proofs`: its payload hash, and with parents the hash of that and each parent's
 * pin as the state holds it, so a parent that is given again with other bytes (an edit, a Re-read) no longer
 * matches the pin its child was committed with, and the child is hidden with it.
 */
export function pinOf(proof, pins) {
    if (!proof.parents.length) return proof.payloadHash;
    return hashJson({ h: proof.payloadHash, p: proof.parents.map(id => [id, typeof pins?.[id] === 'string' ? pins[id] : null]) });
}

const pinsOf = state => (isObject(state?.meta?.proofs) ? state.meta.proofs : {});

const unescapeKey = key => key.replace(/~1/g, '/').replace(/~0/g, '~');

/**
 * The pins a list of ops writes under `/meta/proofs`: Map id → pin (null when it is not text). One add or
 * replace of the whole record counts, as claimKeys counts claims; removals do not.
 */
export function proofPins(ops) {
    const out = new Map();
    for (const op of Array.isArray(ops) ? ops : []) {
        if (!isObject(op) || (op.op !== 'add' && op.op !== 'replace') || typeof op.path !== 'string') continue;
        if (op.path === '/meta/proofs') {
            if (isObject(op.value)) for (const [id, pin] of Object.entries(op.value)) out.set(id, typeof pin === 'string' ? pin : null);
        } else if (op.path.startsWith('/meta/proofs/') && !op.path.slice(13).includes('/')) {
            out.set(unescapeKey(op.path.slice(13)), typeof op.value === 'string' ? op.value : null);
        }
    }
    return out;
}

/**
 * A block's ops as they are applied on replay: the record `meta.proofs` is made when the state has none, and a
 * write of the whole record (the first proof of a chat makes one) becomes a write per id, so a block that
 * stays never wipes the pins of the ones before it (a Re-read puts new lines ahead of blocks it keeps), and one
 * whose first-proof block is gone still finds its record.
 */
export function pinOps(state, ops) {
    const out = [];
    let there = isObject(state?.meta?.proofs);
    const make = () => {
        if (!there) out.push({ op: 'add', path: '/meta/proofs', value: {} });
        there = true;
    };
    for (const op of ops) {
        const whole = isObject(op) && op.path === '/meta/proofs' && (op.op === 'add' || op.op === 'replace') && isObject(op.value);
        if (whole) {
            make();
            for (const [id, pin] of Object.entries(op.value)) out.push({ op: 'add', path: `/meta/proofs/${escapeKey(id)}`, value: pin });
        } else {
            if (isObject(op) && typeof op.path === 'string' && op.path.startsWith('/meta/proofs/')) make();
            out.push(op);
        }
    }
    return out;
}

/**
 * '' when a block's span holds exactly the proof its ops pin (and each proof is whole, carries the span's
 * Source and is given once), else why not. Asked when the block is stored and again when it is replayed.
 */
export function evidenceProblem(span, ops) {
    const list = Array.isArray(span?.evidence) ? span.evidence : [];
    const pins = proofPins(ops);
    const ids = new Set();
    for (const proof of list) {
        const why = proofProblem(proof);
        if (why) return `a proof of the block is not whole: ${why}`;
        if (hashJson(proof.source) !== hashJson(span.source)) return 'a proof of the block carries another source than the block';
        if (ids.has(proof.id)) return `proof ${proof.id} is given twice`;
        ids.add(proof.id);
        if (typeof pins.get(proof.id) !== 'string') return `the block's changes do not pin proof ${proof.id}`;
    }
    if (pins.size !== ids.size) return 'the block\'s changes pin proof that it does not hold';
    return '';
}

const entries = new WeakMap();

/** [{ proof, block }] a stored record holds on its guarded blocks, in block order (kept per record). */
export function recordEntries(record) {
    let out = entries.get(record);
    if (out) return out;
    out = [];
    for (const span of Array.isArray(record?.spans) ? record.spans : []) {
        if (!isObject(span) || typeof span.id !== 'string' || !Array.isArray(span.evidence) || !isObject(span.source)) continue;
        for (const proof of span.evidence) {
            if (isObject(proof) && isObject(proof.source) && hashJson(proof.source) === hashJson(span.source)) out.push(Object.freeze({ proof, block: span.id }));
        }
    }
    Object.freeze(out);
    entries.set(record, out);
    return out;
}

// ---------- what is visible ----------

/** The entries with `pending` (this root's, not stored yet) laid over `stored`: a pending proof shadows a stored one of its id. */
export function merged(stored, pending) {
    if (!pending?.length) return stored;
    const ids = new Set(pending.map(entry => entry.proof.id));
    return [...stored.filter(entry => !ids.has(entry.proof.id)), ...pending];
}

/**
 * The proofs of `entries` ([{ proof }], in source order) that are visible on `state`: pinned in its
 * `meta.proofs` with the pin their bytes and parents give, whole, of an owner that owns the kind, given once,
 * and every parent visible too (a cycle is not visible). → Proof[] in the same order.
 */
export function visibleProofs(state, list) {
    const pins = pinsOf(state);
    const byId = new Map();
    const twice = new Set();
    for (const { proof } of list) {
        if (!isObject(proof) || typeof proof.id !== 'string') continue;
        if (byId.has(proof.id)) twice.add(proof.id);
        else byId.set(proof.id, proof);
    }
    const memo = new Map();
    const visible = id => {
        if (memo.has(id)) return memo.get(id);
        memo.set(id, false);
        const proof = byId.get(id);
        const ok = !!proof && !twice.has(id) && Object.hasOwn(pins, id) && !proofProblem(proof)
            && pins[id] === pinOf(proof, pins) && proof.parents.every(visible);
        memo.set(id, ok);
        return ok;
    };
    return list.map(entry => entry.proof).filter(proof => isObject(proof) && visible(proof.id));
}

/**
 * The `story.evidence` query (contract §6): `({ ids? }) → Proof[]`, the visible proof in source order, or in
 * the order of `ids` (once each) when they are given; unknown ids are left out and malformed arguments give [].
 * `stored()` → the stored entries (store.proofs); inside a command the transaction's own pending proofs come
 * with the query's tools (`tools.pendingProofs`), so a nested command sees them and a public query does not.
 */
export function createEvidenceQuery({ stored = () => [] } = {}) {
    return function storyEvidence(state, args, tools) {
        let ids = null;
        if (args !== undefined) {
            if (!isObject(args) || Object.keys(args).some(key => key !== 'ids')) return [];
            if (args.ids !== undefined) {
                if (!Array.isArray(args.ids) || args.ids.length > LIMITS.ids || !args.ids.every(isRecordId)) return [];
                ids = [...new Set(args.ids)];
            }
        }
        let pending = [];
        try { pending = typeof tools?.pendingProofs === 'function' ? tools.pendingProofs() ?? [] : []; } catch { pending = []; }
        const seen = visibleProofs(state, merged(stored() ?? [], pending));
        if (!ids) return seen;
        const byId = new Map(seen.map(proof => [proof.id, proof]));
        return ids.filter(id => byId.has(id)).map(id => byId.get(id));
    };
}

// ---------- ctx.proof ----------

/** A new, empty set of what one root has given: by key and in order. */
export const newRoot = () => ({ byKey: new Map(), list: [] });

/**
 * One `ctx.proof(spec)` (contract §6) for the module `who` in a command whose cause, chat, Source and state are
 * given. The checks, in order: INVALID (the call's shape), REFUSED (owner or kind), INVALID (payload, parents),
 * REFUSED (reader intent the host did not see), CONFLICT (same key, other contents), NOT_FOUND (a parent), then
 * the stamped proof. `root` is the transaction's (newRoot), `stored()` the stored entries, `fail(code, message)`
 * throws the bus's error.
 * → { proof, pin, created }; `created: false` is an identical retry, which gives back the proof it made.
 */
export function submitProof(spec, { who, cause, chat, source, state, stored, root, fail }) {
    if (!isObject(spec) || Object.keys(spec).some(key => key !== 'kind' && key !== 'payload' && key !== 'parents')) {
        fail('INVALID', 'A proof is { kind, payload, parents? } and nothing else.');
    }
    const { kind, payload } = spec;
    if (typeof kind !== 'string' || !kind) fail('INVALID', 'A proof names its kind.');
    const owner = Object.hasOwn(OWNERS, kind) ? OWNERS[kind] : null;
    if (!owner) fail('REFUSED', `"${kind}" is not a kind of proof (${KINDS.join(', ')}).`);
    if (owner !== who) fail('REFUSED', `${who} cannot give "${kind}" proof: only ${owner} does.`);
    const bad = payloadProblem(kind, payload);
    if (bad) fail('INVALID', `That is not a "${kind}" proof: ${bad}.`);
    const parents = spec.parents === undefined ? [] : spec.parents;
    if (!Array.isArray(parents) || parents.length > LIMITS.parents || new Set(parents).size !== parents.length || !parents.every(isRecordId)) {
        fail('INVALID', `A proof's parents are up to ${LIMITS.parents} different proof ids.`);
    }
    const unseen = intentProblem(kind, payload, { cause, chat });
    if (unseen) fail('REFUSED', `The host did not see that: ${unseen}.`);
    if (!source) fail('FAILED', 'There is no reply yet to hold a proof.');

    const key = `${kind}:${payloadKey(kind, payload)}`;
    const payloadHash = hashJson(payload);
    const had = root.byKey.get(key);
    if (had) {
        if (had.payloadHash === payloadHash && canonicalJson(had.parents) === canonicalJson(parents)) return { proof: had, pin: null, created: false };
        fail('CONFLICT', `This command already gave "${kind}" proof for ${key.slice(kind.length + 1)} with other contents.`);
    }
    if (root.list.length >= LIMITS.perRoot) fail('LIMITED', `One command gives at most ${LIMITS.perRoot} proofs.`);

    const all = stored() ?? [];
    const pending = root.list.map(proof => ({ proof, block: null }));
    if (parents.length) {
        const found = new Set(visibleProofs(state, merged(all, pending)).map(proof => proof.id));
        const missing = parents.find(id => !found.has(id));
        if (missing) fail('NOT_FOUND', `There is no visible proof ${missing} to be a parent.`);
    }
    // Derived from the reply's evidence id, the block's ordinal and the key: the same in a Re-read of the
    // same block, new for a new swipe. Salted past an id that another block holds.
    const taken = new Set(all.filter(entry => entry.proof.source?.evidence !== source.evidence || entry.proof.source?.ordinal !== source.ordinal).map(entry => entry.proof.id));
    for (const proof of root.list) taken.add(proof.id);
    const id = deriveId('pf', `${source.evidence}:${source.ordinal}:${key}`, taken);
    const proof = Object.freeze({
        id, source: Object.freeze({ ...source }), owner, kind, payload: structuredClone(payload), payloadHash, parents: Object.freeze([...parents]),
    });
    const pin = pinOf(proof, pinsOf(state));
    root.byKey.set(key, proof);
    root.list.push(proof);
    return { proof, pin, created: true };
}
