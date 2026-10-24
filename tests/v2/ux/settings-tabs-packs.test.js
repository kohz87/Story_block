// The Tabs & Packs section (src/v2/view/settings/tabs-packs.js, tabs-list.js, prompt.js, footer.js; UI stage, step 3e): three cards in the
// form engine's look (Tabs, Packs, Prompt) in place of Story Suite's fold and the Packs fold, and the footer bar "What's sent each reply".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { createCoreModule } from '../../../src/v2/domains/index.js';
import { packsFor } from '../../../src/v2/runtime.js';
import { HOST_FOLD, PACKS_FOLD, SENT_FOLD, SETTINGS_TEXT, TABS_FOLD, TABS_TEXT, promptSize } from '../../../src/v2/host-ui.js';
import { estimateTokens } from '../../../src/v2/prompt.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';
import { PROMPT_FOLD, PROMPT_KEYS, PROMPT_SCHEMA, PROMPT_TEXT, createPromptReader, footerSummary } from '../../../src/v2/view/settings/prompt.js';
import { renderTabsCard } from '../../../src/v2/view/settings/tabs-list.js';
import { sampleText } from '../packs/helpers/fixtures.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);

// A tabs control (ui-host.js tabsControl) over a list of rows, writing like the real one: { order, hidden } and Home fixed.
function fakeTabs(ids = ['home', 'party', 'inventory', 'quests']) {
    const state = { ids: [...ids], hidden: new Set(), calls: [] };
    return {
        state,
        rows: () => state.ids.map(id => ({ id, title: id[0].toUpperCase() + id.slice(1), icon: 'fa-star', where: ['tab', 'screen'], fixed: id === 'home', hidden: state.hidden.has(id) })),
        move(id, delta) {
            state.calls.push(['move', id, delta]);
            const movable = state.ids.filter(item => item !== 'home');
            const at = movable.indexOf(id);
            const to = at + delta;
            if (at < 0 || to < 0 || to >= movable.length) return;
            [movable[at], movable[to]] = [movable[to], movable[at]];
            state.ids = ['home', ...movable];
        },
        setHidden(id, hidden) { state.calls.push(['hide', id, hidden]); if (hidden) state.hidden.add(id); else state.hidden.delete(id); },
        reset() { state.calls.push(['reset']); state.ids = [...ids]; state.hidden.clear(); },
        isDefault: () => state.ids.join() === ids.join() && state.hidden.size === 0,
    };
}

async function open(options = {}) {
    const doc = setupDom();
    const host = await createHost({ modules: [], ...(options.host ?? {}) });
    const tabs = options.tabs ?? fakeTabs();
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, tabs, openState: new Map(), ...(options.window ?? {}) });
    win.select('tabs');
    const page = win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'tabs');
    return { doc, host, win, root: win.root, page, tabs };
}
const row = (page, id) => page.querySelectorAll('.ss-tabrow').find(node => node.dataset.tabId === id);
const field = (page, key) => page.querySelector(`.ss-prompt-card .ss-field[data-field="${key}"]`);
const search = (root, text) => {
    const input = root.querySelector('.ss-search-input');
    input.value = text;
    input.dispatch('input');
};

const PARTS = [
    { module: 'story-suite', label: 'Story Suite: instructions', place: 'static', text: 'x'.repeat(400) },
    { module: 'story-suite', label: 'Happened', place: 'tail', text: 'z'.repeat(200) },
];

test('the page: Tabs, Packs and Prompt cards in the form engine, no fold; the Story Suite fold is gone', async () => {
    const { page, host } = await open();
    assert.ok(page.querySelector('.ss-tabspacks'));
    assert.deepEqual(texts(page, '.ss-tabspacks > .ss-section > .ss-section-head .ss-section-title'), ['Tabs', 'Packs', 'Prompt']);
    assert.equal(page.querySelectorAll('details.story-suite-fold').length, 0);
    assert.equal(page.querySelector('[data-fold="story-suite"]'), null);
    assert.deepEqual(page.querySelectorAll('.ss-prompt-card .ss-field').map(node => node.dataset.field), PROMPT_KEYS);
    host.close();
});

