// The fishing mini-game as one self-contained widget: renderFishing(el, props, api).
//
//   props: { place, spot, session, log, last, currency }   (see fishingProps in module.js)
//   api:   { command(type, payload) → Promise<result>, query?(name, args), timers? }
//
// Cast → wait → a bite → press Reel inside the window. The bite time and the window come from the
// fishing.cast receipt (or the open session in state), so the widget only shows what code already
// decided; the press becomes the `hooked` flag of fishing.reel. The widget never reads message text,
// never calls a command on its own except when the line runs out unpressed (a miss), and can be
// re-rendered at any time (the host re-renders tabs after every commit): the clock of an open line is
// kept per session, not per element.

import { WATERS, formatValue, formatWeight, inWindow, pickedSpotName } from './rules.js';

// Widget memory (not story state): when each open line started on this page, whether it was reeled,
// the last line to show, the reader's spot pick.
const lines = new Map();           // session id → { start, resolved }
const memory = { message: '', pick: null };
const cleanups = new WeakMap();    // element → stop its timers
const current = new WeakMap();     // element → its latest render ({ message node })

const realTimers = {
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: id => globalThis.clearTimeout(id),
};

/** Forget the widget memory (tests; a chat change). */
export function resetFishingWidget() {
    lines.clear();
    memory.message = '';
    memory.pick = null;
}

