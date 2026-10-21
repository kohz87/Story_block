// QA: seeded fuzz of whole chats on the real host (testkit createHost: real store, command bus,
// turn, Story Block's core module, plus a small probe module). Each run mixes sends, swipes,
// regenerates, continues, deletes (last and middle), swipe picks and swipe deletes, edits, chat
// switches and bursts of UI commands between replies. After every step:
// - the state at every carrier equals an independent rebuild from scratch (helpers/oracle.js);
// - a carrier that stopped being the head keeps exactly the state it had then, so swipes and
//   deletes of later replies roll back to it exactly;
// - a fresh swipe holds only what was committed during that swipe (nothing of the old swipe);
// - a narrated receipt is told at most once per line of history, and [Happened] tells exactly the
//   receipts the reply records as told;
// - the bonus claim pays at most once per line; a rejected command stores and saves nothing;
// - one save per burst of UI commands, one at the end of a reply (plus the flush of what was
//   pending), a failed save keeps the state dirty and leaves the chat as it was;
// - the static prompt is byte-identical in every request of the run.
// A failing seed replays exactly: the host's crypto IDs and seeds follow the run's seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { aiMessage } from '../../../testkit/fake-st.js';
import { readRecord } from '../../../src/v2/persist.js';
import { HAPPENED } from '../../../src/v2/prompt.js';
import { prng, seedCrypto } from './helpers/seeded.js';
import { BONUS_CLAIM, probeModule } from './helpers/probe-module.js';
import { carriers, checkInvariants, rebuildAt } from './helpers/oracle.js';

// QA_FUZZ_SEEDS=200 QA_FUZZ_STEPS=200 runs a longer hunt locally (QA_FUZZ_SEED=n one seed); CI runs the fixed list.
const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : process.env.QA_FUZZ_SEEDS ? Array.from({ length: Number(process.env.QA_FUZZ_SEEDS) }, (_, i) => i + 1) : [1, 7, 42, 1337, 2024, 31337, 90210, 424242];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 90;

const ITEMS = ['Rope', 'Lamp', 'Moonveil Trout', 'Iron Key', 'Apple', 'Torch'];
const PLACES = ['Bluewatch Village', 'The Weir', 'Old Mill'];
const PEOPLE = ['Fenna', 'Kael', 'Lyra'];
const WORDS = ['ember', 'frost', 'gale', 'stone', 'tide'];

const plain = value => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)));
const settle = () => new Promise(resolve => setImmediate(resolve));

function changeLine(r) {
    switch (r.int(0, 10)) {
        case 0: case 1: return `+ item ${r.pick(ITEMS)} | qty: ${r.int(1, 3)}`;
        case 2: return `- item ${r.pick(ITEMS)} | qty: ${r.int(1, 2)}`;
        case 3: return `~ item ${r.pick(ITEMS)} | note: ${r.pick(WORDS)}-marked`;
        case 4: return `+ coin ${r.int(1, 20)} | from: ${r.pick(PEOPLE)}`;
        case 5: return `- coin ${r.int(1, 12)} | to: ${r.pick(PEOPLE)}`;
        case 6: return `~ place ${r.pick(PLACES)} | kind: settlement`;
        case 7: return `${r.pick(['+', '-'])} present ${r.pick(PEOPLE)}`;
        case 8: return `! probe ${r.pick(WORDS)}`;
        case 9: return r.pick(['+ dragon Smaug', 'not a change line', '* - item', '~ wound Ren — a scratch']);
        default: return `+ item ${r.pick(ITEMS)}`;
    }
}