test('Tabs: a row each with a switch and Up and Down; every control is a button, written through the same tabs control', async () => {
    const { page, host, tabs, doc } = await open();
    assert.deepEqual(page.querySelectorAll('.ss-tabrow').map(node => node.dataset.tabId), ['home', 'party', 'inventory', 'quests']);
    const party = row(page, 'party');
    const buttons = party.querySelectorAll('button');
    assert.equal(buttons.length, 3, 'Up, Down and the switch');
    assert.deepEqual(buttons.slice(0, 2).map(node => node.getAttribute('aria-label')), ['Move Party up', 'Move Party down']);
    assert.ok(buttons.every(node => (node.type ?? node.getAttribute('type')) === 'button' && !node.getAttribute('tabindex')), 'real buttons in the Tab order');
    assert.equal(party.querySelector('[role="switch"]').getAttribute('aria-checked'), 'true');
    assert.equal(party.querySelector('[role="switch"]').getAttribute('aria-labelledby'), party.querySelector('.ss-tabrow-title').id, 'the switch is named by the tab');
    // Up and Down: written through tabs.move; the list is drawn again in the new order and the focus stays on the control.
    assert.equal(party.querySelector('.ss-tabrow-up').disabled, true, 'the first after Home cannot go up');
    party.querySelector('.ss-tabrow-down').click();
    assert.deepEqual(tabs.state.calls.at(-1), ['move', 'party', 1]);
    assert.deepEqual(page.querySelectorAll('.ss-tabrow').map(node => node.dataset.tabId), ['home', 'inventory', 'party', 'quests']);
    assert.ok(doc.activeElement === row(page, 'party').querySelector('.ss-tabrow-down'));
    assert.match(page.querySelector('.ss-tabrows-status').textContent, /Party moved down\./);
    row(page, 'party').querySelector('.ss-tabrow-down').click();
    assert.equal(row(page, 'party').querySelector('.ss-tabrow-down').disabled, true, 'the last cannot go down');
    assert.ok(doc.activeElement === row(page, 'party').querySelector('.ss-tabrow-up'), 'the focus goes to the neighbour button when its own is disabled');
    // Hide and show.
    const quests = () => row(page, 'quests').querySelector('[role="switch"]');
    quests().click();
    assert.deepEqual(tabs.state.calls.at(-1), ['hide', 'quests', true]);
    assert.equal(quests().getAttribute('aria-checked'), 'false');
    assert.ok(row(page, 'quests').classList.contains('ss-tabrow-hidden'));
    assert.match(row(page, 'quests').textContent, /hidden/);
    assert.ok(doc.activeElement === quests(), 'the focus stays on the switch');
    quests().click();
    assert.deepEqual(tabs.state.calls.at(-1), ['hide', 'quests', false]);
    assert.match(page.querySelector('.ss-tabrows-status').textContent, /Quests is shown\./);
    // Reset to default.
    const reset = page.querySelector('.ss-tabrows-reset');
    assert.equal(reset.disabled, false);
    reset.click();
    assert.deepEqual(tabs.state.calls.at(-1), ['reset']);
    assert.deepEqual(page.querySelectorAll('.ss-tabrow').map(node => node.dataset.tabId), ['home', 'party', 'inventory', 'quests']);
    assert.equal(page.querySelector('.ss-tabrows-reset').disabled, true);
    host.close();
});

test('Tabs: Home\'s switch is locked, on and disabled, with "Always shown"; hiding the last tab that is shown is refused with a message', async () => {
    const { page, host, tabs } = await open();
    // Home: drawn on and locked (disabled), with the reason beside it; pressing it does nothing.
    const home = row(page, 'home').querySelector('[role="switch"]');
    assert.equal(home.getAttribute('aria-checked'), 'true');
    assert.equal(home.disabled, true);
    const lock = row(page, 'home').querySelector('.ss-tabrow-lock');
    assert.equal(lock.textContent, TABS_TEXT.alwaysShown);
    assert.equal(lock.textContent, 'Always shown');
    assert.ok(lock.classList.contains('ss-field-tag-why'));
    assert.equal(home.getAttribute('aria-describedby'), lock.id, 'the switch is described by it');
    home.click();
    assert.equal(home.getAttribute('aria-checked'), 'true');
    assert.equal(tabs.state.calls.some(call => call[0] === 'hide' && call[1] === 'home'), false, 'nothing was written');
    assert.equal(page.querySelector('.ss-tabrows-refusal').hidden, true);
    assert.equal(page.querySelectorAll('.ss-tabrow-lock').length, 1, 'only Home is locked');
    assert.equal(row(page, 'party').querySelector('[role="switch"]').disabled, false);
    host.close();
    // The guard is the card's own, whatever the control: with no other tab shown, a tab that is not Home may not be hidden either.
    const doc = setupDom();
    const only = fakeTabs(['alone']);
    const root = doc.createElement('div');
    const card = renderTabsCard(root, { doc, tabs: only });
    const toggle = root.querySelector('[role="switch"]');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    assert.deepEqual(only.state.calls, [], 'refused: the control was not asked');
    assert.equal(root.querySelector('.ss-tabrows-refusal').textContent, 'At least one tab has to stay shown, so Alone stays.');
    card.destroy();
    // No tabs control (an older caller): the card says there are none.
    const bare = renderTabsCard(doc.createElement('div'), { doc, tabs: null });
    assert.equal(bare.count(), 0);
    assert.match(bare.el.textContent, new RegExp(TABS_TEXT.none));
});

