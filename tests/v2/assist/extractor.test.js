// The after-reply extractor (SPEC §0.5, §4.2): runs only when the reply has no <Changes> block (or
// an empty one), once per carrier and swipe, and hands the lines to the host's capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTRACTOR_HEAD, MAX_LINES, SETTING, createAssistPart, extractorPrompt, grammarKind, parseExtractorAnswer } from '../../../src/v2/assist/index.js';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { NEVER, fakeModel, flush, manualTimer, on } from './helpers/fakes.js';

const GRAMMAR = [
    '+ item Name | qty: 1 | note: short detail',
    '~ place Name | kind: settlement|wild|dungeon',
];
const STORY = 'You buy a coil of rope and walk to the mill.';
const ANSWER = '<Changes>\n+ item Rope | qty: 1\n~ place The Mill | kind: settlement\n</Changes>';

function setup({ answers = [ANSWER], settings = on({ extractor: true }), grammar = GRAMMAR, timer, withCapture = true } = {}) {
    const callModel = fakeModel(...answers);
    const captured = [];
    const warnings = [];
    const state = { chatId: 'chat-1' };
    const part = createAssistPart({
        callModel,
        settings: () => settings,
        grammar: () => grammar,
        chatId: () => state.chatId,
        capture: withCapture ? async (text, at) => { captured.push({ text, ...at }); return { receipts: text.split('\n').length }; } : null,
        warn: text => warnings.push(text),
        ...(timer ? { timer } : {}),
    });
    const after = reply => part.hooks.afterReply({ index: 2, swipe: 0, type: 'normal', mes: STORY, ...reply });
    const last = () => part.queries['assist.status']().extractor.last;
    return { part, callModel, captured, warnings, state, after, last };
}

test('the prompt: head, the kinds\' grammar, then the reply; the answer keeps known kinds only', () => {
    const prompt = extractorPrompt(STORY, GRAMMAR);
    assert.ok(prompt.startsWith(EXTRACTOR_HEAD));
    assert.ok(prompt.includes('- + item Name | qty: 1 | note: short detail\n- ~ place Name'));
    assert.ok(prompt.endsWith(`"""\n${STORY}\n"""`));
    assert.equal(extractorPrompt('Other words.', GRAMMAR).split('"""')[0], prompt.split('"""')[0], 'the same up to the reply');
    assert.equal(grammarKind('+ present Name when someone arrives'), 'present');
    assert.equal(grammarKind('no op here'), null);

    const parsed = parseExtractorAnswer('+ item Rope | qty: 1\n+ dragon Smaug\nnot a line\n~ place Mill', ['item', 'place']);
    assert.deepEqual(parsed, { lines: ['+ item Rope | qty: 1', '~ place Mill'], dropped: 2 });
    assert.deepEqual(parseExtractorAnswer('none', ['item']), { lines: [], dropped: 0 });
    const many = Array.from({ length: 40 }, (_, i) => `+ item Pebble ${i}`).join('\n');
    assert.equal(parseExtractorAnswer(many, ['item']).lines.length, MAX_LINES);
});

test('off (the default): nothing, and no call', async () => {
    const { after, callModel, captured } = setup({ settings: on() });
    assert.equal(await after(), null);
    const defaults = setup({ settings: {} });
    assert.equal(await defaults.after(), null);
    assert.equal(callModel.calls.length + defaults.callModel.calls.length + captured.length, 0);
});

test('a reply without a block: one call, its lines go to the capture for that carrier and swipe', async () => {
    const { after, callModel, captured, last } = setup({ settings: on({ extractor: true, profile: 'Cheap' }) });
    assert.deepEqual(await after(), { receipts: 2 });
    assert.equal(callModel.calls.length, 1);
    assert.equal(callModel.calls[0].prompt, extractorPrompt(STORY, GRAMMAR));
    assert.deepEqual(callModel.calls[0].options, { maxTokens: 400, profile: 'Cheap' });
    assert.deepEqual(captured, [{ text: '+ item Rope | qty: 1\n~ place The Mill | kind: settlement', index: 2, swipe: 0 }]);
    assert.equal(last().outcome, 'lines');
    assert.equal(last().lines, 2);
});

test('only when the block is missing or empty', async () => {
    const { after, callModel, captured } = setup();
    assert.equal(await after({ mes: `${STORY}\n<Changes>\n+ item Rope | qty: 1\n</Changes>` }), null);
    assert.equal(await after({ index: 3, mes: `${STORY}\n\n<!-- STORY_SUITE_V2\n<Changes>\n+ item Rope\n</Changes>\n-->` }), null, 'hidden after capture');
    assert.equal(await after({ index: 4, mes: `${STORY}\n<Changes>\nnone\n</Changes>` }), null, 'the reply said nothing changed');
    assert.equal(callModel.calls.length, 0);
    assert.ok(await after({ index: 5, mes: `${STORY}\n<Changes>\n\n</Changes>` }), 'an empty block');
    assert.equal(await after({ index: 6, mes: '<Changes></Changes>' }), null, 'no story to read');
    assert.equal(captured.length, 1);
});

