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

// Reads through a recording proxy, nested fields and all. structuredClone cannot take a proxy, so the test hands it the
// targets (a copy made for persistence is not a replay read).
function recorder() {
    const targets = new WeakMap();
    const seen = new Set();
    const nativeClone = globalThis.structuredClone;
    const unwrap = value => {
        if (!value || typeof value !== 'object') return value;
        const raw = targets.get(value) ?? value;
        return Array.isArray(raw) ? raw.map(unwrap) : Object.fromEntries(Object.entries(raw).map(([name, each]) => [name, unwrap(each)]));
    };
    const wrap = (value, path) => {
        if (!value || typeof value !== 'object') return value;
        const proxy = new Proxy(value, {
            get(target, name, receiver) {
                const found = Reflect.get(target, name, receiver);
                if (typeof name !== 'string') return found;
                if (Array.isArray(target)) return /^\d+$/.test(name) ? wrap(found, path.concat('*')) : found;
                seen.add(path.concat(name).join('.'));
                return wrap(found, path.concat(name));
            },
        });
        targets.set(proxy, value);
        return proxy;
    };
    return {
        seen,
        watch: record => wrap(record, []),
        install() { globalThis.structuredClone = value => nativeClone(unwrap(value)); },
        restore() { globalThis.structuredClone = nativeClone; },
    };
}
// Is this path (below a record) one replay may read? `listed`: replayInputsOf's fields and the bookkeeping ones.
function allowed(path, listed) {
    const [top, ...rest] = path.split('.');
    if (!listed.has(top)) return false;
    if (top === 'receipts' && rest[1] === 'data') return rest.length <= 2 || rest[2] === 'v2';
    if (top === 'source') return rest.length === 0 || ['logical', 'swipeKey', 'evidence', 'next'].includes(rest[0]);
    return true;
}

