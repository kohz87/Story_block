// The replay fuzz with plans: sends, swipes, regenerates, Re-reads, deletes (replies and the messages before them),
// edits to the sheet, rebuilds and reloads, in a seeded random order with a pre-call that answers differently each
// time. After every step the cold rebuild and a reload of the chat file equal the live story, no reply holds two
// rolls, every roll holds a claim, nothing is left inactive, and a Re-read leaves the dice as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { RESOLVE, claimKey } from '../../../src/v2/lean-rpg/index.js';
import { PLAN_ANSWER, rollReceipt, setup } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const ANSWERS = [
    PLAN_ANSWER,
    'pace: careful\nact Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats',
    'pace: all\nact Ren | skill: Spark | uses: mana | stat: INT | target: Sluice Rats\nfoe Sluice Rats | target: Ren | defend: VIT',
    'check Wessel | stat: DEX | difficulty: hard',
    'check Ren | skill: Spark | stat: INT | difficulty: easy\nact Wessel | stat: STR | target: foe1',
    'act Wessel | skill: Fire Bolt | stat: STR | target: Sluice Rats',
    'none',
    'The rats squeal.',
    new Error('offline'),
];
const SET = [['wessel', 'str', [6, 14, 20]], ['wessel', 'stamina', [0, 3, 4]], ['ren', 'mana', [0, 4]], ['wessel', 'health', [0, 5]], ['foes', 'class1', [1, 5, 9]], ['foes', 'count1', [0, 4]]];

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

const replies = host => host.ctx.chat.map((message, index) => ({ message, index })).filter(({ message, index }) => index > 0 && !message.is_user);
const resolves = host => host.ctx.chat.flatMap((message, index) => (message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === RESOLVE).map(receipt => ({ index, receipt })));

async function check(host, label) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${label}: a cold rebuild equals the live story`);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, `${label}: a reload equals the live story`);
    const perReply = new Map();
    for (const { index, receipt } of resolves(host)) {
        perReply.set(index, (perReply.get(index) ?? 0) + 1);
        assert.equal(host.head().meta.claims[claimKey(receipt.data.v2.result.key)], true, `${label}: the roll on ${index} holds its claim`);
        assert.equal(receipt.beforeGenerate, true);
        assert.equal(receipt.guarded, true);
    }
    assert.ok([...perReply.values()].every(count => count === 1), `${label}: one roll to a reply`);
    assert.deepEqual(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), [], `${label}: nothing left inactive`);
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    test(`replay fuzz with plans, seed ${seed}`, { skip }, async () => {
        const random = prng(seed * 7919);
        const pick = list => list[Math.floor(random() * list.length)];
        const { host, callModel } = await setup({ answers: [() => { const next = pick(ANSWERS); if (next instanceof Error) throw next; return next; }] });
        const trail = [];
        for (let step = 0; step < 30; step += 1) {
            const chat = host.ctx.chat;
            const lastIsReply = chat.length > 1 && !chat.at(-1).is_user;
            const roll = random();
            let label;
            if (roll < 0.3 || chat.length < 2) { label = 'send'; await host.send(`Move ${step}.`, `Reply ${step}.`); }
            else if (roll < 0.42 && lastIsReply) {
                label = 'swipe';
                const before = rollReceipt(host, chat.length - 1)?.seed;
                await host.swipe(`Swiped ${step}.`);
                const after = rollReceipt(host, host.ctx.chat.length - 1)?.seed;
                if (before !== undefined && after !== undefined) assert.notEqual(after, before, 'a swipe draws new dice');
            } else if (roll < 0.52 && lastIsReply) { label = 'regenerate'; await host.regenerate(`Again ${step}.`); }
            else if (roll < 0.66) {
                label = 'reread';
                const target = pick(replies(host));
                if (target) {
                    const before = resolves(host).find(entry => entry.index === target.index)?.receipt;
                    const done = await host.turn.reread(target.index);
                    assert.equal(done.ok, true, `reread: ${done.message}`);
                    const after = resolves(host).find(entry => entry.index === target.index)?.receipt;
                    if (before) {
                        assert.equal(after?.seed, before.seed, 'a Re-read keeps the seed');
                        assert.equal(after?.summary, before.summary, 'and the dice');
                    } else assert.equal(after, undefined, 'a Re-read does not make rolls');
                }
            } else if (roll < 0.8) {
                label = 'delete';
                const target = pick(replies(host));
                if (target) {
                    await host.st.deleteMessage(target.index);
                    if (random() < 0.5 && host.ctx.chat[target.index - 1]?.is_user) await host.st.deleteMessage(target.index - 1);
                }
            } else if (roll < 0.92) {
                label = 'set';
                const [slug, field, values] = pick(SET);
                await host.bus.command('test.set', { slug, field, value: pick(values) }, { cause: 'system' });
            } else label = 'reload';
            trail.push(label);
            await check(host, `seed ${seed} step ${step} (${trail.join(' > ')})`);
        }
        assert.ok(callModel.calls.length > 0);
        host.close();
    });
}
