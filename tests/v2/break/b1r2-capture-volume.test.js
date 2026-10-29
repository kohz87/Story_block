// b1-capture round 2, B-b1r2-4: each change line cost time in proportion to the whole domain it drafted
// (a copy, a diff and a read of the whole slice; ctx.query copied the whole state), so a 150-line reply
// after 750 story items took 6–30 s. The bus now reads the head's own frozen state and diffs only what
// changed (tests/v2/state-views.test.js holds it to the old ops).
//
// The bounds are counted work, not wall-clock time, so a loaded machine cannot fail them (as RB #105 did for
// B4-12): while the reply is captured, every key Object.keys/entries/values hands out is counted (the copies,
// diffs, freezes, checks and look-ups all walk objects that way), and every node given to structuredClone.
// - The key budget is the old time bound at the reference rate (about 8.5 million keys a second for this
//   capture unloaded: 6 s ≈ 50 million, so 40 million; 3 s → 12 million for the first test).
// - structuredClone gets at most 100 nodes per line, whatever the state holds: no line copies the state.
// - Backstop: the fastest of three captures of the same reply (the reply, then two swipes to the same text)
//   is checked against a same-run plain capture and a 10 s ceiling; the separate 6 s case is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { assertCaptureTiming, plainCaptureBaseline } from './capture-timing.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const CLONE_PER_LINE = 100;

async function fresh(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

function nodes(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return 0;
    seen.add(value);
    let n = 1;
    for (const key in value) n += nodes(value[key], seen);
    return n;
}

// Runs fn() counting the work it does: { keys, clone, ms }. The globals are put back however fn ends.
async function counted(fn) {
    const work = { keys: 0, clone: 0, ms: 0 };
    const original = { keys: Object.keys, entries: Object.entries, values: Object.values, structuredClone: globalThis.structuredClone };
    const tally = list => { work.keys += list.length; return list; };
    Object.keys = value => tally(original.keys(value));
    Object.entries = value => tally(original.entries(value));
    Object.values = value => tally(original.values(value));
    globalThis.structuredClone = (value, options) => { work.clone += nodes(value); return original.structuredClone(value, options); };
    const started = performance.now();
    try {
        await fn();
    } finally {
        work.ms = performance.now() - started;
        Object.keys = original.keys;
        Object.entries = original.entries;
        Object.values = original.values;
        globalThis.structuredClone = original.structuredClone;
    }
    return work;
}

// An empty reply (its clones are the base), then the reply (counted), then the same text captured again
// twice by swiping: → { work, perLineClone, fastest }.
async function measure(host, text, lines) {
    const base = await counted(() => host.send('Nothing.', reply('Quiet.', [])));
    const work = await counted(() => host.send('More.', text));
    const times = [work.ms];
    for (let i = 0; i < 2; i += 1) {
        const started = performance.now();
        await host.swipe(text);
        times.push(performance.now() - started);
    }
    return { work, perLineClone: Math.max(0, work.clone - base.clone) / lines, fastest: Math.min(...times) };
}

test('a 150-line reply after five such replies stays within its counted and relative budgets', async t => {
    const baseline = await plainCaptureBaseline();
    const host = await fresh(t);
    let k = 0;
    for (let r = 0; r < 5; r += 1) await host.send('More.', reply('Things.', Array.from({ length: 150 }, () => `+ item Thing ${k += 1}`)));
    const { work, perLineClone, fastest } = await measure(host, reply('Things.', Array.from({ length: 150 }, () => `+ item Thing ${k += 1}`)), 150);
    t.diagnostic(`sixth reply: ${work.keys} keys, ${perLineClone.toFixed(1)} cloned nodes a line, fastest of 3: ${Math.round(fastest)} ms; baseline ${Math.round(baseline)} ms`);
    assert.ok(work.keys < 12_000_000, `the sixth reply walked ${work.keys} keys`);
    assert.ok(perLineClone <= CLONE_PER_LINE, `${perLineClone} nodes cloned per line`);
    assertCaptureTiming(fastest, baseline);
});

// The story's own replies may bring only 10 new kinds of item each now (r2-2), so the inventory here is
// filled the way a long story fills it, through a module's grants; then one reply names 150 of them.
test('a 150-line reply over 900 items the party holds stays inside the old 6 s budget, counted', async t => {
    const filler = {
        id: 'filler', name: 'Filler', version: '2.0.0-alpha.1',
        commands: {
            'filler.fill'(ctx, { from, n }) {
                for (let i = from; i < from + n; i += 1) ctx.call('inventory.grant', { name: `Thing ${i}`, owner: 'party' });
                return { summary: `${n} things.` };
            },
        },
    };
    const host = await fresh(t, { modules: [filler] });
    for (let from = 0; from < 900; from += 300) assert.equal((await host.sdk.command('filler.fill', { from, n: 300 })).ok, true);
    assert.equal(Object.keys(host.head().domains.inventory.stacks).length, 900);
    const { work, perLineClone, fastest } = await measure(host, reply('Things.', Array.from({ length: 150 }, (_, i) => `+ item Thing ${i * 6}`)), 150);
    t.diagnostic(`150 lines over 900 items: ${work.keys} keys, ${perLineClone.toFixed(1)} cloned nodes a line, fastest of 3: ${Math.round(fastest)} ms`);
    const held = host.sdk.query('inventory.items').filter(item => item.qty === 2).length;
    assert.equal(held, 150, 'every line was taken (and taken again, not twice, by each swipe)');
    assert.ok(work.keys < 40_000_000, `the reply walked ${work.keys} keys`);
    assert.ok(perLineClone <= CLONE_PER_LINE, `${perLineClone} nodes cloned per line`);
    assert.ok(fastest < 6000, `the fastest capture took ${Math.round(fastest)} ms`);
});
