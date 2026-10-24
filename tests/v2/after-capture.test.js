// The afterCapture hook (SPEC §4.2 step 3, MODULES §F121): a module's step that runs once right after a
// reply's last story line, as part of that reply. A test module keeps a debt the story writes (`! owe 5`)
// and settles it in its afterCapture step on the scene the reply ended up in: paid at a settlement, else
// refused (like Story Director's turn-in, whose line is often read before the reply's `~ place` line).
// Covered: the order (after every story line, on the final scene, before the reader's clicks), stored on
// the reply as a system step; not run for an empty capture, a click or a system step; Re-read runs it
// again on the new lines at the same seed; a Continue runs it again and pays once; swipe, delete and a
// middle delete take it back; rebuild equals live; a hook that fails is a Problem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const TOWN = '~ place Guild Office | kind: settlement';
const WILD = '~ place Sluice Tunnels | kind: wild';

// `calls`: what the hook was handed each time ({ index, type, kind: the place kind it saw, pending }).
function ledger({ calls = [], fails = false } = {}) {
    return {
        id: 'ledger-test', name: 'Ledger test', version: '0.0.0',
        // Counts (SPEC §2.2), so a later reply's change replays on its own after a middle delete.
        domains: { ledger: { initial: () => ({ pending: 0, paid: 0, refused: 0, rolls: {} }), validate: () => [], counters: ['pending', 'paid', 'refused'] } },
        commands: {
            'ledger.settle'(ctx) {
                if (ctx.cause === 'ui') ctx.fail('REFUSED', 'Settled by the story, not by a click.');
                const book = ctx.draft('ledger');
                if (!book.pending) ctx.fail('REFUSED', 'Nothing is owed.');
                const kind = ctx.read('scene')?.place?.kind ?? '';
                const owed = book.pending;
                book.pending = 0;
                if (kind === 'settlement') book.paid += owed;
                else book.refused += owed;
                // A draw from the step's seed, keyed by its reply: a Re-read must draw the same.
                book.rolls[ctx.reply?.sid ?? 'none'] = Math.floor(ctx.rng() * 1e6);
                return { summary: kind === 'settlement' ? `Paid ${owed}.` : `Refused ${owed}: not in a settlement.`, narrate: true, replan: true };
            },
        },
        hooks: {
            afterCapture(view, info) {
                if (fails) throw new Error('the ledger is torn');
                const book = view.state.domains.ledger;
                calls.push({ ...info, kind: view.state.domains.scene?.place?.kind ?? '', pending: book.pending, reply: view.query('ledger.reply') });
                return book.pending ? { commands: [{ type: 'ledger.settle', payload: {} }] } : undefined;
            },
        },
        queries: { 'ledger.reply': (_state, _args, tools) => tools.reply?.index ?? null },
        capture: {
            kinds: { owe: { grammar: '! owe <n>' } },
            apply(ctx, line) {
                const book = ctx.draft('ledger');
                book.pending += Number(String(line.name).replace('+', '')) || 0;
                return { summary: `Owes ${book.pending}.`, narrate: false };
            },
        },
    };
}

async function fresh(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const calls = [];
    const host = await createHost({ modules: [ledger({ calls, ...options })] });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return { host, calls };
}

const book = host => { const { pending, paid, refused } = host.head().domains.ledger; return { pending, paid, refused }; };
const recordOf = (host, index) => host.ctx.chat[index].extra.storySuite;
const stepsOn = (host, index) => recordOf(host, index).receipts.filter(receipt => receipt.afterCapture === true);

function sameRebuilt(host) {
    const head = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), head, 'rebuilt from what is stored, the same state');
}

test('afterCapture runs once after the reply\'s last story line, on the scene it ended up in, as part of that reply', async t => {
    const { host, calls } = await fresh(t);
    const turns = [];
    host.events.on('turn', done => turns.push(done));
    await host.send('Back to town.', reply('You owe the guild, and walk in.', ['! owe 5', TOWN, '+ item Rope']));
    const index = host.ctx.chat.length - 1;
    assert.deepEqual(book(host), { pending: 0, paid: 5, refused: 0 }, 'paid in that reply: the place line came after the debt');
    assert.deepEqual(calls, [{ index, type: 'normal', kind: 'settlement', pending: 5, reply: index }], 'once, after every line');
    const record = recordOf(host, index);
    assert.deepEqual(record.receipts.map(receipt => [receipt.cause, receipt.type]),
        [['story', 'capture.owe'], ['story', 'capture.place'], ['story', 'capture.item'], ['system', 'ledger.settle']]);
    const [step] = stepsOn(host, index);
    assert.equal(step.afterCapture, true);
    assert.deepEqual(step.replan, { payload: {} }, 'kept like a replan system step');
    assert.deepEqual(record.spans.map(span => span.story), [true, true, true, false]);
    assert.deepEqual(turns.at(-1).steps.map(receipt => receipt.type), ['ledger.settle']);
    // Told to the next reply like any narrated receipt of this one.
    await host.send('Thanks.', 'The clerk nods.');
    assert.deepEqual(book(host), { pending: 0, paid: 5, refused: 0 });
    sameRebuilt(host);
});

