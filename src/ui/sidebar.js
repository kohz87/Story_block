// The Story Block sidebar: one panel for every block, outside the chat.
//
// Three layouts, picked from the room SillyTavern leaves around its chat column:
// - docked: a fixed column in the free gutter right of `#sheld`, always visible;
// - drawer: slides in from the right over a dimmed scrim (tablets, narrow desktops,
//   or a wide screen whose reader unpinned it);
// - sheet:  a bottom sheet on phones.
// Drawer and sheet are modal while open and leave a slim edge handle behind when
// closed. The layout is re-decided whenever the window, the chat column or one of
// SillyTavern's side drawers changes size.
//
// All three pieces live in one viewport-sized layer that clips them. A closed drawer or
// sheet waits just off screen, and without the clip that would make SillyTavern's page
// scrollable: focusing the panel, or the keyboard opening for the message box, then
// scrolled the whole page and left the send form stranded mid-screen.
//
// Tabs and panes follow the card's rules (card.js): the selected tab is kept per
// uiKey, and a pane whose `key` is unchanged is not re-rendered, so its scroll
// position and focus survive refreshes. Only `tab.render(pane)` writes a pane.
//
// (0.9.20) Two tab layouts. `rail` (the default): docked and drawer get a narrow column of
// icon buttons on the sidebar's outer edge, grouped by the extension that owns them (Story
// Block's own blocks first, a thin divider before each other extension), and the sheet gets
// one sideways strip of the same icons; labels show on hover, focus and long-press. A
// disabled extension's group simply goes. `rows`: the classic labelled tabs that wrap.

import { button, el, plural, stop } from './dom.js';

const IDS = {
    layer: 'story_block_layer',
    sidebar: 'story_block_sidebar',
    scrim: 'story_block_scrim',
    handle: 'story_block_handle',
};

const CLASS = {
    layer: 'story-block-layer',
    sidebar: 'story-block-sidebar',
    scrim: 'story-block-scrim',
    handle: 'story-block-handle',
    tab: 'story-block-sidebar-tab',
    pane: 'story-block-pane',
};

// Layout thresholds (CSS px). A docked sidebar needs its minimum width plus a margin
// on both sides; narrower gutters fall back to the drawer.
const PHONE_MAX = 640;
const DOCK_MIN = 300;
const DOCK_MAX = 380;
const DOCK_MARGIN = 12;
// Gesture distances (px): a short drag snaps back instead of acting.
const SWIPE_CLOSE = 60;
const SHEET_EXPAND = 60;
const SHEET_CLOSE = 80;
// From full height, a drag down this far (or past 40% of the sheet) closes instead of
// stepping back to half height.
const SHEET_DISMISS = 240;
const TAP_SLOP = 6;

// Selected tab per uiKey; survives unmounts so a re-opened chat shows the same tab.
const viewByKey = new Map();
let ui = null;

function viewFor(uiKey) {
    const key = String(uiKey ?? 'default');
    if (!viewByKey.has(key)) viewByKey.set(key, { selected: null });
    return viewByKey.get(key);
}

const doc = () => globalThis.document;
const win = () => globalThis.window;
const childrenOf = node => [...(node?.children ?? [])];

function byId(id) {
    const d = doc();
    return d?.getElementById?.(id) ?? d?.querySelector?.(`#${id}`) ?? null;
}

function rectOf(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return null;
    try {
        const rect = node.getBoundingClientRect();
        return rect && Number.isFinite(rect.right) ? rect : null;
    } catch {
        return null;
    }
}

