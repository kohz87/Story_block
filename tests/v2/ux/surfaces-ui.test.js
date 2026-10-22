// The surfaces of UI stage 4a in the DOM: the story panel's tab bar as the ss.tabs block (createTabHost: aria-current,
// one Tab stop, the arrows, a click chooses, the focus stays on the tab it was on across a redraw, every tab and a long
// title kept), and the Choices strip under a reply (folded by default, its summary's count, one option per row, a
// redraw keeps the reader's choice). The keys and the markup the tests and modules use are the same as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { makeMessage } from '../../ui-fake-dom.js';
import { setupDom } from '../view/mounts/helpers.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { createTabHost } from '../../../src/v2/host-ui.js';
import { CHOICES_FEATURE } from '../../../src/v2/extras.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const key = (node, name, init = {}) => node.dispatch('keydown', { key: name, ...init });
const block = (story, lines) => `${story}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const lastIndex = host => host.ctx.chat.length - 1;

// ---- the story panel's tab bar ----------------------------------------------------------------------

function tabsOf(titles) {
    return titles.map((title, i) => ({ id: `t${i}`, title, icon: 'fa-star', render(el) { el.textContent = `${title} pane`; } }));
}

test('the story panel\'s tab bar is the ss.tabs block: aria-current on the chosen tab, one Tab stop, the arrows move the focus, a click chooses', () => {
    const doc = installFakeDom();
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const registry = { tabs: () => tabsOf(['Alpha', 'Beta', 'Gamma']) };
    const panel = createTabHost(root, { registry, view: () => ({}), api: null, doc });
    const nav = root.querySelector('.ss-tabs');
    assert.equal(nav.tagName.toLowerCase(), 'nav');
    assert.equal(nav.getAttribute('aria-label'), 'Story panel tabs');
    const tabs = () => root.querySelectorAll('.story-suite-tab');
    assert.deepEqual(tabs().map(node => node.getAttribute('data-tab-id')), ['t0', 't1', 't2']);
    assert.deepEqual(tabs().map(node => node.getAttribute('aria-current')), ['page', null, null]);
    assert.deepEqual(tabs().map(node => node.getAttribute('tabindex')), ['0', '-1', '-1'], 'one Tab stop: the chosen tab');
    assert.deepEqual(tabs().map(node => node.querySelector('.story-suite-tab-label').textContent), ['Alpha', 'Beta', 'Gamma']);
    assert.equal(root.querySelector('.story-suite-pane').textContent, 'Alpha pane');

    // The arrow keys move the focus along the row; they do not choose.
    key(tabs()[0], 'ArrowRight');
    assert.equal(doc.activeElement, tabs()[1]);
    assert.equal(panel.active(), 't0', 'the arrow did not choose');
    assert.equal(tabs()[1].getAttribute('tabindex'), '0', 'the focused tab is the Tab stop');
    key(tabs()[1], 'End');
    assert.equal(doc.activeElement, tabs()[2]);
    key(tabs()[2], 'Home');
    assert.equal(doc.activeElement, tabs()[0]);

    // A click chooses: the pane shows the tab, aria-current moves, and the focus stays on that tab after the redraw.
    key(tabs()[0], 'ArrowRight');
    tabs()[1].click();
    assert.equal(panel.active(), 't1');
    assert.equal(root.querySelector('.story-suite-pane').textContent, 'Beta pane');
    assert.deepEqual(tabs().map(node => node.getAttribute('aria-current')), [null, 'page', null]);
    assert.equal(doc.activeElement, tabs()[1], 'the focus stays on the tab that was chosen');

    // A refresh keeps the chosen tab; a tab that is gone falls back to the first.
    panel.refresh();
    assert.equal(panel.active(), 't1');
    assert.deepEqual(tabs().map(node => node.getAttribute('aria-current')), [null, 'page', null]);
    panel.select('t9');
    assert.equal(panel.active(), 't0', 'an unknown id is the first tab');
});

test('the story panel\'s strip keeps every tab and a long title in full (the host\'s own limits, not the block\'s default)', () => {
    const doc = installFakeDom();
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const titles = Array.from({ length: 30 }, (_, i) => `Tab ${i}`);
    const long = 'A pack screen with a fairly long title that the block would cut at forty characters';
    titles.push(long);
    createTabHost(root, { registry: { tabs: () => tabsOf(titles) }, view: () => ({}), api: null, doc });
    const tabs = root.querySelectorAll('.story-suite-tab');
    assert.equal(tabs.length, 31);
    assert.equal(tabs[30].querySelector('.story-suite-tab-label').textContent, long);
});

// ---- the Choices strip under a reply --------------------------------------------------------------

async function page(t, { settings = { features: { [CHOICES_FEATURE]: true } } } = {}) {
    t.mock.method(console, 'warn', () => {});
    const doc = setupDom();
    const box = doc.createElement('textarea');
    box.id = 'send_textarea';
    box.value = '';
    box.events = [];
    box.dispatchEvent = event => box.events.push(event.type);
    doc.body.appendChild(box);
    const host = await createHost({ settings, modules: [] });
    t.after(() => host.close());
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    t.after(() => ui.destroy());
    const draw = () => {
        for (const old of doc.querySelectorAll('.mes')) old.remove();
        host.ctx.chat.forEach((message, index) => makeMessage(doc, index));
        ui.extras.refreshAll();
    };
    const at = (index, selector) => doc.querySelector(`.mes[mesid="${index}"] ${selector}`);
    return { doc, host, ui, draw, at, box };
}

test('the Choices strip is folded by default: a glass summary with the count, one full-width option per row; opened, the options show', async t => {
    const { host, ui, draw, at, box } = await page(t);
    await host.send('Hello.', 'The road.');
    await host.send('I look.', block('The wall.', ['? choice Climb the wall', '? choice Bribe the guard', '? choice Wait']));
    draw();
    const index = lastIndex(host);
    const fold = at(index, '.story-suite-choices-fold');
    assert.ok(fold, 'the strip is a details element');
    assert.equal(fold.tagName.toLowerCase(), 'details');
    assert.equal(fold.hasAttribute('open'), false, 'folded by default');
    assert.equal(at(index, '.story-suite-choices-summary .story-suite-choices-label').textContent, 'Choices');
    assert.equal(at(index, '.story-suite-choices-summary .story-suite-choices-count').textContent, '3');
    const options = [...at(index, '.story-suite-choices').querySelectorAll('.story-suite-choice')];
    assert.deepEqual(options.map(node => node.textContent), ['Climb the wall', 'Bribe the guard', 'Wait']);
    assert.ok(options.every(node => node.tagName.toLowerCase() === 'button' && node.getAttribute('type') === 'button'));

    // The reader opens the strip: a refresh of the same reply keeps it open (SillyTavern keeps the message element).
    fold.setAttribute('open', '');
    ui.extras.refreshAll();
    assert.equal(at(index, '.story-suite-choices-fold').hasAttribute('open'), true, 'the reader\'s choice is kept');

    // A click on an option still only fills the message box (and sends nothing).
    options[1].click();
    assert.equal(box.value, 'Bribe the guard');
    assert.deepEqual(box.events, ['input']);
});

test('a new reply folds its strip again; the strip is gone once the reader has answered', async t => {
    const { host, draw, at } = await page(t);
    await host.send('Hello.', block('The road.', ['? choice Walk on', '? choice Sit']));
    draw();
    const first = lastIndex(host);
    at(first, '.story-suite-choices-fold').setAttribute('open', '');
    await host.send('Walk on.', block('The bend.', ['? choice Look back']));
    draw();
    const second = lastIndex(host);
    assert.equal(at(second, '.story-suite-choices-fold').hasAttribute('open'), false, 'a new strip is folded');
    assert.equal(at(second, '.story-suite-choices-count').textContent, '1');
    assert.equal(at(first, '.story-suite-choices'), null, 'an earlier reply shows no strip');
});
