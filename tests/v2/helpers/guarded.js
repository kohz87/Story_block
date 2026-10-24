// A small test-only module for the guarded-replay tests (docs/v2/REPLAY.md). It stands for "an owner that
// uses ctx.replayGuard", with rules of its own made up for the tests (a quest board, a pool of lost HP, a
// clock and a training attempt): none of it is a rule of any real module.
//
// Domain `gt`: quests (id → { id, instance, state }), proofs (id → true), coin, lost (actor → number lost),
// credits (id → number), attempts (id → number), minutes (a clock), log.
//   gt.offer { id, instance }      puts a quest on the board (open).
//   gt.prove { id }                records a proof for a quest.
//   gt.settle { id, instance, reward }   needs the quest open and its proof; closes it, pays the reward and
//                                  claims `gt:<epoch>:quest:<id>:<instance>:settled`. Guarded: on replay it is
//                                  applied only while the quest is open at that instance and the proof is there.
//   gt.settleLoose { … }           the same without a guard (the control: only the ops decide).
//   gt.spend { amount, key }       spends coin under a guard that always holds, claiming `gt:<epoch>:spend:<key>`.
//   gt.hit { actor, amount }       adds to what the actor lost.
//   gt.recover { actor }           resets what the actor lost to 0 with ctx.absolute. Guarded: valid only
//                                  while the same hit is still there.
//   gt.recoverDelta { actor }      the same reset written as a plain change (the mistake ctx.absolute prevents).
//   gt.attempt { id }              a training attempt: credit 1 when the clock is at 60 minutes or more, else a
//                                  zero-credit attempt (still recorded). Draws a die from the receipt's seed.
//                                  Guarded and `replan`: planned again on the clock as it stands at its place.
//   gt.quick { id }                offers and settles at once (a one-command quest), guarded.
//   gt.reset { actor }             an absolute reset of what the actor lost, no guard.
//   gt.withdraw { id }             takes a quest off the board (a plain click).
//   gt.collect { id }              a guarded, replanned system step: needs the clock at 10+, pays 3, claims once.
//   `! tick <minutes>` (capture)   sets the clock (a story line); `! offer <id>` puts a quest on the board;
//                                  `! quick <id>` is gt.quick as a guarded story line.
// Hook `replayGuard` answers by `guard.predicate.kind`; `mode` switches it to misbehave (throw, a promise,
// no reason, nonsense), and `asked` collects what it was given.
import { createCommandBus } from '../../../src/v2/commands.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createStore } from '../../../src/v2/store.js';
import { greeting, initial, reply, user } from './store-chat.js';

export const EPOCH = 'ep_00000001';
export const OWNER = 'zz-guarded';
// Quest ids are record ids (an `id` field in the state must be one).
export const [Q1, Q2, Q5, Q9] = ['th_questone', 'th_questtwo', 'th_questfiv', 'th_questnin'];
export const claimKey = (id, instance) => `gt:${EPOCH}:quest:${id}:${instance}:settled`;

