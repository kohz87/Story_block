// "Show what's sent" and modules' own prompts in the prompt size (v1-med: V1_AUDIT #4 and #9).
//
// - Story Suite's settings fold has, under the prompt size, a "Show what's sent" sub-fold: the exact text of
//   every part the next reply would get (the static part, this reply's part, and what a module sends on its
//   own), per module, with Copy. It only reads: nothing is sent and nothing is stored.
// - A module that sends text with the reply under its own prompt keys (NPC State Delta's dossiers) says what
//   through its `ownPrompt(view)` hook. turn.previewFit() lists it (`own`), the prompt size shows it as a row
//   of its own and in the total, and it counts toward the share of the context (prompt.js contextFit): the
//   tail gets what the static part and it leave, never below MIN_TAIL_BUDGET. The static part never changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { DEFAULT_CONTEXT_SHARE, MIN_TAIL_BUDGET, contextFit, estimateTokens } from '../../src/v2/prompt.js';
import { createRegistry } from '../../src/v2/registry.js';
import { createSettings } from '../../src/v2/sdk.js';
import { SENT_FOLD, SETTINGS_TEXT, promptSize, renderSettingsHost, sentText } from '../../src/v2/host-ui.js';
import { installFakeDom } from '../ui-fake-dom.js';

const T = SETTINGS_TEXT.sent;

// A module with a short static part and a long tail (4 required lines, 150 optional ones).
const talker = {
    id: 'zz-talk', name: 'Talker',
    context: {
        static: () => 'Talker rules: keep it short.',
        tail: () => ({
            lines: ['Need 1: the gate is shut.', 'Need 2: the guard sleeps.'],
            optional: Array.from({ length: 150 }, (_, i) => `Maybe ${i + 1}: a detail of the scene that can be left out.`),
        }),
    },
};
// A module that sends its own text (as NPC State Delta does), `size` characters of it.
const sender = (size = 2000, extra = {}) => ({
    id: 'zz-own', name: 'Own Sender',
    hooks: { ownPrompt: () => [{ label: 'Live dossier', text: `Dossier for {{user}}: ${'d'.repeat(size)}` }] },
    ...extra,
});

async function host(t, modules, { contextSize = 8192 } = {}) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules, st: { contextSize } });
    t.after(() => h.close());
    return h;
}
const last = (h, key) => h.st.promptLog.filter(entry => entry.key === key && entry.value).at(-1)?.value ?? '';

test('previewFit lists what a module sends on its own, names filled in, counted at four characters a token', async t => {
    const h = await host(t, [talker, sender(400)]);
    const { parts, fit, own } = h.turn.previewFit();
    assert.ok(Array.isArray(parts) && parts.length);
    assert.equal(own.length, 1);
    assert.equal(own[0].module, 'zz-own');
    assert.equal(own[0].label, 'Live dossier');
    assert.equal(own[0].place, 'own');
    assert.doesNotMatch(own[0].text, /\{\{user\}\}/, 'names are filled in as SillyTavern fills them');
    assert.equal(own[0].tokens, estimateTokens(own[0].text));
    assert.ok(!parts.some(part => part.place === 'own'), 'the parts Story Block sends stay its own');
    // No reply yet: no context size known, so no fit.
    assert.equal(fit, null);
    // preview() (parts only) is unchanged.
    assert.deepEqual(h.turn.preview().map(part => part.text), parts.map(part => part.text));
});

test('a module alone (no ownPrompt hook): own is empty, the size has no such row', async t => {
    const h = await host(t, [talker]);
    assert.deepEqual(h.turn.previewFit().own, []);
    const size = promptSize(h.turn.preview(), {});
    assert.deepEqual(size.own, []);
    assert.equal(size.total, size.static + size.tail);
});

