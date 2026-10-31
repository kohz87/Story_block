// Counts that move on replay (B3-8): a domain's `counters` (the inventory's wallets/*/coin and
// stacks/*/qty) are stored with the value they replaced (`was`), so a replay after a deleted middle
// reply adds each later change to what is there instead of writing the old totals back. Each test fails
// on the code before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { counterInside, isCounterPath, rebaseOps } from '../../src/v2/ops.js';
import { createRegistry } from '../../src/v2/registry.js';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ coin 10']));
    return host;
}

test('isCounterPath and rebaseOps: a count that stands elsewhere takes the change, not the number', () => {
    const patterns = ['wallets/*/coin', 'stacks/*/qty'];
    assert.equal(isCounterPath('/domains/inventory/wallets/party/coin', patterns), true);
    assert.equal(isCounterPath('/domains/inventory/stacks/it_aaaaaaaa/qty', patterns), true);
    assert.equal(isCounterPath('/domains/inventory/stacks/it_aaaaaaaa/note', patterns), false);
    assert.equal(isCounterPath('/meta/rev', patterns), false);
    const state = { domains: { inventory: { wallets: { party: { coin: 44 } } } } };
    const ops = [{ op: 'replace', path: '/domains/inventory/wallets/party/coin', value: 75, was: 74 }, { op: 'replace', path: '/meta/rev', value: 9 }];
    const { ops: moved, rebased } = rebaseOps(state, ops);
    assert.deepEqual(moved[0], { op: 'replace', path: '/domains/inventory/wallets/party/coin', value: 45, was: 44 });
    assert.equal(moved[1], ops[1]);
    assert.deepEqual([...rebased], ['inventory']);
    assert.equal(ops[0].value, 75, 'the stored op is left as it was');
    const same = rebaseOps({ domains: { inventory: { wallets: { party: { coin: 74 } } } } }, ops);
    assert.equal(same.ops[0], ops[0], 'standing where it was: applied as written');
    assert.equal(same.rebased.size, 0);
});

test('the bus stores was on counter ops only', async t => {
    const host = await fresh(t);
    await host.send('Buy.', reply('Rope.', ['+ item Rope | qty: 2', '+ coin 5']));
    const ops = host.store.opsAt(host.ctx.chat.length - 1);
    const coinOp = ops.find(op => op.path === '/domains/inventory/wallets/party/coin');
    assert.deepEqual({ value: coinOp.value, was: coinOp.was }, { value: 15, was: 10 });
    await host.send('More rope.', reply('Rope.', ['+ item Rope | qty: 3 | note: x', '+ item Rope']));
    const qtyOps = host.store.opsAt(host.ctx.chat.length - 1).filter(op => op.path.endsWith('/qty'));
    assert.deepEqual(qtyOps.map(op => [op.value, op.was]), [[3, 2]]);
    assert.ok(host.store.opsAt(host.ctx.chat.length - 1).filter(op => op.path === '/meta/rev').every(op => !('was' in op)));
});

test('deleting a middle reply takes back its own change to a count and keeps the later ones', async t => {
    const host = await fresh(t);
    await host.send('Rope.', reply('Rope.', ['+ item Rope | qty: 5']));
    await host.send('Sell.', reply('Sold.', ['- item Rope | qty: 2', '+ coin 30 | from: the chandler']));
    const sale = host.ctx.chat.length - 1;
    await host.send('On.', reply('Found.', ['+ coin 1', '- item Rope']));
    assert.deepEqual({ coin: coin(host), rope: qty(host, 'Rope') }, { coin: 41, rope: 2 });
    await host.st.deleteMessage(sale);
    await host.st.deleteMessage(sale - 1);
    assert.deepEqual({ coin: coin(host), rope: qty(host, 'Rope') }, { coin: 11, rope: 4 });
    assert.deepEqual(host.store.problems(), []);
    // A cold rebuild from the chat says the same.
    const live = host.head();
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
});

