// Story Suite overlay: tabs in suite order, the Overview (switches, one Source of truth table),
// extension panels moved in and put back exactly where they were, Esc and focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, same, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const { storySuite } = await import('../src/suite.js');
const overlay = await import('../src/ui/suite-overlay.js');
const { applySource, areaCandidates, closeSuiteOverlay, currentSource, installedSummary, openSuiteOverlay, orderProviders, overviewFoldsOpen, refreshSuiteOverlay, sourcesSummary, suiteOverlayTab, tokenRows, tokenTotal, tokensReport, tokensSummary } = overlay;

// SillyTavern's Extensions drawer, where every extension appends its panel.
const host = doc.createElement('div');
host.id = 'extensions_settings';
doc.body.appendChild(host);

// A fake extension: its panel (an inline-drawer, as all four draw it) between two neighbours,
// and an announcement with api.manage that records every call.
function extension(id, name, { areas = [], owns = areas, sources = {}, switchable = false, panel = true, manage = true, tokens, preview } = {}) {
    const ext = { id, name, calls: [], choices: { ...sources }, enabled: true, panel: null };
    if (panel) {
        ext.panel = doc.createElement('div');
        ext.panel.id = `${id.replace(/-/g, '_')}_settings`;
        const drawer = doc.createElement('div');
        drawer.className = 'inline-drawer';
        const header = doc.createElement('div');
        header.className = 'inline-drawer-toggle inline-drawer-header';
        const content = doc.createElement('div');
        content.className = 'inline-drawer-content';
        content.appendChild(doc.createElement('input'));
        drawer.append(header, content);
        ext.panel.appendChild(drawer);
        host.appendChild(ext.panel);
    }
    ext.announce = () => storySuite().announce({
        id, name, version: '1.2.0', owns, enabled: ext.enabled,
        ...(panel ? { settings: `#${ext.panel.id}` } : {}),
        api: manage ? {
            manage: {
                areas,
                sources: () => ({ ...ext.choices }),
                setSource(area, choice) {
                    ext.calls.push(['setSource', area, choice]);
                    ext.choices[area] = choice;
                },
                ...(tokens ? { tokens } : {}),
                ...(preview ? { preview } : {}),
                ...(switchable ? {
                    enabled: () => ext.enabled,
                    setEnabled(on) {
                        ext.calls.push(['setEnabled', on]);
                        ext.enabled = on;
                        ext.announce();
                    },
                } : {}),
            },
        } : {},
    });
    ext.announce();
    return ext;
}

// The four, announced out of order, plus a fifth that is not one of them.
function setup() {
    closeSuiteOverlay();
    delete globalThis.StorySuite;
    host.replaceChildren();
    const before = doc.createElement('div');
    before.id = 'before';
    host.appendChild(before);
    const exts = {
        battle: extension('rpg-battle', 'RPG Battle', { areas: ['stats', 'items', 'rolls'], switchable: true }),
        block: extension('story-block', 'Story Block', { areas: ['scene', 'timeline', 'items', 'stats', 'rolls'], owns: ['items'] }),
        other: extension('other-ext', 'Other', { areas: ['scene'] }),
        director: extension('story-director', 'Story Director', { areas: ['npc', 'calendar', 'timeline'], switchable: true }),
        delta: extension('npc-state-delta', 'NPC State Delta', { areas: ['scene', 'npc', 'calendar', 'stats'], panel: false }),
    };
    const after = doc.createElement('div');
    after.id = 'after';
    host.appendChild(after);
    return exts;
}

const root = () => doc.querySelector('#story_suite_overlay');
const tabs = () => root().querySelectorAll('.story-suite-tab');
const tab = id => tabs().find(node => node.dataset.tabId === id);
const pane = () => root().querySelector('.story-suite-pane');
const areaRow = area => pane().querySelector(`.story-suite-area[data-area="${area}"]`);
const select = area => areaRow(area).querySelector('select');
const optionTexts = area => select(area).children.map(option => option.textContent);
const pick = (area, value) => {
    select(area).value = value;
    select(area).dispatch('change');
};
const hostOrder = () => host.children.map(node => node.id || node.className);

