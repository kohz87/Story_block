// QA: the prompt (SPEC §5, §4.1). The static part is byte-identical across 200 random states of a
// chat (items, coins, places, people, probe ticks, names with macros and odd characters, a renamed
// currency, another tail budget), in chat completion and in text completion; Story Block's v1 keys
// are cleared on load and stay empty; quiet and impersonate generations get nothing, capture nothing
// and tell nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, sharedPrefix } from '../../../testkit/index.js';
import { STATIC_KEY, TAIL_KEY, V1_KEYS } from '../../../src/v2/turn.js';
import { HAPPENED, STATIC_MARKER, assemble } from '../../../src/v2/prompt.js';
import { makeView } from '../../../src/v2/sdk.js';
import { prng, seedCrypto } from './helpers/seeded.js';
import { probeModule } from './helpers/probe-module.js';

const NAMES = ['Rope', 'Moonveil Trout', '{{user}}\'s Blade', '<BOT> Charm', 'Ünïcödé Ring', 'Iron Key', 'Glass "Eye"', 'Map of the {{char}}'];
const PEOPLE = ['Fenna', '{{user}}', 'Kael the <CHAR>', 'Lyra'];
const PLACES = ['Bluewatch Village', 'The {{char}} Keep', 'Old Mill'];

function randomReply(r) {
    const lines = [];
    for (let i = 0, n = r.int(0, 4); i < n; i++) {
        lines.push(r.pick([
            () => `+ item ${r.pick(NAMES)} | qty: ${r.int(1, 4)} | note: ${r.pick(['bent', 'new', 'from {{user}}', 'glowing'])}`,
            () => `- item ${r.pick(NAMES)}`,
            () => `+ coin ${r.int(1, 500)}`,
            () => `- coin ${r.int(1, 30)}`,
            () => `~ place ${r.pick(PLACES)} | kind: ${r.pick(['settlement', 'wild', 'dungeon'])} | region: ${r.pick(['North', 'The Vale'])}`,
            () => `${r.pick(['+', '-'])} present ${r.pick(PEOPLE)}`,
            () => `! probe ${r.pick(['ember', 'frost', 'tide'])}`,
        ])());
    }
    return `Story ${r.int(0, 1e6)}.${lines.length ? `\n<Changes>\n${lines.join('\n')}\n</Changes>` : ''}`;
}

async function randomStates(t, mainApi) {
    t.mock.method(console, 'warn', () => {});
    const restore = seedCrypto(mainApi === 'openai' ? 5 : 6);
    t.after(restore);
    const r = prng(mainApi === 'openai' ? 11 : 12);
    const h = await createHost({ modules: [probeModule()], st: { mainApi } });
    t.after(() => h.close());
    const statics = [];
    const currencies = [];
    const requests = [];
    const heads = new Set();
    let currency = 'gold';
    for (let i = 0; i < 200; i++) {
        if (r.chance(0.3)) await h.sdk.command('probe.tick', {});
        if (r.chance(0.15)) h.settings.set('story-block', 'currency', currency = r.pick(['gold', 'Gil', 'denar', '{{user}} bucks']));
        if (r.chance(0.1)) h.settings.set(null, 'tailBudget', r.pick([100, 400, 1500, 20000]));
        const result = r.chance(0.15) && h.ctx.chat.length > 1 && !h.ctx.chat.at(-1).is_user
            ? await h.swipe(randomReply(r))
            : await h.send(`Turn ${i}.`, randomReply(r));
        assert.ok(result.request, `request ${i} was built`);
        statics.push(h.st.promptLog.filter(entry => entry.key === STATIC_KEY && entry.value).at(-1).value);
        currencies.push(currency);
        requests.push(result.request);
        heads.add(JSON.stringify(h.head()));
    }
    assert.ok(heads.size > 150, `the states really differ (${heads.size} distinct heads)`);
    return { h, statics, currencies, requests };
}

// One static text per currency name, and each names its currency.
function sameWhileCurrencyIs(statics, currencies) {
    const byCurrency = new Map();
    statics.forEach((text, i) => {
        if (!byCurrency.has(currencies[i])) byCurrency.set(currencies[i], text);
        assert.equal(text, byCurrency.get(currencies[i]), `static ${i}: unchanged while the currency is ${currencies[i]}`);
    });
    assert.ok(byCurrency.size >= 3, `the run really renames the currency (${byCurrency.size})`);
    // The host fills the macros ({{user}} is "You") before the prompt goes out.
    for (const [currency, text] of byCurrency) {
        const written = currency.replace('{{user}}', 'You');
        assert.ok(text.includes(`Money in this story is the ${written}`) || text.includes(`Money in this story is ${written}`), `names ${currency}: ${text}`);
    }
}

test('chat completion: the static part is byte-identical across 200 random states, and sits first in every request', async t => {
    const { statics, currencies, requests } = await randomStates(t, 'openai');
    // The static part names the chat's currency (the money line), so it changes with the currency setting
    // and with nothing else: one text per currency used.
    sameWhileCurrencyIs(statics, currencies);
    for (const text of statics) {
        assert.ok(text.startsWith(STATIC_MARKER));
        for (const word of ['Moonveil', 'Fenna', 'Bluewatch', 'Tick', 'ember']) assert.ok(!text.includes(word), `the static part names no "${word}"`);
    }
    requests.forEach((request, i) => {
        assert.ok(request.chat[0].content.includes(statics[i]), `request ${i} starts with its static part`);
        assert.equal(request.chat[0].content, requests[currencies.indexOf(currencies[i])].chat[0].content, `request ${i}: the first system message is the same bytes while the currency is`);
    });
});

