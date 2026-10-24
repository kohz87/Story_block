// Seeded fuzz of proof over whole turns on the testkit's host (docs/v2/EVIDENCE.md): sends, swipes, Continues,
// Re-reads (with and without an edit), reader's clicks that build on proof, middle deletes and reloads, with an
// afterCapture step that builds on the reply's acceptance. After every step: what story.evidence shows is what a
// cold rebuild shows; every shown proof is pinned, has its parents shown and was given on a reply that is still
// there, on the swipe that is shown; nothing but a prerequisite is reported; and a Re-read of text that did not change
// leaves every proof, and so what the reader built on it, exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { prng } from './qa/helpers/seeded.js';
import { director, fighter, hostModule, T1, T2 } from './helpers/evidence.js';

const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : [1, 2, 3, 4, 5, 6];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 36;
const SAID = ['Sure, I accept the job.', 'No. I refuse the job, and I will not take it.', 'Okay then! I will take the quest.', 'Hmm, maybe later.'];
const WORDS = ['Sure, I accept the job', 'I refuse the job, and I will not take it', 'I will take the quest', 'take it', 'Hmm, maybe later', 'I'];
const text = (narration, lines) => `${narration}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

async function run(t, seed, steps) {
    const r = prng(seed);
    const link = hostModule();
    const host = await createHost({ modules: [link.def, director({ after: true }), fighter()], core: false });
    t.after(() => host.close());
    link.link(host.store);
    t.mock.method(console, 'warn', () => {});
    const turns = [];
    host.events.on('turn', turn => turns.push(turn));
    const ask = args => host.sdk.query('story.evidence', args);
    const log = [];
    let most = 0;
    const continued = new Set();   // the logical replies that were Continued: each part had a step after it, a Re-read asks once
    const lines = () => Array.from({ length: r.int(0, 3) }, () => (r.chance(0.7)
        ? `! accept ${r.pick([T1, T2])} | words: ${r.pick(WORDS)}`
        : `! kill ${r.pick(['Wolf', 'Bear'])} | after: ${r.pick([T1, T2])}`));
    const reply = tag => text(`Reply ${tag}.`, lines());
    const lastReply = () => host.ctx.chat.findLastIndex(message => !message.is_user && message !== host.ctx.chat[0]);

    const check = when => {
        const shown = ask({});
        most = Math.max(most, shown.length);
        const fail = message => `seed ${seed}, ${when}: ${message}\n${log.join('\n')}`;
        const ids = shown.map(proof => proof.id);
        assert.equal(new Set(ids).size, ids.length, fail('a proof is shown twice'));
        const pins = host.head().meta.proofs ?? {};
        const records = new Map();
        for (const message of host.ctx.chat) {
            const record = message?.extra?.storySuite;
            if (record?.source) records.set(record.source.evidence, record);
        }
        for (const proof of shown) {
            assert.ok(Object.hasOwn(pins, proof.id), fail(`${proof.id} is shown without a pin`));
            assert.ok(proof.parents.every(parent => ids.includes(parent)), fail(`${proof.id} is shown without its parents`));
            assert.ok(records.has(proof.source.evidence), fail(`${proof.id} was given on a reply or swipe that is not there`));
        }
        assert.deepEqual(host.store.problems().filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), [], fail('a problem'));
        const live = JSON.stringify(shown);
        host.store.rebuild();
        assert.equal(JSON.stringify(ask({})), live, fail('live differs from a rebuild'));
    };

    await host.send(r.pick(SAID), reply('first'));
    for (let step = 0; step < steps; step += 1) {
        const kind = r.int(0, 11);
        const at = lastReply();
        if (kind <= 2) {
            log.push(`${step}: send`);
            await host.send(r.pick(SAID), reply(step));
        } else if (kind === 3 && at > 0) {
            log.push(`${step}: swipe`);
            await host.swipe(reply(`swipe ${step}`));
        } else if (kind === 4 && at > 0) {
            log.push(`${step}: continue`);
            continued.add(host.store.carrierSid(at));
            await host.cont(text(` More ${step}.`, lines()));
        } else if (kind === 5 && at > 0) {
            // Re-read of text that did not change: every proof stays as it was.
            log.push(`${step}: re-read, unchanged`);
            // (A block planned again has an ordinal of its own; the proof, its id, kind, hash and parents, is the same: every id of every
            // block stays, each step on the id it had, and no proof is lost. A reply that was Continued had a step after each part.)
            const sid = host.store.carrierSid(at);
            const plain = () => JSON.stringify(ask({}).map(({ id, kind, payloadHash, parents }) => [id, kind, payloadHash, parents]));
            const before = plain();
            const result = await host.turn.reread(at);
            if (result.ok && !continued.has(sid) && plain() !== before) {
                const was = JSON.parse(before).map(item => item.join('|').slice(0, 40));
                const now = JSON.parse(plain()).map(item => item.join('|').slice(0, 40));
                log.push(`  was ${was.filter(x => !now.includes(x)).join(' ; ')}`, `  now ${now.filter(x => !was.includes(x)).join(' ; ')}`);
            }
            if (result.ok && !continued.has(sid)) assert.equal(plain(), before, `seed ${seed}, ${step}: an unchanged Re-read changed an id or lost a proof\n${log.join('\n')}`);
        } else if (kind === 6 && at > 0) {
            log.push(`${step}: edit, re-read`);
            const message = host.ctx.chat[at];
            message.mes = text(`Edited ${step}.`, lines());
            message.swipes[message.swipe_id] = message.mes;
            await host.turn.reread(at);
        } else if (kind === 7 && at > 0) {
            // The reader's click that builds on a proof, if there is one.
            const parent = ask({}).filter(proof => proof.kind === 'acceptance').at(-1);
            log.push(`${step}: click${parent ? '' : ' (nothing to build on)'}`);
            if (parent) host.bus.command(r.chance(0.5) ? 'sd.needs' : 'rb.many', r.chance(0.5) ? { thread: T2, selection: `pick ${step}`, parent: parent.id } : { specs: [{ kind: 'kill', payload: { foe: `foe ${step}` }, parents: [parent.id] }] });
        } else if (kind === 8 && host.ctx.chat.length > 3) {
            const pairs = host.ctx.chat.map((message, i) => (i > 1 && !message.is_user ? i : -1)).filter(i => i > 0);
            if (pairs.length > 1) {
                const i = r.pick(pairs);
                log.push(`${step}: delete reply ${i}`);
                await host.st.deleteMessage(i);
                await host.st.deleteMessage(i - 1);
            }
        } else if (kind >= 10 && at > 0) {
            // A step of one key on the head reply (a guarded system step that builds on a proof shown): after a delete takes one back and
            // leaves another at a salted id, the next one added takes the free id below it.
            const parent = r.pick(ask({}).filter(proof => proof.kind !== 'visit' || proof.payload.after !== 'dependent'));
            log.push(`${step}: a step on ${parent?.id ?? 'nothing'}`);
            if (parent) host.bus.command('sd.dependent', { parent: parent.id }, { cause: 'system' });
        } else if (kind === 9 || kind >= 10) {
            log.push(`${step}: reload`);
            await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        }
        check(`step ${step}`);
    }
    return most;
}

for (const seed of SEEDS) {
    test(`proof turn fuzz seed ${seed}: sends, swipes, Continues, Re-reads, clicks, deletes and reloads keep story.evidence true to the chat`, async t => {
        assert.ok(await run(t, seed, STEPS) > 0, 'the run gave proof');
    });
}
