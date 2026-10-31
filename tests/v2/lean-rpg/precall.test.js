// The pre-call on the real host (testkit createHost: registry, command bus, store, turn): when it asks the model and
// when it does not, what it asks, and what happens when the answer does not come.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { NO_ROLLS_LINE, NOTE_SETTING, ROLLS_SETTING, createLeanRpgPart, createPlanHold, createPrecall, precallPrompt, readSheet } from '../../../src/v2/lean-rpg/index.js';
import { PRECALL_HEAD, ANSWER_TOKENS, MESSAGE_LIMIT } from '../../../src/v2/lean-rpg/precall.js';
import { manualTimer } from '../assist/helpers/fakes.js';
import { NEVER, PARTY, PLAN_ANSWER, foeBlock, rollReceipt, setup, sheetDomain, tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MESSAGE = 'I hit the lead rat with Iron Breath, Ren covers me with Spark.';
const rolled = host => host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === 'rpg.resolve');

test('a message in a fight: one call, the plan is rolled before the reply and told under [Happened]', { skip }, async () => {
    const { host, callModel, problems } = await setup({ settings: { assistProfile: 'cheap' } });
    const { request } = await host.send(MESSAGE, 'The rats scatter.');
    assert.equal(callModel.calls.length, 1);
    const [call] = callModel.calls;
    assert.deepEqual([call.options.maxTokens, call.options.profile, call.options.helper], [ANSWER_TOKENS, 'cheap', 'rolls'], 'Assist\'s connection profile');
    assert.ok(call.prompt.startsWith(PRECALL_HEAD), 'the same head for every message, first');
    assert.ok(call.prompt.endsWith(`The reader's message:\n"""\n${MESSAGE}\n"""`));
    assert.match(call.prompt, /Wessel \(class II\): STR 14 VIT 12 AGI 12 DEX 10 INT 8 LUK 9 CHA 10; Health Unhurt, Mana Fresh, Stamina Fresh; skills: Iron Breath \(Adept, STR\), Spark \(Novice, INT, mana\)/);
    assert.match(call.prompt, /Foes: \n1\. Sluice Rats x6 \(class I, Unhurt\)/);
    const [receipt] = rolled(host);
    assert.ok(receipt);
    assert.equal(receipt.narrate, true);
    assert.equal(receipt.beforeGenerate, true);
    assert.ok(tailOf(request).includes(`[Happened]\n${receipt.summary}`), tailOf(request));
    assert.match(receipt.summary, /^\[Rolls\] Code rolled these\./);
    assert.deepEqual(host.ctx.chat[2].extra.storySuite.narrated, [receipt.id], 'told once: the next prompt does not repeat it');
    assert.deepEqual(problems, []);
    host.close();
});

test('the prompt holds only the end of the last reply (without its change block) and the message cut to its limit', () => {
    const sheet = readSheet({ domains: { dataModules: sheetDomain(PARTY()) } });
    const reply = `${'The drain is dark and the rats are close. '.repeat(40)}Wessel breathes.\n<Changes>\n~ place Drain\n</Changes>`;
    const prompt = precallPrompt({ sheet, message: 'x'.repeat(2000), excerpt: reply.replace(/<Changes>[\s\S]*<\/Changes>/, '').trim() });
    assert.ok(prompt.includes('Wessel breathes.'));
    assert.ok(!prompt.includes('<Changes>'));
    assert.ok(prompt.length < PRECALL_HEAD.length + 600 + MESSAGE_LIMIT + 1200, `${prompt.length} characters`);
    const quoted = prompt.slice(prompt.indexOf('The last reply ended:'), prompt.indexOf("The reader's message"));
    assert.ok(quoted.length < 700);
    assert.match(precallPrompt({ sheet: { characters: sheet.characters, foes: [] }, message: 'hi' }), /Foes: none/);
});