function replyText(r, step) {
    const story = `Reply of step ${step}: the story goes on.`;
    if (r.chance(0.2)) return story;
    const lines = Array.from({ length: r.int(1, 5) }, () => changeLine(r));
    if (r.chance(0.1)) return `${story}\n<Changes>\n${lines[0]}\n</Changes>\nMore story.\n<Changes>\n${lines.slice(1).join('\n')}\n</Changes>`;
    return `${story}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
}

// A UI command the reader could press now: [type, payload].
function uiCommand(r, host) {
    const head = host.head();
    const stacks = Object.values(head?.domains?.inventory?.stacks ?? {})
        .sort((a, b) => (a.def + a.qty + a.note < b.def + b.qty + b.note ? -1 : 1));
    const choices = [
        ['probe.tick', {}],
        ['probe.pay', {}],
        ['probe.broken', {}],
        ['wallet.pay', { owner: 'party', amount: r.int(1, 8) }],
        ['wallet.receive', { owner: 'party', amount: r.int(1, 4) }],
    ];
    if (stacks.length) {
        const stack = r.pick(stacks);
        choices.push(['inventory.drop', { stack: stack.id, qty: r.int(1, 2) }]);
        if (stack.qty >= 2) choices.push(['inventory.split', { stack: stack.id, qty: 1 }]);
        const twin = stacks.find(other => other !== stack && other.def === stack.def);
        if (twin) choices.push(['inventory.merge', { stack: stack.id, into: twin.id }]);
    }
    choices.push(['inventory.drop', { stack: 'it_00000000', qty: 1 }]);
    return r.pick(choices);
}

function bonusPaidOnLine(host) {
    // A skipped block takes only its own receipts with it (store.js replays block by block). The
    // store reports the blocks skipped since the latest checkpoint; the oracle finds the older ones.
    const chat = host.ctx.chat;
    const skipped = new Set();
    // One rebuild per checkpoint segment: at the carrier before each later checkpoint, and at the head.
    const list = carriers(chat);
    const ends = list.filter((index, at) => at === list.length - 1 || readRecord(chat[list[at + 1]])?.checkpoint);
    for (const index of ends) {
        for (const entry of rebuildAt(chat, index).skipped) for (const rev of entry.revs) skipped.add(`${entry.index}:${rev}`);
    }
    let paid = 0;
    for (const index of carriers(chat)) {
        const record = readRecord(chat[index]);
        paid += (record?.receipts ?? []).filter(receipt => receipt.type === 'probe.pay' && !skipped.has(`${index}:${receipt.rev}`)).length;
    }
    return paid;
}

const tailOf = request => request.chat.filter(message => message.role === 'system').slice(1).map(message => message.content).join('\n');

async function fuzz(t, seed) {
    const restore = seedCrypto(seed);
    t.after(restore);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const r = prng(seed);
    const host = await createHost({ modules: [probeModule({ cues: true })] });
    t.after(() => host.close());
    const { st, ctx, store } = host;
    let committed = new Set();
    host.events.on('committed', ({ receipt }) => committed.add(receipt.id));
    const finals = new Map();          // carrier message → { swipe, state } when it stopped being the head
    const statics = new Set();
    let other = null;                   // the second chat for chat switches
    const log = [];

    const lastIsCarrier = () => ctx.chat.length > 1 && !ctx.chat.at(-1).is_user;

    async function generation(kind, step) {
        const reply = replyText(r, step);
        const dirtyBefore = store.dirty();
        const savesBefore = st.saves.length;
        const appends = kind === 'send' || (kind === 'regenerate' && !lastIsCarrier());
        const previous = store.headIndex();
        committed = new Set();
        let result;
        if (kind === 'send') result = await host.send(`Message of step ${step}.`, reply);
        else if (kind === 'swipe') result = await host.swipe(reply);
        else if (kind === 'regenerate') result = await host.regenerate(reply);
        else result = await host.cont(r.chance(0.5) ? `\nand then\n<Changes>\n${changeLine(r)}\n</Changes>` : ' and then.');
        assert.ok(result.request, `${log.at(-1)}: the generation was not stopped`);
        statics.add(result.request.chat[0].content);
        const index = result.index;
        // The carrier before a new reply is final from now on (a cue may have landed on it just before
        // the request, so it is read after the reply, and checked against the oracle like every state).
        if (appends && previous >= 0) finals.set(ctx.chat[previous], { swipe: ctx.chat[previous].swipe_id ?? 0, state: plain(store.at(previous)) });
        const record = readRecord(ctx.chat[index]);
        assert.ok(record, `${log.at(-1)}: the reply has a record (narrated at least)`);
        if (kind === 'swipe') {
            for (const receipt of record.receipts) {
                assert.ok(committed.has(receipt.id), `${log.at(-1)}: the new swipe holds receipt ${receipt.id} ("${receipt.summary}") that was not committed during this swipe`);
            }
        }
        if (kind !== 'continue') {
            const { owner } = checkInvariants(host, `${log.at(-1)} (told check)`);
            const lines = record.narrated.map(id => owner.get(id)?.receipt).filter(receipt => receipt && receipt.summary.trim())
                .map(receipt => receipt.summary.trim().replace(/\s*\n\s*/g, ' '));
            const tail = tailOf(result.request);
            if (lines.length) assert.ok(tail.startsWith([HAPPENED, ...lines].join('\n')), `${log.at(-1)}: [Happened] tells exactly what the reply records as told\n${tail}`);
            else assert.ok(!tail.includes(HAPPENED), `${log.at(-1)}: nothing to tell, no [Happened]`);
        }
        // A cue committed before the reply is saved with the reply (turn.js runCues): the whole chat file
        // is written once for both.
        const saves = st.saves.length - savesBefore;
        assert.equal(saves, (dirtyBefore ? 1 : 0) + 1, `${log.at(-1)}: one flush of what was pending, one save at the end of the reply (with any cue)`);
        assert.equal(store.dirty(), false, `${log.at(-1)}: saved after the reply`);
        assert.deepEqual(st.saved(), plain(ctx.chat), `${log.at(-1)}: the saved chat is the chat`);
    }

    // A reader's action is saved at once, before sdk.command answers (B-b2-timeline-1): one save per
    // command that went through, none for a refused one. With `failSave` the first of those saves fails:
    // the state stays unsaved and the chat untouched until the next save, which writes it all.
    async function uiBurst(failSave, label) {
        const count = r.int(1, 3);
        const savesBefore = st.saves.length;
        const dirtyBefore = store.dirty();
        let ok = 0;
        if (failSave) st.failSaves = 1;
        for (let i = 0; i < count; i++) {
            const [type, payload] = uiCommand(r, host);
            const before = JSON.stringify(ctx.chat);
            const head = plain(store.head());
            const paidBefore = bonusPaidOnLine(host);
            const claimed = Object.hasOwn(head?.meta?.claims ?? {}, BONUS_CLAIM);
            const saves = st.saves.length;
            const result = await host.sdk.command(type, payload);
            if (type === 'probe.broken') assert.equal(result.ok, false, `${label}: probe.broken always refuses`);
            // A skipped block can leave the head's inventory pointing at an item whose creation was
            // skipped (its reply deleted); the inventory's validator then refuses any change to it
            // until the reader tidies up, so a free claim may still be refused, as INVALID, then.
            const brokenInventory = result.code === 'INVALID' && store.problems().length > 0 && /inventory would not be valid/.test(result.message);
            if (type === 'probe.pay' && !brokenInventory) assert.equal(result.ok, !claimed, `${label}: probe.pay pays only while the claim is free (claimed: ${claimed}): ${result.message ?? 'paid'}`);
            if (!result.ok) {
                assert.equal(JSON.stringify(ctx.chat), before, `${label}: ${type} ${JSON.stringify(payload)} was refused (${result.code}) and the chat is untouched`);
                assert.deepEqual(plain(store.head()), head, `${label}: ${type} refused: the head is unchanged`);
                assert.equal(st.saves.length, saves, `${label}: a refused command saves nothing`);
                continue;
            }
            ok++;
            const record = readRecord(ctx.chat[store.headIndex()]);
            assert.equal(record.receipts.at(-1).id, result.receipt.id, `${label}: ${type}: the receipt is on the head carrier`);
            assert.ok(bonusPaidOnLine(host) <= 1, `${label}: the bonus is paid at most once on this line`);
            if (type === 'probe.pay') assert.equal(bonusPaidOnLine(host), paidBefore + 1);
            if (failSave && ok === 1) {
                assert.equal(st.saves.length, saves, `${label}: the failed save stored nothing`);
                assert.equal(store.dirty(), true, `${label}: a failed save keeps the state marked unsaved`);
            } else {
                assert.equal(st.saves.length, saves + 1, `${label}: ${type} is saved at once`);
                assert.equal(store.dirty(), false, `${label}: ${type}: saved`);
                assert.deepEqual(st.saved(), plain(ctx.chat), `${label}: the saved chat is the chat`);
            }
        }
        if (!ok) assert.equal(store.dirty(), dirtyBefore, `${label}: nothing went through, nothing changed`);
        assert.equal(st.saves.length - savesBefore, failSave && ok ? ok - 1 : ok, `${label}: one save per command that went through`);
        st.failSaves = 0;
        // A save that failed is tried again a moment later (store.js; persist.js createSaver retry).
        if (failSave && ok === 1) {
            t.mock.timers.tick(1000);
            await settle();
            await settle();
            assert.equal(store.dirty(), false, `${label}: the failed save is made good by the retry`);
            assert.deepEqual(st.saved(), plain(ctx.chat), `${label}: and it writes everything`);
        }
    }

    for (let step = 0; step < STEPS; step++) {
        const roll = r.int(0, 19);
        let action;
        if (roll <= 4) action = 'send';
        else if (roll <= 6) action = lastIsCarrier() ? 'swipe' : 'send';
        else if (roll === 7) action = 'regenerate';
        else if (roll === 8) action = lastIsCarrier() ? 'continue' : 'send';
        else if (roll === 9) action = ctx.chat.length > 1 ? 'deleteLast' : 'send';
        else if (roll === 10) action = ctx.chat.length > 2 ? 'deleteMiddle' : 'send';
        else if (roll === 11) action = 'edit';
        else if (roll === 12) action = 'switchChat';
        else if (roll === 13) action = (ctx.chat.at(-1).swipes?.length ?? 0) > 1 && lastIsCarrier() ? 'swipeTo' : 'ui';
        else if (roll === 14) action = (ctx.chat.at(-1).swipes?.length ?? 0) > 1 && lastIsCarrier() ? 'deleteSwipe' : 'ui';
        else if (roll === 15) action = 'uiFail';
        else action = 'ui';
        if (action === 'regenerate' && ctx.chat.length < 2) action = 'send';
        log.push(`seed ${seed} step ${step} ${action}`);
        const label = log.at(-1);

        switch (action) {
            case 'send': case 'swipe': case 'regenerate': case 'continue':
                await generation(action, step);
                break;
            case 'deleteLast':
                await st.deleteMessage(ctx.chat.length - 1);
                break;
            case 'deleteMiddle': {
                const at = r.int(1, ctx.chat.length - 2);
                for (const message of ctx.chat.slice(at)) finals.delete(message);
                await st.deleteMessage(at);
                // A later reply's change that no longer applies is skipped alone on replay; what was
                // committed onto that reply before and after it still applies (store.js, block by
                // block), so the fuzz keeps such carriers and goes on committing onto them.
                // QA_FUZZ_TIDY=1 deletes from the end until every stored change applies again.
                if (process.env.QA_FUZZ_TIDY) {
                    while (store.problems().length && ctx.chat.length > 1) await st.deleteMessage(ctx.chat.length - 1);
                }
                break;
            }
            case 'edit': {
                const indexes = carriers(ctx.chat);
                const at = r.pick(indexes);
                const head = plain(store.head());
                await st.editMessage(at, `${ctx.chat[at].mes}\n(edited)\n<Changes>\n+ item Edited Thing | qty: 5\n</Changes>`);
                assert.deepEqual(plain(store.head()), head, `${label}: editing a reply's text does not re-capture`);
                break;
            }
            case 'switchChat': {
                const mine = structuredClone(ctx.chat);
                const head = plain(store.head());
                other ??= [aiMessage('Another story.', { name: 'Narrator' })];
                await st.loadChat(other, 'chat-2');
                checkInvariants(host, `${label} (in the other chat)`);
                await host.sdk.command('probe.tick', {});
                other = structuredClone(ctx.chat);
                await st.loadChat(mine, 'chat-1');
                finals.clear();
                assert.deepEqual(plain(store.head()), head, `${label}: back in the first chat, its head is as it was`);
                t.mock.timers.tick(400);
                await settle();
                break;
            }
            case 'swipeTo': {
                const last = ctx.chat.length - 1;
                const message = ctx.chat[last];
                const choices = message.swipes.map((_, i) => i).filter(i => i !== message.swipe_id);
                await st.swipeTo(last, r.pick(choices));
                break;
            }
            case 'deleteSwipe': {
                // SillyTavern's swipe delete: the swipe goes, the one before it (or after) is shown.
                const last = ctx.chat.length - 1;
                const message = ctx.chat[last];
                const gone = message.swipe_id;
                message.swipes.splice(gone, 1);
                message.swipe_info.splice(gone, 1);
                message.swipe_id = Math.max(0, gone - 1);
                message.mes = message.swipes[message.swipe_id];
                message.extra = structuredClone(message.swipe_info[message.swipe_id]?.extra ?? {});
                await st.eventSource.emit(st.ctx.eventTypes.MESSAGE_SWIPE_DELETED, last);
                break;
            }
            case 'ui': await uiBurst(false, label); break;
            case 'uiFail': await uiBurst(true, label); break;
            default: throw new Error(action);
        }

        checkInvariants(host, label);
        assert.ok(bonusPaidOnLine(host) <= 1, `${label}: the bonus is paid at most once on this line`);
        for (const [message, final] of finals) {
            const index = ctx.chat.indexOf(message);
            if (index < 0 || (message.swipe_id ?? 0) !== final.swipe) continue;
            assert.deepEqual(plain(store.at(index)), final.state, `${label}: carrier ${index} keeps the state it had when the story moved past it`);
        }
        const head = store.headIndex();
        if (head >= 0) finals.delete(ctx.chat[head]);
    }
    if (process.env.QA_FUZZ_STATS) {
        const counts = {};
        for (const line of log) { const action = line.split(' ').at(-1); counts[action] = (counts[action] ?? 0) + 1; }
        const checkpoints = carriers(ctx.chat).filter(index => readRecord(ctx.chat[index])?.checkpoint).length;
        console.log(JSON.stringify({ seed, carriers: carriers(ctx.chat).length, checkpoints, told: [...ctx.chat].reduce((n, m) => n + (readRecord(m)?.narrated.length ?? 0), 0), counts }));
    }
    assert.equal(statics.size, 1, `seed ${seed}: the static prompt is byte-identical in every request of the chat`);
    assert.deepEqual(host.turn.problems().filter(problem => problem.module === null && problem.code === 'FAILED'), [], `seed ${seed}: the host itself never failed`);
}

for (const seed of SEEDS) {
    test(`fuzz seed ${seed}: replay equals rebuild, rollback is exact, told once, claims once, saves per burst`, async t => {
        await fuzz(t, seed);
    });
}
