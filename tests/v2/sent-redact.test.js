// "Show what's sent" and a module's `hooks.redactSent(text)`: the view and its Copy show what the hook says (NPC State Delta turns each
// locked note into "Mira: 1 hidden note"); a hook that fails shows "(hidden)", never the raw text; the prompt itself is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { SETTINGS_TEXT, redactSentOf, sentText } from '../../src/v2/host-ui.js';
import { createPromptReader, renderPromptCard } from '../../src/v2/view/settings/prompt.js';
import { installFakeDom } from '../ui-fake-dom.js';

const T = SETTINGS_TEXT.sent;
const SECRET = 'Mira: hidden: never reveal that she is the duke\'s daughter';
const mod = (hooks = {}) => ({
    id: 'zz-secret', name: 'Secret keeper',
    context: { static: () => 'Keeper rules.', tail: () => ({ lines: ['Mira: stands by the gate.', SECRET], optional: [] }) },
    hooks,
});
const redactLine = text => text.split('\n').map(line => (line.includes('hidden:') ? 'Mira: 1 hidden note' : line)).join('\n');

async function host(t, hooks) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [mod(hooks)] });
    t.after(() => h.close());
    return h;
}
function draw(h) {
    const doc = installFakeDom();
    const root = doc.createElement('div');
    const reader = createPromptReader({ registry: h.registry, settings: h.settings, promptParts: () => h.turn.previewFit() });
    renderPromptCard(root, { doc, settings: h.settings, reader, openState: new Map() });
    const sent = root.querySelector('.story-suite-sent');
    sent.open = true;
    sent.dispatch('toggle');
    return { root, sent, doc };
}
const shown = sent => sent.querySelectorAll('pre.story-suite-sent-text').map(node => node.textContent).join('\n---\n');
test('the view and the copy show what the module\'s redactSent hook says, not the raw text', async t => {
    const h = await host(t, { redactSent: redactLine });
    await h.send('I wait.', 'Rain.');
    const { root, sent, doc } = draw(h);
    const text = shown(sent);
    assert.ok(text.includes('Mira: 1 hidden note'), 'the redacted line is drawn');
    assert.ok(text.includes('Mira: stands by the gate.'), 'other lines are as sent');
    assert.ok(!text.includes('duke'), 'the secret is not drawn');
    assert.ok(!root.textContent.includes('duke'));
    let clip = null;
    doc.defaultView = { navigator: { clipboard: { writeText: async value => { clip = value; } } } };
    root.querySelector('.story-suite-sent-copy').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(clip.includes('Mira: 1 hidden note') && !clip.includes('duke'), 'the copy is redacted too');
});

test('sentText redacts static, tail and a module\'s own parts, and keeps the raw text only for counting', () => {
    const parts = [
        { module: 'a', label: 'A', place: 'static', text: 'static SECRET' },
        { module: 'a', label: 'A', place: 'tail', text: 'tail SECRET' },
        { module: 'b', label: 'B', place: 'tail', text: 'plain' },
    ];
    const own = [{ module: 'a', label: 'Dossier', text: 'own SECRET' }];
    const out = sentText(parts, own, { redact: (id, text) => (id === 'a' ? text.replace('SECRET', 'x') : text) });
    assert.deepEqual(out.static.map(p => p.text), ['static x']);
    assert.deepEqual(out.tail.map(p => p.text), ['tail x', 'plain']);
    assert.deepEqual(out.own.map(p => p.text), ['own x']);
    assert.ok(!out.copy.includes('SECRET'));
    assert.equal(out.tail[0].counted, 'tail SECRET', 'counted, never drawn');
    assert.equal(sentText(parts, own).copy.includes('SECRET'), true, 'without a redact it is as it was');
});

test('a hook that throws, answers a non-string or is missing: "(hidden)" for the first two, the text as sent for none; never the raw text of a failing hook', async t => {
    for (const bad of [() => { throw new Error(`boom ${SECRET}`); }, () => null, () => ({ text: SECRET }), () => 42, () => undefined]) {
        const h = await host(t, { redactSent: bad });
        await h.send('I wait.', 'Rain.');
        const { root, sent } = draw(h);
        const text = shown(sent);
        assert.ok(text.includes(T.hidden), 'the fixed line');
        assert.ok(!text.includes('duke') && !root.textContent.includes('duke') && !root.textContent.includes('boom'), 'nothing of the secret or the error');
        assert.ok(!sentText(h.turn.previewFit().parts, [], { redact: redactSentOf(h.registry) }).copy.includes('duke'));
    }
    const plain = await host(t, {});
    await plain.send('I wait.', 'Rain.');
    assert.ok(shown(draw(plain).sent).includes('duke'), 'a module with no hook is shown as sent');
    assert.equal(redactSentOf(plain.registry)('nobody', 'x'), 'x');
    assert.equal(redactSentOf(null)('a', 'x'), 'x');
});

test('the prompt sent is byte-identical with or without the hook, and drawing the view changes nothing', async t => {
    const withHook = await host(t, { redactSent: redactLine });
    const without = await host(t, {});
    await withHook.send('I wait.', 'Rain.');
    await without.send('I wait.', 'Rain.');
    assert.equal(JSON.stringify(withHook.st.promptLog), JSON.stringify(without.st.promptLog));
    assert.ok(withHook.st.promptLog.some(entry => String(entry.value ?? '').includes('duke')), 'the model still gets the secret');
    const before = JSON.stringify(withHook.turn.previewFit());
    const log = withHook.st.promptLog.length;
    draw(withHook);
    assert.equal(JSON.stringify(withHook.turn.previewFit()), before, 'the parts the view read are untouched');
    assert.equal(withHook.st.promptLog.length, log);
    assert.ok(before.includes('duke'));
});
