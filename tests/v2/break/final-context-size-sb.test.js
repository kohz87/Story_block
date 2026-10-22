// Final soak, context size (Story Block alone; the whole suite: final-context-size-ignored.test.js).
// SillyTavern fits the extension prompts first and drops the conversation when the rest no longer fits,
// so Story Suite's static + tail are held to a share of the context the interceptor is handed (prompt.js
// contextFit, `contextShare` percent, default 40): the tail is cut for it, optional lines first; the
// static part is never trimmed and stays byte-identical; a context too small for the static part alone
// is told once per chat (and in the settings' prompt size) and the reply still goes out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { DEFAULT_CONTEXT_SHARE, MIN_TAIL_BUDGET, assemble, contextFit, contextNotice, estimateTokens } from '../../../src/v2/prompt.js';
import { contextRoom } from '../../../src/v2/turn.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { SETTINGS_TEXT, renderSettingsHost } from '../../../src/v2/host-ui.js';
import { installFakeDom } from '../../ui-fake-dom.js';

// A module with a big static part (`words` × 5 characters) and a long tail: 4 required lines, 150 optional.
const big = (words = 600) => ({
    id: 'zz-big', name: 'Big',
    context: {
        static: () => `Big rules: ${'rule '.repeat(words).trim()}.`,
        tail: () => ({
            lines: ['Need 1: the gate is shut.', 'Need 2: the guard sleeps.', 'Need 3: it rains.', 'Need 4: night.'],
            optional: Array.from({ length: 150 }, (_, i) => `Maybe ${i + 1}: a detail of the scene that can be left out.`),
        }),
    },
});

async function host(t, { contextSize = 8192, words = 600, settings = null } = {}) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [big(words)], st: { contextSize }, ...(settings ? { settings } : {}) });
    t.after(() => h.close());
    return h;
}
const last = (h, key) => h.st.promptLog.filter(entry => entry.key === key && entry.value).at(-1)?.value ?? '';
const sent = h => ({ static: last(h, 'story_suite_static'), tail: last(h, 'story_suite_tail_1') });

test('a small context: the tail is cut so Story Suite in all fits its share, optional lines first', async t => {
    const h = await host(t, { contextSize: 4095 });
    await h.send('I wait.', 'Rain.');
    const { static: stat, tail } = sent(h);
    const share = Math.floor(4095 * DEFAULT_CONTEXT_SHARE / 100);
    assert.ok(estimateTokens(stat) < share, 'the instructions fit the share here');
    assert.ok(estimateTokens(stat) + estimateTokens(tail) <= share, `static ${estimateTokens(stat)} + tail ${estimateTokens(tail)} within ${share}`);
    for (const line of ['Need 1', 'Need 2', 'Need 3', 'Need 4']) assert.match(tail, new RegExp(line), 'required lines kept');
    assert.match(tail, /Maybe 1:/, 'some optional lines fit');
    assert.doesNotMatch(tail, /Maybe 150:/, 'the last optional lines went first');
    assert.equal(h.st.notices.length, 0, 'nothing to tell: the instructions fit');
    assert.deepEqual(h.turn.problems().filter(p => p.code === 'CONTEXT_SMALL'), []);
});

test('the static part is byte-identical whatever the context size, reply to reply', async t => {
    const h = await host(t, { contextSize: 4095 });
    const statics = [];
    for (const size of [4095, 200000, 1500, 8192, 900]) {
        h.st.contextSize = size;
        await h.send(`Turn at ${size}.`, 'Fine.');
        statics.push(sent(h).static);
    }
    assert.ok(statics[0].includes('Big rules:'));
    assert.equal(new Set(statics).size, 1, 'never trimmed per reply');
    // The tails differ with the room: the small contexts send less.
    h.st.contextSize = 200000;
    await h.send('Big.', 'Yes.');
    const roomy = sent(h).tail;
    h.st.contextSize = 4095;
    await h.send('Small.', 'Yes.');
    assert.ok(sent(h).tail.length < roomy.length);
});

test('a context too small for the instructions: told once per chat (toast and Problems), still sent', async t => {
    const h = await host(t, { contextSize: 2000, words: 1200 });
    await h.send('One.', 'A.');
    await h.send('Two.', 'B.');
    await h.regenerate('B again.');
    const { static: stat, tail } = sent(h);
    const tokens = estimateTokens(stat);
    assert.ok(tokens > Math.floor(2000 * 0.4), 'the instructions alone are over the share');
    assert.ok(stat.includes('Big rules:'), 'the instructions are still sent whole');
    assert.ok(estimateTokens(tail) <= MIN_TAIL_BUDGET, 'the tail is cut to its least');
    assert.match(tail, /Need 1/, 'its first required lines still go');
    const message = `Your context size (2,000 tokens) is too small for Story Suite's instructions (about ${tokens.toLocaleString('en-US')} tokens). Raise the context size or turn features off.`;
    assert.deepEqual(h.st.notices, [{ reason: message, moduleId: null }], 'one notice for three replies');
    assert.deepEqual(h.turn.problems().filter(p => p.code === 'CONTEXT_SMALL').map(p => p.message), [message]);
    // Another chat: told again, once.
    await h.st.loadChat([{ name: 'Narrator', is_user: false, mes: 'Another start.', extra: {} }], 'chat-2');
    await h.send('Hi.', 'Hello.');
    await h.send('Hi again.', 'Hello again.');
    assert.equal(h.st.notices.length, 2);
});