test('afterCapture: the reply ends away from a settlement, the step refuses at once', async t => {
    const { host } = await fresh(t);
    await host.send('Off.', reply('You leave town owing.', [TOWN, '! owe 4', WILD]));
    assert.deepEqual(book(host), { pending: 0, paid: 0, refused: 4 });
    sameRebuilt(host);
});

test('afterCapture is not run for an empty capture, a capture with no line kept, a click or a system step', async t => {
    const { host, calls } = await fresh(t);
    await host.send('Hm.', 'Nothing happens.');
    await host.send('Hm?', reply('Still nothing.', ['! nosuch thing']));
    assert.equal(calls.length, 0, 'no story line kept');
    const index = host.ctx.chat.length - 1;
    assert.equal((await host.sdk.command('scene.place', { name: 'Riverbank' })).ok, true);
    assert.equal(calls.length, 0, 'a click');
    assert.equal(stepsOn(host, index).length, 0);
    // A step is not run from a click either (it is the story's).
    assert.equal((await host.sdk.command('ledger.settle', {})).ok, false);
    // Its own step does not set it off again: one call for the reply that writes a line.
    await host.send('Pay up.', reply('You owe.', ['! owe 2']));
    assert.equal(calls.length, 1);
});

test('afterCapture: Re-read runs it again on the new lines at the same seed; one that is no longer needed goes', async t => {
    const { host, calls } = await fresh(t);
    await host.send('Back to town.', reply('You owe the guild.', ['! owe 5', TOWN]));
    const index = host.ctx.chat.length - 1;
    // The reader's click after the reply stays after the step.
    assert.equal((await host.sdk.command('scene.place', { name: 'Guild Yard' })).ok, true);
    const live = structuredClone(host.head());
    const [before] = stepsOn(host, index);

    // The same text read again: the same state, the step at its seed.
    const again = await host.sdk.reread(index);
    assert.equal(again.ok, true, again.message);
    assert.deepEqual(again.steps.map(receipt => receipt.type), ['ledger.settle']);
    assert.deepEqual(host.head().domains, live.domains, 'Re-read gives what the live capture gave');
    assert.equal(stepsOn(host, index)[0].seed, before.seed);
    assert.equal(calls.at(-1).type, 'reread');
    assert.equal(calls.at(-1).reply, index);
    assert.deepEqual(recordOf(host, index).receipts.map(receipt => receipt.cause), ['story', 'story', 'system', 'ui']);
    sameRebuilt(host);

    // Edited to end in the wild: refused now, at the same seed.
    await host.st.editMessage(index, reply('You owe the guild, and leave.', ['! owe 5', WILD]));
    assert.equal((await host.sdk.reread(index)).ok, true);
    assert.deepEqual(book(host), { pending: 0, paid: 0, refused: 5 });
    assert.equal(stepsOn(host, index).length, 1);
    assert.equal(host.head().domains.ledger.rolls[recordOf(host, index).sid], live.domains.ledger.rolls[recordOf(host, index).sid]);
    sameRebuilt(host);

    // Edited to owe nothing: the hook asks for no step, and the old one goes.
    await host.st.editMessage(index, reply('You owe nothing.', [TOWN]));
    assert.equal((await host.sdk.reread(index)).ok, true);
    assert.deepEqual(book(host), { pending: 0, paid: 0, refused: 0 });
    assert.equal(stepsOn(host, index).length, 0);
    sameRebuilt(host);

    // And back to owing: a reply that had no step gets one.
    await host.st.editMessage(index, reply('You owe after all.', ['! owe 3', TOWN]));
    assert.equal((await host.sdk.reread(index)).ok, true);
    assert.deepEqual(book(host), { pending: 0, paid: 3, refused: 0 });
    assert.equal(stepsOn(host, index).length, 1);
    sameRebuilt(host);
});