test('a moved count the domain refuses (money below zero) skips that block, with a problem', async t => {
    const host = await fresh(t);
    await host.send('Paid.', reply('A purse.', ['+ coin 50']));
    const income = host.ctx.chat.length - 1;
    await host.send('Spend.', reply('Spent.', ['- coin 55 | to: the smith']));
    await host.send('Later.', reply('A tip.', ['+ coin 2']));
    assert.equal(coin(host), 7);
    await host.st.deleteMessage(income);
    await host.st.deleteMessage(income - 1);
    // 10 − 55 would be below zero: that payment no longer applies; the later tip still does.
    assert.equal(coin(host), 12);
    const [problem] = host.store.problems();
    assert.match(problem.message, /no longer fit/);
});

test('ops stored without was (older records) apply as written', async t => {
    const host = await fresh(t);
    await host.send('Gold.', reply('Gold.', ['+ coin 5']));
    const middle = host.ctx.chat.length - 1;
    await host.send('More.', reply('Gold.', ['+ coin 1']));
    // Strip `was` as an older Story Block wrote them.
    for (const message of host.ctx.chat) {
        const record = message.extra?.storySuite;
        if (!record) continue;
        for (const op of record.ops) delete op.was;
        const info = message.swipe_info?.[message.swipe_id ?? 0];
        if (info?.extra?.storySuite && info.extra !== message.extra) info.extra.storySuite = structuredClone(record);
    }
    await host.st.deleteMessage(middle);
    await host.st.deleteMessage(middle - 1);
    assert.equal(coin(host), 16, 'the absolute total comes back, as before');
});

// A stack a later reply emptied is stored as a `remove`; it keeps how much it held (`was`, `count`), so
// after a middle delete the take moves too (SB-fix4).
test('counterInside and rebaseOps: an emptied stack that now holds more keeps the rest', () => {
    const patterns = ['wallets/*/coin', 'stacks/*/qty'];
    assert.equal(counterInside('/domains/inventory/stacks/it_aaaaaaaa', patterns), '/qty');
    assert.equal(counterInside('/domains/inventory/stacks', patterns), null, 'a * is left: not one counter');
    assert.equal(counterInside('/domains/inventory/stacks/it_aaaaaaaa/qty', patterns), null);
    assert.equal(counterInside('/domains/inventory/defs/x', patterns), null);
    const path = '/domains/inventory/stacks/it_aaaaaaaa';
    const op = { op: 'remove', path, was: 3, count: '/qty' };
    const at = n => ({ domains: { inventory: { stacks: { it_aaaaaaaa: { qty: n } } } } });
    const more = rebaseOps(at(5), [op]);
    assert.deepEqual(more.ops[0], { op: 'replace', path: `${path}/qty`, value: 2, was: 5 });
    assert.deepEqual([...more.rebased], ['inventory']);
    assert.equal(rebaseOps(at(3), [op]).ops[0], op, 'holding just what it held: removed as written');
    assert.equal(rebaseOps(at(3), [op]).rebased.size, 0);
    assert.equal(rebaseOps(at(1), [op]).ops[0].value, -2, 'less than it held: below zero, for the validator to refuse');
    assert.equal(rebaseOps({ domains: { inventory: { stacks: {} } } }, [op]).ops[0], op, 'gone already: as written');
    assert.equal(rebaseOps(at(5), [{ op: 'remove', path }]).ops[0].op, 'remove', 'without was: as written');
});

test('the bus stores was and count on the remove of an emptied stack', async t => {
    const host = await fresh(t);
    await host.send('Rope.', reply('Rope.', ['+ item Rope | qty: 3']));
    await host.send('Lost.', reply('Lost.', ['- item Rope | qty: 3']));
    const removed = host.store.opsAt(host.ctx.chat.length - 1).filter(op => op.op === 'remove');
    assert.equal(removed.length, 1);
    assert.match(removed[0].path, /^\/domains\/inventory\/stacks\/it_/);
    assert.deepEqual({ was: removed[0].was, count: removed[0].count }, { was: 3, count: '/qty' });
});