test('Tabs: searched with the rest, by the tabs\' names; the fold ids still land on the card', async () => {
    const { root, page, win, host } = await open();
    search(root, 'quests');
    assert.equal(page.hidden, false);
    assert.deepEqual(page.querySelectorAll('.ss-tabrow').filter(node => !node.hidden).map(node => node.dataset.tabId), ['quests']);
    search(root, '');
    host.close();
    for (const fold of [TABS_FOLD, HOST_FOLD]) {
        const again = await open({ window: { fold } });
        assert.equal(again.win.section(), 'tabs', fold);
        assert.ok(again.doc.activeElement && again.page.querySelector('.ss-tabs-card').contains(again.doc.activeElement), `${fold} focuses the Tabs card`);
        again.host.close();
    }
    void win;
});

test('Packs: the Packs fold\'s panel in a card, as list rows; Import has the focus when opened at PACKS_FOLD; a pack is found by name', async () => {
    const ctx = { extensionSettings: {} };
    const live = packsFor(ctx);
    const registry = createRegistry();
    registry.register(createCoreModule({ packs: live }));
    const settings = createSettings({ root: () => ctx.extensionSettings, registry, save: () => {} });
    const doc = setupDom();
    await live.packs.install(sampleText, { source: 'file', origin: 'riverside.json' });
    const win = openSettingsWindow({ registry, settings, doc, tabs: fakeTabs(), openState: new Map(), fold: PACKS_FOLD });
    assert.equal(win.section(), 'tabs');
    const card = win.root.querySelector('.ss-packs-card');
    assert.equal(card.dataset.fold, PACKS_FOLD);
    assert.ok(doc.activeElement === card.querySelector('.ss-packs-import'), 'Import has the focus');
    const rowNode = card.querySelector('.ss-packs-row');
    assert.ok(rowNode.classList.contains('ss-listcard-row'), 'an ss.listcard row');
    assert.equal(rowNode.querySelector('.ss-packs-name').textContent, 'Riverside Starter 1.0.0');
    assert.match(rowNode.querySelector('.ss-packs-facts').textContent, /^4 items, 1 creature, 1 shop.* · by Story Suite examples · riverside\.json$/);
    assert.equal(rowNode.querySelector('.ss-packs-enabled').getAttribute('role'), 'switch');
    // Searched by the pack's name.
    search(win.root, 'riverside');
    assert.equal(card.hidden, false);
    search(win.root, 'zzz-nothing');
    assert.equal(card.hidden, true);
    search(win.root, '');
    // Remove asks first.
    rowNode.querySelector('.ss-packs-remove').click();
    assert.equal(live.packs.list().length, 1);
    assert.ok(doc.activeElement === card.querySelector('.ss-packs-confirm-no'));
    card.querySelector('.ss-packs-confirm-yes').click();
    await tick();
    assert.equal(live.packs.list().length, 0);
    assert.equal(card.querySelector('.ss-packs-empty').textContent, 'No packs installed.');
    win.close();
});

