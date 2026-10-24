// Small test-only owners for the proof and evidence tests (docs/v2/EVIDENCE.md). They stand for the two modules
// that own kinds of proof (the ids the host's table names: `story-director`, `rpg-battle`) with rules made up
// for the tests; none of it is a rule of the real modules.
//
// `story-director` (domain `sdt`: accepted (by proof id), rolls, log):
//   sd.accept { thread, selection | words, parents? }   gives an acceptance proof and notes it under its proof id.
//   sd.roll { check, actor, stat, dc, parents? }        asks story.evidence for its parents (it sees the root's
//                                                       pending proof), rolls a die and gives a check (event) proof.
//   sd.visit { place, parents? } / sd.event { event, parents? }   proofs nobody has shaped (opaque payloads).
//   sd.lying { place }              gives a visit proof and returns receipt data that claims evidence and a source.
//   sd.many { specs, chain? }       calls ctx.proof once for each spec, as given (`chain`: each later one names
//                                   the one before as its parent) → the results; the first refusal fails the root.
//   sd.needs { thread, selection, parent }   an acceptance under a guard that asks story.evidence for `parent`.
//   sd.guarded { thread, selection, parents? }   an acceptance under a guard that holds while `mode.value` is not 'deny'.
//   `! accept <thread> | words: …` (capture)   an acceptance by the reader's words.
// `rpg-battle` (domain `rpgt`: xp, kills):
//   rb.kill { foe, parents? }       a kill proof.
//   rb.quest { thread, selection | words, check, after? }   one root: accepts, rolls (nested story-director
//                                   commands, the accept twice), then its own story proof on both; `after: 'fail'`
//                                   refuses at the end.
//   `! kill <foe> | after: <thread>` (capture)   a kill that builds on the thread's acceptance, given by an earlier line.
//   rb.many { specs, chain? }       the same for rpg-battle.
import { createEvidenceQuery } from '../../../src/v2/evidence.js';
import { runQuery } from '../../../src/v2/sdk.js';
import { EPOCH, harness } from './guarded.js';

export const SD = 'story-director';
export const RB = 'rpg-battle';
export const [T1, T2] = ['th_thread01', 'th_thread02'];
export const CHECK = 'ck_check001';

/** The host's own `story.evidence` query, over the store a harness makes later (`link(store)`). */
export function hostModule() {
    let store = null;
    return {
        link: value => { store = value; },
        def: {
            id: 'story-block', name: 'Story Block', version: '0.0.1',
            queries: { 'story.evidence': createEvidenceQuery({ stored: () => store?.proofs() ?? [] }) },
        },
    };
}

// Gives each spec as ctx.proof(spec) (the refusal of any of them fails the whole root); `chain` names the previous
// result as the parent of each later spec.
function many(ctx, { specs, chain = false }) {
    const out = [];
    for (const spec of specs) {
        const parents = chain && out.length ? { parents: [out.at(-1).id] } : {};
        out.push(ctx.proof({ ...spec, ...parents }));
    }
    ctx.draft(ctx.module === SD ? 'sdt' : 'rpgt').log.push(out.length);
    return { summary: `Gave ${out.length} proofs.`, narrate: false, data: { proofs: out } };
}

