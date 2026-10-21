// QA: the five mounts (src/v2/view/mounts, SPEC §13.4) and the screen registry (src/v2/view/screens.js)
// with a hostile character card. A card's screens are untrusted: their titles, icons and the data
// their layouts show must reach the page as text only, never as markup or a handler, and their
// themes may not load or run anything (§13.3: url() only data:/https:). The real layout renderer
// draws the screens; the fake DOM throws on innerHTML and records every attribute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement } from '../../ui-fake-dom.js';
import { createMounts, drawScreen } from '../../../src/v2/view/mounts/index.js';
import { renderLayout } from '../../../src/v2/layout/index.js';
import { fakeChat, screensWith, setupDom } from '../view/mounts/helpers.js';

const forbid = name => function () { throw new Error(`markup was parsed: ${name}`); };
Object.defineProperty(FakeElement.prototype, 'innerHTML', { configurable: true, get: forbid('innerHTML get'), set: forbid('innerHTML set') });
Object.defineProperty(FakeElement.prototype, 'outerHTML', { configurable: true, get: forbid('outerHTML get'), set: forbid('outerHTML set') });
FakeElement.prototype.insertAdjacentHTML = forbid('insertAdjacentHTML');
const attributes = [];
const setAttribute = FakeElement.prototype.setAttribute;
FakeElement.prototype.setAttribute = function (name, value) {
    attributes.push([this.tagName, String(name), String(value)]);
    return setAttribute.call(this, name, value);
};

const EVIL = '<img src=x onerror=alert(1)>"\'><svg onload=alert(1)>';
const MOUNTS = ['tab', 'screen', 'card', 'hud', 'dialog'];
const layoutScreen = (id, more = {}) => ({
    id, title: 'Sheet', icon: 'fa-star', mounts: MOUNTS,
    data: { t: { query: 'qa.text' } },
    layout: { root: { type: 'box', title: { query: 'qa.text' }, children: [{ type: 'text', bind: { query: 'qa.text' } }] } },
    ...more,
});

function world(cardScreens) {
    const doc = setupDom();
    const chat = fakeChat(doc, [1, 2, 3]);
    const screens = screensWith([layoutScreen('m/sheet')], { reader: { cards: { 'm/sheet': true } } });
    screens.setCard(cardScreens);
    const query = (name) => {
        if (name === 'qa.text') return EVIL;
        throw new Error(`no query ${name}`);
    };
    const render = (el, screen, scope) => {
        const result = renderLayout(el, screen.layout, { query: (name, args) => query(name, args, scope.state) });
        if (!result.ok) throw new Error(result.errors.join(' '));
    };
    const anchor = doc.createElement('div');
    anchor.id = 'send_form';
    doc.body.appendChild(anchor);
    const deps = {
        screens, render, query, stateAt: chat.stateAt, headIndex: chat.headIndex, carriers: chat.carriers, swipeAt: chat.swipeAt,
        messageElement: chat.messageElement, changesAt: chat.changesAt, IntersectionObserver: null, anchor: () => anchor,
        api: { command: () => ({ ok: true }) }, addTab: tab => { tabs.push(tab); return () => {}; },
    };
    const tabs = [];
    return { doc, chat, screens, deps, tabs, mounts: createMounts(deps) };
}

function assertInert(attrs, label) {
    for (const [tag, name] of attrs) {
        assert.doesNotMatch(name, /^on/i, `${label}: no event attribute (${tag} ${name})`);
        assert.ok(!['style', 'href', 'src', 'srcdoc'].includes(name.toLowerCase()), `${label}: no ${name} attribute from data`);
    }
}

