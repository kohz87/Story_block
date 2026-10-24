// The "Show all" / "Show less" toggle of a long card (UI stage 5b, screens/show-more.js): the list is capped and has no
// scrollbar, the button is there only while the list is taller than the cap, it says whether it is open (aria-expanded), and
// Home's cards take one height per row with the quests list capped. Home has no Packs card any more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { capToggle, createShowMoreWidget, CAP_CLASS } from '../../../src/v2/screens/show-more.js';
import { homeScreen } from '../../../src/v2/screens/home.js';
import { STRINGS } from '../../../src/v2/strings.js';

test('the toggle: hidden while the list fits, shown when it is taller than the cap, open and shut with aria-expanded', () => {
    const doc = installFakeDom();
    const list = doc.createElement('ul');
    const toggle = capToggle(doc, list);
    assert.equal(list.classList.contains(CAP_CLASS), true, 'the list is the capped part');
    assert.equal(list.getAttribute('data-capped'), 'true', 'folded at first');
    assert.equal(toggle.button.hidden, true, 'no overflow, no button');
    assert.equal(toggle.button.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.button.className.includes('ss-button'), true, 'an ss-button');
    list.scrollHeight = 400; list.clientHeight = 200;
    toggle.refresh();
    assert.equal(toggle.button.hidden, false, 'taller than the cap: the button shows');
    assert.equal(toggle.button.textContent, STRINGS.showMore.more);
    toggle.button.click();
    assert.equal(list.getAttribute('data-capped'), 'false');
    assert.equal(toggle.button.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.button.textContent, STRINGS.showMore.less);
    assert.equal(toggle.button.hidden, false, 'open: the button stays to fold it again');
    toggle.button.click();
    assert.equal(list.getAttribute('data-capped'), 'true');
    assert.equal(toggle.button.getAttribute('aria-expanded'), 'false');
});

test('the toggle is a real button: type button, reachable by keyboard (no tabindex -1)', () => {
    const doc = installFakeDom();
    const toggle = capToggle(doc, doc.createElement('ul'));
    assert.equal(toggle.button.type, 'button');
    assert.notEqual(toggle.button.getAttribute('tabindex'), '-1');
});

test('the widget finds the capped list in its own card and draws the toggle there', () => {
    const doc = installFakeDom();
    const card = doc.createElement('section');
    const list = doc.createElement('div');
    list.classList.add('sb-cap');
    card.appendChild(list);
    const host = doc.createElement('ss-widget');
    card.appendChild(host);
    const handle = createShowMoreWidget().render(host, { target: '.sb-cap', more: 'More', less: 'Less' }, {});
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0].textContent, 'More', 'the labels from the props');
    handle.destroy();
    assert.equal(host.children.length, 0, 'destroy leaves nothing behind');
});

test('the widget with no card or no list draws nothing', () => {
    const doc = installFakeDom();
    const host = doc.createElement('ss-widget');
    const handle = createShowMoreWidget().render(host, { target: '.sb-cap' }, {});
    assert.equal(host.children.length, 0);
    handle.update();
    handle.destroy();
});

test('Home: one height per row (stretch), the capped list does not scroll, and no Packs card', () => {
    const css = homeScreen.css;
    assert.match(css, /\.home \{[^}]*align-items: stretch;/);
    assert.doesNotMatch(css, /\.home \{[^}]*align-items: start;/);
    assert.match(css, /\.sb-cap\[data-capped="true"\] \{[^}]*max-height: 15em;[^}]*overflow: hidden;/);
    assert.doesNotMatch(css, /\.sb-cap[^}]*overflow(-y)?: auto/);
    assert.match(homeScreen.template, /class="sb-cap" data-capped="true"/);
    assert.match(homeScreen.template, /name="story-block\.show-more"/);
    assert.doesNotMatch(homeScreen.template, /packs/i, 'the Packs card is gone from Home');
    assert.doesNotMatch(css, /packs/i);
});

test('the open state is kept per card: a new toggle for the same card starts open, another card starts folded', () => {
    const doc = installFakeDom();
    const first = capToggle(doc, doc.createElement('ul'), { key: 'story-block/home:quests-test' });
    first.button.click();
    assert.equal(first.button.getAttribute('aria-expanded'), 'true');
    // a redraw builds the toggle again (new nodes): the card stays open
    const again = capToggle(doc, doc.createElement('ul'), { key: 'story-block/home:quests-test' });
    assert.equal(again.button.getAttribute('aria-expanded'), 'true', 'a redraw does not fold it back');
    assert.equal(again.button.textContent, STRINGS.showMore.less);
    again.button.click();
    const other = capToggle(doc, doc.createElement('ul'), { key: 'story-block/home:saves-test' });
    assert.equal(other.button.getAttribute('aria-expanded'), 'false', 'another card is its own');
    const shut = capToggle(doc, doc.createElement('ul'), { key: 'story-block/home:quests-test' });
    assert.equal(shut.button.getAttribute('aria-expanded'), 'false', 'shut again stays shut');
});

test('Home passes its card key, so the quests toggle keeps its state', () => {
    assert.match(homeScreen.template, /"key":"story-block\/home:quests"/);
});

test('a resize of the card re-checks the toggle (ResizeObserver, guarded); destroy disconnects it; no observer, no error', () => {
    const doc = installFakeDom();
    const saved = globalThis.ResizeObserver;
    const made = [];
    globalThis.ResizeObserver = class {
        constructor(fn) { this.fn = fn; this.targets = []; this.disconnected = false; made.push(this); }
        observe(el) { this.targets.push(el); }
        disconnect() { this.disconnected = true; }
    };
    try {
        const list = doc.createElement('ul');
        const toggle = capToggle(doc, list, { key: 'story-block/home:resize-test' });
        assert.equal(made.length, 1, 'one observer for the list');
        assert.equal(made[0].targets[0], list, 'it watches the capped list');
        list.scrollHeight = 500; list.clientHeight = 200;
        made[0].fn();
        assert.equal(toggle.button.hidden, false, 'taller after the resize: the button shows');
        toggle.destroy();
        assert.equal(made[0].disconnected, true, 'destroy disconnects');
    } finally {
        globalThis.ResizeObserver = saved;
    }
    delete globalThis.ResizeObserver;
    const plain = capToggle(doc, doc.createElement('ul'), { key: 'story-block/home:no-observer-test' });
    assert.equal(plain.button.hidden, true);
    plain.destroy();
});
