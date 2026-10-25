// Seeded fuzz of the head-selection barrier and the active history (docs/v2/TIMELINE.md, HISTORY.md): sends, saves, restores
// and native changes that are held while they activate (a participant callback paused) and met by a delete, a swipe or a Re-read
// before they finish, plus Continues, Re-reads, swipes, deletes and reloads around them. After every step:
// - barrier down => the participants stand on the checkpoints of the selected head: the sync capability says so, and a new host
//   over a copy of the chat file (its recovery plans the selection on its own) leaves the participant exactly where it is;
// - every time the modules are announced ready, the barrier is down and the participants are ready;
// - no message the history marks inactive reaches a built request, and every active one does;
// - a rebuild gives the head, nothing is reported but a prerequisite, and the journal is settled once recovery has run.
// A failing seed replays exactly (QA_FUZZ_SEED=n; QA_FUZZ_SEEDS=n and QA_FUZZ_STEPS=n run a longer hunt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { prng, seedCrypto } from './qa/helpers/seeded.js';
import { hashJson } from '../../src/v2/replay.js';
import { NATIVE, NPC, batchFor, clone, nativeModule, pause, reload, rulesModule, seal } from './helpers/timeline.js';

const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)]
    : process.env.QA_FUZZ_SEEDS ? Array.from({ length: Number(process.env.QA_FUZZ_SEEDS) }, (_, i) => i + 1) : [1, 2, 3, 4, 5, 6, 7, 8];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 30;

// A wait that cannot hang the run: the promise settles within a few hundred turns of the event loop, or the seed fails.
async function within(promise, what) {
    let done = false;
    let value;
    let error;
    promise.then(each => { done = true; value = each; }, each => { done = true; error = each; });
    for (let turn = 0; turn < 400 && !done; turn += 1) await new Promise(resolve => setImmediate(resolve));
    if (!done) throw new Error(`${what} did not settle`);
    if (error) throw error;
    return value;
}