test('the prefix is the hash of one function: replay, Re-read, reconcile and truncate read nothing from a record but what replayInputsOf lists', () => {
    const h = harness([guarded()], SMALL);
    for (let k = 1; k <= 8; k++) {
        h.send(`u${k}`, `r${k}`);
        if (k === 1) h.command('gt.quick', { id: Q1 });
        else if (k === 2) h.command('gt.attempt', { id: Q1 }, 'system');
        else h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    }
    const listed = new Set([...Object.keys(replayInputsOf(h.chat[2].extra.storySuite)), ...REPLAY_BOOKKEEPING]);
    const rec = recorder();
    rec.install();
    try {
        // The same chat in a new store, every record behind a recording proxy (the last one too, and every swipe copy untouched).
        const cold = harness([guarded()], SMALL);
        cold.chat.splice(0, cold.chat.length, ...clone(h.chat).map(message => {
            if (message.extra?.storySuite) message.extra = { ...message.extra, storySuite: rec.watch(message.extra.storySuite) };
            return message;
        }));
        cold.store.rebuild();
        cold.store.head();
        for (let i = 2; i < cold.chat.length; i += 2) cold.store.at(i);
        // A reconcile (nothing to plan again), a Re-read of a middle reply, taking back the newest change.
        const rerun = () => ({ ok: false });
        cold.store.reconcile(2, { rerun });
        const middle = cold.chat.findIndex((message, i) => i > 4 && message.extra?.storySuite);
        cold.store.replaceStory(middle, { ops: [], receipts: [], rerun });
        // (what a rewind asks of the store: a dry run on the messages its branch will hold, then the cut)
        const newest = cold.chat.length - 1;
        cold.store.truncate(newest, cold.store.head().meta.rev, { dryRun: true, chat: cold.chat.slice(0, newest + 1) });
        cold.store.truncate(newest, cold.store.head().meta.rev);
        cold.store.head();
    } finally {
        rec.restore();
    }
    const read = [...rec.seen];
    assert.ok(['ops', 'spans', 'receipts', 'source', 'receipts.*.guarded', 'receipts.*.rev', 'receipts.*.data'].every(name => read.includes(name)), `the probe saw the records: ${read.length} fields`);
    for (const path of read) assert.ok(allowed(path, listed), `replay or a rewrite read record.${path}, which is not a replay input or bookkeeping`);
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

// ---- a Re-read moves a kept block's position and nothing else -------------------------------------------------------

test('R: a Re-read keeps a kept block\'s saved payload hash: an edited reply is still seen as edited, and a pure guard keeps the payout off, as a full replay says', () => {
    const modules = () => [guarded({ strict: true })];
    const h = harness(modules(), SMALL);
    const at = [];
    for (let k = 1; k <= 6; k++) {
        at.push(h.send(`u${k}`, `r${k}`));
        if (k === 1) assert.equal(h.command('gt.quick', { id: Q1 }).ok, true);
        else h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    }
    assert.equal(h.gt().coin, 1);
    const saved = clone(h.chat[at[0]].extra.storySuite.spans.find(span => span.id).boundaries[0].payloadHash);
    // The reader edits the first reply, and it is read again (no lines changed).
    h.chat[at[0]].mes = 'r1, edited';
    h.chat[at[0]].swipes[0] = 'r1, edited';
    h.store.replaceStory(at[0], { ops: [], receipts: [] });
    const span = h.chat[at[0]].extra.storySuite.spans.find(each => each.id);
    assert.equal(span.boundaries[0].payloadHash, saved, 'the saved payload hash is what it was stored with');
    assert.equal(h.gt().coin, 0, 'the guard sees the edit and the payout stays off');
    assert.ok(h.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    assert.equal(h.gt().lost.ac_00000001, 5, 'the plain changes after it are untouched');
    assert.equal(JSON.stringify(h.store.head()), JSON.stringify(fullReplay(h, modules()).store.head()), 'the head is what a full replay gives');
    assert.deepEqual(key(h.problems()), key(fullReplay(h, modules()).problems()));
});

test('R: a Re-read does not heal a kept block whose integrity metadata is damaged: it stays as stored and off', () => {
    const h = harness([guarded()], SMALL);
    const at = [];
    for (let k = 1; k <= 6; k++) {
        at.push(h.send(`u${k}`, `r${k}`));
        if (k === 1) assert.equal(h.command('gt.quick', { id: Q1 }).ok, true);
        else h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    }
    edit(h, at[0], record => { record.spans.find(span => span.id).claims = []; });
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    const stored = clone(h.chat[at[0]].extra.storySuite.spans.find(span => span.id));
    h.store.replaceStory(at[0], { ops: [], receipts: [] });
    const after = h.chat[at[0]].extra.storySuite.spans.find(span => span.id);
    assert.deepEqual(after.claims, [], 'the claims are not regenerated from the ops');
    assert.deepEqual({ ...after, n: stored.n }, stored, 'nothing else of it changed either');
    assert.equal(h.gt().coin, 0, 'it stays off');
    assert.ok(h.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    assert.equal(JSON.stringify(h.store.head()), JSON.stringify(fullReplay(h).store.head()));
});

test('replayQueries is a module field the registry knows: a list of the module\'s own query names, checked', async () => {
    const { definitionProblems, definitionWarnings } = await import('../../src/v2/registry.js');
    const ok = { id: 'rq-ok', queries: { 'rq.a': () => 1 }, replayQueries: ['rq.a'] };
    assert.deepEqual(definitionWarnings(ok), [], 'no "not a module field" warning');
    assert.deepEqual(definitionProblems(ok), []);
    assert.match(definitionProblems({ ...ok, replayQueries: 'rq.a' }).join(' / '), /replayQueries is not a list/);
    assert.match(definitionProblems({ ...ok, replayQueries: ['rq.zzz'] }).join(' / '), /"rq.zzz", which is not one of this module's queries/);
    assert.match(definitionProblems({ ...ok, replayQueries: [5] }).join(' / '), /not a query name/);
});
