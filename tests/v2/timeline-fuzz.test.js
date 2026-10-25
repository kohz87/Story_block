// Seeded fuzz of the timeline over whole chats on the testkit's host (docs/v2/TIMELINE.md): replies, the reader's clicks, manual
// saves, the host's anchors, restores (prepare and activate), native mutations, swipes, middle deletes, edits with a Re-read and
// reloads from the chat file. After every step:
// - nothing is reported but a prerequisite (a block turned off by a change to the story it stood on);
// - a rebuild of the chat gives the head that is held (replay == live), and so does a new host over a copy of the chat file;
// - nothing is in flight: no barrier, an idle journal, a head that can be read;
// - the savepoints domain is whole, its epoch is the timeline's, its points are listed in target order with their bytes;
// and after a restore: every slice of the story is the save's, the claims and the proof pins are the save's, the participant is
// on the save's checkpoint, and the return is complete.
// A failing seed replays exactly (QA_FUZZ_SEED=n; QA_FUZZ_SEEDS=n and QA_FUZZ_STEPS=n run a longer hunt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { HOST_DOMAIN } from '../../src/v2/timeline/index.js';
import { prng, seedCrypto } from './qa/helpers/seeded.js';
import { clockModule } from './helpers/clock.js';
import { hashJson } from '../../src/v2/replay.js';
import { director, T1, T2 } from './helpers/evidence.js';
import { NATIVE, batchFor, clone, nativeModule, reload, rulesModule, seal } from './helpers/timeline.js';

const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)]
    : process.env.QA_FUZZ_SEEDS ? Array.from({ length: Number(process.env.QA_FUZZ_SEEDS) }, (_, i) => i + 1) : [1, 2, 3, 4, 5, 6, 7, 8];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 40;
const ITEMS = ['Rope', 'Lamp', 'Torch', 'Apple'];
const SLOTS = ['hand', 'head', 'body'];