async function run(t, seed, steps) {
    const undo = seedCrypto(seed);
    t.after(undo);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const r = prng(seed);
    const mainApi = seed % 2 ? 'openai' : 'textgen';
    const native = nativeModule();
    native.def.queries['nat.trust'] = () => native.native.store.dossiers.tavi.trust;
    const activate = pause(native.def.participant, 'activate');
    const applyEvent = pause(native.def.participant, 'applyEvent');
    const modules = () => [rulesModule(), native.def];
    let host = null;
    const log = [];
    const fail = message => `seed ${seed} (${mainApi}): ${message}\n${log.join('\n')}`;
    let n = 0;
    let batch = 0;
    let event = 0;
    const heard = [];
    const open = async image => {
        host = image ? await reload(createHost, image, modules(), { st: { mainApi } }) : await createHost({ modules: modules(), st: { mainApi } });
        t.after(() => host.close());
        host.events.on('modules', ({ changes }) => {
            if (!changes.some(change => change.status === 'ready')) return;
            heard.push({ state: host.registry.restore().state, ready: host.sdk.query('savepoint.contract', {}).participantsReady });
        });
    };
    await open(null);

    const carriers = () => host.ctx.chat.map((message, at) => (at > 0 && !message.is_user ? at : -1)).filter(at => at > 0);
    const tag = word => `FZ${word}${++n}Z`;   // (closed, so one tag is never the start of another)
    const send = async () => {
        log.push('send');
        await host.send(`${tag('u')} says.`, `${tag('r')} narrates.`);
    };

    // What is done to the story while a participant is held, or on its own between steps.
    const meddle = async how => {
        const list = carriers();
        const last = host.ctx.chat.length - 1;
        if (how === 'delete-last' && last > 1) { log.push('  delete last'); await host.st.deleteMessage(last); }
        else if (how === 'delete-any' && list.length > 1) { const at = r.pick(list); log.push(`  delete ${at}`); await host.st.deleteMessage(at); }
        else if (how === 'swipe-to') {
            const at = list.findLast(index => (host.ctx.chat[index].swipes?.length ?? 0) > 1);
            if (at !== undefined) { const to = host.ctx.chat[at].swipe_id === 0 ? 1 : 0; log.push(`  swipe ${at} to ${to}`); await host.st.swipeTo(at, to); }
        } else if (how === 'reread' && list.length > 1) {
            const at = r.pick(list);
            log.push(`  edit+reread ${at}`);
            await host.st.editMessage(at, `${tag('e')} edited.`);
            await within(host.sdk.reread(at), 'reread');
        }
    };
    const HOW = ['none', 'delete-last', 'delete-any', 'swipe-to', 'reread'];

    // An operation that is held at the participant's callback while the story changes, then released.
    async function held(gate, label, start) {
        const how = r.pick(HOW);
        log.push(`${label} (held, then ${how})`);
        gate.arm();
        const running = start();
        const reached = await within(Promise.race([gate.entered.then(() => true), running.then(() => false)]), `${label} reaching its participant`);
        if (reached) {
            assert.equal(host.registry.restore().state, 'pending', fail(`${label}: the barrier is up while the participant is held`));
            await meddle(how);
            gate.release();
        } else { gate.armed = false; }
        const result = await within(running, label);
        outcome.how = reached ? how : null;
        return result;
    }
    const outcome = { how: null };

    async function restoreOp() {
        const points = (await host.sdk.timeline.list()).points;
        if (!points.length) return;
        const point = r.pick(points);
        batch += 1;
        const id = `br_fz${String(batch).padStart(6, '0')}`;
        await seal(host, batchFor(id));
        const head = await host.sdk.timeline.head();
        assert.equal(head.ok, true, fail(`head: ${head.message}`));
        const prepared = await host.timeline.host.prepare({ snapshot: point.id, deathEvents: [`ev_fz${String(batch).padStart(6, '0')}`], batchResult: batchFor(id), expectedHead: head.headHash });
        assert.equal(prepared.ok, true, fail(`prepare: ${prepared.message}`));
        const start = () => host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
        const before = hashJson(native.native.store);
        const carrier = host.store.sourceAt(host.store.headIndex());
        outcome.how = null;
        if (r.chance(0.3)) { log.push('restore'); await start(); } else await held(activate, 'restore', start);
        // A restore the story does not hold any more (its reply went while the participant switched) must leave the participant where
        // the selected head puts it. When the reply deleted held only the restore (no native change and no earlier return stands on it),
        // that is where the participant was before the restore began.
        await within(host.timeline.host.recover(), 'recovery');
        const returns = host.head().domains.savepoints?.returns ?? {};
        const alone = !host.timeline.host.journal().some(entry => ['native-mutation', 'native-event'].includes(entry.kind) && entry.boundary?.cursor?.sid === carrier.sid)
            && !Object.values(returns).some(each => each.restoreAt?.sid === carrier.sid);
        if (outcome.how === 'delete-last' && !Object.hasOwn(returns, prepared.return) && alone) {
            assert.equal(hashJson(native.native.store), before, fail(`restore ${prepared.return} was taken back with its reply, and the participant is not where it was before it`));
        }
    }

    async function mutateOp() {
        const head = await host.sdk.timeline.head();
        if (!head.ok) return;
        const step = n;
        const source = host.store.sourceAt(host.store.headIndex());
        let after = null;
        const start = () => native.native.handle.nativeMutation({
            participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head.headHash,
            prepare: async () => {
                const before = native.native.checkpoint();
                const next = clone(native.native.store);
                next.dossiers.tavi.trust += 1;
                after = native.native.keep(next);
                native.native.prepared[`pr_fz${step}_${++n}`] = { checkpoint: after.checkpoint };
                return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: `pr_fz${step}_${n}` };
            },
        });
        if (r.chance(0.3)) { log.push('native change'); await start(); } else await held(activate, 'native change', start);
        // A change whose reply is gone is not on the line of history: the participant is not left on its checkpoint.
        await within(host.timeline.host.recover(), 'recovery');
        const there = host.ctx.chat.some((message, at) => !message.is_user && host.store.sourceAt(at)?.sid === source.sid && host.store.sourceAt(at)?.swipeKey === source.swipeKey);
        if (after && !there) assert.notEqual(native.native.active, after.checkpoint, fail('a native change whose reply is gone left the participant on its checkpoint'));
    }

    async function eventOp() {
        const head = await host.sdk.timeline.head();
        if (!head.ok) return;
        event += 1;
        const start = () => host.timeline.host.nativeEvent({ event: `ev_fe${String(event).padStart(6, '0')}`, participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash });
        await held(applyEvent, 'native event', start);
    }

    // Barrier down => the participants are on the selected head's checkpoints. The selected head is planned again by a new host over a
    // copy of the chat file; if the live participant was anywhere else, that host's recovery moves it, and the hash would change.
    async function checkSelected(when) {
        if (host.registry.restore().state !== 'idle') return false;
        assert.equal(host.sdk.query('savepoint.contract', {}).participantsReady, true, fail(`${when}: the barrier is down but the participants are not ready`));
        const before = hashJson(native.native.store);
        await host.store.flush();
        const liveHandle = native.native.handle;
        const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules(), { st: { mainApi } });
        try {
            assert.equal(fresh.registry.restore().state, 'idle', fail(`${when}: a new host is barred`));
            assert.equal(hashJson(native.native.store), before, fail(`${when}: the barrier was down with the participant off the selected head's checkpoint`));
        } finally { fresh.close(); native.native.handle = liveHandle; }
        return true;
    }

    async function checkPrompt(when) {
        // A real request: the reader sends, and every message the history marks inactive is absent from it, every active one present.
        const sent = tag('p');
        await host.send(`${sent} probe.`, `${tag('q')} answers.`);
        const request = host.st.requests.at(-1);
        const built = request.chat ? request.chat.map(entry => (typeof entry.content === 'string' ? entry.content : '')).join('\n') : request.prompt;
        const history = await host.sdk.timeline.history({});
        for (const message of history.messages.slice(0, -1)) {
            for (const word of message.text.match(/FZ[a-z]\d+Z/g) ?? []) {
                assert.equal(built.includes(word), message.active, fail(`${when}: ${message.active ? 'an active' : 'a faded'} message (${word}) ${message.active ? 'is missing from' : 'reached'} the request`));
            }
        }
    }

    const check = when => {
        const problems = host.store.problems();
        assert.deepEqual(problems.filter(problem => problem.code !== 'REPLAY_PREREQUISITE').map(problem => problem.message), [], fail(`${when}: a problem that is not a prerequisite`));
        const live = clone(host.head());
        host.store.rebuild();
        assert.deepEqual(clone(host.head()), live, fail(`${when}: a rebuild differs from the head`));
        assert.equal(host.registry.restore().state, 'idle', fail(`${when}: the barrier`));
        assert.equal(host.timeline.host.journal().every(entry => ['committed', 'discarded', 'aborted', 'complete', 'done', 'retracted'].includes(entry.phase)), true, fail(`${when}: journal`));
    };

    await host.send('Begin.', `${tag('r')} starts.`);
    for (let step = 1; step <= steps; step += 1) {
        const pick = r.int(0, 99);
        const when = `step ${step}`;
        if (pick < 18) await send();
        else if (pick < 26) { log.push('xp'); await host.sdk.command('tl.xp', { amount: r.int(1, 9) }); }
        else if (pick < 34) { log.push('save'); await host.sdk.timeline.make({ kind: 'manual', name: `Save ${step}` }); }
        else if (pick < 50) await restoreOp();
        else if (pick < 60) await mutateOp();
        else if (pick < 64) await eventOp();
        else if (pick < 70 && host.ctx.chat.length > 3 && !host.ctx.chat.at(-1).is_user) { log.push('swipe'); await host.swipe(`${tag('s')} swiped.`); }
        else if (pick < 76) await meddle('delete-any');
        else if (pick < 80) await meddle('swipe-to');
        else if (pick < 85) await meddle('reread');
        else if (pick < 89 && !host.ctx.chat.at(-1).is_user) { log.push('continue'); await host.cont(` ${tag('c')} goes on.`); }
        else if (pick < 95) {
            log.push('reload');
            await host.store.flush();
            const image = { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) };
            host.close();
            await open(image);
        } else { log.push('rebuild'); host.store.rebuild(); }
        // Before anything asks for a recovery: if the barrier is down, the participants are where the selected head puts them.
        await checkSelected(`${when} (before recovery)`);
        const settled = await within(host.timeline.host.recover(), 'recovery');
        assert.equal(settled.ok, true, fail(`${when}: recovery ${settled.message}`));
        const selected = (await host.sdk.timeline.status()).participants.find(p => p.module === NATIVE);
        if (selected) assert.equal(selected.hash, hashJson(native.native.store), fail(`${when}: native checkpoint does not match the selected head`));
        await checkSelected(`${when} (after recovery)`);
        check(when);
        if (step % 3 === 0) await checkPrompt(when);
    }
    assert.deepEqual(heard.filter(each => each.state !== 'idle' || each.ready !== true), [], fail('the modules were announced ready with the barrier up or the participants not ready'));
    if (process.env.QA_FUZZ_VERBOSE) process.stderr.write(`seed ${seed}: ${['restore', 'native', 'delete', 'swipe', 'edit', 'reload'].map(word => `${word} ${log.filter(line => line.trim().startsWith(word)).length}`).join(', ')}\n`);
    return log;
}

for (const seed of SEEDS) {
    test(`release fuzz: seed ${seed}, ${STEPS} steps of held restores and native changes met by deletes, swipes and Re-reads`, async t => {
        await run(t, seed, STEPS);
    });
}
