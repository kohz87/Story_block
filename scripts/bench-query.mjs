// Query burst benchmark (docs/v2/PERFORMANCE.md, "Queries on an unchanged chat"). Not part of `npm test`.
//
//   node scripts/bench-query.mjs                  # 600 replies, a burst of 50 queries
//   node scripts/bench-query.mjs --replies 300 --queries 100
//   node --expose-gc scripts/bench-query.mjs --replies 600 --boundaries 600   # a native change after every reply (memory too)
//
// A long chat with native (timeline) boundaries (one, or `--boundaries N`: a change after each of the first N replies), then the burst a dossier open makes: many `sdk.query` calls on state that
// has not changed. Prints the time of the first query, of the whole burst, and the store's replays (store.work()).
// Replays are exact; times are this machine's.

import { performance } from 'node:perf_hooks';
import { createHost } from '../testkit/index.js';
import { NATIVE, clone, nativeModule, rulesModule } from '../tests/v2/helpers/timeline.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? Number(args[at + 1]) : fallback;
};
const replies = option('--replies', 600);
const queries = option('--queries', 50);
const boundaries = option('--boundaries', 1);

const native = nativeModule();
const host = await createHost({ modules: [rulesModule(), native.def] });
const mutate = async n => {
    const head = await host.sdk.timeline.head();
    const made = await native.native.handle.nativeMutation({
        participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head.headHash,
        prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = 10 + (n % 80);
            const after = native.native.keep(next);
            native.native.prepared[`pr_bench${n}`] = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: `pr_bench${n}` };
        },
    });
    if (!made.ok) throw new Error(`The benchmark's native change ${n} was refused: ${made.message}`);
};
for (let i = 0; i < replies; i++) {
    await host.send(`Hello ${i}.`, `Reply ${i}.`);
    if (i < boundaries) await mutate(i);
}
const heap = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed / 1048576; };
const heapBefore = heap();

const replaysBefore = host.store.work().replays;
const start = performance.now();
host.sdk.query('savepoint.contract');
const first = performance.now() - start;
for (let i = 1; i < queries; i++) host.sdk.query('savepoint.contract');
const total = performance.now() - start;
const witnesses = host.store.witnessMemoSize?.() ?? 0;
const heapAfter = heap();
console.log(`${replies} replies, ${boundaries} boundaries, ${queries} queries: first ${first.toFixed(1)} ms, burst ${total.toFixed(1)} ms, replays ${host.store.work().replays - replaysBefore}, witnesses kept ${witnesses}, heap +${(heapAfter - heapBefore).toFixed(1)} MB${globalThis.gc ? '' : ' (run with --expose-gc)'}`);
await host.close();
