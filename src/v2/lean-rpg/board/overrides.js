// Keeps reader-edited skill flags as reply-owned, add-only entries.
// Defaults stay in flags.js; this domain stores only explicit choices and can replay a middle delete.
// The command reads the current sheet and writes the editing reply's own keyed entry.
// Also the consumables' two outside-the-fight hooks (owner 14 Nov): `items.useOn` (whom the inventory's Use on… offers) and `item.use` (the
// Use on… button and the story's `- item X | used: yes`): one rule, board/rules.js `recoveryOf`, the same one the fight board's Use item uses.

import { CORE_FEATURE } from '../../features.js';
import { fold, matchCharacter, readSheet } from '../read.js';
import { actorIdOf, rosterOf as partyRoster } from '../roster.js';
import { BOARD_SKILL, BOARD_SKILL_CARRY, LEAN_RPG_FEATURE, USE_ITEM } from '../names.js';
import { skillKey } from './flags.js';
import { recoveryWords } from '../cue.js';
import { recoverPool, recoveryOf } from './rules.js';
import { boardSession } from './session.js';

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const flagsValid = value => object(value) && Object.keys(value).length === 3 && ['target', 'area', 'defence'].every(key => typeof value[key] === 'boolean');

/** Latest explicit choices for each skill, derived from the entries that survived replay. */
export function boardFlags(state) {
    const entries = Object.values(state?.domains?.dataModules?.boardFlags ?? {}).flatMap(group => Object.values(object(group) ? group : {}))
        .filter(entry => object(entry) && typeof entry.key === 'string' && flagsValid(entry.flags));
    entries.sort((a, b) => a.rev - b.rev || String(a.id).localeCompare(String(b.id)));
    return Object.fromEntries(entries.map(entry => [entry.key, entry.flags]));
}

// Writes `flags` as the editing reply's own entry for `key`, pruning older replies' entries for that key.
function writeEntry(ctx, key, flags) {
    const sid = ctx.reply.sid, id = ctx.id('edit');
    const domain = ctx.draft('dataModules');
    domain.boardFlags ??= {};
    // A newer reply may prune older entries for this skill; replay ignores a remove already gone.
    for (const [owner, group] of Object.entries(domain.boardFlags)) {
        if (owner === sid) continue;
        for (const [entryId, entry] of Object.entries(group)) if (entry.key === key) delete group[entryId];
        if (!Object.keys(group).length) delete domain.boardFlags[owner];
    }
    domain.boardFlags[sid] ??= {};
    domain.boardFlags[sid][id] = { id, key, flags: { ...flags }, rev: ctx.rev };
}

const find = (ctx, payload, name) => {
    const actor = readSheet({ domains: { dataModules: ctx.read('dataModules') } }).characters.find(entry => entry.module === payload.module);
    const skill = actor?.skills.find(entry => entry.slot === payload.slot && fold(entry.name) === fold(name));
    return { actor, skill };
};

const alive = sheet => sheet.characters.filter(person => person.alive !== false);
const sheetOf = domain => readSheet({ domains: { dataModules: domain } });

// Who a use is for: the actor `id` (the button), else the person `on` names (the story), else the reader, else the only character. { person } or { none: why }.
function targetOf(sheet, state, payload, persona) {
    const people = alive(sheet);
    if (typeof payload.target === 'string' && payload.target) return { person: people.find(person => actorIdOf(person.module) === payload.target) ?? null, asked: true };
    const on = typeof payload.on === 'string' ? payload.on.replace(/\s+/g, ' ').trim() : '';
    if (on) return { person: matchCharacter({ characters: people }, on) ?? null, asked: true };
    const me = partyRoster(state, persona()).pc;
    return { person: people.find(person => actorIdOf(person.module) === me) ?? (people.length === 1 ? people[0] : null), asked: false };
}

