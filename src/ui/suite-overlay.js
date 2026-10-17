// Story Suite overlay: one place to manage Story Block, Story Director, NPC State Delta and RPG
// Battle together (docs/STORY_SUITE.md, "One place to manage them all").
//
// A full-screen dialog above SillyTavern and the sidebar, with an Overview tab (every announced
// extension, its on/off switch, and one Source of truth table) and a tab per extension that
// announced a `settings` selector. An extension's tab shows its own settings panel: the panel is
// moved into the overlay while its tab is open, with a hidden placeholder where it was, and put
// back exactly there when the tab changes or the overlay closes, so every control keeps its
// listeners and keeps working.
//
// Everything comes from the registry passed in (`suite`: providers(), owner(), offering()) and
// each provider's `api.manage`; nothing here knows the four by anything but their ids. Names and
// versions are announcement text, so nodes are built with textContent only.

import { AREAS, isSourceOfTruth } from '../suite.js';

const IDS = { root: 'story_suite_overlay', title: 'story_suite_title' };
const OVERVIEW = 'overview';
// On <body> while the overlay is open.
export const OPEN_CLASS = 'story-suite-open';
const PLACEHOLDER = 'storySuitePlaceholder';
const MOVED = 'storySuiteMoved';

// Tabs and overview rows follow the suite's own order; anyone else comes after, as announced.
export const SUITE_ORDER = Object.freeze(['story-block', 'story-director', 'npc-state-delta', 'rpg-battle']);

// The areas in plain words, in AREAS' order.
export const AREA_NAMES = Object.freeze({
    scene: 'Scene (who is here now)',
    npc: 'NPCs (who they are)',
    calendar: 'Calendar',
    timeline: 'Timeline (agendas, quests, clocks)',
    stats: 'Stats',
    items: 'Items',
    rolls: 'Roll modifiers',
});

let ui = null;

const nameOf = provider => String(provider?.name ?? '').trim() || String(provider?.id ?? '');
const manageOf = provider => {
    const manage = provider?.api?.manage;
    return manage && typeof manage === 'object' ? manage : null;
};

function attempt(fn, fallback, what) {
    try {
        return fn();
    } catch (error) {
        console.warn(`[Story Block] Story Suite: ${what} failed`, error);
        return fallback;
    }
}

/** Providers in suite order (Story Block, Story Director, NPC State Delta, RPG Battle, then others). */
export function orderProviders(providers) {
    const rank = provider => {
        const index = SUITE_ORDER.indexOf(provider.id);
        return index < 0 ? SUITE_ORDER.length : index;
    };
    return (Array.isArray(providers) ? providers : [])
        .filter(provider => provider && String(provider.id ?? '').trim())
        .map((provider, index) => ({ provider, index }))
        .sort((a, b) => rank(a.provider) - rank(b.provider) || a.index - b.index)
        .map(entry => entry.provider);
}

/** Who can keep `area`: providers whose manage.areas name it (their `owns` when they have no manage). */
export function areaCandidates(providers, area) {
    return orderProviders(providers).filter(provider => {
        const manage = manageOf(provider);
        const areas = manage && Array.isArray(manage.areas) ? manage.areas : provider.owns ?? [];
        return areas.map(String).includes(area);
    });
}

/** One provider's Source of truth choice for `area`: 'auto' unless it says 'mine' or 'theirs'. */
export function choiceOf(provider, area) {
    const manage = manageOf(provider);
    if (typeof manage?.sources !== 'function') return 'auto';
    const choice = attempt(() => manage.sources()?.[area], 'auto', `${provider.id}'s sources()`);
    return choice === 'mine' || choice === 'theirs' ? choice : 'auto';
}

/**
 * The table's value for an area: 'auto' while every candidate is on Automatic, a provider's id
 * when exactly that one says "This extension" and the rest "The other one" (or Automatic), else
 * 'mixed' (set by hand in each extension in a way one owner cannot say).
 */
export function currentSource(candidates, area) {
    const choices = candidates.map(provider => ({ id: provider.id, choice: choiceOf(provider, area) }));
    if (choices.every(entry => entry.choice === 'auto')) return 'auto';
    const mine = choices.filter(entry => entry.choice === 'mine');
    return mine.length === 1 ? mine[0].id : 'mixed';
}