export function director({ mode = { value: 'normal' }, seen = [], peek = null } = {}) {
    const accept = (ctx, { thread, selection, words, parents }) => {
        const payload = selection !== undefined ? { thread, selection } : { thread, words };
        const made = ctx.proof({ kind: 'acceptance', payload, ...(parents ? { parents } : {}) });
        ctx.draft('sdt').accepted[made.id] = { thread };
        return { summary: `Accepted ${thread}.`, narrate: false, data: { proof: made } };
    };
    return {
        id: SD, name: 'Director', version: '0.0.1',
        domains: { sdt: { initial: () => ({ accepted: {}, rolls: {}, log: [] }) } },
        commands: {
            'sd.accept': accept,
            'sd.roll'(ctx, { check, actor, stat, dc, parents = [] }) {
                // A nested command sees the proof its root has given so far, validated, and no one else does.
                const found = ctx.query('story.evidence', { ids: parents });
                seen.push(found.map(proof => proof.id));
                if (found.length !== parents.length) ctx.fail('REFUSED', 'A parent proof is not there.');
                const die = ctx.roll('1d20').total;
                ctx.draft('sdt').rolls[check] = die;
                const made = ctx.proof({ kind: 'event', payload: { check, actor, stat, dc }, parents });
                if (peek) peek();
                return { summary: `Rolled ${die}.`, narrate: false, data: { proof: made, die } };
            },
            'sd.visit'(ctx, { place, parents }) {
                const made = ctx.proof({ kind: 'visit', payload: { place }, ...(parents ? { parents } : {}) });
                return { summary: `Visited ${place}.`, narrate: false, data: { proof: made } };
            },
            'sd.event'(ctx, { event, parents }) {
                const made = ctx.proof({ kind: 'event', payload: { event }, ...(parents ? { parents } : {}) });
                return { summary: `Event ${event}.`, narrate: false, data: { proof: made } };
            },
            'sd.many': many,
            // Gives a proof and returns a receipt that claims evidence and a source of its own.
            'sd.lying'(ctx, { place }) {
                const made = ctx.proof({ kind: 'visit', payload: { place } });
                return { summary: 'x', narrate: false, data: { v2: { key: 'mine', evidence: [{ id: 'pf_fake0000' }], source: { fake: true } }, made } };
            },
            // An acceptance whose guard needs a proof to still be shown: the hook asks story.evidence for it.
            'sd.needs'(ctx, { thread, selection, parent }) {
                const done = accept(ctx, { thread, selection, parents: [parent] });
                ctx.replayGuard({ owner: SD, version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ thread, parent }), predicate: { kind: 'needs', parent } });
                return done;
            },
            'sd.guarded'(ctx, { thread, selection, parents }) {
                const done = accept(ctx, { thread, selection, parents });
                ctx.replayGuard({ owner: SD, version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ thread }), predicate: { kind: 'accept', thread } });
                return done;
            },
        },
        capture: {
            kinds: { accept: { grammar: '! accept Thread | words: what the reader said' } },
            apply(ctx, line) {
                const done = ctx.call('sd.accept', { thread: line.name, words: line.labels.words ?? '' });
                return { summary: done.summary, narrate: false, data: done.data };
            },
        },
        hooks: {
            replayGuard({ query }, { guard }) {
                if (guard.predicate.kind === 'needs') {
                    return query('story.evidence', { ids: [guard.predicate.parent] }).length === 1 ? { ok: true } : { ok: false, reason: 'its parent proof is not shown' };
                }
                return mode.value === 'deny' ? { ok: false, reason: 'the offer is gone' } : { ok: true };
            },
        },
    };
}

export function fighter() {
    return {
        id: RB, name: 'Battle', version: '0.0.1',
        domains: { rpgt: { initial: () => ({ xp: 0, kills: [], log: [] }), counters: ['xp'] } },
        commands: {
            'rb.kill'(ctx, { foe, parents }) {
                const made = ctx.proof({ kind: 'kill', payload: { foe }, ...(parents ? { parents } : {}) });
                ctx.draft('rpgt').kills.push(foe);
                return { summary: `Killed ${foe}.`, narrate: false, data: { proof: made } };
            },
            'rb.quest'(ctx, { thread, selection, words, check, after = 'ok' }) {
                const accepted = ctx.call('sd.accept', selection !== undefined ? { thread, selection } : { thread, words });
                const rolled = ctx.call('sd.roll', { check, actor: 'ac_hero0001', stat: 'STR', dc: 12, parents: [accepted.data.proof.id] });
                const again = ctx.call('sd.accept', selection !== undefined ? { thread, selection } : { thread, words });
                if (again.data.proof.id !== accepted.data.proof.id) ctx.fail('FAILED', 'A retry must give the same id.');
                const story = ctx.proof({ kind: 'story', payload: { thread, step: 1 }, parents: [accepted.data.proof.id, rolled.data.proof.id] });
                ctx.draft('rpgt').xp += 5;
                if (after === 'fail') ctx.fail('REFUSED', 'Refused at the end.');
                return { summary: 'Quest step.', narrate: false, data: { accepted: accepted.data.proof, rolled: rolled.data.proof, story } };
            },
            'rb.many': many,
        },
        capture: {
            kinds: { kill: { grammar: '! kill Foe | after: thread' } },
            // A kill that builds on the acceptance of its thread, which an earlier line of the same reply gave.
            apply(ctx, line) {
                const accepted = ctx.query('story.evidence', {}).find(proof => proof.kind === 'acceptance' && proof.payload.thread === line.labels.after);
                if (!accepted) ctx.fail('NOT_FOUND', `No acceptance of ${line.labels.after} to build on.`);
                const done = ctx.call('rb.many', { specs: [{ kind: 'kill', payload: { foe: line.name }, parents: [accepted.id] }] });
                return { summary: done.summary, narrate: false, data: done.data };
            },
        },
    };
}

/**
 * A harness (guarded.js) with the host's story.evidence, both owners and `extra` modules. `ask(name, args)` runs
 * a public query on the head, as the sdk does: stored and pinned proof only.
 */
export function evidenceHarness({ extra = [], options = {}, mode, seen, peek } = {}) {
    const host = hostModule();
    const h = harness([host.def, director({ mode, seen, peek }), fighter(), ...extra], options);
    host.link(h.store);
    return Object.assign(h, {
        ask: (args) => runQuery(h.registry, h.store.head(), 'story.evidence', args, { receipts: () => h.store.receipts() }),
        proofsOf: index => h.spans(index).flatMap(span => span.evidence ?? []),
        sdt: () => h.store.head().domains.sdt,
    });
}

export { EPOCH };