test('pure: suite order, candidates (manage.areas, else owns), the table\'s value and what picking one sets', () => {
    const p = (id, extra = {}) => ({ id, owns: [], ...extra });
    assert.deepEqual(orderProviders([p('x'), p('rpg-battle'), p('story-block'), p('y'), p('npc-state-delta'), p('story-director')]).map(item => item.id),
        ['story-block', 'story-director', 'npc-state-delta', 'rpg-battle', 'x', 'y']);
    const list = [p('rpg-battle', { owns: ['stats'] }), p('story-block', { owns: [], api: { manage: { areas: ['stats'] } } }), p('x', { owns: ['stats'], api: { manage: { areas: [] } } })];
    assert.deepEqual(areaCandidates(list, 'stats').map(item => item.id), ['story-block', 'rpg-battle'], 'manage.areas wins over owns; owns without manage');

    const said = (...choices) => choices.map((choice, index) => p(`e${index}`, { api: { manage: { sources: () => (choice === undefined ? {} : { stats: choice }) } } }));
    assert.equal(currentSource(said('auto', undefined), 'stats'), 'auto', 'missing counts as Automatic');
    assert.equal(currentSource(said('theirs', 'mine'), 'stats'), 'e1');
    assert.equal(currentSource(said('mine', 'auto', 'theirs'), 'stats'), 'e0', 'the rest may be Automatic');
    assert.equal(currentSource(said('mine', 'mine'), 'stats'), 'mixed', 'two claim it');
    assert.equal(currentSource(said('theirs', 'auto'), 'stats'), 'mixed', 'nobody claims it');
    assert.equal(currentSource([p('a', { api: { manage: { sources() { throw new Error('boom'); } } } }), p('b')], 'stats'), 'auto', 'a failing sources() is Automatic');

    const calls = [];
    const settable = id => p(id, { api: { manage: { setSource: (area, choice) => calls.push([id, area, choice]) } } });
    const candidates = [settable('a'), settable('b'), p('c')];
    applySource(candidates, 'items', 'b');
    assert.deepEqual(calls, [['a', 'items', 'theirs'], ['b', 'items', 'mine']], 'one leads, the others defer; no setSource, no call');
    calls.length = 0;
    applySource(candidates, 'items', 'auto');
    assert.deepEqual(calls, [['a', 'items', 'auto'], ['b', 'items', 'auto']]);
});

test('opens a modal dialog with Overview first, then a tab per extension with a settings panel, in suite order', () => {
    setup();
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus();
    const node = openSuiteOverlay({ document: doc, suite: storySuite() });
    same(node, root());
    same(node.parentElement, doc.body);
    const dialog = node.querySelector('.story-suite-dialog');
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(node.querySelector('#story_suite_title').textContent, 'Story Suite');
    assert.ok(node.querySelector('.story-suite-close'));
    assert.ok(doc.body.classList.contains('story-suite-open'), 'the page knows it is open, for other extensions\' floating buttons');
    assert.deepEqual(texts(node, '.story-suite-tab'), ['Overview', 'Story Block', 'Story Director', 'RPG Battle', 'Other'], 'NPC State Delta has no panel here');
    assert.equal(suiteOverlayTab(), 'overview');
    assert.equal(tab('overview').getAttribute('aria-selected'), 'true');
    same(doc.activeElement, tab('overview'), 'focus moves in');
    assert.equal(openSuiteOverlay({ document: doc, suite: storySuite(), tab: 'rpg-battle' }), node, 'opening again selects a tab of the same overlay');
    assert.equal(suiteOverlayTab(), 'rpg-battle');
    closeSuiteOverlay();
    assert.equal(root(), null);
    assert.ok(!doc.body.classList.contains('story-suite-open'));
    same(doc.activeElement, opener, 'focus goes back to the opener');
    opener.remove();
    assert.equal(openSuiteOverlay({ document: { body: {} }, suite: storySuite() }), null, 'nowhere to show it');
});