test('the grammar asks for a stat only when there is no skill, and the sheet shows each skill\'s stat and resource', () => {
    const lines = PRECALL_HEAD.split('\n');
    const acts = lines.filter(line => line.startsWith('act <who>')), checks = lines.filter(line => line.startsWith('check <who>'));
    assert.equal(acts.length, 2);
    assert.equal(checks.length, 2);
    assert.ok(acts[0].includes('skill: <skill>') && !/stat|uses/i.test(acts[0]), `a skill act has no stat or uses: ${acts[0]}`);
    assert.ok(acts[1].includes('stat: STR|VIT|AGI|DEX|INT|LUK|CHA') && !acts[1].includes('skill:'), acts[1]);
    assert.ok(checks[0].includes('skill: <skill>') && !/stat|uses/i.test(checks[0]), checks[0]);
    assert.ok(checks[1].includes('stat: <stat>') && !checks[1].includes('skill:'), checks[1]);
    assert.ok(!PRECALL_HEAD.includes('uses:'), 'the pre-call is not asked for what a skill uses');
    assert.match(PRECALL_HEAD, /A skill brings its own stat and what it uses, so write no stat for it; with no skill, write the stat\./);
    const text = precallPrompt({ sheet: readSheet({ domains: { dataModules: sheetDomain(PARTY()) } }), message: 'hi' });
    assert.match(text, /Ren \(class II\)[^\n]*skills: Spark \(Novice, INT, mana\)/);
});

test('no call at all with the feature off, with Rolls off, or with no Character block', { skip }, async () => {
    for (const options of [{ feature: false }, { settings: { [ROLLS_SETTING]: 'off' } }, { blocks: { foes: PARTY().foes } }]) {
        const { host, callModel, problems } = await setup(options);
        const { request } = await host.send(MESSAGE, 'The rats scatter.');
        assert.equal(callModel.calls.length, 0, JSON.stringify(Object.keys(options)));
        assert.deepEqual(rolled(host), []);
        assert.ok(!tailOf(request).includes('[Rolls]') && !tailOf(request).includes(NO_ROLLS_LINE));
        assert.deepEqual(problems, []);
        host.close();
    }
});

test('Rolls is automatic until the reader turns it off', () => {
    const part = createLeanRpgPart();
    assert.deepEqual(part.settings.defaults, { [ROLLS_SETTING]: 'automatic' });
});

test('a Continue, a quiet prompt and an empty message never call', { skip }, async () => {
    const { host, callModel } = await setup();
    await host.send(MESSAGE, 'The rats scatter.');
    assert.equal(callModel.calls.length, 1);
    await host.cont(' More.');
    await host.quiet('A summary.');
    assert.equal(callModel.calls.length, 1);
    host.ctx.chat.push({ is_user: true, mes: '   ', name: 'You' });
    await host.st.generate('normal', { reply: 'Quiet.' });
    assert.equal(callModel.calls.length, 1, 'nothing to read');
    assert.equal(rolled(host).length, 1);
    host.close();
});

test('an answer of none: the reply goes out without rolls and without a held-back line', { skip }, async () => {
    const { host, callModel, problems } = await setup({ answers: ['none'] });
    const { request } = await host.send('I thank the guard.', 'He nods.');
    assert.equal(callModel.calls.length, 1);
    assert.deepEqual(rolled(host), []);
    assert.ok(!tailOf(request).includes('[Rolls]') && !tailOf(request).includes(NO_ROLLS_LINE));
    assert.deepEqual(problems, []);
    host.close();
});

test('a plan that names nothing this sheet can roll is the same as none', { skip }, async () => {
    const { host, problems } = await setup({ answers: ['act Nobody | stat: STR | target: Sluice Rats'] });
    const { request } = await host.send(MESSAGE, 'The rats scatter.');
    assert.deepEqual(rolled(host), []);
    assert.ok(!tailOf(request).includes(NO_ROLLS_LINE));
    assert.deepEqual(problems, []);
    host.close();
});

test('a timeout, a failed call or an unreadable answer: no rolls, a quiet line in the Problems list, no popup', { skip }, async t => {
    for (const [name, make] of [
        ['timeout', () => { const timer = manualTimer(); return { answers: [NEVER], timer, wait: async host => { await new Promise(resolve => setImmediate(resolve)); timer.fire(); return host; } }; }],
        ['failure', () => ({ answers: [new Error('no connection')] })],
        ['garbage', () => ({ answers: ['Wessel swings; the rat squeals.'] })],
        ['empty', () => ({ answers: [''] })],
    ]) {
        await t.test(name, async () => {
            const options = make();
            const { host, problems } = await setup({ answers: options.answers, timer: options.timer });
            const sent = host.send(MESSAGE, 'The rats scatter.');
            if (options.wait) await options.wait(host);
            const { request } = await sent;
            assert.deepEqual(rolled(host), []);
            assert.equal(problems.length, 1);
            assert.equal(problems[0].code, 'ROLLS_SKIPPED');
            assert.equal(problems[0].quiet, true);
            assert.match(problems[0].message, /^Rolls skipped for this reply: .* Swipe to try again\.$/);
            assert.deepEqual(host.st.notices, [], 'never a popup');
            assert.ok(tailOf(request).includes(NO_ROLLS_LINE), 'a fight is on: keep it undecided');
            host.close();
        });
    }
});

