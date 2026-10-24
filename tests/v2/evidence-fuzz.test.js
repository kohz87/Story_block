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
    // Even seeds keep checkpoints (every 2 carriers); odd seeds do not, and turn the guard off now and then. A guard is
    // asked on replay only for the blocks after the latest checkpoint (REPLAY.md "Checkpoints"), so the two do not mix.
    const checkpoints = seed % 2 === 0;
    const h = evidenceHarness({ mode, options: checkpoints ? { checkpointEvery: 2 } : {} });
    // One entry per block that gave a proof (an id may be given by more than one, by hand): { uid, id, msg, swipe, parents, guarded,
    // needs, parentOwners }. parentOwners: for each parent, the entry that owned its id when this one was given (its pin covers that
    // parent's bytes). `needs`: a step whose guard wants that proof shown. `removed`: a step a reconcile took back.
    const model = [];
    const log = [];

    const alive = e => !e.removed && h.chat.includes(e.msg) && e.msg.swipe_id === e.swipe;
    const place = e => h.chat.indexOf(e.msg);
    // Apply order is chat order, then the order given. The block that applied first with an id owns it; a later one collides. A step
    // applies only while its guard's proof is shown on what has applied before it; a guarded block while the guard allows.
    const resolve = denied => {
        const owners = new Map();
        const visibleIn = e => {
            if (owners.get(e.id) !== e) return false;
            return e.parents.every(parent => {
                const owner = owners.get(parent);
                return owner !== undefined && owner === e.parentOwners.get(parent) && visibleIn(owner);
            });
        };
        const sorted = model.filter(alive).sort((a, b) => place(a) - place(b) || a.uid - b.uid);
        for (const e of sorted) {
            if (denied && e.guarded) continue;
            if (e.needs) {
                const owner = owners.get(e.needs);
                if (!(owner && visibleIn(owner))) continue;
            }
            if (!owners.has(e.id)) owners.set(e.id, e);
        }
        return { owners, visibleIn, sorted };
    };
    const expected = denied => {
        const { owners, visibleIn, sorted } = resolve(denied);
        return sorted.filter(e => owners.get(e.id) === e && visibleIn(e)).map(e => e.id);
    };
    const check = (denied, when) => {
        const got = h.ask().map(proof => proof.id);
        assert.equal(new Set(got).size, got.length, `seed ${seed}, ${when}: an id is shown twice`);
        assert.deepEqual(got, expected(denied), `seed ${seed}, ${when}\n${log.join('\n')}`);
        for (const proof of h.ask()) for (const parent of proof.parents) assert.ok(got.includes(parent), 'every parent of a shown proof is shown');
        assert.deepEqual(h.problems().filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), [], `seed ${seed}, ${when}`);
    };
    const visibleIds = () => h.ask().map(proof => proof.id);
    const last = () => h.chat.findLast(message => !message.is_user);
    const give = (type, payload, { guarded = false, needs = null } = {}) => {
        const out = h.command(type, payload, needs ? 'system' : 'ui');
        assert.equal(out.ok, true, `${type} ${JSON.stringify(payload)}: ${out.message}`);
        const msg = last();
        const now = resolve(false).owners;
        for (const made of out.receipt.data.proofs ?? [out.receipt.data.proof ?? out.receipt.data.made]) {
            const parents = needs ? [needs] : payload.specs?.[0]?.parents ?? payload.parents ?? [];
            model.push({ uid: model.length, id: made.id, msg, swipe: msg.swipe_id, parents, guarded, needs, parentOwners: new Map(parents.map(id => [id, now.get(id)])) });
        }
    };

    h.send();
    for (let step = 0; step < steps; step += 1) {
        const pool = visibleIds();
        const parents = r.chance(0.5) && pool.length ? [...new Set(Array.from({ length: r.int(1, 2) }, () => r.pick(pool)))] : [];
        const kind = r.int(0, 16);
        if (kind <= 2) {
            log.push(`${step}: kill`);
            give('rb.many', { specs: [{ kind: 'kill', payload: { foe: `foe-${step}` }, ...(parents.length ? { parents } : {}) }] });
        } else if (kind === 3 || kind === 4) {
            log.push(`${step}: visit`);
            give('sd.many', { specs: [{ kind: 'visit', payload: { place: `place-${step}` }, ...(parents.length ? { parents } : {}) }] });
        } else if (kind === 5) {
            log.push(`${step}: guarded accept`);
            give('sd.guarded', { thread: r.pick([T1, T2]), selection: `pick-${step}`, ...(parents.length ? { parents } : {}) }, { guarded: true });
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
                model.push({ uid: model.length, id: owner, msg: message, swipe: message.swipe_id, parents: [], guarded: false, needs: null, parentOwners: new Map() });
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
        } else if (kind === 15) {
            // A system step that needs a proof shown, planned again by a reconcile.
            const message = last();
            if (message && message !== h.chat[0] && pool.length) {
                const parent = r.pick(pool);
                log.push(`${step}: a step that needs ${parent}`);
                give('sd.dependent', { parent }, { needs: parent });
            }
        } else if (kind === 16) {
            // A reconcile from an early point (the steps after it are planned again; one whose parent is not shown is taken back).
            const carriers = h.chat.map((message, at) => (!message.is_user ? at : -1)).filter(at => at >= 0);
            const from = r.pick(carriers);
            log.push(`${step}: reconcile from ${from}`);
            const shownBefore = expected(false);
            const done = h.store.reconcile(from, { rerun: (state, receipt, info) => h.bus.run(info.replan.type, info.replan.payload, {
                cause: 'system', state, seed: info.replan.seed, replacing: (info.span.evidence ?? []).map(proof => proof.id),
                reply: { index: info.index, sid: h.store.carrierSid(info.index), ordinal: info.span.source.ordinal },
            }) });
            // The model: each step from there on whose parent is not shown where it stands is taken back, one after another.
            let taken = 0;
            for (;;) {
                const { owners, visibleIn, sorted } = resolve(false);
                void owners;
                const gone = sorted.find(e => e.needs && place(e) >= from && !e.removed && !(owners.get(e.needs) && visibleIn(owners.get(e.needs))));
                if (!gone) break;
                gone.removed = true;
                taken += 1;
            }
            void shownBefore;
            assert.equal(done.removed ?? 0, taken, `seed ${seed}, step ${step}: the steps a reconcile takes back are the ones whose parent is gone\n${log.join('\n')}`);
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
            for (const entry of model) if (index.has(entry.msg)) entry.msg = h.chat[index.get(entry.msg)];
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