test('Overview: a row per announced extension, on or off, with a switch only where setEnabled exists', () => {
    const exts = setup();
    openSuiteOverlay({ document: doc, suite: storySuite() });
    const rows = () => pane().querySelectorAll('.story-suite-provider');
    assert.deepEqual(rows().map(row => row.dataset.providerId), ['story-block', 'story-director', 'npc-state-delta', 'rpg-battle', 'other-ext']);
    assert.deepEqual(texts(pane(), '.story-suite-provider-name'), ['Story Block', 'Story Director', 'NPC State Delta', 'RPG Battle', 'Other']);
    assert.deepEqual(texts(pane(), '.story-suite-provider-version'), Array(5).fill('v1.2.0'));
    assert.deepEqual(texts(pane(), '.story-suite-provider-state'), Array(5).fill('on'));
    assert.deepEqual(rows().filter(row => row.querySelector('.story-suite-switch')).map(row => row.dataset.providerId), ['story-director', 'rpg-battle']);

    const toggle = rows().find(row => row.dataset.providerId === 'rpg-battle').querySelector('.story-suite-switch');
    assert.equal(toggle.getAttribute('role'), 'switch');
    toggle.focus();
    toggle.checked = false;
    toggle.dispatch('change');
    assert.deepEqual(exts.battle.calls, [['setEnabled', false]]);
    const battle = rows().find(row => row.dataset.providerId === 'rpg-battle');
    assert.equal(battle.querySelector('.story-suite-provider-state').textContent, 'off', 'redrawn, still listed');
    assert.equal(battle.querySelector('.story-suite-switch').checked, false);
    same(doc.activeElement, battle.querySelector('.story-suite-switch'), 'focus stays on the switch across the redraw');
    battle.querySelector('.story-suite-switch').checked = true;
    battle.querySelector('.story-suite-switch').dispatch('change');
    assert.deepEqual(exts.battle.calls, [['setEnabled', false], ['setEnabled', true]]);
    assert.equal(rows().find(row => row.dataset.providerId === 'rpg-battle').querySelector('.story-suite-provider-state').textContent, 'on');
    closeSuiteOverlay();
});

