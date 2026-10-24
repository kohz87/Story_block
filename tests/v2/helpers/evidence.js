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
//   sd.cyclic { depth? }            a visit proof whose payload contains itself (or is nested `depth` deep).
//   `! check <id> | dc: n` (capture, with `after: 'check'`) gives a check (event) proof; sd.afterCheck { parent } is the guarded step
//                                   afterCapture asks for on the first check, planned again by a Re-read or a reconcile.
//   sd.gate { value } / sd.ready {}   a gate and a replanned step done only while it is open (two identical `sd.ready` steps stand apart by occurrence).
//   sd.setting {}                   a replanned step whose guard follows `mode` as read when it is planned (a refused plan leaves the old block).
//   sd.dependent { parent }         a guarded system step with a replan that says NO_LONGER_DONE when its parent proof is not shown.
//   `director({ after: 'accepted', sidAt })`  afterCapture asks for one sd.after on each acceptance of the reply that has none yet.
//   `director({ checks: true })`            the `! check` line without the step.
//   `director({ after: 'each', wanted })`   afterCapture asks for one sd.dependent on each visit whose place is in `wanted`.
//   sd.after { parent }             the step afterCapture asks for (`director({ after: true })`): a visit on `parent`, planned again by a Re-read.
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

export function director({ mode = { value: 'normal' }, seen = [], peek = null, after = false, wanted = [], checks = false, sidAt = null } = {}) {
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
            // Gives a visit proof whose payload contains itself (a cycle), or is nested `depth` levels deep.
            'sd.cyclic'(ctx, { depth = 0 }) {
                let payload = { place: 'a' };
                if (depth) for (let n = 0; n < depth; n += 1) payload = { place: 'a', inner: payload };
                else payload.self = payload;
                ctx.proof({ kind: 'visit', payload });
                return { summary: 'unreachable', narrate: false };
            },
            // The step afterCapture asks for with `after: 'check'`: a guarded visit on a check, planned again by a Re-read or a reconcile.
            'sd.afterCheck'(ctx, { parent }) {
                const made = ctx.proof({ kind: 'visit', payload: { after: 'check' }, parents: [parent] });
                ctx.replayGuard({ owner: SD, version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ parent }), predicate: { kind: 'needs', parent } });
                return { summary: 'After the check.', narrate: false, replan: true, data: { made } };
            },
            // A guarded system step that needs its parent proof still shown, and says NO_LONGER_DONE when it is not: planned again by a reconcile or a Re-read.
            'sd.dependent'(ctx, { parent }) {
                if (!ctx.query('story.evidence', { ids: [parent] }).length) ctx.fail('NO_LONGER_DONE', 'Its parent proof is gone.');
                const made = ctx.proof({ kind: 'visit', payload: { after: 'dependent' }, parents: [parent] });
                ctx.replayGuard({ owner: SD, version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ parent }), predicate: { kind: 'needs', parent } });
                return { summary: 'Dependent.', narrate: false, replan: true, data: { made } };
            },
            // A gate the story opens and closes, and a step that is done only while it is open: planned again with the gate shut it is NO_LONGER_DONE.
            'sd.gate'(ctx, { value }) {
                ctx.draft('sdt').ready = value === true;
                return { summary: 'Gate.', narrate: false };
            },
            'sd.ready'(ctx) {
                if (ctx.read('sdt').ready !== true) ctx.fail('NO_LONGER_DONE', 'It is not ready.');
                const made = ctx.proof({ kind: 'visit', payload: { after: 'ready' } });
                ctx.replayGuard({ owner: SD, version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ ready: true }), predicate: { kind: 'accept', thread: T1 } });
                return { summary: 'Ready.', narrate: false, replan: true, data: { made } };
            },
            // A step whose guard follows a setting read when it is planned (`mode`): planned again while the setting is 'deny', its new guard would
            // not hold on replay, so it is not stored; the old block stays, with the guard it was stored with.
            'sd.setting'(ctx) {
                const made = ctx.proof({ kind: 'event', payload: { check: CHECK, actor: 'ac_hero0001', stat: 'STR', dc: mode.value === 'deny' ? 20 : 10 } });
                ctx.replayGuard({ owner: SD, version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ value: mode.value }), predicate: { kind: 'setting' } }, { value: mode.value });
                return { summary: 'Setting.', narrate: false, replan: true, data: { made } };
            },
            // The step afterCapture asks for: a visit on the acceptance it found (it is planned again by a Re-read).
            'sd.after'(ctx, { parent }) {
                const made = ctx.proof({ kind: 'visit', payload: { place: 'after' }, parents: [parent] });
                return { summary: 'After.', narrate: false, replan: true, data: { made } };
            },
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
            kinds: {
                accept: { grammar: '! accept Thread | words: what the reader said' },
                ...(after === 'check' || checks ? { check: { grammar: '! check Id | dc: number' } } : {}),
            },
            apply(ctx, line) {
                if (line.kind === 'check') {
                    const done = ctx.call('sd.many', { specs: [{ kind: 'event', payload: { check: line.name, actor: 'ac_hero0001', stat: 'STR', dc: Number(line.labels.dc) } }] });
                    return { summary: done.summary, narrate: false, data: done.data };
                }
                const done = ctx.call('sd.accept', { thread: line.name, words: line.labels.words ?? '' });
                return { summary: done.summary, narrate: false, data: done.data };
            },
        },
        hooks: {
            // With `after`: once a reply's lines have run, a visit that builds on the reply's last acceptance (a planned step).
            ...(after === 'check' ? {
                // A step that builds on the first check of the story, whichever reply it stands on.
                afterCapture(view) {
                    const check = view.query('story.evidence', {}).find(proof => proof.kind === 'event' && proof.payload.check);
                    return { commands: check ? [{ type: 'sd.afterCheck', payload: { parent: check.id } }] : [] };
                },
            } : after === 'each' ? {
                // A step on each earlier visit whose place is in `wanted`, in the order the proof stand: steps of one key, one reply.
                afterCapture(view) {
                    const visits = view.query('story.evidence', {}).filter(proof => proof.kind === 'visit' && wanted.includes(proof.payload.place));
                    return { commands: visits.map(proof => ({ type: 'sd.dependent', payload: { parent: proof.id } })) };
                },
            } : after === 'accepted' ? {
                // A step on each acceptance of this reply (`sidAt(index)`) that has none yet: asking again gives the steps it gave.
                afterCapture(view, { index }) {
                    const shown = view.query('story.evidence', {});
                    const sid = sidAt?.(index);
                    const mine = shown.filter(proof => proof.kind === 'acceptance' && proof.source.sid === sid && !shown.some(other => other.kind === 'visit' && other.parents[0] === proof.id));
                    return { commands: mine.map(proof => ({ type: 'sd.after', payload: { parent: proof.id } })) };
                },
            } : after ? {
                afterCapture(view) {
                    const accepted = view.query('story.evidence', {}).filter(proof => proof.kind === 'acceptance').at(-1);
                    return { commands: accepted ? [{ type: 'sd.after', payload: { parent: accepted.id } }] : [] };
                },
            } : {}),
            replayGuard({ query }, { guard, recorded }) {
                if (guard.predicate.kind === 'setting') return recorded?.value === 'deny' ? { ok: false, reason: 'its setting is off' } : { ok: true };
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
