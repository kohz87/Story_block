// "This turn" strip: items, overflow, warn style, quiet chip, click and replacement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, makeMessage, same, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const { mountStrip, unmountStrip } = await import('../src/ui/strip.js');

const items = [
    { tabId: 'block:inventory', block: 'Inventory', text: 'Gold 100 → 85', tone: 'down' },
    { tabId: 'block:sheet', block: 'Sheet', text: 'HP 80 → 72', tone: 'down' },
    { tabId: 'block:inventory', block: 'Inventory', text: '+ Bandage roll', tone: 'up' },
    { tabId: 'block:notes', block: 'Notes', text: 'Guards on alert', tone: 'neutral' },
    { tabId: 'block:world', block: 'World', text: 'Dusk', tone: 'neutral' },
];

test('a strip is a button at the end of .mes_block with up to three items and "+N more"', () => {
    const message = makeMessage(doc);
    const strip = mountStrip(message, items, { onOpen() {} });
    same(message.querySelector('.mes_block').children.at(-1), strip);
    assert.equal(strip.tagName, 'BUTTON');
    assert.equal(strip.type, 'button');
    assert.ok(strip.classList.contains('story-block-strip'));
    assert.equal(strip.querySelector('.story-block-strip-title').textContent, 'This turn');
    assert.deepEqual(texts(strip, '.story-block-strip-item'), ['Gold 100 → 85', 'HP 80 → 72', '+ Bandage roll']);
    assert.equal(strip.querySelectorAll('.story-block-strip-sep').length, 2);
    assert.ok(strip.querySelectorAll('.story-block-strip-sep').every(dot => dot.textContent === '·' && dot.getAttribute('aria-hidden') === 'true'));
    assert.equal(strip.querySelector('.story-block-strip-more').textContent, '+2 more');
    const tones = strip.querySelectorAll('.story-block-strip-item').map(node => node.className.split(' ').find(name => /^story-block-strip-(up|down|neutral|warn)$/.test(name)));
    assert.deepEqual(tones, ['story-block-strip-down', 'story-block-strip-down', 'story-block-strip-up']);
    assert.match(strip.title, /Notes: Guards on alert/, 'the tooltip lists every change');
    assert.match(strip.getAttribute('aria-label'), /^This turn: Inventory: Gold 100 → 85; .*World: Dusk\. Open Story Block\.$/);
    message.remove();
});

test('three or fewer items show no "+N more"; unknown tones are neutral', () => {
    const message = makeMessage(doc);
    const strip = mountStrip(message, [{ tabId: 't', block: 'B', text: 'One', tone: 'sideways' }]);
    assert.deepEqual(texts(strip, '.story-block-strip-item'), ['One']);
    assert.equal(strip.querySelector('.story-block-strip-more'), null);
    assert.ok(strip.querySelector('.story-block-strip-item').classList.contains('story-block-strip-neutral'));
    message.remove();
});

test('clicking opens the first item\'s tab and does not reach the message', () => {
    const message = makeMessage(doc);
    const opened = [];
    let reachedMessage = false;
    message.addEventListener('click', () => { reachedMessage = true; });
    const strip = mountStrip(message, items, { onOpen: tabId => opened.push(tabId) });
    strip.click();
    assert.deepEqual(opened, ['block:inventory']);
    assert.equal(reachedMessage, false);
    assert.equal(strip.dataset.tabId, 'block:inventory');
    message.remove();
});

test('a warn item reads "· tap to fix" in the error style', () => {
    const message = makeMessage(doc);
    const mixed = mountStrip(message, [items[0], { tabId: 'block:sheet', block: 'Sheet', text: "Sheet couldn't be read", tone: 'warn' }]);
    assert.ok(mixed.classList.contains('story-block-strip-has-warn'));
    const warn = mixed.querySelector('.story-block-strip-warn');
    assert.equal(warn.textContent, "Sheet couldn't be read · tap to fix");
    assert.ok(mixed.querySelector('.story-block-strip-title'), 'mixed strips keep the label');

    const onlyWarn = mountStrip(message, [{ tabId: 'block:inventory', block: 'Inventory', text: "Inventory couldn't be read", tone: 'warn' }]);
    assert.equal(onlyWarn.querySelector('.story-block-strip-title'), null, 'an error-only strip is the error itself');
    assert.ok(onlyWarn.querySelector('.story-block-strip-icon'));
    assert.equal(onlyWarn.querySelector('.story-block-strip-body').textContent, "Inventory couldn't be read · tap to fix");
    message.remove();
});

test('empty items: nothing by default, the quiet chip when asked', () => {
    const message = makeMessage(doc);
    assert.equal(mountStrip(message, []), null);
    assert.equal(doc.querySelectorAll('.story-block-strip').length, 0);
    assert.equal(mountStrip(message, [{ tabId: 'x', text: '   ' }]), null, 'blank items do not count');

    const quiet = mountStrip(message, [], { showQuiet: true, onOpen() { throw new Error('not clickable'); } });
    assert.ok(quiet.classList.contains('story-block-strip-quiet'));
    assert.equal(quiet.textContent, 'Nothing changed this turn');
    assert.notEqual(quiet.tagName, 'BUTTON');
    quiet.click();
    message.remove();
});

test('mounting replaces any previous strip anywhere; unmount removes them all', () => {
    const first = makeMessage(doc, 1);
    const second = makeMessage(doc, 2);
    const old = mountStrip(first, items);
    const fresh = mountStrip(second, items.slice(0, 1));
    assert.equal(old.isConnected, false);
    assert.equal(doc.querySelectorAll('.story-block-strip').length, 1);
    same(doc.querySelector('.story-block-strip'), fresh);

    mountStrip(second, []);
    assert.equal(doc.querySelectorAll('.story-block-strip').length, 0, 'empty items clear the old strip too');

    const loose = doc.createElement('div');
    doc.body.appendChild(loose);
    const fallback = mountStrip(loose, items);
    same(fallback.parentElement, loose, 'falls back to the message element');
    unmountStrip();
    assert.equal(doc.querySelectorAll('.story-block-strip').length, 0);
    for (const node of [first, second, loose]) node.remove();
});

test('item text is text, never markup', () => {
    const message = makeMessage(doc);
    const strip = mountStrip(message, [{ tabId: 't', block: '<b>B</b>', text: '<img src=x>', tone: 'up' }]);
    assert.equal(strip.querySelector('.story-block-strip-item').textContent, '<img src=x>');
    assert.equal(strip.querySelectorAll('img, b').length, 0);
    message.remove();
});
