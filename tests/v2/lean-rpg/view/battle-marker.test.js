// The narrator's `[battle]` marker never shows as raw text (lean-rpg/view/battle-log.js): with no recorded rolls (or the RPG
// off) it is hidden but kept, so a panel drawn later still stands in its place; and when another extension draws a reply's
// text again after the panel was drawn (SillyTavern's updateMessageBlock, which no event follows), the panel comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { makeMessage } from '../../../ui-fake-dom.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { BATTLE_ROOT, MARKER_HIDDEN, createBattleLog, hideMarkers, markerNodes } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { RESOLVE } from '../../../../src/v2/lean-rpg/index.js';
import { characterDefinition, defineAll, foesDefinition, roleOf, setField, skillsDefinition } from './helpers.js';

const pc = (who, stat, extra = {}) => ({ who, die: 10, stat, statBonus: 5, classValue: 2, classBonus: 4, rank: 0, edge: 0, total: 19, ...extra });
const foe = (name, extra = {}) => ({ slot: 1, name, die: 9, base: 5, classValue: 1, classBonus: 2, total: 16, ...extra });
const result = () => ({
    v: 1, key: '3-abc', pace: 'normal', stop: 'pace', checks: [],
    rounds: [{ n: 1, decisive: false, lines: [{ kind: 'act', outcome: 'success', skill: 'Iron Breath', pc: pc('Wessel', 'str', { total: 26 }), foe: foe('Sluice Rat A') }] }],
    refused: [], summary: { exchanges: 1, acts: [], refused: 0 },
});
const memory = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };
const visibleText = node => (node.hidden ? '' : node.nodeType === 3 ? String(node.data ?? node.textContent ?? '') : Array.from(node.childNodes ?? []).map(visibleText).join(''));
const kids = text => text.children.map(node => `${node.tagName.toLowerCase()}${node.hidden ? '(hidden)' : ''}:${node.textContent}`);

// A stand-in for the page's MutationObserver: `fire(target)` tells the watch that `target`'s children changed.
function fakeObserver() {
    const made = [];
    class Observer {
        constructor(callback) { this.callback = callback; this.on = false; made.push(this); }
        observe() { this.on = true; }
        disconnect() { this.on = false; }
    }
    return { Observer, fire: target => { for (const one of made) if (one.on) one.callback([{ target, type: 'childList' }]); }, made };
}

async function world(t, { rolled = true, Observer = null } = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel'), skillsDefinition('wessel-skills', 'Wessel'), foesDefinition()]);
    await setField(host, 'foes', 'foe1', 'Sluice Rat A');
    await host.send('To the quay.', 'The quay.\n\n[battle]\n\nAfter.');
    const head = host.store.headIndex();
    const roll = () => host.ctx.chat[head].extra.storySuite.receipts.push({ id: 'rc_rpg0001', type: RESOLVE, module: 'story-block', cause: 'system', summary: '', narrate: false, rev: 99, data: { v2: { result: result() } } });
    if (rolled) roll();
    const doc = setupDom();
    doc.defaultView = { localStorage: memory() };
    const chat = doc.createElement('div');
    chat.id = 'chat';
    doc.body.appendChild(chat);
    const log = createBattleLog({ ctx: host.ctx, doc, store: host.store, featureOn: () => true, roleOf, events: host.events, Observer });
    t.after(() => log.destroy());
    return { host, doc, log, head, roll };
}
function message(doc, index, lines) {
    const el = makeMessage(doc, index), text = el.querySelector('.mes_text');
    text.textContent = '';
    for (const line of lines) { const p = doc.createElement('p'); p.textContent = line; text.appendChild(p); }
    return el;
}

test('no recorded rolls: the marker line is hidden, not shown as text, and kept for a panel drawn later', async t => {
    const { doc, log, head, roll } = await world(t, { rolled: false });
    const el = message(doc, head, ['The quay.', '[battle]', 'After.']);
    const text = el.querySelector('.mes_text');
    assert.equal(log.refresh(head, el), null);
    assert.equal(visibleText(text), 'The quay.After.', 'nothing of the marker shows');
    assert.deepEqual(kids(text), ['p:The quay.', 'p(hidden):[battle]', 'p:After.']);
    assert.ok(text.querySelector(`.${MARKER_HIDDEN}`));
    assert.equal(markerNodes(text).length, 1, 'still there');
    assert.equal(log.refresh(head, el), null);
    assert.deepEqual(kids(text), ['p:The quay.', 'p(hidden):[battle]', 'p:After.'], 'hiding again changes nothing');
    // The rolls are there now (a Re-read, a reload): the panel takes the marker's place, inline.
    roll();
    const node = log.refresh(head, el);
    assert.equal(node.getAttribute('data-variant'), 'inline');
    assert.deepEqual(kids(text).map(item => item.split(':')[0]), ['p', 'div', 'p']);
    assert.equal(text.querySelectorAll(`.${MARKER_HIDDEN}`).length, 0);
});

