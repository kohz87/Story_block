// Story Suite v2 storage benchmark (docs/v2/PERFORMANCE.md): a whole host from the testkit with the core
// module plus a synthetic module shaped like RPG Battle and Story Director, driven through a long chat.
//
// The load, per the performance brief: a party of 4, 60 inventory stacks, 40 Director threads, 5 change
// lines per reply (an item, a coin, an HP change, a thread change, the clock) and 3 UI commands every 4
// replies. Everything is deterministic (fixed IDs, fixed text), so two runs store the same bytes; only
// the timings vary.
//
// What it measures (`runScenario`): the chat's JSON size as SillyTavern would write it, the bytes the
// storySuite records add per reply, checkpoints, how many saves each reply costs, the time of a head
// rebuild after a chat load and after a swipe of the last reply, the time of each capture and each UI
// command, and the memory the store's caches hold. `relayout` and `compactOps` replay a finished chat
// under other checkpoint and op rules, for the tuning tables; they change nothing in the runtime.
//
// tests/v2/bench/smoke.test.js runs a short version in `npm test`; scripts/bench-v2.mjs runs the full one.

import { performance } from 'node:perf_hooks';
import { MAIN_PROMPT, aiMessage, createHost } from '../../../testkit/index.js';
import { STATIC_KEY, TAIL_KEY } from '../../../src/v2/turn.js';
import { createStore } from '../../../src/v2/store.js';
import { apply as applyOps } from '../../../src/v2/ops.js';
import { readRecord, isCarrier } from '../../../src/v2/persist.js';

export const MODULE_ID = 'bench-rpg';
export const PARTY_SIZE = 4;
export const STACKS = 60;
export const THREADS = 40;
export const CHANGES_PER_REPLY = 5;
export const UI_EVERY = 4;
export const UI_COMMANDS = 3;
// v1 kept the whole state as a text block (~3 KB) at the end of every reply.
export const V1_BLOCK_CHARS = 3000;

const KEY = 'storySuite';
const bytesOf = value => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
const fixedId = (prefix, n) => `${prefix}_${n.toString(36).padStart(8, '0')}`;

// ---------- the synthetic module (RPG Battle's party + Story Director's threads) ----------

const ACTORS = ['Ren', 'Mira', 'Tobin', 'Sael'];
const CLASSES = ['fighter', 'mage', 'rogue', 'cleric'];
const ADJECTIVES = ['Missing', 'Silent', 'Broken', 'Hidden', 'Burning', 'Last', 'Drowned', 'Golden'];
const NOUNS = ['Caravan', 'Bell', 'Oath', 'Lantern', 'Crown', 'Ferry', 'Orchard', 'Debt'];
const ITEMS = ['Healing Draught', 'Rope', 'Torch', 'Rations', 'Arrow', 'Lockpick', 'Chalk', 'Candle', 'Herb Bundle', 'Whetstone'];

export const actorId = i => fixedId('ac', i + 1);
export const threadId = i => fixedId('th', i + 1);
export const threadTitle = i => `The ${ADJECTIVES[i % 8]} ${NOUNS[Math.floor(i / 8) % 8]} ${i + 1}`;
export const itemName = i => `${ITEMS[i % ITEMS.length]} ${String.fromCharCode(65 + Math.floor(i / ITEMS.length))}`;

function initialParty() {
    const actors = {};
    for (let i = 0; i < PARTY_SIZE; i++) {
        const max = 60 + i * 6;
        actors[actorId(i)] = {
            id: actorId(i), name: ACTORS[i], cls: CLASSES[i], level: 3, xp: 900,
            hp: { cur: max, max }, mp: { cur: 20 + i, max: 20 + i }, ac: 13 + (i % 3),
            stats: { str: 14 - i, dex: 11 + i, con: 13, int: 9 + i, wis: 11, cha: 10 },
            skills: { athletics: 2, stealth: 1, arcana: i, insight: 1, perception: 2, persuasion: 0 },
            conditions: [],
            note: `${ACTORS[i]} keeps a short code-written note here, as the character sheet shows it.`,
        };
    }
    return { actors, order: Array.from({ length: PARTY_SIZE }, (_, i) => actorId(i)) };
}

