// The pre-roll classifier (SPEC §4.5, MODULES §F16): its prompt, how its answer is read, and when
// beforeGenerate asks the model and what it returns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CLASSIFIER_HEAD, MESSAGE_LIMIT, PRECHECK, PROMPT_BUDGET, ROLLED_LINE, checkLine, claimKey, classifierPrompt,
    createAssistPart, estimateTokens, hashText, normalizeDc, parseClassifierAnswer,
} from '../../../src/v2/assist/index.js';
import { NEVER, fakeModel, flush, manualTimer, on, reply, user, view } from './helpers/fakes.js';

const ACTION = 'I slip past the gate guard while he looks at the cart.';
const CHECK = '? check stealth — slipping past the gate guard | dc: hard';

function setup({ answers = [CHECK], settings = on({ classifier: true }), chat = [reply('The gate.'), user(ACTION)], kinds = ['check'], timer, timeoutMs } = {}) {
    const callModel = fakeModel(...answers);
    const warnings = [];
    const state = { chat, settings, chatId: 'chat-1' };
    const part = createAssistPart({
        callModel,
        settings: () => state.settings,
        chat: () => state.chat,
        chatId: () => state.chatId,
        hasKind: kind => kinds.includes(kind),
        warn: text => warnings.push(text),
        ...(timer ? { timer } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
    });
    const before = (v = view(), info) => part.hooks.beforeGenerate(v, info);
    return { part, callModel, warnings, state, before };
}

const keyOf = (index, text) => `${index}-${hashText(text)}`;

test('the prompt: a static head first, the message last, within 400 tokens even for a long message', () => {
    const a = classifierPrompt('I pick the lock.');
    const b = classifierPrompt('I ask the innkeeper about the road.');
    assert.ok(a.startsWith(CLASSIFIER_HEAD) && b.startsWith(CLASSIFIER_HEAD), 'the same head, byte for byte');
    assert.ok(a.endsWith('I pick the lock.\n"""'));
    assert.ok(!CLASSIFIER_HEAD.includes('{{') && !/\d{3,}/.test(CLASSIFIER_HEAD), 'no names, macros or numbers that change');
    const long = classifierPrompt('word '.repeat(2000));
    assert.ok(estimateTokens(long) <= PROMPT_BUDGET, `${estimateTokens(long)} tokens`);
    assert.ok(long.length < CLASSIFIER_HEAD.length + MESSAGE_LIMIT + 20);
    assert.ok(estimateTokens(CLASSIFIER_HEAD) < 200, 'the static part is small');
});

test('reading the answer: one check line, none, or nothing usable', () => {
    assert.deepEqual(parseClassifierAnswer(CHECK).line, {
        op: '?', kind: 'check', name: 'stealth', text: 'slipping past the gate guard', labels: { dc: 'hard' }, raw: CHECK,
    });
    // Models drift: bullets, bold, a block around it, a sentence before it.
    assert.equal(parseClassifierAnswer(`- **? check stealth — slipping past | dc: hard**`).line.name, 'stealth');
    assert.equal(parseClassifierAnswer(`<Changes>\n${CHECK}\n</Changes>`).line.labels.dc, 'hard');
    assert.equal(parseClassifierAnswer(`Here it is:\n? check lockpicking — the chest | dc: 15`).line.labels.dc, '15');
    assert.equal(parseClassifierAnswer(`? check Persuasion — the guard | dc: Normal | who: Lyra | stat: CHA | note: x`).line.raw,
        '? check Persuasion — the guard | dc: normal | stat: CHA | who: Lyra');
    // Two lines: the first one only (at most one check).
    assert.equal(parseClassifierAnswer(`${CHECK}\n? check athletics — the wall | dc: easy`).line.name, 'stealth');
    for (const none of ['none', 'None.', '**none**', 'none (just talk)', 'No check']) assert.deepEqual(parseClassifierAnswer(none), { none: true }, none);
    for (const garbage of ['', 'The guard looks away.', '+ item Rope | qty: 1', '? check — | dc: hard', '? check stealth — the gate', '? check stealth | dc: impossible', '? check stealth | dc: 99', '? check a very long skill name here — x | dc: hard', '? roll stealth | dc: hard']) {
        assert.ok(parseClassifierAnswer(garbage).error, `"${garbage}" is not used`);
    }
});

test('difficulties and check lines are normalized and checked', () => {
    assert.equal(normalizeDc('Hard'), 'hard');
    assert.equal(normalizeDc('12'), '12');
    assert.equal(normalizeDc('0'), null);
    assert.equal(normalizeDc('41'), null);
    assert.equal(normalizeDc('very hard'), null);
    assert.equal(checkLine({ op: '+', kind: 'check', name: 'stealth', labels: { dc: 'hard' } }), null);
    assert.equal(checkLine(null), null);
    assert.equal(checkLine({ op: '?', kind: 'check', name: 'stealth', text: 'x'.repeat(400), labels: { dc: 'hard' } }).text.length, 160);
});

test('off (the default): nothing, and no model call', async () => {
    const { before, callModel } = setup({ settings: on() });
    assert.equal(await before(), null);
    const defaults = setup({ settings: {} });
    assert.equal(await defaults.before(), null);
    assert.equal(callModel.calls.length + defaults.callModel.calls.length, 0);
});

test('on, with an uncertain action: one call, then the pre-roll command and the tail line', async () => {
    const { before, callModel } = setup({ settings: on({ classifier: true, profile: 'Cheap' }) });
    const out = await before();
    assert.equal(callModel.calls.length, 1);
    assert.equal(callModel.calls[0].prompt, classifierPrompt(ACTION));
    assert.deepEqual(callModel.calls[0].options, { maxTokens: 60, profile: 'Cheap' });
    assert.deepEqual(out, {
        lines: [ROLLED_LINE],
        commands: [{
            type: PRECHECK,
            payload: { key: keyOf(1, ACTION), line: { op: '?', kind: 'check', name: 'stealth', text: 'slipping past the gate guard', labels: { dc: 'hard' }, raw: CHECK } },
        }],
    });
});

test('none and garbage answers give nothing; garbage is logged', async () => {
    const none = setup({ answers: ['none'] });
    assert.equal(await none.before(), null);
    assert.equal(none.part.queries['assist.status']().classifier.last.outcome, 'none');
    assert.deepEqual(none.warnings, []);

    const garbage = setup({ answers: ['The guard does not notice you.'] });
    assert.equal(await garbage.before(), null);
    assert.equal(garbage.part.queries['assist.status']().classifier.last.outcome, 'unreadable');
    assert.equal(garbage.warnings.length, 1);
});

test('a failed or timed-out call is logged and ignored; a late answer is dropped', async () => {
    const failing = setup({ answers: [new Error('connection refused')] });
    assert.equal(await failing.before(), null);
    assert.match(failing.warnings[0], /connection refused/);

    const timer = manualTimer();
    const slow = setup({ answers: [NEVER], timer });
    const pending = slow.before();
    await flush();
    assert.equal(timer.lastMs, 20000, 'twenty seconds by default');
    timer.fire();
    assert.equal(await pending, null);
    const last = slow.part.queries['assist.status']().classifier.last;
    assert.equal(last.outcome, 'timeout');
    assert.match(last.message, /within 20 s/);

    // A real timer, briefly.
    const quick = setup({ answers: [NEVER], timeoutMs: 5 });
    assert.equal(await quick.before(), null);
    assert.equal(quick.part.queries['assist.status']().classifier.last.outcome, 'timeout');
});

test('only a new message: not for swipe, continue, quiet or impersonate, nor when the last message is a reply', async () => {
    const { before, callModel, state } = setup();
    for (const type of ['swipe', 'continue', 'quiet', 'impersonate']) assert.equal(await before(view({ settings: state.settings }), { type }), null, type);
    state.chat = [reply('The gate.'), user(ACTION), reply('You wait.')];
    assert.equal(await before(), null, 'a swipe or continue without the type');
    state.chat = [reply('The gate.'), user('   ')];
    assert.equal(await before(), null, 'an empty message');
    assert.equal(callModel.calls.length, 0);
    state.chat = [reply('The gate.'), user(ACTION)];
    assert.ok(await before(view(), { type: 'regenerate' }), 'a regenerate of the reply to a new message');
});

test('once per message: a regenerate asks no more, whatever came of it; a claim on the line of history says it is done', async () => {
    const { before, callModel, state } = setup({ answers: ['none'] });
    assert.equal(await before(), null);
    assert.equal(await before(view(), { type: 'regenerate' }), null);
    assert.equal(callModel.calls.length, 1);
    // The same text in another chat, or another message, is asked about.
    state.chatId = 'chat-2';
    await before();
    state.chat = [...state.chat, reply('…'), user('I climb the wall.')];
    await before();
    assert.equal(callModel.calls.length, 3);

    const fresh = setup();
    const claims = { [claimKey(keyOf(1, ACTION))]: true };
    assert.equal(await fresh.before(view({ claims })), null, 'already pre-rolled (after a reload, say)');
    assert.equal(fresh.callModel.calls.length, 0);
});

test('without a module that keeps checks, nothing is asked', async () => {
    const { before, callModel, part } = setup({ kinds: [] });
    assert.equal(await before(), null);
    assert.equal(callModel.calls.length, 0);
    assert.equal(part.queries['assist.status']().classifier.last.outcome, 'skipped');
});

test('settings come from the view when none are injected', async () => {
    const callModel = fakeModel(CHECK);
    const part = createAssistPart({ callModel, chat: () => [user(ACTION)], chatId: () => 'c', hasKind: () => true, warn: () => {} });
    const asked = [];
    const v = { ...view(), settings: id => { asked.push(id); return on({ classifier: true }); } };
    assert.ok(await part.hooks.beforeGenerate(v));
    assert.deepEqual(asked, ['story-block']);
});


test('a successful classification survives a live claim, then prepares one new roll after retraction', async () => {
    const { before, callModel } = setup();
    const first = await before();
    assert.ok(first);
    const claims = { [claimKey(keyOf(1, ACTION))]: true };
    assert.equal(await before(view({ claims })), null);
    assert.deepEqual(await before(view(), { type: 'regenerate' }), first);
    assert.equal(callModel.calls.length, 1);
});