/**
 * Set every candidate's own choice to match one owner: 'auto' sets Automatic everywhere; an id
 * makes that one "This extension" and the others "The other one", so two never both claim it.
 */
export function applySource(candidates, area, value) {
    for (const provider of candidates) {
        const manage = manageOf(provider);
        if (typeof manage?.setSource !== 'function') continue;
        const choice = value === 'auto' ? 'auto' : provider.id === value ? 'mine' : 'theirs';
        attempt(() => manage.setSource(area, choice), null, `${provider.id}'s setSource()`);
    }
}

/** Who keeps `area` now, after every extension's own choice: the providers that lead it. */
export function leadersOf(candidates, area, suite) {
    const offering = attempt(() => suite.offering(area), [], 'offering()') ?? [];
    return candidates.filter(provider => offering.includes(provider.id) && isSourceOfTruth(provider.id, area, choiceOf(provider, area), suite));
}

/** Tabs: Overview, then every provider that announced a settings panel, in suite order. */
export function suiteTabs(providers) {
    const panels = orderProviders(providers)
        .filter(provider => typeof provider.settings === 'string' && provider.settings.trim())
        .map(provider => ({ id: provider.id, label: nameOf(provider), provider }));
    return [{ id: OVERVIEW, label: 'Overview', provider: null }, ...panels];
}

// ---------------------------------------------------------------------------
// DOM

function make(d, tag, className = '', text = '') {
    const node = d.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = String(text);
    return node;
}

function iconButton(d, className, title, icon) {
    const node = make(d, 'button', className);
    node.type = 'button';
    node.title = title;
    node.setAttribute('aria-label', title);
    const glyph = make(d, 'i', `fa-solid ${icon}`);
    glyph.setAttribute('aria-hidden', 'true');
    node.appendChild(glyph);
    return node;
}

const providersNow = () => attempt(() => ui.suite.providers(), [], 'providers()') ?? [];

// Redraws throw nodes away; focus goes back to the control that had it (data-suite-focus).
function keepFocus(draw) {
    const active = ui.doc.activeElement;
    const key = active && ui.root.contains(active) ? active.dataset?.suiteFocus : null;
    draw();
    if (!key || !ui) return;
    const again = [...ui.root.querySelectorAll('[data-suite-focus]')].find(node => node.dataset.suiteFocus === key);
    if (again && again !== active) again.focus?.({ preventScroll: true });
}

function renderTabs() {
    const d = ui.doc;
    const tabs = suiteTabs(providersNow());
    // The open extension left: its panel goes back and Overview takes its place.
    const switched = ui.drawn && !tabs.some(tab => tab.id === ui.selected) && selectTab(OVERVIEW);
    const buttons = tabs.map(tab => {
        const node = make(d, 'button', 'story-suite-tab', tab.label);
        node.type = 'button';
        node.dataset.tabId = tab.id;
        node.dataset.suiteFocus = `tab:${tab.id}`;
        node.setAttribute('role', 'tab');
        const active = tab.id === ui.selected;
        node.classList.toggle('active', active);
        node.setAttribute('aria-selected', String(active));
        node.setAttribute('tabindex', active ? '0' : '-1');
        node.addEventListener('click', event => {
            event.stopPropagation();
            selectTab(tab.id);
        });
        return node;
    });
    ui.tablist.replaceChildren(...buttons);
    return switched;
}

