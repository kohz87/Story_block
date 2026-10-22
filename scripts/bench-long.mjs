// Story Suite v2 long-chat benchmark (docs/v2/PERFORMANCE.md, "Long chats"). Not part of `npm test`.
//
//   node scripts/bench-long.mjs                  # 1,500 replies, a row per 250
//   node scripts/bench-long.mjs --replies 600    # another length
//
// The storage benchmark's load (tests/v2/bench/load.js: Story Block's core module and Bench RPG, 5 change
// lines a reply, 3 reader actions every 4 replies), but saved the way SillyTavern saves it: through a chat
// file (`/api/chats/save`, a stand-in fetch that counts the requests and their bytes), with a clock of its
// own, so the turn's idle save (persist.js IDLE_MS) runs as in a browser without the benchmark waiting: the
// reader acts 300 ms apart after a reply, then reads for 3 s before the next. Per window it prints Story
// Block's saves per reply and bytes uploaded per reply (SillyTavern's own two saves per reply come on top),
// the median time of the prompt build (interceptor) and of the capture, and the store's replay work per
// reply (store.work()). Saves, bytes and work are exact (the run is deterministic); times are this machine's.

import { performance } from 'node:perf_hooks';
import { UI_EVERY, createBenchModule, replyText, sendFast, uiCommands, userText } from '../tests/v2/bench/load.js';
import { createHost } from '../testkit/index.js';

const args = process.argv.slice(2);
const option = name => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : null;
};
const replies = Number(option('--replies') ?? 1500);
const every = Number(option('--every') ?? 250);

// The clock: timers run when the benchmark moves it on.
let now = 0;
let seq = 0;
const due = new Map();
globalThis.setTimeout = (fn, ms = 0, ...rest) => {
    const job = { id: ++seq, at: now + Math.max(0, Number(ms) || 0), fn: () => fn(...rest), unref() { return this; }, ref() { return this; } };
    due.set(job.id, job);
    return job;
};
globalThis.clearTimeout = job => { if (job && typeof job === 'object') due.delete(job.id); };
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
async function advance(ms) {
    const end = now + ms;
    for (;;) {
        let next = null;
        for (const job of due.values()) if (job.at <= end && (!next || job.at < next.at || (job.at === next.at && job.id < next.id))) next = job;
        if (!next) break;
        due.delete(next.id);
        now = next.at;
        next.fn();
        await settle();
    }
    now = end;
    await settle();
}

const host = await createHost({ modules: [createBenchModule()], st: { greeting: 'The story begins.' } });
const { st, ctx, store, bus, sdk } = host;
let saves = 0;
let bytes = 0;
ctx.getRequestHeaders = () => ({});
ctx.characters = [{ name: 'Narrator', avatar: 'narrator.png' }];
ctx.characterId = 0;
globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/chats/save')) {
        saves += 1;
        bytes += init.body.length;
    }
    return { ok: true, status: 200, json: async () => (String(url).includes('/get') ? [] : { ok: true }) };
};
const seeded = bus.command('bench.seed', {}, { cause: 'system' });
if (!seeded.ok) throw new Error(`bench: the seed command failed: ${seeded.message}`);
await store.flush();

const build = [];
const capture = [];
const interceptor = st.interceptor;
st.interceptor = async (...rest) => {
    const start = performance.now();
    try { await interceptor(...rest); } finally { build.push(performance.now() - start); }
};
let received = 0;
st.eventSource.makeFirst(ctx.eventTypes.MESSAGE_RECEIVED, () => { received = performance.now(); });
sdk.on('turn', () => capture.push(performance.now() - received));

const median = list => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted.length ? sorted[sorted.length >> 1] : 0;
};
const rows = [];
// store.work() counts replay work (older versions of the store do not have it: shown as –).
const workNow = () => store.work?.() ?? null;
let window = { saves: 0, bytes: 0, replies: 0, work: workNow() };
for (let n = 1; n <= replies; n++) {
    const before = { saves, bytes };
    await sendFast(host, userText(n), replyText(n));
    await advance(500);
    if (n % UI_EVERY === 0) {
        for (const { type, payload } of uiCommands(n)) {
            await sdk.command(type, payload);
            await advance(300);
        }
    }
    await advance(3000);
    window.saves += saves - before.saves;
    window.bytes += bytes - before.bytes;
    window.replies += 1;
    if (n % every === 0 || n === replies) {
        const work = workNow();
        const per = key => (work ? ((work[key] - window.work[key]) / window.replies).toFixed(2) : '–');
        rows.push([n, (JSON.stringify(ctx.chat).length / 1e6).toFixed(2), (window.saves / window.replies).toFixed(2),
            (window.bytes / window.replies / 1e6).toFixed(2), median(build.slice(-window.replies)).toFixed(1),
            median(capture.slice(-window.replies)).toFixed(1), per('replays'), per('recordsRead'), per('lineScans')]);
        window = { saves: 0, bytes: 0, replies: 0, work };
    }
}
await advance(20000);
host.close();

const head = ['Replies', 'Chat file MB', 'Story Block saves / reply', 'MB uploaded / reply', 'Build ms (median)', 'Capture ms (median)', 'Replays / reply', 'Records replayed / reply', 'Whole-chat passes / reply'];
process.stdout.write(`# Story Suite v2 long-chat benchmark (${replies} replies)\n\nNode ${process.version}, ${process.platform}/${process.arch}.\n\n`);
process.stdout.write(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n`);
for (const row of rows) process.stdout.write(`| ${row.join(' | ')} |\n`);
process.stdout.write(`\nUnsaved at the end: ${store.dirty() ? 'yes' : 'no'}. SillyTavern saves the chat itself twice per reply on top (the reader's message, the reply).\n`);