test('an ownPrompt hook that throws, answers a promise or nothing counts nothing and holds nothing back', async t => {
    const h = await host(t, [talker, {
        id: 'zz-bad', name: 'Bad',
        hooks: { ownPrompt: () => { throw new Error('broken'); } },
    }, {
        id: 'zz-late', name: 'Late',
        hooks: { ownPrompt: async () => [{ text: 'late text' }] },
    }, {
        id: 'zz-none', name: 'None',
        hooks: { ownPrompt: () => null },
    }, {
        id: 'zz-str', name: 'Plain',
        hooks: { ownPrompt: () => 'plain words' },
    }]);
    const { own } = h.turn.previewFit();
    assert.deepEqual(own.map(part => [part.module, part.label, part.text]), [['zz-str', 'Plain', 'plain words']], 'a string is one part labelled with the module name');
    await h.send('I wait.', 'Rain.');
    assert.ok(last(h, 'story_suite_static').includes('Talker rules'), 'the reply went out');
});

test('a feature that is off: its ownPrompt hook is not asked', async t => {
    let asked = 0;
    const h = await host(t, [talker, {
        id: 'zz-feat', name: 'Feat',
        features: [{ id: 'zz-feat.dossier', label: 'Dossier', default: true }],
        hooks: { ownPrompt: Object.assign(() => { asked += 1; return 'some text'; }, { feature: 'zz-feat.dossier' }) },
    }]);
    assert.equal(h.turn.previewFit().own.length, 1);
    h.features.set('zz-feat.dossier', false);
    const before = asked;
    assert.deepEqual(h.turn.previewFit().own, []);
    assert.equal(asked, before);
});

test('contextFit: a module\'s own prompt takes from the share before the tail, never below the least', () => {
    const plain = contextFit({ room: 10000 }, 1000, {});
    const withOwn = contextFit({ room: 10000 }, 1000, {}, 1500);
    assert.equal(plain.own, 0);
    assert.equal(withOwn.own, 1500);
    assert.equal(plain.budget, 1500, 'share 4,000 − static 1,000 leaves more than the tail budget');
    assert.equal(withOwn.budget, 1500, 'still room for the whole tail budget');
    assert.equal(contextFit({ room: 6000 }, 1000, {}, 900).budget, 2400 - 1000 - 900);
    assert.equal(contextFit({ room: 6000 }, 1000, {}, 5000).budget, MIN_TAIL_BUDGET);
    assert.equal(contextFit({ room: 6000 }, 3000, {}, 0).tooSmall, true, 'the notice is about the instructions alone');
    assert.equal(contextFit({ room: 6000 }, 1000, {}, 5000).tooSmall, false, 'a big own prompt only cuts the tail');
    assert.equal(contextFit({ room: 6000 }, 1000, {}, -5).own, 0);
});

test('a small context: the tail sent is cut so static + tail + the module\'s own text fit the share; static unchanged', async t => {
    const contextSize = 6000;
    const share = Math.floor(contextSize * DEFAULT_CONTEXT_SHARE / 100);
    const alone = await host(t, [talker], { contextSize });
    await alone.send('I wait.', 'Rain.');
    const both = await host(t, [talker, sender(2400)], { contextSize });
    await both.send('I wait.', 'Rain.');
    const own = both.turn.previewFit().own[0].tokens;
    const tailAlone = last(alone, 'story_suite_tail_1');
    const tailBoth = last(both, 'story_suite_tail_1');
    const stat = last(both, 'story_suite_static');
    assert.ok(estimateTokens(tailBoth) < estimateTokens(tailAlone), 'less tail when the module sends its own text');
    assert.ok(estimateTokens(stat) + estimateTokens(tailBoth) + own <= share, `static ${estimateTokens(stat)} + tail ${estimateTokens(tailBoth)} + own ${own} within ${share}`);
    for (const line of ['Need 1', 'Need 2']) assert.match(tailBoth, new RegExp(line), 'required lines kept');
    // The static part is byte-identical with and without it, and reply to reply.
    assert.equal(last(alone, 'story_suite_static'), stat);
    await both.send('Again.', 'Rain again.');
    assert.equal(last(both, 'story_suite_static'), stat);
    // Story Block never sends the module's own text.
    assert.ok(!both.st.promptLog.some(entry => String(entry.value ?? '').includes('Dossier for')));
    assert.equal(both.turn.previewFit().fit.own, own);
});

