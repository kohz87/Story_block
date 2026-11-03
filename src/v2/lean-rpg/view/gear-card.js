// The slot card (Party -> Inventory, only while Gear in fights is on): a character's eight places and what is worn in each, in two columns
// (Head, Body, Cloak, Feet; Weapon, Off-hand, Accessory 1, Accessory 2), every tile the same size. A tile shows the place, the piece's name in its rarity
// colour and its stat bonus ("+2 DEX"); a thin line along its bottom is the condition (yellow Worn, orange Torn, red Broken; none when Good).
// No carry and no list of carried things here: those are the Inventory tab's. Every node is built with createElement and textContent.

import { h } from '../../view/widgets/dom.js';
import { RPG_STRINGS, fill } from '../strings.js';

const G = RPG_STRINGS.gear;
const P = RPG_STRINGS.party;

/** The places in drawing order: the left column, then the right one (the card lays them out in two columns of four). */
export const SLOT_ORDER = Object.freeze(['head', 'body', 'cloak', 'feet', 'weapon', 'off-hand', 'accessory-1', 'accessory-2']);

const ICONS = Object.freeze({
    head: 'fa-helmet-safety', body: 'fa-shirt', cloak: 'fa-cloud', feet: 'fa-shoe-prints',
    weapon: 'fa-khanda', 'off-hand': 'fa-shield-halved', 'accessory-1': 'fa-ring', 'accessory-2': 'fa-gem',
});

/** The record the Party tab keeps for an open slot card (outside the DOM: the page draws a screen again on every change of the story). */
export const newGearSession = character => ({ module: character.module, subject: character.subject });

/**
 * Draws `character`'s slot card into `parent`. `view` is the answer of `gear.view` for them ({ slots }); `onBack()` closes the card.
 * → { el, destroy() }
 */
export function renderGearCard(parent, { character, view, onBack = () => {}, doc = parent.ownerDocument ?? globalThis.document } = {}) {
    const root = h(doc, 'section', 'rpg-sheet rpg-gear ss-glass');
    root.setAttribute('aria-label', fill(G.title, { name: character.name }));
    parent.appendChild(root);
    const head = h(doc, 'div', 'rpg-sheet-head');
    head.appendChild(h(doc, 'h3', 'rpg-sheet-name', fill(G.title, { name: character.name })));
    head.appendChild(h(doc, 'span', 'ss-pill', fill(P.soul, { label: character.soulLabel, name: character.soulName })));
    root.appendChild(head);
    const slots = h(doc, 'div', 'rpg-slots');
    for (const place of SLOT_ORDER) {
        const piece = view?.slots?.[place] ?? null;
        const tile = h(doc, 'div', `rpg-slot${piece ? ` r-${piece.rarity}${piece.word === 'good' ? '' : ` w-${piece.word}`}` : ' rpg-slot-empty'}`);
        tile.setAttribute('data-slot', place);
        const icon = h(doc, 'i', `fa-solid ${ICONS[place]} rpg-slot-icon`);
        icon.setAttribute('aria-hidden', 'true');
        const body = h(doc, 'span', 'rpg-slot-body');
        if (piece) {
            body.appendChild(h(doc, 'span', 'rpg-slot-place', G.slots[place]));
            body.appendChild(h(doc, 'span', 'rpg-slot-name', piece.name));
            if (piece.bonus) body.appendChild(h(doc, 'span', 'rpg-slot-bonus', piece.bonus));
            tile.setAttribute('title', `${piece.name}: ${G.words[piece.word] ?? piece.word}${piece.broken ? ` — ${G.noBonus}` : ''}`);
            tile.appendChild(icon);
            tile.appendChild(body);
            tile.appendChild(h(doc, 'span', 'rpg-slot-cond'));
        } else {
            body.appendChild(h(doc, 'span', 'rpg-slot-place', `${G.slots[place]} — ${G.empty}`));
            tile.appendChild(icon);
            tile.appendChild(body);
        }
        slots.appendChild(tile);
    }
    root.appendChild(slots);
    const foot = h(doc, 'div', 'rpg-actions');
    const back = h(doc, 'button', 'ss-button ss-button-primary rpg-gear-back', G.back);
    back.setAttribute('type', 'button');
    back.addEventListener('click', () => onBack());
    foot.append(back, h(doc, 'p', 'rpg-sheet-note', G.note));
    root.appendChild(foot);
    return { el: root, destroy() { root.remove(); } };
}
