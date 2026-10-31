// The prompt tail's lines for the RPG's blocks (a block whose definition has a `role`), written compact: a party of three with
// five skills each would otherwise send about 880 tokens every reply. Rules, in plain words:
//   * a value at its field's default is left out (a full Health bar, no points, no XP, alive), except a stat, a Soul Class and a name;
//   * values go by their names where the field has them ("Hurt", "II", "Adept"), never the stored number;
//   * a Skills block is one line per skill, empty slots left out ("Short blade (Novice, agi, stamina): what it does");
//   * a Foes block lists only the groups in the fight, one clause each; with none, and for a Rules block with no fields, there is no line;
//   * the field keys are not written for a skill or a foe (`skill3`, `about3`), and practice is not either: the story adds it by a line and the
//     rules raise the rank, so only the rank (by its name) is something it tells.
// Pure: no DOM, no state. `summaryOf` (data-modules/part.js) calls it for a block with a role and cuts the result to the block's room.

import { STATS } from './names.js';
import { oneLine } from '../../text.js';

const SLOTS = Object.freeze({ skills: 5, foes: 4 });
const word = value => (typeof value === 'string' ? oneLine(value) : '');

// "Hurt, Fresh" style bits of one instance, in the definition's field order: what is not at its default, the stats as one run.
function sheetBody(definition, fields, { hidden, text }) {
    const parts = [];
    let stats = null;
    for (const [key, schema] of Object.entries(definition.state)) {
        if (key === 'who' || hidden(key) || !(key in fields)) continue;
        const value = fields[key];
        if (STATS.includes(key) && typeof value === 'number') {
            if (!stats) { stats = []; parts.push(stats); }
            const label = typeof schema.label === 'string' && schema.label && [...schema.label].length <= 4 ? schema.label : key.toUpperCase();
            stats.push(`${label} ${value}`);
        } else if (schema.type === 'text') {
            if (word(value)) parts.push(`${key} "${word(value)}"`);
        } else if (value !== schema.default || key === 'soul') parts.push(text(key, value));
    }
    return parts.map(part => (Array.isArray(part) ? part.join(' ') : part)).join('; ');
}

function skillsBody(definition, fields, { named }) {
    const lines = [];
    for (let slot = 1; slot <= SLOTS.skills; slot += 1) {
        const name = word(fields[`skill${slot}`]);
        if (!name) continue;
        const bits = [named(`rank${slot}`, fields[`rank${slot}`]), word(fields[`stat${slot}`]), word(fields[`uses${slot}`])].filter(Boolean);
        const about = word(fields[`about${slot}`]);
        lines.push(`- ${name} (${bits.join(', ')})${about ? `: ${about}` : ''}`);
    }
    return lines;
}

function foesBody(definition, fields, { named }) {
    const out = [];
    for (let slot = 1; slot <= SLOTS.foes; slot += 1) {
        const name = word(fields[`foe${slot}`]);
        if (!name) continue;
        const count = fields[`count${slot}`], hurt = fields[`hurt${slot}`];
        const bits = [`Class ${named(`class${slot}`, fields[`class${slot}`])}`];
        if (hurt !== definition.state[`hurt${slot}`]?.default) bits.push(named(`hurt${slot}`, hurt));
        out.push(`${name}${Number.isSafeInteger(count) && count > 1 ? ` ×${count}` : ''} (${bits.join(', ')})`);
    }
    return out;
}

/**
 * The tail line(s) of a block with a role: `people` is `[{ name, fields }]` (one for a chat block, one per attached character
 * otherwise); `hidden(key)` says a field is not sent (`prompt: false`), `text(key, value)` is one field as "key value", `named(key, value)`
 * a value by its display name where the field has one. → the text, or '' when the block has nothing to say.
 */
export function roleTail(definition, people, { hidden, text, named }) {
    const lines = [];
    for (const { name, fields } of people) {
        const who = word(fields.who) || name;
        if (definition.role === 'skills') {
            const skills = skillsBody(definition, fields, { named });
            if (skills.length) lines.push(`${word(fields.who) ? `${word(fields.who)} skills` : name}:`, ...skills);
        } else if (definition.role === 'foes') {
            const foes = foesBody(definition, fields, { named });
            if (foes.length) lines.push(`${definition.name}: ${foes.join('; ')}.`);
        } else {
            const body = sheetBody(definition, fields, { hidden, text });
            if (body) lines.push(`${who} — ${body}.`);
        }
    }
    return lines.join('\n');
}
