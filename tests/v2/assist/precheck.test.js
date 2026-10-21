// assist.precheck on the real host (testkit createHost: registry, command bus, store, turn): the
// classifier's answer is committed before the reply as one system receipt that claims the message,
// makes the check through the check kind's capture, rolls it with check.roll, and is told to the reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { PRECHECK, ROLLED_LINE, SETTING, claimKey, createAssistPart, hashText, precheck } from '../../../src/v2/assist/index.js';
import { fakeModel } from './helpers/fakes.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const ACTION = 'I slip past the gate guard while he looks at the cart.';
const CHECK = '? check stealth — slipping past the gate guard | dc: hard';
const DC = { easy: 8, normal: 12, hard: 15 };

// A stand-in for RPG Battle's checks (MODULES §F16): the `check` kind makes a pending check
// (`data.check` = its id); `check.roll { id }` rolls it. `pending: false` resolves at once (the
// party part before pending checks); `roll: false` has no check.roll.
function checksModule({ pending = true, roll = true, refuse = false } = {}) {
    return {
        id: 'rpg-battle',
        name: 'RPG Battle',
        domains: { party: { initial: () => ({ checks: {}, made: 0 }) } },
        commands: roll ? {
            'check.roll'(ctx, payload) {
                const party = ctx.draft('party');
                const check = party.checks[payload.id];
                if (!check || check.status !== 'pending') ctx.fail('NOT_FOUND', 'That check is not waiting.');
                const die = ctx.roll('1d20').total;
                const outcome = die >= check.dc ? 'success' : 'failure';
                Object.assign(check, { status: 'rolled', die, outcome });
                return { summary: `You try ${check.skill} (${check.what}): d20 ${die} against ${check.dc}, ${outcome}.`, data: { check: payload.id, die, outcome }, narrate: true };
            },
        } : {},
        capture: {
            kinds: { check: { grammar: '? check skill — what is attempted | dc: easy|normal|hard|<number>' } },
            apply(ctx, line) {
                if (refuse) ctx.fail('REFUSED', 'There is no character to make the check yet.');
                const party = ctx.draft('party');
                const dc = DC[line.labels.dc] ?? Number(line.labels.dc);
                party.made += 1;
                if (!pending) {
                    const die = ctx.roll('1d20').total;
                    const outcome = die >= dc ? 'success' : 'failure';
                    return { summary: `You try ${line.name}: d20 ${die} against ${dc}, ${outcome}.`, data: { die, outcome }, narrate: true };
                }
                const id = `ck_${String(party.made).padStart(8, '0')}`;
                party.checks[id] = { skill: line.name, what: line.text, dc, status: 'pending' };
                return { summary: `A ${line.name} check waits.`, data: { check: id }, narrate: false };
            },
        },
    };
}

async function setup({ answers = [CHECK], checks = {}, classifier = true } = {}) {
    const callModel = fakeModel(...answers);
    let host = null;
    const part = createAssistPart({
        callModel,
        moduleId: 'zz-assist',
        chat: () => host.ctx.chat,
        chatId: () => host.ctx.chatId,
        hasKind: kind => host.registry.kindOf(kind) !== null,
        warn: () => {},
    });
    const assist = { id: 'zz-assist', name: 'Assist', commands: part.commands, queries: part.queries, hooks: part.hooks, settings: part.settings };
    host = await createHost({
        core: false,
        modules: [checksModule(checks), assist],
        settings: { modules: { 'zz-assist': { [SETTING.classifier]: classifier } } },
    });
    return { host, part, callModel };
}

const tailOf = request => request.chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
const party = host => host.head().domains.party;

test('a risky message: the check is made and rolled before the reply, and the reply is told the roll', { skip }, async () => {
    const { host, callModel } = await setup();
    const { request } = await host.send(ACTION, 'You slip by.');
    assert.equal(callModel.calls.length, 1);

    const checks = Object.values(party(host).checks);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].status, 'rolled');
    const key = `1-${hashText(ACTION)}`;
    assert.equal(host.head().meta.claims[claimKey(key)], true);

    // One system receipt on the carrier before the message (the greeting), narrated.
    const record = host.ctx.chat[0].extra.storySuite;
    const receipt = record.receipts.at(-1);
    assert.equal(receipt.type, PRECHECK);
    assert.equal(receipt.cause, 'system');
    assert.equal(receipt.narrate, true);
    assert.match(receipt.summary, /^You try stealth \(slipping past the gate guard\): d20 \d+ against 15, (success|failure)\.$/);
    assert.deepEqual(Object.keys(receipt.data).sort(), ['check', 'dc', 'key', 'outcome', 'rolled', 'skill']);
    assert.equal(receipt.data.rolled, true);
    assert.equal(receipt.data.outcome, checks[0].outcome);

    const tail = tailOf(request);
    assert.ok(tail.includes(`[Happened]\n${receipt.summary}`), tail);
    assert.ok(tail.includes(ROLLED_LINE));
    assert.deepEqual(host.ctx.chat[2].extra.storySuite.narrated, [receipt.id]);

    // Replay equals rebuild.
    const before = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), before);
    host.close();
});

