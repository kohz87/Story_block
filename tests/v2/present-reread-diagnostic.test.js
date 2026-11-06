// A Re-read can refresh the display as well as the scene. Its text-free trace records which happened and
// the order and provenance of place/present captures, including delayed safety-net lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withAssist } from '../../src/v2/capture.js';
import { createStore } from '../../src/v2/store.js';
import { createHost } from '../../testkit/index.js';

const block = lines => `A reply.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const rebuilt = host => createStore({ chat: () => host.ctx.chat, save: () => {} }).head();
const trace = mock => mock.mock.calls.map(call => call.arguments.join(' ')).find(line => line.includes('Re-read scene diagnostic'));

test('owner sequence with previous late arrivals: live, rebuild and Re-read agree and the trace shows capture order', async t => {
    t.mock.method(console, 'warn', () => {});
    const info = t.mock.method(console, 'info', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', block(['~ place Old Quay', '+ present Surna', '+ present Sister Temiwa']));
    const previous = await host.send('Wait.', 'Surna and Sister Temiwa are still here.');
    const message = host.ctx.chat[previous.index];
    message.mes = withAssist(message.mes, ['+ present Surna', '+ present Sister Temiwa'], { next: true });
    if (Array.isArray(message.swipes)) message.swipes[message.swipe_id ?? 0] = message.mes;
    const reply = await host.send('On.', block(['~ place South Peat Trenches', '+ present Jurre', '- present Surna', '- present Sister Temiwa']));
    const live = structuredClone(host.head());
    assert.deepEqual(rebuilt(host), live);
    const done = await host.turn.reread(reply.index);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(host.head(), live);
    const output = trace(info);
    assert.ok(output);
    assert.match(output, /reply presence changed=false; head presence changed=false; same scene lines=true; previous late candidates=2/);
    assert.match(output, /stored order=\[reply:place\(moved=true\).*late:present\(\+1,-0,missing=0\).*late:present\(\+1,-0,missing=0\)/);
    assert.ok(!/Surna|Temiwa|Jurre|Peat/.test(output), 'trace contains no names or reply text');
});

test('the trace identifies a scene change caused by editing the reply before Re-read', async t => {
    t.mock.method(console, 'warn', () => {});
    const info = t.mock.method(console, 'info', () => {});
    const host = await createHost();
    t.after(() => host.close());
    const reply = await host.send('Hello.', block(['~ place Old Quay', '+ present Surna']));
    await host.st.editMessage(reply.index, block(['~ place Old Quay', '+ present Jurre']));
    const done = await host.turn.reread(reply.index);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(host.head().domains.scene.present, ['Jurre']);
    const output = trace(info);
    assert.ok(output);
    assert.match(output, /reply presence changed=true; head presence changed=true; same scene lines=false/);
    assert.ok(!/Surna|Jurre|Quay/.test(output), 'trace contains no names or reply text');
});

test('a Re-read with no scene receipts or presence change produces no scene trace', async t => {
    t.mock.method(console, 'warn', () => {});
    const info = t.mock.method(console, 'info', () => {});
    const host = await createHost();
    t.after(() => host.close());
    const reply = await host.send('Hello.', 'A quiet reply.');
    const done = await host.turn.reread(reply.index);
    assert.equal(done.ok, true, done.message);
    assert.equal(trace(info), undefined);
});

test('an unavailable console does not stop a successful Re-read', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => { throw new Error('console unavailable'); });
    const host = await createHost();
    t.after(() => host.close());
    const reply = await host.send('Hello.', block(['+ present Surna']));
    const done = await host.turn.reread(reply.index);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(host.head().domains.scene.present, ['Surna']);
});