test('Prompt: the budgets are sliders and a number over the host settings; a change is stored, the size and the footer follow', async () => {
    let reads = 0;
    const { page, host, win } = await open({ window: { promptParts: () => { reads += 1; return { parts: PARTS, fit: null, own: [] }; } } });
    assert.deepEqual(PROMPT_KEYS, ['tailBudget', 'contextShare', 'maxChangeLines']);
    assert.equal(PROMPT_SCHEMA.tailBudget.form, 'slider');
    assert.equal(PROMPT_SCHEMA.contextShare.form, 'slider');
    assert.equal(PROMPT_SCHEMA.maxChangeLines.form, undefined, 'a number');
    const tail = field(page, 'tailBudget').querySelector('input');
    assert.equal(tail.type, 'range');
    assert.equal(tail.step, '50');
    assert.equal(field(page, 'contextShare').querySelector('input').step, '5');
    assert.equal(field(page, 'maxChangeLines').querySelector('input').type !== 'range', true);
    assert.equal(tail.value, '1500');
    assert.equal(field(page, 'tailBudget').querySelector('.ss-slider-value').textContent, '1500 tokens');
    // The size: the estimate, then the budget it is read against.
    const tailTokens = estimateTokens('z'.repeat(200));
    const sums = () => page.querySelectorAll('.story-suite-size-sum > li b').map(node => node.textContent);
    assert.deepEqual(sums(), [`about ${estimateTokens('x'.repeat(400))} tokens`, `about ${tailTokens} tokens of 1,500`, `about ${estimateTokens('x'.repeat(400)) + tailTokens} tokens`]);
    const foot = win.footer();
    assert.deepEqual(foot.summary(), { none: false, tail: tailTokens, budget: 1500, total: estimateTokens('x'.repeat(400)) + tailTokens, exact: false, over: false, ratio: tailTokens / 1500 });
    // Moving the slider stores the new budget (settings.set(null, …)), and both places say it.
    tail.value = '1000';
    tail.dispatch('change');
    assert.equal(host.settings().tailBudget, 1000);
    assert.equal(sums()[1], `about ${tailTokens} tokens of 1,000`);
    assert.equal(foot.summary().budget, 1000);
    assert.match(foot.el.querySelector('.ss-settings-foot-value').textContent, /of 1,000 tokens$/);
    // A budget below what is sent: over, said on the bar.
    tail.value = '100';
    tail.dispatch('change');
    assert.equal(foot.summary().over, tailTokens > 100);
    assert.equal(foot.el.classList.contains('ss-settings-foot-over'), tailTokens > 100);
    // The number box.
    const lines = field(page, 'maxChangeLines').querySelector('input');
    lines.value = '40';
    lines.dispatch('change');
    assert.equal(host.settings().maxChangeLines, 40);
    assert.ok(reads >= 3);
    host.close();
});

