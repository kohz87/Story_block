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
import { displayLines } from '../../../src/v2/extras.js';

const SEEDS = process.env.QA_DELETE_SEED ? [Number(process.env.QA_DELETE_SEED)] : [3, 11, 19, 29, 101];
const REPLIES = 20;
const PLACES = ['Bluewatch Village', 'The Weir', 'Old Mill'];

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
// fix-encounter: a model now and then writes a change line in the story, on its own line before the
// block; it is read with the block (capture.js strayLines). Every fourth reply does (by step, so the
// seeds draw the same chats).
const strayReply = (text, lines) => (lines.length > 1 ? `${text}\n\n${lines.at(-1)}\n\n<Changes>\n${lines.slice(0, -1).join('\n')}\n</Changes>` : reply(text, lines));
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

// One reply's lines and what they do: { lines, coin, torches, own: [names] }.
function replyLines(r, step) {
    const out = { lines: [], coin: 0, torches: 0, own: [] };
    for (let n = r.int(1, 4); n > 0; n -= 1) {
        switch (r.int(0, 7)) {
            case 0: { const k = r.int(1, 30); out.lines.push(`+ coin ${k}`); out.coin += k; break; }
            case 1: { const k = r.int(1, 5); out.lines.push(`- coin ${k} | to: the ferryman`); out.coin -= k; break; }
            case 2: { const k = r.int(1, 3); out.lines.push(`+ item Torch | qty: ${k}`); out.torches += k; break; }
            case 3: { out.lines.push('- item Torch'); out.torches -= 1; break; }
            // A letter for the reply's own count: the tolerant lookup ignores word order, so "Charm 1-2" and
            // "Charm 2-1" are one name to it (names.js looseKey), and the later reply's line would add to
            // the earlier one's stack, which a delete of that reply then skips (seed 19).
            case 4: { const name = `Charm ${step}${'abcd'[out.own.length]}`; out.lines.push(`+ item ${name}`); out.own.push(name); break; }
            case 5: { const name = `Walker ${step}-${out.lines.length}`; out.lines.push(`+ present ${name}`); out.people = [...(out.people ?? []), name]; break; }
            // Loot laid out by this reply (its own things); taken at once below, so the take is on this reply too.
            case 6: {
                if (out.loot) break;
                const names = [`Relic ${step}-a`, `Relic ${step}-b`];
                out.lines.push(`? loot ${names[0]}, ${names[1]} x2 — under the floor`);
                out.loot = names;
                break;
            }
            default: out.lines.push(`~ place ${r.pick(PLACES)} | kind: ${r.pick(['settlement', 'wild', ''])}`);
        }
    }
    return out;
}

