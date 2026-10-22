// The settings window (UI stage, step 3a): Story Suite's settings in a glass window. A header (the title, a search
// box over every section, Close), a rail of sections (the `ss.tabs` block: icon and label, one Tab stop, the arrow
// keys move along it, the current one is `aria-current="page"`; on a phone it is a row that scrolls sideways above
// the page) and the page of the chosen section. What a page holds is its body (bodies.js): today the folds and rows
// the old overlay drew, each in the section it belongs to; the form engine takes the pages over one by one.
//
//   const win = openSettingsWindow({ registry, settings, doc, sdk, features, promptParts, countTokens, diagnostics,
//                                     tabs, theme, fold: PACKS_FOLD, onClose });
//   win.select('money');  win.refresh();  win.refreshSize();  win.close();  win.isOpen();  win.root;
//
// `fold` opens the window on the section that holds that fold, the fold open and its summary focused (Home's "Import a
// pack" asks for PACKS_FOLD). `bodies` replaces the section → body map (tests, and a section moved to the form
// engine). The window is a modal dialog: `<body>` carries `story-suite-open`, Tab stays inside it, a click or the
// focus going to the page behind brings the focus back, Escape closes it (while the search box holds text, Escape
// empties it first), and the focus goes back to where it was. Search: typing filters every section at once, a page
// with no match is left out, the rail shows how many each page has, and the count is said in a polite live region
// (the form engine's words: "3 settings shown", "No settings match …"). Choosing a section ends the search.
//
// Every node is built with createElement and textContent (security tests forbid markup APIs in view code).

import { DIAGNOSTICS_FOLD, OPEN_CLASS, SUB_FOLD, diagnosticsKeys, featuresFoldOf } from '../../host-ui.js';
import { fill } from '../../strings.js';
import { FORM_TEXT } from '../form/schema.js';
import { searchField } from '../form/fields.js';
import { tabs as tabsBlock } from '../widgets/nav.js';
import { SECTION_BODIES, createLegacySettings } from './bodies.js';
import { DEFAULT_SECTION, SECTION_IDS, SETTINGS_SECTIONS, WINDOW_TEXT } from './sections.js';

export const WINDOW_ID = 'story_suite_v2_overlay';
const TITLE_ID = `${WINDOW_ID}_title`;
const FOCUSABLE = 'button, input, select, textarea, a[href], summary, [tabindex]';

const h = (doc, tag, className = '', text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
};

// A node the reader can reach now: not hidden, not behind a closed fold, not taken out of the Tab order.
function reachable(node, root) {
    if (node.disabled || node.getAttribute?.('tabindex') === '-1') return false;
    for (let n = node; n && n !== root; n = n.parentNode) {
        if (n.hidden) return false;
        const parent = n.parentNode;
        if (parent?.tagName === 'DETAILS' && !parent.open && n.tagName !== 'SUMMARY') return false;
    }
    return true;
}
const focusablesIn = root => Array.from(root.querySelectorAll(FOCUSABLE)).filter(node => reachable(node, root));

// One window at a time; the folds stay as the reader left them when it is opened again (this page load).
let current = null;
const windowOpenState = new Map();

