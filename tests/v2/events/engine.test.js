// The events engine: definitions, beforeGenerate firing, claims, rollback, chains, then-commands, status.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRE, claimKey, createEngine, createFireEvent, fireEvent, inspect, normalizeEvents, repeatKey } from '../../../src/v2/events/engine.js';
import { baseState, createFakeHost } from './helpers/fake-host.js';

// A tiny wallet module for `then`: its command writes its own domain, as SPEC §3.2 handlers do.
const walletCommands = {
    'wallet.receive'(ctx, { owner = 'party', currency = 'cp', amount }) {
        if (!Number.isInteger(amount) || amount < 1) ctx.fail('INVALID', 'An amount must be a whole number from 1.');
        const inv = ctx.draft('inventory');
        inv.wallets[owner] ??= {};
        inv.wallets[owner][currency] = (inv.wallets[owner][currency] ?? 0) + amount;
        return { summary: `+${amount} ${currency}`, narrate: false };
    },
    'director.note'(ctx, { text }) {
        ctx.draft('director').notes.push(text);
        return { summary: text };
    },
};

function setup({ defs, domains = {}, queries = {}, claims = {} }) {
    const state = baseState({ inventory: { defs: {}, stacks: {}, wallets: {}, aliases: {} }, director: { time: { minutes: 600 }, threads: {}, keys: {}, notes: [] }, ...domains });
    state.meta.claims = { ...claims };
    let list = defs;
    const host = createFakeHost({ state, commands: { [FIRE]: createFireEvent(() => list), ...walletCommands }, queries });
    const engine = createEngine({ events: () => list, command: host.command, query: host.query });
    return { host, engine, setDefs: next => { list = next; } };
}

const fired = host => host.receipts.filter(receipt => receipt.type === FIRE).map(receipt => receipt.data.event);

