// Fakes for the mount tests: v1's fake DOM plus document-level key events, a fake IntersectionObserver,
// a fake renderer that records what it was asked to draw, a small chat of carriers with their own
// states, and a fake command api.
import { installFakeDom, makeMessage } from '../../../ui-fake-dom.js';
import { createScreens } from '../../../../src/v2/view/screens.js';

export function setupDom() {
    const doc = installFakeDom();
    const create = doc.createElement;
    doc.createElement = tag => {
        const el = create(tag);
        el.style.removeProperty = name => { delete el.styleProps[name]; };
        return el;
    };
    doc.listeners = [];
    doc.addEventListener = (type, fn, options) => doc.listeners.push({ type, fn, capture: options === true || !!options?.capture });
    doc.removeEventListener = (type, fn) => { doc.listeners = doc.listeners.filter(entry => entry.type !== type || entry.fn !== fn); };
    doc.key = key => {
        const event = { type: 'keydown', key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
        for (const entry of [...doc.listeners]) if (entry.type === 'keydown') entry.fn(event);
        return event;
    };
    return doc;
}

/** Records every observed element; `show(el, on)` plays an intersection change. */
export function fakeObserverClass() {
    const instances = [];
    class FakeObserver {
        constructor(callback) {
            this.callback = callback;
            this.targets = new Set();
            instances.push(this);
        }
        observe(el) { this.targets.add(el); }
        unobserve(el) { this.targets.delete(el); }
        disconnect() { this.targets.clear(); }
        show(el, on = true) { this.callback([{ target: el, isIntersecting: on }]); }
    }
    FakeObserver.instances = instances;
    return FakeObserver;
}

/** A renderer that writes "<screen id> rev <rev>" and records the call; mimics a [data-submit] button. */
export function fakeRenderer() {
    const calls = [];
    const render = (el, screen, scope) => {
        calls.push({ el, screen, scope });
        const doc = el.ownerDocument;
        const line = doc.createElement('span');
        line.className = 'drawn';
        line.textContent = `${screen.id} rev ${scope.state?.meta?.rev}`;
        el.replaceChildren(line);
        const submit = /data-submit="([^"]+)"/.exec(screen.template ?? '');
        if (submit) {
            const button = doc.createElement('button');
            button.setAttribute('data-submit', submit[1]);
            button.textContent = 'Send';
            el.appendChild(button);
        }
        if (typeof screen.onDraw === 'function') screen.onDraw(scope);
    };
    render.calls = calls;
    render.last = () => calls[calls.length - 1];
    return render;
}

export const stateWith = (rev, extra = {}) => Object.freeze({ v: 2, meta: { rev, claims: {} }, domains: { party: { hp: rev * 10 }, ...extra } });

/**
 * A chat of carriers 0..n-1 (all carriers unless `users` lists user messages); each has its own state.
 * `swipe(index, rev)` moves a message to a new swipe with a new state.
 */
export function fakeChat(doc, revs, { users = [] } = {}) {
    const states = revs.map(rev => stateWith(rev));
    const swipes = revs.map(() => 0);
    const messages = revs.map((_, index) => makeMessage(doc, index));
    const reads = [];
    return {
        states,
        messages,
        reads,
        carriers: () => revs.map((_, index) => index).filter(index => !users.includes(index)),
        stateAt: index => { reads.push(index); return states[index]; },
        headIndex: () => revs.length - 1,
        swipeAt: index => swipes[index],
        changesAt: index => (index === 1 ? ['/domains/party/hp', '/meta/rev'] : []),
        messageElement: index => messages[index] ?? null,
        swipe(index, rev) {
            swipes[index]++;
            states[index] = stateWith(rev);
        },
    };
}

/** A query that answers from the state it is given, and records the calls. */
export function fakeQuery() {
    const calls = [];
    const query = (name, args, state) => {
        calls.push({ name, args, state });
        if (name === 'party.hp') return state.domains.party.hp;
        if (name === 'echo') return args;
        throw new Error(`no query ${name}`);
    };
    query.calls = calls;
    return query;
}

export function fakeApi() {
    const calls = [];
    let previews = 0;
    return {
        calls,
        nextCommand: { ok: true, receipt: { id: 'rc_cmd00001', summary: 'Done.' } },
        nextPreview: null,
        command(type, payload, options) {
            calls.push(['command', type, payload, options]);
            return this.nextCommand;
        },
        async preview(type, payload) {
            calls.push(['preview', type, payload]);
            if (this.nextPreview) return this.nextPreview;
            previews++;
            return { ok: true, token: `pv_${previews}`, receipt: { id: `rc_prev000${previews}`, summary: `Rolled ${previews * 3}.` } };
        },
        async commit(token) {
            calls.push(['commit', token]);
            return { ok: true, receipt: { id: 'rc_commit01', summary: `Kept ${token}.` } };
        },
    };
}

export const screen = (id, mounts, more = {}) => ({ id, title: id.split('/').pop(), icon: 'fa-star', mounts, template: `<div>${id}</div>`, ...more });

/** Screens registry with reader settings kept in memory. */
export function screensWith(defaults, { reader = {} } = {}) {
    let settings = reader;
    const screens = createScreens({ reader: () => settings, saveReader: next => { settings = next; } });
    screens.addModule('test', defaults);
    screens.settings = () => settings;
    return screens;
}
