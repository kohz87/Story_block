// The `fishing-activity` module definition (SPEC §6): the `fishing` domain, the three commands, two
// queries and the Fishing tab. Everything here goes through the public sdk shapes only: handlers get a
// `ctx` (SPEC §3.2) and never touch Story Block's internals.
//
// A cast is two commands, both deciding nothing the reader can change:
//   fishing.cast  { spot?, bait? }        opens a line: its seed decides the fish AND the bite timing,
//                                         kept on the session; nothing is granted, nothing narrated.
//   fishing.reel  { session, hooked }     the reader's press, as a flag. Hooked: the session's fish is
//                                         granted (inventory.grant) and logged, narrated once. Missed:
//                                         nothing is granted. Uses no randomness of its own, so the
//                                         outcome depends only on the cast's seed and the flag.
//   fishing.release { catch }             puts a logged catch back (inventory.consume).

import {
    WATERS, RARITIES, decideCatch, decideBite, spotFromPlace, waterOf, catchNote, landedLine, lostLine,
    releasedLine,
} from './rules.js';
import { renderFishing } from './widget.js';

export const MODULE_ID = 'fishing-activity';
export const VERSION = '2.0.0-alpha.1';
export const LOG_SIZE = 20;
export const SESSION_KEEP = 20;
const STATUSES = ['waiting', 'landed', 'lost'];
const QUALITY_IDS = ['poor', 'fair', 'fine', 'prime'];

export function initial() {
    return { sessions: {}, log: [] };
}

// ---- validation (SPEC §2.5) -------------------------------------------------------------------

const isInt = (v, min = 0) => Number.isInteger(v) && v >= min;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const ID = prefix => new RegExp(`^${prefix}_[0-9a-z]{8}$`);

function spotErrors(spot, where) {
    if (!spot || typeof spot !== 'object') return [`${where} has no spot.`];
    const errors = [];
    if (!isStr(spot.name, 80) || !spot.name.trim()) errors.push(`${where} has no spot name.`);
    if (!WATERS.includes(spot.kind)) errors.push(`${where} is not at a river, a lake or the sea.`);
    return errors;
}

function catchErrors(c, where) {
    if (!c || typeof c !== 'object') return [`${where} has no fish.`];
    const errors = [];
    if (!isStr(c.name, 80) || !c.name) errors.push(`${where} has a fish with no name.`);
    if (!RARITIES.includes(c.rarity)) errors.push(`${where} has an unknown rarity.`);
    if (!QUALITY_IDS.includes(c.quality)) errors.push(`${where} has an unknown quality.`);
    if (!isInt(c.grams, 1)) errors.push(`${where} has a weight that is not a whole number of grams.`);
    if (!isInt(c.value, 0)) errors.push(`${where} has a value that is not a whole number.`);
    return errors;
}

export function validate(slice) {
    const errors = [];
    if (!slice || typeof slice !== 'object' || !slice.sessions || typeof slice.sessions !== 'object'
        || !Array.isArray(slice.log)) return ['The fishing record is damaged.'];
    let waiting = 0;
    for (const [id, s] of Object.entries(slice.sessions)) {
        const where = `Fishing session ${id}`;
        if (!ID('fs').test(id) || s?.id !== id) errors.push(`${where} has a bad id.`);
        errors.push(...spotErrors(s?.spot, where));
        if (s.bait !== null && !isStr(s.bait, 40)) errors.push(`${where} has a bad bait.`);
        if (s.startedRev !== null && !isInt(s.startedRev)) errors.push(`${where} has a bad start.`);
        if (!STATUSES.includes(s.status)) errors.push(`${where} has an unknown status.`);
        if (!isInt(s.n, 1)) errors.push(`${where} has no order.`);
        if (!s.bite || !isInt(s.bite.bite, 1) || !isInt(s.bite.window, 1)) errors.push(`${where} has a bad bite.`);
        errors.push(...catchErrors(s.catch, where));
        if (s.status === 'waiting') waiting += 1;
    }
    if (waiting > 1) errors.push('Only one fishing line can be in the water at a time.');
    if (slice.log.length > LOG_SIZE) errors.push(`The fishing log keeps at most ${LOG_SIZE} catches.`);
    for (const entry of slice.log) {
        const where = `Catch ${entry?.id}`;
        if (!ID('fc').test(entry?.id ?? '')) errors.push(`${where} has a bad id.`);
        errors.push(...catchErrors(entry, where), ...spotErrors(entry?.spot, where));
        if (typeof entry.released !== 'boolean') errors.push(`${where} does not say whether it was released.`);
    }
    return errors;
}

