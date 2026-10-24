// Test-only owners for the timeline tests (docs/v2/TIMELINE.md). They stand for the modules that keep state the
// timeline must put back (a clock, pools and XP, gear, a fight, a training session, NPC meters) and for a module with
// native state beside the story (a dossier store with its own checkpoints). None of it is a rule of a real module.
//
// `tl-rules` (domains `director`, `party`, `progress`, `gear`, `combat`, `training`, `npc`, `rules`):
//   tl.time { minutes }      sets the clock (absolute).         tl.hurt { amount } / tl.heal { amount }   the hit points (a count).
//   tl.xp { amount }         adds XP (a count).                 tl.equip { slot, item } / tl.unequip { slot }   gear.
//   tl.fight { id, round }   a fight is on; tl.endfight   it is over.     tl.train { session, paid }   a paid training session runs.
//   tl.meter { npc, value }  adds to an NPC meter (a count).    tl.claim { key }   takes a claim.
//   tl.guarded { epoch, rulesHash? }   a command with a guard of the given epoch and rules hash that always holds.
//   tl.rules { hash }        freezes the ruleset (sets the rules slice's marker).
// `tl-native` (domain `nat`, participant): a dossier store with checkpoints of its own, kept in `native.store`; `native.fail`
// makes a callback fail, `native.missing` forgets a checkpoint's bytes.
import { hashJson } from '../../../src/v2/replay.js';

export const RULES = 'tl-rules';
export const NATIVE = 'tl-native';
export const NPC = 'np_tavi0001';
const HASH64 = 'a'.repeat(64);

export function rulesModule({ asked = [] } = {}) {
    return {
        id: RULES, name: 'Test rules', version: '0.0.1',
        domains: {
            director: { initial: () => ({ time: { minutes: 0 } }) },
            party: {
                initial: () => ({ pools: { hp: 20, mp: 5, sp: 10 }, names: [] }), counters: ['pools/*'],
                validate: slice => Object.entries(slice.pools).filter(([, value]) => value < 0).map(([name]) => `party: ${name} below zero`),
            },
            progress: { initial: () => ({ xp: 0, level: 1 }), counters: ['xp'] },
            gear: { initial: () => ({ equipped: {} }) },
            combat: { initial: () => ({ fight: null }) },
            training: { initial: () => ({ session: null, paid: 0 }), counters: ['paid'] },
            npc: { initial: () => ({ meters: {} }), counters: ['meters/*'] },
            rules: { initial: () => ({ rulesVersion: 2, rulesHash: HASH64 }) },
        },
        commands: {
            'tl.time'(ctx, { minutes }) {
                ctx.draft('director').time.minutes = minutes;
                ctx.absolute('director', '/time/minutes');
                return { summary: `The clock stands at ${minutes}.`, narrate: false };
            },
            'tl.hurt'(ctx, { amount }) {
                ctx.draft('party').pools.hp -= amount;
                return { summary: `${amount} hurt.`, narrate: false };
            },
            'tl.heal'(ctx, { amount }) {
                ctx.draft('party').pools.hp += amount;
                return { summary: `${amount} healed.`, narrate: false };
            },
            'tl.xp'(ctx, { amount }) {
                ctx.draft('progress').xp += amount;
                return { summary: `${amount} XP.`, narrate: false };
            },
            'tl.equip'(ctx, { slot, item }) {
                ctx.draft('gear').equipped[slot] = item;
                return { summary: `${item} on ${slot}.`, narrate: false };
            },
            'tl.unequip'(ctx, { slot }) {
                delete ctx.draft('gear').equipped[slot];
                return { summary: `${slot} bare.`, narrate: false };
            },
            'tl.fight'(ctx, { id, round }) {
                ctx.draft('combat').fight = { id, round };
                return { summary: `Fight ${id}, round ${round}.`, narrate: false };
            },
            'tl.endfight'(ctx) {
                ctx.draft('combat').fight = null;
                return { summary: 'The fight is over.', narrate: false };
            },
            'tl.train'(ctx, { session, paid }) {
                const training = ctx.draft('training');
                training.session = { id: session, minutes: 60 };
                training.paid += paid;
                return { summary: `Training ${session} paid ${paid}.`, narrate: false };
            },
            'tl.meter'(ctx, { npc, value }) {
                const meters = ctx.draft('npc').meters;
                meters[npc] = (meters[npc] ?? 0) + value;
                return { summary: `${npc} ${value >= 0 ? '+' : ''}${value}.`, narrate: false };
            },
            'tl.claim'(ctx, { key }) {
                if (!ctx.claim(key)) ctx.fail('CLAIMED', 'Taken already.');
                return { summary: `Claimed ${key}.`, narrate: false };
            },
            'tl.rules'(ctx, { hash }) {
                ctx.draft('rules').rulesHash = hash;
                return { summary: 'The rules are frozen.', narrate: false };
            },
            'tl.guarded'(ctx, { epoch, rulesHash = null }) {
                ctx.replayGuard({ owner: RULES, version: 2, epoch, rulesHash, inputHash: ctx.hash({ epoch, rulesHash }), predicate: { kind: 'always' } });
                ctx.draft('progress').xp += 1;
                return { summary: 'Guarded.', narrate: false };
            },
        },
        hooks: {
            replayGuard({ hash }, info) {
                asked.push(info);
                return hash({ epoch: info.guard.epoch, rulesHash: info.guard.rulesHash }) === info.guard.inputHash ? { ok: true } : { ok: false, reason: 'its inputs changed' };
            },
        },
    };
}