function safeId(id) {
    return String(id).replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Pure layout decision. `chatRect` is `#sheld`'s bounding rect; `blockedRight` is the
 * width an open SillyTavern drawer covers on the right. Returns the mode plus, for a
 * docked sidebar, its width and right offset; `dockable` says whether the gutter is
 * wide enough to dock at all (the header then offers Pin/Unpin).
 */
export function layoutMode({ viewportWidth, chatRect, blockedRight = 0, pinned = true } = {}) {
    const width = Number(viewportWidth) || 0;
    // Width alone decides: a portrait tablet is a touch screen too, but it has room for
    // the drawer, and the sheet is for phones.
    if (width <= PHONE_MAX) {
        return { mode: 'sheet', dockable: false, width: 0, right: 0 };
    }
    const blocked = Math.max(0, Number(blockedRight) || 0);
    const chatRight = Number(chatRect?.right);
    const gutter = Number.isFinite(chatRight) ? width - chatRight - blocked : 0;
    const dockable = gutter >= DOCK_MIN + 2 * DOCK_MARGIN;
    if (dockable && pinned) {
        return { mode: 'docked', dockable, width: Math.min(gutter - 2 * DOCK_MARGIN, DOCK_MAX), right: blocked + DOCK_MARGIN };
    }
    return { mode: 'drawer', dockable, width: 0, right: 0 };
}

// SillyTavern marks an open side drawer with `openDrawer` (or `pinnedOpen` when the
// reader pinned it); a closed one keeps its box but must not count.
function blockedRightOf(panel, viewportWidth) {
    if (!panel?.classList) return 0;
    if (!panel.classList.contains('openDrawer') && !panel.classList.contains('pinnedOpen')) return 0;
    const rect = rectOf(panel);
    if (!rect || !(rect.width > 0)) return 0;
    return Math.max(0, viewportWidth - rect.left);
}

function measure() {
    const w = win();
    const viewportWidth = Number(w?.innerWidth) || Number(doc()?.documentElement?.clientWidth) || 1024;
    const tops = ['top-bar', 'top-settings-holder'].map(id => rectOf(byId(id))).filter(Boolean);
    return {
        viewportWidth,
        chatRect: rectOf(byId('sheld')),
        blockedRight: blockedRightOf(byId('right-nav-panel'), viewportWidth),
        topOffset: tops.length ? Math.max(0, ...tops.map(rect => rect.bottom)) : 0,
    };
}

function normalizeTabs(tabs) {
    const seen = new Set();
    const out = [];
    for (const tab of Array.isArray(tabs) ? tabs : []) {
        const id = String(tab?.id ?? '').trim();
        if (!id || seen.has(id) || typeof tab?.render !== 'function') continue;
        seen.add(id);
        out.push({ ...tab, id, group: String(tab.group ?? '').trim().slice(0, 40) });
    }
    return out;
}

const badgeOf = tab => {
    const count = Math.floor(Number(tab?.badge));
    return Number.isFinite(count) && count > 0 ? count : 0;
};
const badgeText = count => (count > 99 ? '99+' : String(count));

export const TAB_LAYOUTS = Object.freeze(['rail', 'rows']);
const OWN_GROUP = 'Story Block';

/**
 * (0.9.20) The rail's order: tabs grouped by their `group` (the owning extension), groups in
 * the order they first appear with Story Block's own first, tabs keeping their order within
 * a group. Pure.
 */
export function groupTabs(tabs) {
    const groups = new Map();
    for (const tab of tabs ?? []) {
        const group = tab.group || OWN_GROUP;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(tab);
    }
    const names = [...groups.keys()].sort((a, b) => (a === OWN_GROUP ? -1 : b === OWN_GROUP ? 1 : 0));
    return names.flatMap(name => groups.get(name));
}

/**
 * (0.9.20) What each rail icon shows: the tab's own icon, or, when an earlier tab already
 * uses that icon (or it has none), a one- or two-letter monogram of its short label, so no
 * two icons on the rail look alike. Returns Map(id → { text, monogram }). Pure.
 */
export function railGlyphs(tabs) {
    const used = new Set();
    const out = new Map();
    for (const tab of tabs ?? []) {
        const icon = String(tab.icon ?? '').trim();
        if (icon && !used.has(icon)) {
            used.add(icon);
            out.set(tab.id, { text: icon, monogram: false });
            continue;
        }
        const words = String(tab.short || tab.label || tab.id).trim().split(/\s+/).filter(Boolean);
        // Two words: their initials ("Present NPCs" → PN); one word: its first two letters ("Party" → Pa).
        const text = words.length > 1 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : `${(words[0] ?? '?').charAt(0).toUpperCase()}${(words[0] ?? '').charAt(1).toLowerCase()}`;
        out.set(tab.id, { text, monogram: true });
    }
    return out;
}

// ---------------------------------------------------------------------------
// DOM

const ownTabs = () => childrenOf(ui?.tablist).filter(node => node.classList.contains(CLASS.tab));
const ownPanes = () => childrenOf(ui?.panel).filter(node => node.classList.contains(CLASS.pane));

function createUi() {
    const d = doc();
    // A previous copy of the extension (reloaded without a page refresh) may have left these.
    for (const id of Object.values(IDS)) byId(id)?.remove?.();

    const scrim = el('div', CLASS.scrim);
    scrim.id = IDS.scrim;
    scrim.setAttribute('aria-hidden', 'true');
    scrim.style.display = 'none';

    const aside = el('aside', CLASS.sidebar);
    aside.id = IDS.sidebar;
    aside.setAttribute('aria-label', 'Story Block');
    aside.setAttribute('tabindex', '-1');

    const grip = el('button', 'story-block-sidebar-grip');
    grip.type = 'button';
    grip.title = 'Drag to resize, tap to expand';
    grip.setAttribute('aria-label', grip.title);
    grip.appendChild(el('span', 'story-block-sidebar-grip-bar'));

    const head = el('div', 'story-block-sidebar-head');
    const meta = el('span', 'story-block-sidebar-meta');
    // Story Suite's overlay, while two or more of the suite are installed (index.js decides).
    const suite = button('story-block-sidebar-button story-block-sidebar-suite', { title: 'Story Suite', icon: 'fa-gear' });
    suite.style.display = 'none';
    const pin = button('story-block-sidebar-button story-block-sidebar-pin', { title: 'Unpin sidebar', icon: 'fa-thumbtack' });
    const close = button('story-block-sidebar-button story-block-sidebar-close', { title: 'Close', icon: 'fa-xmark' });
    head.append(el('span', 'story-block-sidebar-title', 'Story Block'), meta, el('span', 'story-block-sidebar-spacer'), suite, pin, close);

    const tablist = el('div', 'story-block-sidebar-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Blocks');
    const panel = el('div', 'story-block-sidebar-panel');
    // (0.9.20) The tabs and the pane share one body: stacked (rows, sheet) or side by side (rail).
    const body = el('div', 'story-block-sidebar-body');
    body.append(tablist, panel);
    // A tab's label and owner, shown beside the rail on hover, focus and long-press.
    const hint = el('div', 'story-block-sidebar-hint');
    hint.setAttribute('role', 'tooltip');
    hint.id = 'story_block_sidebar_hint';
    hint.style.display = 'none';
    aside.append(grip, head, body, hint);

    const handle = el('button', CLASS.handle);
    handle.type = 'button';
    handle.id = IDS.handle;
    const glyph = el('i', 'fa-solid fa-bars-staggered');
    glyph.setAttribute('aria-hidden', 'true');
    const count = el('span', 'story-block-handle-count');
    count.setAttribute('aria-hidden', 'true');
    handle.append(glyph, count);
    handle.style.display = 'none';

    const layer = el('div', CLASS.layer);
    layer.id = IDS.layer;
    layer.append(scrim, aside, handle);
    d.body.appendChild(layer);

    const state = {
        layer, aside, scrim, handle, grip, head, meta, suite, pin, close, tablist, panel, count, body, hint,
        uiKey: null,
        layout: 'rail',
        hintTimer: null,
        pressTimer: null,
        pressed: false,
        mode: null,
        dockable: false,
        open: false,
        pinned: true,
        onPinnedChange: null,
        onSuite: null,
        sheetFull: false,
        gesture: null,
        suppressGripClick: false,
        observed: [],
        observers: [],
        cleanup: [],
    };

    // Only our own controls stop click propagation (stop()): tabs other extensions
    // render into a pane may rely on document-delegated handlers.
    scrim.addEventListener('click', stop(() => closeSidebar()));
    close.addEventListener('click', stop(() => closeSidebar()));
    pin.addEventListener('click', stop(() => setPinned(state.mode !== 'docked')));
    // The button is handed over so focus can come back to it when the overlay closes.
    suite.addEventListener('click', stop(() => {
        try { state.onSuite?.(suite); } catch (error) { console.error('[Story Block] onSuite failed', error); }
    }));
    handle.addEventListener('click', stop(() => openSidebar()));
    grip.addEventListener('click', stop(() => {
        // A drag ends in a click too; only a tap (or Enter/Space) toggles the height.
        if (state.suppressGripClick) {
            state.suppressGripClick = false;
            return;
        }
        state.sheetFull = !state.sheetFull;
        applyOpenState();
    }));
    tablist.addEventListener('keydown', onTabKey);
    tablist.addEventListener('pointerover', onTabHover);
    tablist.addEventListener('pointerout', onTabLeave);
    tablist.addEventListener('focusin', onTabHover);
    tablist.addEventListener('focusout', onTabLeave);
    tablist.addEventListener('pointerdown', onTabPress);
    tablist.addEventListener('pointerup', onTabRelease);
    tablist.addEventListener('pointercancel', onTabRelease);
    tablist.addEventListener('wheel', onTabWheel, { passive: false });
    tablist.addEventListener('scroll', markTabOverflow, { passive: true });
    aside.addEventListener('keydown', onTrapKey);
    aside.addEventListener('pointerdown', onSwipeStart);
    aside.addEventListener('pointermove', onSwipeMove);
    aside.addEventListener('pointerup', onSwipeEnd);
    aside.addEventListener('pointercancel', onSwipeCancel);
    // On the sheet the header drags too: it is the bar a finger reaches for.
    for (const target of [grip, head]) {
        target.addEventListener('pointerdown', onGripStart);
        target.addEventListener('pointermove', onGripMove);
        target.addEventListener('pointerup', onGripEnd);
        target.addEventListener('pointercancel', onGripCancel);
    }

    // Capture phase: a modal drawer on top should take Esc before SillyTavern's own
    // handlers close something underneath it.
    if (typeof d.addEventListener === 'function') {
        d.addEventListener('keydown', onEscape, true);
        state.cleanup.push(() => d.removeEventListener?.('keydown', onEscape, true));
    }
    const w = win();
    if (typeof w?.addEventListener === 'function') {
        const onResize = () => relayout();
        w.addEventListener('resize', onResize);
        state.cleanup.push(() => w.removeEventListener?.('resize', onResize));
    }
    return state;
}

function teardown() {
    if (!ui) return;
    const current = ui;
    ui = null;
    for (const observer of current.observers) {
        try { observer.disconnect(); } catch { /* already gone */ }
    }
    for (const fn of current.cleanup) {
        try { fn(); } catch { /* best effort */ }
    }
    current.scrim.remove();
    current.aside.remove();
    current.handle.remove();
    current.layer.remove();
}

// Watch what decides the layout. Re-run on every mount: SillyTavern may rebuild
// these elements, and an observer on a detached node would never fire again.
function watchLayout() {
    const targets = ['sheld', 'right-nav-panel', 'left-nav-panel'].map(byId);
    if (targets.every((node, index) => node === ui.observed[index])) return;
    for (const observer of ui.observers) {
        try { observer.disconnect(); } catch { /* already gone */ }
    }
    ui.observers = [];
    ui.observed = targets;
    const [sheld, right, left] = targets;
    const onChange = () => relayout();
    const ResizeObs = globalThis.ResizeObserver;
    if (sheld && typeof ResizeObs === 'function') {
        try {
            const observer = new ResizeObs(onChange);
            observer.observe(sheld);
            ui.observers.push(observer);
        } catch { /* unsupported */ }
    }
    const MutationObs = globalThis.MutationObserver;
    if ((right || left) && typeof MutationObs === 'function') {
        try {
            const observer = new MutationObs(onChange);
            for (const node of [right, left].filter(Boolean)) observer.observe(node, { attributes: true, attributeFilter: ['class', 'style'] });
            ui.observers.push(observer);
        } catch { /* unsupported */ }
    }
}

function createTab(id) {
    const tab = el('button', CLASS.tab);
    tab.type = 'button';
    tab.dataset.tabId = id;
    tab.id = `story-block-sidebar-tab-${safeId(id)}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `story-block-sidebar-pane-${safeId(id)}`);
    const icon = el('span', 'story-block-sidebar-tab-icon');
    const glyph = el('span', 'story-block-sidebar-tab-glyph');
    glyph.setAttribute('aria-hidden', 'true');
    const badge = el('span', 'story-block-sidebar-badge');
    badge.setAttribute('aria-hidden', 'true');
    icon.append(glyph, badge);
    tab.append(icon, el('span', 'story-block-sidebar-tab-short'), el('span', 'story-block-sidebar-tab-full'));
    tab.addEventListener('click', stop(() => {
        // A long-press showed the label; it does not also switch tabs.
        if (ui?.pressed) {
            ui.pressed = false;
            return;
        }
        selectTab(tab.dataset.tabId);
    }));
    return tab;
}

function setText(node, text) {
    // Only touch what changed: hosts observe the DOM for mutations.
    if (node && node.textContent !== text) node.textContent = text;
}

function updateTab(tab, item, glyph = null) {
    const label = String(item.label ?? '').trim() || item.id;
    const short = String(item.short ?? '').trim() || label;
    const count = badgeOf(item);
    const icon = tab.querySelector('.story-block-sidebar-tab-glyph');
    const badge = tab.querySelector('.story-block-sidebar-badge');
    setText(icon, glyph ? glyph.text : String(item.icon ?? ''));
    icon.classList.toggle('is-monogram', Boolean(glyph?.monogram));
    setAttr(tab, 'data-group', item.group || OWN_GROUP);
    setText(tab.querySelector('.story-block-sidebar-tab-short'), short);
    setText(tab.querySelector('.story-block-sidebar-tab-full'), label);
    setText(badge, count ? badgeText(count) : '');
    badge.style.display = count ? '' : 'none';
    const aria = count ? `${label}, ${plural(count, 'change')} this turn` : label;
    // The rail shows its own label beside the icon (the hint); a native tooltip would double it.
    const title = ui?.layout === 'rail' ? '' : label;
    if (tab.title !== title) tab.title = title;
    if (tab.getAttribute('aria-label') !== aria) tab.setAttribute('aria-label', aria);
}

function createPane(id) {
    const pane = el('div', CLASS.pane);
    pane.dataset.tabId = id;
    pane.id = `story-block-sidebar-pane-${safeId(id)}`;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', `story-block-sidebar-tab-${safeId(id)}`);
    pane.style.display = 'none';
    return pane;
}

function renderPane(pane, tab) {
    const key = typeof tab.key === 'string' ? tab.key : null;
    if (key !== null && pane.dataset.contentKey === key) return;
    try {
        // render() owns the pane's content and replaces it itself; clearing it here first
        // would detach a focused filter input before the display could restore it.
        tab.render(pane);
        if (key !== null) pane.dataset.contentKey = key;
        else delete pane.dataset.contentKey;
    } catch (error) {
        delete pane.dataset.contentKey;
        pane.replaceChildren(el('div', 'story-block-notice is-error', `${tab.label || tab.id} could not be shown: ${error?.message ?? error}`));
        console.error('[Story Block] tab render failed', tab.id, error);
    }
}

function placeTabs(ordered) {
    let cursor = ui.tablist.firstElementChild ?? null;
    for (const tab of ordered) {
        if (cursor === tab) cursor = tab.nextElementSibling ?? null;
        else ui.tablist.insertBefore(tab, cursor);
    }
}

function applySelection() {
    const view = viewFor(ui.uiKey);
    const tabs = ownTabs();
    if (!tabs.some(tab => tab.dataset.tabId === view.selected)) view.selected = tabs[0]?.dataset.tabId ?? null;
    for (const tab of tabs) {
        const active = tab.dataset.tabId === view.selected;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        // Roving tabindex: Tab enters the strip on the selected tab, arrows move within.
        tab.setAttribute('tabindex', active ? '0' : '-1');
    }
    for (const pane of ownPanes()) pane.style.display = pane.dataset.tabId === view.selected ? '' : 'none';
    revealTab(tabs.find(tab => tab.dataset.tabId === view.selected));
}

// The selected tab is always in sight: the rail wraps into rows (scrolling down past three),
// the sheet's pills scroll sideways. Only the strip scrolls, never the page or the pane.
function revealTab(tab) {
    const strip = ui?.tablist;
    if (!tab || !strip || !(strip.scrollWidth > strip.clientWidth || strip.scrollHeight > strip.clientHeight)) {
        markTabOverflow();
        return;
    }
    const left = tab.offsetLeft - strip.offsetLeft;
    const top = tab.offsetTop - strip.offsetTop;
    // The first and last tabs go all the way to their end, past the strip's padding and fade.
    const tabs = ownTabs();
    if (tab === tabs[0]) strip.scrollLeft = 0;
    else if (tab === tabs.at(-1)) strip.scrollLeft = strip.scrollWidth - strip.clientWidth;
    else if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + tab.offsetWidth - strip.clientWidth;
    if (top < strip.scrollTop) strip.scrollTop = top;
    else if (top + tab.offsetHeight > strip.scrollTop + strip.clientHeight) strip.scrollTop = top + tab.offsetHeight - strip.clientHeight;
    markTabOverflow();
}

// Which ends of a sideways strip hide tabs ('start', 'end', 'both' or none), for the
// fades that say there is more.
function markTabOverflow() {
    const strip = ui?.tablist;
    if (!strip) return;
    const hidden = Number(strip.scrollWidth) - Number(strip.clientWidth);
    const start = hidden > 1 && strip.scrollLeft > 1;
    const end = hidden > 1 && strip.scrollLeft < hidden - 1;
    setAttr(strip, 'data-overflow', start && end ? 'both' : start ? 'start' : end ? 'end' : null);
}

function selectTab(id, { focus = false } = {}) {
    if (!ui) return false;
    const tab = ownTabs().find(node => node.dataset.tabId === String(id));
    if (!tab) return false;
    viewFor(ui.uiKey).selected = tab.dataset.tabId;
    applySelection();
    if (!ui.pressed) hideHint();
    if (focus) focusQuietly(tab);
    return true;
}

function activeTab() {
    return ownTabs().find(tab => tab.classList.contains('active')) ?? null;
}

const isModal = () => Boolean(ui && ui.mode !== 'docked' && ui.open);

function setAttr(node, name, value) {
    if (value === null) {
        if (node.hasAttribute(name)) node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function applyOpenState() {
    if (!ui) return;
    const { layer, aside, scrim, handle, pin, close, grip, mode } = ui;
    const modal = isModal();
    // The layer is one stacking context: it rises above other extensions' floating
    // buttons only while a modal drawer or sheet is open.
    layer.dataset.modal = String(modal);
    const docked = mode === 'docked';
    aside.classList.toggle('is-open', docked || ui.open);
    setAttr(aside, 'role', modal ? 'dialog' : null);
    setAttr(aside, 'aria-modal', modal ? 'true' : null);
    setAttr(aside, 'aria-hidden', !docked && !ui.open ? 'true' : null);
    aside.dataset.sheet = ui.sheetFull ? 'full' : 'half';
    scrim.style.display = modal ? '' : 'none';
    handle.style.display = !docked && !ui.open ? '' : 'none';
    grip.style.display = mode === 'sheet' ? '' : 'none';
    grip.setAttribute('aria-expanded', String(ui.sheetFull));
    const gripTitle = ui.sheetFull ? 'Drag down or tap to shrink' : 'Drag to resize, tap to expand';
    if (grip.title !== gripTitle) {
        grip.title = gripTitle;
        grip.setAttribute('aria-label', gripTitle);
    }
    close.style.display = docked ? 'none' : '';
    pin.style.display = ui.dockable ? '' : 'none';
    const pinTitle = docked ? 'Unpin sidebar' : 'Pin sidebar';
    if (pin.title !== pinTitle) {
        pin.title = pinTitle;
        pin.setAttribute('aria-label', pinTitle);
    }
    pin.setAttribute('aria-pressed', String(docked));
}

// Focus never scrolls: the panel being focused may still be sliding in from off screen.
function focusQuietly(node) {
    node?.focus?.({ preventScroll: true });
}

function relayout() {
    if (!ui) return;
    const measured = measure();
    const decision = layoutMode({ ...measured, pinned: ui.pinned });
    const previous = ui.mode;
    ui.mode = decision.mode;
    ui.dockable = decision.dockable;
    // A window that shrinks under a docked sidebar must not throw a modal over the chat;
    // a docked sidebar has no open/closed state of its own.
    if (decision.mode === 'docked' || previous === 'docked') ui.open = false;
    if (decision.mode !== 'sheet') ui.sheetFull = false;
    ui.aside.dataset.mode = decision.mode;
    if (decision.mode === 'docked') {
        ui.aside.style.setProperty('--sb-dock-width', `${decision.width}px`);
        ui.aside.style.setProperty('--sb-dock-right', `${decision.right}px`);
        ui.aside.style.setProperty('--sb-dock-top', `${measured.topOffset + DOCK_MARGIN}px`);
    }
    applyOpenState();
    revealTab(activeTab());
}

function setPinned(next) {
    if (!ui) return;
    const pinned = Boolean(next);
    const wasDocked = ui.mode === 'docked';
    ui.pinned = pinned;
    try { ui.onPinnedChange?.(pinned); } catch (error) { console.error('[Story Block] onPinnedChange failed', error); }
    if (!ui) return;
    relayout();
    // Unpinning tucks the sidebar away; focus follows to the handle that brings it back.
    if (wasDocked && ui.mode !== 'docked') focusQuietly(ui.handle);
}

function updateHandle(total) {
    const label = total ? `Open Story Block, ${plural(total, 'change')} this turn` : 'Open Story Block';
    setAttr(ui.handle, 'aria-label', label);
    if (ui.handle.title !== label) ui.handle.title = label;
    setText(ui.count, total ? badgeText(total) : '');
    ui.count.style.display = total ? '' : 'none';
}

// ---------------------------------------------------------------------------
// Keyboard and gestures

function onTabKey(event) {
    const tabs = ownTabs();
    const index = tabs.indexOf(event.target?.closest?.(`.${CLASS.tab}`) ?? null);
    if (index < 0) return;
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault?.();
    const next = tabs[(keys[event.key] + tabs.length) % tabs.length];
    // (0.9.20) On the rail the arrows only move along it; Enter or Space opens the tab.
    if (ui.layout === 'rail') {
        for (const tab of tabs) tab.setAttribute('tabindex', tab === next ? '0' : '-1');
        focusQuietly(next);
        return;
    }
    selectTab(next.dataset.tabId, { focus: true });
}

// (0.9.20) The rail's label: the tab's name and, for another extension's tab, whose it is.
function showHint(tab) {
    if (!ui || ui.layout !== 'rail' || !tab) return;
    const label = tab.querySelector('.story-block-sidebar-tab-full')?.textContent || tab.dataset.tabId;
    const group = tab.dataset.group;
    setText(ui.hint, group && group !== OWN_GROUP ? `${label} · ${group}` : label);
    ui.hint.style.display = '';
    tab.setAttribute('aria-describedby', ui.hint.id);
    const asideRect = rectOf(ui.aside);
    const tabRect = rectOf(tab);
    if (!asideRect || !tabRect) return;
    ui.hint.dataset.side = ui.mode === 'sheet' ? 'below' : 'beside';
    if (ui.mode === 'sheet') {
        ui.hint.style.left = `${Math.max(8, tabRect.left - asideRect.left)}px`;
        ui.hint.style.top = `${tabRect.bottom - asideRect.top + 6}px`;
        ui.hint.style.right = '';
    } else {
        ui.hint.style.right = `${asideRect.right - tabRect.left + 8}px`;
        ui.hint.style.top = `${tabRect.top - asideRect.top + tabRect.height / 2}px`;
        ui.hint.style.left = '';
    }
}

function hideHint() {
    if (!ui) return;
    ui.hint.style.display = 'none';
    for (const tab of ownTabs()) tab.removeAttribute('aria-describedby');
}

function onTabHover(event) {
    const tab = event.target?.closest?.(`.${CLASS.tab}`);
    if (!tab || (event.type === 'pointerover' && event.pointerType !== 'mouse')) return;
    // Focus shows the label only when it came from the keyboard: opening the drawer or sheet
    // focuses a tab too, and a label left hanging there would cover the pane.
    if (event.type === 'focusin') {
        try {
            if (!tab.matches(':focus-visible')) return;
        } catch { /* no :focus-visible: show it */ }
    }
    clearTimeout(ui.hintTimer);
    showHint(tab);
}

function onTabLeave(event) {
    if (event.type === 'pointerout' && event.pointerType !== 'mouse') return;
    clearTimeout(ui.hintTimer);
    ui.hintTimer = setTimeout(hideHint, 80);
}

// A touch held on an icon shows its label instead of opening it.
function onTabPress(event) {
    const tab = event.target?.closest?.(`.${CLASS.tab}`);
    if (!tab || event.pointerType === 'mouse' || ui.layout !== 'rail') return;
    clearTimeout(ui.pressTimer);
    ui.pressed = false;
    ui.pressTimer = setTimeout(() => {
        ui.pressed = true;
        showHint(tab);
    }, 450);
}

function onTabRelease() {
    if (!ui) return;
    clearTimeout(ui.pressTimer);
    if (ui.pressed) {
        clearTimeout(ui.hintTimer);
        ui.hintTimer = setTimeout(hideHint, 1400);
    }
}

// A mouse wheel scrolls the sheet's sideways pills; a trackpad's own sideways swipe is left alone.
function onTabWheel(event) {
    const strip = ui?.tablist;
    if (!strip || !(strip.scrollWidth > strip.clientWidth)) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault?.();
    strip.scrollLeft += event.deltaY;
    markTabOverflow();
}

function isShown(node) {
    for (let current = node; current && current !== ui.aside; current = current.parentNode) {
        if (current.style?.display === 'none') return false;
    }
    return true;
}

function focusables() {
    const selector = 'button, a[href], input, select, textarea, [tabindex]';
    return [...ui.aside.querySelectorAll(selector)].filter(node => !node.disabled && node.getAttribute('tabindex') !== '-1' && isShown(node));
}

// aria-modal promises the reader that Tab stays inside the dialog.
function onTrapKey(event) {
    if (event.key !== 'Tab' || !isModal()) return;
    const nodes = focusables();
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes.at(-1);
    const active = doc()?.activeElement;
    if (event.shiftKey && (active === first || active === ui.aside)) {
        event.preventDefault?.();
        focusQuietly(last);
    } else if (!event.shiftKey && active === last) {
        event.preventDefault?.();
        focusQuietly(first);
    }
}

function onEscape(event) {
    if (event.key !== 'Escape' || !isModal() || event.defaultPrevented) return;
    // Leave Esc to whatever owns focus elsewhere (a SillyTavern popup above us).
    const active = doc()?.activeElement;
    const body = doc()?.body;
    if (active && active !== body && !ui.aside.contains(active) && active !== ui.scrim) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    closeSidebar();
}

// Swipe right on the drawer closes it. Mouse drags are left alone (text selection),
// and so are swipes over content that can still scroll back to the left.
function canScrollLeft(target) {
    for (let node = target; node && node !== ui.aside; node = node.parentNode) {
        if (node.scrollLeft > 0 && node.scrollWidth > node.clientWidth) return true;
    }
    return false;
}

function onSwipeStart(event) {
    if (!ui || ui.mode !== 'drawer' || !ui.open || event.pointerType === 'mouse') return;
    if (canScrollLeft(event.target)) return;
    ui.gesture = { kind: 'swipe', id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0 };
}

function onSwipeMove(event) {
    const gesture = ui?.gesture;
    if (gesture?.kind !== 'swipe' || gesture.id !== event.pointerId) return;
    gesture.dx = event.clientX - gesture.x;
    gesture.dy = event.clientY - gesture.y;
    if (gesture.dx > TAP_SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy)) {
        ui.aside.classList.add('is-dragging');
        ui.aside.style.transform = `translateX(${gesture.dx}px)`;
    }
}

function endDrag() {
    if (!ui) return;
    ui.gesture = null;
    ui.aside.classList.remove('is-dragging');
    ui.aside.style.transform = '';
}

function onSwipeEnd(event) {
    const gesture = ui?.gesture;
    if (gesture?.kind !== 'swipe' || gesture.id !== event.pointerId) return;
    onSwipeMove(event);
    const close = gesture.dx > SWIPE_CLOSE && Math.abs(gesture.dx) > Math.abs(gesture.dy);
    endDrag();
    if (close) closeSidebar();
}

function onSwipeCancel() {
    if (ui?.gesture?.kind === 'swipe') endDrag();
}

function onGripStart(event) {
    if (!ui || ui.mode !== 'sheet' || !ui.open) return;
    // The header's buttons stay buttons.
    if (event.currentTarget === ui.head && event.target?.closest?.('button')) return;
    event.stopPropagation();
    ui.suppressGripClick = false;
    ui.gesture = { kind: 'grip', id: event.pointerId, y: event.clientY, dy: 0, moved: false };
    try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
}

function onGripMove(event) {
    const gesture = ui?.gesture;
    if (gesture?.kind !== 'grip' || gesture.id !== event.pointerId) return;
    event.stopPropagation();
    gesture.dy = event.clientY - gesture.y;
    if (Math.abs(gesture.dy) > TAP_SLOP) gesture.moved = true;
    if (!gesture.moved) return;
    ui.aside.classList.add('is-dragging');
    // Follow the finger downwards; upwards only a little, the snap does the rest.
    const offset = gesture.dy > 0 ? gesture.dy : Math.max(gesture.dy, -24);
    ui.aside.style.transform = `translateY(${offset}px)`;
}

function onGripEnd(event) {
    const gesture = ui?.gesture;
    if (gesture?.kind !== 'grip' || gesture.id !== event.pointerId) return;
    event.stopPropagation();
    onGripMove(event);
    const { dy, moved } = gesture;
    endDrag();
    if (!moved) return;
    ui.suppressGripClick = true;
    if (dy < -SHEET_EXPAND) {
        ui.sheetFull = true;
        applyOpenState();
    } else if (dy > SHEET_CLOSE) {
        // Full height steps back to half first, so a sheet pulled all the way up is
        // never more than one short drag from where it opened; a long drag still closes.
        const height = ui.aside.getBoundingClientRect?.().height || 0;
        if (ui.sheetFull && dy < Math.max(SHEET_DISMISS, height * 0.4)) {
            ui.sheetFull = false;
            applyOpenState();
        } else {
            closeSidebar();
        }
    }
}

function onGripCancel() {
    if (ui?.gesture?.kind === 'grip') endDrag();
}

// ---------------------------------------------------------------------------
// API

/**
 * Mount (or update) the one sidebar. Returns the aside, or null when `tabs` is empty
 * (the sidebar and its edge handle are then removed).
 */
export function mountSidebar(tabs, { uiKey = 'default', meta = '', pinned = true, onPinnedChange, onSuite, showSuite = false, layout = 'rail' } = {}) {
    const rail = layout !== 'rows';
    const list = rail ? groupTabs(normalizeTabs(tabs)) : normalizeTabs(tabs);
    // No tabs, or no document body to hang a panel on (headless hosts and test doubles).
    if (!list.length || typeof doc()?.body?.appendChild !== 'function') {
        unmountSidebar();
        return null;
    }
    if (ui && !ui.aside.isConnected) teardown();
    if (!ui) ui = createUi();

    const key = String(uiKey ?? 'default');
    if (ui.uiKey !== key) {
        // Another chat: its panes hold the other chat's content and scroll positions.
        for (const node of [...ownTabs(), ...ownPanes()]) node.remove();
        ui.uiKey = key;
        ui.aside.dataset.uiKey = key;
    }
    ui.layout = rail ? 'rail' : 'rows';
    ui.aside.dataset.tabLayout = ui.layout;
    if (!rail) hideHint();
    ui.onPinnedChange = typeof onPinnedChange === 'function' ? onPinnedChange : null;
    ui.pinned = Boolean(pinned);
    ui.onSuite = typeof onSuite === 'function' ? onSuite : null;
    ui.suite.style.display = ui.onSuite && showSuite ? '' : 'none';

    const metaText = String(meta ?? '').trim();
    setText(ui.meta, metaText);
    ui.meta.style.display = metaText ? '' : 'none';

    const wanted = new Set(list.map(tab => tab.id));
    for (const node of [...ownTabs(), ...ownPanes()]) {
        if (!wanted.has(node.dataset.tabId)) node.remove();
    }
    const tabById = new Map(ownTabs().map(node => [node.dataset.tabId, node]));
    const paneById = new Map(ownPanes().map(node => [node.dataset.tabId, node]));
    const ordered = [];
    let total = 0;
    const glyphs = rail ? railGlyphs(list) : null;
    let previousGroup = null;
    for (const tab of list) {
        const tabButton = tabById.get(tab.id) ?? createTab(tab.id);
        updateTab(tabButton, tab, glyphs?.get(tab.id) ?? null);
        // A divider before each extension's first tab (never before the very first tab).
        const group = tab.group || OWN_GROUP;
        setAttr(tabButton, 'data-group-start', rail && previousGroup !== null && group !== previousGroup ? 'true' : null);
        previousGroup = group;
        ordered.push(tabButton);
        total += badgeOf(tab);
        let pane = paneById.get(tab.id);
        if (!pane) {
            pane = createPane(tab.id);
            ui.panel.appendChild(pane);
        }
        renderPane(pane, tab);
    }
    placeTabs(ordered);
    updateHandle(total);
    applySelection();
    watchLayout();
    relayout();
    return ui.aside;
}

/** Remove the sidebar, scrim and handle and stop watching the layout. */
export function unmountSidebar() {
    teardown();
    for (const id of Object.values(IDS)) byId(id)?.remove?.();
}

/** Drawer/sheet: slide in (selecting `tabId` when given). Docked: just select. */
export function openSidebar(tabId = null) {
    if (!ui) return false;
    if (tabId !== null && tabId !== undefined) selectTab(tabId);
    if (ui.mode === 'docked') return true;
    if (!ui.open) {
        ui.open = true;
        ui.sheetFull = false;
        applyOpenState();
    }
    focusQuietly(activeTab() ?? ui.close);
    return true;
}

/** Drawer/sheet only: slide out and hand focus back to the edge handle. */
export function closeSidebar() {
    if (!ui || ui.mode === 'docked' || !ui.open) return false;
    endDrag();
    ui.open = false;
    ui.sheetFull = false;
    applyOpenState();
    focusQuietly(ui.handle);
    return true;
}

/** Current layout: 'docked' | 'drawer' | 'sheet' (measured now when nothing is mounted). */
export function sidebarMode() {
    if (ui?.mode) return ui.mode;
    return layoutMode(measure()).mode;
}
