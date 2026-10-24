// The shared fake DOM (tests/ui-fake-dom.js) with markup parsing made a test failure:
// any innerHTML / outerHTML / insertAdjacentHTML from the layout renderer throws.

import { installFakeDom, FakeElement } from '../../../ui-fake-dom.js';

const forbid = name => () => { throw new Error(`layout code used ${name}`); };
Object.defineProperty(FakeElement.prototype, 'innerHTML', { configurable: true, get: forbid('innerHTML'), set: forbid('innerHTML') });
Object.defineProperty(FakeElement.prototype, 'outerHTML', { configurable: true, get: forbid('outerHTML'), set: forbid('outerHTML') });
FakeElement.prototype.insertAdjacentHTML = forbid('insertAdjacentHTML');

export function mount() {
    const doc = installFakeDom();
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    return { doc, host };
}

/** A query function over fixed answers, recording each call. */
export function fakeQuery(answers) {
    const calls = [];
    const query = (name, args) => {
        calls.push([name, args]);
        if (!Object.hasOwn(answers, name)) throw new Error(`no query ${name}`);
        const answer = answers[name];
        return typeof answer === 'function' ? answer(args) : answer;
    };
    query.calls = calls;
    return query;
}

export const layoutOf = (root, extra = {}) => ({ id: 'test', title: 'Test', icon: 'fa-box', root, ...extra });

export const one = (root, selector) => {
    const found = root.querySelectorAll(selector);
    if (found.length !== 1) throw new Error(`expected one ${selector}, found ${found.length}`);
    return found[0];
};

// Lets awaited command promises settle.
export const settle = () => new Promise(resolve => setImmediate(resolve));