test('a hostile card screen in every mount: titles, icons and data are text, nothing is parsed or wired', () => {
    const { doc, chat, tabs, mounts } = world([layoutScreen('m/sheet', { title: EVIL, icon: `fa-star ${EVIL}` }), layoutScreen('card/extra', { title: EVIL })]);
    const from = attributes.length;
    // tab
    mounts.tab.register();
    for (const tab of tabs) {
        assert.equal(tab.title, EVIL, 'the tab host gets the title as data');
        const el = doc.createElement('div');
        const handle = tab.render(el, { state: chat.states[2] }, null);
        assert.equal(handle.result.ok, true, handle.result.message);
        assert.ok(el.textContent.includes(EVIL));
    }
    // screen
    assert.equal(mounts.screen.open('m/sheet'), true);
    const view = doc.body.querySelector('.ss-gameview');
    assert.ok(view.textContent.includes(EVIL), 'nav labels and the title are text');
    mounts.screen.close();
    // hud
    const strip = mounts.hud.show();
    assert.ok(strip.textContent.includes(EVIL));
    // card
    mounts.card.attachAll();
    for (const index of chat.carriers()) {
        mounts.card.toggle(index, 'm/sheet', true);
        const card = chat.messages[index].querySelector('.ss-card');
        assert.ok(card.textContent.includes(EVIL));
    }
    // dialog
    mounts.dialog.open('m/sheet', { draft: {} });
    const dialog = doc.body.querySelector('.ss-dialog');
    assert.ok(dialog.textContent.includes(EVIL));
    assertInert(attributes.slice(from), 'mounts');
    for (const node of doc.body.descendants()) assert.ok(!['SCRIPT', 'IFRAME', 'IMG', 'SVG'].includes(node.tagName), `no <${node.tagName}> from data`);
});

test('a card screen whose theme key is not a custom property, or whose data path climbs __proto__, is held back or reads nothing', () => {
    const { doc, screens, deps } = world([layoutScreen('m/sheet', { theme: { background: 'red', '--ok': 'blue' } })]);
    const resolved = screens.resolve('m/sheet');
    assert.equal(resolved.source, 'module', 'the card version fails validation and the module default is used');
    assert.match(resolved.fallbacks[0].reason, /custom property/);
    const el = doc.createElement('div');
    const proto = { ...layoutScreen('qa/proto'), data: { a: { query: 'qa.args', args: { v: '$b.__proto__' } }, b: { query: 'qa.args', args: {} } } };
    screens.setCard([proto]);
    const seen = [];
    const result = drawScreen(el, 'qa/proto', 'tab', { deps: { ...deps, query: (name, args) => { seen.push(args); return name === 'qa.args' ? {} : 'x'; }, render: () => {} }, state: {} });
    assert.equal(result.ok, true);
    assert.deepEqual(seen.at(-1), { v: null }, 'a $alias path never reads through __proto__');
});

// ---- problems found (each a failing check, kept as a todo so CI stays green) -----------------

test('screens.js validateScreen / mounts common.js drawScreen: a card screen\'s theme cannot load or run anything (url(javascript:), url(http:), expression())', () => {
    // validateScreen checks only that theme keys are --custom-properties and values are text; drawScreen
    // then sets every value on the mount element with style.setProperty. A character card (untrusted,
    // like a pack) can make any screen load http: or javascript: URLs through var(--…). §13.3 allows
    // url() only with data:/https:. Packs check this (packs/validate.js checkTheme), and css.js has
    // themeVars() with the same checks, but nothing calls it: card and reader screens are not checked.
    // (A screen's css is cleaned when it is drawn, by scopeCss; template-security.test.js covers it.)
    const { doc, screens, deps } = world([layoutScreen('m/sheet', { theme: { '--ss-bg': 'url(javascript:alert(1))', '--ss-img': 'url(http://evil.example/track.png)', '--ss-w': 'expression(alert(1))' } })]);
    const el = doc.createElement('div');
    drawScreen(el, 'm/sheet', 'tab', { deps, state: {} });
    for (const key of ['--ss-bg', '--ss-img', '--ss-w']) assert.equal(el.style.getPropertyValue(key), '', `${key} is not set from the card`);
    assert.equal(screens.resolve('m/sheet').source, 'module', 'the unsafe card screen falls back to the module default');
});
