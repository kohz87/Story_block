// Story Suite v2: the store's pure hashing helpers (moved out of createStore unchanged): the hash of a reply's text, whether a
// record holds guarded blocks, and the spine digest chain a checkpoint is trusted by (REPLAY.md "Checkpoints and covers").
// Each is a function of its input alone; the WeakMaps are caches keyed by the (never changed in place) record or message.
// The chain hash over the staged records (chainHash, windowHash, bodyDigest) reads the store's own state and stays in createStore.

import { payloadText, readRecord, isCarrier } from '../persist.js';
import { hashJson, isMetaSpan, replayInputsOf } from '../replay.js';

// The hash of the text a record's evidence is (REPLAY.md): a reply that is edited or continued has another.
const payloadHashes = new WeakMap();    // message → { mes, hash }: worked out once per text
export function payloadHashOf(message) {
    const mes = message?.mes;
    const hit = payloadHashes.get(message);
    if (hit && hit.mes === mes) return hit.hash;
    const hash = hashJson(payloadText(message));
    if (message && typeof message === 'object') payloadHashes.set(message, { mes, hash });
    return hash;
}

export const hasMeta = record => Array.isArray(record?.spans) && record.spans.some(isMetaSpan);

// The exact prefix a checkpoint was made over (the gate of trust, REPLAY.md "Checkpoints and covers"): a hash chained over
// every record before it as it is shown now, from the first: all of replay.js replayInputsOf (everything replay reads
// from a record), the text of records that hold guarded blocks, and the first record's own starting point. Each link is kept per record while its input stays, so a read costs a lookup
// per record and a change costs the records from it on.
const spineDigests = new WeakMap();
function spineDigest(record) {
    let digest = spineDigests.get(record);
    if (!digest) spineDigests.set(record, digest = hashJson(replayInputsOf(record)));
    return digest;
}
const spineLinks = new WeakMap();
export function spineStep(prev, record, message, first) {
    const text = hasMeta(record) ? payloadHashOf(message) : null;
    const hit = spineLinks.get(record);
    if (hit && hit.prev === prev && hit.text === text && hit.first === first) return hit.out;
    const out = hashJson({ p: prev, d: spineDigest(record), t: text, c: first ? hashJson(record.checkpoint ?? null) : null });
    spineLinks.set(record, { prev, text, first, out });
    return out;
}
// The prefix hash in front of carrier `upTo`; `at(i)` gives the record to use for carrier i (a Re-read passes the ones it is
// about to write).
export function spineBefore(arr, upTo, at = i => readRecord(arr[i])) {
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