function renderOverview() {
    const d = ui.doc;
    const providers = orderProviders(providersNow());
    const suite = ui.suite;

    const installed = make(d, 'section', 'story-suite-section is-installed');
    installed.appendChild(make(d, 'h3', 'story-suite-section-title', 'Installed'));
    const list = make(d, 'ul', 'story-suite-providers');
    for (const provider of providers) {
        const on = provider.enabled !== false;
        const row = make(d, 'li', `story-suite-provider${on ? '' : ' is-off'}`);
        row.dataset.providerId = provider.id;
        const version = String(provider.version ?? '').trim();
        row.append(
            make(d, 'span', 'story-suite-provider-name', nameOf(provider)),
            make(d, 'span', 'story-suite-provider-version', version ? `v${version.replace(/^v/i, '')}` : ''),
            make(d, 'span', 'story-suite-provider-state', on ? 'on' : 'off'),
        );
        const manage = manageOf(provider);
        if (typeof manage?.setEnabled === 'function') {
            const toggle = make(d, 'input', 'story-suite-switch');
            toggle.type = 'checkbox';
            toggle.checked = on;
            toggle.setAttribute('role', 'switch');
            toggle.setAttribute('aria-label', `${nameOf(provider)} on`);
            toggle.dataset.suiteFocus = `switch:${provider.id}`;
            toggle.addEventListener('change', () => {
                attempt(() => manage.setEnabled(Boolean(toggle.checked)), null, `${provider.id}'s setEnabled()`);
                refreshSuiteOverlay();
            });
            row.appendChild(toggle);
        }
        list.appendChild(row);
    }
    installed.appendChild(list);

    const sources = make(d, 'section', 'story-suite-section is-sources');
    sources.append(
        make(d, 'h3', 'story-suite-section-title', 'Source of truth'),
        make(d, 'small', 'story-suite-intro', 'Who keeps each area that more than one of them can. Picking one sets every extension\'s own choice to match.'),
    );
    let rows = 0;
    for (const area of Object.keys(AREAS)) {
        const candidates = areaCandidates(providers, area);
        if (candidates.length < 2) continue;
        rows += 1;
        sources.appendChild(sourceRow(d, area, candidates, suite));
    }
    if (!rows) sources.appendChild(make(d, 'p', 'story-suite-empty', 'No area is kept by more than one of them right now.'));
    ui.pane.replaceChildren(installed, sources);
}

function sourceRow(d, area, candidates, suite) {
    const row = make(d, 'div', 'story-suite-area');
    row.dataset.area = area;
    const id = `story_suite_source_${area}`;
    const label = make(d, 'label', 'story-suite-area-name', AREA_NAMES[area] ?? area);
    label.setAttribute('for', id);
    const select = make(d, 'select', 'text_pole story-suite-source');
    select.id = id;
    select.dataset.suiteFocus = `source:${area}`;
    const owner = attempt(() => suite.owner(area), null, 'owner()');
    const ownerName = owner ? nameOf(providersNow().find(provider => provider.id === owner) ?? { id: owner }) : '';
    const option = (value, text, disabled = false) => {
        const node = make(d, 'option', '', text);
        node.value = value;
        if (disabled) node.disabled = true;
        select.appendChild(node);
    };
    option('auto', ownerName ? `Automatic (${ownerName})` : 'Automatic');
    for (const provider of candidates) option(provider.id, provider.enabled === false ? `${nameOf(provider)} (off)` : nameOf(provider));
    const value = currentSource(candidates, area);
    if (value === 'mixed') option('mixed', 'Mixed — set in each extension', true);
    select.value = value;
    select.addEventListener('change', () => {
        if (select.value === 'mixed') return;
        applySource(candidates, area, select.value);
        refreshSuiteOverlay();
    });
    const leaders = leadersOf(candidates, area, suite);
    const lead = leaders.length ? `Leads now: ${leaders.map(nameOf).join(' and ')}${leaders.length > 1 ? ' (each keeps it)' : ''}` : 'Leads now: nobody (it is off everywhere)';
    row.append(label, select, make(d, 'small', 'story-suite-lead', lead));
    return row;
}

// An extension's tab: its own panel, moved in for as long as the tab is open.
function renderPanel(provider) {
    const d = ui.doc;
    const node = attempt(() => d.querySelector(provider.settings), null, `finding ${provider.id}'s settings`);
    if (!node || !node.parentNode || node.contains(ui.root) || ui.root.contains(node)) {
        ui.pane.replaceChildren(make(d, 'p', 'story-suite-empty', 'Its settings are not on this page.'));
        return;
    }
    const placeholder = make(d, 'div', 'story-suite-placeholder');
    placeholder.dataset[PLACEHOLDER] = provider.id;
    placeholder.hidden = true;
    placeholder.style.display = 'none';
    node.before(placeholder);
    node.dataset[MOVED] = provider.id;
    // Its SillyTavern drawer is shown open, without the toggle: the tab already names it.
    const drawer = node.matches?.('.inline-drawer') ? node : node.querySelector?.('.inline-drawer');
    drawer?.classList?.add('story-suite-drawer');
    ui.moved = { node, placeholder, drawer, parent: placeholder.parentNode };
    ui.pane.replaceChildren(node);
}

