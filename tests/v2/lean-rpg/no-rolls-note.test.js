// The no-rolls note on a reply (approved mockup rpg-no-rolls.html): a reply whose roll planner timed out, failed or gave an unreadable answer holds
// `rpg.noroll` (a prelude receipt, add-only, keyed by the reply), drawn where the battle log would stand. The planner itself is gone: these tests make the
// record through the test-only legacy planner and pin how it replays (reload, rebuild, Re-read, swipe), its command and its words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { NOROLL, RESOLVE } from '../../../src/v2/lean-rpg/index.js';
import { noRoll, noRollOf } from '../../../src/v2/lean-rpg/noroll.js';
import { readRecord } from '../../../src/v2/persist.js';
import { buildNote, noteText } from '../../../src/v2/lean-rpg/view/battle-log.js';
import { PLAN_ANSWER, setup } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MESSAGE = 'I hit the lead rat with Iron Breath, Ren covers me with Spark.';
const receiptsOf = (host, index = 2) => readRecord(host.ctx.chat[index])?.receipts ?? [];
const noteOf = (host, index = 2) => noRollOf(receiptsOf(host, index));
const rollsOn = (host, index = 2) => receiptsOf(host, index).filter(receipt => receipt.type === RESOLVE);

// ---- the record ------------------------------------------------------------------------------------------------------

test('the note survives a reload, a rebuild and a Re-read, and replay equals live', { skip }, async t => {
    const made = await setup({ answers: [new Error('no connection')] });
    t.after(() => made.host.close());
    const { host } = made;
    await host.send(MESSAGE, 'The rats scatter.');
    const note = noteOf(host);
    assert.deepEqual(note, { reason: 'failed' });
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story');
    assert.deepEqual(noteOf(host), note, 'after a rebuild');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live story');
    assert.deepEqual(noteOf(host), note, 'after a reload');
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.deepEqual(noteOf(host), note, 'after a Re-read');
    assert.equal(receiptsOf(host).filter(receipt => receipt.type === NOROLL).length, 1, 'still one');
    assert.equal(JSON.stringify(host.head()), live);
});

test('a swipe that rolls replaces the note; a swipe that fails again carries a note of its own', { skip }, async t => {
    const made = await setup({ answers: [new Error('no connection'), PLAN_ANSWER, 'The rat squeals.'] });
    t.after(() => made.host.close());
    const { host } = made;
    await host.send(MESSAGE, 'The rats scatter.');
    assert.deepEqual(noteOf(host), { reason: 'failed' });
    await host.swipe('Another telling.');
    assert.equal(rollsOn(host).length, 1, 'the swipe rolled');
    assert.equal(noteOf(host), null, 'and the note went with the first telling');
    await host.swipe('A third telling.');
    assert.equal(rollsOn(host).length, 0);
    assert.deepEqual(noteOf(host), { reason: 'unreadable' }, 'the third telling has its own');
});

// ---- the command and the reader ---------------------------------------------------------------------------------------

test('rpg.noroll is made by Story Block only, takes a key and one of the three reasons, and says nothing to the narrator', () => {
    const ctx = (over = {}) => ({ cause: 'system', caller: null, fail: (code, message) => { throw Object.assign(new Error(message), { code }); }, ...over });
    assert.throws(() => noRoll(ctx({ cause: 'ui' }), { key: '2-abc', reason: 'failed' }), { code: 'REFUSED' });
    assert.throws(() => noRoll(ctx(), { key: 'x', reason: 'failed' }), { code: 'INVALID' });
    assert.throws(() => noRoll(ctx(), { key: '2-abc', reason: 'none' }), { code: 'INVALID' });
    const done = noRoll(ctx(), { key: '2-abc', reason: 'timeout', limit: 45 });
    assert.deepEqual([done.summary, done.narrate], ['', false]);
    assert.deepEqual(done.data.v2.skip, { v: 1, key: '2-abc', reason: 'timeout', limit: 45 });
    assert.equal(noRoll(ctx(), { key: '2-abc', reason: 'failed', limit: 45 }).data.v2.skip.limit, undefined, 'a limit goes only with a timeout');
    assert.equal(noRollOf([{ type: NOROLL, data: { v2: { skip: { v: 1, reason: 'bogus' } } } }, { type: 'other' }, null]), null, 'a damaged record is no note');
    assert.deepEqual(noRollOf([{ type: NOROLL, data: { v2: { skip: done.data.v2.skip } } }]), { reason: 'timeout', limit: 45 });
});

// ---- the wording and the slot ------------------------------------------------------------------------------------------

test('the words are the mockup\'s, the timeout names the limit used', () => {
    assert.equal(noteText({ reason: 'timeout', limit: 45 }), 'the roll planner did not answer within 45 s. Swipe to try again, or pick a faster connection in Settings → Assist.');
    assert.equal(noteText({ reason: 'failed' }), 'the roll planner’s call failed. Swipe to try again; Settings → Diagnostics has the error.');
    assert.equal(noteText({ reason: 'unreadable' }), 'the roll planner’s answer could not be read. Swipe to try again.');
    const made = [];
    const doc = { createElement: tag => { const node = { tag, className: '', children: [], attrs: {}, set textContent(value) { this.text = value; }, get textContent() { return this.text ?? this.children.map(child => child.textContent ?? child.data).join(''); }, setAttribute(key, value) { this.attrs[key] = value; }, append(...nodes) { this.children.push(...nodes); } }; made.push(node); return node; }, createTextNode: data => ({ data }) };
    const node = buildNote(doc, { reason: 'timeout', limit: 60 }, { variant: 'card', index: 2 });
    assert.equal(node.textContent, 'No rolls this reply: the roll planner did not answer within 60 s. Swipe to try again, or pick a faster connection in Settings → Assist.');
    assert.deepEqual([node.attrs['data-variant'], node.attrs['data-ss-index'], node.className.includes('rpg-battle')], ['card', '2', true], 'the same slot and roots as the log');
});
