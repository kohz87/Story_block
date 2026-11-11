// The redraw hold: a form with several steps (the Inventory item form) holds the screens' redraw from `committed` events until its plan
// ends, so the form stays alive for every step and shows a refusal; the held redraws then run once each. Held work is keyed, so
// the same listener held twice runs once.

export function createHold() {
    let holds = 0;
    const queued = new Map();
    const flush = () => { const run = [...queued.values()]; queued.clear(); for (const fn of run) fn(); };
    return {
        /** → a release function (safe to call twice); the last release runs what was held. */
        hold() {
            holds += 1;
            let done = false;
            return () => { if (done) return; done = true; holds -= 1; if (!holds) flush(); };
        },
        /** Runs `fn` now, or after the last release when held. */
        run(key, fn) { if (holds) queued.set(key, fn); else fn(); },
        /** Forgets what was held for `key` (its listener went away). */
        drop(key) { queued.delete(key); },
    };
}
