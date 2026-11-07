// The no-rolls note on a reply (lean-rpg/view/battle-log.js buildNote; approved mockup rpg-no-rolls.html): where the battle log would stand
// (at the narrator's `[battle]` marker, else a card under the reply), drawn from the reply's own `rpg.noroll` receipt, replaced by the log when the reply
// has rolls, gone with the feature, the same after a redraw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { makeMessage } from '../../../ui-fake-dom.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { BATTLE_ROOT, MARKER_HIDDEN, createBattleLog } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { NOROLL, RESOLVE } from '../../../../src/v2/lean-rpg/index.js';
import { characterDefinition, defineAll, foesDefinition, roleOf, setField, skillsDefinition } from './helpers.js';
import { begin, makeBlocks, page, settle } from './page.js';

const memory = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };
const note = (reason, limit) => ({ id: 'rc_rpgn0001', type: NOROLL, module: 'story-block', cause: 'system', summary: '', narrate: false, rev: 99, beforeGenerate: true,
    data: { v2: { key: '3-abc', skip: { v: 1, key: '3-abc', reason, ...(limit ? { limit } : {}) } } } });
const pc = (who, stat, extra = {}) => ({ who, die: 10, stat, statBonus: 5, classValue: 2, classBonus: 4, rank: 0, edge: 0, total: 19, ...extra });
const rolled = () => ({ id: 'rc_rpg0001', type: RESOLVE, module: 'story-block', cause: 'system', summary: '', narrate: false, rev: 99, data: { v2: { result: {
    v: 1, key: '3-abc', pace: 'normal', stop: 'pace', checks: [], rounds: [{ n: 1, decisive: false, lines: [{ kind: 'act', outcome: 'success', skill: 'Iron Breath', pc: pc('Wessel', 'str', { total: 26 }),
        foe: { slot: 1, name: 'Sluice Rat A', die: 9, base: 5, classValue: 1, classBonus: 2, total: 16 } }] }], refused: [], summary: { exchanges: 1, acts: [], refused: 0 } } } } });
const kids = text => text.children.map(node => `${node.tagName.toLowerCase()}${node.hidden ? '(hidden)' : ''}`);

async function world(t, { featureOn = () => true } = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel'), skillsDefinition('wessel-skills', 'Wessel'), foesDefinition()]);
    await setField(host, 'foes', 'foe1', 'Sluice Rat A');
    await host.send('To the quay.', 'The quay.\n\n[battle]\n\nAfter.');
    const head = host.store.headIndex();
    const receipts = () => host.ctx.chat[head].extra.storySuite.receipts;
    const doc = setupDom();
    doc.defaultView = { localStorage: memory() };
    const chat = doc.createElement('div');
    chat.id = 'chat';
    doc.body.appendChild(chat);
    const log = createBattleLog({ ctx: host.ctx, doc, store: host.store, featureOn, roleOf, events: host.events });
    t.after(() => log.destroy());
    const draw = lines => {
        const el = makeMessage(doc, head), text = el.querySelector('.mes_text');
        text.textContent = '';
        for (const line of lines) { const p = doc.createElement('p'); p.textContent = line; text.appendChild(p); }
        return { el, text };
    };
    return { host, doc, log, head, receipts, draw };
}

test('the note stands at the marker, with the lead in bold and the reason, for each of the three reasons', async t => {
    const { log, head, receipts, draw } = await world(t);
    const { el, text } = draw(['The quay.', '[battle]', 'After.']);
    for (const [reason, limit, words] of [
        ['timeout', 45, 'No rolls this reply: the roll planner did not answer within 45 s. Swipe to try again, or pick a faster connection in Settings → Assist.'],
        ['failed', undefined, 'No rolls this reply: the roll planner’s call failed. Swipe to try again; Settings → Diagnostics has the error.'],
        ['unreadable', undefined, 'No rolls this reply: the roll planner’s answer could not be read. Swipe to try again.'],
    ]) {
        receipts().splice(0, receipts().length, note(reason, limit));
        const node = log.refresh(head, el);
        assert.equal(node.getAttribute('data-variant'), 'inline', reason);
        assert.equal(node.textContent, words, reason);
        assert.equal(node.querySelector('b').textContent, 'No rolls this reply:');
        assert.equal(el.querySelectorAll(`.${BATTLE_ROOT}`).length, 1, 'one slot, one thing');
        assert.deepEqual(kids(text), ['p', 'div', 'p'], 'in the log\'s place, the marker line taken');
    }
});

test('with no marker the note is a card under the reply; it is not redrawn when nothing changed', async t => {
    const { log, head, receipts, draw } = await world(t);
    const { el } = draw(['The quay.', 'After.']);
    receipts().splice(0, receipts().length, note('failed'));
    const first = log.refresh(head, el);
    assert.equal(first.getAttribute('data-variant'), 'card');
    assert.equal(log.refresh(head, el), first, 'the same node while the record is the same');
});

test('a reply that rolled shows the log, not the note (a swipe that rolls replaces it); a redraw agrees', async t => {
    const { log, head, receipts, draw } = await world(t);
    const { el, text } = draw(['The quay.', '[battle]', 'After.']);
    receipts().splice(0, receipts().length, note('timeout', 30));
    assert.ok(log.refresh(head, el).classList.contains('rpg-norolls'));
    receipts().splice(0, receipts().length, rolled());
    const node = log.refresh(head, el);
    assert.ok(!node.classList.contains('rpg-norolls'), 'the log');
    assert.equal(el.querySelectorAll('.rpg-norolls').length, 0);
    assert.equal(el.querySelectorAll(`.${BATTLE_ROOT}`).length, 1);
    // …and back: the note comes where the log was, and the marker line is still kept for either.
    receipts().splice(0, receipts().length, note('failed'));
    assert.ok(log.refresh(head, el).classList.contains('rpg-norolls'));
    log.refresh(head, el);
    assert.equal(el.querySelectorAll('.rpg-norolls').length, 1, 'a redraw agrees');
    assert.deepEqual(kids(text), ['p', 'div', 'p']);
});

test('no note without the receipt, on a message of the reader\'s, or with the feature off; the marker is then hidden as ever', async t => {
    let on = true;
    const { log, head, receipts, draw } = await world(t, { featureOn: () => on });
    const { el, text } = draw(['The quay.', '[battle]', 'After.']);
    assert.equal(log.noteAt(head), null, 'no receipt, no note');
    assert.equal(log.refresh(head, el), null);
    assert.equal(text.querySelectorAll(`.${MARKER_HIDDEN}`).length, 1);
    receipts().splice(0, receipts().length, note('failed'));
    assert.ok(log.refresh(head, el));
    on = false;
    assert.equal(log.noteAt(head), null, 'the feature is off');
    assert.equal(log.refresh(head, el), null);
    assert.equal(el.querySelectorAll(`.${BATTLE_ROOT}`).length, 0, 'taken away');
    assert.equal(text.querySelectorAll(`.${MARKER_HIDDEN}`).length, 1, 'and the marker line is given back, hidden');
    assert.equal(log.noteAt(1), null, 'a message of the reader\'s never has one');
});

test('the note\'s stylesheet: a dashed warn note, theme tokens only', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-battle\.rpg-norolls \{[^}]*border: 1px dashed var\(--ss-warn/);
    assert.match(css, /\.rpg-norolls-dot \{[^}]*background: var\(--ss-warn/);
});
