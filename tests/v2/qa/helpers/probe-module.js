// A small module for the QA tests, registered next to Story Block's core module on the real host.
// It exercises what the core module alone does not: a narrated UI command, a one-time claim that
// pays through another module's command, a handler that writes and then refuses, and a change-line
// kind that claims per name and is narrated by the next reply.

export const PROBE_ID = 'qa-probe';
export const BONUS_CLAIM = 'probe:bonus';
export const BONUS = 5;

/** `cues: true` adds the beforeGenerate cue (the fuzz uses it; directed tests count receipts exactly). */
export function probeModule({ cues = false } = {}) {
    const def = {
        id: PROBE_ID,
        name: 'QA Probe',
        version: '0.0.0',
        domains: {
            probe: {
                initial: () => ({ n: 0, seen: [] }),
                validate: slice => {
                    const errors = [];
                    if (!Number.isInteger(slice.n) || slice.n < 0) errors.push('n must be a whole number of 0 or more');
                    if (!Array.isArray(slice.seen) || slice.seen.some(word => typeof word !== 'string')) errors.push('seen must be a list of words');
                    return errors;
                },
            },
        },
        commands: {
            'probe.tick'(ctx) {
                const probe = ctx.draft('probe');
                probe.n += 1;
                return { summary: `Tick ${probe.n}.`, narrate: true };
            },
            'probe.pay'(ctx) {
                if (!ctx.claim(BONUS_CLAIM)) ctx.fail('CLAIMED', 'The bonus was already paid on this line of the story.');
                ctx.call('wallet.receive', { owner: 'party', amount: BONUS, note: 'bonus' });
                return { summary: `A bonus of ${BONUS} is paid.`, narrate: true };
            },
            // A cue the host commits before a reply (beforeGenerate → system receipt on the head carrier).
            'probe.cue'(ctx, { n }) {
                if (!ctx.claim(`probe:cue:${n}`)) ctx.fail('CLAIMED', `Cue ${n} was already given.`);
                return { summary: `Cue ${n}.`, narrate: true };
            },
            // Writes, then refuses: nothing of it may be stored.
            'probe.broken'(ctx) {
                ctx.draft('probe').n += 100;
                ctx.fail('REFUSED', 'The probe refuses on purpose.');
            },
        },
        queries: {
            'probe.n': state => state?.domains?.probe?.n ?? null,
        },
        capture: {
            kinds: { probe: { grammar: '! probe Word' } },
            apply(ctx, line) {
                const word = String(line.name ?? '').trim();
                if (!ctx.claim(`probe:seen:${word.toLowerCase()}`)) ctx.fail('CLAIMED', `${word} was already seen on this line of the story.`);
                ctx.draft('probe').seen.push(word);
                return { summary: `${word} was seen.`, narrate: true };
            },
        },
        hooks: {
            // Every third tick count asks for a cue once (§4.1 step 3), so cues land on head carriers
            // while they are swiped, regenerated and continued.
            beforeGenerate(view) {
                const n = view.state?.domains?.probe?.n ?? 0;
                const claims = view.state?.meta?.claims ?? {};
                if (n % 3 !== 1 || Object.hasOwn(claims, `probe:cue:${n}`)) return [];
                return { commands: [{ type: 'probe.cue', payload: { n } }] };
            },
        },
        context: {
            static: () => 'QA probe: write ! probe Word when a probe word appears.',
            tail: view => ({ lines: [`[Probe] ticks ${view.state?.domains?.probe?.n ?? 0}`], optional: [] }),
            budget: 50,
        },
    };
    if (!cues) delete def.hooks;
    return def;
}