test('afterCapture: Re-read of a reply in the middle: the step reads that reply, and later replies stay', async t => {
    const { host, calls } = await fresh(t);
    await host.send('Back to town.', reply('You owe the guild.', ['! owe 5', TOWN]));
    const index = host.ctx.chat.length - 1;
    await host.send('Next.', reply('More debt.', ['! owe 2']));
    assert.deepEqual(book(host), { pending: 0, paid: 7, refused: 0 });
    const live = structuredClone(host.head());
    assert.equal((await host.sdk.reread(index)).ok, true);
    assert.equal(calls.at(-1).reply, index, 'ctx.reply / tools.reply is the reply read again, not the head');
    assert.deepEqual(host.head().domains, live.domains);
    sameRebuilt(host);
});

test('afterCapture: a Continue runs it again after its own lines and pays once; Re-read of the whole reply too', async t => {
    const { host, calls } = await fresh(t);
    await host.send('Back to town.', reply('You owe the guild.', ['! owe 5', TOWN]));
    const index = host.ctx.chat.length - 1;
    assert.deepEqual(book(host), { pending: 0, paid: 5, refused: 0 });
    // A Continue with a story line but no new debt: run again, nothing to settle, nothing paid again.
    await host.cont(' You linger.\n<Changes>\n+ item Rope\n</Changes>');
    assert.deepEqual(calls.map(call => call.type), ['normal', 'continue']);
    assert.deepEqual(book(host), { pending: 0, paid: 5, refused: 0 }, 'paid once');
    assert.equal(stepsOn(host, index).length, 1);
    // A Continue that owes more settles that, after its own lines.
    await host.cont(' And more.\n<Changes>\n! owe 3\n</Changes>');
    assert.deepEqual(book(host), { pending: 0, paid: 8, refused: 0 });
    assert.equal(stepsOn(host, index).length, 2);
    sameRebuilt(host);
    // Re-read reads the whole reply: its steps run again once, after all its lines.
    assert.equal((await host.sdk.reread(index)).ok, true);
    assert.deepEqual(book(host), { pending: 0, paid: 8, refused: 0 });
    assert.equal(stepsOn(host, index).length, 1);
    sameRebuilt(host);
});

test('afterCapture: swipe, delete and a middle delete take the step back with its reply', async t => {
    const { host } = await fresh(t);
    await host.send('Back to town.', reply('You owe the guild.', ['! owe 5', TOWN]));
    assert.deepEqual(book(host), { pending: 0, paid: 5, refused: 0 });
    await host.swipe('You owe nothing today.');
    assert.deepEqual(book(host), { pending: 0, paid: 0, refused: 0 }, 'the swipe has no step');
    await host.swipe(reply('You owe and leave.', ['! owe 2', WILD]));
    assert.deepEqual(book(host), { pending: 0, paid: 0, refused: 2 });
    await host.st.swipeTo(host.ctx.chat.length - 1, 0);
    assert.deepEqual(book(host), { pending: 0, paid: 5, refused: 0 }, 'back on the first swipe, its step with it');
    sameRebuilt(host);

    await host.send('Next.', reply('More debt in town.', ['! owe 1']));
    assert.deepEqual(book(host), { pending: 0, paid: 6, refused: 0 });
    // A middle delete: the first debt's reply goes, its step with it; the later one still replays.
    const first = host.ctx.chat.findIndex(message => /You owe the guild/.test(String(message?.mes ?? '')));
    await host.st.deleteMessage(first);
    assert.deepEqual(book(host), { pending: 0, paid: 1, refused: 0 });
    sameRebuilt(host);
    // The last reply deleted: its step goes too.
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.deepEqual(book(host), { pending: 0, paid: 0, refused: 0 });
    sameRebuilt(host);
});

test('afterCapture: a hook that fails is a Problem and the reply\'s lines are kept', async t => {
    const { host } = await fresh(t, { fails: true });
    const turns = [];
    host.events.on('turn', done => turns.push(done));
    await host.send('Back to town.', reply('You owe the guild.', ['! owe 5', TOWN]));
    assert.deepEqual(book(host), { pending: 5, paid: 0, refused: 0 });
    assert.ok(turns.at(-1).problems.some(item => item.code === 'FAILED' && /afterCapture failed: the ledger is torn/.test(item.message)));
});