test('deleting a middle reply that took from a stack a later reply emptied keeps what it took', async t => {
    const host = await fresh(t);
    await host.send('Rope.', reply('Rope.', ['+ item Rope | qty: 5']));
    await host.send('Some breaks.', reply('Two break.', ['- item Rope | qty: 2']));
    const middle = host.ctx.chat.length - 1;
    await host.send('The rest.', reply('The rest is lost.', ['- item Rope | qty: 3', '+ coin 4']));
    assert.equal(qty(host, 'Rope'), 0);
    await host.st.deleteMessage(middle);
    await host.st.deleteMessage(middle - 1);
    assert.deepEqual({ rope: qty(host, 'Rope'), coin: coin(host) }, { rope: 2, coin: 14 }, 'the later reply took its 3 of 5');
    assert.deepEqual(host.store.problems(), []);
    const live = host.head();
    host.store.rebuild();
    assert.deepEqual(host.head(), live, 'a cold rebuild says the same');
});

test('deleting the reply that added to a stack a later reply emptied: that take no longer fits and is skipped', async t => {
    const host = await fresh(t);
    await host.send('Rope.', reply('Rope.', ['+ item Rope | qty: 2']));
    await host.send('More rope.', reply('Three more.', ['+ item Rope | qty: 3']));
    const middle = host.ctx.chat.length - 1;
    await host.send('Sell.', reply('All sold.', ['- item Rope | qty: 5']));
    assert.equal(qty(host, 'Rope'), 0);
    await host.st.deleteMessage(middle);
    await host.st.deleteMessage(middle - 1);
    // 5 cannot come off 2, as a take of more than is held is refused live: the 2 stay, and it is told.
    assert.equal(qty(host, 'Rope'), 2);
    assert.match(host.store.problems()[0]?.message ?? '', /no longer fit/);
});

test('a domain\'s counters must be paths inside it', () => {
    const registry = createRegistry();
    assert.throws(() => registry.register({ id: 'bad', domains: { bad: { initial: () => ({}), counters: ['/abs'] } } }), /counters must be a list of paths/);
    registry.register({ id: 'good', domains: { good: { initial: () => ({}), counters: ['pool/*/n'] } } });
    assert.deepEqual(registry.counters('good'), ['pool/*/n']);
    assert.deepEqual(registry.counters('nobody'), []);
});

// ---- a count set rather than moved (ctx.absolute, SPEC §2.2) ---------------------------------------

// A clock like Story Director's: `! tick 5` moves it on, `~ tick 100` sets it (ctx.absolute).
const clockModule = () => ({
    id: 'clock',
    name: 'Clock',
    domains: { clock: { initial: () => ({ minutes: 0 }), counters: ['minutes'] } },
    capture: {
        kinds: { tick: { grammar: '! tick <n> moves it on; ~ tick <n> sets it' } },
        apply(ctx, line) {
            const clock = ctx.draft('clock');
            const n = Number(line.name);
            if (line.op === '~') {
                ctx.absolute('clock', '/minutes');
                clock.minutes = n;
            } else clock.minutes += n;
            return { summary: `Clock ${clock.minutes}.`, narrate: false };
        },
    },
});
const clockOf = host => host.head().domains.clock.minutes;

async function clockHost(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [clockModule()] });
    t.after(() => host.close());
    await host.send('Hello.', reply('Start.', ['~ tick 100']));
    return host;
}

test('ctx.absolute: a set keeps no was and is written even when the count holds that number', async t => {
    const host = await clockHost(t);
    const last = () => host.store.opsAt(host.ctx.chat.length - 1).filter(op => op.path === '/domains/clock/minutes');
    await host.send('On.', reply('Later.', ['! tick 5']));
    assert.deepEqual(last().map(op => [op.value, op.was]), [[105, 100]], 'a move keeps was');
    await host.send('Set.', reply('Set.', ['~ tick 200']));
    assert.deepEqual(last(), [{ op: 'replace', path: '/domains/clock/minutes', value: 200 }], 'a set: no was');
    await host.send('Again.', reply('Same.', ['~ tick 200']));
    assert.deepEqual(last(), [{ op: 'replace', path: '/domains/clock/minutes', value: 200 }], 'the same number is still written');
});

