// The fourth review of the replay core (docs/v2/REPLAY.md): trust covers everything replay reads (one input function),
// guards are asked in a context that depends on the prefix alone, and quarantine is decided on the record as stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPLAY_BOOKKEEPING, replayInputsOf } from '../../src/v2/replay.js';
import { EPOCH, OWNER, Q1, guarded, harness } from './helpers/guarded.js';

const SMALL = { checkpointEvery: 3, checkpointBytes: 1 << 30 };
const clone = value => JSON.parse(JSON.stringify(value));
const cpOf = h => h.chat.map((message, i) => (message.extra?.storySuite?.checkpoint ? i : -1)).filter(i => i >= 0);
const edit = (h, at, change) => { const record = clone(h.chat[at].extra.storySuite); change(record); h.chat[at].extra.storySuite = record; };

// The head of the chat as a replay from its first record gives it.
function fullReplay(h, modules = [guarded()]) {
    const fresh = harness(modules, { checkpointEvery: 100000, checkpointBytes: 1 << 30 });
    const copy = clone(h.chat);
    copy.forEach((message, i) => {
        const record = message.extra?.storySuite;
        if (i && record) { delete record.checkpoint; delete record.covers; delete record.coverHash; delete record.prefix; delete record.carried; }
    });
    fresh.chat.splice(0, fresh.chat.length, ...copy);
    fresh.store.rebuild();
    return fresh;
}
const same = h => assert.equal(JSON.stringify(h.store.head()), JSON.stringify(fullReplay(h).store.head()), 'the head is what a full replay gives');
const key = list => list.map(problem => [problem.index, problem.block, problem.code]);

// A chat whose first reply holds a guarded quick, with checkpoints after it.
function paid(n = 7) {
    const h = harness([guarded()], SMALL);
    const at = [];
    for (let k = 1; k <= n; k++) {
        at.push(h.send(`u${k}`, `r${k}`));
        if (k === 1) assert.equal(h.command('gt.quick', { id: Q1 }).ok, true);
        else h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    }
    assert.ok(cpOf(h).length > 1);
    return { h, at };
}

