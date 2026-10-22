// The UI sample (a developer's page, Settings → Diagnostics → Show the UI sample): every building block of
// Story Suite's look (view/glass.css, view/widgets/glass.js) in light and in dark side by side, over
// SillyTavern's own background, for checking a theme and for screenshots. It is not a screen of the
// game view or a tab: it opens only from that button, shows made-up sample data, and changes nothing.
//
// It is drawn the way every screen is: an HTML template through SillyTavern's DOMPurify and the template
// allow-list (createScreenRenderer), the standard widgets by name. Each pane forces its scheme with the
// class `ss-scheme-light` or `ss-scheme-dark` (view/theme.js); with the "Follow SillyTavern only" panel style both panes show the
// theme as it is.

import { createScreenRenderer } from '../view/render-screen.js';

export const UI_SAMPLE_ID = 'story-block/ui-sample';

export const UI_SAMPLE_TEXT = Object.freeze({
    title: 'Story Suite: UI sample',
    close: 'Close',
    closeTitle: 'Close the UI sample',
    note: 'Sample data. Settings → Story Suite → Panel style and Font change what you see here.',
});

/** Made-up data for the sample (the concept's Astra). */
export const UI_SAMPLE_DATA = Object.freeze({
    pc: Object.freeze({ name: 'Astra', line: 'Soul Class II · Lv 12 · Wayfarer', hp: { cur: 50, max: 82 }, mp: { cur: 32, max: 40 }, sp: { cur: 30, max: 34 }, exp: { cur: 640, max: 1000 } }),
    statuses: Object.freeze([
        Object.freeze({ id: 'bleed', label: 'Bleeding', icon: 'fa-droplet', left: 40, unit: 'minutes', tone: 'bad' }),
        Object.freeze({ id: 'haste', label: 'Haste', icon: 'fa-forward', left: 2, unit: 'rounds', tone: 'warn' }),
        Object.freeze({ id: 'poison', label: 'Poisoned', icon: 'fa-skull-crossbones', left: 3, unit: 'turns', tone: 'good' }),
        Object.freeze({ id: 'blessed', label: 'Blessed', icon: 'fa-star', left: null, unit: 'turns', tone: 'accent' }),
    ]),
    skills: Object.freeze([
        Object.freeze({ id: 'moon', label: 'Moonlight Slash', icon: 'fa-wand-sparkles', count: '3', state: 'none', selected: true, tone: 'info', hint: 'Lv 3' }),
        Object.freeze({ id: 'frost', label: 'Frost Hex', icon: 'fa-snowflake', count: '2', state: 'ready', selected: false, tone: 'info', hint: 'Lv 2' }),
        Object.freeze({ id: 'death', label: 'Death Soul', icon: 'fa-skull', count: '–', state: 'locked', selected: false, tone: '', hint: 'Needs Blade Soul Lv 3' }),
    ]),
    bag: Object.freeze([
        Object.freeze({ id: 'draught', label: 'Healing Draught', icon: 'fa-flask', count: '3', tone: 'neutral' }),
        Object.freeze({ id: 'bitter', label: 'Folk Bitter Draught', icon: 'fa-leaf', count: '1', tone: 'uncommon' }),
        Object.freeze({ id: 'ring', label: 'Silver Ring', icon: 'fa-ring', count: '', tone: 'rare' }),
        Object.freeze({ id: 'chit', label: 'Council Chit', icon: 'fa-key', count: '', tone: 'epic' }),
    ]),
});