// Choices and Inner chatter (MODULES §F115): display lines, by step (no draw, so the seeds draw the same
// chats). They change nothing; each remaining reply shows its own after every delete.
const extraLines = step => (step % 3 === 0 ? [`? choice Step ${step} onward`, `~ chatter Walker: step ${step} thought`] : []);
// The weather (MODULES §F120), by step too: the latest remaining reply that wrote one is the weather.
const weatherLines = step => (step % 5 === 2 ? [`~ weather step ${step} rain`] : []);
// The party's mounts, by step too: a reply at step 3, 8, 13, 18 gets a mount of its own, the next one tires it and the one after
// that sells it (only while the story still has that mount), so a later delete of the first leaves replies changing a mount that
// is gone: passed over on replay, never skipped.
const mountLines = (step, done) => {
    const has = n => [...done.values()].some(made => made.mounts.some(line => line.startsWith(`+ mount Mare ${n} `)));
    if (step % 5 === 3) return [`+ mount Mare ${step} | kind: horse | where: led`];
    if (step % 5 === 4 && has(step - 1)) return [`~ mount Mare ${step - 1} | condition: tired ${step}`];
    return step % 5 === 0 && step > 0 && has(step - 2) ? [`- mount Mare ${step - 2}`] : [];
};
// What the mounts are after the replies kept (in chat order): each line acts only on a mount that is there.
function mountsAfter(kept) {
    const rows = new Map();
    for (const made of kept) {
        for (const line of made.mounts) {
            const [, op, name] = /^([+~-]) mount (Mare \d+)/.exec(line);
            if (op === '+') rows.set(name, '');
            else if (op === '-') rows.delete(name);
            else if (rows.has(name)) rows.set(name, /condition: (.*)$/.exec(line)[1]);
        }
    }
    return [...rows].map(([name, condition]) => [name, condition]);
}
// Your look (MODULES §F126), by step too: each part is the latest remaining reply's that wrote it ('' when that reply cleared it). The
// values carry the step, so no two replies write the same words (the same words again are no change, so no op).
const youOf = step => {
    const made = {};
    if (step % 9 === 4) made.rank = `step ${step} novice`;
    else if (step % 17 === 10) made.rank = '';
    if (step % 4 === 3) made.wearing = `step ${step} coat`;
    else if (step % 11 === 6) made.wearing = '';
    if (step % 5 === 1) made.condition = `step ${step} tired`;
    else if (step % 13 === 8) made.condition = '';
    return made;
};
const youLines = made => [...(made.rank !== undefined ? [`~ you rank: ${made.rank}`] : []), ...(made.wearing !== undefined ? [`~ you wearing: ${made.wearing}`] : []), ...(made.condition !== undefined ? [`~ you condition: ${made.condition}`] : [])];
const shownAt = (host, at) => displayLines(host.ctx.chat[at].mes, { entryOf: word => host.registry.capture(word) });

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
        const host = await createHost({ settings: { features: { 'story-block.choices': true, 'story-block.chatter': true } } });
        // A pack that gives Your look a Rank, so the `~ you rank:` lines are read (without one they are refused).
        await host.packs.packs.install({ id: 'guild', version: '1.0.0', requires: { storyBlock: '^2' }, content: { you: { rank: { label: 'Guild rank' } } } });
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
            made.extras = extraLines(step);
            made.weather = weatherLines(step);
            made.mounts = mountLines(step, done);
            made.you = youOf(step);
            await host.send(`Step ${step}.`, (step % 4 === 1 ? strayReply : reply)(`Step ${step} goes on.`, [...made.weather, ...youLines(made.you), ...made.mounts, ...made.lines, ...made.extras]));
            const index = host.store.headIndex();
            assert.deepEqual(host.turn.problems().filter(problem => problem.index === index), [], `seed ${seed} step ${step}: the lines are clean`);
            done.set(host.store.carrierSid(index), made);
            if (made.loot && r.chance(0.7)) {
                // The reader takes the first thing, or both (claim loot:<sid>; the receipt lands on this reply).
                const both = r.chance(0.5);
                const taken = await host.sdk.command('inventory.lootTake', { sid: host.store.carrierSid(index), pick: both ? [0, 1] : [0] });
                assert.equal(taken.ok, true, `seed ${seed} step ${step}: loot taken (${taken.message})`);
                made.own.push(made.loot[0]);
                if (both) made.relics = made.loot[1];
                assert.equal((await host.sdk.command('inventory.lootTake', { sid: host.store.carrierSid(index), pick: [1] })).ok, false, 'once per reply');
            }
            if (step < 3 || !r.chance(0.35)) continue;
            // Delete a reply in the middle (after the set-up, not the last) and the reader's message before it.
            const replies = host.ctx.chat.map((message, at) => (!message.is_user && at > setup && at < index ? at : -1)).filter(at => at >= 0);
            if (!replies.length) continue;
            const gone = r.pick(replies);
            const goneSid = host.store.carrierSid(gone);
            done.delete(goneSid);
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
            for (const made of kept) if (made.relics) assert.equal(qty(host, made.relics), 2, `${label}: ${made.relics}`);
            for (const [at, message] of host.ctx.chat.entries()) {
                const made = message.is_user ? null : done.get(host.store.carrierSid(at));
                if (!made) continue;
                const shown = shownAt(host, at);
                assert.deepEqual((shown.choice ?? []).map(item => item.text), made.extras.length ? [made.extras[0].slice('? choice '.length)] : [], `${label}: reply ${at}'s choices`);
                assert.equal((shown.chatter ?? []).length, made.extras.length ? 1 : 0, `${label}: reply ${at}'s chatter`);
            }
            assert.equal(Object.hasOwn(host.head().domains.inventory.loot ?? {}, goneSid), false, `${label}: the deleted reply's loot went with it`);
            const inOrder = host.ctx.chat.map((message, at) => (message.is_user ? null : done.get(host.store.carrierSid(at)))).filter(Boolean);
            assert.deepEqual(host.sdk.query('mounts.list').map(row => [row.name, row.condition]), mountsAfter(inOrder), `${label}: the mounts`);
            const sky = host.ctx.chat.map((message, at) => (message.is_user ? null : done.get(host.store.carrierSid(at)))).filter(made => made?.weather.length).at(-1);
            assert.deepEqual(host.sdk.query('scene.weather'), sky ? { text: sky.weather[0].slice('~ weather '.length) } : null, `${label}: the weather`);
            const remaining = host.ctx.chat.map((message, at) => (message.is_user ? null : done.get(host.store.carrierSid(at)))).filter(Boolean);
            const look = part => remaining.filter(made => made.you[part] !== undefined).at(-1)?.you[part] ?? '';
            assert.deepEqual(host.sdk.query('scene.you'), { rank: look('rank'), rankLabel: 'Guild rank', wearing: look('wearing'), condition: look('condition') }, `${label}: your look, each part from the latest reply still there that wrote it`);
        }
    });
}
