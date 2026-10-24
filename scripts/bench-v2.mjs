// Story Suite v2 storage benchmark (docs/v2/PERFORMANCE.md). Not part of `npm test`: it takes about a
// minute. Run it from the repository root:
//
//   node scripts/bench-v2.mjs                     # 100, 1,000 and 3,000 replies, markdown tables
//   node scripts/bench-v2.mjs --replies 500       # one length only
//   node scripts/bench-v2.mjs --json out.json     # the raw numbers too
//
// It re-runs itself with --expose-gc so the cache memory can be measured. Timings are this machine's;
// sizes and save counts are exact (the run is deterministic).

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    breakdown, compactOps, everyCopy, measureLoad, measureSwipe, relayout, runScenario, sameHead, stripOldReceipts, v1Size,
} from '../tests/v2/bench/load.js';

if (typeof globalThis.gc !== 'function' && !process.execArgv.includes('--expose-gc')) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(child.status ?? 1);
}

const args = process.argv.slice(2);
const option = name => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : null;
};
const lengths = option('--replies') ? [Number(option('--replies'))] : [100, 1000, 3000];
const jsonOut = option('--json');

const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const size = bytes => (bytes >= 1024 * 1024 ? mb(bytes) : kb(bytes));
const ms = value => (value === null || value === undefined ? '–' : `${value.toFixed(2)} ms`);
const pct = (part, whole) => `${((100 * part) / whole).toFixed(0)}%`;

function table(head, rows) {
    const out = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
    for (const row of rows) out.push(`| ${row.join(' | ')} |`);
    return out.join('\n');
}

const print = text => process.stdout.write(`${text}\n`);
const started = Date.now();
const max = Math.max(...lengths);
print(`# Story Suite v2 storage benchmark (${lengths.join(', ')} replies)\n`);
print(`Node ${process.version}, ${process.platform}/${process.arch}.\n`);

const run = await runScenario({ replies: max, snapshots: lengths, repeat: 5 });
const snaps = run.snapshots;
const spread = await runScenario({ replies: Math.min(100, max), uiSpacing: 'spread', repeat: 1 });

print('## Chat size\n');
print(table(['Replies', 'Chat file', 'storySuite records', 'share', 'v1 (3 KB block per reply)', 'v2 / v1'], snaps.map(s => [
    s.replies, size(s.bytes.file), size(s.bytes.records), pct(s.bytes.records, s.bytes.file), size(s.v1.file), `${(s.bytes.file / s.v1.file).toFixed(2)}×`,
])));
print('');

print('## Bytes per reply (storySuite records, both copies)\n');
const per = s => s.bytes.records / s.replies;
print(table(['Replies', 'All', 'checkpoints', 'ops', 'receipts', '(of which data)', '(of which summary)', 'other fields', 'hidden change text', 'v1 block (mes + swipe)'], snaps.map(s => {
    const n = s.replies;
    return [n, kb(per(s)), kb(s.bytes.checkpoint / n), kb(s.bytes.ops / n), kb(s.bytes.receipts / n), kb(s.bytes.receiptData / n), kb(s.bytes.receiptSummary / n), kb(s.bytes.other / n), kb(s.bytes.changeText / n), kb(s.v1.perReply)];
})));
print('');

print('## Checkpoints\n');
print(table(['Replies', 'Count', 'Median size', 'Largest', 'All (one copy)', 'Head state', 'Carriers replayed at load'], snaps.map(s => [
    s.replies, s.checkpoints.count, kb(s.checkpoints.median), kb(s.checkpoints.max), size(s.checkpoints.sum), kb(s.load.headBytes), s.load.sinceCheckpoint,
])));
print('');

print('## Saves\n');
const last = snaps.at(-1);
print(table(['UI clicks', 'Saves per reply (mean)', 'Most in one reply', 'Capture saves', 'UI saves (flushed at generation start or on their own)'], [
    ['burst (3 clicks within 400 ms)', last.savesPerReply.mean.toFixed(2), last.savesPerReply.max, last.saves.capture, last.saves.pre + last.saves.ui],
    ['spread (each click saved alone)', spread.snapshots[0].savesPerReply.mean.toFixed(2), spread.snapshots[0].savesPerReply.max, spread.saves.capture, spread.saves.pre + spread.saves.ui],
]));
print('\nThese are Story Suite\'s own saves; SillyTavern saves the chat itself on top of them (see PERFORMANCE.md).\n');

