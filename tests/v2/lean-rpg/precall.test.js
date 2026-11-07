// The pre-call on the real host (testkit createHost: registry, command bus, store, turn): when it asks the model and
// when it does not, what it asks, and what happens when the answer does not come.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { NO_ROLLS_LINE, NOTE_SETTING, ROLLS_SETTING, createLeanRpgPart, createPlanHold, createPrecall, precallPrompt, readSheet } from '../../../src/v2/lean-rpg/index.js';
import { PRECALL_HEAD, ANSWER_TOKENS, MESSAGE_LIMIT } from '../../../src/v2/lean-rpg/precall.js';
import { manualTimer } from '../assist/helpers/fakes.js';
import { cueOf, NEVER, OWNER, PARTY, PLAN_ANSWER, foeBlock, rollReceipt, setup, sheetDomain, tailOf } from './helpers.js';

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
    assert.match(call.prompt, /Foes: \n1\. Sluice Rats x6 \(Lv 5, Unhurt\)/);
    const [receipt] = rolled(host);
    assert.ok(receipt);
    assert.equal(receipt.narrate, true);
    assert.equal(receipt.beforeGenerate, true);
    assert.ok(tailOf(request).includes(`[Happened]\n${cueOf(receipt)}`), tailOf(request));
    assert.match(cueOf(receipt), /^\[Rolls\] Code rolled these\./);
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