test('Source of truth: a row per area two or more can keep, Automatic, an owner or Mixed, and picking sets every one', () => {
    const exts = setup();
    exts.block.choices = { stats: 'theirs' };
    exts.battle.choices = { stats: 'mine' };
    exts.delta.choices = { stats: 'mine' };
    openSuiteOverlay({ document: doc, suite: storySuite() });
    assert.deepEqual(pane().querySelectorAll('.story-suite-area').map(row => row.dataset.area), ['scene', 'npc', 'calendar', 'timeline', 'stats', 'items', 'rolls'], 'AREAS order');
    assert.equal(areaRow('scene').querySelector('.story-suite-area-name').textContent, 'Scene (who is here now)');
    assert.equal(areaRow('timeline').querySelector('.story-suite-area-name').textContent, 'Timeline (agendas, quests, clocks)');
    assert.equal(areaRow('rolls').querySelector('.story-suite-area-name').textContent, 'Roll modifiers');
    assert.deepEqual(optionTexts('scene'), ['Automatic (NPC State Delta)', 'Story Block', 'NPC State Delta', 'Other'], 'Story Block offers no scene now: World State is off');
    assert.deepEqual(optionTexts('items'), ['Automatic (Story Block)', 'Story Block', 'RPG Battle']);
    assert.equal(select('items').value, 'auto');
    assert.equal(areaRow('items').querySelector('.story-suite-lead').textContent, 'Leads now: Story Block');

    assert.equal(select('stats').value, 'mixed', 'two say This extension');
    const mixed = select('stats').children.at(-1);
    assert.equal(mixed.textContent, 'Mixed — set in each extension');
    assert.equal(mixed.disabled, true);
    assert.equal(areaRow('stats').querySelector('.story-suite-lead').textContent, 'Leads now: NPC State Delta and RPG Battle (each keeps it)', 'the choices as each extension applies them');

    pick('stats', 'rpg-battle');
    assert.deepEqual(exts.block.calls, [['setSource', 'stats', 'theirs']]);
    assert.deepEqual(exts.delta.calls, [['setSource', 'stats', 'theirs']]);
    assert.deepEqual(exts.battle.calls, [['setSource', 'stats', 'mine']]);
    assert.equal(select('stats').value, 'rpg-battle', 'redrawn from fresh sources()');
    assert.ok(!optionTexts('stats').includes('Mixed — set in each extension'));
    assert.equal(areaRow('stats').querySelector('.story-suite-lead').textContent, 'Leads now: RPG Battle');

    pick('items', 'rpg-battle');
    assert.equal(areaRow('items').querySelector('.story-suite-lead').textContent, 'Leads now: RPG Battle', 'Story Block defers although it owns items by default');
    pick('items', 'auto');
    assert.deepEqual(exts.block.calls.slice(-1), [['setSource', 'items', 'auto']]);
    assert.deepEqual(exts.battle.calls.slice(-1), [['setSource', 'items', 'auto']]);
    assert.equal(select('items').value, 'auto');

    // Switched off, an extension is still a choice, marked so; Automatic names who leads instead.
    exts.director.enabled = false;
    exts.director.announce();
    refreshSuiteOverlay(); // index.js does this on every suite change
    assert.deepEqual(optionTexts('timeline'), ['Automatic', 'Story Block', 'Story Director (off)']);
    closeSuiteOverlay();

    // Fewer than two for every area: one line instead of a table.
    delete globalThis.StorySuite;
    extension('story-block', 'Story Block', { areas: ['items'], panel: false });
    extension('story-director', 'Story Director', { areas: ['calendar'], panel: false });
    openSuiteOverlay({ document: doc, suite: storySuite() });
    assert.equal(pane().querySelectorAll('.story-suite-area').length, 0);
    assert.equal(pane().querySelector('.is-sources .story-suite-empty').textContent, 'No area is kept by more than one of them right now.');
    closeSuiteOverlay();
});

test('an extension\'s tab moves its panel in, drawer open, and puts it back exactly where it was', () => {
    const exts = setup();
    const order = hostOrder();
    openSuiteOverlay({ document: doc, suite: storySuite(), tab: 'story-director' });
    same(pane().children[0], exts.director.panel, 'the panel itself, listeners and all');
    const placeholder = host.querySelector('[data-story-suite-placeholder]');
    assert.equal(placeholder.dataset.storySuitePlaceholder, 'story-director');
    assert.equal(placeholder.style.display, 'none');
    same(placeholder.nextElementSibling, host.querySelector('#after'), 'the placeholder holds its place');
    assert.ok(exts.director.panel.querySelector('.inline-drawer').classList.contains('story-suite-drawer'), 'shown open, without its toggle');

    tab('rpg-battle').click();
    assert.equal(suiteOverlayTab(), 'rpg-battle');
    same(pane().children[0], exts.battle.panel);
    assert.equal(host.querySelectorAll('[data-story-suite-placeholder]').length, 1, 'one placeholder at a time');
    same(host.querySelector('[data-story-suite-placeholder]').nextElementSibling, host.querySelector('#story_block_settings'));
    assert.ok(!exts.director.panel.querySelector('.inline-drawer').classList.contains('story-suite-drawer'));
    assert.ok(host.contains(exts.director.panel), 'Story Director\'s panel is back');

    tab('overview').click();
    assert.deepEqual(hostOrder(), order, 'switching away puts it back');
    tab('story-block').click();
    closeSuiteOverlay();
    assert.deepEqual(hostOrder(), order, 'so does closing');
    assert.equal(doc.querySelectorAll('[data-story-suite-placeholder]').length, 0);
    assert.equal(doc.querySelectorAll('[data-story-suite-moved]').length, 0);
});

