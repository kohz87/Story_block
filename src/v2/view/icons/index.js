// Game icons (UI stage, step 7): inline SVG builder for the `gi-*` icon set (view/icons/set.js) and the
// default map from the game view's tab and screen ids to `gi-*` ids. Built with createElementNS only.

import { ICON_SET } from './set.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Default `gi-*` icon for each of the game view's tab and screen ids when a screen gives no icon of its own. */
export const TAB_ICONS = Object.freeze({
    home: 'gi-home',
    party: 'gi-party',
    inventory: 'gi-inventory',
    quests: 'gi-quests',
    world: 'gi-world',
    map: 'gi-map',
    fight: 'gi-fight',
    crafting: 'gi-crafting',
    trade: 'gi-trade',
    scene: 'gi-place',
    chronicle: 'gi-chronicle',
    director: 'gi-director',
    cast: 'gi-dossiers',
    dossiers: 'gi-dossiers',
    'story-block/home': 'gi-home',
    'rpg-battle/party': 'gi-party',
    'story-block/inventory': 'gi-inventory',
    'story-director/quests': 'gi-quests',
    'story-director/world': 'gi-world',
    'story-director/map': 'gi-map',
    'rpg-battle/fight': 'gi-fight',
    'rpg-battle/crafting': 'gi-crafting',
    'rpg-battle/trade': 'gi-trade',
    'story-block/scene': 'gi-place',
    'story-director/chronicle': 'gi-chronicle',
    'story-director/director': 'gi-director',
    'npc-state-delta/cast': 'gi-dossiers',
    'npc-state-delta/dossiers': 'gi-dossiers',
});

/** True when `id` is a known `gi-*` icon in the inline set. */
export function hasIcon(id) {
    return typeof id === 'string' && Object.hasOwn(ICON_SET, id.trim());
}

/** Looks up the default `gi-*` icon for a game view tab or screen id (full `module/id` or short tail). */
export function tabIcon(id) {
    if (typeof id !== 'string' || !id) return '';
    const key = id.trim().toLowerCase();
    if (Object.hasOwn(TAB_ICONS, key)) return TAB_ICONS[key];
    const slash = key.indexOf('/');
    const tail = slash >= 0 ? key.slice(slash + 1) : '';
    return tail && Object.hasOwn(TAB_ICONS, tail) ? TAB_ICONS[tail] : '';
}

/**
 * Builds an inline `<svg>` element for `id` with `doc.createElementNS('http://www.w3.org/2000/svg', ...)`
 * (`viewBox="0 0 512 512"`, one `<path>`, `fill="currentColor"`, `aria-hidden="true"`, `focusable="false"`,
 * `width="1em"`, `height="1em"`). Returns `null` when `id` is not in the set.
 */
export function svgIcon(doc, id, className = '') {
    if (!hasIcon(id)) return null;
    const key = id.trim();
    const entry = ICON_SET[key];
    const svg = doc.createElementNS(SVG_NS, 'svg');
    const extra = typeof className === 'string' ? className.trim() : '';
    const classes = !extra
        ? 'ss-icon-svg'
        : extra.split(/\s+/).includes('ss-icon-svg')
            ? extra
            : `${extra} ss-icon-svg`;
    svg.setAttribute('class', classes);
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('data-icon', key);
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', entry.path);
    svg.appendChild(path);
    return svg;
}
