// Scene display: a World State text block drawn as a scene board.
//
// Chips for when, where and the weather; a card per person (yours first), with mood,
// outfit and position; what happens off-screen; open threads, seeds and timers; and
// where the arc and the scene stand. The text stays the state: parseScene reads it on
// every render, and when it does not look like a World State the plain display draws
// it instead, so nothing the model wrote is ever lost to the board.
//
// Secrets are something the reader's character does not know. They stay behind a
// "Reveal secret" button, are not in the DOM until revealed, and never show in the
// change marks.

import { button, el, emptyText, plural, renderEmpty, renderFrame, stop } from '../dom.js';
import { render as renderPlain } from './plain.js';
import { ARC_PHASES, SCENE_PHASES, diffScene, parseScene, pcName, phaseStep } from '../../scene.js';

// Fields drawn first, in this order; anything else the model wrote follows as written.
const FIELD_ORDER = ['Outfit', 'Position', 'Agenda', 'Visible Condition', 'Carrying'];
const MOOD_PILL_MAX = 24;

const CHIPS = [
    { key: 'time', label: 'Time', icon: 'fa-clock' },
    { key: 'location', label: 'Location', icon: 'fa-location-dot' },
    { key: 'weather', label: 'Weather', icon: 'fa-cloud-sun' },
];

const LISTS = [
    { key: 'threads', label: 'Threads', icon: 'fa-fire' },
    { key: 'seeds', label: 'Seeds', icon: 'fa-seedling' },
    { key: 'timers', label: 'Timers', icon: 'fa-hourglass-half' },
];

// Revealed secrets per card, keyed by the secret's text so a new secret starts hidden
// again. Survives re-renders (a refresh lands on every chat event) but not reloads.
const revealed = new Map();
let nextId = 0;