test('ctx.absolute: after an earlier middle delete a set stays exact and later moves add on top', async t => {
    const host = await clockHost(t);
    await host.send('A.', reply('A.', ['! tick 7']));
    const a = host.ctx.chat.length - 1;
    await host.send('B.', reply('B.', ['~ tick 500']));
    await host.send('C.', reply('C.', ['! tick 3']));
    assert.equal(clockOf(host), 503);
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.equal(clockOf(host), 503, 'the set is a set: the deleted +7 before it changes nothing after it');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
    // Deleting the set itself: the later move adds on top of what is left.
    const b = host.ctx.chat.length - 3;
    await host.st.deleteMessage(b);
    await host.st.deleteMessage(b - 1);
    assert.equal(clockOf(host), 103);
});

test('ctx.absolute is the domain owner\'s and takes a path inside the domain', async t => {
    t.mock.method(console, 'warn', () => {});
    const other = {
        id: 'other',
        commands: {
            'other.poke': ctx => { ctx.absolute('clock', '/minutes'); return {}; },
            'other.bad': ctx => { ctx.absolute('other', 'minutes'); return {}; },
        },
        domains: { other: { initial: () => ({}) } },
    };
    const host = await createHost({ modules: [clockModule(), other] });
    t.after(() => host.close());
    await host.send('Hello.', 'Start.');
    assert.equal((await host.sdk.command('other.poke', {})).code, 'NOT_OWNER');
    assert.equal((await host.sdk.command('other.bad', {})).code, 'INVALID');
});

// ---- writes inside a thing that may be gone (ctx.ifThere, SPEC §2.2 rule d) -----------------------

// Notes made by `+ note Name`; `! close Name` (a later reply, or time) closes it and stamps the log
// in the same block, marking the note's writes with ctx.ifThere.
const notesModule = () => ({
    id: 'notes',
    name: 'Notes',
    domains: { notes: { initial: () => ({ items: {}, closedCount: 0, log: {} }), counters: ['closedCount'] } },
    capture: {
        kinds: { note: { grammar: '+ note Name makes it; ! note Name closes it' } },
        apply(ctx, line) {
            const notes = ctx.draft('notes');
            const id = `n_${line.name.toLowerCase()}`;
            if (line.op === '+') notes.items[id] = { name: line.name, open: true };
            else {
                ctx.ifThere('notes', `/items/${id}`);
                if (notes.items[id]) notes.items[id].open = false;
                notes.closedCount += 1;
                notes.log[ctx.receiptId] = line.name;
            }
            return { summary: 'ok', narrate: false };
        },
    },
});

test('ctx.ifThere: writes inside a gone thing are passed over on replay; the rest of the block applies', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [notesModule()] });
    t.after(() => host.close());
    await host.send('Hello.', reply('Start.', ['+ note Base']));
    await host.send('A.', reply('A.', ['+ note Rats']));
    const a = host.ctx.chat.length - 1;
    await host.send('B.', reply('B.', ['! note Rats', '! note Base']));
    const ops = host.store.opsAt(host.ctx.chat.length - 1);
    assert.deepEqual(ops.filter(op => op.within).map(op => [op.path, op.within]), [
        ['/domains/notes/items/n_rats/open', '/domains/notes/items/n_rats'],
        ['/domains/notes/items/n_base/open', '/domains/notes/items/n_base'],
    ]);
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), [], 'no block is skipped');
    const notes = host.head().domains.notes;
    assert.deepEqual(notes.items, { n_base: { name: 'Base', open: false } }, 'no ghost of the gone note');
    assert.equal(notes.closedCount, 2, 'the rest of the block applied');
    assert.equal(Object.keys(notes.log).length, 2);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
});