export function renderFishing(el, props = {}, api = {}) {
    cleanups.get(el)?.();
    const timers = api.timers ?? realTimers;
    const doc = el.ownerDocument ?? globalThis.document;
    const pending = [];
    cleanups.set(el, () => pending.splice(0).forEach(id => timers.clearTimeout(id)));

    const node = (tag, cls, text) => {
        const n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };
    const button = (act, label, onClick) => {
        const b = node('button', 'menu_button sbf-button', label);
        b.setAttribute('type', 'button');
        b.setAttribute('data-act', act);
        b.addEventListener('click', onClick);
        return b;
    };

    const root = node('div', 'sbf');
    const water = node('div', 'sbf-water');
    const bobber = node('span', 'sbf-bobber', '●');
    const status = node('span', 'sbf-status');
    water.append(bobber, status);
    const actions = node('div', 'sbf-actions');
    const message = node('div', 'sbf-message', memory.message);
    message.setAttribute('data-role', 'message');
    status.setAttribute('data-role', 'status');
    const self = { message };
    current.set(el, self);
    // A command's answer goes to whichever render is on screen by then (the host may have re-rendered).
    const say = text => {
        memory.message = text;
        (current.get(el) ?? self).message.textContent = text;
    };
    const phase = (name, text) => {
        water.setAttribute('data-phase', name);
        status.textContent = text;
    };

    const session = props.session ?? null;
    if (session) watch(session);
    else idle();
    root.append(water, actions, message, logList());
    el.replaceChildren(root);
    return { dispose: () => cleanups.get(el)?.() };

    // ---- no line out: where to fish, and Cast ----
    function idle() {
        phase('idle', 'The water is still.');
        const placeName = String(props.place?.name ?? '').trim();
        const kind = memory.pick ?? props.spot?.kind ?? null;
        const spotRow = node('div', 'sbf-spot');
        const select = node('select', 'text_pole sbf-kind');
        select.setAttribute('data-role', 'kind');
        if (!props.spot && !memory.pick) select.append(option('', 'Where? (pick the water)'));
        for (const w of WATERS) select.append(option(w, w === 'sea' ? 'Sea' : w[0].toUpperCase() + w.slice(1)));
        select.value = kind ?? '';
        const label = node('span', 'sbf-where');
        label.setAttribute('data-role', 'where');
        const spotNow = () => {
            const picked = memory.pick ?? props.spot?.kind ?? null;
            if (!picked) return null;
            if (props.spot && picked === props.spot.kind) return props.spot;
            return { name: pickedSpotName(picked, placeName), kind: picked };
        };
        const showWhere = () => {
            const s = spotNow();
            label.textContent = s ? `at ${s.name}` : 'No water here that the scene names.';
            castButton.disabled = !s;
        };
        select.addEventListener('change', () => {
            memory.pick = WATERS.includes(select.value) ? select.value : null;
            showWhere();
        });
        const castButton = button('cast', 'Cast', async () => {
            const spot = spotNow();
            if (!spot) return;
            castButton.disabled = true;
            say('');
            const result = await api.command('fishing.cast', { spot });
            if (!result?.ok) {
                castButton.disabled = false;
                say(result?.message ?? 'The line would not go out.');
                return;
            }
            const data = result.receipt?.data ?? {};
            redrawAs({ id: data.session, spot: data.spot ?? spot, bite: data.bite, window: data.window });
        });
        spotRow.append(select, label);
        actions.append(spotRow, castButton);
        showWhere();
    }

    function option(value, text) {
        const o = node('option', '', text);
        o.value = value;
        return o;
    }

    // ---- a line is out: wait for the bite, press Reel ----
    function watch(open) {
        const timing = { bite: open.bite, window: open.window };
        let line = lines.get(open.id);
        if (!line) {
            line = { start: timers.now(), resolved: false };
            lines.set(open.id, line);
        }
        const reelButton = button('reel', 'Reel', () => reelIn(timers.now() - line.start));
        actions.append(reelButton);
        if (line.resolved) {
            reelButton.disabled = true;
            phase('reeling', 'Reeling in…');
            return;
        }
        const elapsed = timers.now() - line.start;
        const at = (ms, fn) => pending.push(timers.setTimeout(fn, Math.max(0, ms - elapsed)));
        if (elapsed < timing.bite) {
            phase('waiting', `The float drifts at ${open.spot.name}…`);
            at(timing.bite, () => phase('bite', 'A bite! Reel now!'));
        } else if (inWindow(elapsed, timing)) phase('bite', 'A bite! Reel now!');
        at(timing.bite + timing.window + 1, () => reelIn(null));

        async function reelIn(pressedAt) {
            if (line.resolved) return;
            line.resolved = true;
            cleanups.get(el)?.();
            reelButton.disabled = true;
            const hooked = pressedAt != null && inWindow(pressedAt, timing);
            const early = pressedAt != null && pressedAt < timing.bite;
            phase('reeling', 'Reeling in…');
            const result = await api.command('fishing.reel', { session: open.id, hooked });
            lines.delete(open.id);
            if (!result?.ok) say(result?.message ?? 'The line tangled.');
            else say(early ? `Too soon: the fish was spooked. ${result.receipt.summary}` : result.receipt.summary);
            redrawAs(null);
        }
    }

    // Show the next phase now, unless the host has already re-rendered from the new head state.
    function redrawAs(open) {
        if (current.get(el) === self) renderFishing(el, { ...props, session: open }, api);
    }

    // ---- the log: newest first, with Release ----
    function logList() {
        const list = node('ul', 'sbf-log');
        list.setAttribute('data-role', 'log');
        for (const entry of props.log ?? []) {
            const item = node('li', `sbf-catch sbf-${entry.rarity}`);
            item.setAttribute('data-catch', entry.id);
            const text = [entry.name, entry.rarity, formatWeight(entry.grams), entry.quality, formatValue(entry.value, props.currency)].join(' · ');
            item.append(node('span', 'sbf-catch-text', text));
            if (entry.released) item.append(node('span', 'sbf-released', 'released'));
            else {
                const b = button('release', 'Release', async () => {
                    b.disabled = true;
                    const result = await api.command('fishing.release', { catch: entry.id });
                    say(result?.ok ? result.receipt.summary : result?.message ?? 'It would not let go.');
                    if (!result?.ok) b.disabled = false;
                });
                item.append(b);
            }
            list.append(item);
        }
        if (!(props.log ?? []).length) list.append(node('li', 'sbf-empty', 'No catches yet.'));
        return list;
    }
}
