// The battle log (display D, approved mockup): a dark monospace panel drawn inside the reply at the narrator's
// `[battle]` marker, from the reply's recorded rolls (A's `rpg.resolve` receipt, `data.v2.result`); when the reply has
// no marker the same panel is a card under the reply, above "Changed this reply". It has a one-line header that folds
// (the fold is the viewer's: localStorage, per chat and reply), the turn order, one short line per action with the
// coloured result word and "(26 vs 16)", the breakdown on tap, the consequence arrow ("→ Sluice Rat A Wounded", from
// the reply's word changes), a Status grid with aligned solid bars and a Foes line. A check shows as one line.
//
// Nothing the panel shows is stored in the chat text: it is read from the record and the state each time, so a swipe,
// a delete, a Re-read and a reload agree. Every node is built with createElement and textContent.
//
// A's result record, as this file reads it (`readResolve`, one small adapter; A's field names are matched loosely):
//   { exchanges?, order?: [name], ended?: 'Victory',
//     rounds: [{ n, actions: [{ who, target, skill?, stat?, foe?, outcome: 'success'|'cost'|'fail', total, vs,
//                               mine?: { d20, parts: [{ label, value }], total }, theirs?: { … }, breakdown? }] }],
//     checks: [{ who, skill?, stat, what?, total, vs, outcome, mine?, theirs?, breakdown? }],
//     refused: [{ who, reason }] }

import { RESOLVE } from '../index.js';
import { readRecord } from '../../persist.js';
import { RPG_STRINGS, fill } from '../strings.js';
import { BARS, readFoes, readParty } from './party-data.js';

const B = RPG_STRINGS.battle;
export const BATTLE_ROOT = 'rpg-battle';
export const BATTLE_ID = 'lean-rpg/battle-log';
/** The narrator's marker: a line of its own. (turn.js strips the same line from the prompt history.) */
export const MARKER_LINE = /^[ \t]*\[battle\][ \t]*$/i;
const FOLD_KEY = 'story-block.lean-rpg.battle.folded';
const RECENT_MESSAGES = 30;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => (Array.isArray(value) ? value : []);
const words = (value, max = 80) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim().slice(0, max) : '');
const total = value => {
    const n = isRecord(value) ? value.total : value;
    return Number.isFinite(n) ? n : null;
};

/** 'success' | 'cost' | 'fail' | '' for the words A may use for an outcome. */
export function outcomeOf(raw) {
    const text = words(raw).toLowerCase();
    if (!text) return '';
    if (/cost/.test(text)) return 'cost';
    if (/fail|miss/.test(text)) return 'fail';
    if (/succ|hit/.test(text)) return 'success';
    return '';
}

/** "d20 14 + STR 7 + Class II 4 + Adept 1 = 26" from a roll `{ d20, parts, total }`; '' when there is nothing to show. */
export function rollText(roll) {
    if (!isRecord(roll)) return '';
    const d20 = Number.isFinite(roll.d20) ? `d20 ${roll.d20}` : '';
    const parts = list(roll.parts).filter(part => isRecord(part) && Number.isFinite(part.value) && part.value !== 0)
        .map(part => `${words(part.label, 24)} ${Math.abs(part.value)}`.trim());
    const signs = list(roll.parts).filter(part => isRecord(part) && Number.isFinite(part.value) && part.value !== 0).map(part => (part.value < 0 ? '−' : '+'));
    const body = [d20, ...parts.map((part, at) => (d20 || at ? `${signs[at]} ${part}` : part))].filter(Boolean).join(' ');
    const sum = Number.isFinite(roll.total) ? ` = ${roll.total}` : '';
    return body ? `${body}${sum}` : '';
}

function actionOf(raw) {
    if (!isRecord(raw)) return null;
    const who = words(raw.who ?? raw.actor ?? raw.attacker, 40);
    if (!who) return null;
    const mine = raw.mine ?? raw.roll, theirs = raw.theirs ?? raw.opposed;
    const breakdown = words(raw.breakdown, 240) || [rollText(mine), rollText(theirs)].filter(Boolean).join(' vs ');
    return {
        who, target: words(raw.target ?? raw.defender, 40), skill: words(raw.skill, 40), stat: words(raw.stat, 12).toUpperCase(),
        foe: raw.foe === true || raw.side === 'foe', outcome: outcomeOf(raw.outcome ?? raw.result),
        total: total(raw.total ?? mine), vs: total(raw.vs ?? raw.against ?? theirs), breakdown, arrows: [],
    };
}