test('a large context: the same prompt as without a context size (the tail budget setting alone)', async t => {
    const h = await host(t, { contextSize: 200000 });
    await h.send('Look.', 'Seen.');
    const large = sent(h);
    h.st.contextSize = 0;    // no size handed: the old behaviour
    await h.regenerate('Seen.');
    assert.deepEqual(sent(h), large);
    assert.ok(estimateTokens(large.tail) <= 1500 && estimateTokens(large.tail) > 1400, 'the 1,500 budget is what cuts it');
    assert.equal(h.st.notices.length, 0);
});

test('contextShare: a host setting, held to 10–90 %', async t => {
    const h = await host(t, { contextSize: 8192, words: 100, settings: { host: { contextShare: 20 } } });
    await h.send('Look.', 'Seen.');
    const { static: stat, tail } = sent(h);
    const fit = h.turn.previewFit().fit;
    assert.equal(fit.percent, 20);
    assert.equal(fit.share, Math.floor(8192 * 0.2));
    assert.ok(estimateTokens(stat) + estimateTokens(tail) <= fit.share);
    assert.equal(contextFit({ room: 1000 }, 0, { contextShare: 5 }).percent, 10);
    assert.equal(contextFit({ room: 1000 }, 0, { contextShare: 99 }).percent, 90);
    assert.equal(contextFit({ room: 1000 }, 0, {}).percent, DEFAULT_CONTEXT_SHARE);
    assert.equal(contextFit(null, 0, {}), null, 'no context known: no fit');
});

test('contextRoom: SillyTavern hands the context less the reply; the API settings name both', () => {
    const cc = { mainApi: 'openai', chatCompletionSettings: { openai_max_context: 4095, openai_max_tokens: 300 } };
    assert.deepEqual(contextRoom(cc, 3795), { size: 4095, reply: 300, room: 3795 });
    assert.deepEqual(contextRoom(cc, 4095), { size: 4095, reply: 300, room: 3795 }, 'a size that still holds the reply');
    assert.deepEqual(contextRoom(cc, null), { size: 4095, reply: 300, room: 3795 }, 'before any reply: the settings alone');
    assert.deepEqual(contextRoom({ mainApi: 'textgenerationwebui', maxContext: 8192, amount_gen: 512 }, 7680), { size: 8192, reply: 512, room: 7680 });
    assert.deepEqual(contextRoom({}, 3000), { size: 3000, reply: null, room: 3000 });
    assert.equal(contextRoom({}, null), null);
    assert.equal(contextRoom(null, 'x'), null);
});

test('assemble: the static text never depends on the context; fit says how it was cut', () => {
    const registry = createRegistry();
    registry.register(big(1200));
    const view = { state: null, query: () => null, settings: () => ({}), chat: [] };
    const roomy = assemble({ registry, view, context: { size: 100000, room: 100000 } });
    const tight = assemble({ registry, view, context: { size: 2000, room: 2000 } });
    assert.equal(tight.staticText, roomy.staticText);
    assert.equal(roomy.fit.tooSmall, false);
    assert.equal(roomy.fit.budget, 1500);
    assert.equal(tight.fit.tooSmall, true);
    assert.equal(tight.fit.budget, MIN_TAIL_BUDGET);
    assert.equal(contextNotice(tight.fit), `Your context size (2,000 tokens) is too small for Story Suite's instructions (about ${tight.fit.static.toLocaleString('en-US')} tokens). Raise the context size or turn features off.`);
});

test('the settings\' prompt size shows the context size, the share and the notice', () => {
    const doc = installFakeDom();
    const registry = createRegistry();
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    const parts = [{ module: 'story-suite', place: 'static', text: 'x'.repeat(4000) }, { module: 'story-suite', place: 'tail', text: 'y'.repeat(400) }];
    const fit = contextFit({ size: 2000, reply: 300, room: 1700 }, 1000, {});
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc, promptParts: () => ({ parts, fit }) });
    const size = root.querySelector('.story-suite-size');
    const rows = size.querySelectorAll('.story-suite-size-sum > li').map(li => [li.querySelector('span').textContent, li.querySelector('b').textContent]);
    assert.deepEqual(rows.slice(0, 2), [
        [SETTINGS_TEXT.size.context, '2,000 tokens (300 of them for the reply)'],
        [SETTINGS_TEXT.size.share, '680 of 1,700 tokens (40%)'],
    ]);
    assert.equal(size.querySelector('.story-suite-size-warn').textContent, contextNotice(fit));
    assert.match(rows[3][1], new RegExp(`of ${MIN_TAIL_BUDGET}$`), 'the tail budget the context leaves');
    // An older source (parts only): no context lines, a note instead.
    const old = doc.createElement('div');
    renderSettingsHost(old, { registry, settings, doc, promptParts: () => parts });
    assert.equal(old.querySelector('.story-suite-size-warn'), null);
    assert.equal(old.querySelector('.story-suite-size-context-unknown').textContent, SETTINGS_TEXT.size.contextUnknown);
});
