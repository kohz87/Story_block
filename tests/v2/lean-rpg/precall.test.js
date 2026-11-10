// The RPG's beforeGenerate hook on the real host (testkit createHost: registry, command bus, store, turn): Rolls setting default, Assist's pre-roll stepping aside,
// merged hook limits, and the "send without the RPG" flag. The roll planner is gone; where a test needs a planned roll it uses the test-only legacy planner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { ROLLS_SETTING, createLeanRpgPart, createPrecall } from '../../../src/v2/lean-rpg/index.js';
import { PARTY, PLAN_ANSWER, setup, sheetDomain, tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MESSAGE = 'I hit the lead rat with Iron Breath, Ren covers me with Spark.';
const rolled = host => host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === 'rpg.resolve');

test('Rolls is automatic until the reader turns it off', () => {
    const part = createLeanRpgPart();
    assert.deepEqual(part.settings.defaults, { [ROLLS_SETTING]: 'automatic', rpgPracticePerUse: 3, rpgXpRate: 100, rpgLevelCap: 99, rpgAutoCap: 3, rpgPrecheck: true, rpgChecks: true });
});

test('Assist\'s pre-roll steps aside while the RPG is on and the chat has a Character block, and not otherwise', async () => {
    const { createClassifier } = await import('../../../src/v2/assist/classifier.js');
    const { SETTING } = await import('../../../src/v2/assist/common.js');
    const { fakeModel } = await import('../assist/helpers/fakes.js');
    const sheetState = blocks => ({ v: 2, meta: { rev: 0, claims: {} }, domains: { dataModules: sheetDomain(blocks) } });
    const ask = async ({ feature, blocks }) => {
        const callModel = fakeModel('none');
        const classifier = createClassifier({
            callModel, settings: () => ({ [SETTING.classifier]: true, [SETTING.profile]: '' }), chat: () => [{ is_user: false, mes: 'Hello.' }, { is_user: true, mes: 'I sneak past the guard.' }],
            chatId: () => 'c', hasKind: () => true, log: { add: entry => entry }, warn: () => {},
        });
        await classifier.beforeGenerate({ state: sheetState(blocks), feature: id => feature && id === 'story-block.rpg', chat: { length: 2, lastUser: '' } }, { type: 'normal' });
        return callModel.calls.length;
    };
    assert.equal(await ask({ feature: true, blocks: PARTY() }), 0, 'on, with a Character block: no call');
    assert.equal(await ask({ feature: false, blocks: PARTY() }), 1, 'feature off: Assist as before');
    assert.equal(await ask({ feature: true, blocks: { foes: PARTY().foes } }), 1, 'on, but no Character block: Assist as before');
});

test('with the feature off none of the RPG settings is read: no note, no numbers', async () => {
    const boom = () => { throw new Error('read'); };
    const precall = createPrecall({ chat: boom, metadata: boom });
    const view = { feature: () => false, settings: boom, state: {} };
    assert.equal(await precall.beforeGenerate(view, { type: 'normal' }), null);
});

// ---- hooks: the part's limit, merged hooks, and the no-dice flag ------------------------------------------------------

test('B3: merged beforeGenerate hooks each keep their own limit: a slow part is reported and the others\' lines and commands stay', async () => {
    const { mergeParts } = await import('../../../src/v2/domains/index.js');
    const slow = Object.assign(() => new Promise(() => {}), { timeoutMs: 60 });
    const merged = mergeParts([
        { hooks: { beforeGenerate: () => ['first'] } },
        { hooks: { beforeGenerate: slow } },
        { hooks: { beforeGenerate: () => { throw new Error('bad'); } } },
        { hooks: { beforeGenerate: () => ({ lines: ['last'], commands: [{ type: 'x.y' }] }) } },
    ]);
    // (A declared limit below the generic one is not used: hookTimeout never shortens a hook.)
    const started = Date.now();
    const out = await Promise.race([merged.hooks.beforeGenerate({}), new Promise(resolve => setTimeout(resolve, 4000, 'late'))]);
    assert.notEqual(out, 'late');
    assert.ok(Date.now() - started >= 2400, 'the slow part got the generic 2.5 s');
    assert.deepEqual(out.lines, ['first', 'last']);
    assert.deepEqual(out.commands, [{ type: 'x.y' }]);
    assert.deepEqual(out.problems.map(entry => entry.code), ['TIMEOUT', 'FAILED']);
    assert.ok(merged.hooks.beforeGenerate.timeoutMs > 4 * 2500);
});

test('"Send without the RPG for now": the next reply is sent with no pre-call and no dice, then the flag goes and the one after is planned as usual', { skip }, async () => {
    const { host, callModel } = await setup({ answers: [PLAN_ANSWER] });
    host.ctx.chatMetadata = { storySuite: { rpgStart: { asked: true, skip: true } } };
    const { request } = await host.send(MESSAGE, 'The rats scatter.');
    assert.equal(callModel.calls.length, 0, 'no model call');
    assert.deepEqual(rolled(host), [], 'no dice');
    assert.equal(tailOf(request).includes('[Rolls]'), false);
    assert.deepEqual(host.ctx.chatMetadata.storySuite, { rpgStart: { asked: true } }, 'the flag is let go once the reply is captured; the choice stays');
    await host.send(MESSAGE, 'The rats scatter again.');
    assert.equal(callModel.calls.length, 1, 'planned as usual');
    assert.equal(rolled(host).length, 1);
    host.close();
});

test('the no-dice flag is only for a normal send, and a chat that never used it gets nothing written for it, with the feature on or off', { skip }, async () => {
    for (const feature of [true, false]) {
        const { host } = await setup({ answers: [PLAN_ANSWER], feature });
        host.ctx.chatMetadata = { storySuite: { other: 1 }, keep: true };
        const before = JSON.stringify(host.ctx.chatMetadata);
        await host.send(MESSAGE, 'The rats scatter.');
        await host.swipe('Again.');
        assert.equal(JSON.stringify(host.ctx.chatMetadata).includes('rpgStart'), false, `feature ${feature}: nothing written`);
        assert.deepEqual(host.ctx.chatMetadata.storySuite, JSON.parse(before).storySuite, `feature ${feature}: the chat's own notes are as they were`);
        host.close();
    }
    // A swipe is planned even while the flag is still set (it is for the send that follows the choice).
    const { host, callModel } = await setup({ answers: [PLAN_ANSWER] });
    await host.send(MESSAGE, 'The rats scatter.');
    host.ctx.chatMetadata = { storySuite: { rpgStart: { skip: true } } };
    const calls = callModel.calls.length;
    await host.swipe('Swiped.');
    assert.equal(callModel.calls.length, calls + 1, 'a swipe plans');
    host.close();
});