test('a missing panel says so; a panel removed or an extension leaving meanwhile is handled', () => {
    const exts = setup();
    const order = hostOrder();
    exts.other.panel.remove();
    openSuiteOverlay({ document: doc, suite: storySuite(), tab: 'other-ext' });
    assert.equal(pane().textContent, 'Its settings are not on this page.');

    // Its extension rebuilt the panel elsewhere while it was in the overlay.
    tab('story-director').click();
    exts.director.panel.remove();
    tab('overview').click();
    assert.equal(host.querySelectorAll('[data-story-suite-placeholder]').length, 0, 'nothing put back, placeholder gone');
    host.insertBefore(exts.director.panel, host.querySelector('#after'));

    // The extension whose tab is open leaves: its panel goes back and Overview is shown.
    tab('rpg-battle').click();
    storySuite().withdraw('rpg-battle');
    refreshSuiteOverlay();
    assert.equal(suiteOverlayTab(), 'overview');
    assert.ok(!tab('rpg-battle'));
    assert.deepEqual(hostOrder(), order.filter(id => id !== 'other_ext_settings'));

    // Something removed the whole overlay: the next refresh tears it down and puts panels back.
    tab('story-block').click();
    root().remove();
    assert.equal(refreshSuiteOverlay(), false);
    assert.equal(suiteOverlayTab(), null);
    assert.ok(host.contains(exts.block.panel));
    assert.equal(host.querySelectorAll('[data-story-suite-placeholder]').length, 0);
});

test('Esc, the close button and the backdrop close it; arrows move between tabs; Tab stays inside', () => {
    const exts = setup();
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    openSuiteOverlay({ document: doc, suite: storySuite(), tab: 'story-block', opener });
    same(doc.activeElement, tab('story-block'));
    const right = tab('story-block').dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(right.defaultPrevented);
    assert.equal(suiteOverlayTab(), 'story-director');
    same(doc.activeElement, tab('story-director'));
    tab('story-director').dispatch('keydown', { key: 'Home' });
    assert.equal(suiteOverlayTab(), 'overview');

    const close = root().querySelector('.story-suite-close');
    close.focus();
    const wrap = close.dispatch('keydown', { key: 'Tab', shiftKey: true });
    assert.ok(wrap.defaultPrevented, 'Shift+Tab on the first control wraps to the last');
    assert.ok(root().contains(doc.activeElement));

    tab('story-director').click();
    const input = exts.director.panel.querySelector('input');
    input.focus();
    const esc = input.dispatch('keydown', { key: 'Escape' });
    assert.ok(esc.defaultPrevented && esc.stopped, 'Esc is the overlay\'s, not SillyTavern\'s underneath');
    assert.equal(root(), null);
    assert.ok(host.contains(exts.director.panel));
    same(doc.activeElement, opener);

    openSuiteOverlay({ document: doc, suite: storySuite(), opener });
    root().querySelector('.story-suite-close').click();
    assert.equal(root(), null);
    openSuiteOverlay({ document: doc, suite: storySuite(), opener });
    root().querySelector('.story-suite-dialog').click();
    assert.ok(root(), 'a click inside the dialog does not close it');
    root().click();
    assert.equal(root(), null, 'the backdrop does');
    opener.remove();
});

test('an overlay a previous copy left behind gives its panel back', async () => {
    const exts = setup();
    const order = hostOrder();
    openSuiteOverlay({ document: doc, suite: storySuite(), tab: 'rpg-battle' });
    // A copy of the extension reloaded without a page refresh starts with no overlay state:
    // closing (as init() does) finds the stale overlay in the page and puts its panel back.
    const fresh = await import('../src/ui/suite-overlay.js?reloaded');
    assert.equal(fresh.closeSuiteOverlay({ document: doc }), false, 'nothing of its own was open');
    assert.equal(root(), null);
    assert.deepEqual(hostOrder(), order);
    assert.equal(host.querySelectorAll('[data-story-suite-placeholder]').length, 0);
    assert.equal(exts.battle.panel.dataset.storySuiteMoved, undefined);
    closeSuiteOverlay();
    assert.deepEqual(hostOrder(), order, 'the old copy closing later changes nothing');
});

// ---- v0.9.1: Tokens per reply, and the Overview's folds ----

