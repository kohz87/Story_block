// Seeded fuzz of proof (docs/v2/EVIDENCE.md, SPEC §2.2 "replay == live"): replies, proofs with parents, middle deletes,
// new swipes and swipe picks, a guard that turns a block off, and checkpoints. After every step the proof the
// store shows (story.evidence) is exactly what an independent model of the chat says is visible: given on a reply
// that is still there, on the swipe that is shown, on a block the guard lets through, with every parent visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prng } from './qa/helpers/seeded.js';
import { newSwipe, showSwipe } from './helpers/store-chat.js';
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
        assert.deepEqual(got, expected(denied), `seed ${seed}, ${when}\n${log.join('\n')}`);
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
        const kind = r.int(0, 11);
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