const text = (narration, lines) => (lines.length ? `${narration}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : narration);
const stateOf = host => host.head();
const without = state => {
    const { [HOST_DOMAIN]: host, ...domains } = state.domains;
    void host;
    return clone({ domains, claims: state.meta.claims ?? {}, proofs: state.meta.proofs ?? {} });
};

async function run(t, seed, steps) {
    const undo = seedCrypto(seed);
    t.after(undo);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const r = prng(seed);
    const native = nativeModule();
    const modules = () => {
        const rules = rulesModule();
        delete rules.domains.director;
        const sd = director();
        const clock = clockModule({ start: 1410 });
        return [rules, native.def, { ...sd, domains: { ...sd.domains, ...clock.domains },
            commands: { ...sd.commands, ...clock.commands }, queries: { ...sd.queries, ...clock.queries }, replayQueries: clock.replayQueries,
            hooks: { ...sd.hooks, replayGuard: (view, info) => Object.hasOwn(info.guard.predicate, 'before') ? clock.hooks.replayGuard(view, info) : sd.hooks.replayGuard(view, info) } }];
    };
    let host = await createHost({ modules: modules() });
    t.after(() => host.close());
    const log = [];
    let batch = 0;
    let kept = null;       // what the last restore must have left: { snapshot payload, return }

    const fail = message => `seed ${seed}: ${message}\n${log.join('\n')}`;
    const carriers = () => host.ctx.chat.map((message, at) => (at > 0 && !message.is_user ? at : -1)).filter(at => at > 0);
    const reply = () => text(`Reply ${log.length}.`, Array.from({ length: r.int(0, 3) }, () => r.pick([
        `+ coin ${r.int(1, 20)}`, `+ coin ${r.int(1, 3)} | from: a friend`, `+ item ${r.pick(ITEMS)} ${log.length} | qty: ${r.int(1, 2)}`, `~ place ${r.pick(['Weir', 'Mill', 'Keep'])} | kind: wild`,
    ])));

    async function click() {
        const pick = r.int(0, 7);
        const calls = [
            ['tl.xp', { amount: r.int(1, 30) }], ['tl.hurt', { amount: r.int(1, 3) }], ['tl.heal', { amount: r.int(1, 3) }], ['director.advance', { minutes: r.int(30, 3000) }],
            ['tl.equip', { slot: r.pick(SLOTS), item: r.pick(ITEMS) }], ['tl.meter', { npc: r.pick(['tavi', 'orrin']), value: r.int(1, 4) }],
            ['tl.claim', { key: `claim-${r.int(1, 6)}` }], ['sd.accept', { thread: r.pick([T1, T2]), selection: `pick ${r.int(1, 4)}` }],
        ];
        const [type, payload] = calls[pick];
        log.push(`click ${type} ${JSON.stringify(payload)}`);
        if (type === 'director.advance') host.bus.command(type, payload, { cause: 'system' });
        else await host.sdk.command(type, payload);
    }

    async function save() {
        const kind = r.pick(['manual', 'manual', 'manual', 'initial']);
        log.push(`make ${kind}`);
        if (kind === 'manual') await host.sdk.timeline.make({ kind, name: `Save ${log.length}` });
        else if (kind === 'initial') await host.timeline.host.make({ kind });
        else await host.timeline.host.make({ kind, day: r.int(0, 6) });
    }

    async function death() {
        const points = (await host.sdk.timeline.list()).points;
        if (!points.length) return;
        const point = r.pick(points);
        batch += 1;
        const id = `br_fz${String(batch).padStart(6, '0')}`;
        log.push(`restore to ${point.id} (${point.kind})`);
        if (r.chance(0.2)) native.native.edit(state => { state.dossiers.tavi.trust += 7; });
        await seal(host, batchFor(id));
        const head = await host.sdk.timeline.head();
        assert.equal(head.ok, true, fail(`head: ${head.message}`));
        const prepared = await host.timeline.host.prepare({ snapshot: point.id, deathEvents: [`ev_fz${String(batch).padStart(6, '0')}`], batchResult: batchFor(id), expectedHead: head.headHash });
        assert.equal(prepared.ok, true, fail(`prepare ${point.id}: ${prepared.message}`));
        const done = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
        assert.equal(done.status, 'complete', fail(`activate: ${done.message ?? done.status}`));
        const bytes = host.ctx.chatMetadata.storySuite.timeline.payloads[point.payloadHash];
        kept = { payload: bytes.payload, proofs: bytes.proofs, return: prepared.return, point, checkpoint: point.participants[0].checkpoint };
    }

    async function reloadHost() {
        log.push('reload');
        await host.store.flush();
        const image = { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) };
        host.close();
        host = await reload(createHost, image, modules());
        t.after(() => host.close());
    }

    const check = when => {
        const state = stateOf(host);
        const problems = host.store.problems();
        assert.deepEqual(problems.filter(problem => problem.code !== 'REPLAY_PREREQUISITE').map(problem => problem.message), [], fail(`${when}: a problem that is not a prerequisite`));
        // Replay == live: a rebuild of the chat gives the head.
        const live = clone(state);
        host.store.rebuild();
        assert.deepEqual(clone(stateOf(host)), live, fail(`${when}: a rebuild differs from the head`));
        // The savepoints domain is whole, its epoch the timeline's, its points in target order with their bytes.
        const domain = stateOf(host).domains[HOST_DOMAIN];
        if (domain) {
            assert.equal(domain.schema, 2, fail(`${when}: savepoints schema`));
            const listed = host.sdk.query('savepoint.list', {});
            assert.deepEqual(listed.map(point => point.id).sort(), Object.keys(domain.points).sort(), fail(`${when}: the list is the points`));
            for (let n = 1; n < listed.length; n += 1) {
                assert.equal(listed[n - 1].target.rev <= listed[n].target.rev, true, fail(`${when}: target order`));
            }
            for (const point of listed) assert.equal(point.available, true, fail(`${when}: bytes of ${point.id}`));
            for (const record of Object.values(domain.returns)) assert.equal(record.status, 'complete', fail(`${when}: return ${record.id}`));
        }
        assert.equal(host.registry.restore().state, 'idle', fail(`${when}: the barrier`));
        assert.equal(host.timeline.host.journal().every(entry => ['committed', 'discarded', 'aborted', 'complete', 'done', 'retracted'].includes(entry.phase)), true, fail(`${when}: journal`));
    };

    const checkRestore = when => {
        const state = stateOf(host);
        const saved = without({ domains: kept.payload.domains, meta: { claims: kept.payload.storyClaims, proofs: kept.proofs } });
        assert.deepEqual(without(state), saved, fail(`${when}: every slice, the claims and the proof pins are the save's`));
        assert.equal(native.native.active, kept.checkpoint, fail(`${when}: the participant is on the save's checkpoint`));
        assert.equal(state.domains[HOST_DOMAIN].returns[kept.return].status, 'complete');
        assert.equal(state.domains[HOST_DOMAIN].points[kept.point.id].id, kept.point.id, fail(`${when}: the save is still eligible`));
    };

    await host.send('Begin.', text('Start.', ['+ coin 10']));
    for (let step = 1; step <= steps; step += 1) {
        const pick = r.int(0, 99);
        kept = null;
        if (pick < 16) { log.push('send'); await host.send(`Go ${step}.`, reply()); } else if (pick < 36) await click();
        else if (pick < 48) await save();
        else if (pick < 64) await death();
        else if (pick < 70 && host.ctx.chat.length > 3 && !host.ctx.chat.at(-1).is_user) { log.push('swipe'); await host.swipe(reply()); } else if (pick < 78 && carriers().length > 2) {
            const at = r.pick(carriers());
            log.push(`delete ${at}`);
            await host.st.deleteMessage(at);
        } else if (pick < 84 && carriers().length > 1) {
            const at = r.pick(carriers());
            log.push(`edit+reread ${at}`);
            await host.st.editMessage(at, text(`Edited ${step}.`, r.chance(0.5) ? [`+ coin ${r.int(1, 9)}`] : []));
            await host.sdk.reread(at);
        } else if (pick < 90) {
            log.push('native mutation');
            const head = await host.sdk.timeline.head();
            if (head.ok) {
                await native.native.handle.nativeMutation({
                    participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head.headHash,
                    prepare: async () => {
                        const before = native.native.checkpoint();
                        const next = clone(native.native.store);
                        next.dossiers.tavi.trust += 1;
                        const after = native.native.keep(next);
                        native.native.prepared[`pr_fz${step}`] = { checkpoint: after.checkpoint };
                        return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: `pr_fz${step}` };
                    },
                });
            }
        } else if (pick < 95) await reloadHost();
        else { log.push('rebuild'); host.store.rebuild(); }
        const settled = await host.timeline.host.recover();
        assert.equal(settled.ok, true, fail(`step ${step}: recovery ${settled.message}`));
        const selected = (await host.sdk.timeline.status()).participants.find(p => p.module === NATIVE);
        if (selected) assert.equal(selected.hash, hashJson(native.native.store), fail(`step ${step}: native checkpoint does not match the selected head`));
        check(`step ${step}`);
        if (kept) checkRestore(`step ${step}`);
        // A fresh host over a copy of the chat file agrees with this one (every few steps: it is the dear check).
        if (step % 7 === 0) {
            await host.store.flush();
            const liveHandle = native.native.handle;
            const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules());
            try { assert.deepEqual(clone(fresh.head()), clone(stateOf(host)), fail(`step ${step}: a new host over the chat file differs`)); } finally { fresh.close(); native.native.handle = liveHandle; }
        }
    }
    if (process.env.QA_FUZZ_VERBOSE) process.stderr.write(`seed ${seed}: ${['restore', 'make', 'delete', 'swipe', 'edit', 'native', 'reload'].map(word => `${word} ${log.filter(line => line.startsWith(word)).length}`).join(', ')}\n`);
    return log;
}

for (const seed of SEEDS) {
    test(`timeline fuzz: seed ${seed}, ${STEPS} steps of replies, saves, restores, swipes, deletes, Re-reads, native changes and reloads`, async t => {
        await run(t, seed, STEPS);
    });
}
