// Stand-ins for the assist tests: a scripted model, a hand-driven timer, a chat and the settings.

import { SETTING } from '../../../../src/v2/assist/common.js';

/**
 * fakeModel(answers): a callModel that answers from `answers` in order (a string, an Error to throw,
 * a function (prompt) → answer, or NEVER to hang). `calls` records { prompt, options }.
 */
export const NEVER = Symbol('never answers');
export function fakeModel(...answers) {
    const calls = [];
    const callModel = async (prompt, options) => {
        calls.push({ prompt, options });
        const next = answers.length > 1 ? answers.shift() : answers[0];
        if (next === NEVER) return new Promise(() => {});
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next(prompt) : next;
    };
    callModel.calls = calls;
    return callModel;
}

/** A timer whose callbacks run only when the test calls fire(). */
export function manualTimer() {
    const pending = new Map();
    let next = 0;
    return {
        set(fn, ms) {
            next += 1;
            pending.set(next, { fn, ms });
            return next;
        },
        clear(handle) { pending.delete(handle); },
        fire() {
            const all = [...pending.values()];
            pending.clear();
            for (const entry of all) entry.fn();
        },
        get waiting() { return pending.size; },
        get lastMs() { return [...pending.values()].at(-1)?.ms ?? null; },
    };
}

export const user = mes => ({ is_user: true, name: 'You', mes });
export const reply = mes => ({ is_user: false, name: 'Narrator', mes, swipe_id: 0, swipes: [mes] });

export function on({ classifier = false, extractor = false, profile = '' } = {}) {
    return { [SETTING.classifier]: classifier, [SETTING.extractor]: extractor, [SETTING.profile]: profile };
}

/** A view as turn.js makes it (state, settings), enough for beforeGenerate. */
export function view({ claims = {}, settings = on() } = {}) {
    return Object.freeze({
        state: { v: 2, meta: { rev: 0, claims }, domains: {} },
        query: () => null,
        settings: () => settings,
        chat: { length: 0, lastUser: '' },
    });
}

export const flush = () => new Promise(resolve => setImmediate(resolve));
