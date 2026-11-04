// The Assist safety net on the real host (MODULES §F123): a send waits for it only briefly; lines that
// arrive after the reader sent are kept on that reply (<Changes-assist-next>) and applied on the next reply
// right after its own lines, marked "late", through the stricter wall (never coin, never a new item); the
// stored lines are what Re-read and a swipe of the next reply use, with no new model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTING } from '../../../src/v2/assist/index.js';
import { assistSections, withAssist } from '../../../src/v2/capture.js';
import { ASSIST_WAIT_MS } from '../../../src/v2/turn.js';
import { createHost, hostAvailable } from '../../../testkit/index.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A model whose first answer waits until `release()`; later answers are 'none'.
function heldModel(answer) {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const calls = [];
    const model = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) {
            await held;
            return answer;
        }
        return 'none';
    };
    return { model, calls, release: () => release() };
}

async function hostWith(model) {
    const host = await createHost({ callModel: model, settings: { modules: { 'story-block': { [SETTING.extractor]: true } } } });
    host.features?.set?.('story-block.extractor', true);
    return host;
}

test('a send waits only briefly; late lines are kept on the reply and applied on the next one, marked, without coin or new items', { skip }, async () => {
    const { model, calls, release } = heldModel('~ place Old Mill | kind: settlement\n- item Coins | qty: 30\n+ present Elula\n~ wound Mira — bitten | harm: scratch');
    const host = await hostWith(model);
    const first = await host.send('I walk on.', 'You walk to the old mill. Elula waits at her counter.');
    await wait(5);
    assert.equal(calls.length, 1, 'the safety net is reading the first reply');
    // The second send: the interceptor waits at most ASSIST_WAIT_MS, then the reply goes on; the answer
    // arrives while it is being written.
    const intercept = host.st.interceptor;
    let waited = 0;
    host.st.interceptor = async (...args) => {
        const started = performance.now();
        await intercept(...args);
        waited = performance.now() - started;
        release();
        await wait(20);
    };
    const second = await host.send('I greet her.', 'She nods; Fenna comes in.\n<Changes>\n+ present Fenna\n</Changes>');
    host.st.interceptor = intercept;
    assert.ok(waited >= ASSIST_WAIT_MS - 50 && waited < ASSIST_WAIT_MS + 1500, `waited ${waited} ms`);
    const stored = assistSections(host.ctx.chat[first.index].mes);
    assert.deepEqual(stored.now, []);
    assert.ok(stored.next.includes('~ place Old Mill | kind: settlement'), 'kept on the reply it was read from');
    assert.ok(!stored.next.some(line => /Coins/.test(line)), 'no coin after send, even as an item');
    // Applied on the second reply, after its own line, marked late.
    const record = host.ctx.chat[second.index].extra.storySuite;
    const late = record.receipts.filter(receipt => receipt.assist === 'late');
    assert.ok(late.length >= 2, JSON.stringify(record.receipts.map(receipt => [receipt.type, receipt.assist])));
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    const ownAt = record.receipts.findIndex(receipt => receipt.cause === 'story' && receipt.assist === undefined);
    const lateAt = record.receipts.findIndex(receipt => receipt.assist === 'late');
    assert.ok(ownAt < lateAt || ownAt < 0, 'after the reply\'s own lines');
    // Re-read of the second reply uses the stored lines: same place, no new call.
    const callsNow = calls.length;
    const again = await host.sdk.reread(second.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(calls.length, callsNow);
    assert.ok(again.receipts.some(receipt => receipt.assist === 'late'));
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    // A swipe of the second reply applies them again from what is stored.
    await host.swipe('She only smiles.');
    await wait(20);
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    host.close();
});

test('an answer within the brief wait is applied on the reply it read, before the next prompt is built', { skip }, async () => {
    const { model, release } = heldModel('~ place Old Mill');
    const host = await hostWith(model);
    const first = await host.send('I walk on.', 'You walk to the old mill.');
    setTimeout(release, 100);
    await host.send('I look around.', 'Dusty sacks.');
    const receipts = host.ctx.chat[first.index].extra.storySuite.receipts;
    assert.ok(receipts.some(receipt => receipt.assist === 'now'), 'applied on the first reply');
    assert.deepEqual(assistSections(host.ctx.chat[first.index].mes).now, ['~ place Old Mill']);
    host.close();
});

test('a line the block already has is never applied twice (C-1 matching, and the same op, kind and name)', { skip }, async () => {
    const model = async () => '~ place Old Mill | kind: settlement\n+ present Elula';
    const host = await hostWith(model);
    const turn = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    await host.send('I walk on.', 'You reach the old mill; Elula is there.\n<Changes>\n~ place Old Mill\n</Changes>');
    const late = await turn;
    assert.deepEqual(late.receipts.map(receipt => receipt.assistLine), ['+ present Elula']);
    host.close();
});

// The USER's reply (4 Nov): the block set the place and who is present; the safety net wrote the same place in
// other words. Applied after the block, it read as a move and left everyone behind (present emptied).
const BLUEWATCH = 'Osken pays out at the desk; Nelje takes the pork.\n<Changes>\n~ place Bluewatch — Guild Office | kind: settlement\n- present Osken\n+ present Nelje\n~ time CY611, Goldwane 12, 5:30 pm\n! time +2h 30m\n</Changes>';

test('a place or time the block set is never set again by the safety net (another wording of the place is not a move); a kind it left out still is', { skip }, async () => {
    const model = async () => '~ place Bluewatch Village / Guild Office\n! time +1h\n~ weather rain\n+ present Kettle-Maw Tam';
    const host = await hostWith(model);
    await host.send('I go to the desk.', 'Osken waits at the guild desk.\n<Changes>\n~ place Bluewatch — Guild Office\n+ present Osken\n</Changes>');
    const turn = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    await host.send('I collect the pay.', BLUEWATCH);
    const late = await turn;
    // The place and the clock the block set stay; the weather it left out and a new person are used.
    assert.deepEqual(late.receipts.map(receipt => receipt.assistLine), ['~ weather rain', '+ present Kettle-Maw Tam']);
    assert.equal(host.sdk.query('scene.place').name, 'Bluewatch');
    assert.deepEqual(host.sdk.query('scene.present').sort(), ['Kettle-Maw Tam', 'Nelje']);
    host.close();
});

test('Re-read of a reply that stored a reworded place from the safety net keeps who the block made present', { skip }, async () => {
    const host = await hostWith(async () => 'none');
    await host.send('I go to the desk.', 'Osken waits at the guild desk.\n<Changes>\n~ place Bluewatch — Guild Office\n+ present Osken\n</Changes>');
    const reply = await host.send('I collect the pay.', BLUEWATCH);
    // As saved by an earlier version: the safety net's reworded place kept in the reply's <Changes-assist>.
    const message = host.ctx.chat[reply.index];
    message.mes = withAssist(message.mes, ['~ place Bluewatch Village / Guild Office']);
    if (Array.isArray(message.swipes)) message.swipes[message.swipe_id ?? 0] = message.mes;
    const again = await host.sdk.reread(reply.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.ok(!again.receipts.some(receipt => receipt.assist === 'now'), 'the stored place line is not used');
    assert.equal(host.sdk.query('scene.place').name, 'Bluewatch');
    assert.deepEqual(host.sdk.query('scene.present'), ['Nelje']);
    host.close();
});
