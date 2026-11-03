// XP for a won fight, given by code (stage 49).
//
// When a reply's story takes the fight from "at least one filled foe group is standing" to "every filled foe group is Down" (by the dice, which write the
// foes' bars under the Standard formula, or by the narrator's own foe lines), the party is paid once, for that fight: every party member who has not Left
// (a Down member too; a dead one is not paid) gets XP of their own, from their Soul Class against each group's (names.js FIGHT_XP: count × class × 2, times 50% / 25% / 12% for a group
// 1 / 2 / 3 classes lower than theirs and nothing for 4 or more, times 150%, 200% … for a higher one; summed and rounded down, held to 1..60, and
// nothing at 0, with no receipt line; Soul Class II against six Class I crawlers gives 6). The groups of the fight are the ones that were standing when the reply began and are still on the Foes
// block; a group the narrator cleared is not Down, it is gone (fled, yielded), and a fight with none of its groups left is not won. A later reply that fills
// the slots again and wins is a new fight, since the groups it starts from are the standing ones. A group that arrives in the reply itself (the pre-call's
// opened foes, or the narrator's own set-slot line) is part of that reply's fight, so a fight opened and won in one reply is paid.
//
// How. `fightHook` (the part's afterCapture) compares the reply's state with the one before it (view.before) and, only for a won fight, asks for the step
// `rpg.fight { was }`: `was` = the slots standing before the reply. The step is a guarded block on the reply (replan: a swipe or a delete takes it away, a
// Re-read and a middle delete plan it again on the new story, REPLAY.md), so the live state, a rebuild and a reload agree. It runs the character block's own
// rules (Soul Class rises at 100 XP) through the block interpreter, as the narrator's `add-xp` line does.
//
// No double count: in that reply the narrator's XP for a party member is not used. The first story line of the reply that wrote a character's XP kept what
// that character's xp, soul and points were before it (data-modules/part.js, the reply's scratch `xpFrom`); the step puts those back before it adds the
// code's XP, so the narrator's line and the rise it brought are gone, and one Problems line says so. XP in any other reply (a quest, a discovery) is
// untouched: the step exists only in the reply that won the fight.
//
// The record (the step's receipt `data.v2.result.fight`): { groups: [{ slot, name, count, class }], awards: [{ who, module, xp, held? }] } (xp is the member's own).
import { createEvaluation } from '../data-modules/interpreter.js';
import { FIGHT, FIGHT_XP, FOE_SLOTS, LEAN_RPG_FEATURE } from './names.js';
import { fold, readSheet } from './read.js';

/** The replies whose story is paid for (the same as the reply-end steps of the blocks: not a Continue's, nor the extractor's late lines). */
const PAID_TYPES = Object.freeze(['normal', 'swipe', 'regenerate', 'reread']);
/** Said once in a reply where the narrator wrote XP for a won fight (a Problems line). */
export const FIGHT_XP_HELD = 'XP for the fight is given by code; the narrator\'s XP line was not used.';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = value => Number.isSafeInteger(value);
const slotsOf = value => (Array.isArray(value) ? [...new Set(value.filter(slot => whole(slot) && slot >= 1 && slot <= 99))].sort((a, b) => a - b) : []);

/** The foe slots that are filled and not Down (their Health above 0). */
export const standingSlots = sheet => sheet.foes.filter(foe => foe.filled && foe.hurt > 0).map(foe => foe.slot);

/**
 * Whether the fight that began with the groups in `was` is won on `sheet`: some of those groups are still on the block and every filled group is Down.
 * → { won, groups: [{ slot, name, count, class }] (the fight's groups still there) }.
 */
export function fightOf(sheet, was) {
    const filled = sheet.foes.filter(foe => foe.filled);
    const groups = filled.filter(foe => was.includes(foe.slot)).map(({ slot, name, count, class: soul }) => ({ slot, name, count, class: soul }));
    return { won: groups.length > 0 && filled.every(foe => foe.hurt === 0), groups };
}