function initialDirector() {
    const threads = {};
    for (let i = 0; i < THREADS; i++) {
        threads[threadId(i)] = {
            id: threadId(i), title: threadTitle(i), kind: ['quest', 'rumor', 'bond', 'threat'][i % 4],
            status: 'open', stage: 1, stages: 5, tension: 1, pinned: false,
            summary: `What is known so far about ${threadTitle(i)}: who asked, what was promised, and what went wrong on the way.`,
            next: 'The next beat the Director would like the story to reach.',
            cast: [actorId(i % PARTY_SIZE), actorId((i + 1) % PARTY_SIZE)], since: 0, updated: 0,
        };
    }
    return { time: { minutes: 8 * 60 }, threads };
}

const intProblem = (value, what) => (Number.isSafeInteger(value) && value >= 0 ? [] : [`${what} must be a whole number of at least 0.`]);

function validateParty(slice) {
    const errors = [];
    for (const actor of Object.values(slice?.actors ?? {})) {
        errors.push(...intProblem(actor.hp?.cur, `${actor.name}'s HP`));
        if (actor.hp?.cur > actor.hp?.max) errors.push(`${actor.name}'s HP is above the maximum.`);
    }
    return errors;
}

function validateDirector(slice) {
    const errors = [...intProblem(slice?.time?.minutes, 'The time')];
    for (const thread of Object.values(slice?.threads ?? {})) {
        errors.push(...intProblem(thread.stage, `${thread.title}'s stage`), ...intProblem(thread.tension, `${thread.title}'s tension`));
    }
    return errors;
}

const byName = (records, field, name, ctx, what) => {
    const found = Object.values(records).find(record => record[field] === String(name ?? '').trim());
    if (!found) ctx.fail('NOT_FOUND', `There is no ${what} called "${name}".`);
    return found;
};
const label = (line, name) => line?.labels?.[name] ?? null;
const intLabel = (ctx, line, name) => {
    const n = Number(label(line, name));
    if (!Number.isSafeInteger(n)) ctx.fail('INVALID', `"${name}" must be a whole number.`);
    return n;
};

function captureHp(ctx, line) {
    const party = ctx.draft('party');
    const actor = byName(party.actors, 'name', line.name, ctx, 'party member');
    const before = actor.hp.cur;
    actor.hp.cur = Math.max(0, Math.min(actor.hp.max, before + intLabel(ctx, line, 'delta')));
    return { summary: `${actor.name}: ${before} → ${actor.hp.cur} HP.`, data: { actor: actor.id, hp: actor.hp.cur }, narrate: false };
}

function captureThread(ctx, line) {
    const director = ctx.draft('director');
    const thread = byName(director.threads, 'title', line.name, ctx, 'thread');
    thread.stage = intLabel(ctx, line, 'stage');
    thread.tension = intLabel(ctx, line, 'tension');
    thread.updated = director.time.minutes;
    return { summary: `${thread.title} moves to stage ${thread.stage} (tension ${thread.tension}).`, data: { thread: thread.id, stage: thread.stage }, narrate: false };
}

function captureTime(ctx, line) {
    const director = ctx.draft('director');
    director.time.minutes += intLabel(ctx, line, 'minutes');
    return { summary: `The clock moves to minute ${director.time.minutes}.`, data: { minutes: director.time.minutes }, narrate: false };
}