// A localStorage stand-in (the folds remember which are open in this browser).
const stored = new Map();
globalThis.localStorage = {
    getItem: key => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: key => stored.delete(key),
};
const fold = key => pane().querySelector(`.story-suite-folds > details.story-suite-fold[data-fold="${key}"]`);
const foldHint = key => fold(key).querySelector('summary .story-suite-fold-hint').textContent;
const toggleFold = (node, open) => {
    node.open = open;
    node.dispatch('toggle');
};

test('pure: a tokens report is whole counts or null; rows are the enabled providers; the summaries', () => {
    const p = (id, manage, extra = {}) => ({ id, owns: [], api: manage ? { manage } : undefined, ...extra });
    assert.deepEqual(tokensReport(p('a', { tokens: () => ({ input: 812.4, output: -3, parts: [{ label: ' Inventory ', input: '200', output: 40 }, null, { input: 5 }] }) })),
        { input: 812, output: 0, parts: [{ label: 'Inventory', input: 200, output: 40 }, { label: 'Other', input: 5, output: 0 }] });
    assert.equal(tokensReport(p('b', {})), null, 'no tokens()');
    assert.equal(tokensReport(p('c', { tokens() { throw new Error('boom'); } })), null, 'a throwing tokens()');
    assert.equal(tokensReport(p('d', { tokens: async () => ({ input: 1 }) })), null, 'a promise');
    assert.equal(tokensReport(p('e', { tokens: () => 7 })), null);
    assert.equal(tokensReport(p('f', null)), null, 'no manage');
    const rows = tokenRows([p('x', { tokens: () => ({ input: 100, output: 10 }) }), p('story-block', { tokens: () => ({ input: 3000, output: 640 }) }), p('off', { tokens: () => ({ input: 9, output: 9 }) }, { enabled: false }), p('rpg-battle', {})]);
    assert.deepEqual(rows.map(row => [row.provider.id, Boolean(row.report)]), [['story-block', true], ['rpg-battle', false], ['x', true]], 'suite order; a switched-off one adds nothing');
    assert.deepEqual(tokenTotal(rows), { input: 3100, output: 650, reported: 2 });
    assert.equal(tokensSummary(tokenTotal(rows)), '~3,100 in · ~650 out');
    assert.equal(tokensSummary(tokenTotal([])), 'Not reported');

    assert.equal(installedSummary([p('a'), p('b'), p('c'), p('d')]), '4 on');
    assert.equal(installedSummary([p('a'), p('b'), p('c'), p('d', null, { enabled: false })]), '3 on, 1 off');
    assert.equal(sourcesSummary(['auto', 'auto']), 'Automatic');
    assert.equal(sourcesSummary(['auto', 'rpg-battle', 'story-block']), '2 chosen by hand');
    assert.equal(sourcesSummary(['mixed', 'auto']), '1 mixed');
    assert.equal(sourcesSummary(['mixed', 'story-block']), '1 chosen by hand, 1 mixed');
    assert.equal(sourcesSummary([]), 'Nothing shared');
});

