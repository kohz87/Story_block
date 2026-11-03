// The party roster (Story Block 2.18.1, docs/v2/GEAR.md "The roster"): the RPG answers `party.actors` and `party.pc` from its Character blocks, so
// each member of the party is an actor who can own and wear things.
//
//   party.actors  [{ id, name, pc? }]  (null while there is no Character: nothing answers, the `party` domain is looked at as before) one per Character block in the party (a companion who left is not on it), in block order; `pc: true` on the reader's own.
//   party.pc      { id }               the reader's own Character: the one named like the persona (an exact name, else a first name that means only them),
//                                      else the first block (what the rolls have always done). Only the id: the header keeps the persona's name.
//
// The id is `ac_` + 8 base-36 characters worked out from the BLOCK's module id (`pack.chat/<slug>`), never from the name: a rename, a rebuild, a
// reload and a swipe all give the same one. Both queries are fallbacks (registry.js): a module that answers `party.actors` itself (an older RPG Battle chat) is the
// one asked, and these are not. They answer while the RPG is on (`feature`) and Gear in fights is on (`gearOn`), and read the state alone (plus the persona's name).
// Pure: no DOM, no SillyTavern.
import { LEAN_RPG_FEATURE } from './names.js';
import { fold, readSheet, sameWho } from './read.js';

const BASE = 36 ** 8;

// (a 52-bit string hash, two 32-bit lanes mixed; spread well enough that a handful of blocks never meet)
function hash52(text) {
    let a = 0xdeadbeef, b = 0x41c6ce57;
    for (let at = 0; at < text.length; at += 1) {
        const code = text.charCodeAt(at);
        a = Math.imul(a ^ code, 2654435761);
        b = Math.imul(b ^ code, 1597334677);
    }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return 4294967296 * (2097151 & b) + (a >>> 0);
}

/** The actor id of the Character block `module` (its data-module id): `ac_` and 8 base-36 characters, the same whatever the person is called. */
export const actorIdOf = module => `ac_${(hash52(String(module ?? '')) % BASE).toString(36).padStart(8, '0')}`;

/**
 * The roster of a state: `{ actors: [{ id, name, pc? }], pc }` (`pc`: the reader's actor id, or null with no Character). `persona` is the reader's name.
 * Two blocks whose ids met would be told apart by a second hash (the later one); in practice never.
 */
export function rosterOf(state, persona = '') {
    const sheet = readSheet(state);
    const taken = new Set();
    const actors = sheet.characters.map(character => {
        let id = actorIdOf(character.module);
        for (let n = 2; taken.has(id); n += 1) id = actorIdOf(`${character.module}#${n}`);
        taken.add(id);
        return { id, name: character.who, character };
    });
    const reader = String(persona ?? '').replace(/\s+/g, ' ').trim();
    const named = reader ? actors.find(actor => actor.character.key === fold(reader)) ?? actors.find(actor => sameWho(actor.character, reader, [], sheet.characters)) : null;
    const lead = named ?? actors[0] ?? null;
    return { actors: actors.map(actor => ({ id: actor.id, name: actor.name, ...(actor === lead ? { pc: true } : {}) })), pc: lead ? lead.id : null };
}

/** The two queries (registered as fallbacks), for a persona reader `persona()`. */
export function rosterQueries({ persona = () => '', gearOn = () => true } = {}) {
    const who = () => { try { return persona(); } catch { return ''; } };
    // (only while Gear in fights is on: with it off nothing here answers, and the inventory, its screens and its commands are as in 2.18.0)
    const on = () => { try { return gearOn() === true; } catch { return false; } };
    return {
        'party.actors': Object.assign((state) => { if (!on()) return null; const { actors } = rosterOf(state, who()); return actors.length ? actors : null; }, { feature: LEAN_RPG_FEATURE, fallback: true }),
        'party.pc': Object.assign((state) => { if (!on()) return null; const { pc } = rosterOf(state, who()); return pc ? { id: pc } : null; }, { feature: LEAN_RPG_FEATURE, fallback: true }),
    };
}
