// Helpers for the default screens' tests: the template renderer when it is there (it is loaded
// dynamically, so these tests skip with a reason on a tree that does not have it yet), the core module's
// queries over a state, extra fake module queries, and a renderer for one screen.
import { resolveData } from '../../../src/v2/view/screens.js';
import { compile, evaluate } from '../../../src/v2/events/index.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { core, stocked } from '../domains/fixtures.js';

async function load(path) {
    try {
        return await import(path);
    } catch {
        return null;
    }
}

const template = await load('../../../src/v2/view/template/index.js');
const bind = await load('../../../src/v2/view/bind.js');
export const css = await load('../../../src/v2/view/css.js');

/** null when the renderer can be used; else the reason the render tests are skipped. */
export const renderSkip = template && bind
    ? false
    : 'the template renderer (src/v2/view/template/, bind.js) is not on this branch yet';
export const cssSkip = css ? false : 'the CSS scoper (src/v2/view/css.js) is not on this branch yet';

export { core, stocked };

/** A query runner over `state`: the core module's queries plus `extra` ({ name: (state, args) => … }). */
export function queries(module, state, extra = {}) {
    const all = { ...module.queries, ...extra };
    const query = (name, args) => {
        const fn = all[name];
        if (typeof fn !== 'function') throw new Error(`Story Suite: no module answers the query "${name}".`);
        return fn(state, args, { query });
    };
    return query;
}

/** A state with items, a place and two people present. */
export function sceneState(module = core()) {
    const state = stocked(module);
    state.domains.scene.place = { name: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshore' };
    state.domains.scene.present = ['Fenna', 'Old Tam'];
    return state;
}

/** Widgets that record the props they are drawn with (name → list of props). */
export function recordingWidgets() {
    const drawn = {};
    const widget = name => ({
        render(el, props) {
            (drawn[name] ??= []).push(props);
            el.textContent = `${name}:${props.label ?? props.name ?? ''}`;
            return { update(next) { (drawn[name] ??= []).push(next); }, destroy() {} };
        },
    });
    const names = ['ss.meter', 'ss.portrait', 'ss.badge', 'story-block.savepoints', 'story-block.ready-hint', 'story-block.show-more'];
    return { drawn, widgets: Object.fromEntries(names.map(name => [name, widget(name)])) };
}

/**
 * Render `screen` the way a mount does: its data through `query`, then the template with the real
 * condition language. → { el, view, q, problems, calls, results }
 */
export function show(screen, { state, query, changes = [], draft = undefined, widgets = {}, command = null, settings = {}, extra = {} }) {
    const data = resolveData(screen.data, query);
    if (!data.ok) throw new Error(data.message);
    const doc = installFakeDom();
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', screen.id);
    doc.body.appendChild(el);
    const calls = [];
    const results = [];
    const compiled = template.compileTemplate(screen.template);
    if (compiled.warnings.length) throw new Error(`${screen.id}: ${compiled.warnings.join(' ')}`);
    const scope = { state, q: data.q, changes, settings, query, ...extra };
    if (draft !== undefined) scope.draft = draft;
    const view = template.renderTemplate(el, compiled, scope, {
        evaluate: bind.conditionEvaluator({ compile, evaluate }),
        widgets,
        command: async (type, payload, options) => {
            calls.push([type, payload, options]);
            return command ? command(type, payload, options) : { ok: true };
        },
        onResult: result => results.push(result),
    });
    return { el, view, q: data.q, problems: data.problems, calls, results, doc };
}

/** Text with runs of white space made single, trimmed. */
export const text = node => node.textContent.replace(/\s+/g, ' ').trim();

/** Let the click's command promise settle. */
export const settle = () => new Promise(resolve => setImmediate(resolve));