test('Tokens per reply: a row per enabled extension, its parts in a fold, a total; missing or failing tokens() is not reported', () => {
    stored.clear();
    delete globalThis.StorySuite;
    host.replaceChildren();
    const exts = {
        block: extension('story-block', 'Story Block', { areas: ['items'], tokens: () => ({ input: 2400, output: 520, parts: [{ label: 'Inventory', input: 900, output: 300 }, { label: 'Party (kept by RPG Battle)', input: 700, output: 0 }, { label: 'Rules and envelope', input: 800, output: 220 }] }) }),
        director: extension('story-director', 'Story Director', { tokens: () => ({ input: 1000, output: 130 }) }),
        delta: extension('npc-state-delta', 'NPC State Delta', { tokens() { throw new Error('boom'); } }),
        battle: extension('rpg-battle', 'RPG Battle', { areas: ['items'], switchable: true }),
    };
    openSuiteOverlay({ document: doc, suite: storySuite() });
    assert.equal(pane().querySelectorAll('.story-suite-folds > details').map(node => node.dataset.fold).join(), 'installed,sources,tokens,sent');
    assert.equal(foldHint('tokens'), '~3,400 in · ~650 out');
    const rows = () => fold('tokens').children[1].children.filter(node => node.classList.contains('story-suite-tokens-row'));
    const row = id => rows().find(node => node.dataset.providerId === id);
    const count = node => node.querySelector('.story-suite-tokens-count, summary .story-suite-fold-hint').textContent;
    assert.deepEqual(rows().map(node => node.dataset.providerId ?? 'total'), ['story-block', 'story-director', 'npc-state-delta', 'rpg-battle', 'total']);
    assert.equal(count(row('story-director')), '~1,000 in · ~130 out');
    assert.equal(count(row('npc-state-delta')), 'not reported', 'a throwing tokens()');
    assert.equal(count(row('rpg-battle')), 'not reported', 'no tokens()');
    const total = rows().at(-1);
    assert.equal(total.querySelector('.story-suite-tokens-name').textContent, 'Total');
    assert.equal(count(total), '~3,400 in · ~650 out');
    assert.match(fold('tokens').querySelector('.story-suite-muted').textContent, /about 4 characters a token.*not counted/);

    // Story Block's parts: a nested fold, closed until opened, and open across a redraw.
    const parts = row('story-block');
    assert.equal(parts.tagName, 'DETAILS');
    assert.equal(parts.open, false);
    assert.equal(count(parts), '~2,400 in · ~520 out');
    assert.deepEqual(parts.querySelectorAll('.story-suite-tokens-part').map(node => [node.querySelector('.story-suite-tokens-name').textContent, node.querySelector('.story-suite-tokens-count').textContent]),
        [['Inventory', '~900 in · ~300 out'], ['Party (kept by RPG Battle)', '~700 in · ~0 out'], ['Rules and envelope', '~800 in · ~220 out']]);
    toggleFold(parts, true);
    refreshSuiteOverlay();
    assert.equal(row('story-block').open, true, 'kept open across the redraw');
    assert.notEqual(row('story-block'), parts, 'a fresh node');

    // Switched off: no longer counted.
    exts.director.enabled = false;
    exts.director.announce();
    refreshSuiteOverlay();
    assert.equal(row('story-director'), undefined);
    assert.equal(foldHint('tokens'), '~2,400 in · ~520 out');
    closeSuiteOverlay();
});

test('Overview folds: one-line summaries, Installed open and the others closed by default, open ones remembered', () => {
    stored.clear();
    const exts = setup();
    exts.block.choices = { stats: 'theirs' };
    exts.battle.choices = { stats: 'mine' };
    openSuiteOverlay({ document: doc, suite: storySuite() });
    assert.equal(pane().classList.contains('story-suite-panel'), true, 'the panels\' look');
    assert.deepEqual(['installed', 'sources', 'tokens'].map(key => fold(key).open), [true, false, false]);
    assert.deepEqual(['installed', 'sources', 'tokens'].map(key => fold(key).querySelector('summary .story-suite-fold-title').textContent), ['Installed', 'Source of truth', 'Tokens per reply']);
    assert.equal(foldHint('installed'), '5 on');
    assert.equal(foldHint('sources'), '1 chosen by hand');
    assert.equal(foldHint('tokens'), 'Not reported');
    assert.ok(fold('installed').querySelectorAll('.story-suite-row.story-suite-provider').length === 5, 'Installed rows are panel rows');
    assert.equal(fold('installed').querySelector('.story-suite-provider[data-provider-id="rpg-battle"]').tagName, 'LABEL', 'with its switch inside');

    toggleFold(fold('sources'), true);
    toggleFold(fold('installed'), false);
    assert.deepEqual(JSON.parse(stored.get('story_suite_overview_folds')), { installed: false, sources: true, tokens: false, sent: false });
    exts.battle.enabled = false;
    exts.battle.announce();
    refreshSuiteOverlay();
    assert.deepEqual(['installed', 'sources', 'tokens'].map(key => fold(key).open), [false, true, false], 'kept across a redraw');
    assert.equal(foldHint('installed'), '4 on, 1 off');
    exts.delta.choices = { stats: 'mine' };
    refreshSuiteOverlay();
    assert.equal(foldHint('sources'), '1 mixed', 'two claim stats');
    closeSuiteOverlay();
    openSuiteOverlay({ document: doc, suite: storySuite() });
    assert.deepEqual(['installed', 'sources', 'tokens'].map(key => fold(key).open), [false, true, false], 'and when it opens again');
    closeSuiteOverlay();

    // Nothing stored, or storage that throws: the defaults.
    stored.set('story_suite_overview_folds', 'not json');
    assert.deepEqual(overviewFoldsOpen(), { installed: true, sources: false, tokens: false, sent: false });
    const saved = globalThis.localStorage;
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    try {
        assert.deepEqual(overviewFoldsOpen(), { installed: true, sources: false, tokens: false, sent: false });
        openSuiteOverlay({ document: doc, suite: storySuite() });
        toggleFold(fold('tokens'), true);
        assert.equal(fold('tokens').open, true, 'still opens');
        closeSuiteOverlay();
    } finally {
        globalThis.localStorage = saved;
    }
});