print('## Time (last 100 replies before each length)\n');
print(table(['Replies', 'Before reply (median / p95)', 'Capture of 5 lines (median / p95)', 'UI command (median / p95)', 'JSON.parse of the chat', 'Head rebuild at load', 'Longest replay (a whole interval)', 'Rebuild after swipe', 'Swipe back', 'Swipe rolls back'], snaps.map(s => [
    s.replies, `${ms(s.preMs.median)} / ${ms(s.preMs.p95)}`, `${ms(s.captureMs.median)} / ${ms(s.captureMs.p95)}`, `${ms(s.commandMs.median)} / ${ms(s.commandMs.p95)}`,
    ms(s.load.parseMs), ms(s.load.rebuildMs.median), ms(s.load.worstMs.median), ms(s.swipe.swipeMs.median), ms(s.swipe.backMs.median), s.swipe.sameAsBefore ? 'yes' : 'NO',
])));
print('');

print('## Memory of the caches\n');
print(table(['Replies', 'Heap held by a built store (head + checkpoint copy)', 'Head state JSON', 'Checkpoint JSON'], snaps.map(s => [
    s.replies, s.load.heapBytes === null ? '–' : kb(s.load.heapBytes), kb(s.load.headBytes), kb(s.load.checkpointBytes),
])));
print('');

// ---------- tuning, on the longest chat ----------

const chat = run.chat;
const base = breakdown(chat);
print(`## Tuning experiments (on the ${max}-reply chat)\n`);
print('### Checkpoint rule\n');
const rules = [[20, 32], [50, 64], [100, 128], [200, 256]];
const ruleRows = [];
for (const [every, limit] of rules) {
    const laid = relayout(chat, { every, bytes: limit * 1024 });
    const sizes = breakdown(laid);
    const load = measureLoad(laid, { repeat: 11 });
    const swipe = measureSwipe(laid, { repeat: 11 });
    ruleRows.push([`${every} replies / ${limit} KB`, sizes.checkpoints.length, kb(sizes.checkpoint / max), size(sizes.file), ms(load.rebuildMs.median), ms(load.worstMs.median), ms(swipe.swipeMs.median), sameHead(chat, laid) ? 'yes' : 'NO']);
}
print(table(['Rule (every / ops bytes)', 'Checkpoints', 'Checkpoint bytes per reply', 'Chat file', 'Rebuild at load', 'Longest replay (a whole interval)', 'Rebuild after swipe', 'Same head'], ruleRows));
print('');

print('### Other layouts (as built, what it was before, what was left out)\n');
// As built: checkpoints every 100 carriers / 128 KB, each record kept once, receipts 200 carriers back
// without data. "Before" puts back what the storage tuning took out, one part at a time.
const variants = [
    ['as built', chat],
    ['before: a copy in swipe_info on every reply', everyCopy(chat)],
    ['before: checkpoints every 20 / 32 KB', relayout(chat, { every: 20, bytes: 32 * 1024 })],
    ['not adopted: ops compacted (one /meta/rev per carrier, no replace overwritten later)', compactOps(chat)],
    ['not adopted: old receipts\' summary emptied too', stripOldReceipts(chat, { keep: 200, summaries: true })],
];
const v1 = v1Size(chat);
print(table(['Variant', 'Chat file', 'storySuite records', 'per reply', 'vs v1 file', 'Same head'], variants.map(([name, variant]) => {
    const sizes = breakdown(variant);
    return [name, size(sizes.file), size(sizes.records), kb(sizes.records / max), `${(sizes.file / v1.file).toFixed(2)}×`, sameHead(chat, variant) ? 'yes' : 'NO'];
})));
print('');

print('### Bytes written per reply (SillyTavern rewrites the whole file on every save)\n');
const written = (file, saves) => size(file * saves);
const capture = last.savesPerReply.mean;
print(table(['At reply ' + max, 'File (bytes per save)', 'Story Suite saves', '+ SillyTavern\'s own save', '+ one backup copy', 'Total per reply'], [
    ['v1 (3 KB block)', size(v1.file), '–', written(v1.file, 1), written(v1.file, 1), written(v1.file, 2)],
    ['v2 as built', size(base.file), written(base.file, capture), written(base.file, 1), written(base.file, 1), written(base.file, capture + 2)],
]));
print('');

if (run.problems.length) print(`Problems during the run: ${run.problems.length}; first: ${run.problems[0]}\n`);
print(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`);

if (jsonOut) {
    const strip = ({ head, ...rest }) => rest;
    writeFileSync(jsonOut, JSON.stringify({ snapshots: snaps.map(strip), spread: spread.snapshots.map(strip), rules: ruleRows }, null, 2));
}
