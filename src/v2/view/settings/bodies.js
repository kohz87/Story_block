// What each section of the settings window holds (UI stage, step 3a): a map of section id → body. A body is a function
//
//     (pane, ctx) → { filter(text) → number, refresh?(), destroy?() }
//
// `pane` is the empty element the window made for the section's page (under its heading); the body draws into it.
// `filter(text)` shows what matches the reader's search and returns how many matches it shows (the form engine's
// `renderSettingsForm(...).filter` does exactly this, so a section that moves to the form engine passes it through);
// '' shows everything. `ctx` is { doc, openState, label (the section's name), legacy, options (what the window was
// opened with: registry, settings, sdk, features, …) }.
//
// Step 3a: every body is today's settings (host-ui.js `renderSettingsHost`), drawn into the section it belongs to
// (sections.js `routeOf`) by one shared host, so nothing changed but where it is. Steps 3b–3g replace one entry each:
//
//     SECTION_BODIES.features = (pane, ctx) => { const form = renderSettingsForm(pane, { … }); return { filter: t => form.filter(t), refresh: () => form.refresh(), destroy: () => form.destroy() }; };
//
// A section with its own body is not drawn by the shared host (it never gets a pane), so its old folds go away
// with the entry.

import { renderSettingsHost } from '../../host-ui.js';
import { SECTION_IDS, opensByDefault, routeOf } from './sections.js';
import { filterPane } from './search.js';

/**
 * The shared host of today's settings for the sections that still use it: `attach(id, pane, ctx)` is each such body,
 * `start(root, { afterRefresh, show })` draws them all once every pane is attached, `refresh()` draws them again.
 */
export function createLegacySettings(options) {
    const panes = new Map();
    let host = null;
    return {
        attach(id, pane, ctx) {
            panes.set(id, pane);
            return {
                filter: text => (host ? filterPane({ pane, entries: host.entries(), text, openState: ctx.openState }) : 0),
            };
        },
        start(root, { afterRefresh = null, show = null } = {}) {
            if (!panes.size) return;
            host = renderSettingsHost(root, {
                ...options,
                sections: { ids: [...panes.keys()], place: id => panes.get(id) ?? null, route: routeOf, defaultOpen: opensByDefault, show, afterRefresh },
            });
        },
        refresh: () => host?.refresh(),
        refreshSize: () => host?.refreshSize(),
    };
}

const legacyBody = id => (pane, ctx) => ctx.legacy.attach(id, pane, ctx);

/** Section id → body. Replace an entry to move that section to the form engine (see the top of this file). */
export const SECTION_BODIES = Object.fromEntries(SECTION_IDS.map(id => [id, legacyBody(id)]));
