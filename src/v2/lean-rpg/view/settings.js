// Settings → Lean RPG: a small fold on the Features page with "Rolls: Automatic / Off". It shows only while the feature
// `story-block.lean-rpg` is on. The value is `leanRpgRolls` in Story Block's own settings (`settings.set('story-block',
// 'leanRpgRolls', …)`, ROLLS_SETTING in lean-rpg/names.js); the rolls piece owns what it means ('automatic' is the default). The fold is drawn by the form engine, so the field
// has its label, help, a radio group and the same save path as every other setting. Every node is built with createElement.

import { renderSettingsForm } from '../../view/form/form.js';
import { RPG_STRINGS } from '../strings.js';

const S = RPG_STRINGS.settings;
export const ROLLS_DEFAULT = 'automatic';
/** The setting's key (the rolls piece's ROLLS_SETTING). */
export const ROLLS_KEY = 'leanRpgRolls';
export const SETTINGS_MODULE = 'story-block';
export const SETTINGS_FOLD = 'lean-rpg';

/** The one field the fold draws. */
export const LEAN_RPG_SCHEMA = Object.freeze({
    [ROLLS_KEY]: Object.freeze({
        type: 'choice', form: 'chips', label: S.rolls, help: S.rollsHelp,
        options: Object.freeze([Object.freeze({ value: 'automatic', label: S.automatic }), Object.freeze({ value: 'off', label: S.off })]),
    }),
});

/** The reader's choice: 'automatic' or 'off'. */
export const rollsOf = settings => (settings?.(SETTINGS_MODULE)?.[ROLLS_KEY] === 'off' ? 'off' : ROLLS_DEFAULT);

/**
 * Draws the fold into `parent`. Options: `settings` (the store: `settings(id)`, `settings.set(id, key, value)`), `doc`,
 * `featureOn()` (the fold is hidden while it says false), `onChange()`.
 * → { el, filter(text) → count, refresh(), destroy() }, as a settings page body expects.
 */
export function renderLeanRpgSettings(parent, { settings, doc = parent.ownerDocument ?? globalThis.document, featureOn = () => true, onChange = () => {} } = {}) {
    const el = doc.createElement('details');
    el.className = 'rpg-settings';
    el.setAttribute('data-fold', SETTINGS_FOLD);
    const summary = doc.createElement('summary');
    summary.textContent = S.title;
    const hint = doc.createElement('p');
    hint.className = 'rpg-settings-hint';
    hint.textContent = S.hint;
    const body = doc.createElement('div');
    el.append(summary, hint, body);
    parent.appendChild(el);
    // The store as the form reads it: `leanRpgRolls` is 'automatic' until the reader says otherwise.
    const read = Object.assign(id => ({ ...(id === SETTINGS_MODULE ? { [ROLLS_KEY]: ROLLS_DEFAULT } : {}), ...settings(id) }), { set: settings.set, stored: settings.stored });
    const form = renderSettingsForm(body, { moduleId: SETTINGS_MODULE, schema: LEAN_RPG_SCHEMA, settings: read, doc, quiet: true, onChange: () => onChange() });
    const place = () => { el.hidden = !featureOn(); };
    place();
    return {
        el,
        filter(text) {
            const wanted = String(text ?? '').trim().toLowerCase();
            const shown = featureOn() && (!wanted || [S.title, S.rolls, S.automatic, S.off, S.hint].some(word => word.toLowerCase().includes(wanted)));
            el.hidden = !shown;
            return shown ? 1 : 0;
        },
        refresh() { form.refresh(); place(); },
        destroy() { form.destroy(); el.remove(); },
    };
}

/**
 * The settings window's section bodies with the fold added to the Features page (`openSettingsWindow({ bodies })`): the
 * page draws as before and the fold follows it. `featureOn()` says whether the fold shows.
 */
export function withLeanRpgSettings(bodies, { featureOn }) {
    const features = bodies?.features;
    if (typeof features !== 'function') return bodies;
    return {
        ...bodies,
        features(pane, ctx) {
            const base = features(pane, ctx) ?? {};
            const rpg = renderLeanRpgSettings(pane, { settings: ctx.options.settings, doc: ctx.doc, featureOn, onChange: () => ctx.changed?.() });
            return {
                ...base,
                filter: text => (base.filter?.(text) ?? 0) + rpg.filter(text),
                refresh() { base.refresh?.(); rpg.refresh(); },
                destroy() { rpg.destroy(); base.destroy?.(); },
            };
        },
    };
}
