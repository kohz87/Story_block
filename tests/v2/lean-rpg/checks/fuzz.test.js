// A replay fuzz for story checks on the real host: sends, swipes, regenerates, Re-reads, deletes and reloads in a seeded random order, with replies that
// carry `? roll` lines (one that uses the reply's first die, one for no one, one with a die it was not offered, one for a skill the person lacks).
// After every step the cold rebuild and a reload of the chat file equal the live story; a Re-read leaves a reply's dice and results as they were; a swipe
// draws new dice; a utility skill's practice is never moved by a reply that is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../../testkit/index.js';
import { LEAN_RPG_FEATURE } from '../../../../src/v2/lean-rpg/index.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { checksOf } from '../../../../src/v2/lean-rpg/practice.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { reply, success } from '../../data-modules/helpers.js';
import { tailOf } from '../helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const definitionOf = name => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition);
const NOTE = /Dice for this reply, in order: (\d+), (\d+), (\d+)\./u;

function prng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// A reply written once the request is built, so its check lines name the dice the note gave.
const withChecks = (host, text, random) => (random() < 0.4 ? text : { toString() {
    const found = NOTE.exec(tailOf(host.st.requests.at(-1)));
    if (!found) return text;
    return `${text}\n<Changes>\n? roll Astra | Obscure | normal | ${found[1]}\n? roll Nobody | cha | easy | ${found[2]}\n? roll Astra | juggling | hard | ${found[2]}\n? roll Astra | cha | very hard | ${found[3]}\n</Changes>`;
} });
const records = host => host.ctx.chat.map((message, index) => ({ index, record: message.extra?.storySuite })).filter(entry => entry.record && entry.index > 0);
const diceAt = (host, index) => host.ctx.chat[index].extra?.storySuite?.receipts?.find(receipt => receipt.type === 'rpg.dice')?.data.v2.dice.list ?? null;

let kept = 0;
for (const seed of process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : [1, 2, 3, 4, 5, 6]) {
    test(`story checks replay fuzz, seed ${seed}`, { skip }, async t => {
        t.after(seedCrypto(seed * 101));
        const random = prng(seed * 7919);
        const host = await createHost();
        t.after(() => host.close());
        host.features.set(LEAN_RPG_FEATURE, true);
        await host.send('Begin.', 'Opening.');
        for (const name of ['Character', 'Skills']) success(await host.sdk.command('dm.define', { definition: definitionOf(name) }));
        success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 20, dex: 12, cha: 10 } }));
        success(await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { who: 'Astra' } }));
        await host.send('Learn.', reply('~ dm skills — learned | kind: learn-1 | name: Obscure | about: Slip into shadow. | stat: dex | uses: mana | type: utility'));
        const trail = [];
        for (let step = 0; step < 24; step += 1) {
            const chat = host.ctx.chat, lastIsReply = chat.length > 1 && !chat.at(-1).is_user, roll = random();
            const replies = chat.map((message, index) => index).filter(index => index > 0 && !chat[index].is_user);
            if (roll < 0.35 || chat.length < 2) { trail.push('send'); await host.send(`Move ${step}.`, withChecks(host, `Reply ${step}.`, random)); }
            else if (roll < 0.5 && lastIsReply) {
                trail.push('swipe');
                const before = diceAt(host, chat.length - 1);
                await host.swipe(withChecks(host, `Swiped ${step}.`, random));
                const after = diceAt(host, host.ctx.chat.length - 1);
                if (before && after) assert.notDeepEqual(after, before, 'a swipe draws new dice');
            } else if (roll < 0.62 && lastIsReply) { trail.push('regenerate'); await host.regenerate(withChecks(host, `Again ${step}.`, random)); }
            else if (roll < 0.78 && replies.length) {
                trail.push('reread');
                const target = replies[Math.floor(random() * replies.length)];
                const dice = diceAt(host, target), results = checksOf(host.ctx.chat[target].extra.storySuite.receipts);
                success(await host.turn.reread(target));
                assert.deepEqual(diceAt(host, target), dice, 'a Re-read keeps the dice');
                assert.deepEqual(checksOf(host.ctx.chat[target].extra.storySuite.receipts), results, 'and the results');
            } else if (roll < 0.9 && replies.some(index => index > 4)) {
                // (the sheet's own replies, the first four, stay: a story check needs its Character, and a middle delete of the reply that made it takes it away)
                trail.push('delete');
                const later = replies.filter(index => index > 4), target = later[Math.floor(random() * later.length)];
                await host.st.deleteMessage(target);
                if (random() < 0.5 && host.ctx.chat[target - 1]?.is_user) await host.st.deleteMessage(target - 1);
            } else trail.push('reload');
            const live = JSON.stringify(host.head());
            if (trail.at(-1) === 'reload') {
                await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
                assert.equal(JSON.stringify(host.head()), live, `seed ${seed} step ${step} (${trail.join(' > ')}): a reload gives the live story`);
            }
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live, `seed ${seed} step ${step} (${trail.join(' > ')}): a rebuild gives the live story`);
        }
        kept += records(host).reduce((sum, entry) => sum + checksOf(entry.record.receipts).length, 0);
    });
}

test('the story-check fuzz kept results (so the checks above ran on some)', { skip }, () => {
    assert.ok(kept > 0, `${kept} check results kept over the seeds`);
});