export function guarded({ mode = { value: 'normal' }, asked = [], epoch = EPOCH } = {}) {
    const make = (ctx, predicate, inputs) => ({ owner: OWNER, version: 2, epoch, rulesHash: null, inputHash: ctx.hash({ predicate, inputs }), predicate });
    const settle = loose => (ctx, { id, instance, reward }) => {
        const gt = ctx.draft('gt');
        const quest = gt.quests[id];
        if (!quest || quest.state !== 'open' || quest.instance !== instance) ctx.fail('NOT_FOUND', 'That quest is not open.');
        if (!gt.proofs[id]) ctx.fail('REFUSED', 'Nothing proves it was done.');
        if (!loose) ctx.replayGuard(make(ctx, { kind: 'settle', id, instance, reward }, { state: 'open', proof: true }), { reward });
        if (!ctx.claim(claimKey(id, instance))) ctx.fail('CLAIMED', 'Already settled.');
        quest.state = 'done';
        gt.coin += reward;
        return { summary: `Settled ${id}: ${reward} coin.`, narrate: false, data: { v2: { key: `settle:${id}:${instance}`, result: { id, instance, paid: reward } } } };
    };
    return {
        id: OWNER, name: 'Guarded', version: '0.0.1',
        domains: {
            gt: {
                initial: () => ({ quests: {}, proofs: {}, coin: 0, lost: {}, credits: {}, attempts: {}, minutes: 0, log: [] }),
                counters: ['coin', 'lost/*', 'credits/*', 'attempts/*'],
                validate: slice => [
                    ...(slice.coin < 0 ? ['gt: coin below zero'] : []),
                    ...Object.entries(slice.lost).filter(([, value]) => value < 0).map(([actor]) => `gt: ${actor} lost below zero`),
                ],
            },
        },
        commands: {
            'gt.offer'(ctx, { id, instance = 1 }) {
                ctx.draft('gt').quests[id] = { id, instance, state: 'open' };
                return { summary: `Offered ${id}.`, narrate: false };
            },
            'gt.prove'(ctx, { id }) {
                ctx.draft('gt').proofs[id] = true;
                return { summary: `Proved ${id}.`, narrate: false };
            },
            'gt.settle': settle(false),
            'gt.settleLoose': settle(true),
            'gt.quick'(ctx, { id }) {
                const gt = ctx.draft('gt');
                gt.quests[id] = { id, instance: 1, state: 'done' };
                ctx.replayGuard(make(ctx, { kind: 'quick', id }, {}));
                if (!ctx.claim(claimKey(id, 1))) ctx.fail('CLAIMED', 'Already settled.');
                gt.coin += 1;
                return { summary: `Quick ${id}.`, narrate: false, data: { v2: { result: { id } } } };
            },
            // Spends coin under a guard that always holds; the domain's validator is what can refuse it on replay.
            'gt.spend'(ctx, { amount, key }) {
                const gt = ctx.draft('gt');
                ctx.replayGuard(make(ctx, { kind: 'quick', id: key }, {}));
                if (!ctx.claim(`gt:${EPOCH}:spend:${key}`)) ctx.fail('CLAIMED', 'Already spent.');
                gt.coin -= amount;
                return { summary: `Spent ${amount}.`, narrate: false };
            },
            'gt.hit'(ctx, { actor, amount }) {
                const gt = ctx.draft('gt');
                gt.lost[actor] = (gt.lost[actor] ?? 0) + amount;
                return { summary: `${actor} loses ${amount}.`, narrate: false };
            },
            'gt.recover'(ctx, { actor }) {
                const gt = ctx.draft('gt');
                const lost = gt.lost[actor] ?? 0;
                if (!lost) ctx.fail('REFUSED', 'Nothing to recover.');
                ctx.replayGuard(make(ctx, { kind: 'recover', actor, lost }, { lost }));
                ctx.absolute('gt', `/lost/${actor}`);
                gt.lost[actor] = 0;
                return { summary: `${actor} recovers fully.`, narrate: false };
            },
            'gt.recoverDelta'(ctx, { actor }) {
                const gt = ctx.draft('gt');
                gt.lost[actor] = 0;
                return { summary: `${actor} recovers (as a change).`, narrate: false };
            },
            // An absolute reset with no guard (every numeric reset goes through ctx.absolute).
            'gt.reset'(ctx, { actor }) {
                const gt = ctx.draft('gt');
                ctx.absolute('gt', `/lost/${actor}`);
                gt.lost[actor] = 0;
                return { summary: `${actor} is whole.`, narrate: false };
            },
            // The reader takes a quest off the board (a plain click, no guard).
            'gt.withdraw'(ctx, { id }) {
                delete ctx.draft('gt').quests[id];
                return { summary: `Withdrew ${id}.`, narrate: false };
            },
            // A system collection planned from the clock: needs 10 minutes on it, pays 3 coin, claims once.
            'gt.collect'(ctx, { id }) {
                const gt = ctx.draft('gt');
                if (gt.minutes < 10) ctx.fail('REFUSED', 'Too early to collect.');
                ctx.replayGuard(make(ctx, { kind: 'attempt', id, minutes: gt.minutes, credit: 3 }, { minutes: gt.minutes }));
                if (!ctx.claim(`gt:${EPOCH}:collect:${id}`)) ctx.fail('CLAIMED', 'Already collected.');
                gt.coin += 3;
                return { summary: `Collected ${id}: 3 coin.`, narrate: false, replan: true };
            },
            'gt.attempt'(ctx, { id }) {
                const gt = ctx.draft('gt');
                const minutes = gt.minutes;
                const credit = minutes >= 60 ? 1 : 0;
                const die = ctx.roll('1d6').total;
                gt.attempts[id] = (gt.attempts[id] ?? 0) + 1;
                gt.credits[id] = (gt.credits[id] ?? 0) + credit;
                ctx.replayGuard(make(ctx, { kind: 'attempt', id, minutes, credit }, { minutes, die }), { minutes, die });
                return { summary: `Attempt on ${id}: credit ${credit} (die ${die}).`, narrate: false, replan: true, data: { v2: { result: { id, credit, die } } } };
            },
        },
        capture: {
            kinds: { tick: { grammar: '! tick Minutes' }, offer: { grammar: '! offer Word' }, quick: { grammar: '! quick Word' } },
            apply(ctx, line) {
                const gt = ctx.draft('gt');
                if (line.kind === 'quick') {
                    // A guarded story line: the quest is put down settled, with a claim of its own.
                    gt.quests[line.name] = { id: line.name, instance: 1, state: 'done' };
                    ctx.replayGuard(make(ctx, { kind: 'quick', id: line.name }, {}));
                    if (!ctx.claim(claimKey(line.name, 1))) ctx.fail('CLAIMED', 'Already settled.');
                    gt.coin += 1;
                    return { summary: `Quick ${line.name}.`, narrate: false };
                }
                if (line.kind === 'offer') {
                    gt.quests[line.name] = { id: line.name, instance: 1, state: 'open' };
                    return { summary: `Offered ${line.name}.`, narrate: false };
                }
                gt.minutes = Number(line.name);
                return { summary: `The clock stands at ${line.name}.`, narrate: false };
            },
        },
        queries: {
            'gt.quest': (state, { id }) => state.domains.gt?.quests?.[id] ?? null,
        },
        hooks: {
            replayGuard({ state, hash }, { guard, source, block, operation, recorded }) {
                asked.push({ guard, source, block, operation, recorded });
                if (mode.value === 'throw') throw new Error('boom');
                if (mode.value === 'promise') return Promise.resolve({ ok: true });
                if (mode.value === 'noreason') return { ok: false };
                if (mode.value === 'nonsense') return 'yes';
                if (mode.value === 'missing') return undefined;
                const gt = state.domains.gt;
                const p = guard.predicate;
                if (guard.version !== 2 || guard.owner !== OWNER) return { ok: false, reason: 'not my guard' };
                if (p.kind === 'settle') {
                    const quest = gt.quests[p.id];
                    if (!quest || quest.state !== 'open' || quest.instance !== p.instance) return { ok: false, reason: `${p.id} is not open at instance ${p.instance}` };
                    if (!gt.proofs[p.id]) return { ok: false, reason: `nothing proves ${p.id} any more` };
                    if (hash({ predicate: p, inputs: { state: 'open', proof: true } }) !== guard.inputHash) return { ok: false, reason: 'its inputs changed' };
                    return { ok: true };
                }
                if (p.kind === 'recover') {
                    if ((gt.lost[p.actor] ?? 0) !== p.lost) return { ok: false, reason: `${p.actor} did not lose ${p.lost}` };
                    return { ok: true };
                }
                if (p.kind === 'attempt') {
                    // The saved attempt stands as long as the clock before it is the one it was planned on.
                    if (gt.minutes !== p.minutes) return { ok: false, reason: 'the clock before it changed' };
                    return { ok: true };
                }
                if (p.kind === 'quick') return { ok: true };
                return { ok: false, reason: 'unknown guard' };
            },
        },
    };
}

