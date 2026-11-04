// The inventory domain's prompt view (moved out of domains/inventory.js unchanged; inventory.js re-exports every public name): how a
// story note, an item and a group of items read in the tail, packed into a line that fits. Pure.

import { trimText } from '../names.js';
import { condMark } from '../gear.js';
import { itemText } from './validate.js';

// With gear on, an item below Good shows its condition word after the name: "Cane Sword (worn)".
export const condText = (item, gear) => { const word = gear && item.cond !== undefined ? condMark(item.cond) : ''; return word ? ` (${word})` : ''; };

// Where a thing was found is on the screens, not in the prompt (prompt diet): "found at the drain", "picked up in the cellar" is left out of a note,
// what else it says stays ("tarred hemp, found at the drain" → "tarred hemp"). Only "found" or "picked up" with a place word is left out; who it was taken
// from, a debt, a clue, a duel, "found on the body of Captain Rell" all stay. The stored note is not touched.
const PROVENANCE = /^(?:found|picked up)\s+(?:at|in|near|under|behind|inside|beside)\b/iu;
export function promptNote(note) {
    const text = String(note ?? '');
    const parts = text.split(/\s*[;,]\s*/);
    const kept = parts.filter(part => !PROVENANCE.test(part.trim()));
    return kept.length === parts.length ? text : kept.join(', ');
}

export function itemPhrase(item, gear = false) {
    const said = item.note ? promptNote(item.note) : '';
    const note = said ? ` (${trimText(said, 40)})` : '';
    return `${itemText(item.name, item.qty)}${condText(item, gear)}${note}`;
}

export function owners(items) {
    return [...new Set(items.map(item => item.owner))];
}

const LINE_MAX = 200;

// Phrases packed into "Label: a, b, c" lines of at most LINE_MAX characters, using at most
// `room` characters in all (a newline counted per line): { lines, taken, used }.
export function pack(label, phrases, room) {
    const lines = [];
    let current = '';
    let used = 0;
    let taken = 0;
    while (taken < phrases.length) {
        const piece = current ? `, ${phrases[taken]}` : `${label}: ${phrases[taken]}`;
        if (current && current.length + piece.length > LINE_MAX) {
            lines.push(current);
            used += current.length + 1;
            current = '';
            continue;
        }
        if (used + current.length + piece.length + 1 > room) break;
        current += piece;
        taken += 1;
    }
    if (current) {
        lines.push(current);
        used += current.length + 1;
    }
    return { lines, taken, used };
}

// The wallet line says it is the purse BEFORE this reply, so a payment the story makes in this reply is not read as already counted.
// (The ask for a coin line is the coin kind's grammar line alone, once.)
export const WALLET_NOTE = 'before this reply';
