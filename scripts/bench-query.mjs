// Query burst benchmark (docs/v2/PERFORMANCE.md, "Queries on an unchanged chat"). Not part of `npm test`.
//
//   node scripts/bench-query.mjs                  # 600 replies, a burst of 50 queries
//   node scripts/bench-query.mjs --replies 300 --queries 100
//
// A long chat with one native (timeline) boundary, then the burst a dossier open makes: many `sdk.query` calls on state that
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

const native = nativeModule();
const host = await createHost({ modules: [rulesModule(), native.def] });
for (let i = 0; i < replies; i++) await host.send(`Hello ${i}.`, `Reply ${i}.`);
const head = await host.sdk.timeline.head();
const made = await native.native.handle.nativeMutation({
    participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head.headHash,
    prepare: async () => {
        const before = native.native.checkpoint();
        const next = clone(native.native.store);
        next.dossiers.tavi.trust = 9;
        const after = native.native.keep(next);
        native.native.prepared.pr_bench001 = { checkpoint: after.checkpoint };
        return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_bench001' };
    },
});
if (!made.ok) throw new Error(`The benchmark's native change was refused: ${made.message}`);

const replaysBefore = host.store.work().replays;
const start = performance.now();
host.sdk.query('savepoint.contract');
const first = performance.now() - start;
for (let i = 1; i < queries; i++) host.sdk.query('savepoint.contract');
const total = performance.now() - start;
console.log(`${replies} replies, ${queries} queries: first ${first.toFixed(1)} ms, burst ${total.toFixed(1)} ms, replays ${host.store.work().replays - replaysBefore}`);
await host.close();