// A second owner whose command calls the first one (a cross-owner transaction).
export function outer() {
    return {
        id: 'zz-outer', name: 'Outer', version: '0.0.1',
        domains: { outer: { initial: () => ({ log: [] }) } },
        commands: {
            'outer.settle'(ctx, { id, instance, reward, after = 'ok' }) {
                ctx.draft('outer').log.push(`settling ${id}`);
                const inner = ctx.call('gt.settle', { id, instance, reward });
                if (after === 'fail') ctx.fail('REFUSED', 'The outer step refused after the inner one worked.');
                if (after === 'second') ctx.call('gt.settle', { id, instance, reward: reward + 1 });
                return { summary: `Outer settled ${id}.`, narrate: false, data: { inner: inner.data } };
            },
            // Tries to attach the other module's guard itself.
            'outer.forge'(ctx, { id }) {
                ctx.replayGuard({ owner: OWNER, version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ id }), predicate: { kind: 'quick', id } });
                return { summary: 'forged', narrate: false };
            },
            // Guards for itself while it has no replayGuard hook.
            'outer.noHook'(ctx) {
                ctx.replayGuard({ owner: 'zz-outer', version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({}), predicate: {} });
                return { summary: 'no hook', narrate: false };
            },
        },
    };
}

/**
 * A store, registry and command bus over a plain chat array (no turn, no capture): `send()` adds a user message
 * and a reply, commands go to the head reply as the reader's actions. `options` reach createStore.
 */
export function harness(modules = [guarded()], options = {}) {
    const registry = createRegistry();
    for (const def of modules) registry.register(def);
    const chat = [greeting()];
    const validate = (state, names) => names.flatMap(name => {
        const fn = registry.validator(name);
        return typeof fn === 'function' ? (fn(state?.domains?.[name], state) ?? []) : [];
    });
    let n = 0;
    const store = createStore({
        chat: () => chat, save: async () => {}, validate, scratch: name => registry.scratch(name),
        recordId: () => `sw_${(++n).toString(16).padStart(12, '0')}`, ...options,
    });
    const bus = createCommandBus({ store, registry });
    store.ensureInitial(registry.initialState());
    const out = {
        chat, store, bus, registry,
        send(text = 'Go on.', mes = 'The road.') {
            chat.push(user(text), reply(mes));
            return chat.length - 1;
        },
        command: (type, payload = {}, cause = 'ui') => bus.command(type, payload, { cause }),
        gt: () => store.head().domains.gt,
        problems: () => store.problems(),
        record: index => chat[index].extra.storySuite,
        spans: index => chat[index].extra.storySuite.spans,
    };
    return out;
}

export { greeting, initial, reply, user };