// Back exactly where it was, before its placeholder. A panel its extension removed meanwhile is
// left alone; one whose old place is gone goes back to its old parent, if that is still there.
function restorePanel() {
    const moved = ui?.moved;
    if (!moved) return;
    ui.moved = null;
    const { node, placeholder, drawer, parent } = moved;
    drawer?.classList?.remove('story-suite-drawer');
    if (node.dataset) delete node.dataset[MOVED];
    const stillOurs = ui.pane.contains(node);
    if (stillOurs && placeholder.parentNode) placeholder.parentNode.insertBefore(node, placeholder);
    else if (stillOurs && parent?.isConnected) parent.appendChild(node);
    else if (stillOurs) node.remove();
    placeholder.remove();
}

// A previous copy of the extension (reloaded without a page refresh) may have left an overlay
// with a panel inside: every panel goes back to its placeholder first.
function restoreStrays(d) {
    const stale = d.querySelector?.(`#${IDS.root}`);
    for (const placeholder of [...(d.querySelectorAll?.('[data-story-suite-placeholder]') ?? [])]) {
        const id = placeholder.dataset[PLACEHOLDER];
        const node = [...(stale?.querySelectorAll?.('[data-story-suite-moved]') ?? [])].find(item => item.dataset[MOVED] === id);
        if (node) {
            delete node.dataset[MOVED];
            node.querySelector?.('.story-suite-drawer')?.classList?.remove('story-suite-drawer');
            node.classList?.remove('story-suite-drawer');
            placeholder.parentNode.insertBefore(node, placeholder);
        }
        placeholder.remove();
    }
    stale?.remove?.();
}

function selectTab(id) {
    if (!ui) return false;
    const tabs = suiteTabs(providersNow());
    const tab = tabs.find(item => item.id === String(id)) ?? tabs[0];
    const changed = ui.selected !== tab.id;
    if (changed || !ui.drawn) {
        restorePanel();
        ui.selected = tab.id;
        ui.drawn = true;
        if (tab.provider) renderPanel(tab.provider);
        else renderOverview();
        ui.pane.dataset.tabId = tab.id;
    }
    for (const node of ui.tablist.children) {
        const active = node.dataset.tabId === tab.id;
        node.classList.toggle('active', active);
        node.setAttribute('aria-selected', String(active));
        node.setAttribute('tabindex', active ? '0' : '-1');
    }
    return true;
}

function focusables() {
    const selector = 'button, a[href], input, select, textarea, [tabindex]';
    return [...ui.dialog.querySelectorAll(selector)].filter(node => !node.disabled && node.getAttribute('tabindex') !== '-1' && !node.closest('[hidden]'));
}

function onKey(event) {
    if (!ui || event.defaultPrevented) return;
    const d = ui.doc;
    if (event.key === 'Escape') {
        // A SillyTavern popup above the overlay takes its own Esc.
        const active = d.activeElement;
        if (active && active !== d.body && !ui.root.contains(active)) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        closeSuiteOverlay();
        return;
    }
    if (event.key === 'Tab' && ui.root.contains(event.target ?? null)) {
        // aria-modal: Tab stays inside the dialog.
        const nodes = focusables();
        if (!nodes.length) return;
        const active = d.activeElement;
        if (event.shiftKey && (active === nodes[0] || active === ui.dialog)) {
            event.preventDefault?.();
            nodes.at(-1).focus?.({ preventScroll: true });
        } else if (!event.shiftKey && active === nodes.at(-1)) {
            event.preventDefault?.();
            nodes[0].focus?.({ preventScroll: true });
        }
        return;
    }
    const tab = event.target?.closest?.('.story-suite-tab');
    if (!tab || !ui.tablist.contains(tab)) return;
    const tabs = [...ui.tablist.children];
    const index = tabs.indexOf(tab);
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault?.();
    const next = tabs[(keys[event.key] + tabs.length) % tabs.length];
    selectTab(next.dataset.tabId);
    next.focus?.({ preventScroll: true });
}