test('normalizeEvents: defaults, sorting by id, and every way a definition is refused', () => {
    const { defs, invalid } = normalizeEvents([
        { id: 'b', when: 'true', cue: '  Smoke rises.  ', pack: 'pack.fantasy' },
        { id: 'a', when: 'false', cue: 'A.', once: false, then: [{ command: 'wallet.receive', payload: { amount: 5 } }] },
        'not a record',
        { when: 'true', cue: 'x' },
        { id: 'bad id!', when: 'true', cue: 'x' },
        { id: 'x'.repeat(121), when: 'true', cue: 'x' },
        { id: 'b', when: 'true', cue: 'again' },
        { id: 'c', cue: 'x' },
        { id: 'd', when: 'eval("1")', cue: 'x' },
        { id: 'e', when: 'true' },
        { id: 'f', when: 'true', cue: 'x'.repeat(501) },
        { id: 'g', when: 'true', cue: 'x', once: 'yes' },
        { id: 'h', when: 'true', cue: 'x', then: 'wallet.receive' },
        { id: 'i', when: 'true', cue: 'x', then: Array(9).fill({ command: 'director.note', payload: { text: 't' } }) },
        { id: 'j', when: 'true', cue: 'x', then: [{ command: FIRE, payload: { id: 'b' } }] },
        { id: 'k', when: 'true', cue: 'x', then: [{ command: 'wallet.receive', payload: { f: () => 1 } }] },
        { id: 'l', when: 'true', cue: 'x', then: [{ payload: {} }] },
        { id: 'm', when: 'true', cue: 'x', after: 'm' },
        { id: 'n', when: 'true', cue: 'x', after: 'a' },
        { id: 'o', when: 'true', cue: 'x', after: 'p' },
        { id: 'p', when: 'true', cue: 'x', after: 'o' },
        { id: 'q', when: 'true', cue: 'x', after: 'not-enabled' },
        { id: 'r', when: 'true', cue: 'x', after: 'bad id' },
    ]);
    assert.deepEqual(defs.map(def => def.id), ['a', 'b', 'q']);
    assert.deepEqual(defs[1], { id: 'b', pack: 'pack.fantasy', when: 'true', cue: 'Smoke rises.', once: true, then: [], after: null });
    assert.deepEqual(defs[0].then, [{ command: 'wallet.receive', payload: { amount: 5 } }]);
    assert.equal(defs[0].once, false);
    const reasons = Object.fromEntries(invalid.map(entry => [entry.id ?? '(none)', entry.why]));
    assert.match(invalid[0].why, /must be a record/);
    assert.match(invalid[1].why, /needs an id/);
    assert.match(reasons['bad id!'], /may only hold letters/);
    assert.match(invalid.find(entry => entry.id?.startsWith('xxx')).why, /longer than 120/);
    assert.match(reasons.b, /share the id "b"; the first one is kept/);
    assert.match(reasons.c, /no condition/);
    assert.match(reasons.d, /condition of "d" can't be read: "eval" is not something a condition can call/);
    assert.match(reasons.e, /no cue/);
    assert.match(reasons.f, /longer than 500/);
    assert.match(reasons.g, /once: "yes"; use true or false/);
    assert.match(reasons.h, /must be a list of commands/);
    assert.match(reasons.i, /more than 8 commands/);
    assert.match(reasons.j, /can't fire another event/);
    assert.match(reasons.k, /not a plain record of data/);
    assert.match(reasons.l, /needs a command name/);
    assert.match(reasons.m, /waits for itself/);
    assert.match(reasons.n, /which repeats \(once: false\)/);
    assert.match(reasons.o, /loop of "after" events/);
    assert.match(reasons.p, /loop of "after" events/);
    assert.match(reasons.r, /may only hold letters/);
    assert.deepEqual(normalizeEvents(null), { defs: [], invalid: [] });
});

test('a met event commits one system receipt: the cue as summary, claim event:<id>, nothing for the tail', () => {
    const { host, engine } = setup({ defs: [{ id: 'pack.fantasy/dragon-sighted', when: 'time() >= 480', cue: 'Smoke over the eastern ridge: a dragon.' }] });
    const view = host.view();
    assert.equal(engine.beforeGenerate(view), undefined, 'nothing to the tail');
    assert.equal(host.receipts.length, 1);
    const [receipt] = host.receipts;
    assert.equal(receipt.type, FIRE);
    assert.equal(receipt.cause, 'system');
    assert.equal(receipt.summary, 'Smoke over the eastern ridge: a dragon.');
    assert.equal(receipt.narrate, true, 'told by the next reply as an untold receipt');
    assert.deepEqual(receipt.data, { event: 'pack.fantasy/dragon-sighted', then: [] });
    assert.equal(host.state().meta.claims[claimKey('pack.fantasy/dragon-sighted')], true);
    assert.equal(claimKey('x'), 'event:x');
    assert.deepEqual(host.calls.map(call => [call.type, call.cause]), [[FIRE, 'system']]);
    // Only the id (and the reply it is for) goes in the payload: the handler reads the rest from the pack.
    assert.deepEqual(host.calls[0].payload, { id: 'pack.fantasy/dragon-sighted', at: host.view().chat.length });
});

test('an unmet, erroring or claimed event commits nothing', () => {
    const { host, engine } = setup({
        defs: [
            { id: 'late', when: 'time() >= 1200', cue: 'Night falls.' },
            { id: 'broken', when: `actor('Ren').level >= 30`, cue: 'Ren is a legend.' },
            { id: 'done', when: 'true', cue: 'Already told.' },
        ],
        claims: { 'event:done': true },
    });
    engine.beforeGenerate(host.view());
    assert.equal(host.calls.length, 0);
    const status = engine.status(host.state());
    assert.deepEqual(status.events.map(row => [row.id, row.status]), [['broken', 'error'], ['done', 'fired'], ['late', 'waiting']]);
    assert.match(status.events[0].why, /can't be checked: >= needs two numbers or two words, not nothing \(null\) and a number/, 'no party: actor() is null');
    assert.match(status.events[2].why, /not met yet/);
});

test('claims stop re-firing on the same history; a rollback without the claim lets it fire again', () => {
    const { host, engine } = setup({ defs: [{ id: 'arrival', when: 'true', cue: 'The caravan arrives.' }] });
    const before = host.snapshot();
    engine.beforeGenerate(host.view());
    engine.beforeGenerate(host.view());
    engine.beforeGenerate(host.view());
    assert.deepEqual(fired(host), ['arrival'], 'once: the claim holds on this line of history');
    // Swipe or delete the carrier that held the receipt: the state goes back to before the claim.
    host.restore(before);
    assert.equal(host.state().meta.claims['event:arrival'], undefined);
    engine.beforeGenerate(host.view());
    assert.deepEqual(fired(host), ['arrival'], 'it happens again on the new line');
    assert.equal(host.state().meta.claims['event:arrival'], true);
    // A stale view (taken before the claim) can't fire twice: the handler's claim refuses it.
    const stale = createFakeHost({ state: host.state(), commands: { [FIRE]: createFireEvent(() => [{ id: 'arrival', when: 'true', cue: 'x' }]) } });
    const staleEngine = createEngine({ events: () => [{ id: 'arrival', when: 'true', cue: 'x' }], command: stale.command });
    const old = before.state;
    staleEngine.beforeGenerate({ state: old, query: () => null });
    assert.equal(stale.receipts.length, 0);
    assert.deepEqual(staleEngine.status(old).lastRun.failed, [{ id: 'arrival', code: 'CLAIMED', message: 'The event "arrival" has already happened on this line of the story.' }]);
});

test('once: false repeats before every reply while the condition holds, once per reply (B3-9)', () => {
    const { host, engine } = setup({ defs: [{ id: 'rain', when: 'time() >= 480', cue: 'Rain keeps falling.', once: false }] });
    const at = length => ({ ...host.view(), chat: { length, lastUser: '' } });
    engine.beforeGenerate(at(3));
    engine.beforeGenerate(at(3));
    assert.deepEqual(fired(host), ['rain'], 'the same reply again (a regenerate) does not pay again');
    engine.beforeGenerate(at(5));
    assert.deepEqual(fired(host), ['rain', 'rain']);
    // That reply (index 5) swiped or continued: the chat now holds it, so it is the last message.
    engine.beforeGenerate(at(6), { type: 'swipe' });
    engine.beforeGenerate(at(6), { type: 'continue' });
    engine.beforeGenerate(at(7), { dryRun: true });
    assert.equal(fired(host).length, 2, 'a swipe of the last reply, a Continue and a dry run pay nothing more');
    assert.deepEqual(Object.keys(host.state().meta.claims), ['event:rain:3', 'event:rain:5'], 'claimed per reply, never once and for all');
    const state = host.state();
    host.setState({ ...state, domains: { ...state.domains, director: { ...state.domains.director, time: { minutes: 100 } } } });
    engine.beforeGenerate(host.view());
    assert.equal(fired(host).length, 2, 'not met: no repeat');
});

test('checkpoint chain: A, then B one reply later, then nothing; rolling back A sends B back to waiting', () => {
    const defs = [
        { id: 'b-camp', after: 'a-gate', when: 'true', cue: 'B: the camp.' },
        { id: 'a-gate', when: 'true', cue: 'A: the gate.' },
        { id: 'c-keep', after: 'b-camp', when: `has('Keep Key')`, cue: 'C: the keep.' },
    ];
    const { host, engine } = setup({ defs });
    const start = host.snapshot();
    engine.beforeGenerate(host.view());
    assert.deepEqual(fired(host), ['a-gate'], 'B waits: A had not happened in the view this reply started from');
    let status = engine.status(host.state());
    assert.equal(status.events.find(row => row.id === 'b-camp').status, 'due');
    assert.match(status.events.find(row => row.id === 'c-keep').why, /waits for "b-camp" to happen first/);
    engine.beforeGenerate(host.view());
    assert.deepEqual(fired(host), ['a-gate', 'b-camp']);
    engine.beforeGenerate(host.view());
    assert.deepEqual(fired(host), ['a-gate', 'b-camp'], 'C waits on its condition');
    status = engine.status(host.state());
    assert.deepEqual(status.fired, ['a-gate', 'b-camp']);
    assert.deepEqual(status.waiting, [{ id: 'c-keep', why: 'Its condition is not met yet.' }]);
    host.restore(start);
    status = engine.status(host.state());
    assert.deepEqual(status.fired, []);
    assert.deepEqual(status.due, ['a-gate']);
    assert.match(status.events.find(row => row.id === 'b-camp').why, /waits for "a-gate"/);
});

test('after: an event no enabled pack defines waits; its claim from earlier on this line still counts', () => {
    const { host, engine, setDefs } = setup({ defs: [{ id: 'epilogue', after: 'pack.old/finale', when: 'true', cue: 'Epilogue.' }] });
    engine.beforeGenerate(host.view());
    assert.equal(host.calls.length, 0);
    assert.match(engine.status(host.state()).waiting[0].why, /"pack\.old\/finale", which no enabled pack defines/);
    const state = host.state();
    host.setState({ ...state, meta: { ...state.meta, claims: { 'event:pack.old/finale': true } } });
    engine.beforeGenerate(host.view());
    assert.deepEqual(fired(host), ['epilogue']);
    setDefs([]);
    assert.deepEqual(engine.status(host.state()).events, [], 'a disabled pack: its events are not listed');
});

test('then: the commands run in the same transaction; any refusal rejects all of it (no claim, no receipt)', () => {
    const { host, engine, setDefs } = setup({
        defs: [{
            id: 'reward', when: 'true', cue: 'The mayor pays you.',
            then: [{ command: 'wallet.receive', payload: { amount: 30 } }, { command: 'director.note', payload: { text: 'paid' } }],
        }],
    });
    engine.beforeGenerate(host.view());
    let state = host.state();
    assert.deepEqual(state.domains.inventory.wallets, { party: { cp: 30 } });
    assert.deepEqual(state.domains.director.notes, ['paid']);
    assert.equal(host.receipts.length, 1, 'one receipt: sub-commands are not separate receipts');
    assert.deepEqual(host.receipts[0].data.then, ['wallet.receive', 'director.note']);
    assert.equal(state.meta.rev, 1);

    setDefs([{ id: 'bad-reward', when: 'true', cue: 'x', then: [{ command: 'wallet.receive', payload: { amount: 5 } }, { command: 'wallet.receive', payload: { amount: -1 } }] }]);
    engine.beforeGenerate(host.view());
    state = host.state();
    assert.deepEqual(state.domains.inventory.wallets, { party: { cp: 30 } }, 'the first payment is rolled back too');
    assert.equal(state.meta.claims['event:bad-reward'], undefined);
    assert.equal(host.receipts.length, 1);
    const status = engine.status(state);
    assert.deepEqual(status.lastRun, { fired: [], failed: [{ id: 'bad-reward', code: 'INVALID', message: 'An amount must be a whole number from 1.' }] });
    assert.deepEqual(status.due, ['bad-reward'], 'still due: it is tried again before the next reply');

    setDefs([{ id: 'ghost', when: 'true', cue: 'x', then: [{ command: 'no.such' }] }]);
    engine.beforeGenerate(host.view());
    assert.equal(engine.status(host.state()).lastRun.failed[0].code, 'UNKNOWN_COMMAND');
});

test('conditions see the view: queries, quests, items, time', () => {
    const domains = {
        director: { time: { minutes: 900 }, threads: { th_aaaaaaaa: { id: 'th_aaaaaaaa', kind: 'quest', key: 'Granary Rats', status: 'resolved', fields: {} } }, keys: { 'granary rats': 'th_aaaaaaaa' }, notes: [] },
        inventory: { defs: { 'story/rope': { name: 'Rope' } }, stacks: { it_aaaaaaaa: { def: 'story/rope', qty: 2 } }, wallets: {}, aliases: {} },
        party: { pc: 'ac_aaaaaaaa', order: ['ac_aaaaaaaa'], actors: { ac_aaaaaaaa: { name: 'Ren', level: 30 } } },
    };
    const queries = { 'party.pc': state => state.domains.party.actors[state.domains.party.pc] };
    const { host, engine } = setup({
        domains, queries,
        defs: [{ id: 'hero', when: `query('party.pc').level >= 30 && quest('Granary Rats').status == 'resolved' && has('Rope', 2) && time() > 840 && actor('Ren') != null`, cue: 'The town cheers.' }],
    });
    engine.beforeGenerate(host.view());
    assert.deepEqual(fired(host), ['hero']);
});

test('determinism: the same view and definitions give the same commands, whatever order the packs list them in', () => {
    const defs = [
        { id: 'z-last', when: 'true', cue: 'Z.' },
        { id: 'a-first', when: 'true', cue: 'A.', then: [{ command: 'director.note', payload: { text: 'a' } }] },
        { id: 'm-middle', when: 'time() > 0', cue: 'M.', once: false },
    ];
    const runs = [defs, [...defs].reverse(), [defs[1], defs[2], defs[0]]].map(list => {
        const { host, engine } = setup({ defs: list });
        engine.beforeGenerate(host.view());
        return JSON.stringify({ calls: host.calls, state: host.state(), status: engine.status(host.state()) });
    });
    assert.equal(new Set(runs).size, 1);
    assert.deepEqual(JSON.parse(runs[0]).calls.map(call => call.payload.id), ['a-first', 'm-middle', 'z-last']);
});

test('async command buses: beforeGenerate waits for each commit in order, then gives nothing', async () => {
    const { host } = setup({ defs: [{ id: 'b', when: 'true', cue: 'B.' }, { id: 'a', when: 'true', cue: 'A.' }, { id: 'c', when: 'true', cue: 'C.' }] });
    const order = [];
    const engine = createEngine({
        events: () => [{ id: 'b', when: 'true', cue: 'B.' }, { id: 'a', when: 'true', cue: 'A.' }, { id: 'c', when: 'true', cue: 'C.' }],
        command: (type, payload, options) => new Promise(resolve => setImmediate(() => {
            order.push(payload.id);
            resolve(payload.id === 'b' ? { ok: false, code: 'FAILED', message: 'Busy.' } : host.command(type, payload, options));
        })),
    });
    const pending = engine.beforeGenerate(host.view());
    assert.equal(typeof pending?.then, 'function');
    assert.equal(await pending, undefined);
    assert.deepEqual(order, ['a', 'b', 'c']);
    assert.deepEqual(engine.status(host.state()).lastRun, { fired: ['a', 'c'], failed: [{ id: 'b', code: 'FAILED', message: 'Busy.' }] });
    const rejecting = createEngine({ events: () => [{ id: 'x', when: 'true', cue: 'X.' }], command: () => Promise.reject(new Error('Down.')) });
    await rejecting.beforeGenerate(host.view());
    assert.deepEqual(rejecting.status(host.state()).lastRun.failed, [{ id: 'x', code: 'FAILED', message: 'Down.' }]);
});

test('a throwing command, a missing bus, and a broken event list are reported, never thrown', () => {
    const view = { state: baseState(), query: () => null };
    const throwing = createEngine({ events: () => [{ id: 'x', when: 'true', cue: 'X.' }], command: () => { throw new Error('Bus fell over.'); } });
    assert.equal(throwing.beforeGenerate(view), undefined);
    assert.deepEqual(throwing.status(view.state).lastRun.failed, [{ id: 'x', code: 'FAILED', message: 'Bus fell over.' }]);
    const busless = createEngine({ events: () => [{ id: 'x', when: 'true', cue: 'X.' }] });
    busless.beforeGenerate(view);
    assert.match(busless.status(view.state).lastRun.failed[0].message, /no command bus/);
    const broken = createEngine({ events: () => { throw new Error('packs.content is not registered'); }, command: () => assert.fail('no command') });
    assert.equal(broken.beforeGenerate(view), undefined);
    assert.deepEqual(broken.status(view.state).problems, ['The event list could not be read: packs.content is not registered']);
    const later = createEngine({ events: () => Promise.resolve([]), command: () => assert.fail('no command') });
    later.beforeGenerate(view);
    assert.match(later.status(view.state).problems[0], /answered later/);
});

test('events.status: which fired, which are due, which wait and why, which are invalid, and the last run', () => {
    const { host, engine } = setup({
        defs: [
            { id: 'one', when: 'true', cue: 'One.', pack: 'pack.demo' },
            { id: 'two', after: 'one', when: 'true', cue: 'Two.' },
            { id: 'three', when: `time() < 'noon'`, cue: 'Three.' },
            { id: 'four', when: 'false', cue: 'Four.' },
            { id: 'five', when: '1 +', cue: 'Five.' },
        ],
    });
    engine.beforeGenerate(host.view());
    const status = engine.status(host.state());
    assert.deepEqual(status.fired, ['one']);
    assert.deepEqual(status.due, ['two']);
    assert.deepEqual(status.waiting.map(row => row.id), ['four', 'three']);
    assert.match(status.waiting[1].why, /^Its condition can't be checked: < needs two numbers or two words, not a number and a word\.$/);
    assert.equal(status.events.find(row => row.id === 'three').status, 'error');
    assert.deepEqual(status.invalid.map(row => row.id), ['five']);
    assert.match(status.invalid[0].why, /can't be read/);
    assert.deepEqual(status.lastRun, { fired: ['one'], failed: [] });
    assert.deepEqual(status.events[0], { id: 'four', pack: null, status: 'waiting', why: 'Its condition is not met yet.', once: true, after: null, when: 'false', cue: 'Four.' });
    assert.equal(status.events.find(row => row.id === 'one').pack, 'pack.demo');
    assert.deepEqual(JSON.parse(JSON.stringify(status)), status, 'plain data');
    // inspect is the pure core of both.
    assert.deepEqual(inspect(host.view(), [{ id: 'one', when: 'true', cue: 'x' }]).fired, ['one']);
});

test('fireEvent: the handler fires only a due event of an enabled pack, as its definition says (B3-1, B3-9)', () => {
    const defs = [
        { id: 'x', when: 'true', cue: 'X.', then: [{ command: 'director.note', payload: { text: 'from the pack' } }] },
        { id: 'r', when: 'true', cue: 'R.', once: false },
        { id: 'n', when: 'false', cue: 'N.' },
    ];
    const host = createFakeHost({ state: baseState({ director: { notes: [] } }), commands: { [FIRE]: createFireEvent(() => defs), ...walletCommands } });
    assert.equal(host.command(FIRE, { id: 'bad id!' }, { cause: 'system' }).code, 'INVALID');
    assert.deepEqual(host.command(FIRE, { id: 'nobody' }, { cause: 'system' }), { ok: false, code: 'REFUSED', message: 'No enabled pack has an event "nobody".' });
    assert.equal(host.command(FIRE, { id: 'n' }, { cause: 'system' }).code, 'REFUSED', 'not due');
    // The payload's cue and steps are ignored: the definition's run.
    const done = host.command(FIRE, { id: 'x', cue: 'Forged.', then: [{ command: 'wallet.receive', payload: { amount: 999 } }] }, { cause: 'system' });
    assert.equal(done.ok, true);
    assert.equal(done.receipt.summary, 'X.');
    assert.deepEqual(host.state().domains.director.notes, ['from the pack']);
    assert.equal(host.state().domains.inventory, undefined, 'no wallet step ran');
    assert.deepEqual(host.command(FIRE, { id: 'x' }, { cause: 'system' }), { ok: false, code: 'CLAIMED', message: 'The event "x" has already happened on this line of the story.' });
    // A repeating event: once per reply index.
    assert.equal(host.command(FIRE, { id: 'r', at: 4 }, { cause: 'system' }).ok, true);
    assert.equal(host.command(FIRE, { id: 'r', at: 4 }, { cause: 'system' }).code, 'CLAIMED');
    assert.equal(host.command(FIRE, { id: 'r', at: 6 }, { cause: 'system' }).ok, true);
    assert.equal(host.state().meta.claims[repeatKey('r', 4)], true);
    // Only the host's own system cue fires an event: not a button (ui), not a change line (story).
    for (const cause of ['ui', 'story']) assert.equal(host.command(FIRE, { id: 'x' }, { cause }).code, 'REFUSED', cause);
    assert.equal(fireEvent.internal, true, 'marked internal for the registry');
    assert.equal(createFireEvent(() => defs).internal, true);
});