test('text completion: every request starts with the same bytes, the static part included', async t => {
    const { statics, currencies, requests } = await randomStates(t, 'text');
    sameWhileCurrencyIs(statics, currencies);
    for (let i = 1; i < requests.length; i++) {
        if (currencies[i] !== currencies[i - 1]) continue;
        const shared = sharedPrefix(requests[i - 1].prompt, requests[i].prompt);
        assert.ok(shared.chars >= requests[i].prompt.indexOf(statics[i]) + statics[i].length, `request ${i} shares at least the static part with the one before`);
    }
});

test('assemble: the static text depends on the registry only, never on the view, the receipts or the settings', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [probeModule()] });
    t.after(() => h.close());
    const r = prng(99);
    const texts = new Set();
    for (let i = 0; i < 200; i++) {
        await h.send(`T${i}`, randomReply(r));
        const view = makeView({ store: h.store, registry: h.registry, settings: h.settings, chat: h.ctx.chat });
        const untold = Array.from({ length: r.int(0, 3) }, (_, k) => ({ id: `rc_${String(k).padStart(8, '0')}`, summary: `Something ${r.int(0, 99)} happened.`, narrate: true }));
        const result = assemble({ registry: h.registry, view, untold, settings: { tailBudget: r.int(100, 3000) }, cues: { 'qa-probe': [`cue ${i}`] } });
        texts.add(result.staticText);
    }
    assert.equal(texts.size, 1);
});

test('v1 keys: cleared on load, and nothing ever writes them again', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [probeModule()] });
    t.after(() => h.close());
    h.close();
    // A v1 copy left in SillyTavern's extension prompts (as v1 0.9.x wrote them).
    for (const [key] of V1_KEYS) h.ctx.setExtensionPrompt(key, `OLD v1 TEXT in ${key}`, 0, 0, false, 0);
    const from = h.st.promptLog.length;
    h.turn.install({ globalName: null });
    for (const [key] of V1_KEYS) assert.equal(h.st.prompt(key), '', `${key} is empty after load`);
    await h.sdk.command('probe.tick', {});
    const { request } = await h.send('Hi.', 'Hello.\n<Changes>\n+ item Rope\n</Changes>');
    assert.ok(!JSON.stringify(request).includes('OLD v1 TEXT'), 'no v1 text reaches the model');
    const written = h.st.promptLog.slice(from).filter(entry => V1_KEYS.some(([key]) => key === entry.key));
    assert.ok(written.length >= V1_KEYS.length, 'load writes each v1 key');
    assert.ok(written.every(entry => entry.value === ''), 'every write to a v1 key empties it');
    assert.deepEqual(Object.keys(h.st.prompts()).filter(key => h.st.prompts()[key].value).sort(), [], 'after the reply every slot is empty again');
});

test('quiet and impersonate: no static part, no tail, nothing captured, nothing marked as told', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [probeModule()] });
    t.after(() => h.close());
    await h.send('One.', 'Fine.');
    await h.sdk.command('probe.tick', {});
    const untold = h.store.untold().map(receipt => receipt.id);
    assert.equal(untold.length, 1);
    const head = JSON.stringify(h.head());
    for (const type of ['quiet', 'impersonate', 'QUIET', ' Impersonate ']) {
        const chatBefore = JSON.stringify(h.ctx.chat);
        const result = await h.st.generate(type, { reply: 'Summary.\n<Changes>\n+ item Free Gold | qty: 99\n</Changes>' });
        const text = JSON.stringify(result.request);
        assert.ok(!text.includes(STATIC_MARKER), `${type}: no static part`);
        assert.ok(!text.includes(HAPPENED), `${type}: no [Happened]`);
        assert.ok(!text.includes('[Probe]'), `${type}: no module tail`);
        assert.equal(h.st.prompt(STATIC_KEY), '');
        assert.equal(h.st.prompt(TAIL_KEY), '');
        assert.equal(JSON.stringify(h.head()), head, `${type}: nothing captured`);
        assert.equal(JSON.stringify(h.ctx.chat), chatBefore, `${type}: the chat is untouched`);
        assert.deepEqual(h.store.untold().map(receipt => receipt.id), untold, `${type}: nothing marked as told`);
    }
    const { request } = await h.send('Two.', 'Told.');
    assert.ok(request.chat.at(-1).content.startsWith(`${HAPPENED}\nTick 1.`), 'the next story reply still tells it');
});

test('a quiet generation right after a story reply was prepared does not carry or eat its notes', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [probeModule()] });
    t.after(() => h.close());
    await h.send('One.', 'Fine.');
    await h.sdk.command('probe.tick', {});
    h.st.addUser('Two.');
    await h.turn.interceptor([], 8192, () => {}, 'normal');
    assert.ok(h.st.prompt(TAIL_KEY).startsWith(HAPPENED));
    // An extension's quiet prompt (a summary) runs before the reply's own prompt is built.
    await h.turn.interceptor([], 8192, () => {}, 'quiet');
    assert.equal(h.st.prompt(TAIL_KEY), '', 'the quiet prompt gets nothing');
    h.turn.onPromptReady({ chat: [{ role: 'system', content: 'summary' }], dryRun: false });
    assert.ok(h.st.prompt(TAIL_KEY).startsWith(HAPPENED), 'the reply\'s notes are back for its own prompt');
});