// ---- helpers for handlers -----------------------------------------------------------------------

// An id for a record made by this receipt: the receipt's own random part under our prefix, so it is
// unique, well formed and the same on every replay (handlers have no sdk.id).
const idFrom = (prefix, receiptId) => `${prefix}_${String(receiptId).split('_').pop()}`;

// A query another module may not have registered: null instead of a throw.
function maybeQuery(ctx, name, args) {
    try {
        return ctx.query?.(name, args) ?? null;
    } catch {
        return null;
    }
}

// Who is fishing: a main character supplied by another module, else "The party".
export function anglerName(ctx) {
    let pc = maybeQuery(ctx, 'party.pc');
    if (typeof pc === 'string') pc = maybeQuery(ctx, 'party.actor', { id: pc });
    const name = typeof pc?.name === 'string' ? pc.name.trim() : '';
    return name || 'The party';
}

// The spot asked for: { name, kind }, a bare name whose words say the water, or null.
export function normalizeSpot(spot) {
    if (typeof spot === 'string') spot = { name: spot };
    if (!spot || typeof spot !== 'object') return null;
    const name = String(spot.name ?? '').trim().slice(0, 80);
    const kind = WATERS.includes(spot.kind) ? spot.kind : waterOf(name);
    if (!kind) return null;
    return { name: name || `the ${kind}`, kind };
}

// The stack the grant made or topped up. SPEC §7 does not say what inventory.grant returns, so try, in
// order: a stack id in its result, a party stack stamped with this receipt (`from`), a party stack of
// the def its alias names.
function stackOf(ctx, result, name, hint = {}) {
    const inv = ctx.read('inventory') ?? {};
    const stacks = inv.stacks ?? {};
    const live = s => s && s.owner === 'party' && Number.isInteger(s.qty) && s.qty > 0;
    const fromResult = [result?.data?.stack, result?.stack, result?.data?.stackId].find(v => typeof v === 'string');
    const ids = [fromResult, hint.stack].filter(Boolean);
    for (const id of ids) if (live(stacks[id])) return stacks[id];
    const all = Object.values(stacks);
    if (hint.receipt) {
        const stamped = all.find(s => live(s) && s.from === hint.receipt);
        if (stamped) return stamped;
    }
    const defId = hint.def ?? inv.aliases?.[name.toLowerCase()] ?? null;
    return (defId && all.find(s => live(s) && s.def === defId)) || null;
}

function prune(fishing) {
    const closed = Object.values(fishing.sessions).filter(s => s.status !== 'waiting').sort((a, b) => b.n - a.n);
    for (const s of closed.slice(SESSION_KEEP)) delete fishing.sessions[s.id];
}

const waitingOf = fishing => Object.values(fishing.sessions).find(s => s.status === 'waiting') ?? null;

// ---- commands -------------------------------------------------------------------------------------