test('rebaseOps rule d: only on replay, only inside the marked thing, never the add that makes it', () => {
    const state = { domains: { notes: { items: {}, n: 1 } } };
    const within = '/domains/notes/items/n_x';
    const ops = [
        { op: 'replace', path: `${within}/open`, value: false, within },
        { op: 'replace', path: '/domains/notes/n', value: 2 },
    ];
    assert.deepEqual(rebaseOps(state, ops, { replayed: true }).ops, [ops[1]]);
    assert.deepEqual(rebaseOps(state, ops).ops, ops, 'a live command is never fitted');
    const made = [{ op: 'add', path: within, value: { open: true }, within }, { op: 'replace', path: `${within}/open`, value: false, within }];
    assert.deepEqual(rebaseOps(state, made, { replayed: true }).ops, made, 'made in the block: kept');
    const there = { domains: { notes: { items: { n_x: { open: true } }, n: 1 } } };
    assert.deepEqual(rebaseOps(there, ops, { replayed: true }).ops, ops, 'there: as written');
});

// ---- a set's append (ctx.unique, SPEC §2.2 rule e): `+ present` after the reply that dropped them is deleted ---

test('ctx.unique: a later `+ present` of someone still present is passed over on replay; the rest of its block applies', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('1', reply('Text.', ['~ place Inn | kind: town', '+ present Fenna']));
    await host.send('2', reply('Text.', ['~ place Ridge Fort | kind: town']));
    await host.send('3', reply('Text.', ['+ present Fenna', '+ item Rope | qty: 1']));
    const third = host.ctx.chat.length - 1;
    const ops = host.store.opsAt(third);
    assert.deepEqual(ops.filter(op => op.unique).map(op => [op.op, op.path, op.value]), [['add', '/domains/scene/present/-', 'Fenna']]);
    assert.deepEqual(host.head().domains.scene.present, ['Fenna']);
    const user = host.ctx.chat.findIndex((m, i) => m.is_user && /^2$/.test(m.mes));
    await host.st.deleteMessage(user + 1);
    await host.st.deleteMessage(user);
    assert.deepEqual(host.store.problems(), [], 'no block is skipped');
    assert.deepEqual(host.head().domains.scene.present, ['Fenna'], 'Fenna is present once');
    assert.equal(host.sdk.query('inventory.items').filter(item => item.name === 'Rope').length, 1, 'the rest of the block applied');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
    const image = { chat: JSON.parse(JSON.stringify(host.ctx.chat)), metadata: JSON.parse(JSON.stringify(host.ctx.chatMetadata)) };
    const again = await createHost({ st: { chat: image.chat } });
    t.after(() => again.close());
    again.ctx.chatMetadata = image.metadata;
    await again.turn.onChatChanged();
    assert.equal(JSON.stringify(again.head()), live, 'reload == live');
    assert.deepEqual(again.store.problems(), []);
});

test('rebaseOps rule e: only on replay, only a marked append of an item the list holds; unmarked ops stay as written', () => {
    const state = { domains: { scene: { present: ['Fenna'] } } };
    const add = (value, extra = {}) => ({ op: 'add', path: '/domains/scene/present/-', value, ...extra });
    assert.deepEqual(rebaseOps(state, [add('fenna', { unique: true })], { replayed: true }).ops, [], 'held (any case): passed over');
    assert.deepEqual(rebaseOps(state, [add('Wessel', { unique: true })], { replayed: true }).ops, [add('Wessel', { unique: true })], 'not held: kept');
    assert.deepEqual(rebaseOps(state, [add('Fenna', { unique: true })]).ops, [add('Fenna', { unique: true })], 'a live command is never fitted');
    const other = { domains: { notes: { tags: ['Fenna'] } } };
    const tag = { op: 'add', path: '/domains/notes/tags/-', value: 'Fenna' };
    assert.deepEqual(rebaseOps(other, [tag], { replayed: true }).ops, [tag], 'an op stored without the mark replays as written');
    const wrote = [{ op: 'replace', path: '/domains/scene/present', value: ['Fenna'] }, add('Fenna', { unique: true })];
    assert.deepEqual(rebaseOps(state, wrote, { replayed: true }).ops, wrote, 'the list written earlier in the block: as written');
});