test('once per carrier and swipe; another swipe or chat is read', async () => {
    const { after, callModel, state } = setup({ answers: ['none'] });
    assert.equal(await after(), null);
    assert.equal(await after(), null);
    assert.equal(callModel.calls.length, 1);
    await after({ swipe: 1 });
    state.chatId = 'chat-2';
    await after();
    assert.equal(callModel.calls.length, 3);
});

test('never for quiet, impersonate or continue', async () => {
    const { after, callModel } = setup();
    for (const type of ['quiet', 'impersonate', 'continue']) assert.equal(await after({ type }), null, type);
    assert.equal(callModel.calls.length, 0);
});

test('failures are logged and ignored: a timeout, a failed call, a throwing capture, no capture, no grammar', async () => {
    const timer = manualTimer();
    const slow = setup({ answers: [NEVER], timer });
    const pending = slow.after();
    await flush();
    assert.equal(timer.lastMs, 20000);
    timer.fire();
    assert.equal(await pending, null);
    assert.equal(slow.last().outcome, 'timeout');
    assert.equal(slow.captured.length, 0);
    assert.equal(slow.warnings.length, 1);

    const failing = setup({ answers: [new Error('overloaded')] });
    assert.equal(await failing.after(), null);
    assert.match(failing.last().message, /overloaded/);

    const throwing = createAssistPart({ callModel: fakeModel(ANSWER), settings: () => on({ extractor: true }), grammar: () => GRAMMAR, chatId: () => 'c', warn: () => {}, capture: () => { throw new Error('boom'); } });
    assert.equal(await throwing.hooks.afterReply({ index: 1, mes: STORY }), null);
    assert.equal(throwing.queries['assist.status']().extractor.last.outcome, 'failed');

    const none = setup({ withCapture: false });
    assert.equal(await none.after(), null);
    assert.equal(none.callModel.calls.length, 0);
    assert.match(none.last().message, /no capture/);

    const empty = setup({ grammar: [] });
    assert.equal(await empty.after(), null);
    assert.equal(empty.callModel.calls.length, 0);
    assert.equal(empty.last().outcome, 'skipped');

    const nothing = setup({ answers: ['+ dragon Smaug'] });
    assert.equal(await nothing.after(), null);
    assert.equal(nothing.last().outcome, 'nothing');
    assert.equal(nothing.captured.length, 0);
});

test('the capture given per reply (the host\'s) wins over the one given at creation', async () => {
    const { after, captured } = setup();
    const mine = [];
    await after({ capture: text => { mine.push(text); return 'mine'; } });
    assert.equal(mine.length, 1);
    assert.equal(captured.length, 0);
});

const available = await hostAvailable();

test('on the real host: a reply without a block gets its item through the host\'s own late capture', { skip: available.ok ? false : available.reason }, async () => {
    const host = await createHost({ callModel: fakeModel('+ item Rope | qty: 1'), settings: { modules: { 'story-block': { [SETTING.extractor]: true } } } });
    assert.ok(host.registry.capture('item'), 'the core module keeps items');
    const late = new Promise(resolve => host.sdk.on('turn', turn => { if (turn.type === 'late') resolve(turn); }));
    const { index } = await host.send('I buy rope.', STORY);
    const turn = await late;
    const message = host.ctx.chat[index];
    assert.equal(turn.receipts.length, 1);
    assert.equal(turn.receipts[0].cause, 'story');
    const items = host.sdk.query('inventory.items', {});
    assert.ok(items.some(item => item.name === 'Rope' && item.qty === 1), JSON.stringify(items));
    assert.ok(message.extra.storySuite.receipts.some(receipt => receipt.id === turn.receipts[0].id), 'kept on the reply, so a swipe takes it back');
    assert.match(message.mes, /^You buy a coil of rope and walk to the mill\.\n\n<!-- STORY_SUITE_V2\n<Changes>\n\+ item Rope \| qty: 1\n<\/Changes>\n-->$/, 'the lines are kept in the hidden block');
    // A swipe takes them back.
    await host.swipe('Another ending, with no rope.');
    await flush();
    assert.ok(!host.sdk.query('inventory.items', {}).some(item => item.name === 'Rope' && item.qty === 1 && item.stack === turn.receipts[0].data.stacks?.[0]), 'the first swipe\'s rope is not on this swipe');
    host.close();
});

test('the extractor is off by default: a reply without a block stays without changes', { skip: available.ok ? false : available.reason }, async () => {
    let asked = 0;
    const host = await createHost({ callModel: async () => { asked += 1; return '+ item Rope'; } });
    await host.send('I buy rope.', STORY);
    await flush();
    assert.equal(asked, 0);
    assert.deepEqual(host.sdk.query('inventory.items', {}), []);
    host.close();
});

test('settings default to the sdk\'s when no view is given', async () => {
    const previous = globalThis.StoryBlock;
    try {
        const asked = [];
        globalThis.StoryBlock = { sdk: { settings: id => { asked.push(id); return { [SETTING.extractor]: false }; } } };
        const part = createAssistPart({ callModel: fakeModel(ANSWER), grammar: () => GRAMMAR, chatId: () => 'c', warn: () => {} });
        assert.equal(await part.hooks.afterReply({ index: 1, mes: STORY }), null);
        assert.deepEqual(asked, ['story-block']);
    } finally {
        globalThis.StoryBlock = previous;
    }
});
