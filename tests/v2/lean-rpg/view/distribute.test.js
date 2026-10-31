import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { newSession, renderDistribute, spentOf } from '../../../../src/v2/lean-rpg/view/distribute.js';
import { readParty } from '../../../../src/v2/lean-rpg/view/party-data.js';
import { replyEdits } from '../../../../src/v2/reply-cards.js';
import { readRecord } from '../../../../src/v2/persist.js';
import { DM_LIMITS } from '../../../../src/v2/data-modules/schema.js';
import { characterDefinition, defineAll, fakeState, fieldsOf, roleOf, setField } from './helpers.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const character = (state, own = 'Wessel') => readParty(state, { own, roleOf })[0];
const hero = (fields = {}) => ({ definition: characterDefinition('wessel', 'Wessel'), fields: { str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10, points: 3, soul: 2, xp: 40, health: 3, mana: 4, stamina: 1, ...fields } });

function sheet({ fields = {}, api = {}, onClose = () => {}, onDone = () => {} } = {}) {
    const doc = setupDom(), host = doc.createElement('div');
    doc.body.appendChild(host);
    const handle = renderDistribute(host, { character: character(fakeState([hero(fields)])), api, doc, onClose, onDone });
    return { doc, host, handle, root: host.querySelector('.rpg-sheet') };
}
const step = (root, stat) => ({
    up: () => root.querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-inc`),
    down: () => root.querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-dec`),
    value: () => root.querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-input`).value,
});
const pill = root => root.querySelector('.rpg-points-left').textContent;
const button = (root, cls) => root.querySelector(`button.${cls}`);

test('the sheet: bars on top, a stepper per stat, the points-left pill and the radar', () => {
    const { root } = sheet();
    assert.equal(root.getAttribute('role'), 'dialog');
    assert.match(root.getAttribute('aria-label'), /Wessel: spend points/);
    assert.deepEqual(root.querySelectorAll('.rpg-bar').map(node => node.getAttribute('data-bar')), ['health', 'mana', 'stamina']);
    assert.deepEqual(root.querySelectorAll('.rpg-stat-step').map(node => node.getAttribute('data-stat')), ['str', 'vit', 'agi', 'dex', 'int', 'luk', 'cha']);
    assert.equal(step(root, 'str').value(), '14');
    assert.equal(pill(root), '3 points left');
    assert.match(root.textContent, /Soul Class II/);
    assert.match(root.textContent, /XP 40 \/ 100/);
    assert.ok(root.querySelector('.ss-w-radar'), 'the radar is there');
    assert.match(root.textContent, /Wessel's stats/);
    assert.deepEqual(['rpg-save', 'rpg-reset', 'rpg-cancel'].map(cls => Boolean(button(root, cls))), [true, true, true]);
    assert.equal(button(root, 'rpg-save').textContent, 'Save stats');
});

test('spending: each step up costs a point, steps down refund it, the budget stops the plus, nothing goes below where it started', () => {
    const { root, handle } = sheet();
    for (let n = 0; n < 3; n += 1) step(root, 'str').up().click();
    assert.equal(step(root, 'str').value(), '17');
    assert.equal(pill(root), '0 points left');
    assert.equal(step(root, 'vit').up().disabled, true, 'the points are spent');
    step(root, 'str').down().click();
    assert.equal(pill(root), '1 point left');
    step(root, 'vit').up().click();
    assert.equal(pill(root), '0 points left');
    assert.deepEqual(handle.draft(), { str: 16, vit: 13, agi: 11, dex: 10, int: 8, luk: 9, cha: 10 });
    assert.equal(step(root, 'agi').down().disabled, true, 'a stat never goes below where it started');
    assert.equal(spentOf(character(fakeState([hero()])).stats, { str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10 }, handle.draft()), 3);
});

test('a stat stops at 20', () => {
    const { root } = sheet({ fields: { str: 19, points: 5 } });
    step(root, 'str').up().click();
    assert.equal(step(root, 'str').value(), '20');
    assert.equal(step(root, 'str').up().disabled, true);
    assert.equal(pill(root), '4 points left');
});

test('the radar shows the new shape over the old one', () => {
    const { root } = sheet();
    const before = root.querySelector('.ss-w-radar').textContent;
    step(root, 'int').up().click();
    const after = root.querySelector('.ss-w-radar').textContent;
    assert.notEqual(after, before);
    assert.match(after, /INT: 9 of 20 \(was 8\)/);
});

test('Reset puts every stat back; Cancel writes nothing and closes', async () => {
    const calls = [], closed = [];
    const { root } = sheet({ api: { command: async (...call) => { calls.push(call); return { ok: true }; } }, onClose: result => closed.push(result) });
    step(root, 'str').up().click();
    assert.equal(button(root, 'rpg-save').disabled, false);
    button(root, 'rpg-reset').click();
    assert.equal(step(root, 'str').value(), '14');
    assert.equal(pill(root), '3 points left');
    assert.equal(button(root, 'rpg-save').disabled, true, 'nothing to save');
    step(root, 'dex').up().click();
    button(root, 'rpg-cancel').click();
    await settle();
    assert.deepEqual(calls, []);
    assert.deepEqual(closed, [{ saved: false }]);
});

test('Save writes the changed stats and the points as ONE multi-field dm.set, then closes', async () => {
    const calls = [], done = [];
    const { root } = sheet({ api: { command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; } }, onDone: result => done.push(result) });
    step(root, 'str').up().click();
    step(root, 'str').up().click();
    step(root, 'cha').up().click();
    button(root, 'rpg-save').click();
    await settle(); await settle();
    assert.deepEqual(calls, [['dm.set', { module: 'pack.chat/wessel', fields: { str: 16, cha: 11, points: 0 } }]]);
    assert.deepEqual(done, [{ ok: true }]);
});

test('a refused save says why and keeps the sheet open', async () => {
    const calls = [], done = [];
    const { root } = sheet({ api: { command: async (type, payload) => { calls.push(payload); return { ok: false, message: 'Not now.' }; } }, onDone: result => done.push(result) });
    step(root, 'str').up().click();
    step(root, 'cha').up().click();
    button(root, 'rpg-save').click();
    await settle(); await settle();
    assert.equal(calls.length, 1, 'one write, so nothing is half saved');
    assert.deepEqual(done, [{ ok: false }]);
    assert.equal(root.querySelector('.rpg-sheet-note').textContent, 'Not now.');
    assert.equal(button(root, 'rpg-save').disabled, false, 'the reader can try again');
});

test('a full reply budget is told in plain words and keeps the sheet open', async () => {
    const done = [];
    const { root } = sheet({ api: { command: async () => ({ ok: false, code: 'DM_BUDGET', message: 'Character: Data module reply budget exhausted; nothing applied.' }) }, onDone: result => done.push(result) });
    step(root, 'str').up().click();
    button(root, 'rpg-save').click();
    await settle(); await settle();
    assert.equal(root.querySelector('.rpg-sheet-note').textContent, 'This reply already holds as many changes as one reply can. Send your next message, then try again.');
    assert.deepEqual(done, [{ ok: false }]);
    assert.equal(button(root, 'rpg-save').disabled, false);
});

test('a character with no points sees the stats but cannot raise them', () => {
    const { root } = sheet({ fields: { points: 0 } });
    assert.match(root.getAttribute('aria-label'), /Wessel: stats/);
    assert.equal(button(root, 'rpg-save').textContent, 'Save');
    assert.equal(button(root, 'rpg-save').disabled, true);
    assert.equal(step(root, 'str').up().disabled, true);
    assert.equal(pill(root), '0 points left');
    assert.match(root.querySelector('.rpg-sheet-note').textContent, /No points to spend/);
});

test('drawn again from the same session (the page redrew itself): the draft stays; if the story moved under it, it starts again', () => {
    const { root, handle, host } = sheet();
    step(root, 'str').up().click();
    const again = (fields, session = handle.session) => {
        const doc = host.ownerDocument, el = doc.createElement('div');
        doc.body.appendChild(el);
        renderDistribute(el, { character: character(fakeState([hero(fields)])), session, doc });
        return el.querySelector('.rpg-sheet');
    };
    const same = again({ health: 5 });
    assert.equal(step(same, 'str').value(), '15', 'only a bar moved: the draft stays');
    assert.match(same.querySelector('.rpg-bar[data-bar="health"]').textContent, /Unhurt/);
    assert.equal(pill(same), '2 points left');
    const moved = again({ points: 6 });
    assert.equal(step(moved, 'str').value(), '14', 'the points changed under it: start again');
    assert.equal(pill(moved), '6 points left');
    assert.equal(newSession(character(fakeState([hero()]))).busy, false);
});

test('a save that outlives its sheet (the page redrew after the first write) still ends and says so', async () => {
    const done = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { root, handle } = sheet({ api: { command: async () => { await gate; return { ok: true }; } }, onDone: result => done.push(result) });
    step(root, 'str').up().click();
    button(root, 'rpg-save').click();
    assert.equal(handle.session.busy, true);
    assert.equal(button(root, 'rpg-save').disabled, true);
    assert.equal(root.querySelector('.rpg-sheet-note').textContent, 'Saving…');
    handle.destroy();
    release();
    await settle(); await settle();
    assert.deepEqual(done, [{ ok: true }]);
    assert.equal(handle.session.busy, false);
});

test('on the real host Save is ONE action on the latest reply: one "You set" line naming each stat and the points', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel')]);
    for (const [field, value] of Object.entries({ str: 14, vit: 12, points: 3, soul: 2 })) await setField(host, 'wessel', field, value);
    await host.send('Look around.', 'A wet quay.');
    const head = host.store.headIndex();
    const doc = setupDom(), parent = doc.createElement('div');
    doc.body.appendChild(parent);
    const done = [];
    renderDistribute(parent, { character: character(host.head()), api: { command: (type, payload) => host.sdk.command(type, payload) }, doc, onDone: result => done.push(result) });
    const root = parent.querySelector('.rpg-sheet');
    step(root, 'str').up().click();
    step(root, 'str').up().click();
    step(root, 'vit').up().click();
    const before = readRecord(host.ctx.chat[head]).receipts.length;
    button(root, 'rpg-save').click();
    for (let n = 0; n < 8; n += 1) await settle();
    assert.deepEqual(done, [{ ok: true }]);
    const now = fieldsOf(host, 'wessel');
    assert.deepEqual([now.str, now.vit, now.points], [16, 13, 0]);
    const record = readRecord(host.ctx.chat[head]);
    assert.equal(record.receipts.length - before, 1, 'one write, on the latest reply');
    assert.deepEqual(replyEdits(record, [], head).map(row => row.text).slice(-1), ['You set Wessel: STR 14 → 16, VIT 12 → 13, points 3 → 0.']);
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live, 'a cold rebuild gives the same stats');
});

test('on the real host Save still fits a reply that already holds thirty-one other changes, and a full reply says so in plain words', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel')]);
    for (const [field, value] of Object.entries({ str: 14, vit: 12, points: 3, soul: 2 })) await setField(host, 'wessel', field, value);
    await host.send('Look around.', 'A wet quay.');
    const room = DM_LIMITS.replyRoots - 1;
    for (let at = 0; at < room; at += 1) await setField(host, 'wessel', 'xp', at % 2 ? 10 : 20);
    const doc = setupDom(), parent = doc.createElement('div');
    doc.body.appendChild(parent);
    const done = [];
    const api = { command: (type, payload) => host.sdk.command(type, payload) };
    const open = () => {
        const handle = renderDistribute(parent, { character: character(host.head()), api, doc, onDone: result => done.push(result) });
        return handle.el;
    };
    let root = open();
    step(root, 'str').up().click();
    step(root, 'vit').up().click();
    button(root, 'rpg-save').click();
    for (let n = 0; n < 8; n += 1) await settle();
    assert.deepEqual(done, [{ ok: true }], 'the last free action of the reply is enough');
    assert.deepEqual([fieldsOf(host, 'wessel').str, fieldsOf(host, 'wessel').vit, fieldsOf(host, 'wessel').points], [15, 13, 1]);
    parent.replaceChildren();
    root = open();
    step(root, 'str').up().click();
    button(root, 'rpg-save').click();
    for (let n = 0; n < 8; n += 1) await settle();
    assert.deepEqual(done, [{ ok: true }, { ok: false }]);
    assert.equal(root.querySelector('.rpg-sheet-note').textContent, 'This reply already holds as many changes as one reply can. Send your next message, then try again.');
    assert.equal(fieldsOf(host, 'wessel').str, 15, 'nothing was half saved');
});
