// Turns a staged/opened board fight or a planner's rolled opening into plain text and numbers for the start views.
// It reads the sheet without changing it; the offer line and pause view never read game state themselves.
// Foe names stay text (never markup), and the helper is safe to call while a preview is still waiting.

import { foeLabel } from '../foes.js';
import { STAGES, stageWord } from '../names.js';
import { readSheet } from '../read.js';

export const OFFER_BOARD_LABEL = 'Fight on the board';
export const OFFER_KEEP_LABEL = 'Keep narrating';
export const PAUSE_BOARD_LABEL = 'Fight it on the board';
export const PAUSE_NARRATE_LABEL = 'Narrate it instead';
export const WORKING_TEXT = 'Working out the fight…';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => (Array.isArray(value) ? value : []);
const whole = value => (Number.isSafeInteger(value) ? value : null);
const sentence = (value, max = 80) => (typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/gu, ' ').trim().slice(0, max)
    : '');
const slotOf = value => {
    if (Number.isSafeInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/u.test(value.trim())) return Number(value);
    if (Number.isSafeInteger(value?.slot)) return value.slot;
    return null;
};

// A resolve preview can arrive as the bare result, a prelude { result }, or the command receipt { data: { v2: { result } } }.
function resultOf(value) {
    if (!isObject(value)) return null;
    for (const candidate of [value.data?.v2?.result, value.preview?.result, value.result, value]) {
        if (isObject(candidate) && ['opened', 'checks', 'rounds', 'order', 'ambush', 'plan', 'open']
            .some(key => Object.hasOwn(candidate, key))) return candidate;
    }
    return null;
}

const sessionOf = fight => (isObject(fight?.session) ? fight.session : isObject(fight?.board) ? fight.board : fight);

function foeFrom(source) {
    const name = sentence(source?.name, 60);
    if (!name) return null;
    const count = whole(source?.count) ?? 1;
    const level = whole(source?.level);
    const size = whole(source?.size) ?? 5;
    const hurt = Number.isFinite(source?.hurt) ? Math.max(0, Math.min(size, source.hurt)) : null;
    const health = sentence(source?.word ?? source?.healthWord, 40) || (hurt === null ? 'Unhurt' : stageWord(STAGES.health, hurt, size));
    const countText = count > 1 ? ` ×${count}` : '';
    const levelText = level === null ? '' : ` · ${foeLabel(level)}`;
    return { name, count, level, hurt, size, health, label: `${name}${countText}${levelText}` };
}

/** The standing groups of a staged/opened fight, with the sheet's names, levels and health when `state` is given. */
export function fightFoes(fight, state = null) {
    const session = sessionOf(fight);
    if (!isObject(session)) return [];
    const explicit = list(session.foes).map(foeFrom).filter(Boolean);
    const sheet = state ? readSheet(state) : null;
    const groups = new Set(list(session.groups).map(slotOf).filter(value => value !== null));
    if (sheet && groups.size) {
        const found = sheet.foes.filter(foe => foe.filled && groups.has(foe.slot)).map(foeFrom).filter(Boolean);
        if (found.length) return found;
    }
    if (explicit.length) return explicit;
    const order = list(session.setup?.order ?? session.order ?? resultOf(session.result)?.order);
    return order.filter(entry => entry && entry.party !== true).map(entry => foeFrom({ name: entry.name })).filter(Boolean);
}

function openingFoes(opening) {
    const result = resultOf(opening);
    if (!result) return [];
    const opened = list(result.opened);
    if (opened.length) return opened.map(foeFrom).filter(Boolean);
    const planned = list(result.plan?.open ?? result.open);
    return planned.map(foeFrom).filter(Boolean);
}

const OUTCOME = Object.freeze({ success: 'SUCCESS', cost: 'SUCCESS AT A COST', fail: 'FAIL' });