export function cast(ctx, payload = {}) {
    const spot = normalizeSpot(payload.spot) ?? spotFromPlace(maybeQuery(ctx, 'scene.place'));
    if (!spot) ctx.fail('INVALID', 'Pick a river, a lake or the sea to fish in.');
    const bait = payload.bait == null || payload.bait === '' ? null : String(payload.bait).trim().slice(0, 40) || null;
    const fishing = ctx.draft('fishing');
    const open = waitingOf(fishing);
    if (open) ctx.fail('INVALID', `There is already a line in the water at ${open.spot.name}. Reel it in first.`);

    // The whole catch, then the bite, from this receipt's seed.
    const fish = decideCatch(ctx.rng, spot.kind);
    const bite = decideBite(ctx.rng, fish.rarity);
    const id = idFrom('fs', ctx.receiptId);
    const n = 1 + Object.values(fishing.sessions).reduce((max, s) => Math.max(max, s.n), 0);
    const rev = maybeQuery(ctx, 'fishing.rev');
    const startedRev = Number.isInteger(rev) ? rev : null;
    fishing.sessions[id] = { id, spot, bait, startedRev, status: 'waiting', n, bite, catch: fish };
    prune(fishing);
    return {
        summary: `${anglerName(ctx)} casts a line at ${spot.name}.`,
        narrate: false,
        data: { session: id, spot, bite: bite.bite, window: bite.window },
    };
}

export function reel(ctx, payload = {}) {
    if (typeof payload.hooked !== 'boolean') ctx.fail('INVALID', 'Say whether the fish was hooked.');
    const fishing = ctx.draft('fishing');
    const session = fishing.sessions[payload.session];
    if (!session) ctx.fail('NOT_FOUND', 'There is no line in the water.');
    if (session.status !== 'waiting' || !ctx.claim(`fishing:${session.id}:reeled`)) {
        ctx.fail('CLAIMED', 'That line has already been reeled in.');
    }
    const who = anglerName(ctx);
    const where = session.spot.name;

    if (!payload.hooked) {
        session.status = 'lost';
        prune(fishing);
        return { summary: lostLine(who, where), narrate: true, data: { session: session.id, landed: false } };
    }

    const fish = session.catch;
    const result = ctx.call('inventory.grant', {
        def: { name: fish.name, kind: 'goods', rarity: fish.rarity, value: fish.value, note: catchNote(fish, where) },
        qty: 1,
        owner: 'party',
    });
    const stack = stackOf(ctx, result, fish.name, { receipt: ctx.receiptId });
    const entry = {
        id: idFrom('fc', ctx.receiptId), session: session.id, ...fish, spot: session.spot,
        stack: stack?.id ?? null, def: stack?.def ?? null, released: false,
    };
    fishing.log.push(entry);
    if (fishing.log.length > LOG_SIZE) fishing.log.splice(0, fishing.log.length - LOG_SIZE);
    session.status = 'landed';
    prune(fishing);
    return { summary: landedLine(who, fish, where), narrate: true, data: { session: session.id, landed: true, catch: entry } };
}

export function release(ctx, payload = {}) {
    const fishing = ctx.draft('fishing');
    const entry = fishing.log.find(e => e.id === payload.catch);
    if (!entry) ctx.fail('NOT_FOUND', 'That catch is not in the fishing log.');
    if (entry.released || !ctx.claim(`fishing:${entry.id}:released`)) {
        ctx.fail('CLAIMED', `The ${entry.name.toLowerCase()} is already back in the water.`);
    }
    const stack = stackOf(ctx, null, entry.name, { stack: entry.stack, def: entry.def });
    if (!stack) ctx.fail('NOT_FOUND', `There is no ${entry.name.toLowerCase()} left in the pack to let go.`);
    ctx.call('inventory.consume', { stack: stack.id, qty: 1 });
    entry.released = true;
    return {
        summary: releasedLine(anglerName(ctx), entry, entry.spot.name),
        narrate: true,
        data: { catch: entry.id, stack: stack.id },
    };
}

// ---- the definition -------------------------------------------------------------------------------

const sliceOf = state => state?.domains?.fishing ?? initial();
const copy = value => JSON.parse(JSON.stringify(value));