test('previewing never sends or stores anything', async t => {
    const h = await host(t, [talker, sender(100)]);
    await h.send('I wait.', 'Rain.');
    const log = h.st.promptLog.length;
    const head = JSON.stringify(h.head());
    for (let i = 0; i < 3; i += 1) h.turn.previewFit();
    assert.equal(h.st.promptLog.length, log, 'no extension prompt was set');
    assert.equal(JSON.stringify(h.head()), head, 'the state is as it was');
});

// ---- the settings fold ----

const parts = [
    { module: 'story-suite', label: 'Story Suite: instructions', place: 'static', text: 'HEADER line\nsecond line' },
    { module: 'rpg-battle', label: 'RPG Battle: instructions', place: 'static', text: 'RB rules.' },
    { module: 'story-suite', label: 'Happened', place: 'tail', text: '[Happened]\nA wolf ran off.' },
    { module: 'rpg-battle', label: 'RPG Battle: this reply', place: 'tail', text: 'HP 10/12.', dropped: 2 },
    { module: 'loot', label: 'Loot: this reply', place: 'tail', text: '', dropped: 1 },
];
const own = [{ module: 'npc-state-delta', label: 'Live dossier', place: 'own', text: 'Mira: IDENTITY quiet smith.' }];

test('sentText: each place\'s parts, and Copy\'s text joined as prompt.js joins them', () => {
    const names = id => ({ 'npc-state-delta': 'NPC State Delta' })[id] ?? id;
    const out = sentText(parts, own, { names });
    assert.deepEqual(out.static.map(part => part.title), ['Story Suite: instructions', 'RPG Battle: instructions']);
    assert.deepEqual(out.tail.map(part => [part.title, part.dropped]), [['Happened', 0], ['RPG Battle: this reply', 2], ['Loot: this reply', 1]]);
    assert.deepEqual(out.own.map(part => part.title), ['NPC State Delta: Live dossier']);
    assert.equal(out.copy, [
        `[${T.static}]`, 'HEADER line\nsecond line\n\nRB rules.', '',
        `[${T.tail}]`, '[Happened]\nA wolf ran off.\nHP 10/12.', '',
        '[NPC State Delta: Live dossier]', 'Mira: IDENTITY quiet smith.',
    ].join('\n'));
    assert.equal(sentText([], []).copy, '', 'nothing to copy');
});

// Opens the "Show what's sent" fold as a click on its summary does (its texts are drawn then).
function openSent(root) {
    const sent = root.querySelector('.story-suite-sent');
    sent.open = true;
    sent.dispatch('toggle');
    return sent;
}

function renderFold({ withOwn = true, clipboard = undefined } = {}) {
    const doc = installFakeDom();
    if (clipboard !== undefined) doc.defaultView = { navigator: { clipboard } };
    const registry = createRegistry();
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    const root = doc.createElement('div');
    const openState = new Map();
    let calls = 0;
    const host = renderSettingsHost(root, { registry, settings, doc, openState, promptParts: () => { calls += 1; return withOwn ? { parts, fit: null, own } : { parts, fit: null }; } });
    return { doc, root, host, openState, calls: () => calls };
}

test('the prompt size shows a module\'s own prompt as a row of its own, counted in the total', () => {
    const { root } = renderFold();
    const size = root.querySelector('.story-suite-size');
    const row = size.querySelector('.story-suite-size-own');
    assert.equal(row.dataset.module, 'npc-state-delta');
    assert.equal(row.querySelector('span').textContent, fill(SETTINGS_TEXT.size.own, { name: 'npc-state-delta' }));
    const n = estimateTokens(own[0].text);
    assert.equal(row.querySelector('b').textContent, `about ${n} tokens`);
    const expected = promptSize(parts, { own });
    assert.equal(expected.total, expected.static + expected.tail + n);
    assert.equal(size.querySelector('.story-suite-size-total b').textContent, `about ${expected.total.toLocaleString('en-US')} tokens`);
    // An older source with no `own`: no such row.
    const old = renderFold({ withOwn: false }).root.querySelector('.story-suite-size');
    assert.equal(old.querySelector('.story-suite-size-own'), null);
});
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]);