/** The XP a member of Soul Class `soul` gets for the fight's `groups` (see FIGHT_XP): the groups' bases scaled by the class difference, added, rounded down; 0, or 1..60. */
export function memberXp(groups, soul) {
    const percent = groups.reduce((total, group) => {
        const gap = group.class - soul;
        const scale = gap > 0 ? 100 + FIGHT_XP.higherPercent * gap : gap < 0 ? FIGHT_XP.lowerPercent[-gap - 1] ?? 0 : 100;
        return total + group.count * group.class * FIGHT_XP.perClass * scale;
    }, 0);
    const xp = Math.floor(percent / 100);
    return xp > 0 ? Math.max(FIGHT_XP.min, Math.min(FIGHT_XP.max, xp)) : 0;
}

// The party members the fight pays: not Left (readSheet leaves those out), not dead.
const paidOf = sheet => sheet.characters.filter(character => character.alive !== false);

// The reply's scratch (data-modules/part.js finish): `perReply[<sid>/<swipeKey>].xpFrom` = { [module]: { xp, soul, points } }, what a character had before the
// first story line of this reply that wrote XP. → the numbers that are whole, by block.
const pairKey = source => `${source?.sid}/${source?.swipeKey}`;
function fromOf(domain, source) {
    const out = {};
    const kept = domain?.perReply?.[pairKey(source)]?.xpFrom;
    if (!isObject(kept)) return out;
    for (const [module, rises] of Object.entries(kept)) {
        if (isObject(rises) && whole(rises.xp) && whole(rises.soul)) out[module] = { xp: rises.xp, soul: rises.soul, ...(whole(rises.points) ? { points: rises.points } : {}) };
    }
    return out;
}

/** The numbers the step depends on (the replay guard asks them again): the fight's groups and every filled group's Health, each paid member's rises, and what the reply's XP lines started from. */
export function fightWitness(sheet, domain, source, decision) {
    const foes = sheet.foes.filter(foe => foe.filled).map(({ slot, name, count, class: soul, hurt }) => ({ slot, name, count, class: soul, hurt }));
    return { foes, was: slotsOf(decision?.was), from: fromOf(domain, source),
        members: paidOf(sheet).map(character => ({ module: character.module, who: character.who, xp: character.xp, soul: character.soul, points: character.points })) };
}

/**
 * The part's afterCapture: the step for a fight this reply won, else nothing. `view.before()` is the state before the reply (sdk.js makeView); without it
 * (a view that cannot say) nothing is asked for.
 */
export function fightHook(view, info) {
    if (!PAID_TYPES.includes(info?.type ?? 'normal') || view?.feature?.(LEAN_RPG_FEATURE) !== true) return undefined;
    const sheet = readSheet(view.state);
    const filled = sheet.foes.filter(foe => foe.filled);
    // (cheap first: a fight can only be won now if every filled group is Down)
    if (!filled.length || !filled.every(foe => foe.hurt === 0)) return undefined;
    const earlier = typeof view.before === 'function' ? view.before() : null;
    if (!earlier) return undefined;
    const before = readSheet(earlier);
    // The groups the fight began with: the ones standing before the reply, and the ones that arrived in it (the pre-call's opened foes, put on the block by the
    // reply's roll, or the narrator's own set-slot line): a slot that was empty before, or held another group, and is filled now.
    const filledBefore = new Map(before.foes.filter(foe => foe.filled).map(foe => [foe.slot, fold(foe.name)]));
    const arrived = filled.filter(foe => filledBefore.get(foe.slot) !== fold(foe.name)).map(foe => foe.slot);
    const was = [...new Set([...standingSlots(before), ...arrived])].sort((a, b) => a - b);
    if (!was.length || !fightOf(sheet, was).won) return undefined;
    return { commands: [{ type: FIGHT, payload: { was } }] };
}

/**
 * `rpg.fight { was }`: pays the party for the fight (see the top). A system step after the reply's lines; NO_LONGER_DONE when the story it is planned on
 * no longer holds a won fight (a delete or a Re-read changed it), and the block then goes.
 */