/**
 * A's result record as the panel draws it: `{ rounds: [{ n, lines }], checks, order, ended, refused }` or null when the
 * record holds nothing to show. Anything unreadable is left out, never thrown.
 */
export function readResolve(result) {
    if (!isRecord(result)) return null;
    const rounds = list(result.rounds).map((round, at) => ({
        n: Number.isSafeInteger(round?.n ?? round?.round) ? round.n ?? round.round : at + 1,
        lines: list(round?.actions ?? round?.lines ?? round?.acts).map(actionOf).filter(Boolean),
    })).filter(round => round.lines.length);
    const checks = list(result.checks).map(actionOf).filter(Boolean).map(check => ({ ...check, what: check.skill || check.stat }));
    const refused = list(result.refused).filter(isRecord).map(item => ({ who: words(item.who, 40), why: words(item.reason ?? item.why, 120) })).filter(item => item.who);
    if (!rounds.length && !checks.length) return null;
    return { rounds, checks, refused, order: list(result.order).map(name => words(name, 40)).filter(Boolean), ended: words(result.ended, 40) };
}

/** The recorded rolls of a reply's record: the result of its `rpg.resolve` receipt that the replay kept, or null. */
export function resolveOf(record, problems = []) {
    const skipped = new Set(list(problems).flatMap(problem => list(problem?.receipts)));
    for (const receipt of list(record?.receipts)) {
        if (receipt?.type !== RESOLVE || skipped.has(receipt.id)) continue;
        const read = readResolve(receipt.data?.v2?.result);
        if (read) return read;
    }
    return null;
}

// What moved between the state before the reply and the reply's own: "Sluice Rat A Wounded", "Ren Tired".
function consequences(state, before, roleOf) {
    const out = [];
    const foesBefore = new Map(readFoes(before, { roleOf }).map(foe => [foe.name, foe]));
    for (const foe of readFoes(state, { roleOf })) {
        const was = foesBefore.get(foe.name);
        if (was && was.hurt !== foe.hurt) out.push({ name: foe.name, kind: 'health', text: `${foe.name} ${foe.word}` });
    }
    const was = new Map(readParty(before, { roleOf }).map(character => [`${character.module}|${character.subject}`, character]));
    for (const character of readParty(state, { roleOf })) {
        const old = was.get(`${character.module}|${character.subject}`);
        if (!old) continue;
        for (const key of BARS) if (old.bars[key].value !== character.bars[key].value) out.push({ name: character.name, kind: key, text: `${character.name} ${character.bars[key].word}` });
    }
    return out;
}

// The arrow goes on the last told action aimed at that name (a health change) or taken by it (mana, stamina), once. A change no
// told action explains is left to the Status block.
const same = (a, b) => a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase();
function attach(model, changes) {
    const lines = model.rounds.flatMap(round => round.lines);
    for (const change of changes) {
        const aimed = line => (change.kind === 'health' ? (line.target && same(line.target, change.name)) || (line.foe && same(line.who, change.name)) : same(line.who, change.name));
        lines.findLast(aimed)?.arrows.push(change.text);
    }
}

/**
 * The panel's content for a reply: the recorded rolls, the arrows, the Status rows and the Foes line.
 * `state` and `before` are the reply's state and the one before it (null for none).
 */
export function panelModel({ resolve, state, before = null, roleOf }) {
    const model = { ...resolve, rounds: resolve.rounds.map(round => ({ ...round, lines: round.lines.map(line => ({ ...line, arrows: [] })) })) };
    attach(model, consequences(state, before, roleOf));
    const names = new Set(model.rounds.flatMap(round => round.lines.flatMap(line => [line.who, line.target])));
    const party = readParty(state, { roleOf });
    const involved = party.filter(character => names.has(character.name));
    model.status = (involved.length ? involved : party).map(character => ({ name: character.name,
        rows: BARS.map(key => ({ key, ...character.bars[key], label: character.definition.state?.[key]?.label ?? RPG_STRINGS.bars[key] })) }));
    model.foes = model.rounds.length ? readFoes(state, { roleOf }).map(foe => ({ text: `${foe.count > 1 ? `${foe.name} ${fill(B.count, { n: foe.count })}` : foe.name}: ${foe.hurt === 0 ? B.down : foe.word}` })) : [];
    return model;
}

