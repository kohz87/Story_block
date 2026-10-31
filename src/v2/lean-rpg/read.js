// Reading the sheet (SPEC_RPG §2R, brief A4): the RPG blocks of the chat, from the head state.
//
// An RPG block is a pinned chat block whose definition has a `role` (names.js ROLES). Field keys are fixed
// (suite-notes/rpg-briefs/COMMON.md):
//   character: who, health, mana, stamina (stage indexes, 0 = empty), str vit agi dex int luk cha, points, soul (1–9),
//              xp, down (the death latch, hidden), alive
//   skills:    who, then skill1…skill5 (text), rank1…rank5 (0–3), practice1…practice5 (0–100)
//   foes:      foe1…foe4 (text), count1…count4, class1…class4 (1–9), hurt1…hurt4 (0–5)
// Pure and read-only: it takes a state (or anything shaped `{ domains: { dataModules } }`) and answers plain data. It
// never validates the definitions (the data-module checker did when they were pinned); a block it cannot read is left
// out, with a plain `problems` line.
import { FOE_SLOTS, SKILL_SLOTS, STATS } from './names.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = value => (Number.isSafeInteger(value) ? value : null);
const text = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** A name as the matcher compares it: NFKC, lower case, spaces and hyphens gone ("Iron-Breath" = "iron breath"). */
export const fold = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-‐‑–—]+/gu, '');

/**
 * Which of `entries` a phrase names (SPEC_RPG_v1 §4.5.1): an entry whose folded name equals the folded phrase, else the
 * longest entry whose folded name occurs inside the phrase ("iron breath drill" → Iron Breath), and with `either` also
 * an entry whose name contains the phrase when it is the only one. Two different entries of the same longest length are
 * ambiguous and nothing matches. → the entry, or null.
 */
export function matchName(entries, phrase, name, { either = false } = {}) {
    const wanted = fold(phrase);
    if (!wanted) return null;
    const named = entries.map(entry => ({ entry, key: fold(name(entry)) })).filter(item => item.key);
    const exact = named.filter(item => item.key === wanted);
    if (exact.length) return exact.length === 1 ? exact[0].entry : null;
    const inside = named.filter(item => wanted.includes(item.key));
    if (inside.length) {
        const longest = Math.max(...inside.map(item => item.key.length));
        const top = inside.filter(item => item.key.length === longest);
        return top.length === 1 ? top[0].entry : null;
    }
    if (either) {
        const holds = named.filter(item => item.key.includes(wanted));
        if (holds.length === 1) return holds[0].entry;
    }
    return null;
}

const FOE_NUMBER = /^(?:foe|slot|#)?\s*([1-9])$/i;

/** The character a phrase names (by `who`), or null. */
export const matchCharacter = (sheet, phrase) => matchName(sheet?.characters ?? [], phrase, entry => entry.who, { either: true });

/** The filled foe slot a phrase names (its name, or "foe2" / "slot 2" / "2"), or null. */
export function matchFoe(sheet, phrase) {
    const slots = (sheet?.foes ?? []).filter(foe => foe.filled);
    const number = FOE_NUMBER.exec(String(phrase ?? '').trim());
    if (number) return slots.find(foe => foe.slot === Number(number[1])) ?? null;
    return matchName(slots, phrase, foe => foe.name, { either: true });
}

/** The skill of `who`'s Skills block that a phrase names, or null. */
export const matchSkill = (character, phrase) => matchName(character?.skills ?? [], phrase, skill => skill.name);

const definitionOf = (domain, id) => {
    const pin = domain.pins?.[domain.active?.[id]?.hash];
    return isObject(pin?.definition) ? pin.definition : null;
};
const fieldsOf = (domain, id) => {
    const instance = domain.instances?.[id]?.chat;
    return isObject(instance?.fields) ? instance.fields : null;
};

function character(id, fields) {
    const who = text(fields.who);
    if (!who) return null;
    const stats = Object.fromEntries(STATS.map(stat => [stat, int(fields[stat])]));
    return {
        module: id, who, key: fold(who),
        health: int(fields.health), mana: int(fields.mana), stamina: int(fields.stamina),
        stats, soul: int(fields.soul) ?? 1, xp: int(fields.xp), points: int(fields.points),
        alive: fields.alive !== false,
        skills: [],
    };
}

function skillsOf(fields) {
    const out = [];
    for (let n = 1; n <= SKILL_SLOTS; n += 1) {
        const name = text(fields[`skill${n}`]);
        if (name) out.push({ slot: n, name, rank: int(fields[`rank${n}`]) ?? 0, practice: int(fields[`practice${n}`]) ?? 0 });
    }
    return out;
}

function foesOf(id, fields) {
    const out = [];
    for (let n = 1; n <= FOE_SLOTS; n += 1) {
        const name = text(fields[`foe${n}`]);
        const count = int(fields[`count${n}`]) ?? 0;
        out.push({ slot: n, module: id, name, count, class: int(fields[`class${n}`]) ?? 1, hurt: int(fields[`hurt${n}`]) ?? 0, filled: Boolean(name) && count > 0 });
    }
    return out;
}

/**
 * The chat's RPG blocks: `{ characters, foes, problems }`.
 *   characters: [{ module, who, key, health, mana, stamina, stats: { str…cha }, soul, xp, points, down, alive,
 *                  skills: [{ slot, name, rank, practice }] }]   (a Skills block joins the character its `who` names)
 *   foes: the four slots of the first Foes block, [{ slot, module, name, count, class, hurt, filled }] ([] without one)
 *   problems: plain sentences for blocks left out (no `who`, two characters of one name)
 */
export function readSheet(state) {
    const sheet = { characters: [], foes: [], problems: [] };
    const domain = state?.domains?.dataModules;
    if (!isObject(domain) || !isObject(domain.active)) return sheet;
    const ids = Object.keys(domain.active).sort();
    const skills = [];
    for (const id of ids) {
        const role = definitionOf(domain, id)?.role;
        const fields = fieldsOf(domain, id);
        if (!fields || typeof role !== 'string') continue;
        if (role === 'character') {
            const found = character(id, fields);
            if (!found) sheet.problems.push(`The Character block "${id}" has no name in its Who field, so it is left out.`);
            else if (sheet.characters.some(other => other.key === found.key)) sheet.problems.push(`Two Character blocks are called ${found.who}; only the first is used.`);
            else sheet.characters.push(found);
        } else if (role === 'skills') {
            const who = text(fields.who);
            if (who) skills.push({ who, list: skillsOf(fields) });
            else sheet.problems.push(`The Skills block "${id}" has no name in its Who field, so it is left out.`);
        } else if (role === 'foes' && !sheet.foes.length) sheet.foes = foesOf(id, fields);
    }
    for (const block of skills) {
        const owner = sheet.characters.find(entry => entry.key === fold(block.who));
        if (owner && !owner.skills.length) owner.skills = block.list;
    }
    return sheet;
}

/** The character `who` names (exact, folded), or null. */
export const characterOf = (sheet, who) => sheet?.characters?.find(entry => entry.key === fold(who)) ?? null;