/** The module definition for sdk.registerModule. `sdk` is only used by the tab, for commands. */
export function fishingModule(sdk = null) {
    return {
        id: MODULE_ID,
        name: 'Fishing',
        version: VERSION,
        domains: { fishing: { initial, validate } },
        commands: { 'fishing.cast': cast, 'fishing.reel': reel, 'fishing.release': release },
        queries: {
            'fishing.log': state => copy(sliceOf(state).log),
            'fishing.session': state => openLine(sliceOf(state)),
            // meta.rev as the transaction sees it: the cast's startedRev (ctx has no rev of its own).
            'fishing.rev': state => (Number.isInteger(state?.meta?.rev) ? state.meta.rev : null),
        },
        context: {
            static: () => '',
            tail: view => {
                const open = waitingOf(sliceOf(view?.state));
                return { lines: [], optional: open ? [`Fishing: a line is in the water at ${open.spot.name}.`] : [] };
            },
            budget: 20,
        },
        // The mini-game as a widget (SPEC §13.5), for any layout; the tab is that widget on its own.
        widgets: {
            fishing: {
                props: WIDGET_PROPS,
                render: (el, props, api) => renderFishing(el, widgetProps(props, api, sdk), widgetApi(null, api, sdk)),
            },
        },
        tabs: [{
            id: 'fishing',
            title: 'Fishing',
            icon: 'fa-fish',
            render: (el, view, api) => renderFishing(el, fishingProps(view, sdk), widgetApi(view, api, sdk)),
        }],
    };
}

// What the widget takes; each is optional and is looked up by query when left out.
export const WIDGET_PROPS = Object.freeze({
    place: 'scene place { name, kind, region }',
    spot: 'where to fish { name, kind: river|lake|sea }',
    session: 'the open line { id, spot, bait, bite, window } or null',
    log: 'catches, newest first',
    last: 'the latest catch',
    currency: 'a currency for showing values',
});

// The open line as the widget shows it: { id, spot, bait, bite, window } (times in ms), or null.
function openLine(fishing) {
    const open = waitingOf(fishing);
    return open ? copy({ id: open.id, spot: open.spot, bait: open.bait, bite: open.bite.bite, window: open.bite.window }) : null;
}

/** Props for a placed widget: what the layout gave, the rest from queries. */
export function widgetProps(props = {}, api = {}, sdk = null) {
    const ask = (name, args) => {
        try {
            return (api?.query ?? sdk?.query)?.(name, args) ?? null;
        } catch {
            return null;
        }
    };
    const place = props.place !== undefined ? props.place : ask('scene.place');
    const log = Array.isArray(props.log) ? props.log : (ask('fishing.log') ?? []).slice().reverse();
    return {
        place,
        spot: props.spot ?? spotFromPlace(place),
        session: props.session !== undefined ? props.session : ask('fishing.session'),
        log,
        last: props.last ?? log[0] ?? null,
        currency: props.currency ?? currencyOf(sdk),
    };
}

/** The widget's props from a tab view: where to fish, the open line, the log, the currency. */
export function fishingProps(view, sdk = null) {
    const fishing = sliceOf(view?.state);
    const ask = (name, args) => {
        try {
            return (view?.query ?? sdk?.query)?.(name, args) ?? null;
        } catch {
            return null;
        }
    };
    const place = ask('scene.place') ?? view?.state?.domains?.scene?.place ?? null;
    return {
        place,
        spot: spotFromPlace(place),
        session: openLine(fishing),
        log: fishing.log.slice().reverse(),
        last: fishing.log.length ? fishing.log[fishing.log.length - 1] : null,
        currency: currencyOf(sdk),
    };
}

// Commands for the widget: the tab api's when the host gives one, else the sdk's (cause 'ui').
function widgetApi(view, api, sdk) {
    return {
        ...api,
        command: api?.command
            ? (type, payload) => api.command(type, payload, { cause: 'ui' })
            : (type, payload) => sdk.command(type, payload, { cause: 'ui' }),
        query: (name, args) => (view?.query ?? sdk?.query)?.(name, args) ?? null,
    };
}

// The `currency` hook (SPEC §6) of whichever module offers one, for showing values; null when none.
// Values themselves are always whole numbers of the smallest coin, so they never depend on this.
export function currencyOf(sdk) {
    try {
        for (const mod of sdk?.modules?.() ?? []) {
            const hook = mod?.hooks?.currency;
            if (typeof hook === 'function') {
                const currency = hook();
                if (currency && typeof currency === 'object') return currency;
            }
        }
    } catch { /* no currency: plain numbers */ }
    return null;
}