test('Show what\'s sent: closed at first, every part\'s exact text by place, stays open across redraws', () => {
    const { root, host, openState } = renderFold();
    const closed = root.querySelector('.story-suite-sent');
    assert.ok(closed, 'drawn under the prompt size');
    assert.equal(closed.dataset.fold, SENT_FOLD);
    assert.equal(closed.open, false, 'closed until the reader opens it');
    assert.equal(closed.querySelector('summary b').textContent, T.title);
    assert.equal(closed.querySelectorAll('pre').length, 0, 'no text drawn while closed');
    const sent = openSent(root);
    const sections = sent.querySelectorAll('.story-suite-sent-section');
    assert.deepEqual(sections.map(node => node.dataset.place), ['static', 'tail', 'own']);
    const pres = sent.querySelectorAll('pre.story-suite-sent-text').map(node => node.textContent);
    assert.deepEqual(pres, ['HEADER line\nsecond line', 'RB rules.', '[Happened]\nA wolf ran off.', 'HP 10/12.', 'Mira: IDENTITY quiet smith.'], 'the texts as they are, empty ones left out');
    assert.deepEqual(sent.querySelectorAll('.story-suite-sent-dropped').map(node => node.textContent), [fill(T.dropped, { n: 2 }), T.droppedOne]);
    assert.match(sent.querySelector('.story-suite-sent-head').textContent, /Story Suite: instructions · about \d+ tokens/);
    // Opened, then the size is drawn again (a reply came, a setting changed): still open, texts drawn.
    assert.equal(openState.get(SENT_FOLD), true);
    host.refreshSize();
    assert.equal(root.querySelector('.story-suite-sent').open, true);
    assert.equal(root.querySelector('.story-suite-sent').querySelectorAll('pre').length, 5);
    host.refresh();
    assert.equal(root.querySelector('.story-suite-sent').open, true, 'and across a whole redraw');
});

test('Show what\'s sent: no own prompt, no such section; nothing in a place says so', () => {
    const doc = installFakeDom();
    const registry = createRegistry();
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc, promptParts: () => ({ parts: [parts[0]], fit: null }) });
    openSent(root);
    const sections = root.querySelectorAll('.story-suite-sent-section');
    assert.deepEqual(sections.map(node => node.dataset.place), ['static', 'tail']);
    assert.equal(sections[1].querySelector('p').textContent, T.nothing);
});

test('Copy: the whole text to the clipboard; without one the text is selected and the reader told', async () => {
    let copied = null;
    const { root } = renderFold({ clipboard: { writeText: async text => { copied = text; } } });
    openSent(root);
    const copy = root.querySelector('.story-suite-sent-copy');
    assert.equal(copy.textContent, T.copy);
    copy.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(copied, sentText(parts, own, { names: id => id }).copy);
    assert.equal(root.querySelector('.story-suite-sent-status').textContent, T.copied);

    const none = renderFold({ clipboard: null }).root;
    openSent(none);
    none.querySelector('.story-suite-sent-copy').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(none.querySelector('.story-suite-sent-status').textContent, T.copyFailed);
});

test('the fold reads the prompt once per drawing and sends nothing', async t => {
    const h = await host(t, [talker, sender(200)]);
    await h.send('I wait.', 'Rain.');
    const log = h.st.promptLog.length;
    const doc = installFakeDom();
    const root = doc.createElement('div');
    let calls = 0;
    renderSettingsHost(root, { registry: h.registry, settings: h.settings, doc, promptParts: () => { calls += 1; return h.turn.previewFit(); } });
    assert.equal(calls, 1);
    const sent = openSent(root);
    assert.equal(calls, 1, 'opening draws what was read');
    const pres = sent.querySelectorAll('pre.story-suite-sent-text').map(node => node.textContent);
    assert.ok(pres.some(text => text.startsWith('[Story Suite: how this story is kept]')), 'the real static header');
    assert.ok(pres.some(text => text.startsWith('Dossier for ')), 'the module\'s own text');
    assert.equal(h.st.promptLog.length, log);
    // The size row and the fit's share say the same about the module's text.
    const row = root.querySelector('.story-suite-size-own');
    assert.equal(row.dataset.module, 'zz-own');
    assert.equal(row.querySelector('span').textContent, fill(SETTINGS_TEXT.size.own, { name: 'Own Sender' }));
});
