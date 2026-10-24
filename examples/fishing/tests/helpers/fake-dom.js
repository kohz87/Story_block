// A very small fake DOM for the widget tests: just what renderFishing uses (createElement, className,
// textContent, attributes, append / replaceChildren, click and change listeners, value, disabled),
// plus find helpers. No dependencies.

class FakeNode {
    constructor(doc, tag) {
        this.ownerDocument = doc;
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = {};
        this.listeners = {};
        this.className = '';
        this.disabled = false;
        this.value = '';
        this._text = '';
    }
    get textContent() {
        return this._text + this.children.map(c => c.textContent).join('');
    }
    set textContent(text) {
        this.children = [];
        this._text = String(text);
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }
    getAttribute(name) {
        return name in this.attributes ? this.attributes[name] : null;
    }
    append(...nodes) {
        for (const n of nodes) {
            n.parentNode = this;
            this.children.push(n);
        }
    }
    replaceChildren(...nodes) {
        this.children = [];
        this._text = '';
        this.append(...nodes);
    }
    addEventListener(type, fn) {
        (this.listeners[type] ??= []).push(fn);
    }
    dispatch(type) {
        return Promise.all((this.listeners[type] ?? []).map(fn => fn({ type, target: this })));
    }
    async click() {
        if (this.disabled) return;
        await this.dispatch('click');
    }
    *walk() {
        yield this;
        for (const c of this.children) yield* c.walk();
    }
    /** First descendant matching a predicate, or an attribute test like ['data-act', 'cast']. */
    find(test) {
        const match = typeof test === 'function' ? test : n => n.getAttribute(test[0]) === test[1];
        for (const n of this.walk()) if (n !== this && match(n)) return n;
        return null;
    }
    findAll(test) {
        const match = typeof test === 'function' ? test : n => n.getAttribute(test[0]) === test[1];
        return [...this.walk()].filter(n => n !== this && match(n));
    }
}

export function createDocument() {
    const doc = { createElement: tag => new FakeNode(doc, tag) };
    return doc;
}

export function mount() {
    const doc = createDocument();
    return doc.createElement('div');
}

/** Fake timers for the widget: now() and setTimeout run only when `advance(ms)` moves the clock. */
export function fakeTimers() {
    let now = 0;
    let next = 1;
    const queue = new Map();
    return {
        now: () => now,
        setTimeout(fn, ms) {
            const id = next++;
            queue.set(id, { at: now + ms, fn });
            return id;
        },
        clearTimeout(id) {
            queue.delete(id);
        },
        async advance(ms) {
            const end = now + ms;
            for (;;) {
                const due = [...queue.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                queue.delete(due[0]);
                now = due[1].at;
                await due[1].fn();
                await flush();
            }
            now = end;
        },
        pending: () => queue.size,
    };
}

/** Let awaited promises settle. */
export async function flush() {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
}