/** The synthetic module: `party` and `director` domains, four commands (three for the UI) and three capture kinds. */
export function createBenchModule() {
    const kinds = { hp: captureHp, thread: captureThread, time: captureTime };
    return {
        id: MODULE_ID,
        name: 'Bench RPG',
        version: '2.0.0-bench',
        domains: {
            party: { initial: initialParty, validate: validateParty },
            director: { initial: initialDirector, validate: validateDirector },
        },
        commands: {
            // A system command that stocks the inventory through the core module's own grant.
            'bench.seed'(ctx) {
                for (let i = 0; i < STACKS; i++) ctx.call('inventory.grant', { name: itemName(i), qty: 3 });
                ctx.call('wallet.receive', { amount: 200, note: 'starting purse' });
                return { summary: `The party starts with ${STACKS} kinds of supplies.`, narrate: false };
            },
            // A tip the reader gives: the wallet pays through another module's action (a button
            // cannot pay on its own, as in the game a shop or a service does).
            'bench.tip'(ctx, { amount = 3, note = 'a tip' } = {}) {
                ctx.call('wallet.pay', { amount, note });
                return { summary: `The party tips ${amount}.` };
            },
            'party.heal'(ctx, { actor, amount = 5 } = {}) {
                const target = ctx.draft('party').actors[actor];
                if (!target) ctx.fail('NOT_FOUND', 'There is no such party member.');
                const before = target.hp.cur;
                target.hp.cur = Math.min(target.hp.max, before + amount);
                return { summary: `${target.name} rests: +${target.hp.cur - before} HP (now ${target.hp.cur}/${target.hp.max}).`, data: { actor, healed: target.hp.cur - before } };
            },
            'director.pin'(ctx, { thread } = {}) {
                const target = ctx.draft('director').threads[thread];
                if (!target) ctx.fail('NOT_FOUND', 'There is no such thread.');
                target.pinned = !target.pinned;
                return { summary: `${target.title} is ${target.pinned ? 'pinned' : 'no longer pinned'}.`, data: { thread, pinned: target.pinned }, narrate: false };
            },
        },
        queries: {
            'party.actors': state => Object.values(state?.domains?.party?.actors ?? {}),
        },
        capture: {
            kinds: {
                hp: { grammar: '~ hp Name | delta: -7 (a party member\'s HP changes by that much)' },
                thread: { grammar: '~ thread Title | stage: 2 | tension: 3' },
                time: { grammar: '~ time Clock | minutes: 15 (how far the clock moves)' },
            },
            apply(ctx, line) {
                const fn = kinds[line?.kind];
                return fn ? fn(ctx, line) : ctx.fail('INVALID', `Bench RPG does not keep "${line?.kind}" lines.`);
            },
        },
        context: {
            static: () => 'Code keeps the party\'s HP and the open threads: write a change line for every HP change, every thread that moves, and the time that passes.',
            tail(view) {
                const party = view?.state?.domains?.party;
                const director = view?.state?.domains?.director;
                const lines = (party?.order ?? []).map(id => party.actors[id]).map(actor => `${actor.name}: ${actor.hp.cur}/${actor.hp.max} HP`);
                const threads = Object.values(director?.threads ?? {}).sort((a, b) => b.tension - a.tension || (a.id < b.id ? -1 : 1));
                return { lines, optional: threads.slice(0, 8).map(thread => `${thread.title}: stage ${thread.stage}/${thread.stages}`) };
            },
            budget: 300,
        },
    };
}

// ---------- the chat's text ----------

const PROSE = 'The road bends past the old mill, where the water wheel has not turned in years. '
    + 'Lanterns sway in the wind as the party talks quietly about what the stranger said at the inn, '
    + 'and whether the map in Ren\'s pack can be trusted at all. ';

/** A reply of about 1,200 characters of prose, then its <Changes> block. */
export function replyText(n) {
    const prose = `Reply ${n}. ${PROSE.repeat(4)}`.trim();
    return `${prose}\n\n<Changes>\n${changeLines(n).join('\n')}\n</Changes>`;
}

