// Seeded fuzz of proof (docs/v2/EVIDENCE.md, SPEC §2.2 "replay == live"): replies, proofs with parents, middle deletes,
// new swipes and swipe picks, a guard that turns a block off, and checkpoints. After every step the proof the
// store shows (story.evidence) is exactly what an independent model of the chat says is visible: given on a reply
// that is still there, on the swipe that is shown, on a block the guard lets through, with every parent visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prng } from './qa/helpers/seeded.js';
import { newSwipe, showSwipe } from './helpers/store-chat.js';
import { pinOf } from '../../src/v2/evidence.js';
import { T1, T2, evidenceHarness } from './helpers/evidence.js';

const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : [1, 2, 3, 4, 5, 6, 7, 8, 13, 21];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 60;

function run(seed, steps) {
    const r = prng(seed);
    const mode = { value: 'normal' };
    // Even seeds keep checkpoints (every 4 carriers); odd seeds do not, and turn the guard off now and then. A guard is
    // asked on replay only for the blocks after the latest checkpoint (REPLAY.md "Checkpoints"), so the two do not mix.
    const checkpoints = seed % 2 === 0;
    const h = evidenceHarness({ mode, options: checkpoints ? { checkpointEvery: 4 } : {} });
    const model = [];               // { id, msg, swipe, parents, guarded } in the order they were given
    const byId = new Map();
    const log = [];
    const dupIds = new Set();   // ids a later block was made to reuse by hand: which block owns them follows the apply order, not the model

    const alive = proof => h.chat.includes(proof.msg) && proof.msg.swipe_id === proof.swipe;
    const expected = denied => {
        const memo = new Map();
        const visible = proof => {
            if (memo.has(proof.id)) return memo.get(proof.id);
            memo.set(proof.id, false);
            const ok = alive(proof) && !(denied && proof.guarded) && proof.parents.every(id => visible(byId.get(id)));
            memo.set(proof.id, ok);
            return ok;
        };
        const shown = model.filter(visible);
        // Source order: by the reply's place in the chat, then in the order they were given.
        return shown.map((proof, at) => ({ proof, at })).sort((a, b) => h.chat.indexOf(a.proof.msg) - h.chat.indexOf(b.proof.msg) || a.at - b.at).map(entry => entry.proof.id);
    };
    const check = (denied, when) => {
        const got = h.ask().map(proof => proof.id);
        assert.equal(new Set(got).size, got.length, `seed ${seed}, ${when}: an id is shown twice`);
        // What hangs on an id a hand edit gave to another block is not compared either: the id lives on with the other block's bytes.
        const tainted = id => dupIds.has(id) || (byId.get(id)?.parents ?? []).some(tainted);
        assert.deepEqual(got.filter(id => !tainted(id)), expected(denied).filter(id => !tainted(id)), `seed ${seed}, ${when}\n${log.join('\n')}`);
        for (const proof of h.ask()) for (const parent of proof.parents) assert.ok(got.includes(parent), 'every parent of a shown proof is shown');
        assert.deepEqual(h.problems().filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), [], `seed ${seed}, ${when}`);
    };
    const visibleIds = () => h.ask().map(proof => proof.id);
    const last = () => h.chat.findLast(message => !message.is_user);
    const give = (type, payload, guarded = false) => {
        const out = h.command(type, payload);
        assert.equal(out.ok, true, `${type} ${JSON.stringify(payload)}: ${out.message}`);
        const msg = last();
        for (const made of out.receipt.data.proofs ?? [out.receipt.data.proof]) {
            const parents = payload.specs?.[0]?.parents ?? payload.parents ?? [];
            model.push({ id: made.id, msg, swipe: msg.swipe_id, parents, guarded });
            byId.set(made.id, model.at(-1));
        }
    };

    h.send();
    for (let step = 0; step < steps; step += 1) {
        const pool = visibleIds();
        const parents = r.chance(0.5) && pool.length ? [...new Set(Array.from({ length: r.int(1, 2) }, () => r.pick(pool)))] : [];
        const kind = r.int(0, 14);
        if (kind <= 2) {
            log.push(`${step}: kill`);
            give('rb.many', { specs: [{ kind: 'kill', payload: { foe: `foe-${step}` }, ...(parents.length ? { parents } : {}) }] });
        } else if (kind === 3 || kind === 4) {
            log.push(`${step}: visit`);
            give('sd.many', { specs: [{ kind: 'visit', payload: { place: `place-${step}` }, ...(parents.length ? { parents } : {}) }] });
        } else if (kind === 5) {
            log.push(`${step}: guarded accept`);
            give('sd.guarded', { thread: r.pick([T1, T2]), selection: `pick-${step}`, ...(parents.length ? { parents } : {}) }, true);
            model.at(-1).parents = parents;
        } else if (kind === 6) {
            log.push(`${step}: send`);
            h.send();
        } else if (kind === 7) {
            // A middle (or the last) reply is deleted with the reader's message before it; never the greeting.
            const replies = h.chat.map((message, at) => (at > 0 && !message.is_user ? at : -1)).filter(at => at > 0);
            if (replies.length > 1) {
                const at = r.pick(replies);
                log.push(`${step}: delete reply ${at}`);
                h.chat.splice(at - 1, 2);
                h.store.rebuild();
            }
        } else if (kind === 8) {
            const message = last();
            if (message && message !== h.chat[0]) {
                log.push(`${step}: new swipe`);
                newSwipe(message, `Try ${step}.`);
                h.store.rebuild();
            }
        } else if (kind === 9) {
            const message = last();
            if (message && message.swipes.length > 1) {
                const swipe = r.int(0, message.swipes.length - 1);
                log.push(`${step}: show swipe ${swipe}`);
                showSwipe(message, swipe);
                h.store.rebuild();
            }
        } else if (kind === 10 && !checkpoints) {
            log.push(`${step}: guard off, then on`);
            mode.value = 'deny';
            h.store.rebuild();
            check(true, `step ${step} with the guard off`);
            mode.value = 'normal';
            h.store.rebuild();
        } else if (kind === 13) {
            // A later block takes the id of a proof that is shown: the block that applied first keeps it (the later one collides).
            const message = last();
            const record = message?.extra?.storySuite;
            const owner = pool.length ? r.pick(pool) : null;
            if (record && owner && message !== h.chat[0]) {
                const made = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: `dup-${step}` } }] });
                assert.equal(made.ok, true, made.message);
                const taken = made.receipt.data.proofs[0].id;
                const copy = structuredClone(message.extra.storySuite);
                const span = copy.spans.find(each => each.evidence?.some(proof => proof.id === taken));
                const proof = span.evidence.find(each => each.id === taken);
                const before = h.ask({ ids: [owner] })[0];
                proof.id = owner;
                const pin = pinOf(proof, {});
                copy.ops = copy.ops.map(op => (op?.path === `/meta/proofs/${taken}` ? { ...op, path: `/meta/proofs/${owner}`, value: pin } : op?.path === "/meta/proofs" && op.value?.[taken] ? { ...op, value: { [owner]: pin } } : op));
                message.extra.storySuite = copy;
                dupIds.add(owner);
                log.push(`${step}: a later block takes the id of a shown proof`);
                h.store.rebuild();
                const after = h.ask({ ids: [owner] })[0];
                assert.equal(after?.payloadHash, before.payloadHash, `seed ${seed}, step ${step}: the block that applied first keeps its id, with its bytes`);
            }
        } else if (kind === 14) {
            // A change of a block that is not a change (null, a number, no path, a path that is not text): the block is not applied,
            // gives no proof, and nothing throws.
            const message = last();
            const record = message?.extra?.storySuite;
            if (record && message !== h.chat[0]) {
                const made = h.command('sd.many', { specs: [{ kind: 'visit', payload: { place: `bad-${step}` } }] });
                assert.equal(made.ok, true, made.message);
                const copy = structuredClone(message.extra.storySuite);
                const span = copy.spans.find(each => each.evidence?.some(proof => proof.id === made.receipt.data.proofs[0].id));
                copy.ops.splice(copy.ops.length - span.n, 0, r.pick([null, 7, 'x', { op: 'add', value: 1 }, { op: 'add', path: 5, value: 1 }, { op: 'add', path: 'meta', value: 1 }]));
                span.n += 1;
                message.extra.storySuite = copy;
                log.push(`${step}: a block with a change that is not one`);
                h.store.rebuild();
                assert.deepEqual(h.ask({ ids: [made.receipt.data.proofs[0].id] }), [], `seed ${seed}, step ${step}: the damaged block gives no proof`);
            }
        } else if (kind === 12) {
            // A hand-edited block with no metadata appended to the head reply: it writes, rewrites or erases the pins, or the
            // state around them. Replay refuses it, so nothing that was shown goes and nothing new is.
            const message = last();
            const record = message?.extra?.storySuite;
            if (record && message !== h.chat[0]) {
                const hostile = r.pick([
                    [{ op: 'replace', path: '/meta/proofs', value: {} }],
                    [{ op: 'remove', path: '/meta/proofs' }],
                    [{ op: 'replace', path: '/meta', value: { rev: 1, claims: {} } }],
                    [{ op: 'replace', path: '', value: { v: 2, meta: { rev: 1, claims: {} }, domains: {} } }],
                    [{ op: 'add', path: '/meta/proofs/pf_hostile01', value: 'x' }],
                    [{ op: 'copy', from: '/meta/proofs', path: '/meta/backup' }],
                ]);
                const rev = Math.max(0, ...record.ops.filter(op => op?.path === '/meta/rev').map(op => op.value)) + 1;
                const ops = [...hostile, { op: 'replace', path: '/meta/rev', value: rev }];
                log.push(`${step}: hostile block ${JSON.stringify(hostile[0].op)} ${hostile[0].path}`);
                message.extra.storySuite = { ...record, ops: [...record.ops, ...ops], spans: [...record.spans, { n: ops.length, story: false }] };
                h.store.rebuild();
            }
        } else {
            log.push(`${step}: reload`);
            const copy = JSON.parse(JSON.stringify(h.chat));
            // The model follows the chat's messages, so it is re-pointed at the copies.
            const index = new Map(h.chat.map((message, at) => [message, at]));
            h.chat.splice(0, h.chat.length, ...copy);
            for (const proof of model) if (index.has(proof.msg)) proof.msg = h.chat[index.get(proof.msg)];
            h.store.rebuild();
        }
        check(false, `step ${step}`);
        // Live equals replay: what the head shows now is what a cold rebuild shows.
        const live = JSON.stringify(h.ask());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.ask()), live, `seed ${seed}, step ${step}: live equals replay\n${log.join('\n')}`);
    }
    return model.length;
}

for (const seed of SEEDS) {
    test(`proof fuzz seed ${seed}: what story.evidence shows is what the chat says is visible, live and after every replay`, () => {
        const given = run(seed, STEPS);
        assert.ok(given > 5, 'the run gave proof');
    });
}
