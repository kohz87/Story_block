// The after-reply extractor, Assist's safety net (SPEC §0.5, §4.2, MODULES §F123): runs after every
// captured reply, once per carrier and swipe, proposes only lines the reply's own did not write, and
// hands them to the host's capture marked as its.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KINDS, EXTRACTOR_HEAD, MAX_LINES, SETTING, allowedKinds, createAssistPart, extractorPrompt, grammarKind, parseExtractorAnswer, refusedWhy } from '../../../src/v2/assist/index.js';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { NEVER, fakeModel, flush, manualTimer, on } from './helpers/fakes.js';

const GRAMMAR = [
    '+ item Name | qty: 1 | note: short detail',
    '~ place Name | kind: settlement|wild|dungeon',
];
const STORY = 'You buy a coil of rope and walk to the mill.';
const ANSWER = '<Changes>\n- item Rope | to: the miller\n~ place The Mill | kind: settlement\n</Changes>';

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
    assert.ok(prompt.includes('The reply\'s own lines:\nnone\n'));
    assert.ok(extractorPrompt(STORY, GRAMMAR, ['! time +1h']).includes('The reply\'s own lines:\n! time +1h\n'));
    assert.equal(extractorPrompt('Other words.', GRAMMAR).split('"""')[0], prompt.split('"""')[0], 'the same up to the reply');
    assert.equal(grammarKind('+ present Name when someone arrives'), 'present');
    assert.equal(grammarKind('no op here'), null);

    const parsed = parseExtractorAnswer('+ item Rope | qty: 1\n+ dragon Smaug\nnot a line\n~ place Mill', ['item', 'place']);
    assert.deepEqual(parsed, { lines: ['+ item Rope | qty: 1', '~ place Mill'], dropped: 2, refused: [] });
    assert.deepEqual(parseExtractorAnswer('none', ['item']), { lines: [], dropped: 0, refused: [] });
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
    assert.equal(callModel.calls[0].prompt, extractorPrompt(STORY, GRAMMAR, []));
    assert.deepEqual(callModel.calls[0].options, { maxTokens: 400, profile: 'Cheap', helper: 'extractor' });
    assert.deepEqual(captured, [{ text: '- item Rope | to: the miller\n~ place The Mill | kind: settlement', index: 2, swipe: 0 }]);
    assert.equal(last().outcome, 'lines');
    assert.equal(last().lines, 2);
});

test('after every reply: the reply\'s own lines go in the prompt, and a line it already has is never proposed', async () => {
    const { after, callModel, captured } = setup({ answers: [ANSWER, ANSWER] });
    // The block wrote the place (another wording of the same op, kind and name): only the hand-over is new.
    assert.ok(await after({ mes: `${STORY}\n<Changes>\n~ place the mill\n</Changes>`, lines: ['~ place the mill'] }));
    assert.ok(callModel.calls[0].prompt.includes('The reply\'s own lines:\n~ place the mill\n'));
    assert.deepEqual(captured.map(item => item.text), ['- item Rope | to: the miller']);
    // C-1's matching: the same line with decoration is the same line.
    assert.equal(await after({ index: 3, mes: STORY, lines: ['**- item Rope | to: the miller**', '~ place The Mill | kind: settlement'] }), null);
    assert.equal(await after({ index: 6, mes: '<Changes></Changes>' }), null, 'no story to read');
    assert.equal(captured.length, 1);
});

test('the value wall: never coin, new items, XP, loot or heals, whatever the allowed kinds say; the allow-list is a setting', async () => {
    const grammar = [...GRAMMAR, '+ coin 30 | from: who', '~ wound Name — what happened | harm: wound', '+ xp 10'];
    const answer = '+ coin 30\n+ item Gold Ring\n+ xp 50\n~ wound Mira — healed | heal: wound\n? loot Chest\n~ wound Mira — bitten | harm: scratch\n~ place Mill';
    const wide = setup({ grammar, answers: [answer], settings: { ...on({ extractor: true }), [SETTING.extractorKinds]: '+ coin, + item, + xp, ~ wound, ? loot, ~ place' } });
    await wide.after();
    assert.deepEqual(wide.captured.map(item => item.text), ['~ wound Mira — bitten | harm: scratch\n~ place Mill']);
    const narrow = setup({ grammar, answers: [answer], settings: { ...on({ extractor: true }), [SETTING.extractorKinds]: '~ place' } });
    await narrow.after();
    assert.deepEqual(narrow.captured.map(item => item.text), ['~ place Mill']);
    assert.ok(!narrow.callModel.calls[0].prompt.includes('wound'), 'only the allowed kinds\' grammar is sent');
    assert.equal(allowedKinds(DEFAULT_KINDS).has('- item'), true);
    assert.equal(allowedKinds(DEFAULT_KINDS).has('+ item'), false);
    assert.match(refusedWhy({ op: '-', kind: 'item', name: '30 gold coins', labels: {} }, null, { late: true }), /coin/);
    assert.match(refusedWhy({ op: '-', kind: 'quest', name: 'Pelts', labels: {} }, null, { late: true }), /turn-in/);
    assert.equal(refusedWhy({ op: '-', kind: 'item', name: 'Wolf Pelt', labels: { to: 'Elula' } }, null, { late: true }), '');
    assert.equal(refusedWhy({ op: '-', kind: 'quest', name: 'Pelts', labels: {} }, allowedKinds(DEFAULT_KINDS)), '');
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

    const nothing = setup({ answers: ['+ dragon Smaug\n+ item Rope'] });
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

test('on the real host: the safety net\'s place is applied on the reply, marked, stored, and Re-read uses the stored lines', { skip: available.ok ? false : available.reason }, async () => {
    const model = fakeModel('~ place Old Mill | kind: settlement\n+ item Rope | qty: 1', 'none');
    const host = await createHost({ callModel: model, settings: { modules: { 'story-block': { [SETTING.extractor]: true } } } });
    host.features?.set?.('story-block.extractor', true);
    const late = new Promise(resolve => host.sdk.on('turn', turn => { if (turn.type === 'late') resolve(turn); }));
    const { index } = await host.send('I walk to the mill.', `${STORY}\n<Changes>\n- present Nobody\n</Changes>`);
    const turn = await late;
    const message = host.ctx.chat[index];
    assert.equal(turn.receipts.length, 1, 'the place only: + item never comes from the safety net');
    assert.equal(turn.receipts[0].cause, 'story');
    assert.equal(turn.receipts[0].assist, 'now');
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    assert.deepEqual(host.sdk.query('inventory.items', {}), []);
    assert.ok(message.extra.storySuite.receipts.some(receipt => receipt.id === turn.receipts[0].id && receipt.assist === 'now'), 'kept on the reply, marked');
    assert.match(message.mes, /<Changes-assist>\n~ place Old Mill \| kind: settlement\n<\/Changes-assist>\n-->$/, 'the output is stored with the reply');
    // Re-read: the stored line runs again, no new call.
    const calls = model.calls.length;
    const again = await host.sdk.reread(index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(model.calls.length, calls, 'no model call on Re-read');
    assert.ok(again.receipts.some(receipt => receipt.assist === 'now'));
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    // A swipe takes it back.
    await host.swipe('Another ending, at home.');
    await flush();
    assert.notEqual(host.sdk.query('scene.place').name, 'Old Mill');
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