/** `rpg.useItem { stack, target }` (the button) or `{ def, on, qty, story: true }` (the story's used line): one unit (qty) is used up and its pool restored. */
function useItem(ctx, payload, persona) {
    const inv = ctx.read('inventory'), stack = payload?.stack !== undefined ? inv?.stacks?.[payload.stack] : null;
    const def = stack ? inv.defs[stack.def] : inv?.defs?.[payload?.def];
    if (!def || def.kind !== 'consumable') ctx.fail(stack || payload?.def ? 'INVALID' : 'NOT_FOUND', 'Only a consumable can be used.');
    const qty = payload?.story === true && Number.isSafeInteger(payload.qty) && payload.qty >= 1 ? Math.min(payload.qty, 99) : 1;
    const state = { domains: { dataModules: ctx.read('dataModules'), party: ctx.read('party') } };
    const who = targetOf(sheetOf(state.domains.dataModules), state, payload ?? {}, persona);
    if (!who.person && who.asked && payload?.story !== true) ctx.fail('REFUSED', 'That party member is not here.');
    const used = ctx.call('inventory.consume', stack ? { stack: stack.id, qty: 1 } : { def: def.id, qty });
    const { pool, blocks } = recoveryOf(def), domain = ctx.draft('dataModules'), moves = [];
    if (who.person) {
        for (let at = 0; at < qty; at += 1) {
            const sheet = sheetOf(domain), person = sheet.characters.find(entry => entry.key === who.person.key);
            moves.push(recoverPool(domain, sheet, person, pool, blocks));
        }
    }
    const gained = moves.reduce((sum, move) => sum + move.gained, 0), last = moves.at(-1);
    const effect = !who.person ? 'nobody on the sheet is helped' : gained ? `${who.person.who} ${recoveryWords(pool, gained)}, now ${last.to} of ${last.size}` : `${who.person.who}'s ${pool} was already full`;
    // (told to the narrator as the inventory's own `consume` is: from a button yes, from the story's line no: it already said so)
    return { summary: `${who.person?.who ?? 'Someone'} uses ${def.name}: ${effect}.`, narrate: ctx.cause !== 'story',
        data: { def: def.id, qty, left: used?.data?.left ?? 0, pool, ...(who.person ? { target: who.person.who } : {}), recovered: gained } };
}

/** `items.useOn`: { [stack]: [{ id }] }: the party's consumables, each with the members it may be used on; {} while a board fight is open (the sheet is held) or there is no one. */
function usersFor(state, metadata) {
    if (boardSession(metadata?.())) return {};
    const people = alive(sheetOf(state?.domains?.dataModules)), inv = state?.domains?.inventory;
    if (!people.length || !inv) return {};
    const ids = people.map(person => ({ id: actorIdOf(person.module), via: USE_ITEM }));
    return Object.fromEntries(Object.values(inv.stacks ?? {}).filter(stack => stack.qty >= 1 && inv.defs?.[stack.def]?.kind === 'consumable').map(stack => [stack.id, ids]));
}

export function createBoardPart({ persona = () => '', metadata = () => null } = {}) {
    const edit = Object.assign((ctx, payload) => {
        if (ctx.cause !== 'ui' || !ctx.reply?.sid) ctx.fail('REFUSED', 'Only the reader can edit a skill.');
        if (!flagsValid(payload?.flags)) ctx.fail('INVALID', 'Choose the three skill flags.');
        const { actor, skill } = find(ctx, payload, payload.name);
        if (!skill) ctx.fail('REFUSED', 'That skill is no longer on the sheet.');
        writeEntry(ctx, skillKey(actor.module, skill), payload.flags);
        return { summary: 'Skill choices saved.', narrate: false };
    }, { feature: CORE_FEATURE.fightBoard });
    // A rename keeps the reader's explicit flags even while the board is off (no feature gate): it moves an
    // existing entry from the old name to the new one and never makes flags from defaults.
    const carry = (ctx, payload) => {
        if (ctx.cause !== 'ui' || !ctx.reply?.sid) ctx.fail('REFUSED', 'Only the reader can edit a skill.');
        if (typeof payload?.from !== 'string' || typeof payload?.name !== 'string' || !Number.isSafeInteger(payload?.slot)) ctx.fail('INVALID', 'Name the skill and its new name.');
        const { actor, skill } = find(ctx, payload, payload.name);
        if (!skill) ctx.fail('REFUSED', 'That skill is no longer on the sheet.');
        const old = boardFlags({ domains: { dataModules: ctx.read('dataModules') } })[skillKey(actor.module, { slot: payload.slot, name: payload.from })];
        if (!old) return { summary: 'No skill choices to carry.', narrate: false };
        writeEntry(ctx, skillKey(actor.module, skill), old);
        return { summary: 'Skill choices carried.', narrate: false };
    };
    const use = Object.assign((ctx, payload) => useItem(ctx, payload, persona), { feature: LEAN_RPG_FEATURE });
    return { commands: { [BOARD_SKILL]: edit, [BOARD_SKILL_CARRY]: carry, [USE_ITEM]: use },
        // (a fallback: a module that answers `items.useOn` itself owns the name and is the one asked, as the party roster's queries are)
        queries: { 'items.useOn': Object.assign((state) => usersFor(state, metadata), { feature: LEAN_RPG_FEATURE, fallback: true }) } };
}