for (const [label, change] of [
    ['the guard a receipt kept', record => { record.receipts[0].data.v2.guard.epoch = 'ep_00000002'; }],
    ['the source identity: logical', record => { record.source.logical = 'sr_aaaaaaaa'; }],
    ['the source identity: evidence', record => { record.source.evidence = 'ev_aaaaaaaa'; }],
    ['the source identity: swipe key', record => { record.source.swipeKey = 'sw_aaaaaaaa'; }],
]) {
    test(`trust covers ${label}: a checkpoint after a record edited there is not trusted, and repairing it gives the Problems back`, () => {
        const { h, at } = paid();
        assert.equal(h.gt().coin, 1);
        const original = clone(h.chat[at[0]].extra.storySuite);
        edit(h, at[0], change);
        h.store.rebuild();
        assert.equal(h.gt().coin, 0, 'the block is off (what a full replay says), not carried over from a checkpoint');
        same(h);
        assert.ok(h.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
        // The chat goes on while it is off: a checkpoint made now carries the Problem.
        for (let k = 8; k <= 12; k++) { h.send(`u${k}`, `r${k}`); h.command('gt.hit', { actor: 'ac_00000001', amount: 1 }); }
        assert.ok(h.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
        // It is repaired: the checkpoints made over the broken record stop matching, so no stale Problem or state stays.
        h.chat[at[0]].extra.storySuite = original;
        h.store.rebuild();
        assert.equal(h.gt().coin, 1);
        same(h);
        assert.deepEqual(key(h.problems()), key(fullReplay(h).problems()));
        assert.deepEqual(h.problems(), []);
    });
}

test('the prefix is the hash of one function: replay reads nothing from a record but what replayInputsOf lists', () => {
    const h = harness([guarded()], SMALL);
    for (let k = 1; k <= 7; k++) {
        h.send(`u${k}`, `r${k}`);
        if (k === 1) h.command('gt.quick', { id: Q1 });
        else if (k === 2) h.command('gt.attempt', { id: Q1 }, 'system');
        else h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    }
    const listed = new Set([...Object.keys(replayInputsOf(h.chat[2].extra.storySuite)), ...REPLAY_BOOKKEEPING]);
    const seen = new Set();
    const watch = (value, path) => {
        if (!value || typeof value !== 'object') return value;
        return new Proxy(value, {
            get(target, name, receiver) {
                if (typeof name === 'string' && !Array.isArray(target) && path.length <= 1) seen.add(path.concat(name).join('.'));
                const value = Reflect.get(target, name, receiver);
                return name === 'checkpoint' ? value : watch(value, Array.isArray(target) ? path : path.concat(name));
            },
        });
    };
    // The same chat read cold (a new store), every record behind a recording proxy.
    const copy = clone(h.chat);
    const cold = harness([guarded()], SMALL);
    const lastAt = copy.findLastIndex(message => message.extra?.storySuite);
    cold.chat.splice(0, cold.chat.length, ...copy.map((message, i) => {
        // (the last reply is read as it is: its copy in swipe_info is made with structuredClone, which a proxy cannot take)
        if (i !== lastAt && message.extra?.storySuite) message.extra = { ...message.extra, storySuite: watch(message.extra.storySuite, ['record']) };
        return message;
    }));
    cold.store.rebuild();
    cold.store.head();
    for (const name of [...seen].filter(each => each.startsWith('record.')).map(each => each.split('.')[1])) {
        assert.ok(listed.has(name), `replay read record.${name}, which is neither a replay input nor bookkeeping`);
    }
    assert.ok(['record.ops', 'record.spans', 'record.receipts', 'record.source'].every(name => seen.has(name)), 'the probe saw the records');
});

// ---- guards are asked in a context that depends on the prefix alone ----------------------------------------------

// A module whose guard reads what the test lets it: the suffix receipts, a query, or a setting (live, or recorded when planned).
function probe({ how, setting = { value: 'a' } }) {
    const pay = (ctx, id) => {
        const gt = ctx.draft('pr');
        gt.coin += 1;
        gt.paid[id] = true;
    };
    return {
        id: 'zz-probe', name: 'Probe', version: '0.0.1',
        domains: { pr: { initial: () => ({ coin: 0, paid: {} }), counters: ['coin'] } },
        commands: {
            'pr.pay'(ctx, { id }) {
                pay(ctx, id);
                // What the guard needs from outside is read now, while planning, and recorded.
                ctx.replayGuard({ owner: 'zz-probe', version: 2, epoch: EPOCH, rulesHash: null, inputHash: ctx.hash({ id }), predicate: { kind: 'pay', id } },
                    how === 'recorded' ? { setting: setting.value } : undefined);
                return { summary: 'paid', narrate: false };
            },
        },
        queries: {
            'pr.coin': state => state.domains.pr.coin,
            'pr.setting': () => setting.value,
            'pr.receipts': (state, args, tools) => tools.receipts().length,
        },
        replayQueries: how === 'declared' ? ['pr.coin'] : how === 'receipts' ? ['pr.receipts'] : [],
        hooks: {
            replayGuard(view, info) {
                if (how === 'receipts') return { ok: view.query('pr.receipts', {}) >= 0, reason: 'x' };
                if (how === 'declared') return { ok: view.query('pr.coin', {}) >= 0 };
                if (how === 'undeclared') return { ok: view.query('pr.setting', {}) === 'a', reason: 'setting changed' };
                if (how === 'recorded') return { ok: info.recorded.setting === 'a', reason: 'setting' };
                return { ok: true };
            },
        },
    };
}

test('a guard that asks for something outside the prefix context (a query it did not declare) fails closed: the block is not stored', () => {
    const h = harness([probe({ how: 'undeclared' })]);
    h.send();
    const result = h.command('pr.pay', { id: 'th_aaaaaaaa' });
    assert.equal(result.ok, false);
    assert.match(result.message, /not a query a guard may ask on replay/);
    assert.equal(h.store.head().domains.pr.coin, 0);
});

test('a guard may ask the queries its owner declares as depending on the state alone', () => {
    const h = harness([probe({ how: 'declared' })]);
    h.send();
    assert.equal(h.command('pr.pay', { id: 'th_aaaaaaaa' }).ok, true);
    h.store.rebuild();
    assert.equal(h.store.head().domains.pr.coin, 1);
    assert.deepEqual(h.problems(), []);
});

test('a guard does not see receipts on replay (the suffix is not part of what it was recorded over)', () => {
    const h = harness([probe({ how: 'receipts' })]);
    h.send();
    const result = h.command('pr.pay', { id: 'th_aaaaaaaa' });
    assert.equal(result.ok, false);
    assert.match(result.message, /does not see receipts/);
});

test('what a guard needs from outside (a setting) is recorded when the block is planned: changing it later changes nothing', () => {
    const setting = { value: 'a' };
    const h = harness([probe({ how: 'recorded', setting })], SMALL);
    for (let k = 0; k < 6; k++) {
        h.send(`u${k}`, `r${k}`);
        assert.equal(h.command('pr.pay', { id: `th_aaaaaaa${k}` }).ok, true);
    }
    assert.equal(h.store.head().domains.pr.coin, 6);
    assert.ok(cpOf(h).length > 1);
    setting.value = 'b';                      // the reader changes the setting; the guard answers from the record
    h.store.rebuild();
    assert.equal(h.store.head().domains.pr.coin, 6);
    assert.deepEqual(h.problems(), []);
    assert.equal(JSON.stringify(h.store.head()), JSON.stringify(fullReplay(h, [probe({ how: 'recorded', setting })]).store.head()));
});

// ---- quarantine is decided on the record as stored ------------------------------------------------------------------

test('Q: a Re-read of a record whose orphaned receipt is a story receipt is refused, not filtered into an intact hit', () => {
    const h = harness([guarded()]);
    const at = h.send('u', 'r');
    assert.equal(h.bus.command('gt.quick', { id: Q1 }, { cause: 'story' }).ok, true);
    h.command('gt.hit', { actor: 'ac_00000001', amount: 2 });
    edit(h, at, record => { record.receipts[0].rev = 99; });         // the guarded story receipt is the detached one
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    assert.equal(h.gt().lost.ac_00000001, undefined);
    const before = JSON.stringify(h.chat[at].extra.storySuite);
    assert.throws(() => h.store.replaceStory(at, { ops: [], receipts: [] }), /not read again/);
    assert.equal(JSON.stringify(h.chat[at].extra.storySuite), before, 'nothing was written');
});

test('Q: a quarantined record is never renumbered: a Re-read of an earlier reply cannot move its ops onto the rev its receipt names', () => {
    const h = harness([guarded()]);
    const first = h.send('u1', 'r1');
    h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    const later = h.send('u2', 'r2');
    h.command('gt.quick', { id: Q1 });
    h.command('gt.hit', { actor: 'ac_00000001', amount: 2 });
    // The quick's receipt names rev 4; its ops are on 2 and 3.
    edit(h, later, record => { record.receipts[0].rev = 4; });
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    const stored = JSON.stringify(h.chat[later].extra.storySuite);
    // The first reply is read again as three lines: everything after it would be numbered on, up to 4 and 5.
    h.store.replaceStory(first, { ops: [{ op: 'add', path: '/domains/gt/log/-', value: 'a' }, { op: 'replace', path: '/meta/rev', value: 1 },
        { op: 'add', path: '/domains/gt/log/-', value: 'b' }, { op: 'replace', path: '/meta/rev', value: 2 },
        { op: 'add', path: '/domains/gt/log/-', value: 'c' }, { op: 'replace', path: '/meta/rev', value: 3 }], receipts: [
        ...[1, 2, 3].map(rev => ({ id: `rc_0000000${rev}`, type: 'gt.tick', module: OWNER, cause: 'story', seed: 1, summary: 's', narrate: false, data: {}, rev })),
    ] });
    assert.equal(JSON.stringify(h.chat[later].extra.storySuite), stored, 'the quarantined record was not rewritten');
    assert.equal(h.gt().coin, 0, 'and it still applies nothing');
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    same(h);
});

test('P: taking back the newest changes keeps the Problems of blocks that are off in front of it', () => {
    const base = harness([guarded()], SMALL);
    base.send('u1', 'r1');
    assert.equal(base.command('gt.quick', { id: Q1 }).ok, true);
    base.send('u2', 'r2');
    base.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    const absent = harness([{ ...guarded(), hooks: {} }], { ...SMALL, recordId: () => `sw_${(0x3000 + Math.floor(Math.random() * 0xfffff)).toString(16).padStart(12, '0')}` });
    absent.chat.splice(0, absent.chat.length, ...clone(base.chat));
    absent.store.rebuild();
    for (let n = 3; n <= 8; n++) { absent.send(`u${n}`, `r${n}`); absent.command('gt.hit', { actor: 'ac_00000001', amount: 1 }); }
    assert.ok(absent.problems().length >= 1);
    const before = key(absent.problems());
    const head = absent.chat.length - 1;
    const rev = absent.store.head().meta.rev;
    // (a Re-read just before leaves nothing cached: the Problems must come from the checkpoint, not from a cache)
    absent.store.replaceStory(absent.chat.findIndex((message, i) => i > 3 && message.extra?.storySuite), { ops: [], receipts: [] });
    absent.store.truncate(head, rev);          // the newest change goes
    assert.deepEqual(key(absent.problems()), before, 'the block that is off is still reported');
    const reloaded = harness([{ ...guarded(), hooks: {} }], SMALL);
    reloaded.chat.splice(0, reloaded.chat.length, ...clone(absent.chat));
    reloaded.store.rebuild();
    assert.deepEqual(key(reloaded.problems()), before);
});

test('P: taking back the newest change of a reply keeps the Problem of its own block that is off', () => {
    const base = harness([guarded()]);
    const at = base.send('u1', 'r1');
    assert.equal(base.command('gt.quick', { id: Q1 }).ok, true);
    base.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    const absent = harness([{ ...guarded(), hooks: {} }]);
    absent.chat.splice(0, absent.chat.length, ...clone(base.chat));
    absent.store.rebuild();
    const before = key(absent.problems());
    assert.equal(before.length, 1);
    absent.store.truncate(at, 2);               // the hit goes; the quick stays, and stays off
    assert.deepEqual(key(absent.problems()), before);
    absent.store.rebuild();
    assert.deepEqual(key(absent.problems()), before);
});