/** The five change lines of reply `n`: an item, a coin, an HP change, a thread, the clock. */
export function changeLines(n) {
    const item = n % 2 ? `+ item ${itemName(n % STACKS)} | qty: 1` : `- item ${itemName((n - 1) % STACKS)} | qty: 1`;
    const coin = n % 3 === 0 ? '- coin 4 | to: the innkeeper' : '+ coin 7 | from: a grateful farmer';
    const hp = `~ hp ${ACTORS[n % PARTY_SIZE]} | delta: ${n % 2 ? -6 : 5}`;
    const thread = `~ thread ${threadTitle(n % THREADS)} | stage: ${1 + (n % 5)} | tension: ${n % 4}`;
    return [item, coin, hp, thread, '~ time Clock | minutes: 20'];
}

export const userText = n => `I look around and ask the others what they make of it (turn ${n}).`;

/** The three UI commands made after reply `n` (every UI_EVERY replies). */
export function uiCommands(n) {
    return [
        { type: 'party.heal', payload: { actor: actorId(n % PARTY_SIZE), amount: 4 } },
        { type: 'bench.tip', payload: { amount: 3, note: 'a tip' } },
        { type: 'director.pin', payload: { thread: threadId(n % THREADS) } },
    ];
}

// ---------- measuring a chat ----------