// One pane of the sample, in one scheme. Bars and badges come both as widgets and as plain classes, so
// the page shows that a template can use either.
function pane(scheme) {
    const name = scheme === 'light' ? 'Light' : 'Dark';
    return `
<section class="ss-sample-pane ss-scheme-${scheme}" aria-label="${name}">
  <p class="ss-label">${name} · glass card, pills, bars, status badges</p>
  <div class="ss-glass">
    <div class="ss-sample-row" style="align-items: center">
      <h3 class="ss-sample-title">{{ q.pc.name }}</h3>
      <ss-widget name="ss.pill" data-props='{"text":"{{ q.pc.line }}"}'></ss-widget>
    </div>
    <div class="ss-sample-row">
      <span class="ss-pill ss-pill-soft">Soft pill</span>
      <span class="ss-pill ss-pill-outline">Outline pill</span>
      <ss-widget name="ss.pill" data-props='{"text":"With an icon","icon":"fa-cloud-rain","style":"soft"}'></ss-widget>
    </div>
    <div class="ss-sample-grid3">
      <ss-widget name="ss.bar" data-props='{"label":"HP","kind":"hp","value":{{ q.pc.hp.cur }},"max":{{ q.pc.hp.max }}}'></ss-widget>
      <ss-widget name="ss.bar" data-props='{"label":"MP","kind":"mp","value":{{ q.pc.mp.cur }},"max":{{ q.pc.mp.max }}}'></ss-widget>
      <ss-widget name="ss.bar" data-props='{"label":"SP","kind":"sp","value":{{ q.pc.sp.cur }},"max":{{ q.pc.sp.max }}}'></ss-widget>
    </div>
    <div class="ss-bar ss-bar-exp" role="meter" aria-label="Soul growth" aria-valuemin="0" aria-valuemax="{{ q.pc.exp.max }}" aria-valuenow="{{ q.pc.exp.cur }}">
      <div class="ss-bar-head" aria-hidden="true"><span class="ss-bar-label">Soul growth (classes only)</span><span class="ss-bar-value">{{ q.pc.exp.cur }} / {{ q.pc.exp.max }}</span></div>
      <div class="ss-bar-track" data-bind-var="--ss-fill: ratio(q.pc.exp.cur, q.pc.exp.max)"><div class="ss-bar-fill"></div></div>
    </div>
    <div class="ss-sample-row">
      <ss-widget data-each="q.statuses as s" name="ss.status" data-props='{"label":"{{ s.label }}","icon":"{{ s.icon }}","left":"{{ s.left }}","unit":"{{ s.unit }}","tone":"{{ s.tone }}","id":"{{ s.id }}"}'></ss-widget>
    </div>
  </div>
  <p class="ss-label">Tiles · level badge, tick, lock, chosen</p>
  <div class="ss-glass ss-sample-grid3">
    <ss-widget data-each="q.skills as k" name="ss.tile" data-props='{"label":"{{ k.label }}","icon":"{{ k.icon }}","count":"{{ k.count }}","state":"{{ k.state }}","selected":"{{ k.selected }}","tone":"{{ k.tone }}","hint":"{{ k.hint }}","id":"{{ k.id }}"}'></ss-widget>
  </div>
  <p class="ss-label">Bag tiles · count in the corner, rarity rings</p>
  <div class="ss-glass ss-sample-row">
    <ss-widget data-each="q.bag as b" name="ss.tile" data-props='{"label":"{{ b.label }}","icon":"{{ b.icon }}","count":"{{ b.count }}","countStyle":"corner","tone":"{{ b.tone }}","showLabel":false,"id":"{{ b.id }}"}'></ss-widget>
  </div>
  <div class="ss-glass-strong">
    <p class="ss-label">Strong glass</p>
    <p style="margin: 4px 0 0">Navigation and cards over busy art. <span style="color: var(--ss-muted)">Muted text for the quiet parts.</span></p>
  </div>
</section>`;
}

/** The sample screen: a template (both panes) and its data. */
export const uiSampleScreen = Object.freeze({
    id: UI_SAMPLE_ID,
    title: 'UI sample',
    icon: 'fa-swatchbook',
    mounts: Object.freeze(['dialog']),
    template: `<div class="ss-sample-panes">${pane('light')}${pane('dark')}</div>`,
});

/** The template text of one pane, for tests. */
export const uiSamplePane = pane;

/**
 * Opens the sample over the page: a full-screen layer (SillyTavern's background shows through it) with a
 * Close button; Escape closes it too. `widgets()` → the registered widgets; `sanitize` SillyTavern's
 * DOMPurify. → { root, close() }. A second call closes the first.
 */
export function openUiSample({ doc = globalThis.document, widgets = () => ({}), sanitize = null } = {}) {
    doc.querySelector?.('#story_suite_ui_sample')?.remove();
    const before = doc.activeElement ?? null;
    const T = UI_SAMPLE_TEXT;
    const layer = doc.createElement('div');
    layer.id = 'story_suite_ui_sample';
    layer.className = 'ss-sample';
    layer.setAttribute('data-ss-screen', UI_SAMPLE_ID);
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'story_suite_ui_sample_title');
    const head = doc.createElement('div');
    head.className = 'ss-sample-head ss-glass-strong';
    const title = doc.createElement('b');
    title.id = 'story_suite_ui_sample_title';
    title.textContent = T.title;
    const note = doc.createElement('small');
    note.textContent = T.note;
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'menu_button ss-sample-close';
    close.textContent = T.close;
    close.title = T.closeTitle;
    head.append(title, note, close);
    const body = doc.createElement('div');
    body.className = 'ss-sample-body';
    layer.append(head, body);
    doc.body.appendChild(layer);
    const renderer = createScreenRenderer({ queryAt: () => null, widgets, sanitize });
    let cleanup = null;
    try {
        cleanup = renderer.render(body, uiSampleScreen, { mount: 'dialog', q: UI_SAMPLE_DATA, state: null, api: {} });
    } catch (error) {
        body.textContent = `The UI sample could not be drawn: ${error?.message ?? error}`;
    }
    let open = true;
    const api = {
        root: layer,
        close() {
            if (!open) return;
            open = false;
            try { cleanup?.(); } catch { /* the layer goes either way */ }
            layer.remove();
            if (before && before !== doc.body && before.isConnected !== false) before.focus?.();
        },
    };
    layer.addEventListener('keydown', event => {
        if (event?.key !== 'Escape') return;
        event.preventDefault?.();
        event.stopPropagation?.();
        api.close();
    });
    close.addEventListener('click', () => api.close());
    close.focus?.();
    return api;
}