function approachChecks(opening) {
    const result = resultOf(opening);
    if (!result) return [];
    const checks = list(result.checks).filter(check => check?.kind === 'check' || check?.pc?.who || check?.who);
    const ambushChecks = checks.filter(check => check?.ambush === true);
    return (ambushChecks.length ? ambushChecks : checks).map(check => {
        const who = sentence(check.pc?.who ?? check.who, 60);
        const skill = sentence(check.skill, 60);
        const stat = sentence(check.pc?.stat ?? check.stat, 8).toUpperCase();
        const outcome = OUTCOME[check.outcome] ?? sentence(check.outcome, 24).toUpperCase();
        const total = Number.isFinite(check.pc?.total) ? check.pc.total : check.total;
        const dc = Number.isFinite(check.dc) ? check.dc : check.pc?.dc;
        const lead = `${who || 'The party'}${skill ? ` · ${skill}${stat ? ` (${stat})` : ''}` : stat ? ` · ${stat}` : ''}`;
        const numbers = Number.isFinite(total) && Number.isFinite(dc) ? ` ${total} vs ${dc}` : '';
        return {
            who, skill, stat: stat || null, outcome: check.outcome ?? '', ambush: check?.ambush === true,
            total: Number.isFinite(total) ? total : null, dc: Number.isFinite(dc) ? dc : null,
            label: `${lead}: ${outcome || 'ROLLED'}${numbers}`,
        };
    });
}

function edgeText(opening) {
    const result = resultOf(opening);
    if (!result) return '';
    const ambush = isObject(result.ambush) ? result.ambush : null;
    if (ambush) {
        if (ambush.success !== true) return 'Edge: no ambush';
        const who = sentence(ambush.who, 60);
        return `Edge: ambush${who ? ` · ${who} acts first` : ''}`;
    }
    const quick = list(result.quickStart).find(item => sentence(item?.who));
    return quick ? `Edge: quick start · ${sentence(quick.who, 60)} acts first` : '';
}

/**
 * The inline offer under the narrator's reply: `{ visible, text, names, foes, actions, … }`, or null with no fight.
 * `hidden` is the reader's choice to keep narrating this fight. `state` lets the names come from the current sheet.
 */
export function offerLineData(fight, { state = null, hidden = false } = {}) {
    const foes = fightFoes(fight, state);
    if (!foes.length) return null;
    const names = [...new Set(foes.map(foe => foe.name))];
    const joined = names.join(', ');
    return {
        kind: 'offer', visible: hidden !== true, foes, names,
        text: `A fight started: ${joined}.`,
        label: `Fight offer: ${joined}`,
        dotLabel: 'Fight offer open',
        boardLabel: OFFER_BOARD_LABEL,
        narrateLabel: OFFER_KEEP_LABEL,
        actions: [
            { key: 'board', label: OFFER_BOARD_LABEL, primary: true },
            { key: 'narrate', label: OFFER_KEEP_LABEL, primary: false },
        ],
    };
}

const pauseActions = () => [
    { key: 'board', label: PAUSE_BOARD_LABEL, primary: true },
    { key: 'narrate', label: PAUSE_NARRATE_LABEL, primary: false },
];

/**
 * The pause screen's data. Prefer the planner's rolled `opening` when it names new foes or approach checks; otherwise
 * show a staged/opened fight's known foes, or the waiting state while the planner call is out.
 * → { mode: 'new' | 'known' | 'working', title, foes, checks, edge, note, actions, … } or null.
 */
export function pauseViewData({ fight = null, opening = null, state = null, waiting = false } = {}) {
    const newFoes = openingFoes(opening);
    const checks = approachChecks(opening);
    if (newFoes.length || checks.length) {
        return {
            mode: 'new', title: 'Your message starts a fight', foeTitle: 'New foes',
            foes: newFoes, checks, edge: edgeText(opening), note: '',
            label: 'Fight starts', actions: pauseActions(),
            boardLabel: PAUSE_BOARD_LABEL, narrateLabel: PAUSE_NARRATE_LABEL,
        };
    }
    const known = fightFoes(fight, state);
    if (known.length) {
        return {
            mode: 'known', title: 'Your message starts a fight', foeTitle: 'Foes',
            foes: known, checks: [], edge: '', note: 'The reply is waiting. Choose how this fight is played.',
            label: 'Fight paused', actions: pauseActions(),
            boardLabel: PAUSE_BOARD_LABEL, narrateLabel: PAUSE_NARRATE_LABEL,
        };
    }
    if (waiting === true) {
        return {
            mode: 'working', title: '', status: WORKING_TEXT, foeTitle: '', foes: [], checks: [], edge: '', note: '',
            label: 'Working out the fight', actions: [], boardLabel: PAUSE_BOARD_LABEL, narrateLabel: PAUSE_NARRATE_LABEL,
        };
    }
    return null;
}