/** Opens the settings window on `doc.body` (closing one already open). Returns { root, window, refresh, refreshSize, select, section, isOpen, close }. */
export function openSettingsWindow({ registry, settings, doc = globalThis.document, sdk = null, features = null, promptParts = null, countTokens = null, diagnostics = null, tabs = null, theme = null, fold: target = null, openState = windowOpenState, onClose = null, bodies = SECTION_BODIES }) {
    if (current?.root?.ownerDocument === doc) current.close();
    doc.querySelector?.(`#${WINDOW_ID}`)?.remove();
    const before = doc.activeElement ?? null;

    // ---- the frame
    const layer = h(doc, 'div', 'story-suite-overlay');
    layer.id = WINDOW_ID;
    const win = h(doc, 'div', 'ss-settings');
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-labelledby', TITLE_ID);
    const head = h(doc, 'header', 'ss-settings-head');
    const title = h(doc, 'h2', 'ss-settings-title', WINDOW_TEXT.title);
    title.id = TITLE_ID;
    const searchBox = searchField(doc, { label: WINDOW_TEXT.searchLabel, placeholder: WINDOW_TEXT.searchPlaceholder, onInput: text => applySearch(text) });
    searchBox.el.classList.add('ss-settings-search');
    const close = h(doc, 'button', 'ss-settings-close story-suite-close');
    close.type = 'button';
    close.setAttribute('aria-label', WINDOW_TEXT.close);
    close.title = WINDOW_TEXT.close;
    const times = h(doc, 'span', '', '×');
    times.setAttribute('aria-hidden', 'true');
    close.appendChild(times);
    head.append(title, searchBox.el, close);
    const main = h(doc, 'div', 'ss-settings-main');
    const rail = h(doc, 'div', 'ss-settings-rail');
    const content = h(doc, 'div', 'ss-settings-content');
    const status = h(doc, 'p', 'ss-form-status ss-settings-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    const empty = h(doc, 'p', 'ss-form-empty');
    empty.hidden = true;
    content.append(status, empty);
    main.append(rail, content);
    win.append(head, main);
    layer.appendChild(win);
    doc.body.appendChild(layer);
    doc.body.classList.add(OPEN_CLASS);

    // ---- the pages: a heading, then the body's pane
    const pages = new Map();
    for (const section of SETTINGS_SECTIONS) {
        const page = h(doc, 'section', 'ss-settings-page');
        page.dataset.ssSection = section.id;
        page.hidden = true;
        const heading = h(doc, 'div', 'ss-settings-page-head');
        const name = h(doc, 'h3', 'ss-settings-page-title', section.title);
        name.id = `${WINDOW_ID}_${section.id}_title`;
        page.setAttribute('aria-labelledby', name.id);
        heading.append(name, h(doc, 'p', 'ss-settings-page-sub', section.sub));
        const pane = h(doc, 'div', 'ss-settings-pane story-suite-folds');
        page.append(heading, pane);
        content.appendChild(page);
        pages.set(section.id, { section, page, pane, body: null, count: 0 });
    }

    // ---- the rail
    let chosen = DEFAULT_SECTION;
    let searchText = '';
    let railBlock = null;
    const railItems = () => SETTINGS_SECTIONS.map(section => ({ id: section.id, label: section.label, icon: section.icon, count: searchText.trim() && pages.get(section.id).count ? String(pages.get(section.id).count) : '' }));
    const railProps = () => ({ items: railItems(), current: chosen, label: WINDOW_TEXT.railLabel, onSelect: 'settings.section' });
    railBlock = tabsBlock.render(rail, railProps(), { command: (type, payload) => { if (type === 'settings.section') select(payload?.tabs); } });

    // ---- the bodies
    const options = { registry, settings, doc, sdk, features, promptParts, countTokens, openState, diagnostics, tabs, theme };
    const legacy = createLegacySettings(options);
    for (const id of SECTION_IDS) {
        const entry = pages.get(id);
        const make = bodies[id];
        if (typeof make !== 'function') continue;
        entry.body = make(entry.pane, { doc, openState, label: entry.section.label, legacy, options });
    }

    // ---- showing a page
    function paint() {
        const searching = searchText.trim() !== '';
        for (const entry of pages.values()) entry.page.hidden = searching ? !entry.count : entry.section.id !== chosen;
        railBlock.update(railProps());
    }
    function select(id) {
        chosen = SECTION_IDS.includes(id) ? id : DEFAULT_SECTION;
        if (searchText !== '') searchBox.clear();   // choosing a section ends the search (its onInput repaints)
        else paint();
        content.scrollTop = 0;
        return chosen;
    }

    // ---- search
    function applySearch(text) {
        searchText = String(text ?? '');
        const query = searchText.trim();
        let total = 0;
        for (const entry of pages.values()) {
            const found = entry.body?.filter?.(searchText);
            entry.count = Number.isFinite(found) ? found : 0;
            total += query ? entry.count : 0;
        }
        status.hidden = !query;
        status.textContent = query && total ? (total === 1 ? FORM_TEXT.shownOne : fill(FORM_TEXT.shown, { n: total })) : '';
        empty.hidden = !(query && total === 0);
        empty.textContent = query && total === 0 ? fill(FORM_TEXT.none, { text: query }) : '';
        paint();
        content.scrollTop = 0;
    }

    // ---- keeping the focus inside, Escape, Close
    let open = true;
    const onFocus = event => {
        if (open && event?.target && !win.contains(event.target)) (focusablesIn(win)[0] ?? win).focus?.();
    };
    const onKey = event => {
        if (event?.key === 'Escape') {
            event.preventDefault?.();
            event.stopPropagation?.();
            api.close();
            return;
        }
        if (event?.key !== 'Tab') return;
        const nodes = focusablesIn(win);
        if (!nodes.length) {
            event.preventDefault?.();
            return;
        }
        const at = nodes.indexOf(doc.activeElement);
        const next = event.shiftKey ? (at <= 0 ? nodes.at(-1) : null) : (at === -1 || at === nodes.length - 1 ? nodes[0] : null);
        if (next) {
            event.preventDefault?.();
            next.focus?.();
        }
    };
    layer.addEventListener('keydown', onKey);
    doc.addEventListener?.('focusin', onFocus, true);
    // A click on the dimmed page beside the window closes it, but a drag that starts inside (selecting text) and ends
    // outside does not.
    let pressedOnLayer = false;
    layer.addEventListener('mousedown', event => { pressedOnLayer = event.target === layer; });
    layer.addEventListener('click', event => { if (event.target === layer && pressedOnLayer) api.close(); });
    close.addEventListener('click', () => api.close());

    const api = {
        root: layer,
        window: win,
        refresh() {
            legacy.refresh();
            for (const entry of pages.values()) entry.body?.refresh?.();
        },
        refreshSize: () => legacy.refreshSize(),
        select,
        section: () => chosen,
        isOpen: () => open,
        close() {
            if (!open) return;
            open = false;
            if (current === api) current = null;
            doc.removeEventListener?.('focusin', onFocus, true);
            for (const entry of pages.values()) { try { entry.body?.destroy?.(); } catch { /* closed either way */ } }
            railBlock.destroy();
            layer.remove();
            doc.body.classList.remove(OPEN_CLASS);
            try { onClose?.(); } catch { /* the window is closed either way */ }
            if (before && before !== doc.body && before.isConnected !== false) before.focus?.();
        },
    };
    current = api;

    // ---- opening on a fold
    // A module's old "<id>::features" sub-fold is its sub-fold of the Features fold now.
    let wanted = typeof target === 'string' && target ? target : null;
    if (wanted?.endsWith(`${SUB_FOLD}features`)) wanted = featuresFoldOf(wanted.slice(0, -`${SUB_FOLD}features`.length));
    if (wanted) {
        openState.set(wanted, true);
        // A sub-fold opens its module's fold too, and one placed in Diagnostics opens Diagnostics.
        if (wanted.includes(SUB_FOLD)) openState.set(wanted.split(SUB_FOLD)[0], true);
        if (diagnosticsKeys(registry).includes(wanted)) openState.set(DIAGNOSTICS_FOLD, true);
    }
    legacy.start(content, {
        show: id => { if (open) select(id); },
        afterRefresh: () => { if (searchText !== '') applySearch(searchText); },
    });
    const folds = () => [...content.querySelectorAll('details.story-suite-fold, details.story-suite-subfold')];
    const found = wanted ? folds().find(node => node.dataset.fold === wanted) : null;
    const owner = found ? [...pages.values()].find(entry => entry.pane.contains(found)) : null;
    select(owner?.section.id ?? DEFAULT_SECTION);
    if (found) {
        found.scrollIntoView?.({ block: 'start' });
        found.querySelector('summary')?.focus?.();
    } else {
        const stop = rail.querySelector('[aria-current="page"]') ?? focusablesIn(win)[0];
        stop?.focus?.();
    }
    return api;
}