test('the timeout is Assist\'s twenty seconds, and with no fight the narrator is told nothing', { skip }, async () => {
    const timer = manualTimer();
    const blocks = PARTY();
    blocks.foes.fields = foeBlock([]);
    const { host, problems } = await setup({ blocks, answers: [NEVER], timer });
    const sent = host.send(MESSAGE, 'Nothing.');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timer.lastMs, 20000);
    timer.fire();
    const { request } = await sent;
    assert.equal(problems.length, 1);
    assert.ok(!tailOf(request).includes(NO_ROLLS_LINE));
    host.close();
});

test('a retried interceptor keeps the plan (one call); a new generation plans anew', { skip }, async t => {
    const { host, callModel } = await setup({ answers: [PLAN_ANSWER, 'none', PLAN_ANSWER] });
    t.after(() => host.close());
    host.ctx.chat.push({ is_user: true, mes: MESSAGE });
    await host.turn.interceptor([], 8192, () => {}, 'normal');
    const seed = host.turn.session().prechecks[0].seed;
    await host.turn.interceptor([], 8192, () => {}, 'normal');
    assert.equal(callModel.calls.length, 1, 'the second attempt reused the plan');
    assert.deepEqual(Object.keys(host.ctx.chatMetadata.rpgPlan).sort(), ['chat', 'key', 'plan'], 'held in the chat\'s metadata while the reply is awaited');
    assert.equal(host.turn.session().prechecks[0].seed, seed, 'and its dice');
    host.turn.onGenerationEnded();
    await host.turn.onChatChanged();
    assert.deepEqual(rolled(host), [], 'an abandoned preview stores nothing');
    await host.regenerate('The rats scatter.');
    assert.equal(callModel.calls.length, 2, 'a regenerate is a new generation');
    assert.deepEqual(rolled(host), [], 'and the model said none this time');
});

test('a chat with no reply yet makes no call (there is nothing to hold the rolls)', { skip }, async t => {
    const { host, callModel, problems } = await setup();
    t.after(() => host.close());
    host.ctx.chat.length = 0;
    host.ctx.chat.push({ is_user: true, mes: MESSAGE, name: 'You' });
    await host.turn.interceptor([], 8192, () => {}, 'normal');
    assert.equal(callModel.calls.length, 0);
    assert.deepEqual(problems, []);
});

test('the held plan is let go once the reply is captured: the chat metadata keeps nothing between replies', { skip }, async () => {
    const { host } = await setup({ answers: [PLAN_ANSWER] });
    await host.send(MESSAGE, 'The rats scatter.');
    assert.equal(rolled(host).length, 1);
    assert.equal(host.ctx.chatMetadata?.rpgPlan, undefined);
    host.close();
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

test('the reader\'s planner note goes after the fixed part of the pre-call, and is cut at 400 characters', { skip }, async () => {
    const { host, callModel } = await setup({ settings: { [NOTE_SETTING]: `Companions play it safe unless I say otherwise.${' x'.repeat(300)}` } });
    await host.send(MESSAGE, 'The rats scatter.');
    const [{ prompt }] = callModel.calls;
    assert.ok(prompt.startsWith(`${PRECALL_HEAD}\n\nPlayer's instructions: Companions play it safe unless I say otherwise.`), 'right after the head, before the party');
    const note = prompt.slice(prompt.indexOf('Player\'s instructions: ') + 'Player\'s instructions: '.length, prompt.indexOf('\n\nParty:'));
    assert.ok([...note].length >= 399 && [...note].length <= 400, 'cut at 400 (and tidied)');
    host.close();
    const plain = await setup();
    await plain.host.send(MESSAGE, 'The rats scatter.');
    assert.ok(!plain.callModel.calls[0].prompt.includes('Player\'s instructions'), 'no note, no line');
    plain.host.close();
});

test('with the feature off none of the RPG settings is read: no note, no numbers, no call', async () => {
    const boom = () => { throw new Error('read'); };
    const precall = createPrecall({ callModel: boom, chat: boom, chatId: boom, hold: createPlanHold() });
    const view = { feature: () => false, settings: boom, state: {} };
    assert.equal(await precall.beforeGenerate(view, { type: 'normal' }), null);
});
