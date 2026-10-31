// A plain Story Block flow (the core module, no data module pinned) and its fingerprint: every prompt it builds, the
// size of every draw of randomness in order, the model calls it makes and the receipts it stores. The Lean RPG being
// off must leave all of that as it was in 2.7.2 (fixtures/off-2.7.2.json was made from the code before the Lean RPG).
import { createHash } from 'node:crypto';

const sha = text => createHash('sha256').update(text).digest('hex');

/** `createHost` of the checkout to measure (the testkit's), → the fingerprint. `prepare(host)` may change the host first (a feature on). */
export async function fingerprint(createHost, prepare = null) {
    const draws = [];
    const real = globalThis.crypto;
    const counting = new Proxy(real, {
        get(target, key) {
            if (key === 'getRandomValues') return array => { draws.push(`${array.constructor.name}${array.length}`); return target.getRandomValues(array); };
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    Object.defineProperty(globalThis, 'crypto', { value: counting, configurable: true });
    const calls = [];
    let host = null;
    try {
        host = await createHost({ callModel: async prompt => { calls.push(prompt); return 'none'; } });
        await prepare?.(host);
        const prompts = [];
        const note = async run => { const { request } = await run(); prompts.push(sha(request.chat.map(message => `${message.role}:${message.content}`).join('\n'))); };
        await note(() => host.send('I walk into the drain.', 'Dark. <Changes>\n~ place Drain | kind: ruin\n+ present Ren\n</Changes>'));
        await note(() => host.send('I hit the lead rat with Iron Breath.', 'The rats scatter.'));
        await note(() => host.swipe('Another telling.'));
        await note(() => host.regenerate('A third telling.'));
        await host.turn.reread(2);
        await host.turn.reread(4);
        const receipts = host.ctx.chat.map(message => (message.extra?.storySuite?.receipts ?? []).map(receipt => [receipt.type, receipt.cause, receipt.narrate, receipt.summary]));
        return { prompts, draws: draws.length, drawn: sha(draws.join(',')), calls: calls.length, receipts, domains: Object.keys(host.head().domains), rev: host.head().meta.rev };
    } finally {
        host?.close();
        Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
    }
}
