// QA (CI guard for b1-capture round 2): seeded chats of ~20 replies with middle deletes, on the real
// host. The input is clean: no reply leans on a record another deletable reply made (each reply's new
// items are its own; takes and gains of shared things go to what the first reply set up, which is never
// deleted), so a middle delete must never skip a block. After every delete:
// - no replay Problem (nothing skipped), and every domain passes its own validator;
// - a new store over a copy of the chat agrees with the cached head, and every carrier's state equals
//   an independent rebuild (helpers/oracle.js);
// - what is held adds up: the coin and the torches are the first reply's plus every remaining reply's
//   changes, and each remaining reply's own items are there.
// A failing seed replays exactly (QA_DELETE_SEED=n).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { prng, seedCrypto } from './helpers/seeded.js';
import { checkInvariants } from './helpers/oracle.js';

const SEEDS = process.env.QA_DELETE_SEED ? [Number(process.env.QA_DELETE_SEED)] : [3, 11, 29, 101];
const REPLIES = 20;
const PLACES = ['Bluewatch Village', 'The Weir', 'Old Mill'];

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

// One reply's lines and what they do: { lines, coin, torches, own: [names] }.
function replyLines(r, step) {
    const out = { lines: [], coin: 0, torches: 0, own: [] };
    for (let n = r.int(1, 4); n > 0; n -= 1) {
        switch (r.int(0, 6)) {
            case 0: { const k = r.int(1, 30); out.lines.push(`+ coin ${k}`); out.coin += k; break; }
            case 1: { const k = r.int(1, 5); out.lines.push(`- coin ${k} | to: the ferryman`); out.coin -= k; break; }
            case 2: { const k = r.int(1, 3); out.lines.push(`+ item Torch | qty: ${k}`); out.torches += k; break; }
            case 3: { out.lines.push('- item Torch'); out.torches -= 1; break; }
            case 4: { const name = `Charm ${step}-${out.own.length + 1}`; out.lines.push(`+ item ${name}`); out.own.push(name); break; }
            case 5: { const name = `Walker ${step}-${out.lines.length}`; out.lines.push(`+ present ${name}`); out.people = [...(out.people ?? []), name]; break; }
            default: out.lines.push(`~ place ${r.pick(PLACES)} | kind: ${r.pick(['settlement', 'wild', ''])}`);
        }
    }
    return out;
}

function validators(host) {
    const state = host.head();
    return Object.keys(state.domains).flatMap(name => {
        const fn = host.registry.validator(name);
        return typeof fn === 'function' ? fn(state.domains[name], state).map(problem => `${name}: ${problem}`) : [];
    });
}

for (const seed of SEEDS) {
    test(`delete fuzz seed ${seed}: middle deletes on clean input skip nothing; replay equals rebuild`, async t => {
        t.mock.method(console, 'warn', () => {});
        const restore = seedCrypto(seed);
        const host = await createHost();
        t.after(() => { host.close(); restore(); });
        const r = prng(seed);
        await host.send('Hello.', 'The road.');
        await host.send('We set out.', reply('Supplies.', ['+ coin 300', '+ item Torch | qty: 40', '~ place Bluewatch Village | kind: settlement']));
        const base = { coin: coin(host), torches: qty(host, 'Torch') };
        const setup = host.store.headIndex();
        // The replies after the first, by the record ID that stays with them: what each did.
        const done = new Map();
        for (let step = 0; step < REPLIES; step += 1) {
            const made = replyLines(r, step);
            await host.send(`Step ${step}.`, reply(`Step ${step} goes on.`, made.lines));
            const index = host.store.headIndex();
            assert.deepEqual(host.turn.problems().filter(problem => problem.index === index), [], `seed ${seed} step ${step}: the lines are clean`);
            done.set(host.store.carrierSid(index), made);
            if (step < 3 || !r.chance(0.35)) continue;
            // Delete a reply in the middle (after the set-up, not the last) and the reader's message before it.
            const replies = host.ctx.chat.map((message, at) => (!message.is_user && at > setup && at < index ? at : -1)).filter(at => at >= 0);
            if (!replies.length) continue;
            const gone = r.pick(replies);
            done.delete(host.store.carrierSid(gone));
            await host.st.deleteMessage(gone);
            await host.st.deleteMessage(gone - 1);
            const label = `seed ${seed} step ${step} (deleted ${gone})`;
            assert.deepEqual(host.store.problems(), [], `${label}: nothing was skipped`);
            assert.deepEqual(validators(host), [], `${label}: the head passes its validators`);
            checkInvariants(host, label);
            const kept = [...done.values()];
            assert.equal(coin(host), base.coin + kept.reduce((sum, made) => sum + made.coin, 0), `${label}: coin`);
            assert.equal(qty(host, 'Torch'), base.torches + kept.reduce((sum, made) => sum + made.torches, 0), `${label}: torches`);
            for (const name of kept.flatMap(made => made.own)) assert.equal(qty(host, name), 1, `${label}: ${name}`);
        }
    });
}
