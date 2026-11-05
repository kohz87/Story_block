// The planner time limit (Settings → RPG → Rolls) and the no-rolls note on a reply (approved mockup rpg-no-rolls.html):
// * the setting: 10 to 120 seconds on a step of 5, 45 unset (old saved settings have no key), read by the planner's call and its hook at call time;
// * the note: a live fight (a filled foe with health) whose planner timed out, failed or gave an unreadable answer leaves `rpg.noroll` on the reply
//   (a prelude receipt, add-only, keyed by the reply), drawn where the battle log would stand; it survives a reload, a rebuild and a Re-read, a swipe
//   that rolls replaces it, and it is never part of the prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { NO_ROLLS_LINE, NOROLL, PLANNER_LIMIT, PLANNER_LIMIT_SETTING, RESOLVE, SETTINGS_SCHEMA, createLeanRpgPart, plannerSecondsFrom, plannerSecondsOf } from '../../../src/v2/lean-rpg/index.js';
import { noRoll, noRollOf } from '../../../src/v2/lean-rpg/noroll.js';
import { readRecord } from '../../../src/v2/persist.js';
import { buildNote, noteText } from '../../../src/v2/lean-rpg/view/battle-log.js';
import { manualTimer } from '../assist/helpers/fakes.js';
import { NEVER, OWNER, PARTY, PLAN_ANSWER, foeBlock, setup, tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MESSAGE = 'I hit the lead rat with Iron Breath, Ren covers me with Spark.';
const receiptsOf = (host, index = 2) => readRecord(host.ctx.chat[index])?.receipts ?? [];
const noteOf = (host, index = 2) => noRollOf(receiptsOf(host, index));
const rollsOn = (host, index = 2) => receiptsOf(host, index).filter(receipt => receipt.type === RESOLVE);
const tick = () => new Promise(resolve => setImmediate(resolve));
// A send whose planner times out: the manual timer fires the planner's limit once the call is waiting.
async function timedOut(options = {}) {
    const timer = manualTimer();
    const made = await setup({ ...options, answers: [NEVER], timer });
    const sent = made.host.send(MESSAGE, 'The rats scatter.');
    await tick();
    const ms = timer.lastMs;
    timer.fire();
    return { ...made, ms, request: (await sent).request };
}

// ---- the setting ----------------------------------------------------------------------------------------------------

test('Planner time limit: 10 to 120 seconds on a step of 5, 45 unset; old settings without the key get 45', () => {
    assert.deepEqual([PLANNER_LIMIT.min, PLANNER_LIMIT.max, PLANNER_LIMIT.step, PLANNER_LIMIT.default], [10, 120, 5, 45]);
    assert.equal(createLeanRpgPart().settings.defaults[PLANNER_LIMIT_SETTING], 45);
    const field = SETTINGS_SCHEMA[PLANNER_LIMIT_SETTING];
    assert.deepEqual([field.type, field.min, field.max, field.group], ['int', 10, 120, 'RPG']);
    assert.equal(plannerSecondsFrom({}), 45, 'a saved settings object from before has no key');
    assert.equal(plannerSecondsFrom(undefined), 45);
    for (const [raw, kept] of [[10, 10], [120, 120], [75, 75], [5, 10], [0, 10], [500, 120], [47, 45], [48, 50], [12.4, 10], ['90', 45], ['x', 45], [null, 45], [NaN, 45]]) {
        assert.equal(plannerSecondsFrom({ [PLANNER_LIMIT_SETTING]: raw }), kept, String(raw));
    }
    assert.equal(plannerSecondsOf(45), 45);
    assert.equal(plannerSecondsOf(46), null);
});

test('the planner\'s call and its hook use the setting, read when the reply asks (Assist\'s other helpers keep 20 s)', { skip }, async t => {
    const timer = manualTimer();
    const { host, callModel, part } = await setup({ answers: [NEVER], timer, settings: { [PLANNER_LIMIT_SETTING]: 90 } });
    t.after(() => host.close());
    assert.equal(part.hooks.beforeGenerate.timeoutMs, 92000, 'the hook is given the limit and a little more');
    host.settings.stored(OWNER)[PLANNER_LIMIT_SETTING] = 60;
    assert.equal(part.hooks.beforeGenerate.timeoutMs, 62000, 'it follows the setting at call time');
    const sent = host.send(MESSAGE, 'The rats scatter.');
    await tick();
    assert.equal(timer.lastMs, 60000, 'the planner\'s timer');
    assert.equal(callModel.calls[0].options.timeoutMs, 60000, 'and the model call is given the same limit');
    timer.fire();
    await sent;
});

test('a part built with a fixed limit keeps it (tests), and the default hook limit is 45 s plus the margin', () => {
    assert.equal(createLeanRpgPart({ timeoutMs: 5000 }).hooks.beforeGenerate.timeoutMs, 7000);
    assert.equal(createLeanRpgPart().hooks.beforeGenerate.timeoutMs, 47000);
});

test('the real host: the merged hook\'s limit and the model call follow the setting too', { skip }, async t => {
    const { createHost } = await import('../../../testkit/index.js');
    const host = await createHost({});
    t.after(() => host.close());
    const hook = () => host.registry.hookEntries('beforeGenerate').find(entry => entry.moduleId === OWNER)?.fn;
    const before = hook().timeoutMs;
    assert.ok(before >= 47000, `${before}`);
    host.settings.stored(OWNER)[PLANNER_LIMIT_SETTING] = 100;
    assert.equal(hook().timeoutMs, before + 55000, 'the hook of the core module follows the setting without a restart');
    host.settings.stored(OWNER)[PLANNER_LIMIT_SETTING] = 10;
    assert.equal(hook().timeoutMs, before - 35000);
});

// ---- the record ------------------------------------------------------------------------------------------------------

test('a timeout, a failed call and an unreadable answer in a live fight leave the note on the reply, with the limit used for a timeout', { skip }, async t => {
    for (const [name, reason, make] of [
        ['timeout', 'timeout', () => timedOut({ settings: { [PLANNER_LIMIT_SETTING]: 30 } })],
        ['failure', 'failed', () => setup({ answers: [new Error('no connection')] })],
        ['garbage', 'unreadable', () => setup({ answers: ['Wessel swings; the rat squeals.'] })],
    ]) {
        await t.test(name, async () => {
            const made = await make();
            if (name !== 'timeout') await made.host.send(MESSAGE, 'The rats scatter.');
            assert.deepEqual(noteOf(made.host), reason === 'timeout' ? { reason, limit: 30 } : { reason }, 'the reply keeps what happened');
            if (reason === 'timeout') assert.equal(made.ms, 30000);
            const receipt = receiptsOf(made.host).find(entry => entry.type === NOROLL);
            assert.equal(receipt.beforeGenerate, true);
            assert.equal(receipt.narrate, false);
            assert.equal(rollsOn(made.host).length, 0);
            assert.equal(made.problems.length, 1, 'the Problems line stays');
            assert.equal(made.problems[0].code, 'ROLLS_SKIPPED');
            assert.equal(made.host.head().meta.claims?.[`rpg:resolve:${receipt.data.v2.skip.key}`], undefined, 'no claim: a retry or a swipe plans again');
            made.host.close();
        });
    }
});

test('no note for "none", outside a live fight, with Rolls off, or when the plan rolled', { skip }, async t => {
    const none = await setup({ answers: ['none'] });
    await none.host.send(MESSAGE, 'The rats scatter.');
    assert.equal(noteOf(none.host), null, '"none" is an answer, not a failure');
    none.host.close();

    const blocks = PARTY();
    blocks.foes.fields = foeBlock([]);
    const noFoe = await setup({ blocks, answers: [new Error('no connection')] });
    await noFoe.host.send('I look around.', 'Quiet.');
    const calls = noFoe.callModel.calls.length;
    await noFoe.host.send(MESSAGE, 'Nothing.');
    assert.equal(noteOf(noFoe.host, 2), null);
    assert.equal(noteOf(noFoe.host, 4), null, 'a failed plan with no fight is quiet, as today');
    assert.ok(noFoe.callModel.calls.length >= calls);
    noFoe.host.close();

    const off = await setup({ answers: [new Error('no connection')], settings: { rpgRolls: 'off' } });
    await off.host.send(MESSAGE, 'The rats scatter.');
    assert.equal(noteOf(off.host), null);
    assert.equal(off.callModel.calls.length, 0);
    off.host.close();

    const rolled = await setup({ answers: [PLAN_ANSWER] });
    await rolled.host.send(MESSAGE, 'The rats scatter.');
    assert.equal(noteOf(rolled.host), null);
    assert.equal(rollsOn(rolled.host).length, 1);
    rolled.host.close();
    t.diagnostic('done');
});

test('the note is never part of the prompt: the request is byte-identical to the one the narrator got before the note existed', { skip }, async t => {
    const made = await setup({ answers: [new Error('no connection')] });
    t.after(() => made.host.close());
    const { request } = await made.host.send(MESSAGE, 'The rats scatter.');
    assert.ok(tailOf(request).includes(NO_ROLLS_LINE), 'the narrator\'s tail is unchanged');
    assert.ok(!/roll planner|Settings → Assist|Swipe to try again/.test(JSON.stringify(request.chat)), 'nothing of the note');
    // The same send with the hook as it answered before the note existed (its lines only): the same bytes.
    const plain = await setup({ answers: [new Error('no connection')], bare: true });
    t.after(() => plain.host.close());
    const again = await plain.host.send(MESSAGE, 'The rats scatter.');
    const hold = { chat: again.request.chat };
    assert.equal(noteOf(plain.host), null, 'this host kept no note');
    assert.deepEqual(request.chat, hold.chat);
});

test('the note survives a reload, a rebuild and a Re-read, and replay equals live', { skip }, async t => {
    const made = await setup({ answers: [new Error('no connection')] });
    t.after(() => made.host.close());
    const { host } = made;
    await host.send(MESSAGE, 'The rats scatter.');
    const note = noteOf(host);
    assert.deepEqual(note, { reason: 'failed' });
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story');
    assert.deepEqual(noteOf(host), note, 'after a rebuild');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live story');
    assert.deepEqual(noteOf(host), note, 'after a reload');
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.deepEqual(noteOf(host), note, 'after a Re-read');
    assert.equal(receiptsOf(host).filter(receipt => receipt.type === NOROLL).length, 1, 'still one');
    assert.equal(JSON.stringify(host.head()), live);
});

test('a swipe that rolls replaces the note; a swipe that fails again carries a note of its own', { skip }, async t => {
    const made = await setup({ answers: [new Error('no connection'), PLAN_ANSWER, 'The rat squeals.'] });
    t.after(() => made.host.close());
    const { host } = made;
    await host.send(MESSAGE, 'The rats scatter.');
    assert.deepEqual(noteOf(host), { reason: 'failed' });
    await host.swipe('Another telling.');
    assert.equal(rollsOn(host).length, 1, 'the swipe rolled');
    assert.equal(noteOf(host), null, 'and the note went with the first telling');
    await host.swipe('A third telling.');
    assert.equal(rollsOn(host).length, 0);
    assert.deepEqual(noteOf(host), { reason: 'unreadable' }, 'the third telling has its own');
});

// ---- the command and the reader ---------------------------------------------------------------------------------------

test('rpg.noroll is made by Story Block only, takes a key and one of the three reasons, and says nothing to the narrator', () => {
    const ctx = (over = {}) => ({ cause: 'system', caller: null, fail: (code, message) => { throw Object.assign(new Error(message), { code }); }, ...over });
    assert.throws(() => noRoll(ctx({ cause: 'ui' }), { key: '2-abc', reason: 'failed' }), { code: 'REFUSED' });
    assert.throws(() => noRoll(ctx(), { key: 'x', reason: 'failed' }), { code: 'INVALID' });
    assert.throws(() => noRoll(ctx(), { key: '2-abc', reason: 'none' }), { code: 'INVALID' });
    const done = noRoll(ctx(), { key: '2-abc', reason: 'timeout', limit: 45 });
    assert.deepEqual([done.summary, done.narrate], ['', false]);
    assert.deepEqual(done.data.v2.skip, { v: 1, key: '2-abc', reason: 'timeout', limit: 45 });
    assert.equal(noRoll(ctx(), { key: '2-abc', reason: 'failed', limit: 45 }).data.v2.skip.limit, undefined, 'a limit goes only with a timeout');
    assert.equal(noRollOf([{ type: NOROLL, data: { v2: { skip: { v: 1, reason: 'bogus' } } } }, { type: 'other' }, null]), null, 'a damaged record is no note');
    assert.deepEqual(noRollOf([{ type: NOROLL, data: { v2: { skip: done.data.v2.skip } } }]), { reason: 'timeout', limit: 45 });
});

// ---- the wording and the slot ------------------------------------------------------------------------------------------

test('the words are the mockup\'s, the timeout names the limit used', () => {
    assert.equal(noteText({ reason: 'timeout', limit: 45 }), 'the roll planner did not answer within 45 s. Swipe to try again, or pick a faster connection in Settings → Assist.');
    assert.equal(noteText({ reason: 'failed' }), 'the roll planner’s call failed. Swipe to try again; Settings → Diagnostics has the error.');
    assert.equal(noteText({ reason: 'unreadable' }), 'the roll planner’s answer could not be read. Swipe to try again.');
    const made = [];
    const doc = { createElement: tag => { const node = { tag, className: '', children: [], attrs: {}, set textContent(value) { this.text = value; }, get textContent() { return this.text ?? this.children.map(child => child.textContent ?? child.data).join(''); }, setAttribute(key, value) { this.attrs[key] = value; }, append(...nodes) { this.children.push(...nodes); } }; made.push(node); return node; }, createTextNode: data => ({ data }) };
    const node = buildNote(doc, { reason: 'timeout', limit: 60 }, { variant: 'card', index: 2 });
    assert.equal(node.textContent, 'No rolls this reply: the roll planner did not answer within 60 s. Swipe to try again, or pick a faster connection in Settings → Assist.');
    assert.deepEqual([node.attrs['data-variant'], node.attrs['data-ss-index'], node.className.includes('rpg-battle')], ['card', '2', true], 'the same slot and roots as the log');
});