function createUi(d, suite, opener) {
    restoreStrays(d);
    const root = make(d, 'div', 'story-suite-overlay');
    root.id = IDS.root;
    const dialog = make(d, 'div', 'story-suite-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', IDS.title);
    dialog.setAttribute('tabindex', '-1');
    const head = make(d, 'div', 'story-suite-head');
    const title = make(d, 'h2', 'story-suite-title', 'Story Suite');
    title.id = IDS.title;
    const close = iconButton(d, 'story-suite-close', 'Close Story Suite', 'fa-xmark');
    close.dataset.suiteFocus = 'close';
    head.append(title, close);
    const tablist = make(d, 'div', 'story-suite-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Story Suite');
    const pane = make(d, 'div', 'story-suite-pane');
    pane.setAttribute('role', 'tabpanel');
    dialog.append(head, tablist, pane);
    root.appendChild(dialog);
    d.body.appendChild(root);
    // Other extensions hide their floating buttons while this is open (docs/STORY_SUITE.md).
    d.body.classList?.add?.(OPEN_CLASS);

    const state = { doc: d, suite, root, dialog, close, tablist, pane, opener, selected: null, drawn: false, moved: null, cleanup: [] };
    close.addEventListener('click', event => {
        event.stopPropagation();
        closeSuiteOverlay();
    });
    // A click on the dimmed backdrop (not the dialog) closes, like SillyTavern's popups.
    root.addEventListener('click', event => {
        if (event.target === root) closeSuiteOverlay();
    });
    // Capture on the document where there is one: Esc reaches the overlay before SillyTavern's
    // own handlers close something underneath it.
    const target = typeof d.addEventListener === 'function' ? d : root;
    target.addEventListener('keydown', onKey, true);
    state.cleanup.push(() => target.removeEventListener?.('keydown', onKey, true));
    state.cleanup.push(() => d.body?.classList?.remove?.(OPEN_CLASS));
    return state;
}

// ---------------------------------------------------------------------------
// API

/**
 * Open the overlay on `tab` ('overview' or a provider's id; Overview when it has no tab), or
 * select that tab if it is already open. `suite` is the registry; `opener` gets focus back on
 * close. Returns the overlay's root, or null when there is no document body to show it on.
 */
export function openSuiteOverlay({ document: d = globalThis.document, suite, tab = OVERVIEW, opener = null, onClose = null } = {}) {
    if (!suite || typeof d?.body?.appendChild !== 'function') return null;
    if (ui && !ui.root.isConnected) closeSuiteOverlay({ returnFocus: false });
    if (!ui) {
        ui = createUi(d, suite, opener ?? d.activeElement ?? null);
        ui.onClose = typeof onClose === 'function' ? onClose : null;
        renderTabs();
    }
    selectTab(tab ?? OVERVIEW);
    const active = [...ui.tablist.children].find(node => node.classList.contains('active'));
    (active ?? ui.close).focus?.({ preventScroll: true });
    return ui.root;
}

/**
 * Redraw after the suite changed: the tab row (extensions arrive and leave) and the Overview
 * when it is shown. An open extension tab is left alone unless its extension left.
 */
export function refreshSuiteOverlay() {
    if (!ui) return false;
    if (!ui.root.isConnected) {
        closeSuiteOverlay({ returnFocus: false });
        return false;
    }
    keepFocus(() => {
        if (!renderTabs() && ui.selected === OVERVIEW) renderOverview();
    });
    return true;
}

/**
 * Close: every moved panel goes back where it was, and focus returns to the opener. With nothing
 * open, an overlay a previous copy of the extension left behind is cleared the same way.
 */
export function closeSuiteOverlay({ returnFocus = true, document: d = globalThis.document } = {}) {
    if (!ui) {
        if (d) restoreStrays(d);
        return false;
    }
    const current = ui;
    restorePanel();
    ui = null;
    for (const fn of current.cleanup) {
        try { fn(); } catch { /* best effort */ }
    }
    current.root.remove();
    if (returnFocus && current.opener?.isConnected !== false) current.opener?.focus?.({ preventScroll: true });
    try { current.onClose?.(); } catch (error) { console.warn('[Story Block] Story Suite: onClose failed', error); }
    return true;
}

/** The selected tab's id while the overlay is open, else null. */
export function suiteOverlayTab() {
    return ui ? ui.selected : null;
}