test('re-narrating never re-rolls: a swipe or a regenerate is told the same roll, with no new call', { skip }, async () => {
    const { host, callModel } = await setup();
    await host.send(ACTION, 'You slip by.');
    const summary = host.ctx.chat[0].extra.storySuite.receipts.at(-1).summary;
    const { request } = await host.swipe('Another telling.');
    assert.ok(tailOf(request).includes(summary));
    const again = await host.regenerate('A third telling.');
    assert.ok(tailOf(again.request).includes(summary));
    assert.equal(callModel.calls.length, 1);
    assert.equal(Object.keys(party(host).checks).length, 1);
    assert.equal(party(host).made, 1);
    host.close();
});

test('none, garbage or off: no receipt and nothing changes', { skip }, async () => {
    for (const options of [{ answers: ['none'] }, { answers: ['You slip by unseen.'] }, { classifier: false }]) {
        const { host, callModel } = await setup(options);
        const rev = host.head().meta.rev;
        await host.send(ACTION, 'You slip by.');
        assert.equal(party(host).made, 0);
        assert.equal(host.head().meta.rev, rev);
        assert.equal(callModel.calls.length, options.classifier === false ? 0 : 1);
        host.close();
    }
});

test('a check kind that resolves at once is kept as it is; without check.roll the check stays pending', { skip }, async () => {
    const now = await setup({ checks: { pending: false } });
    await now.host.send(ACTION, 'You slip by.');
    const resolved = now.host.ctx.chat[0].extra.storySuite.receipts.at(-1);
    assert.match(resolved.summary, /^You try stealth: d20 \d+ against 15/);
    assert.equal(resolved.data.check, null);
    assert.equal(resolved.data.rolled, false);
    now.host.close();

    const waiting = await setup({ checks: { roll: false } });
    await waiting.host.send(ACTION, 'You slip by.');
    const left = waiting.host.ctx.chat[0].extra.storySuite.receipts.at(-1);
    assert.equal(left.summary, 'A stealth check waits.');
    assert.equal(left.data.rolled, false);
    assert.equal(Object.values(party(waiting.host).checks)[0].status, 'pending');
    waiting.host.close();
});

test('rejections save nothing: a refused check, a second pre-roll of the same message, a bad payload', { skip }, async () => {
    const refused = await setup({ checks: { refuse: true } });
    const rev = refused.host.head().meta.rev;
    await refused.host.send(ACTION, 'You slip by.');
    assert.equal(refused.host.head().meta.rev, rev);
    assert.deepEqual(refused.host.head().meta.claims, {});
    assert.match(refused.host.turn.problems().at(-1).message, /assist\.precheck.*There is no character/);
    refused.host.close();

    const { host } = await setup();
    await host.send(ACTION, 'You slip by.');
    const state = JSON.stringify(host.head());
    const payload = { key: `1-${hashText(ACTION)}`, line: { op: '?', kind: 'check', name: 'stealth', text: 'again', labels: { dc: 'hard' } } };
    const second = await host.sdk.command(PRECHECK, payload, { cause: 'system' });
    assert.equal(second.code, 'CLAIMED');
    for (const bad of [{ ...payload, key: 'nope' }, { ...payload, key: '9-abc', line: { op: '?', kind: 'check', name: 'stealth', labels: {} } }, {}]) {
        assert.equal((await host.sdk.command(PRECHECK, bad, { cause: 'system' })).code, 'INVALID');
    }
    assert.equal(JSON.stringify(host.head()), state);
    host.close();
});

test('the handler on its own: a check kind that is missing fails the command', () => {
    const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
    const ctx = {
        claim: () => true,
        call: type => fail('UNKNOWN_COMMAND', `There is no command called "${type}".`),
        fail,
    };
    assert.throws(() => precheck(ctx, { key: '1-abc', line: { op: '?', kind: 'check', name: 'stealth', labels: { dc: 'hard' } } }), /capture\.check/);
});