test('a reader\'s own message keeps a literal [battle] line visible', async t => {
    const { host, doc, log, head } = await world(t, { rolled: false });
    const mine = head - 1;
    assert.equal(host.ctx.chat[mine].is_user, true);
    const el = message(doc, mine, ['I type this:', '[battle]']);
    const text = el.querySelector('.mes_text');
    assert.equal(log.refresh(mine, el), null);
    assert.equal(visibleText(text), 'I type this:[battle]', 'the reader\'s own line is not hidden');
    assert.equal(text.querySelectorAll(`.${MARKER_HIDDEN}`).length, 0);
});

test('a marker that shares its paragraph is hidden on its own; the lines around it stay', async t => {
    const { doc, log, head } = await world(t, { rolled: false });
    const el = makeMessage(doc, head), text = el.querySelector('.mes_text');
    text.textContent = '';
    const p = doc.createElement('p');
    p.append(doc.createTextNode('The rat bites.'), doc.createElement('br'), doc.createTextNode('[battle]'), doc.createElement('br'), doc.createTextNode('It falls back.'));
    text.appendChild(p);
    assert.equal(log.refresh(head, el), null);
    assert.notEqual(p.hidden, true, 'the paragraph shows');
    assert.equal(visibleText(text), 'The rat bites.It falls back.');
    const span = p.querySelector(`.${MARKER_HIDDEN}`);
    assert.equal(span.hidden, true);
    assert.equal(span.textContent, '[battle]');
    // A text with no marker: nothing is done.
    const plain = doc.createElement('div');
    plain.appendChild(doc.createTextNode('He loved a [battle] cry.'));
    hideMarkers(doc, plain);
    assert.equal(visibleText(plain), 'He loved a [battle] cry.');
});

test('the RPG going off: the marker line given back is hidden too, and the panel finds it again when it comes back', async t => {
    const { host, doc, log, head } = await world(t);
    const el = message(doc, head, ['The quay.', '[battle]', 'After.']);
    const text = el.querySelector('.mes_text');
    assert.equal(log.refresh(head, el).getAttribute('data-variant'), 'inline');
    log.destroy();
    assert.equal(visibleText(text), 'The quay.After.');
    assert.equal(markerNodes(text).length, 1);
    const again = createBattleLog({ ctx: host.ctx, doc, store: host.store, featureOn: () => true, roleOf, events: host.events });
    t.after(() => again.destroy());
    assert.equal(again.refresh(head, el).getAttribute('data-variant'), 'inline');
    assert.deepEqual(kids(text).map(item => item.split(':')[0]), ['p', 'div', 'p']);
});

test('the reply\'s text drawn again by another extension after the panel: the panel is drawn again at once', async t => {
    const watch = fakeObserver();
    const { doc, log, head } = await world(t, { Observer: watch.Observer });
    assert.equal(watch.made.length, 1);
    assert.equal(watch.made[0].on, true, 'the chat is watched');
    const el = message(doc, head, ['The quay.', '[battle]', 'After.']);
    doc.querySelector('#chat').appendChild(el);
    const text = el.querySelector('.mes_text');
    assert.equal(log.refresh(head, el).getAttribute('data-variant'), 'inline');
    // updateMessageBlock: the text drawn anew from the message, the raw marker back, the panel gone.
    text.textContent = '';
    for (const line of ['The quay.', '[battle]', 'After.']) { const p = doc.createElement('p'); p.textContent = line; text.appendChild(p); }
    assert.equal(el.querySelectorAll(`.${BATTLE_ROOT}`).length, 0);
    watch.fire(text);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(el.querySelectorAll(`.${BATTLE_ROOT}`).length, 1, 'drawn again');
    assert.deepEqual(kids(text).map(item => item.split(':')[0]), ['p', 'div', 'p']);
    assert.equal(markerNodes(text).length, 0);
    // A change with no marker showing draws nothing again (the panel's own drawing never feeds the watch).
    const node = el.querySelector(`.${BATTLE_ROOT}`);
    watch.fire(text);
    await Promise.resolve();
    assert.equal(el.querySelector(`.${BATTLE_ROOT}`), node);
    log.destroy();
    assert.equal(watch.made[0].on, false, 'destroy stops the watch');
});
