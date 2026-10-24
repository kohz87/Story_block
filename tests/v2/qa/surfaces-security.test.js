// UI stage 4a's surfaces (the story panel's tabs and head, the bar and its notice, the notes, the Choices strip, the
// changes card, the HUD, the dialog mount, the game view's navigation): built with DOM calls and textContent only, no
// markup or script from text, no randomness or clock in what they draw. A hostile line (markup, script in an option or a
// note) stays text: the Choices button shows it as its text and a click only fills the box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
    'host-ui.js', 'ui-host.js', 'extras-ui.js', 'reply-notes.js', 'screens/changes-card.js',
    'view/widgets/nav.js', 'view/mounts/dialog.js', 'view/mounts/screen.js', 'view/mounts/card.js', 'view/mounts/hud.js',
    'view/theme.js',
];
const FORBIDDEN = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|Math\.random|Date\.now/;

test('no innerHTML, outerHTML, insertAdjacentHTML, document.write, eval or randomness in the surfaces\' sources', () => {
    for (const file of FILES) {
        const source = readFileSync(new URL(`../../../src/v2/${file}`, import.meta.url), 'utf8');
        const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
        assert.doesNotMatch(code, FORBIDDEN, file);
    }
});

test('the tab strip built from a hostile title: the title is text, and the strip has no markup from it', () => {
    // host-ui.js passes the tab's title as the block's label (textContent in nav.js); the card and the notes do the same.
    const nav = readFileSync(new URL('../../../src/v2/view/widgets/nav.js', import.meta.url), 'utf8');
    assert.match(nav, /h\(doc, 'span', `ss-\$\{kind\}-label`, item\.label\)/, 'the label is text');
    const hostUi = readFileSync(new URL('../../../src/v2/host-ui.js', import.meta.url), 'utf8');
    assert.match(hostUi, /label: tab\.title,/);
    assert.doesNotMatch(hostUi.slice(hostUi.indexOf('function decorate()'), hostUi.indexOf('function draw()')), /innerHTML/);
});

test('the Choices option of hostile text is a button with that text, never an element', async t => {
    const { createHost } = await import('../../../testkit/index.js');
    const { setupDom } = await import('../view/mounts/helpers.js');
    const { mountUi } = await import('../../../src/v2/ui-host.js');
    const { makeMessage } = await import('../../ui-fake-dom.js');
    const { CHOICES_FEATURE } = await import('../../../src/v2/extras.js');
    t.mock.method(console, 'warn', () => {});
    const doc = setupDom();
    const box = doc.createElement('textarea');
    box.id = 'send_textarea';
    box.value = '';
    box.dispatchEvent = () => {};
    doc.body.appendChild(box);
    const host = await createHost({ settings: { features: { [CHOICES_FEATURE]: true } }, modules: [] });
    t.after(() => host.close());
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: 'test' });
    t.after(() => ui.destroy());
    await host.send('Hello.', 'The road.');
    const hostile = '<img src=x onerror=alert(1)> <script>alert(2)</script>';
    await host.send('Look.', `The wall.\n\n<Changes>\n? choice ${hostile}\n</Changes>`);
    for (const old of doc.querySelectorAll('.mes')) old.remove();
    host.ctx.chat.forEach((message, index) => makeMessage(doc, index));
    ui.extras.refreshAll();
    const index = host.ctx.chat.length - 1;
    const option = doc.querySelector(`.mes[mesid="${index}"] .story-suite-choice`);
    assert.ok(option, 'drawn');
    assert.match(option.textContent, /<img src=x onerror=alert\(1\)>/, 'the markup is the button\'s text');
    assert.equal(doc.querySelector(`.mes[mesid="${index}"] img`), null, 'no image element from the story');
    assert.equal(doc.querySelector(`.mes[mesid="${index}"] script`), null, 'no script element from the story');
});