const changeKey = label => String(label ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const isSecretChange = change => /·\s*secrets?\s*$/i.test(String(change?.label ?? '')) || /^secrets?$/i.test(String(change?.label ?? '').trim());

function revealedFor(uiKey) {
    const key = String(uiKey ?? 'default');
    if (!revealed.has(key)) revealed.set(key, new Set());
    return revealed.get(key);
}

function srOnly(text) {
    return el('span', 'story-block-scene-sr', text);
}

function icon(name) {
    const glyph = el('i', `fa-solid ${name}`);
    glyph.setAttribute('aria-hidden', 'true');
    return glyph;
}

function changeNote(change) {
    const node = el('div', `story-block-scene-change is-${change.type}`);
    const dot = el('span', 'story-block-scene-change-dot');
    dot.setAttribute('aria-hidden', 'true');
    node.appendChild(dot);
    let text = 'Changed';
    if (change.type === 'added' && !change.from) text = 'New';
    else if (change.from !== undefined || change.to !== undefined) text = `${String(change.from ?? '').trim() || '—'} → ${String(change.to ?? '').trim() || '—'}`;
    node.appendChild(el('span', 'story-block-scene-change-text', text));
    node.title = text === 'New' ? 'New since the previous state' : 'Changed since the previous state';
    return node;
}

// The first clause of the mood, for a pill that is read at a glance; the full line
// still shows as a row when the pill had to shorten it.
function moodPill(mood) {
    const full = String(mood ?? '').trim();
    let short = full.split(/\s+[—–-]\s+|\s*[;,.(]\s*/)[0].trim() || full;
    if (short.length > MOOD_PILL_MAX) short = `${short.slice(0, MOOD_PILL_MAX - 1).trim()}…`;
    return { short, complete: short === full };
}

function renderChips(scene, changeFor) {
    const list = el('ul', 'story-block-scene-chips');
    list.setAttribute('aria-label', 'Scene');
    for (const chip of CHIPS) {
        const value = scene[chip.key];
        if (!value) continue;
        const change = changeFor(chip.label);
        const item = el('li', `story-block-scene-chip is-${chip.key}${change ? ` is-changed is-${change.type}` : ''}`);
        item.append(icon(chip.icon), srOnly(`${chip.label}: `));
        // The template's `Place | Region` reads better with a middle dot.
        item.appendChild(el('span', 'story-block-scene-chip-text', value.replace(/\s*\|\s*/g, ' · ')));
        if (change) {
            const dot = el('span', 'story-block-scene-change-dot');
            dot.setAttribute('aria-hidden', 'true');
            item.appendChild(dot);
            const was = String(change.from ?? '').trim();
            item.title = was ? `Was: ${was}` : 'New since the previous state';
            item.appendChild(srOnly(was ? ` (was ${was})` : ' (new)'));
        }
        list.appendChild(item);
    }
    for (const extra of scene.extras ?? []) {
        const item = el('li', 'story-block-scene-chip is-extra');
        item.append(el('span', 'story-block-scene-chip-label', `${extra.label}:`), el('span', 'story-block-scene-chip-text', extra.value));
        list.appendChild(item);
    }
    return list.children.length ? list : null;
}

function renderSecret(name, secret, memory) {
    const id = `story-block-scene-secret-${++nextId}`;
    const memoryKey = `${changeKey(name)}\n${secret}`;
    const wrap = el('div', 'story-block-scene-secret');
    const toggle = button('story-block-scene-reveal');
    toggle.setAttribute('aria-controls', id);
    const body = el('div', 'story-block-scene-secret-text');
    body.id = id;

    const draw = open => {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.replaceChildren(icon(open ? 'fa-eye-slash' : 'fa-eye'), el('span', '', open ? 'Hide secret' : 'Reveal secret'));
        wrap.classList.toggle('is-open', open);
        // Not merely hidden with CSS: an unrevealed secret is not in the page at all,
        // so it cannot be read by selecting, copying or a screen reader skimming.
        body.textContent = open ? secret : '';
        if (open) body.removeAttribute('hidden');
        else body.setAttribute('hidden', '');
    };
    toggle.addEventListener('click', stop(() => {
        const open = !memory.has(memoryKey);
        if (open) memory.add(memoryKey);
        else memory.delete(memoryKey);
        draw(open);
    }));
    draw(memory.has(memoryKey));
    wrap.append(toggle, body);
    return wrap;
}

function renderPerson(entry, { isPc, changeFor, changes, memory }) {
    const name = isPc ? pcName(entry) : entry.name;
    const joined = isPc ? null : changeFor(entry.name);
    const card = el('div', `story-block-scene-person${isPc ? ' is-pc' : ''}${joined && joined.type === 'added' ? ' is-added' : ''}`);
    card.setAttribute('role', 'listitem');

    const head = el('div', 'story-block-scene-person-head');
    const initial = (name.match(/\p{L}|\p{N}/u) ?? ['?'])[0].toUpperCase();
    const avatar = el('span', 'story-block-scene-avatar', initial);
    avatar.setAttribute('aria-hidden', 'true');
    const names = el('div', 'story-block-scene-names');
    names.appendChild(el('span', 'story-block-scene-name', name));
    if (isPc && entry.name) names.appendChild(el('span', 'story-block-scene-tag is-you', 'you'));
    if (entry.role) names.appendChild(el('span', 'story-block-scene-tag', entry.role));
    if (joined && joined.type === 'added') {
        const fresh = el('span', 'story-block-scene-tag is-new', 'new');
        fresh.title = 'Joined since the previous state';
        names.appendChild(fresh);
    }
    head.append(avatar, names);

    const fields = entry.fields ?? {};
    const mood = fields.Mood ? moodPill(fields.Mood) : null;
    const moodChange = changeFor(`${name} · Mood`);
    if (mood) {
        const pill = el('span', 'story-block-scene-mood', mood.short);
        pill.title = `Mood: ${fields.Mood}`;
        if (moodChange) pill.classList.add('is-changed');
        head.appendChild(pill);
    }
    card.appendChild(head);

    const labels = [
        ...FIELD_ORDER.filter(label => fields[label]),
        ...Object.keys(fields).filter(label => !FIELD_ORDER.includes(label) && label !== 'Secret' && label !== 'Mood'),
    ];
    // The mood row only when the pill could not hold it, or when it changed (the
    // change note needs a row to sit under).
    if (mood && (!mood.complete || moodChange)) labels.splice(Math.min(2, labels.length), 0, 'Mood');

    const rows = el('div', 'story-block-scene-rows');
    for (const label of labels) {
        const change = changeFor(`${name} · ${label}`);
        const slug = changeKey(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';
        const row = el('div', `story-block-scene-row is-${slug}${change ? ' is-changed' : ''}`);
        row.append(el('span', 'story-block-scene-k', label), el('span', 'story-block-scene-v', fields[label]));
        if (change) row.appendChild(changeNote(change));
        rows.appendChild(row);
    }
    // A field emptied this reply ("Carrying" gone) has no row of its own; its mark
    // still shows, labelled, so the reader sees what went.
    const prefix = changeKey(`${name} · `);
    for (const change of changes) {
        const key = changeKey(change.label);
        if (!key.startsWith(prefix) || String(change.to ?? '').trim()) continue;
        const label = String(change.label).slice(String(change.label).lastIndexOf('·') + 1).trim();
        if (labels.some(shown => changeKey(shown) === changeKey(label))) continue;
        const row = el('div', 'story-block-scene-row is-changed is-dropped');
        row.append(el('span', 'story-block-scene-k', label), el('span', 'story-block-scene-v', '—'));
        row.appendChild(changeNote(change));
        rows.appendChild(row);
    }
    if (rows.children.length) card.appendChild(rows);
    if (fields.Secret) card.appendChild(renderSecret(name, fields.Secret, memory));
    return card;
}

function renderOffscreen(entries) {
    const section = el('section', 'story-block-scene-section is-offscreen');
    const head = el('div', 'story-block-scene-sub');
    head.append(icon('fa-satellite-dish'), el('span', '', 'Off-screen'));
    section.appendChild(head);
    const list = el('ul', 'story-block-scene-off');
    for (const entry of entries) {
        const item = el('li', 'story-block-scene-off-item');
        if (entry.name) item.appendChild(el('span', 'story-block-scene-off-name', entry.name));
        if (entry.text) item.appendChild(el('span', 'story-block-scene-off-text', entry.text));
        list.appendChild(item);
    }
    section.appendChild(list);
    return section;
}

function renderLists(scene, changeFor) {
    const groups = LISTS.filter(group => scene[group.key]?.length);
    if (!groups.length) return null;
    const section = el('section', 'story-block-scene-section is-open-threads');
    for (const group of groups) {
        const head = el('div', 'story-block-scene-sub');
        head.append(icon(group.icon), el('span', '', group.label));
        section.appendChild(head);
        const list = el('ul', `story-block-scene-items is-${group.key}`);
        list.setAttribute('aria-label', group.label);
        for (const text of scene[group.key]) {
            // Only threads are diffed; seeds and timers tick every reply and would be noise.
            const change = group.key === 'threads' ? changeFor(text) : null;
            const item = el('li', `story-block-scene-item${change ? ` is-changed is-${change.type}` : ''}`, text);
            if (change) item.title = 'New since the previous state';
            list.appendChild(item);
        }
        section.appendChild(list);
    }
    return section;
}

function renderPhase(kind, value, changeFor) {
    const label = kind === 'arc' ? 'Arc Phase' : 'Scene Phase';
    const ladder = kind === 'arc' ? ARC_PHASES : SCENE_PHASES;
    const change = changeFor(label);
    const node = el('div', `story-block-scene-phase is-${kind}${change ? ' is-changed' : ''}`);
    const head = el('div', 'story-block-scene-phase-head');
    head.append(el('span', 'story-block-scene-sub', kind === 'arc' ? 'Arc' : 'Scene'), el('span', 'story-block-scene-phase-name', value));
    node.appendChild(head);
    const at = phaseStep(kind, value);
    // A phase the ladder does not have is shown as written, without guessing a position.
    if (at >= 0) {
        const rail = el('ol', 'story-block-scene-rail');
        rail.setAttribute('aria-label', `${kind === 'arc' ? 'Arc' : 'Scene'}: ${ladder[at]}, step ${at + 1} of ${ladder.length}`);
        ladder.forEach((step, index) => {
            const item = el('li', `story-block-scene-step${index < at ? ' is-done' : ''}${index === at ? ' is-current' : ''}`);
            item.title = step;
            if (index === at) item.setAttribute('aria-current', 'step');
            item.appendChild(el('span', 'story-block-scene-step-name', step));
            rail.appendChild(item);
        });
        node.appendChild(rail);
    }
    if (change) node.appendChild(changeNote(change));
    return node;
}

export function render(pane, {
    def,
    state,
    previousState = null,
    changes = null,
    changesFromEarlierReply = false,
    error = null,
    truncated = false,
    onEdit = null,
    uiKey = null,
} = {}) {
    const text = typeof state?.text === 'string' ? state.text.replace(/\r\n?/g, '\n').trim() : '';
    const scene = text ? parseScene(text, { layout: def?.layout }) : null;
    // Not text, or text that is not a World State: the plain display draws every word.
    if ((state && typeof state.text !== 'string') || (text && !scene)) {
        pane.classList.remove('story-block-display-scene');
        renderPlain(pane, { def, state, error, truncated, onEdit });
        return;
    }
    pane.classList.remove('story-block-display-plain');

    const present = scene ? (scene.pc ? 1 : 0) + scene.people.length : 0;
    renderFrame(pane, {
        def, error, truncated, onEdit,
        display: 'scene',
        summary: present ? `${present} present` : '',
    });
    if (!scene) {
        renderEmpty(pane, emptyText(def, state));
        return;
    }

    const rawChanges = Array.isArray(changes)
        ? changes
        : (typeof previousState?.text === 'string' ? diffScene(previousState.text, text, { layout: def?.layout }) : []);
    // Defensive: whatever produced the changes, a secret never shows in a mark.
    const changeList = rawChanges.filter(change => change && !isSecretChange(change));
    const byLabel = new Map();
    for (const change of changeList) {
        if (change.type !== 'removed' || !byLabel.has(changeKey(change.label))) byLabel.set(changeKey(change.label), change);
    }
    const changeFor = label => {
        const change = byLabel.get(changeKey(label));
        return change && change.type !== 'removed' ? change : null;
    };

    const body = el('div', 'story-block-display-body story-block-scene');

    if (changeList.length) {
        const delta = el('div', 'story-block-scene-delta', `Δ ${plural(changeList.length, 'change')}${changesFromEarlierReply ? ' · earlier reply' : ''}`);
        delta.title = changesFromEarlierReply
            ? 'The newest reply carried no World State; these changes come from an earlier reply.'
            : 'Changes since the previous state.';
        body.appendChild(delta);
    }

    const chips = renderChips(scene, changeFor);
    if (chips) body.appendChild(chips);

    const memory = revealedFor(uiKey ?? def?.id);
    const everyone = [
        ...(scene.pc ? [{ entry: scene.pc, isPc: true }] : []),
        ...scene.people.map(entry => ({ entry, isPc: false })),
    ];
    if (everyone.length) {
        const people = el('div', 'story-block-scene-people');
        people.setAttribute('role', 'list');
        people.setAttribute('aria-label', 'Present');
        everyone.forEach(({ entry, isPc }) => people.appendChild(renderPerson(entry, { isPc, changeFor, changes: changeList, memory })));
        body.appendChild(people);
    }

    if (scene.offscreen.length) body.appendChild(renderOffscreen(scene.offscreen));
    const lists = renderLists(scene, changeFor);
    if (lists) body.appendChild(lists);

    if (scene.arc || scene.phase) {
        const phases = el('div', 'story-block-scene-phases');
        if (scene.arc) phases.appendChild(renderPhase('arc', scene.arc, changeFor));
        if (scene.phase) phases.appendChild(renderPhase('phase', scene.phase, changeFor));
        body.appendChild(phases);
    }

    // People who left, threads that closed and scene fields no longer written are not
    // on the board any more; say so once rather than drop them silently. The previous
    // state, when given, tells a person from a thread; otherwise one neutral line.
    const gone = changeList.filter(change => change.type === 'removed');
    if (gone.length) {
        const before = typeof previousState?.text === 'string' ? parseScene(previousState.text, { layout: def?.layout }) : null;
        const wasPerson = new Set((before?.people ?? []).map(entry => changeKey(entry.name)));
        const wasThread = new Set((before?.threads ?? []).map(changeKey));
        const groups = [
            ['Left the scene', gone.filter(change => wasPerson.has(changeKey(change.label)))],
            ['Dropped threads', gone.filter(change => wasThread.has(changeKey(change.label)) && !wasPerson.has(changeKey(change.label)))],
        ];
        const rest = gone.filter(change => !wasPerson.has(changeKey(change.label)) && !wasThread.has(changeKey(change.label)));
        groups.push(['No longer written', rest]);
        for (const [title, list] of groups) {
            if (!list.length) continue;
            body.appendChild(el('div', 'story-block-scene-removed', `${title}: ${list.map(change => change.label).join(', ')}`));
        }
    }
    pane.appendChild(body);
}