test('Prompt: SillyTavern\'s tokenizer replaces the estimate when it answers; one that fails leaves the estimate', async () => {
    const counted = [];
    const countTokens = async text => { counted.push(text); return text.length / 10; };
    const { page, win, host } = await open({ window: { countTokens, promptParts: () => ({ parts: PARTS, fit: null, own: [] }) } });
    assert.equal(page.querySelector('.story-suite-size').dataset.exact, 'false', 'the estimate first');
    await tick();
    await tick();
    assert.equal(page.querySelector('.story-suite-size').dataset.exact, 'true');
    assert.deepEqual(page.querySelectorAll('.story-suite-size-sum > li b').map(node => node.textContent), ['40 tokens', '20 tokens of 1,500', '60 tokens']);
    assert.match(page.querySelector('.story-suite-size-how').textContent, /SillyTavern's tokenizer/);
    assert.equal(win.footer().summary().exact, true);
    assert.equal(win.footer().el.dataset.exact, 'true');
    host.close();
    const broken = await open({ window: { countTokens: async () => { throw new Error('no tokenizer'); }, promptParts: () => ({ parts: PARTS, fit: null, own: [] }) } });
    await tick();
    await tick();
    assert.equal(broken.page.querySelector('.story-suite-size').dataset.exact, 'false');
    assert.equal(broken.win.footer().summary().exact, false);
    broken.host.close();
});

test('the footer bar: on every page, "What\'s sent each reply" with the numbers and a meter; pressing it opens the Prompt card', async () => {
    const { root, win, host, doc } = await open({ window: { promptParts: () => ({ parts: PARTS, fit: null, own: [] }) } });
    const foot = root.querySelector('.ss-settings-foot');
    assert.equal(foot.tagName, 'BUTTON');
    assert.equal(foot.type, 'button');
    assert.equal(foot.querySelector('.ss-settings-foot-label').textContent, PROMPT_TEXT.footerLabel);
    assert.match(foot.getAttribute('aria-label'), /^What's sent each reply: \d+ of 1,500 tokens for the notes, \d+ in all, estimated\. /);
    assert.ok(foot.querySelector('.ss-settings-foot-meter [style], .ss-settings-foot-fill'), 'a meter');
    assert.equal(foot.parentNode, win.window, 'a child of the window, under the pages');
    // On every page.
    for (const id of ['look', 'features', 'money', 'assist', 'modules', 'diagnostics']) {
        win.select(id);
        assert.ok(root.querySelector('.ss-settings-foot') === foot && !foot.hidden, `${id} has it`);
    }
    // Pressing it: the Tabs & Packs page, the first budget focused.
    win.select('look');
    foot.click();
    assert.equal(win.section(), 'tabs');
    assert.ok(doc.activeElement === field(root, 'tailBudget').querySelector('input'));
    host.close();
});

test('the footer bar with no chat open says so; it is read at open and on change, never while the reader types in the search box', async () => {
    const none = await open();
    assert.deepEqual(none.win.footer().summary(), { none: true });
    assert.equal(none.root.querySelector('.ss-settings-foot-value').textContent, PROMPT_TEXT.footerNone);
    assert.equal(none.page.querySelector('.ss-prompt-card .story-suite-size').textContent, SETTINGS_TEXT.size.none);
    none.host.close();
    let reads = 0;
    const { root, win, host } = await open({ window: { promptParts: () => { reads += 1; return { parts: PARTS, fit: null, own: [] }; } } });
    const atOpen = reads;
    assert.ok(atOpen >= 2, 'the card and the bar read it once each');
    for (const text of ['q', 'qu', 'que', 'ques']) search(root, text);
    assert.equal(reads, atOpen, 'no reading per keystroke');
    win.refreshSize();
    assert.ok(reads > atOpen, 'the story moved: read again');
    const before = reads;
    win.refresh();
    assert.ok(reads > before, 'a refresh reads again');
    host.close();
});

test('createPromptReader and footerSummary: the estimate at once, the tokenizer\'s count after; nothing to read is null', async () => {
    const registry = createRegistry();
    const settings = createSettings({ root: () => ({}), registry, save: () => {} });
    const reader = createPromptReader({ registry, settings, promptParts: () => ({ parts: PARTS, fit: { budget: 700, size: 8000, share: 3200, room: 6000, percent: 40, tooSmall: false }, own: [] }), countTokens: async text => text.length });
    const read = reader.read();
    assert.equal(read.budget, 700, 'a small context cuts the budget');
    assert.equal(read.exact, false);
    assert.deepEqual(read.size, promptSize(PARTS, { budget: 700, names: read.names }));
    const exact = await reader.readExact(read);
    assert.equal(exact.exact, true);
    assert.equal(exact.size.static, 400);
    assert.equal(exact.size.tail, 200);
    assert.equal(footerSummary(exact).ratio, 200 / 700);
    assert.equal(footerSummary(null).none, true);
    assert.equal(createPromptReader({ registry, settings }).read(), null, 'no source');
    assert.equal(createPromptReader({ registry, settings, promptParts: () => { throw new Error('no chat'); } }).read(), null);
    assert.equal(await createPromptReader({ registry, settings, promptParts: () => PARTS }).readExact(reader.read()), null, 'no tokenizer');
});

test('"Show what\'s sent" under the size: closed at first, opened by SENT_FOLD or PROMPT_FOLD; it stays open across a redraw', async () => {
    const { page, win, host, doc } = await open({ window: { promptParts: () => ({ parts: PARTS, fit: null, own: [] }) } });
    const sent = () => page.querySelector('details.story-suite-sent');
    assert.equal(sent().open, false);
    assert.equal(sent().querySelectorAll('pre').length, 0);
    host.close();
    const at = await open({ window: { fold: SENT_FOLD, promptParts: () => ({ parts: PARTS, fit: null, own: [] }) } });
    const details = at.page.querySelector('details.story-suite-sent');
    assert.equal(details.open, true);
    assert.equal(details.querySelectorAll('pre.story-suite-sent-text').length, 2);
    assert.ok(at.doc.activeElement === details.querySelector('summary'));
    at.win.refresh();
    assert.equal(at.page.querySelector('details.story-suite-sent').open, true, 'and across a redraw');
    at.host.close();
    const prompt = await open({ window: { fold: PROMPT_FOLD } });
    assert.ok(prompt.doc.activeElement === field(prompt.page, 'tailBudget').querySelector('input'));
    prompt.host.close();
    void win;
    void doc;
});
