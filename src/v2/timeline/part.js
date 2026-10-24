// The timeline's part of the core module (domains/index.js merges it like the others): the two save-point commands, the
// list query and the host's replayGuard.
// * `savepoint.make` is a public name whose work is asynchronous (participants' checkpoints): sdk.command routes it to the
//   timeline (sdk.js). Straight at the command bus it is REFUSED, as is `savepoint.restore`, which is internal and runs only
//   as a block the coordinator stores after a prepared restore (never a command handler: it writes every module's domain).
// * `savepoint.list({})` → the eligible save points in target order.
// * `hooks.replayGuard` answers for the host's own blocks (coordinator.js guard).

const refuse = what => ctx => ctx.fail('REFUSED', what);

/** createTimelinePart({ timeline }): `timeline()` → the runtime's timeline (late-bound), or null. */
export function createTimelinePart({ timeline = () => null } = {}) {
    const current = () => {
        try { return timeline() ?? null; } catch { return null; }
    };
    return {
        commands: {
            'savepoint.make': refuse('A save point is made by the timeline (sdk.command), which waits for the participants; the command bus cannot make one.'),
            'savepoint.restore': { handler: refuse('A restore is a block only the host stores, after it prepared one; no command can run it.'), internal: true },
        },
        queries: {
            'savepoint.list': state => current()?.points(state) ?? Object.values(state?.domains?.savepoints?.points ?? {}),
        },
        hooks: {
            replayGuard: (view, info) => {
                const line = current();
                return line ? line.guard(view, info) : { ok: false, reason: 'the timeline is not running, so the host\'s save points cannot be checked' };
            },
        },
    };
}