test("What's sent: a fold per extension that offers preview(), read only when opened (0.9.18)", () => {
    stored.clear();
    delete globalThis.StorySuite;
    host.replaceChildren();
    let reads = 0;
    extension('story-block', 'Story Block', { areas: ['items'], preview: () => { reads += 1; return [{ label: 'Story Blocks', text: 'STORY_BLOCKS_V1_CONTEXT_BEGIN\n## Story Blocks' }]; } });
    extension('story-director', 'Story Director', { preview: () => 'Director note: the bell rings at dusk.' });
    extension('npc-state-delta', 'NPC State Delta', { preview() { throw new Error('boom'); } });
    extension('rpg-battle', 'RPG Battle', { areas: ['items'], preview: () => ({ injection: 'Live dossier: Elke.', liveCapture: '' }) });
    openSuiteOverlay({ document: doc, suite: storySuite() });
    assert.equal(foldHint('sent'), '4 to read');
    const folds = fold('sent').querySelectorAll('details.story-suite-fold');
    assert.deepEqual(folds.map(node => node.dataset.providerId), ['story-block', 'story-director', 'npc-state-delta', 'rpg-battle']);
    assert.equal(reads, 0, 'nothing is read before a fold opens');
    folds[0].open = true;
    folds[0].dispatch('toggle');
    assert.equal(reads, 1);
    assert.equal(folds[0].querySelector('.story-block-preview-text').textContent, 'STORY_BLOCKS_V1_CONTEXT_BEGIN\n## Story Blocks');
    assert.match(folds[0].querySelector('.story-block-preview-size').textContent, /^~\d+ tokens$/);
    assert.ok(folds[0].querySelector('.story-block-preview-copy'));
    folds[1].open = true;
    folds[1].dispatch('toggle');
    assert.equal(folds[1].querySelector('.story-block-preview-label').textContent, 'Story Director', 'a plain string is one part, named for the extension');
    folds[2].open = true;
    folds[2].dispatch('toggle');
    assert.ok(folds[2].querySelector('.story-block-preview-empty'), 'a failing preview shows nothing, without breaking the rest');
    folds[3].open = true;
    folds[3].dispatch('toggle');
    assert.deepEqual(folds[3].querySelectorAll('.story-block-preview-label').map(node => node.textContent), ['Injection'], 'named texts are parts; an empty one says nothing');
    assert.equal(overlay.previewReport({ api: { manage: { preview: () => ({ label: 'Note', text: 'x', tokens: 1 }) } } })[0].label, 'Note');
    assert.deepEqual(overlay.previewReport({ api: { manage: { preview: () => ({ parts: [{ label: 'A', text: 'a' }] }) } } }), [{ label: 'A', text: 'a' }]);
    closeSuiteOverlay();
});
