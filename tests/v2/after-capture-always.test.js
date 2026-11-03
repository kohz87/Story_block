// A module's afterCapture hook may opt in (`hook.always = true`) to run for a reply with no story lines too; a plain hook still does not.
// The step is stored on the reply like any afterCapture step: swipe and delete take it back, Re-read decides again, rebuild equals live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

function counter(id, { always, calls }) {
    const hook = (view, info) => {
        calls.push({ index: info.index, type: info.type, always: info.always === true });
        // Marks the reply when its text says "mark".
        const text = String(view.chat?.lastUser ?? '');
        return /mark/.test(text) ? { commands: [{ type: `${id}.mark`, payload: {} }] } : undefined;
    };
    if (always) hook.always = true;
    return {
        id, name: id, version: '0.0.0',
        domains: { [id]: { initial: () => ({ marks: 0 }), validate: () => [], counters: ['marks'] } },
        commands: { [`${id}.mark`](ctx) { if (ctx.cause !== 'system') ctx.fail('REFUSED', 'System only.'); ctx.draft(id).marks += 1; return { summary: 'Marked.', narrate: false }; } },
        hooks: { afterCapture: hook },
    };
}

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const plain = [];
    const opted = [];
    const host = await createHost({ modules: [counter('plainmod', { always: false, calls: plain }), counter('optmod', { always: true, calls: opted })] });
    t.after(() => host.close());
    return { host, plain, opted };
}

const marks = (host, id) => host.head().domains[id].marks;
const stepsOn = (host, index) => host.ctx.chat[index].extra.storySuite.receipts.filter(receipt => receipt.afterCapture === true);
const rebuilt = host => { const head = structuredClone(host.head()); host.store.rebuild(); assert.deepEqual(host.head(), head); };

test('a reply with no story lines runs an opted-in afterCapture hook and not a plain one', async t => {
    const { host, plain, opted } = await fresh(t);
    await host.send('mark it', 'Nothing is written.');
    const index = host.ctx.chat.length - 1;
    assert.deepEqual(plain, []);
    assert.deepEqual(opted, [{ index, type: 'normal', always: true }]);
    assert.equal(marks(host, 'optmod'), 1);
    assert.equal(marks(host, 'plainmod'), 0);
    assert.deepEqual(stepsOn(host, index).map(receipt => receipt.type), ['optmod.mark']);
    rebuilt(host);
});

test('a reply with lines runs both, as before, and the opted-in one is not told "always"', async t => {
    const { host, plain, opted } = await fresh(t);
    await host.send('mark it', reply('Written.', ['~ place Harrow | kind: settlement']));
    assert.equal(plain.length, 1);
    assert.deepEqual(opted.map(call => call.always), [false]);
    assert.deepEqual([marks(host, 'plainmod'), marks(host, 'optmod')], [1, 1]);
    rebuilt(host);
});

test('swipe takes the step back and decides again; Re-read of a reply with no lines decides again; delete takes it away', async t => {
    const { host } = await fresh(t);
    await host.send('mark it', 'No lines.');
    const index = host.ctx.chat.length - 1;
    await host.swipe('Another, no lines.');
    assert.equal(marks(host, 'optmod'), 1, 'taken back and done again once');
    const live = structuredClone(host.head());
    const again = await host.sdk.reread(index);
    assert.equal(again.ok, true, again.message);
    assert.deepEqual(host.head().domains, live.domains, 'Re-read gives what the live capture gave');
    rebuilt(host);
    await host.send('Go on.', 'Quiet.');
    assert.equal(marks(host, 'optmod'), 1, 'the later reply does not mark');
    host.ctx.chat.splice(index, 2);
    host.store.rebuild();
    assert.equal(marks(host, 'optmod'), 0);
});
