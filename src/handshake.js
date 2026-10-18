// Story Block's side of the Story Suite handshake (src/suite.js, docs/STORY_SUITE.md): which
// shared areas the reader's blocks offer right now, the reader's Source of truth choices, and
// what Story Block does when another extension owns an area.
//
// Pure, so it is tested without SillyTavern; index.js announces and re-renders. Alone (nobody
// else announced), every answer here is the one Story Block gave before the suite existed:
// nothing is deferred, no notice is shown and the dice modifier works as in 0.7.

import { isSourceOfTruth } from './suite.js';

export const SUITE_ID = 'story-block';
export const SUITE_NAME = 'Story Block';

// The areas Story Block can offer, in settings order, and what in Story Block provides each.
export const SHARED_AREAS = Object.freeze(['scene', 'timeline', 'items', 'stats', 'rolls']);
export const AREA_LABELS = Object.freeze({
    scene: { label: 'Scene', provider: 'World State' },
    timeline: { label: 'Timeline', provider: 'World State' },
    items: { label: 'Items', provider: 'Inventory' },
    stats: { label: 'Stats', provider: 'Character Sheet' },
    rolls: { label: 'Rolls', provider: 'Dice' },
});
export const SOURCE_CHOICES = Object.freeze(['auto', 'mine', 'theirs']);

// A block is one of the built-ins by its `template`, which duplicates and "Reset to default"
// keep. The scene board and dice displays draw nothing else, so a custom block shown that way
// provides the same; Inventory also by its tag, the one Inventory Block's snapshots are read as.
const PROVIDES = [
    { areas: ['scene', 'timeline'], is: def => def.template === 'world-state' || def.display === 'scene' },
    { areas: ['items'], is: def => def.template === 'inventory' || String(def.tag ?? '').toLowerCase() === 'inventory' },
    { areas: ['stats'], is: def => def.template === 'character-sheet' },
    { areas: ['rolls'], is: def => def.template === 'dice' || def.template === 'dice-everyone' || def.display === 'dice' },
];

/** The shared areas one block provides (whether or not it is on). */
export function blockAreas(def) {
    if (!def || def.kept || def.plugin) return [];
    return PROVIDES.filter(entry => entry.is(def)).flatMap(entry => entry.areas);
}

/** What Story Block offers the suite: the areas its enabled blocks provide, in SHARED_AREAS order. */
export function offeredAreas(blocks) {
    const found = new Set((Array.isArray(blocks) ? blocks : []).filter(def => def?.enabled).flatMap(blockAreas));
    return SHARED_AREAS.filter(area => found.has(area));
}

/** The reader's choice per area, 'auto' unless they picked 'mine' or 'theirs'. */
export function normalizeSourceChoices(value) {
    const stored = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(SHARED_AREAS.map(area => [area, SOURCE_CHOICES.includes(stored[area]) ? stored[area] : 'auto']));
}

/**
 * Who Story Block defers to for `area` under the reader's choice: { id, name } of the other
 * extension, or null while Story Block is the source of truth (always, when it is alone).
 */
export function deferredTo(area, choice, suite) {
    if (isSourceOfTruth(SUITE_ID, area, choice, suite)) return null;
    // Under 'auto' that is the owner; under 'theirs', the first other one that offers it.
    const owner = suite.owner(area);
    const id = owner && owner !== SUITE_ID ? owner : suite.offering(area).find(other => other !== SUITE_ID);
    if (!id) return null;
    const provider = suite.providers().find(item => item.id === id);
    return { id, name: String(provider?.name ?? '').trim() || id };
}

/**
 * The note a Character Sheet tab carries while another extension owns stats, or ''. The sheet
 * itself is left alone: the reader decides whether to keep it.
 */
export function statsNotice(def, choices, suite) {
    if (!blockAreas(def).includes('stats')) return '';
    const other = deferredTo('stats', normalizeSourceChoices(choices).stats, suite);
    if (!other) return '';
    return `${other.name} owns stats. This sheet keeps working; turn it off if you want one set of numbers, or choose it under Source of truth in Story Block's settings.`;
}

/**
 * Whether the Dice block keeps its own modifier instead of a kept block's (RPG Battle's Checks
 * line, since 0.7). Only when the reader made Story Block the source of truth for rolls while
 * another extension offers them; alone, or with an extension that never announced, kept
 * modifiers are used exactly as before.
 */
export function keepsOwnRolls(choice, suite) {
    if (!isSourceOfTruth(SUITE_ID, 'rolls', choice, suite)) return false;
    return suite.offering('rolls').some(id => id !== SUITE_ID);
}

/** One settings line for an area: who is its source of truth now, given the choice. */
export function sourceStatus(area, { choice, suite, offered }) {
    const { provider } = AREA_LABELS[area] ?? { provider: area };
    if (!offered) {
        const owner = suite.owner(area);
        const name = owner ? suite.providers().find(item => item.id === owner)?.name || owner : '';
        return name ? `${provider} is off · ${name} has it` : `${provider} is off`;
    }
    const other = deferredTo(area, choice, suite);
    return other ? `Now: ${other.name}` : `Now: ${SUITE_NAME}`;
}

// Displays another extension can draw in its own place (announcement `shows`, v0.9.1): NPC
// State Delta shows each NPC's chatter on its Present cards. Only these are honoured, so an
// announcement can never hide the reader's other blocks.
export const SHOWABLE_DISPLAYS = Object.freeze(['chatter']);

/**
 * The displays an enabled extension other than Story Block announces it shows itself
 * (`shows: ['chatter']`), in SHOWABLE_DISPLAYS order. Blocks drawn that way get no tab (hasTab)
 * while it lasts; they are still prompted, written and kept. Alone: [].
 */
export function displaysShownElsewhere(suite) {
    const shown = new Set();
    for (const provider of suite?.providers?.() ?? []) {
        if (provider.id === SUITE_ID || provider.enabled === false || !Array.isArray(provider.shows)) continue;
        for (const display of provider.shows) shown.add(String(display));
    }
    return SHOWABLE_DISPLAYS.filter(display => shown.has(display));
}

export const NPC_STATE_DELTA_ID = 'npc-state-delta';
export const CHATTER_NOTE = 'Voice each NPC as their NPC State Delta card describes.';

/**
 * The runtime line a chatter-display block's prompt section gets while NPC State Delta is
 * announced and enabled, or ''. The reader's stored prompt is never changed.
 */
export function chatterNote(def, suite) {
    if (def?.display !== 'chatter' || def.kept || def.plugin) return '';
    return suite?.has?.(NPC_STATE_DELTA_ID) ? CHATTER_NOTE : '';
}

export const RPG_BATTLE_ID = 'rpg-battle';
export const FIGHT_NOTE = 'Never roll a fight: when blows are about to land, stop there; RPG Battle runs it.';

/**
 * The runtime line a dice-display block's prompt section gets while RPG Battle is announced
 * and enabled, or '' (v0.9.4). Without it a model given a fresh roll resolves the fight with
 * it ("natural 20, the beast goes down") and RPG Battle never offers the fight.
 */
export function diceNote(def, suite) {
    if (def?.display !== 'dice' || def.kept || def.plugin) return '';
    return suite?.has?.(RPG_BATTLE_ID) ? FIGHT_NOTE : '';
}