test('the grammar asks for a stat only for a skill the character lacks or no skill, and the sheet shows each skill\'s stat and resource', () => {
    const lines = PRECALL_HEAD.split('\n');
    const acts = lines.filter(line => line.startsWith('act <who>')), checks = lines.filter(line => line.startsWith('check <who>'));
    // (Prompt diet: one act line and one check line, each with the skill and the stat optional, instead of two of each.)
    assert.equal(acts.length, 1);
    assert.equal(checks.length, 1);
    assert.ok(acts[0].includes('skill: <skill>?') && /stat: STR\|VIT\|AGI\|DEX\|INT\|LUK\|CHA\?/.test(acts[0]) && !/uses/i.test(acts[0]), `a skill act may carry a stat (B5): ${acts[0]}`);
    assert.ok(checks[0].includes('skill: <skill>?') && checks[0].includes('stat: <stat>?') && !/uses/i.test(checks[0]), checks[0]);
    assert.ok(!PRECALL_HEAD.includes('uses:'), 'the pre-call is not asked for what a skill uses');
    assert.match(PRECALL_HEAD, /A skill brings its stat: give a stat only for a skill the character lacks, or none\./);
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
    assert.deepEqual(part.settings.defaults, { [ROLLS_SETTING]: 'automatic', rpgPracticePerUse: 3, rpgXpRate: 100, rpgLevelCap: 99, rpgPlannerSeconds: 45, rpgAutoCap: 3 });
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

test('B5: lines that all name nothing on this sheet are a failed plan: the quiet line and, in a fight, the no-rolls cue', { skip }, async () => {
    const { host, problems } = await setup({ answers: ['act Nobody | stat: STR | target: Sluice Rats'] });
    const { request } = await host.send(MESSAGE, 'The rats scatter.');
    assert.deepEqual(rolled(host), []);
    assert.deepEqual(problems.map(entry => entry.code), ['ROLLS_SKIPPED']);
    assert.match(problems[0].message, /none of its line named anyone or anything on the sheet/);
    assert.ok(tailOf(request).includes(NO_ROLLS_LINE));
    host.close();
});

test('B5: a skill the character lacks, and an old Skills block with no stat on its skills, still roll: untrained, with the best stat', { skip }, async () => {
    const blocks = PARTY();
    blocks['ren-skills'].fields = { who: 'Ren', skill1: 'Spark', rank1: 1, practice1: 0 };
    const { host, problems } = await setup({ blocks, answers: ['act Wessel | skill: Sword | target: Sluice Rats\nact Ren | skill: Spark | target: Sluice Rats'] });
    const { request } = await host.send(MESSAGE, 'The rats scatter.');
    const [receipt] = rolled(host);
    assert.ok(receipt, 'both are rolled');
    const lines = receipt.data.v2.result.rounds[0].lines;
    assert.deepEqual(lines.map(line => [line.pc.who, line.skill, line.pc.stat, line.pc.rank]), [['Wessel', null, 'str', 0], ['Ren', null, 'int', 0]]);
    assert.match(tailOf(request), /Wessel has no skill called Sword: rolled untrained with STR, their best stat\./);
    assert.match(tailOf(request), /Ren's Spark has no stat of its own: rolled untrained with INT, their best stat\./);
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

test('the timeout is the Planner time limit setting (45 s unset), and with no fight the narrator is told nothing', { skip }, async () => {
    const timer = manualTimer();
    const blocks = PARTY();
    blocks.foes.fields = foeBlock([]);
    const { host, problems } = await setup({ blocks, answers: [NEVER], timer });
    const sent = host.send(MESSAGE, 'Nothing.');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timer.lastMs, 45000);
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
    assert.ok(prompt.startsWith(`${PRECALL_HEAD}\n\nReader's instructions: Companions play it safe unless I say otherwise.`), 'right after the head, before the party');
    const note = prompt.slice(prompt.indexOf('Reader\'s instructions: ') + 'Reader\'s instructions: '.length, prompt.indexOf('\n\nParty:'));
    assert.ok([...note].length >= 399 && [...note].length <= 400, 'cut at 400 (and tidied)');
    host.close();
    const plain = await setup();
    await plain.host.send(MESSAGE, 'The rats scatter.');
    assert.ok(!plain.callModel.calls[0].prompt.includes('Reader\'s instructions'), 'no note, no line');
    plain.host.close();
});

test('with the feature off none of the RPG settings is read: no note, no numbers, no call', async () => {
    const boom = () => { throw new Error('read'); };
    const precall = createPrecall({ callModel: boom, chat: boom, chatId: boom, hold: createPlanHold() });
    const view = { feature: () => false, settings: boom, state: {} };
    assert.equal(await precall.beforeGenerate(view, { type: 'normal' }), null);
});

// ---- fix round 4: B3, the planner has its own time limit -------------------------------------------------------------

const later = (ms, value) => () => new Promise(resolve => setTimeout(resolve, ms, value));

test('B3: a planner that answers after three seconds is not cut off by the generic hook limit: the dice are rolled', { skip }, async () => {
    const { host, problems } = await setup({ answers: [later(3000, PLAN_ANSWER)] });
    const started = Date.now();
    const { request } = await host.send(MESSAGE, 'The rats scatter.');
    assert.ok(Date.now() - started >= 2900, 'the send waited for the planner');
    assert.equal(rolled(host).length, 1, 'rpg.resolve is recorded');
    assert.ok(tailOf(request).includes('[Rolls]'));
    assert.deepEqual(problems, []);
    assert.deepEqual(host.turn.problems(OWNER).filter(entry => entry.code === 'TIMEOUT'), [], 'no generic timeout');
    host.close();
});

test('B3: the planner\'s own limit still applies: past it the skip path runs (quiet ROLLS_SKIPPED, the no-rolls cue), not a generic TIMEOUT', { skip }, async () => {
    const { host, problems } = await setup({ answers: [NEVER], timeoutMs: 3000 });
    const { request } = await host.send(MESSAGE, 'The rats scatter.');
    assert.deepEqual(rolled(host), []);
    assert.deepEqual(problems.map(entry => entry.code), ['ROLLS_SKIPPED']);
    assert.ok(tailOf(request).includes(NO_ROLLS_LINE), 'the narrator is told to keep the fight undecided');
    assert.deepEqual(host.turn.problems(OWNER).filter(entry => entry.code === 'TIMEOUT'), [], 'no generic timeout');
    host.close();
});

test('B3: the part declares a limit above its call limit, and every hook keeps its own', () => {
    assert.ok(createLeanRpgPart().hooks.beforeGenerate.timeoutMs > 20000);
    assert.ok(createLeanRpgPart({ timeoutMs: 30000 }).hooks.beforeGenerate.timeoutMs > 30000);
});

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

// --- the planner gate (gate.js): the pre-call asks only in a fight, on a risky message, or after a reply that opened foes ---------------------------------------

const { foes: _foes, ...NO_FOES } = PARTY();
const QUIET = { blocks: NO_FOES };

test('gate: a quiet message with no fight open asks nothing, and the reply goes on as one the planner answered "none" to', { skip }, async () => {
    const { host, callModel, problems } = await setup(QUIET);
    const { request } = await host.send('We walk to the market and talk about the weather.', 'They talk.');
    assert.equal(callModel.calls.length, 0);
    assert.deepEqual(rolled(host), []);
    assert.ok(!tailOf(request).includes('[Rolls]') && !tailOf(request).includes(NO_ROLLS_LINE));
    assert.deepEqual(problems, []);
    host.close();
});

test('gate: a risky word in the message asks (attack, sneaking, hits, picks the lock, a skill of the party), a quiet one does not', { skip }, async () => {
    for (const message of ['I attack the guard.', 'I am sneaking past.', 'He hits me hard.', 'She picks the old lock.', 'Wessel threw a stone.', 'I try Iron Breath.', 'I TRY TO CLIMB.']) {
        const { host, callModel } = await setup({ ...QUIET, answers: ['none'] });
        await host.send(message, 'Told.');
        assert.equal(callModel.calls.length, 1, message);
        host.close();
    }
    for (const message of ['I sit down.', 'Tell me about the town.', 'What is her name?']) {
        const { host, callModel } = await setup({ ...QUIET, answers: ['none'] });
        await host.send(message, 'Told.');
        assert.equal(callModel.calls.length, 0, message);
        host.close();
    }
});

test('gate: the review phrases plan (draw, lunge, fire, aim, loose, flee, break, force, search, track, heal); calm "fire" does not, "listen" does (a "none" is cheap)', { skip }, async () => {
    for (const message of ['I draw my sword and lunge at him.', 'I fire at the guard.', 'I aim at the bandit and loose an arrow.', 'I flee into the alley.', 'I try to break down the door.', 'I force the lock.', 'I search the room for traps.', 'I track the wolf.', 'I heal Mira.', 'He hid and then ran.', 'She leapt, he fled, it broke, I drew.', 'I sit by the fire and listen to the rain.']) {
        const { host, callModel } = await setup({ ...QUIET, answers: ['none'] });
        await host.send(message, 'Told.');
        assert.equal(callModel.calls.length, 1, message);
        host.close();
    }
    for (const message of ['I sit by the fire.', 'We rest by the fire.', 'We gather around the fires and eat.']) {
        const { host, callModel } = await setup({ ...QUIET, answers: ['none'] });
        await host.send(message, 'Told.');
        assert.equal(callModel.calls.length, 0, message);
        host.close();
    }
});

test('gate: cutting words open it (the gnasher message); a weapon, a bow or a wound as a noun in a message does not, they stay a cheap pass', { skip }, async () => {
    for (const message of ['I bait the ditch with pork and cut the gnashers down with my cane-sword.', 'I slice through the rope.', 'I hack at the door.', 'I cleave the beam.', 'I butcher the pig.', 'I slaughter the hens.']) {
        const { host, callModel } = await setup({ ...QUIET, answers: ['none'] });
        await host.send(message, 'Told.');
        assert.equal(callModel.calls.length, 1, message);
        host.close();
    }
    for (const message of ['I hang my sword by the fire.', 'I bow to the innkeeper.', 'I polish my sword.', 'I bandage my old scars.', 'We buy arrows in the morning.', 'We pass the war memorial.']) {
        const { host, callModel } = await setup({ ...QUIET, answers: ['none'] });
        await host.send(message, 'Told.');
        assert.equal(callModel.calls.length, 0, message);
        host.close();
    }
});

test('gate: a party skill matches by any word of its name of 4 letters or more, not only by the whole name', { skip }, async () => {
    for (const [message, calls] of [['I use my breath.', 1], ['The sparkling river.', 1], ['Nothing iron here.', 1], ['I sit down.', 0]]) {
        const { host, callModel } = await setup({ ...QUIET, answers: ['none'] });
        await host.send(message, 'Told.');
        assert.equal(callModel.calls.length, calls, message);
        host.close();
    }
});

test('gate: a last narrator reply that reads as combat plans the next message even with no Foes line; a calm one does not', { skip }, async () => {
    const hot = await setup({ ...QUIET, answers: ['none'] });
    await hot.host.send('Hello.', 'A bandit steps out of the trees and draws a blade.');
    assert.equal(hot.callModel.calls.length, 0, 'the first message is quiet');
    await hot.host.send('Hmm.', 'Told.');
    assert.equal(hot.callModel.calls.length, 1, 'the reply before reads as combat');
    hot.host.close();
    const calm = await setup({ ...QUIET, answers: ['none'] });
    await calm.host.send('Hello.', 'The market is busy and the baker waves.');
    await calm.host.send('Hmm.', 'Told.');
    assert.equal(calm.callModel.calls.length, 0);
    calm.host.close();
});

test('gate: an open fight asks whatever the message says; a fight whose groups are all Down does not', { skip }, async () => {
    const open = await setup({ answers: ['none'] });
    await open.host.send('Hello.', 'Told.');
    assert.equal(open.callModel.calls.length, 1, 'a foe group not Down');
    open.host.close();
    const down = await setup({ blocks: { ...NO_FOES, foes: { role: 'foes', fields: foeBlock([['Sluice Rats', 6, 1, 0]]) } }, answers: ['none'] });
    await down.host.send('Hello.', 'Told.');
    assert.equal(down.callModel.calls.length, 0, 'every group Down');
    down.host.close();
});

test('gate: a reply that opened foes makes the next message plan (the Foes line is on the sheet)', { skip }, async () => {
    const { host, callModel } = await setup({ blocks: { ...NO_FOES, foes: { role: 'foes', fields: foeBlock([]) } }, answers: ['none'] });
    await host.send('Hello.', 'Told.');
    assert.equal(callModel.calls.length, 0, 'no foes yet');
    for (const [field, value] of [['foe1', 'Sluice Rats'], ['count1', 4], ['hurt1', 5]]) assert.equal((await host.bus.command('test.set', { slug: 'foes', field, value }, { cause: 'system' })).ok, true);
    await host.send('Hmm.', 'The rats come.');
    assert.equal(callModel.calls.length, 1, 'the foes are on the sheet');
    host.close();
});

test('gate: the decision is the same on a swipe, a regenerate, a Re-read and a rebuild: a quiet message never asks, a risky one asks once per generation', { skip }, async () => {
    const quiet = await setup(QUIET);
    await quiet.host.send('We rest by the fire.', 'They rest.');
    const live = JSON.stringify(quiet.host.head());
    await quiet.host.swipe('They rest, again.');
    assert.equal((await quiet.host.turn.reread(2)).ok, true);
    quiet.host.store.rebuild();
    assert.equal(quiet.callModel.calls.length, 0, 'no call on any replay');
    assert.equal(JSON.stringify(quiet.host.head()), live, 'the story is the same');
    quiet.host.close();
    const risky = await setup({ ...QUIET, answers: ['none'] });
    await risky.host.send('I sneak up on the camp.', 'They creep.');
    assert.equal(risky.callModel.calls.length, 1);
    await risky.host.swipe('They creep, again.');
    assert.equal(risky.callModel.calls.length, 2, 'a swipe of a risky message plans again, as before');
    risky.host.store.rebuild();
    assert.equal(risky.callModel.calls.length, 2, 'a rebuild asks nothing');
    risky.host.close();
});