// ---- 2.11.2: the other writers of who is present mark their appends too, and ops stored before the mark replay safely ---

const afterMiddleDelete = async (t, replies, between) => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    for (const [number, lines] of replies) await host.send(number, reply('Text.', lines));
    if (between) await between(host);
    const user = host.ctx.chat.findIndex((m, i) => m.is_user && /^2$/.test(m.mes));
    await host.st.deleteMessage(user + 1);
    await host.st.deleteMessage(user);
    return host;
};
const sameAfterReload = async (t, host) => {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
    const image = { chat: JSON.parse(JSON.stringify(host.ctx.chat)), metadata: JSON.parse(JSON.stringify(host.ctx.chatMetadata)) };
    const again = await createHost({ st: { chat: image.chat } });
    t.after(() => again.close());
    again.ctx.chatMetadata = image.metadata;
    await again.turn.onChatChanged();
    assert.equal(JSON.stringify(again.head()), live, 'reload == live');
    assert.deepEqual(again.store.problems(), []);
};

test('`~ place X | with: Name` after the reply that took Name out is deleted: Name once, the place moves, the rest of the block applies', async t => {
    const host = await afterMiddleDelete(t, [
        ['1', ['~ place Inn | kind: town', '+ present Fenna']],
        ['2', ['- present Fenna']],
        ['3', ['~ place Road | kind: wild | with: Fenna', '+ item Rope | qty: 1']],
    ]);
    const ops = host.store.opsAt(host.ctx.chat.length - 1);
    assert.deepEqual(ops.filter(op => op.unique).map(op => [op.op, op.path, op.value]), [['add', '/domains/scene/present/-', 'Fenna']], 'the append is stored marked');
    assert.deepEqual(host.store.problems(), [], 'no block is skipped');
    assert.equal(host.head().domains.scene.place.name, 'Road');
    assert.deepEqual(host.head().domains.scene.present, ['Fenna']);
    assert.equal(host.sdk.query('inventory.items').filter(item => item.name === 'Rope').length, 1, 'the rest of the block applied');
    await sameAfterReload(t, host);
});

test('the reader\'s set of who is present after the reply that took one out is deleted: each name once, nothing skipped', async t => {
    const host = await afterMiddleDelete(t, [
        ['1', ['~ place Inn | kind: town', '+ present Fenna']],
        ['2', ['- present Fenna']],
        ['3', ['+ item Rope | qty: 1']],
    ], async h => {
        assert.equal((await h.sdk.command('scene.present', { set: ['Fenna', 'Bob'] })).ok, true);
        assert.deepEqual(h.head().domains.scene.present, ['Fenna', 'Bob']);
    });
    assert.ok(host.store.opsAt(host.ctx.chat.length - 1).some(op => op.unique && op.path === '/domains/scene/present/-'), 'the pencil\'s appends are stored marked');
    assert.deepEqual(host.store.problems(), [], 'no block is skipped');
    assert.deepEqual(host.head().domains.scene.present, ['Fenna', 'Bob'], 'what a live replay of the remaining replies gives');
    await sameAfterReload(t, host);
});

test('rebaseOps rule e for ops stored before the mark: an append to the scene\'s present list that it holds is passed over', () => {
    const state = { domains: { scene: { present: ['Fenna'] } } };
    const add = (value, extra = {}) => ({ op: 'add', path: '/domains/scene/present/-', value, ...extra });
    assert.deepEqual(rebaseOps(state, [add('fenna')], { replayed: true }).ops, [], 'held (any case), no mark: passed over');
    assert.deepEqual(rebaseOps(state, [add('Bob')], { replayed: true }).ops, [add('Bob')], 'not held: kept');
    assert.deepEqual(rebaseOps(state, [add('Fenna')]).ops, [add('Fenna')], 'a live command is never fitted');
    const wrote = [{ op: 'replace', path: '/domains/scene/present', value: ['Fenna'] }, add('Fenna')];
    assert.deepEqual(rebaseOps(state, wrote, { replayed: true }).ops, wrote, 'the list written earlier in the block: as written');
});