/**
 * A module with native state beside the story: a dossier store with checkpoints. `native` is what a test looks at:
 * `store` (the live dossiers), `checkpoints` (id → { json, hash }), `calls` (every callback, in order), `fail` (a Set of
 * callback names that fail), `missing` (a Set of checkpoint ids whose bytes are gone), `handle` (what the host gave).
 */
export function nativeModule({ id = NATIVE } = {}) {
    const native = {
        store: { dossiers: { tavi: { trust: 3 } }, applied: [] },
        checkpoints: {}, prepared: {}, status: {}, calls: [], fail: new Set(), missing: new Set(), handle: null, n: 0, active: null,
    };
    const keep = state => {
        const json = JSON.stringify(state);
        const checkpoint = `ck_${String(++native.n).padStart(8, '0')}`;
        native.checkpoints[checkpoint] = { json, hash: hashJson(state) };
        return { checkpoint, hash: native.checkpoints[checkpoint].hash };
    };
    const say = (name, input, make) => {
        native.calls.push({ name, input });
        if (native.fail.has(name)) return { ok: false, code: 'FAILED', message: `${name} failed (test)` };
        return make();
    };
    native.keep = keep;
    native.checkpoint = () => keep(native.store);
    native.edit = fn => {
        fn(native.store);
        return native.store;
    };
    const participant = {
        schema: 1,
        attach: handle => { native.handle = handle; },
        checkpoint: input => say('checkpoint', input, () => ({ ok: true, ...keep(native.store), schema: 1 })),
        prepare: input => say('prepare', input, () => {
            const held = native.checkpoints[input.checkpoint];
            if (!held || native.missing.has(input.checkpoint)) return { ok: false, code: 'SNAPSHOT_UNAVAILABLE', message: `checkpoint ${input.checkpoint} is gone` };
            if (held.hash !== input.hash) return { ok: false, code: 'CONFLICT', message: 'other bytes' };
            const prepared = `pr_${String(++native.n).padStart(8, '0')}`;
            native.prepared[prepared] = { checkpoint: input.checkpoint, return: input.return };
            native.status[input.return] = { status: 'prepared', checkpoint: input.checkpoint, hash: held.hash };
            return { ok: true, prepared, hash: held.hash };
        }),
        activate: input => say('activate', input, () => {
            const held = native.prepared[input.prepared];
            if (!held) return { ok: false, code: 'NOT_FOUND', message: 'nothing prepared' };
            const bytes = native.checkpoints[held.checkpoint];
            native.store = JSON.parse(bytes.json);
            native.active = held.checkpoint;
            native.status[input.return] = { status: 'active', checkpoint: held.checkpoint, hash: bytes.hash };
            return { ok: true, checkpoint: held.checkpoint, hash: bytes.hash };
        }),
        abort: input => say('abort', input, () => {
            delete native.prepared[input.prepared];
            if (native.status[input.return]?.status === 'prepared') native.status[input.return] = { ...native.status[input.return], status: 'aborted' };
            return { ok: true, aborted: true };
        }),
        status: input => say('status', input, () => {
            const held = native.status[input.return];
            return held ? { ok: true, checkpoint: held.checkpoint, hash: held.hash, status: held.status } : { ok: false, code: 'NOT_FOUND', message: 'unknown return' };
        }),
        applyEvent: input => say('applyEvent', input, () => {
            if (!native.store.applied.includes(input.event)) native.store.applied.push(input.event);
            const made = keep(native.store);
            return { ok: true, event: input.event, ...made, ack: true };
        }),
    };
    return {
        native,
        def: {
            id, name: 'Test native', version: '0.0.1', domains: { [id === NATIVE ? 'nat' : id]: { initial: () => ({ marks: 0 }) } }, participant,
            // The identity query of the contract (npc.identity): one dossier, np_tavi0001 -> the native key "tavi".
            queries: id === NATIVE ? { 'npc.identity': (state, args) => (args?.id === NPC ? { id: NPC, nativeKey: 'tavi', name: 'Tavi' } : null) } : {},
        },
    };
}

// ---- a host, what a save wrote, and a start again from it -------------------------------------------------

export const clone = value => JSON.parse(JSON.stringify(value));
export const BATCH = { id: 'br_batch001', hash: 'b'.repeat(64) };
export const DEATH = ['ev_death001'];

/** Follows the chat file: `disk.image` is the chat and its metadata as the last save wrote them. */
export function track(host) {
    const disk = { image: { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) } };
    const original = host.ctx.saveChat;
    host.ctx.saveChat = async (...args) => {
        const out = await original.apply(host.ctx, args);
        disk.image = { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) };
        return out;
    };
    return disk;
}

/** A host started again over what a save wrote: the chat opens, the modules register, the timeline recovers. */
export async function reload(createHost, image, modules, options = {}) {
    const host = await createHost({ ...options, modules, st: { ...(options.st ?? {}), chat: image.chat } });
    host.ctx.chatMetadata = clone(image.metadata);
    await host.turn.onChatChanged();
    return host;
}

/** Prepares and activates a restore to `snapshot` at the head: → { prepared, activated }. */
export async function restore(host, snapshot, { batch = BATCH, events = DEATH } = {}) {
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot, deathEvents: events, batchResult: batch, expectedHead: head.headHash });
    if (!prepared.ok) return { prepared };
    const activated = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    return { prepared, activated };
}

/** The domains a restore must put back, as a plain value to compare (the host's own savepoints aside). */
export function slice(state) {
    const { savepoints, ...rest } = state.domains;
    void savepoints;
    return clone({ domains: rest, claims: state.meta.claims ?? {} });
}