const median = list => {
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const percentile = (list, p) => {
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
/** { n, median, p95, max } of a list of numbers. */
export function stats(list) {
    return { n: list.length, median: median(list), p95: percentile(list, 95), max: list.length ? Math.max(...list) : null };
}

/** The chat file's size as SillyTavern writes it: one JSON line per message (the header line left out). */
export function chatBytes(chat) {
    let total = 0;
    for (const message of chat) total += bytesOf(message) + 1;
    return total;
}

const HIDDEN = /\s*<!--\s*STORY_SUITE_V2\b[\s\S]*?-->/g;

/**
 * Where the bytes of a v2 chat are: { file, records (every storySuite copy, message.extra and
 * swipe_info), shown (message.extra copies only), checkpoint, ops, receipts, receiptData,
 * receiptSummary, other, changeText (the hidden change blocks, in mes and swipes), carriers,
 * checkpoints: [bytes] }.
 */
export function breakdown(chat) {
    const out = { file: chatBytes(chat), records: 0, shown: 0, checkpoint: 0, ops: 0, receipts: 0, receiptData: 0, receiptSummary: 0, other: 0, changeText: 0, carriers: 0, checkpoints: [] };
    for (const message of chat) {
        if (!isCarrier(message)) continue;
        out.carriers += 1;
        const texts = [message.mes, ...(message.swipes ?? [])];
        for (const text of texts) for (const match of String(text ?? '').matchAll(HIDDEN)) out.changeText += bytesOf(match[0]) - 2;
        const copies = [message.extra?.[KEY], ...(message.swipe_info ?? []).map(info => info?.extra?.[KEY])].filter(Boolean);
        copies.forEach((record, at) => {
            const size = bytesOf(record) + 14;   // + `"storySuite":` and a comma
            out.records += size;
            if (at === 0) out.shown += size;
            const checkpoint = record.checkpoint ? bytesOf(record.checkpoint) : 0;
            const ops = bytesOf(record.ops);
            const receipts = bytesOf(record.receipts);
            out.checkpoint += checkpoint;
            out.ops += ops;
            out.receipts += receipts;
            for (const receipt of record.receipts) {
                out.receiptData += bytesOf(receipt.data);
                out.receiptSummary += bytesOf(receipt.summary);
            }
            out.other += size - checkpoint - ops - receipts;
            if (at === 0 && record.checkpoint) out.checkpoints.push(checkpoint);
        });
    }
    return out;
}

/** The same chat without any v2 record or hidden change block: the story text alone. */
export function bareChat(chat) {
    return chat.map(message => {
        const copy = structuredClone(message);
        if (copy.extra) delete copy.extra[KEY];
        for (const info of copy.swipe_info ?? []) if (info?.extra) delete info.extra[KEY];
        copy.mes = String(copy.mes ?? '').replace(HIDDEN, '');
        if (Array.isArray(copy.swipes)) copy.swipes = copy.swipes.map(text => String(text ?? '').replace(HIDDEN, ''));
        return copy;
    });
}

/** A v1-style state block of about `chars` characters (the whole state as text, in the envelope). */
export function v1Block(chars = V1_BLOCK_CHARS) {
    const lines = ['<!-- STORY_BLOCKS_V1', '<Blocks>', '<Inventory>'];
    let i = 0;
    while (lines.join('\n').length < chars - 40) {
        lines.push(`${itemName(i % STACKS)} | ${1 + (i % 4)} | bench stack ${i + 1}`);
        i += 1;
    }
    lines.push('</Inventory>', '</Blocks>', '-->');
    return lines.join('\n');
}

/**
 * v1's size for the same story: the bare chat plus a ~3 KB block in each reply's `mes` and in its shown
 * swipe (SillyTavern keeps the text in both). Returns { file, perReply, block }.
 */
export function v1Size(chat, chars = V1_BLOCK_CHARS) {
    const bare = chatBytes(bareChat(chat));
    const block = `\n\n${v1Block(chars)}`;
    const perCopy = bytesOf(block) - 2;
    let replies = 0;
    for (const [index, message] of chat.entries()) if (isCarrier(message) && index > 0) replies += 1;
    return { file: bare + replies * perCopy * 2, perReply: perCopy * 2, block: perCopy, bare };
}

function time(fn) {
    const start = performance.now();
    const value = fn();
    return { ms: performance.now() - start, value };
}

const gc = () => (typeof globalThis.gc === 'function' ? (globalThis.gc(), true) : false);

/**
 * Head rebuild after a chat load: a fresh store over a parsed copy of the saved chat (what the page has
 * after SillyTavern hands it the chat). { parseMs, rebuildMs: stats, heapBytes (the caches; null without
 * --expose-gc), headBytes, checkpointBytes }.
 */
export function measureLoad(chat, { repeat = 5 } = {}) {
    const json = JSON.stringify(chat);
    const parse = time(() => JSON.parse(json));
    const rebuilds = [];
    for (let r = 0; r < repeat; r++) {
        const copy = r === 0 ? parse.value : JSON.parse(json);
        const store = createStore({ chat: () => copy, save: async () => {} });
        rebuilds.push(time(() => store.head()).ms);
    }
    // The caches: what a store holds once it has built the head (the head state and the frozen copy of
    // the checkpoint it started from), as the heap grows when one is built over an already parsed chat.
    let heapBytes = null;
    if (gc()) {
        const before = process.memoryUsage().heapUsed;
        const held = createStore({ chat: () => parse.value, save: async () => {} });
        held.head();
        gc();
        heapBytes = process.memoryUsage().heapUsed - before;
        void held.head();
    }
    const store = createStore({ chat: () => parse.value, save: async () => {} });
    const head = store.head();
    const last = [...parse.value.keys()].reverse().find(index => readRecord(parse.value[index])?.checkpoint);
    // The longest replay a head can need: the carrier just before the last checkpoint, from the one before.
    const checkpoints = [...parse.value.keys()].filter(index => readRecord(parse.value[index])?.checkpoint);
    const worst = [];
    if (checkpoints.length > 1) {
        const target = checkpoints.at(-1) - 1;
        for (let r = 0; r < repeat; r++) {
            const fresh = createStore({ chat: () => parse.value, save: async () => {} });
            worst.push(time(() => fresh.at(target)).ms);
        }
    }
    return {
        parseMs: parse.ms, rebuildMs: stats(rebuilds), worstMs: stats(worst), heapBytes,
        headBytes: bytesOf(head), checkpointBytes: last === undefined ? 0 : bytesOf(readRecord(parse.value[last]).checkpoint),
        sinceCheckpoint: parse.value.slice(last).filter(isCarrier).length,
    };
}

/**
 * Head rebuild after a swipe of the last reply: a copy of the chat gets a new swipe the way SillyTavern
 * makes one (the extra copied along), then the store rebuilds; then the reader swipes back. { swipeMs,
 * backMs, sameAsBefore }.
 */
export function measureSwipe(chat, { repeat = 5 } = {}) {
    const swipe = [];
    const back = [];
    let sameAsBefore = true;
    for (let r = 0; r < repeat; r++) {
        const copy = structuredClone(chat);
        const store = createStore({ chat: () => copy, save: async () => {} });
        const before = JSON.stringify(store.head());
        const previous = [...copy.keys()].reverse().slice(1).find(index => isCarrier(copy[index]));
        const expected = JSON.stringify(store.at(previous));
        const message = copy.at(-1);
        message.swipes.push('');
        message.swipe_info.push({ send_date: '', extra: structuredClone(message.extra) });
        message.swipe_id = message.swipes.length - 1;
        message.mes = '';
        swipe.push(time(() => { store.rebuild(); return store.head(); }).ms);
        if (JSON.stringify(store.head()) !== expected) sameAsBefore = false;
        message.swipe_id = 0;
        message.mes = message.swipes[0];
        message.extra = structuredClone(message.swipe_info[0].extra);
        back.push(time(() => { store.rebuild(); return store.head(); }).ms);
        if (JSON.stringify(store.head()) !== before) sameAsBefore = false;
    }
    return { swipeMs: stats(swipe), backMs: stats(back), sameAsBefore };
}

// ---------- the run ----------

// How many messages of history a request carries (SillyTavern sends what fits the context, not the
// whole chat).
export const CONTEXT_MESSAGES = 40;

/**
 * One ordinary turn the way the testkit's fake SillyTavern runs it (user message, interceptor, prompt
 * ready, reply, MESSAGE_RECEIVED, generation ended), without the fake's bookkeeping that copies the whole
 * chat on every generation (fine for unit tests, quadratic over 3,000 replies). The host's own listeners
 * see the same events in the same order.
 */
export async function sendFast(host, user, reply) {
    const { st, ctx } = host;
    const types = ctx.eventTypes;
    const emit = (event, ...args) => st.eventSource.emit(event, ...args);
    st.addUser(user);
    await emit(types.MESSAGE_SENT, ctx.chat.length - 1);
    await emit(types.GENERATION_STARTED, 'normal', {}, false);
    let aborted = false;
    // SillyTavern hands the interceptor a copy of the chat; Story Suite's ignores it, so no copy is made.
    await st.interceptor(ctx.chat, 8192, () => { aborted = true; }, 'normal');
    if (aborted) throw new Error('bench: a generation was held back.');
    const history = ctx.chat.slice(-CONTEXT_MESSAGES).map(message => ({ role: message.is_user ? 'user' : 'assistant', content: message.mes }));
    const request = {
        chat: [{ role: 'system', content: [MAIN_PROMPT, st.prompt(STATIC_KEY)].join('\n') }, ...history, { role: 'system', content: st.prompt(TAIL_KEY) }],
        dryRun: false,
    };
    await emit(types.CHAT_COMPLETION_PROMPT_READY, request);
    const index = st.addMessage(aiMessage(reply, { name: ctx.name2 }));
    await emit(types.MESSAGE_RECEIVED, index, 'normal');
    await emit(types.GENERATION_ENDED, ctx.chat.length);
    st.eventSource.emitted.length = 0;
    st.promptLog.length = 0;
    return { index, request };
}

/**
 * Drives `replies` replies through a testkit host. `options`: { replies, snapshots (reply counts to
 * measure at; default [replies]), fast (true: sendFast; false: the fake's own send), uiSpacing: 'burst' (the three clicks inside 400 ms: one save) |
 * 'spread' (each click saved on its own), repeat (timing repeats at a snapshot), onSnapshot(result) }.
 * Returns { snapshots: [...], saves: { pre, capture, ui, other, total }, problems }.
 */
export async function runScenario(options = {}) {
    const { replies = 100, snapshots = [replies], fast = true, uiSpacing = 'burst', repeat = 5, onSnapshot = null } = options;
    const host = await createHost({ modules: [createBenchModule()], st: { greeting: `The story begins. ${PROSE}` } });
    const { st, store, bus, ctx } = host;
    let phase = 'other';
    const saves = { pre: 0, capture: 0, ui: 0, other: 0 };
    // Counts saves without copying the chat (the fake's own saveChat keeps a deep copy of each one).
    ctx.saveChat = async () => { saves[phase] += 1; };

    const turnInterceptor = st.interceptor;
    const preMs = [];
    st.interceptor = async (...args) => {
        phase = 'pre';
        const start = performance.now();
        try { await turnInterceptor(...args); } finally {
            preMs.push(performance.now() - start);
            phase = 'other';
        }
    };
    const captureMs = [];
    let captureStart = 0;
    st.eventSource.makeFirst(st.ctx.eventTypes.MESSAGE_RECEIVED, () => { phase = 'capture'; captureStart = performance.now(); });
    st.eventSource.on(st.ctx.eventTypes.MESSAGE_RECEIVED, () => { captureMs.push(performance.now() - captureStart); phase = 'other'; });

    const seeded = bus.command('bench.seed', {}, { cause: 'system' });
    if (!seeded.ok) throw new Error(`bench: the seed command failed: ${seeded.message}`);
    phase = 'other';
    await store.flush();

    const commandMs = [];
    const savesPerReply = [];
    const out = { snapshots: [], saves, problems: [] };
    const wanted = new Set(snapshots);
    let counted = 0;
    const totalSaves = () => saves.pre + saves.capture + saves.ui + saves.other;
    for (let n = 1; n <= replies; n++) {
        const before = totalSaves();
        if (n > 1 && (n - 1) % UI_EVERY === 0) {
            for (const { type, payload } of uiCommands(n - 1)) {
                const run = time(() => bus.command(type, payload, { cause: 'ui' }));
                if (!run.value.ok) out.problems.push(`reply ${n}: ${type} was refused: ${run.value.message}`);
                commandMs.push(run.ms);
                if (uiSpacing === 'spread') {
                    phase = 'ui';
                    await store.flush();
                    phase = 'other';
                }
            }
        }
        if (fast) await sendFast(host, userText(n), replyText(n));
        else await host.send(userText(n), replyText(n));
        savesPerReply.push(totalSaves() - before);
        if (wanted.has(n)) {
            const problems = host.turn.problems();
            out.problems.push(...problems.slice(counted).map(item => item.message));
            counted = problems.length;
            const window = list => list.slice(Math.max(0, list.length - 100));
            const sizes = breakdown(ctx.chat);
            const snapshot = {
                replies: n,
                messages: ctx.chat.length,
                bytes: sizes,
                v1: v1Size(ctx.chat),
                checkpoints: { count: sizes.checkpoints.length, ...stats(sizes.checkpoints), sum: sizes.checkpoints.reduce((a, b) => a + b, 0) },
                savesPerReply: { mean: savesPerReply.reduce((a, b) => a + b, 0) / savesPerReply.length, ...stats(savesPerReply) },
                saves: { ...saves, total: totalSaves() },
                // The last 100 replies before the snapshot: how it feels at this chat length.
                preMs: stats(window(preMs)),
                captureMs: stats(window(captureMs)),
                commandMs: stats(window(commandMs)),
                load: measureLoad(ctx.chat, { repeat }),
                swipe: measureSwipe(ctx.chat, { repeat }),
                head: store.head(),
            };
            out.snapshots.push(snapshot);
            onSnapshot?.(snapshot);
        }
    }
    await store.flush();
    out.saves = { ...saves, total: totalSaves() };
    out.chat = ctx.chat;
    out.host = host;
    host.close();
    return out;
}

// ---------- tuning experiments (on a finished chat; the runtime is not changed) ----------

/**
 * The chat with its checkpoints placed by another rule: a carrier gets one when `every` carriers have
 * passed since the last, or the ops since then exceed `bytes` (the store's rule, other numbers). The
 * greeting keeps its own. Ops, receipts and everything else stay as they are.
 */
export function relayout(chat, { every = 20, bytes = 32 * 1024 } = {}) {
    const copy = structuredClone(chat);
    let state = null;
    let carriers = 0;
    let opBytes = 0;
    let first = true;
    let since = [];   // the records a new checkpoint covers (store.js chain)
    for (const message of copy) {
        const record = readRecord(message);
        if (!isCarrier(message) || !record) continue;
        if (first) {
            state = record.checkpoint;
            first = false;
        } else {
            carriers += 1;
            const due = carriers >= every || opBytes > bytes;
            if (due) {
                record.checkpoint = structuredClone(state);
                record.covers = since;
                since = [];
                carriers = 0;
                opBytes = 0;
            } else {
                delete record.checkpoint;
                delete record.covers;
            }
        }
        since.push(record.sid);
        opBytes += bytesOf(record.ops);
        state = applyOps(state, record.ops);
        syncSwipe(message, record);
    }
    return copy;
}

function syncSwipe(message, record) {
    const info = message.swipe_info?.[message.swipe_id ?? 0];
    if (info?.extra) info.extra[KEY] = structuredClone(record);
}

/**
 * One carrier's ops with the safe redundancy removed: every `/meta/rev` replace but the last, and any
 * `replace` of a path that a later op of the same carrier replaces again. Same result when applied,
 * because `diff` only appends to arrays or replaces them whole, so no later op shifts an earlier path.
 */
export function compactCarrierOps(ops) {
    const lastAt = new Map();
    const firstWas = new Map();   // a count's kept op takes the `was` of the first op it stands for
    ops.forEach((op, index) => {
        if (op.op !== 'replace') return;
        lastAt.set(op.path, index);
        if (typeof op.was === 'number' && !firstWas.has(op.path)) firstWas.set(op.path, op.was);
    });
    return ops
        .filter((op, index) => !(op.op === 'replace' && lastAt.get(op.path) !== index))
        .map(op => (op.op === 'replace' && firstWas.has(op.path) ? { ...op, was: firstWas.get(op.path) } : op));
}

/**
 * The chat with each carrier's ops compacted (and `spans` dropped, since they no longer line up; a
 * real compaction would keep story and kept spans apart).
 */
export function compactOps(chat) {
    const copy = structuredClone(chat);
    for (const message of copy) {
        const record = readRecord(message);
        if (!record) continue;
        record.ops = compactCarrierOps(record.ops);
        record.spans = [{ n: record.ops.length, story: false }];
        syncSwipe(message, record);
    }
    return copy;
}

/**
 * The chat with receipts older than `keep` replies (counted back from the head) trimmed to what Re-read,
 * narration and the claims never need again: `data` emptied (and `summary` too when `summaries` is set).
 */
export function stripOldReceipts(chat, { keep = 200, summaries = false } = {}) {
    const copy = structuredClone(chat);
    const carriers = [...copy.keys()].filter(index => isCarrier(copy[index]));
    for (const index of carriers.slice(0, Math.max(0, carriers.length - keep))) {
        const record = readRecord(copy[index]);
        if (!record) continue;
        record.receipts = record.receipts.map(receipt => ({ ...receipt, data: {}, ...(summaries ? { summary: '' } : {}) }));
        syncSwipe(copy[index], record);
    }
    return copy;
}

/**
 * The same chat with the record kept once: the shown swipe's copy in `swipe_info` is dropped on every
 * carrier but the last (only the last message can be swiped). Other swipes keep their own records.
 */
export function singleCopy(chat) {
    const copy = structuredClone(chat);
    const lastIndex = copy.findLastIndex(isCarrier);
    copy.forEach((message, index) => {
        const info = message.swipe_info?.[message.swipe_id ?? 0];
        if (index !== lastIndex && info?.extra && info.extra !== message.extra) delete info.extra[KEY];
    });
    return copy;
}

/** Head equality of two chats, by replay through a fresh store each. */
export function sameHead(a, b) {
    const head = chat => JSON.stringify(createStore({ chat: () => chat, save: async () => {} }).head());
    return head(a) === head(b);
}