export function fightXp(ctx, payload = {}) {
    if (ctx.cause !== 'system' || ctx.caller !== null) ctx.fail('REFUSED', 'The XP for a fight is given by Story Block after a reply, not by an action.');
    const was = slotsOf(payload?.was);
    if (!was.length) ctx.fail('INVALID', 'The XP for a fight needs the groups it was fought against.');
    const domain = ctx.read('dataModules');
    const sheet = readSheet({ domains: { dataModules: domain } });
    const fight = fightOf(sheet, was);
    if (!fight.won) ctx.fail('NO_LONGER_DONE', 'No won fight is left to give XP for on this story.');
    const from = fromOf(domain, ctx.source);
    const witness = fightWitness(sheet, domain, ctx.source, { was });
    const predicate = { kind: FIGHT };
    ctx.replayGuard({ owner: ctx.module, version: 2, epoch: ctx.epoch, rulesHash: null, predicate, inputHash: ctx.hash({ source: ctx.source, predicate, witness }) }, { was });
    const draft = ctx.draft('dataModules');
    const awards = [];
    for (const character of paidOf(sheet)) {
        const definition = draft.pins?.[draft.active?.[character.module]?.hash]?.definition;
        const fields = draft.instances?.[character.module]?.chat?.fields;
        if (!isObject(fields) || !whole(fields.xp)) continue;
        // What the story added to this member's xp, soul and points in this reply (the narrator's XP line and its rise) is not used.
        const kept = from[character.module];
        const held = Boolean(kept) && ['xp', 'soul', 'points'].some(key => whole(kept[key]) && fields[key] !== kept[key]);
        const instance = draft.instances[character.module].chat;
        const xp = memberXp(fight.groups, character.soul);
        if (isObject(definition?.state) && Array.isArray(definition.rules)) {
            const evaluation = createEvaluation(definition, instance, { inputs: {}, source: {}, cursor: null, subject: 'chat' });
            if (held) evaluation.effects(['xp', 'soul', 'points'].filter(key => whole(kept[key]) && key in fields).map(key => ({ op: 'set', path: [key], value: kept[key] })));
            if (xp > 0) evaluation.effects([{ op: 'add', path: ['xp'], value: xp, bounds: 'clamp' }]);
            evaluation.rules();
            evaluation.finish();
        } else {
            // A bare block (no pinned rules to run): XP only, held to 0–100.
            if (held) Object.assign(fields, Object.fromEntries(['xp', 'soul', 'points'].filter(key => whole(kept[key]) && key in fields).map(key => [key, kept[key]])));
            fields.xp = Math.max(0, Math.min(100, fields.xp + xp));
        }
        if (xp > 0 || held) awards.push({ who: character.who, module: character.module, xp, ...(held ? { held: true } : {}) });
    }
    const held = awards.some(award => award.held);
    return {
        summary: `Fight won: ${awards.filter(award => award.xp > 0).map(award => `${award.who} +${award.xp} XP`).join(', ') || 'no XP to give'}.`, narrate: false, replan: true,
        data: { v2: { result: { fight: { groups: fight.groups, awards } } } },
        ...(held ? { problem: FIGHT_XP_HELD } : {}),
    };
}

/** The replay guard of `rpg.fight` (leanRpgGuard routes it here): the step stands while the sheet numbers it used are what the prefix holds. */
export function fightGuard({ state, hash }, { guard, source, recorded }) {
    const bad = reason => ({ ok: false, reason });
    try {
        const predicate = guard?.predicate;
        if (guard?.version !== 2 || guard.rulesHash !== null || !isObject(predicate) || predicate.kind !== FIGHT || !isObject(recorded)) return bad('Malformed fight guard.');
        const was = slotsOf(recorded.was);
        if (!was.length || was.length !== recorded.was.length || was.some(slot => slot > FOE_SLOTS * 25)) return bad('The fight\'s groups were damaged.');
        const witness = fightWitness(readSheet(state), state.domains?.dataModules, source, { was });
        if (hash({ source, predicate, witness }) !== guard.inputHash) return bad('The sheet before this step changed; Re-read this reply.');
        return { ok: true };
    } catch { return bad('Damaged fight record.'); }
}