// ---- drawing --------------------------------------------------------------------------------------------------------

const el = (doc, tag, className = '', text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
};
const glyph = (doc, name) => {
    const node = el(doc, 'i', `fa-solid ${name}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
};

/** The header's words: "Combat · Exchange 2", "Combat · Exchanges 1–3", or "Check" for a reply with only checks. */
export function headerText(model) {
    if (!model.rounds.length) return B.headerChecks;
    const first = model.rounds[0].n, last = model.rounds.at(-1).n;
    return first === last ? fill(B.header, { n: first }) : fill(B.headerMany, { from: first, to: last });
}

function lineNode(doc, line, { check = false } = {}) {
    const wrap = el(doc, 'div', 'rpg-act');
    const row = el(doc, 'button', 'rpg-act-line');
    row.setAttribute('type', 'button');
    const mark = el(doc, 'span', 'rpg-act-mark', line.breakdown ? '▸' : '');
    mark.setAttribute('aria-hidden', 'true');
    const text = el(doc, 'span', 'rpg-act-text');
    const outcome = line.outcome ? B[line.outcome] : '';
    if (check) text.append(fill(B.check, { who: line.who, what: line.what, total: line.total ?? '?', against: line.vs ?? '?', outcome }));
    else {
        text.append(`${line.who} ${line.skill ? B.uses : B.attacks} `);
        if (line.skill) text.appendChild(el(doc, 'span', 'rpg-skill', line.skill));
        if (line.target) text.append(`${line.skill ? ` ${B.on} ` : ''}${line.target}`);
        if (outcome) {
            text.append(' — ');
            text.appendChild(el(doc, 'span', `rpg-out rpg-out-${line.outcome}`, outcome));
        }
        if (line.total !== null && line.vs !== null) text.append(` (${fill(B.vs, { total: line.total, against: line.vs })})`);
        if (line.arrows.length) text.appendChild(el(doc, 'span', 'rpg-arrow', ` → ${line.arrows.join(', ')}`));
    }
    row.append(mark, text);
    wrap.appendChild(row);
    if (line.breakdown) {
        const why = el(doc, 'p', 'rpg-why', line.breakdown);
        why.hidden = true;
        row.setAttribute('aria-expanded', 'false');
        row.setAttribute('title', fill(B.details, { line: line.who }));
        row.addEventListener('click', () => {
            const open = why.hidden;
            why.hidden = !open;
            row.setAttribute('aria-expanded', String(open));
            mark.textContent = open ? '▾' : '▸';
        });
        wrap.appendChild(why);
    }
    return wrap;
}

/**
 * The panel node for `model` (panelModel). Options: `folded`, `onFold(folded)`, `variant` ('inline' in the message,
 * 'card' under the reply), `index` (the reply's message index, kept on the node).
 */
export function buildPanel(doc, model, { folded = false, onFold = () => {}, variant = 'inline', index = -1 } = {}) {
    const root = el(doc, 'div', `${BATTLE_ROOT} rpg-battle-${variant}`);
    // A root of Story Suite's look (view/theme.js): the tokens reach the panel inside a chat message.
    root.setAttribute('data-ss-screen', BATTLE_ID);
    root.setAttribute('data-variant', variant);
    root.setAttribute('data-ss-index', String(index));
    const head = el(doc, 'button', 'rpg-bl-head');
    head.setAttribute('type', 'button');
    const chevron = glyph(doc, 'fa-chevron-up');
    chevron.classList.add('rpg-bl-chevron');
    head.append(glyph(doc, model.rounds.length ? 'fa-shield-halved' : 'fa-dice-d20'), el(doc, 'b', 'rpg-bl-title', headerText(model)), chevron);
    const body = el(doc, 'div', 'rpg-bl-body');
    root.append(head, body);
    const setFold = on => {
        body.hidden = on;
        root.classList.toggle('rpg-bl-folded', on);
        head.setAttribute('aria-expanded', String(!on));
        head.setAttribute('title', on ? B.unfold : B.fold);
        chevron.className = `fa-solid ${on ? 'fa-chevron-down' : 'fa-chevron-up'} rpg-bl-chevron`;
    };
    setFold(folded);
    head.addEventListener('click', () => {
        const on = !body.hidden;
        setFold(on);
        onFold(on);
    });

    if (model.order.length) body.appendChild(el(doc, 'p', 'rpg-bl-order', `${B.turnOrder} ${model.order.join(' > ')}`));
    for (const check of model.checks) body.appendChild(lineNode(doc, check, { check: true }));
    for (const round of model.rounds) {
        const box = el(doc, 'div', 'rpg-bl-round');
        box.appendChild(el(doc, 'p', 'rpg-bl-round-title', fill(B.round, { n: round.n })));
        for (const line of round.lines) box.appendChild(lineNode(doc, line));
        body.appendChild(box);
    }
    for (const item of model.refused) body.appendChild(el(doc, 'p', 'rpg-bl-note', fill(B.refused, { who: item.who, why: item.why })));
    if (model.ended) body.appendChild(el(doc, 'p', 'rpg-bl-ended', fill(B.ended, { how: model.ended })));
    if (model.rounds.length && model.status.length) {
        const status = el(doc, 'div', 'rpg-bl-status');
        status.appendChild(el(doc, 'p', 'rpg-bl-status-title', B.status));
        for (const who of model.status) {
            const row = el(doc, 'div', 'rpg-bl-who');
            row.setAttribute('data-who', who.name);
            row.appendChild(el(doc, 'b', 'rpg-bl-name', who.name));
            const cells = el(doc, 'div', 'rpg-bl-stats');
            row.appendChild(cells);
            for (const bar of who.rows) {
                const cell = el(doc, 'span', `rpg-bl-stat rpg-bl-${bar.key}`);
                const track = el(doc, 'span', 'rpg-bl-track');
                track.setAttribute('aria-hidden', 'true');
                track.style.setProperty('--rpg-fill', String(bar.max > 0 ? Math.round((bar.value / bar.max) * 1000) / 1000 : 0));
                track.appendChild(el(doc, 'span', 'rpg-bl-fill'));
                cell.append(el(doc, 'span', 'rpg-bl-label', bar.label), track, el(doc, 'span', 'rpg-bl-word', bar.word));
                cells.appendChild(cell);
            }
            status.appendChild(row);
        }
        if (model.foes.length) {
            const row = el(doc, 'div', 'rpg-bl-who rpg-bl-foes');
            row.append(el(doc, 'b', 'rpg-bl-name', B.foes), el(doc, 'span', 'rpg-bl-foe-list', model.foes.map(foe => foe.text).join(' · ')));
            status.appendChild(row);
        }
        body.appendChild(status);
    }
    return root;
}

// ---- finding the marker in a drawn message ---------------------------------------------------------------------------

const nodesOf = node => Array.from(node?.childNodes ?? []);
const SKIP = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE']);

/** The text nodes under `root` that hold a marker line (outside code and the panels themselves), in order. */
export function markerNodes(root) {
    const out = [];
    const walk = node => {
        for (const child of nodesOf(node)) {
            if (child.nodeType === 3) {
                if (String(child.data ?? child.textContent ?? '').split(/\r?\n/).some(line => MARKER_LINE.test(line))) out.push(child);
            } else if (child.nodeType === 1 && !SKIP.has(child.tagName) && !String(child.className ?? '').split(/\s+/).includes(BATTLE_ROOT)) walk(child);
        }
    };
    walk(root);
    return out;
}

const blank = node => (node.nodeType === 3 ? !String(node.data ?? node.textContent ?? '').trim() : node.tagName === 'BR');
const textOf = node => String(node.data ?? node.textContent ?? '');

/**
 * Takes the first marker line out of its paragraph and puts `panel` there: a paragraph that held other lines is split
 * in two around the panel, one that held only the marker is replaced. Returns true when a marker was found. Any other
 * marker line is taken out of the text.
 */
export function placeAtMarker(doc, root, panel) {
    const found = markerNodes(root);
    if (!found.length) return false;
    const [first, ...extra] = found;
    for (const node of extra) node.data = textOf(node).split(/\r?\n/).filter(line => !MARKER_LINE.test(line)).join('\n');
    const lines = textOf(first).split(/\r?\n/), at = lines.findIndex(line => MARKER_LINE.test(line));
    const parent = first.parentNode, siblings = nodesOf(parent), spot = siblings.indexOf(first);
    const before = siblings.slice(0, spot), after = siblings.slice(spot + 1);
    const tail = lines.slice(at + 1).join('\n'), tailNode = tail.trim() ? doc.createTextNode(tail) : null;
    first.data = lines.slice(0, at).join('\n');
    if (blank(first)) first.remove(); else before.push(first);
    // A line break right next to the marker belongs to it.
    while (before.length && blank(before.at(-1))) { const node = before.pop(); if (node !== first) node.remove(); }
    while (after.length && blank(after[0])) after.shift().remove();
    if (tailNode) after.unshift(tailNode);
    const hasBefore = before.some(node => !blank(node)), hasAfter = after.some(node => !blank(node));
    if (parent.tagName === 'P' && parent.parentNode) {
        const container = parent.parentNode, next = nodesOf(container)[nodesOf(container).indexOf(parent) + 1] ?? null;
        container.insertBefore(panel, next);
        if (hasAfter) {
            const rest = doc.createElement('p');
            for (const node of after) rest.appendChild(node);
            container.insertBefore(rest, nodesOf(container)[nodesOf(container).indexOf(panel) + 1] ?? null);
        }
        if (!hasBefore) parent.remove();
        return true;
    }
    const reference = after.find(node => node.parentNode === parent) ?? null;
    if (tailNode && tailNode.parentNode !== parent) parent.insertBefore(tailNode, reference);
    parent.insertBefore(panel, tailNode && tailNode.parentNode === parent ? tailNode : reference);
    return true;
}

// ---- following the chat ---------------------------------------------------------------------------------------------

const storage = doc => {
    try { return doc?.defaultView?.localStorage ?? globalThis.localStorage ?? null; } catch { return null; }
};

/** The viewer's fold per chat and reply (localStorage; this page only when it is not there). */
export function createFoldStore(doc) {
    const memory = new Set();
    const read = () => {
        try { return JSON.parse(storage(doc)?.getItem(FOLD_KEY) ?? '{}') ?? {}; } catch { return {}; }
    };
    return {
        has: key => (key in read() ? read()[key] === true : memory.has(key)),
        set(key, on) {
            if (on) memory.add(key); else memory.delete(key);
            const all = read();
            if (on) all[key] = true; else delete all[key];
            try { storage(doc)?.setItem(FOLD_KEY, JSON.stringify(all)); } catch { /* the choice lasts this page only */ }
        },
    };
}

/**
 * createBattleLog({ ctx, doc, store, events, featureOn, roleOf, messageElement? })
 * → { refresh(index, element?), refreshAll({ recent }), modelAt(index), destroy() }.
 * Draws, redraws or removes the panel of every drawn reply that has recorded rolls; `featureOn()` false removes them all.
 */
export function createBattleLog({ ctx, doc = globalThis.document, store, events = null, featureOn = () => true, roleOf, messageElement = null } = {}) {
    const chat = () => (Array.isArray(ctx?.chat) ? ctx.chat : []);
    const elementOf = messageElement ?? (index => doc.querySelector(`.mes[mesid="${index}"]`));
    const folds = createFoldStore(doc);
    const chatKey = () => String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? '');
    const problems = () => { try { return store?.problems?.() ?? []; } catch { return []; } };
    const stateAt = index => { try { return store.at(index); } catch { return null; } };
    const beforeOf = index => {
        for (let at = index - 1; at >= 0; at -= 1) if (chat()[at] && !chat()[at].is_user && readRecord(chat()[at])) return stateAt(at);
        return null;
    };

    /** What reply `index` shows: { key, model } or null (no recorded rolls, a message of the reader's, the feature off). */
    function modelAt(index) {
        const message = chat()[index];
        if (!featureOn() || !message || message.is_user || message.is_system) return null;
        const record = readRecord(message);
        if (!record) return null;
        const resolve = resolveOf(record, problems().filter(problem => problem?.index === index));
        const state = resolve ? stateAt(index) : null;
        if (!state) return null;
        return { key: `${chatKey()}|${record.sid ?? index}`, model: panelModel({ resolve, state, before: beforeOf(index), roleOf }) };
    }

    const panelsIn = message => Array.from(message.querySelectorAll(`.${BATTLE_ROOT}`));
    function placeCard(message, node) {
        const text = message.querySelector('.mes_text');
        const parent = text?.parentNode ?? message.querySelector('.mes_block') ?? message;
        const cards = nodesOf(parent).find(child => child.nodeType === 1 && String(child.className ?? '').split(/\s+/).includes('ss-cards'));
        if (node.parentNode === parent && (cards ? node.nextElementSibling === cards : true)) return;
        parent.insertBefore(node, cards ?? null);
    }

    function refresh(index, element = null) {
        const message = element ?? elementOf(index);
        if (!message) return null;
        const old = panelsIn(message);
        const shown = modelAt(index);
        if (!shown) {
            for (const node of old) node.remove();
            return null;
        }
        const text = message.querySelector('.mes_text');
        const marked = text ? markerNodes(text).length > 0 : false;
        const inline = old.find(node => node.getAttribute('data-variant') === 'inline');
        const variant = marked || inline ? 'inline' : 'card';
        const sign = JSON.stringify([shown.key, variant, shown.model, folds.has(shown.key)]);
        const kept = old.find(node => node.getAttribute('data-variant') === variant);
        if (!marked && kept && kept.getAttribute('data-ss-sign') === sign) {
            for (const node of old) if (node !== kept) node.remove();
            if (variant === 'card') placeCard(message, kept);
            return kept;
        }
        const node = buildPanel(doc, shown.model, { folded: folds.has(shown.key), variant, index, onFold: on => folds.set(shown.key, on) });
        node.setAttribute('data-ss-sign', sign);
        if (marked) {
            for (const item of old) item.remove();
            placeAtMarker(doc, text, node);
        } else if (variant === 'inline' && kept) {
            kept.parentNode.insertBefore(node, kept);
            for (const item of old) item.remove();
        } else {
            for (const item of old) item.remove();
            placeCard(message, node);
        }
        return node;
    }

    function refreshAll({ recent = false } = {}) {
        const drawn = Array.from(doc.querySelectorAll('.mes[mesid]'));
        for (const message of recent ? drawn.slice(Math.max(0, drawn.length - RECENT_MESSAGES)) : drawn) {
            const index = Number(message.getAttribute('mesid'));
            if (Number.isInteger(index)) refresh(index, messageElement ? null : message);
        }
    }

    const offs = [];
    const source = ctx?.eventSource;
    const types = ctx?.eventTypes ?? ctx?.event_types ?? {};
    if (typeof source?.on === 'function') {
        const all = () => refreshAll({ recent: true });
        const forget = () => refreshAll();
        const wire = [
            [types.CHARACTER_MESSAGE_RENDERED, all], [types.USER_MESSAGE_RENDERED, all], [types.MESSAGE_SWIPED, all],
            [types.MESSAGE_EDITED, all], [types.MESSAGE_UPDATED, all], [types.MESSAGE_SENT, all],
            [types.MESSAGE_DELETED, forget], [types.CHAT_CHANGED, forget], [types.MORE_MESSAGES_LOADED, forget],
        ].filter(([type]) => type);
        for (const [type, fn] of wire) source.on(type, fn);
        offs.push(() => { for (const [type, fn] of wire) (source.removeListener ?? source.off)?.call(source, type, fn); });
    }
    if (typeof events?.on === 'function') {
        for (const name of ['turn', 'head', 'feature']) {
            const off = events.on(name, () => refreshAll({ recent: name !== 'feature' }));
            if (typeof off === 'function') offs.push(off);
        }
    }

    return {
        refresh, refreshAll, modelAt,
        destroy() {
            offs.splice(0).forEach(off => off());
            for (const node of doc.querySelectorAll(`.${BATTLE_ROOT}`)) node.remove();
        },
    };
}
