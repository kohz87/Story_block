// A small fake DOM for the widget tests (no jsdom, no dependencies): HTML and SVG elements
// (createElementNS keeps the namespace and the tag's case), attributes, class lists, inline custom
// properties, text, event dispatch with capture and bubbling, a little selector engine, and per-element
// layout rectangles the tests set by hand. Setting innerHTML throws, so a widget that used it would fail
// every test, not only the grep.

export const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

class Node {
    constructor(doc) {
        this.ownerDocument = doc;
        this.parentNode = null;
    }
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    remove() {
        if (!this.parentNode) return;
        const list = this.parentNode.childNodes;
        list.splice(list.indexOf(this), 1);
        this.parentNode = null;
    }
}

class Text extends Node {
    constructor(doc, text) {
        super(doc);
        this.nodeType = 3;
        this.data = String(text);
    }
    get textContent() { return this.data; }
    set textContent(value) { this.data = String(value); }
}

function parseCompound(source) {
    const out = { tag: null, classes: [], attrs: [] };
    let rest = source;
    while (rest) {
        let m;
        if ((m = /^[a-zA-Z][\w-]*/.exec(rest))) out.tag = m[0].toLowerCase();
        else if ((m = /^\.([\w-]+)/.exec(rest))) out.classes.push(m[1]);
        else if ((m = /^#([\w-]+)/.exec(rest))) out.attrs.push(['id', m[1]]);
        else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) out.attrs.push([m[1], m[2]]);
        else throw new Error(`fake DOM: unsupported selector "${source}"`);
        rest = rest.slice(m[0].length);
    }
    return out;
}

function matches(node, compound) {
    if (node.nodeType !== 1) return false;
    if (compound.tag && node.localName.toLowerCase() !== compound.tag) return false;
    if (!compound.classes.every(name => node.classList.contains(name))) return false;
    return compound.attrs.every(([name, value]) => (value === undefined ? node.hasAttribute(name) : node.getAttribute(name) === value));
}

function matchChain(node, chain, index) {
    if (!matches(node, chain[index])) return false;
    if (index === 0) return true;
    for (let up = node.parentElement; up; up = up.parentElement) if (matchChain(up, chain, index - 1)) return true;
    return false;
}

const parse = selector => selector.split(',').map(part => part.trim().split(/\s+/).map(parseCompound));

export class Element extends Node {
    constructor(doc, tag, namespaceURI = HTML_NS) {
        super(doc);
        this.nodeType = 1;
        this.namespaceURI = namespaceURI;
        this.localName = namespaceURI === HTML_NS ? tag.toLowerCase() : tag;
        this.tagName = namespaceURI === HTML_NS ? tag.toUpperCase() : tag;
        this.childNodes = [];
        this.attrs = new Map();
        this.listeners = [];
        this.value = '';
        this.rect = null;
        this.captured = new Set();
        const element = this;
        this.styleProps = {};
        this.style = {
            setProperty(name, value) { element.styleProps[name] = String(value); },
            getPropertyValue(name) { return element.styleProps[name] ?? ''; },
            removeProperty(name) { delete element.styleProps[name]; },
        };
        const list = () => (element.attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
        const write = names => element.attrs.set('class', names.join(' '));
        this.classList = {
            add: (...names) => write([...new Set([...list(), ...names])]),
            remove: (...names) => write(list().filter(name => !names.includes(name))),
            toggle: (name, force) => {
                const on = force === undefined ? !list().includes(name) : Boolean(force);
                if (on) element.classList.add(name);
                else element.classList.remove(name);
                return on;
            },
            contains: name => list().includes(name),
        };
    }
    [Symbol.for('nodejs.util.inspect.custom')]() {
        return `<${this.localName}${this.attrs.has('class') ? ` class="${this.attrs.get('class')}"` : ''}>`;
    }

    get className() {
        if (this.namespaceURI === SVG_NS) return { baseVal: this.attrs.get('class') ?? '' };
        return this.attrs.get('class') ?? '';
    }
    set className(value) {
        if (this.namespaceURI === SVG_NS) throw new Error('fake DOM: className is read-only on SVG elements');
        this.attrs.set('class', String(value));
    }
    get hidden() { return this.attrs.has('hidden'); }
    set hidden(value) { if (value) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
    get disabled() { return this.attrs.has('disabled'); }
    set disabled(value) { if (value) this.attrs.set('disabled', ''); else this.attrs.delete('disabled'); }
    get id() { return this.attrs.get('id') ?? ''; }

    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    setAttribute(name, value) {
        if (/^on/i.test(name)) throw new Error(`fake DOM: a widget set the event attribute "${name}"`);
        this.attrs.set(name, String(value));
    }
    hasAttribute(name) { return this.attrs.has(name); }
    removeAttribute(name) { this.attrs.delete(name); }

    get children() { return this.childNodes.filter(node => node.nodeType === 1); }
    get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) {
        for (const node of this.childNodes) node.parentNode = null;
        this.childNodes = [];
        const text = String(value ?? '');
        if (text) this.appendChild(new Text(this.ownerDocument, text));
    }
    set innerHTML(_) { throw new Error('fake DOM: innerHTML is not allowed in widgets'); }
    get innerHTML() { throw new Error('fake DOM: innerHTML is not allowed in widgets'); }
    set outerHTML(_) { throw new Error('fake DOM: outerHTML is not allowed in widgets'); }
    insertAdjacentHTML() { throw new Error('fake DOM: insertAdjacentHTML is not allowed in widgets'); }

    insertBefore(node, reference) {
        if (typeof node === 'string') node = new Text(this.ownerDocument, node);
        node.remove();
        node.parentNode = this;
        const index = reference ? this.childNodes.indexOf(reference) : -1;
        if (index < 0) this.childNodes.push(node);
        else this.childNodes.splice(index, 0, node);
        return node;
    }
    appendChild(node) { return this.insertBefore(node, null); }
    append(...nodes) { for (const node of nodes) this.appendChild(node); }
    prepend(node) { this.insertBefore(node, this.childNodes[0] ?? null); }
    replaceChildren(...nodes) {
        for (const node of this.childNodes) node.parentNode = null;
        this.childNodes = [];
        this.append(...nodes);
    }

    addEventListener(type, fn, options) {
        const capture = options === true || Boolean(options?.capture);
        const passive = typeof options === 'object' ? options.passive : undefined;
        this.listeners.push({ type, fn, capture, passive });
    }
    removeEventListener(type, fn, options) {
        const capture = options === true || Boolean(options?.capture);
        this.listeners = this.listeners.filter(entry => entry.type !== type || entry.fn !== fn || entry.capture !== capture);
    }
    /** Dispatches a fake event (capture down, target, bubble up); returns it. */
    dispatch(type, init = {}) {
        const event = {
            type, target: this, currentTarget: null, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; },
            ...init,
        };
        const path = [];
        for (let node = this; node; node = node.parentNode) path.push(node);
        const run = (node, phase) => {
            event.currentTarget = node;
            for (const entry of [...node.listeners]) {
                if (entry.type !== type) continue;
                if (phase === 'target' || entry.capture === (phase === 'capture')) entry.fn.call(node, event);
            }
        };
        for (const node of path.slice(1).reverse()) {
            run(node, 'capture');
            if (event.stopped) return event;
        }
        run(this, 'target');
        if (event.stopped) return event;
        for (const node of path.slice(1)) {
            run(node, 'bubble');
            if (event.stopped) break;
        }
        return event;
    }
    click() { return this.dispatch('click', { button: 0 }); }
    focus() { this.ownerDocument.activeElement = this; }

    getBoundingClientRect() {
        const rect = this.rect ?? { left: 0, top: 0, width: 0, height: 0 };
        return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top };
    }
    setPointerCapture(id) { this.captured.add(id); }
    releasePointerCapture(id) { this.captured.delete(id); }

    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector) {
        const chains = parse(selector);
        return this.descendants().filter(node => chains.some(chain => matchChain(node, chain, chain.length - 1)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
    /** Every listener on this element and its descendants (destroy() should leave none behind). */
    allListeners() { return [this, ...this.descendants()].flatMap(node => node.listeners); }
}

/** A fresh document installed on globalThis.document (with head, body, and an optional ResizeObserver). */
export function installDom({ resizeObserver = false } = {}) {
    const observers = [];
    const doc = {
        activeElement: null,
        createElement: tag => new Element(doc, tag),
        createElementNS: (ns, tag) => new Element(doc, tag, ns),
        createTextNode: text => new Text(doc, text),
        defaultView: {},
    };
    doc.head = new Element(doc, 'head');
    doc.body = new Element(doc, 'body');
    if (resizeObserver) {
        doc.defaultView.ResizeObserver = class {
            constructor(fn) { this.fn = fn; this.targets = []; this.connected = true; observers.push(this); }
            observe(target) { this.targets.push(target); }
            disconnect() { this.connected = false; this.targets = []; }
        };
    }
    doc.observers = observers;
    globalThis.document = doc;
    return doc;
}

/** A host element in the body, like the `<ss-widget>` the template renderer mounts into. */
export function host(doc) {
    const el = doc.createElement('ss-widget');
    doc.body.appendChild(el);
    return el;
}

/** A fake api recording commands and draft changes. */
export function fakeApi() {
    const commands = [];
    const drafts = [];
    return {
        commands,
        drafts,
        command(type, payload) { commands.push({ type, payload }); return Promise.resolve({ ok: true }); },
        preview() { return Promise.resolve({ ok: false }); },
        commit() { return Promise.resolve({ ok: false }); },
        query() { return null; },
        on() { return () => {}; },
        onDraft(name, value) { drafts.push({ name, value }); },
    };
}

export const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);
